// Case import (14 Oct 2026 — Ahmed: "add those cases in real patients"): a patient's existing record —
// registration, problem list, past results, studies, procedures and current medicines — entered in one step
// from a structured case file, through the same kernel functions (and the same validation) as manual entry.
// One transaction: the whole case is recorded, or nothing is. Real patient unless the file says sample.
import { z } from "zod";
import type { Q } from "../db/db.js";
import { ApiError, journeyEvent, nowIso, today, type Actor } from "./base.js";
import * as K from "./clinical.js";
import { DIAGNOSIS, MEASURES, MEDICATION } from "../../shared/catalog.js";
import { STUDY } from "../../shared/studies.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const at = (d: string) => (d.length === 10 ? new Date(`${d}T09:00:00+03:00`).toISOString() : new Date(d).toISOString());

export const caseSchema = z.object({
  format: z.literal("cardioflow-case/1"),
  sample: z.boolean().optional(),
  patient: z.object({
    name: z.string().trim().min(2).max(120),
    mrn: z.string().trim().min(1).max(40),
    sex: z.enum(["Male", "Female"]),
    birthDate: day.optional(),
    age: z.number().int().min(1).max(120).optional(),
    civilId: z.string().regex(/^\d{12}$/).optional(),
    allergies: z.string().max(300).optional(),
  }),
  conditions: z.array(z.object({ code: z.string(), onset: day.optional(), onsetYear: z.number().int().min(1900).max(2100).optional(), attributes: z.record(z.string(), z.any()).optional() })).max(40).default([]),
  results: z.array(z.object({ date: day, items: z.array(z.object({ code: z.string(), value: z.number().optional(), text: z.string().max(40).optional(), unit: z.string().max(20).optional(), referenceHigh: z.number().positive().optional() })).min(1).max(40) })).max(40).default([]),
  echoes: z.array(z.object({ date: day, lvef: z.number().min(5).max(90), findings: z.array(z.string()).default([]), valves: z.record(z.string(), z.string()).optional(), conclusion: z.string().max(600).optional() })).max(10).default([]),
  studies: z.array(z.object({ kind: z.string(), date: day, findings: z.record(z.string(), z.any()), conclusion: z.string().max(600).optional() })).max(20).default([]),
  procedures: z.array(z.object({ kind: z.string(), date: day, details: z.record(z.string(), z.any()) })).max(20).default([]),
  medications: z.array(z.object({ code: z.string(), doseValue: z.number().positive().nullable(), frequency: z.string().max(60), route: z.string().max(20).optional(), indication: z.string().max(80).optional(), since: day.nullable().optional() })).max(40).default([]),
  note: z.string().max(4000).optional(),
});
export type CaseFile = z.infer<typeof caseSchema>;

// Check a case before anything is written: every code must exist in the catalogues (a clear message instead of
// a half-recorded patient).
export function checkCase(c: CaseFile) {
  const problems: string[] = [];
  for (const x of c.conditions) if (!DIAGNOSIS[x.code]) problems.push(`Unknown diagnosis: ${x.code}`);
  for (const r of c.results) for (const i of r.items) if (!MEASURES[i.code]) problems.push(`Unknown result: ${i.code}`);
  for (const s of c.studies) if (!STUDY[s.kind]) problems.push(`Unknown study: ${s.kind}`);
  for (const m of c.medications) if (!MEDICATION[m.code]) problems.push(`Unknown medicine: ${m.code}`);
  if (!c.patient.birthDate && !c.patient.age && !c.patient.civilId) problems.push("Give the date of birth, the age or the civil ID");
  return problems;
}

export async function importCase(tx: Q, actor: Actor, c: CaseFile) {
  const problems = checkCase(c);
  if (problems.length) throw new ApiError(400, problems.join(" · "));
  const p = c.patient;
  // an age without a date of birth gives an estimated date (as at registration)
  const estimated = !p.birthDate && !p.civilId && p.age != null;
  const birthDate = p.birthDate ?? (estimated ? `${Number(today().slice(0, 4)) - p.age!}-07-01` : undefined);
  const simple = c.conditions.filter((x) => !x.onset && !x.onsetYear && !x.attributes).map((x) => x.code);
  const detailed = c.conditions.filter((x) => x.onset || x.onsetYear || x.attributes);
  const { civilIdBirthDate } = await import("../../shared/civil-id.js");
  const id = await K.createPatient(tx, actor, {
    name: p.name, mrn: p.mrn, sex: p.sex, birthDate: birthDate ?? civilIdBirthDate(p.civilId)!, birthDateEstimated: estimated,
    allergies: p.allergies, civilId: p.civilId, conditions: simple, synthetic: c.sample === true,
  } as any);
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      throw new ApiError((e as any).status ?? 400, `${what}: ${(e as Error).message}`);
    }
  };
  if (detailed.length)
    await step("Diagnoses", () => K.recordHistory(tx, actor, id, { effectiveAt: nowIso(), add: detailed.map((x) => ({ code: x.code, onset: x.onset ?? null, onsetYear: x.onsetYear ?? null, attributes: x.attributes ?? {} })) as any }));
  // oldest first, so trends and baselines read in order
  for (const r of [...c.results].sort((a, b) => a.date.localeCompare(b.date)))
    await step(`Results ${r.date}`, () => K.recordObservations(tx, actor, id, { effectiveAt: at(r.date), items: r.items as any, source: "case import" }));
  for (const e of c.echoes)
    await step(`Echo ${e.date}`, () => K.recordEcho(tx, actor, id, { date: at(e.date), quality: "formal", lvef: e.lvef, findings: e.findings, valves: e.valves, conclusion: e.conclusion }));
  for (const s of c.studies)
    await step(`${STUDY[s.kind].short} ${s.date}`, () => K.recordStudy(tx, actor, id, { kind: s.kind, date: at(s.date), findings: s.findings, conclusion: s.conclusion }));
  for (const pr of c.procedures)
    await step(`Procedure ${pr.date}`, () => K.recordProcedure(tx, actor, id, { kind: pr.kind as any, date: at(pr.date), details: pr.details }));
  for (const m of c.medications) {
    const def = MEDICATION[m.code];
    await step(def.name, () => K.startMedication(tx, actor, id, {
      code: m.code, doseValue: m.doseValue, frequency: m.frequency, route: m.route ?? def.routes[0], indication: m.indication ?? "unspecified",
      effectiveAt: m.since ? at(m.since) : nowIso(), preexisting: !m.since,
    } as any));
  }
  if (c.note?.trim())
    await journeyEvent(tx, actor, { patientId: id, occurredAt: nowIso(), kind: "note", category: "visit", title: "History brought into CardioFlow", detail: c.note.trim().slice(0, 4000) });
  return id;
}
