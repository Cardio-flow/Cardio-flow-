import type { Q } from "../db/db.js";
import { createHash } from "node:crypto";
import { uuid } from "../kernel/base.js";
import { activeBarrier, loadState, type PatientState } from "../kernel/state.js";
import { MEASURES, drugClassOf } from "../../shared/catalog.js";
import { RULES, RULESET, type Finding, type RuleDef } from "./rules.js";
import { NEEDS_REVIEW, noteFor, publishedByPolicy, publisherFor } from "./publication.js";

export type RuleVersion = { rule_id: string; version: number; status: string; params: Record<string, any>; title: string; kind: string; content_hash: string; evidence: string };

// Which version of each rule runs for this site.
export async function activeRuleVersions(tx: Q, siteMode: "sandbox" | "production") {
  const rows = (
    await tx.query<RuleVersion>(
      `SELECT rule_id,version,status,params,title,kind,content_hash,evidence FROM cf.rule_version WHERE status <> 'RETIRED' ORDER BY rule_id, version DESC`,
    )
  ).rows;
  // production: newest PUBLISHED version. sandbox: newest version of any status (labelled in the UI).
  const chosen = new Map<string, RuleVersion>();
  for (const r of rows) {
    if (chosen.has(r.rule_id)) continue;
    if (siteMode === "production" && r.status !== "PUBLISHED") continue;
    chosen.set(r.rule_id, r);
  }
  return chosen;
}

// A drug suggestion stays quiet while a recorded reason covers its class, or while the patient
// reports not taking a prescribed drug of that class (the not-taking alert speaks instead).
export function suppressed(s: PatientState, f: Finding) {
  const a = f.action as any;
  if (a.type === "start-med") {
    const cls = drugClassOf(a.code);
    return !!activeBarrier(s, cls) || s.meds.some((m) => m.status === "not_taking" && drugClassOf(m.code) === cls);
  }
  if (a.type === "titrate" && a.direction === "increase") {
    const m = s.meds.find((x) => x.id === a.medicationId);
    return !!m && !!activeBarrier(s, "up:" + drugClassOf(m.code));
  }
  return false;
}

export type ReassessResult = { created: { id: string; severity: string; title: string; rule_id: string }[]; resolved: number; superseded: number };

