// Rule governance: maker/checker. Only PUBLISHED versions affect production patients.
import type { Q } from "../db/db.js";
import { ApiError, audit, uuid, type Actor } from "../kernel/base.js";
import { RULE } from "./rules.js";

const ALLOWED: Record<string, { to: string; roles: Actor["role"][] }[]> = {
  DRAFT: [{ to: "CLINICAL_REVIEW", roles: ["admin", "reviewer"] }, { to: "RETIRED", roles: ["admin"] }],
  CLINICAL_REVIEW: [{ to: "APPROVED", roles: ["reviewer"] }, { to: "DRAFT", roles: ["reviewer", "admin"] }],
  APPROVED: [{ to: "PUBLISHED", roles: ["admin"] }, { to: "DRAFT", roles: ["admin", "reviewer"] }],
  PUBLISHED: [{ to: "RETIRED", roles: ["admin"] }],
  RETIRED: [],
};

export async function listRules(tx: Q) {
  const versions = (await tx.query(`SELECT * FROM cf.rule_version ORDER BY rule_id, version DESC`)).rows;
  const events = (await tx.query(`SELECT * FROM cf.rule_event ORDER BY at DESC`)).rows;
  return versions.map((v: any) => ({
    ...v,
    inputs: RULE[v.rule_id]?.inputs ?? [],
    history: events.filter((e: any) => e.rule_id === v.rule_id && e.version === v.version),
  }));
}

export async function transitionRule(tx: Q, actor: Actor, ruleId: string, version: number, to: string, note: string) {
  const cur = (await tx.query(`SELECT * FROM cf.rule_version WHERE rule_id=$1 AND version=$2`, [ruleId, version])).rows[0];
  if (!cur) throw new ApiError(404, "Rule version not found");
  const step = ALLOWED[cur.status]?.find((s) => s.to === to);
  if (!step) throw new ApiError(409, `A ${cur.status} rule cannot move to ${to}`);
  if (!step.roles.includes(actor.role)) throw new ApiError(403, "Your role cannot make this change");
  if (to === "APPROVED" && cur.author === actor.id) throw new ApiError(403, "The author of a rule cannot approve it. Another clinician must review it.");
  if (to === "PUBLISHED" && cur.reviewer === actor.id) throw new ApiError(403, "The clinical reviewer cannot also publish. A separate administrator publishes.");
  if (to === "APPROVED" && !note.trim()) throw new ApiError(400, "Record the review note: source checked, boundaries tested, decision");
  if (to === "PUBLISHED")
    await tx.query(`UPDATE cf.rule_version SET status='RETIRED', updated_at=now() WHERE rule_id=$1 AND status='PUBLISHED'`, [ruleId]);
  await tx.query(
    `UPDATE cf.rule_version SET status=$3, updated_at=now(),
      reviewer = CASE WHEN $3='APPROVED' THEN $4 ELSE reviewer END,
      review_note = CASE WHEN $3='APPROVED' THEN $5 ELSE review_note END,
      published_by = CASE WHEN $3='PUBLISHED' THEN $4 ELSE published_by END
     WHERE rule_id=$1 AND version=$2`,
    [ruleId, version, to, actor.id, note],
  );
  await tx.query(`INSERT INTO cf.rule_event(id,rule_id,version,from_status,to_status,actor,note) VALUES($1,$2,$3,$4,$5,$6,$7)`, [
    uuid(), ruleId, version, cur.status, to, actor.id, note,
  ]);
  await audit(tx, actor, "rule-" + to.toLowerCase(), "rule_version", `${ruleId}@${version}`, null, { note });
}

export async function draftRule(tx: Q, actor: Actor, ruleId: string, params: Record<string, number | string>, evidence: string) {
  if (!["admin", "reviewer"].includes(actor.role)) throw new ApiError(403, "Your role cannot author rules");
  const def = RULE[ruleId];
  if (!def) throw new ApiError(404, "Unknown rule");
  for (const k of Object.keys(params)) if (!(k in def.defaultParams)) throw new ApiError(400, `Unknown parameter ${k}`);
  const latest = (await tx.query(`SELECT * FROM cf.rule_version WHERE rule_id=$1 ORDER BY version DESC LIMIT 1`, [ruleId])).rows[0];
  const version = (latest?.version ?? 0) + 1;
  await tx.query(`INSERT INTO cf.rule_version(rule_id,version,kind,title,status,params,evidence,author) VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7)`, [
    ruleId, version, def.kind, def.title, JSON.stringify({ ...(latest?.params ?? {}), ...params }), evidence || latest?.evidence || "", actor.id,
  ]);
  await tx.query(`INSERT INTO cf.rule_event(id,rule_id,version,from_status,to_status,actor,note) VALUES($1,$2,$3,NULL,'DRAFT',$4,'New draft')`, [uuid(), ruleId, version, actor.id]);
  return version;
}
