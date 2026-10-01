import type { Q } from "../db/db.js";
import { uuid } from "../kernel/base.js";
import { loadState, type PatientState } from "../kernel/state.js";
import { RULES, type RuleDef } from "./rules.js";
import { NEEDS_REVIEW, POLICY_NOTE, POLICY_PUBLISHER, publishedByPolicy } from "./publication.js";

export type RuleVersion = { rule_id: string; version: number; status: string; params: Record<string, any>; title: string; kind: string };

// Which version of each rule runs for this site.
export async function activeRuleVersions(tx: Q, siteMode: "sandbox" | "production") {
  const rows = (
    await tx.query<RuleVersion>(
      `SELECT rule_id,version,status,params,title,kind FROM cf.rule_version WHERE status <> 'RETIRED' ORDER BY rule_id, version DESC`,
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

export type ReassessResult = { created: { id: string; severity: string; title: string; rule_id: string }[]; resolved: number; superseded: number };

export async function reassess(tx: Q, patientId: string, siteMode: "sandbox" | "production", changed: string[] | null = null, state?: PatientState): Promise<ReassessResult> {
  const s = state ?? (await loadState(tx, patientId));
  const versions = await activeRuleVersions(tx, siteMode);
  const result: ReassessResult = { created: [], resolved: 0, superseded: 0 };
  // a deceased patient leaves every reminder list: all rules run and find nothing
  const shouldRun = (rule: RuleDef) => s.deceased || !changed || rule.inputs.some((i) => changed.includes(i));
  // Two reads for the whole patient instead of per rule (the database may be far away).
  const existing = (
    await tx.query<{ id: string; rule_id: string; fingerprint: string; rule_status: string; rule_version: number; status: string }>(
      `SELECT id,rule_id,fingerprint,rule_status,rule_version,status FROM cf.recommendation WHERE patient_id=$1 AND status IN ('active','decided')`,
      [patientId],
    )
  ).rows;
  const decidedSet = new Set(existing.filter((r) => r.status === "decided").map((r) => r.rule_id + "#" + r.fingerprint));
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
    const findings = s.deceased ? [] : rule.evaluate(s, { ...rule.defaultParams, ...version.params });
    const seen = new Set<string>();
    for (const f of findings) {
      const fingerprint = `${f.key}|${f.signature}`;
      seen.add(f.key);
      const same = active.find((a) => a.fingerprint === fingerprint);
      if (same) {
        // same finding, but the rule was since approved/published: keep it, relabel it
        if (same.rule_status !== version.status || same.rule_version !== version.version)
          await tx.query(`UPDATE cf.recommendation SET rule_status=$2, rule_version=$3 WHERE id=$1`, [same.id, version.status, version.version]);
        continue;
      }
      if (decidedSet.has(rule.id + "#" + fingerprint)) continue;
      const id = uuid();
      await tx.query(
        `INSERT INTO cf.recommendation(id,patient_id,rule_id,rule_version,rule_status,fingerprint,severity,title,detail,facts,missing,action,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')`,
        [id, patientId, rule.id, version.version, version.status, fingerprint, f.severity, f.title, f.detail, JSON.stringify(f.facts), JSON.stringify(f.missing), JSON.stringify(f.action)],
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
    const publisher = rule.kind === "operational" ? "system:v2-build" : status === "PUBLISHED" ? POLICY_PUBLISHER : null;
    await tx.query(
      `INSERT INTO cf.rule_version(rule_id,version,kind,title,status,params,evidence,author,published_by,review_note) VALUES($1,1,$2,$3,$4,$5,$6,'system:v2-build',$7,$8)`,
      [rule.id, rule.kind, rule.title, status, JSON.stringify(rule.defaultParams), rule.evidence, publisher, publisher === POLICY_PUBLISHER ? POLICY_NOTE : null],
    );
    await event(tx, rule.id, 1, null, status, publisher ?? "system:v2-build",
      rule.kind === "operational" ? "Workflow rule (no clinical threshold) published at build."
        : status === "PUBLISHED" ? POLICY_NOTE : `Local threshold, awaiting clinical review (sandbox only): ${NEEDS_REVIEW[rule.id]}`);
  }
  return added;
}

// Keeps the newest build-authored version of a clinical rule in line with the publication policy.
// Versions a clinician has edited, approved or published are never touched.
async function applyPolicy(tx: Q, rule: RuleDef) {
  if (rule.kind !== "clinical") return 0;
  const newest = (
    await tx.query<{ version: number; status: string; author: string; reviewer: string | null; published_by: string | null }>(
      `SELECT version,status,author,reviewer,published_by FROM cf.rule_version WHERE rule_id=$1 AND status <> 'RETIRED' ORDER BY version DESC LIMIT 1`,
      [rule.id],
    )
  ).rows[0];
  if (!newest || newest.author !== "system:v2-build" || newest.reviewer) return 0;
  if (publishedByPolicy(rule) && newest.status === "CLINICAL_REVIEW") {
    await tx.query(`UPDATE cf.rule_version SET status='RETIRED', updated_at=now() WHERE rule_id=$1 AND status='PUBLISHED'`, [rule.id]);
    await tx.query(
      `UPDATE cf.rule_version SET status='PUBLISHED', published_by=$3, review_note=$4, evidence=$5, params=$6, updated_at=now() WHERE rule_id=$1 AND version=$2`,
      [rule.id, newest.version, POLICY_PUBLISHER, POLICY_NOTE, rule.evidence, JSON.stringify(rule.defaultParams)],
    );
    await event(tx, rule.id, newest.version, "CLINICAL_REVIEW", "PUBLISHED", POLICY_PUBLISHER, POLICY_NOTE);
    return 1;
  }
  if (!publishedByPolicy(rule) && newest.status === "PUBLISHED" && newest.published_by === POLICY_PUBLISHER) {
    await tx.query(`UPDATE cf.rule_version SET status='CLINICAL_REVIEW', published_by=NULL, review_note=NULL, updated_at=now() WHERE rule_id=$1 AND version=$2`, [rule.id, newest.version]);
    await event(tx, rule.id, newest.version, "PUBLISHED", "CLINICAL_REVIEW", POLICY_PUBLISHER, `Local threshold, returned to clinical review: ${NEEDS_REVIEW[rule.id]}`);
    return 1;
  }
  // a build-authored, policy-published version follows the code: evidence and parameters
  if (newest.published_by === POLICY_PUBLISHER) {
    const r = await tx.query(
      `UPDATE cf.rule_version SET evidence=$3, params=$4, updated_at=now() WHERE rule_id=$1 AND version=$2 AND (evidence IS DISTINCT FROM $3 OR params::text IS DISTINCT FROM $4::jsonb::text) RETURNING version`,
      [rule.id, newest.version, rule.evidence, JSON.stringify(rule.defaultParams)],
    );
    return r.rows.length;
  }
  return 0;
}