export async function reassess(tx: Q, patientId: string, siteMode: "sandbox" | "production", changed: string[] | null = null, state?: PatientState): Promise<ReassessResult> {
  await tx.query("SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE", [patientId]);
  const s = state ?? (await loadState(tx, patientId));
  // sandbox-only rules (NEEDS_REVIEW) run on sample patients only: a real patient on a sandbox site sees published rules
  const versions = await activeRuleVersions(tx, s.patient.synthetic ? siteMode : "production");
  const result: ReassessResult = { created: [], resolved: 0, superseded: 0 };
  // a deceased patient leaves every reminder list: all rules run and find nothing
  // a new visit or admission can end a "until next review" reason: then every rule runs
  // "observations" (and "studies") as an input means any result: a rule that reads labs generically
  // (medicine monitoring, guideline targets) re-runs whenever any measurement is recorded or corrected
  const anyResult = !!changed && changed.some((c) => c in MEASURES || c === "observations");
  const shouldRun = (rule: RuleDef) =>
    s.deceased || !changed || rule.inputs.some((i) => changed.includes(i)) || (anyResult && rule.inputs.includes("observations")) || (changed.includes("contexts") && s.barriers.length > 0);
  // Two reads for the whole patient instead of per rule (the database may be far away).
  const existing = (
    await tx.query<{ id: string; rule_id: string; fingerprint: string; rule_status: string; rule_version: number; rule_content_hash: string; status: string }>(
      `SELECT id,rule_id,fingerprint,rule_status,rule_version,rule_content_hash,status FROM cf.recommendation WHERE patient_id=$1 AND status IN ('active','decided')`,
      [patientId],
    )
  ).rows;
  // a suggestion closed with a recorded reason is governed by that reason (it can return when the
  // reason lapses or is cleared); any other closed suggestion stays closed for the same data
  const governed = new Set(((await tx.query(`SELECT recommendation_id FROM cf.treatment_barrier WHERE patient_id=$1 AND recommendation_id IS NOT NULL`, [patientId])).rows as any[]).map((r) => r.recommendation_id));
  const decidedSet = new Set(existing.filter((r) => r.status === "decided" && !governed.has(r.id)).map((r) => r.rule_id + "#" + r.fingerprint));
  for (const rule of RULES) {
    const version = versions.get(rule.id);
    const active = existing.filter((r) => r.status === "active" && r.rule_id === rule.id);
    if (!version) {
      // rule not runnable at this site (e.g. unpublished in production): nothing it said stays active
      for (const r of active) {
        await tx.query(`UPDATE cf.recommendation SET status='resolved', closed_at=now() WHERE id=$1`, [r.id]);
        result.resolved++;
      }
      continue;
    }
    if (!shouldRun(rule)) continue;
    const contentHash = ruleContentHash(rule, { ...rule.defaultParams, ...version.params }, version.evidence);
    const findings = s.deceased ? [] : rule.evaluate(s, { ...rule.defaultParams, ...version.params }).filter((f) => !suppressed(s, f));
    const seen = new Set<string>();
    for (const f of findings) {
      const fingerprint = `${f.key}|${f.signature}`;
      seen.add(f.key);
      const same = active.find((a) => a.fingerprint === fingerprint && a.rule_version === version.version && a.rule_status === version.status && a.rule_content_hash === contentHash);
      if (same) {
        continue;
      }
      if (decidedSet.has(rule.id + "#" + fingerprint)) continue;
      const id = uuid();
      await tx.query(
        `INSERT INTO cf.recommendation(id,patient_id,rule_id,rule_version,rule_status,fingerprint,severity,title,detail,facts,missing,action,status,rule_content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13)`,
        [id, patientId, rule.id, version.version, version.status, fingerprint, f.severity, f.title, f.detail, JSON.stringify(f.facts), JSON.stringify(f.missing), JSON.stringify(f.action), contentHash],
      );
      for (const old of active.filter((a) => a.fingerprint.split("|")[0] === f.key)) {
        await tx.query(`UPDATE cf.recommendation SET status='superseded', superseded_by=$2, closed_at=now() WHERE id=$1`, [old.id, id]);
        result.superseded++;
      }
      result.created.push({ id, severity: f.severity, title: f.title, rule_id: rule.id });
    }
    for (const a of active) {
      if (!seen.has(a.fingerprint.split("|")[0])) {
        await tx.query(`UPDATE cf.recommendation SET status='resolved', closed_at=now() WHERE id=$1 AND status='active'`, [a.id]);
        result.resolved++;
      }
    }
  }
  return result;
}

const event = (tx: Q, ruleId: string, version: number, from: string | null, to: string, actor: string, note: string) =>
  tx.query(`INSERT INTO cf.rule_event(id,rule_id,version,from_status,to_status,actor,note) VALUES($1,$2,$3,$4,$5,$6,$7)`, [uuid(), ruleId, version, from, to, actor, note]);

