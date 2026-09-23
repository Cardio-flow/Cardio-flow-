import type { Q } from "../db/db.js";
import { uuid } from "../kernel/base.js";
import { loadState, type PatientState } from "../kernel/state.js";
import { RULES, type RuleDef } from "./rules.js";

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
  const shouldRun = (rule: RuleDef) => !changed || rule.inputs.some((i) => changed.includes(i));
  for (const rule of RULES) {
    const version = versions.get(rule.id);
    const active = (
      await tx.query<{ id: string; fingerprint: string }>(
        `SELECT id,fingerprint FROM cf.recommendation WHERE patient_id=$1 AND rule_id=$2 AND status='active'`,
        [patientId, rule.id],
      )
    ).rows;
    if (!version) {
      // rule not runnable at this site (e.g. unpublished in production): nothing it said stays active
      for (const r of active) {
        await tx.query(`UPDATE cf.recommendation SET status='resolved', closed_at=now() WHERE id=$1`, [r.id]);
        result.resolved++;
      }
      continue;
    }
    if (!shouldRun(rule)) continue;
    const findings = rule.evaluate(s, { ...rule.defaultParams, ...version.params });
    const seen = new Set<string>();
    for (const f of findings) {
      const fingerprint = `${f.key}|${f.signature}`;
      seen.add(f.key);
      const same = active.find((a) => a.fingerprint === fingerprint);
      if (same) continue;
      const decided = (
        await tx.query(`SELECT 1 FROM cf.recommendation WHERE patient_id=$1 AND rule_id=$2 AND fingerprint=$3 AND status IN ('decided','resolved') LIMIT 1`, [
          patientId, rule.id, fingerprint,
        ])
      ).rows[0];
      if (decided) continue;
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

export async function seedRules(tx: Q) {
  for (const rule of RULES) {
    const exists = (await tx.query(`SELECT 1 FROM cf.rule_version WHERE rule_id=$1 LIMIT 1`, [rule.id])).rows[0];
    if (exists) continue;
    const status = rule.kind === "operational" ? "PUBLISHED" : "CLINICAL_REVIEW";
    await tx.query(
      `INSERT INTO cf.rule_version(rule_id,version,kind,title,status,params,evidence,author,published_by) VALUES($1,1,$2,$3,$4,$5,$6,'system:v2-build',$7)`,
      [rule.id, rule.kind, rule.title, status, JSON.stringify(rule.defaultParams), rule.evidence, status === "PUBLISHED" ? "system:v2-build" : null],
    );
    await tx.query(`INSERT INTO cf.rule_event(id,rule_id,version,from_status,to_status,actor,note) VALUES($1,$2,1,NULL,$3,'system:v2-build',$4)`, [
      uuid(), rule.id, status,
      rule.kind === "operational" ? "Workflow rule (no clinical threshold) published at build." : "Clinical candidate awaiting independent review. Runs only on sandbox sites.",
    ]);
  }
}