export async function seedRules(tx: Q) {
  await tx.query("SELECT pg_advisory_xact_lock(431002)");
  let added = 0;
  for (const rule of RULES) {
    const exists = (await tx.query(`SELECT 1 FROM cf.rule_version WHERE rule_id=$1 LIMIT 1`, [rule.id])).rows[0];
    if (exists) {
      // A rule reclassified as clinical must not stay auto-published by the build: send it back to review.
      if (rule.kind === "clinical") {
        const demoted = (
          await tx.query<{ version: number }>(
            `UPDATE cf.rule_version SET status='CLINICAL_REVIEW', kind='clinical', published_by=NULL, updated_at=now()
             WHERE rule_id=$1 AND status='PUBLISHED' AND published_by='system:v2-build' RETURNING version`,
            [rule.id],
          )
        ).rows;
        for (const d of demoted) await event(tx, rule.id, d.version, "PUBLISHED", "CLINICAL_REVIEW", "system:v2-build", "Reclassified as a clinical rule: returned to clinical review.");
        added += demoted.length;
      }
      added += await applyPolicy(tx, rule);
      continue;
    }
    added++;
    const status = rule.kind === "operational" || publishedByPolicy(rule) ? "PUBLISHED" : "CLINICAL_REVIEW";
    const publisher = rule.kind === "operational" ? "system:v2-build" : status === "PUBLISHED" ? publisherFor(rule.id) : null;
    await tx.query(
      `INSERT INTO cf.rule_version(rule_id,version,kind,title,status,params,evidence,author,published_by,review_note,content_hash) VALUES($1,1,$2,$3,$4,$5,$6,'system:v2-build',$7,$8,$9)`,
      [rule.id, rule.kind, rule.title, status, JSON.stringify(rule.defaultParams), rule.evidence, publisher, rule.kind === "clinical" && status === "PUBLISHED" ? noteFor(rule.id) : null, ruleContentHash(rule)],
    );
    await event(tx, rule.id, 1, null, status, publisher ?? "system:v2-build",
      rule.kind === "operational" ? "Workflow rule (no clinical threshold) published at build."
        : status === "PUBLISHED" ? noteFor(rule.id) : `Local threshold, awaiting clinical review (sandbox only): ${NEEDS_REVIEW[rule.id]}`);
  }
  return added;
}

// A content change creates a new version; published parameters/evidence are never overwritten.
export function ruleContentHash(rule: RuleDef, params = rule.defaultParams, evidence = rule.evidence) {
  return createHash("sha256").update(JSON.stringify({ release: RULESET, id: rule.id, title: rule.title, params, evidence, logic: rule.evaluate.toString() })).digest("hex");
}

async function applyPolicy(tx: Q, rule: RuleDef) {
  const newest = (await tx.query<any>(
    `SELECT * FROM cf.rule_version WHERE rule_id=$1 ORDER BY version DESC LIMIT 1`, [rule.id],
  )).rows[0];
  // A clinician's version, including a retired version, is an explicit governance decision.
  if (!newest || newest.author !== "system:v2-build" || newest.reviewer || newest.status === "RETIRED") return 0;
  const status = rule.kind === "operational" || publishedByPolicy(rule) ? "PUBLISHED" : "CLINICAL_REVIEW";
  const publisher = rule.kind === "operational" ? "system:v2-build" : status === "PUBLISHED" ? publisherFor(rule.id) : null;
  const contentHash = ruleContentHash(rule);
  if (newest.content_hash === contentHash && newest.status === status && newest.published_by === publisher) return 0;
  const version = Number(newest.version) + 1;
  if (status === "PUBLISHED") {
    const retired = (await tx.query<{ version: number }>(`UPDATE cf.rule_version SET status='RETIRED', updated_at=now() WHERE rule_id=$1 AND status='PUBLISHED' RETURNING version`, [rule.id])).rows;
    for (const old of retired) await event(tx, rule.id, old.version, "PUBLISHED", "RETIRED", publisher!, `Replaced by version ${version}; original content retained.`);
  } else if (newest.status === "PUBLISHED") {
    await tx.query(`UPDATE cf.rule_version SET status='RETIRED', updated_at=now() WHERE rule_id=$1 AND version=$2`, [rule.id, newest.version]);
    await event(tx, rule.id, newest.version, "PUBLISHED", "RETIRED", "system:v2-build", "Local threshold: no longer runnable in production.");
  }
  const note = rule.kind === "operational" ? "Workflow rule published at build." : status === "PUBLISHED" ? noteFor(rule.id) : `Local threshold awaiting review: ${NEEDS_REVIEW[rule.id]}`;
  await tx.query(
    `INSERT INTO cf.rule_version(rule_id,version,kind,title,status,params,evidence,author,published_by,review_note,content_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,'system:v2-build',$8,$9,$10)`,
    [rule.id, version, rule.kind, rule.title, status, JSON.stringify(rule.defaultParams), rule.evidence, publisher, note, contentHash],
  );
  await event(tx, rule.id, version, null, status, publisher ?? "system:v2-build", `${note} Content ${contentHash}. Release ${RULESET}.`);
  return 1;
}
