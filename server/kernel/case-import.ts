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
import { ADMISSION_REASONS, DISCHARGE_CONDITION, DISCHARGE_DESTINATION, IN_HOSPITAL_EVENTS } from "../../shared/encounters.js";
import { ADMISSION_HISTORY_SOURCES } from "../../shared/admission-history.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
// a report that gives only the month ("echo 5/2026"): YYYY-MM, kept as the 15th and marked as month-only
const dayOrMonth = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Use YYYY-MM-DD, or YYYY-MM when only the month is known");
const at = (d: string) => (d.length === 7 ? new Date(`${d}-15T09:00:00+03:00`).toISOString() : d.length === 10 ? new Date(`${d}T09:00:00+03:00`).toISOString() : new Date(d).toISOString());
const monthOnly = (d: string) => d.length === 7;

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
  // valueHigh: the upper number of a reported range ("EF 35–40%"); value is the lower and the one rules use
  results: z.array(z.object({ date: dayOrMonth, items: z.array(z.object({ code: z.string(), value: z.number().optional(), valueHigh: z.number().optional(), text: z.string().max(40).optional(), unit: z.string().max(20).optional(), referenceHigh: z.number().positive().optional() })).min(1).max(40) })).max(40).default([]),
  echoes: z.array(z.object({ date: dayOrMonth, lvef: z.number().min(5).max(90), lvefHigh: z.number().min(5).max(90).optional(), findings: z.array(z.string()).default([]), valves: z.record(z.string(), z.string()).optional(), conclusion: z.string().max(600).optional(),
    chambers: z.object({ la: z.enum(["Normal", "Mild", "Moderate", "Severe"]).optional(), ra: z.enum(["Normal", "Mild", "Moderate", "Severe"]).optional(), diastolic: z.enum(["Normal", "Grade I", "Grade II", "Grade III", "Indeterminate"]).optional() }).optional() })).max(10).default([]),
  studies: z.array(z.object({ kind: z.string(), date: dayOrMonth, findings: z.record(z.string(), z.any()), conclusion: z.string().max(600).optional() })).max(20).default([]),
  procedures: z.array(z.object({ kind: z.string(), date: day, details: z.record(z.string(), z.any()) })).max(20).default([]),
  medications: z.array(z.object({ code: z.string(), doseValue: z.number().positive().nullable(), frequency: z.string().max(60), route: z.string().max(20).optional(), indication: z.string().max(80).optional(), since: day.nullable().optional() })).max(40).default([]),
  // 20 Oct 2026 (real clinic list): past admissions from discharge summaries and the dated plan
  // (e.g. tomorrow's clinic review, a pending test) come in with the case
  admissions: z.array(z.object({
    startedOn: day, endedOn: day, location: z.string().max(80).default(""), reasons: z.array(z.string()).min(1).max(6),
    source: z.string().default("Discharge summary"), narrative: z.string().max(4000).default(""), events: z.array(z.string()).max(20).default([]),
    dischargeStatus: z.string().default(""), destination: z.string().default(""), reportedLabs: z.string().max(4000).default(""), reportedMedications: z.string().max(4000).default(""),
  })).max(15).default([]),
  // medicines outside the catalogue, as written (lactulose, cetirizine…)
  otherMedications: z.array(z.object({ name: z.string().trim().min(2).max(120), dose: z.string().max(60).default(""), frequency: z.string().max(60).default(""), note: z.string().max(300).default("") })).max(30).default([]),
  plan: z.array(z.object({
    category: z.enum(["medication", "investigation", "monitoring", "follow_up", "referral", "procedure", "education", "other"]),
    title: z.string().trim().min(2).max(160), dueDate: day.nullable(), reason: z.string().max(300).optional(),
  })).max(20).default([]),
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
  for (const a of c.admissions) {
    for (const r of a.reasons) if (!ADMISSION_REASONS.includes(r)) problems.push(`Admission ${a.startedOn}: unknown reason "${r}"`);
    for (const e of a.events) if (!IN_HOSPITAL_EVENTS.includes(e)) problems.push(`Admission ${a.startedOn}: unknown event "${e}"`);
    if (a.dischargeStatus && !DISCHARGE_CONDITION.includes(a.dischargeStatus)) problems.push(`Admission ${a.startedOn}: unknown condition at discharge`);
    if (a.destination && !DISCHARGE_DESTINATION.includes(a.destination)) problems.push(`Admission ${a.startedOn}: unknown destination`);
    if (!(ADMISSION_HISTORY_SOURCES as readonly string[]).includes(a.source)) problems.push(`Admission ${a.startedOn}: unknown source`);
    if (a.endedOn < a.startedOn) problems.push(`Admission ${a.startedOn}: discharge before admission`);
  }
  for (const p of c.plan) if (p.dueDate && p.dueDate < today()) problems.push(`Plan "${p.title}": choose today or a later date`);
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
    await step(`Results ${r.date}`, () => K.recordObservations(tx, actor, id, { effectiveAt: at(r.date), items: r.items as any, source: monthOnly(r.date) ? "case import · month only" : "case import" }));
  for (const e of c.echoes)
    await step(`Echo ${e.date}`, () => K.recordEcho(tx, actor, id, { date: at(e.date), datePrecision: monthOnly(e.date) ? "month" : undefined, quality: "formal", lvef: e.lvef, lvefHigh: e.lvefHigh ?? null, findings: e.findings, valves: e.valves, conclusion: e.conclusion, chambers: e.chambers }));
  for (const s of c.studies)
    await step(`${STUDY[s.kind].short} ${s.date}`, () => K.recordStudy(tx, actor, id, { kind: s.kind, date: at(s.date), datePrecision: monthOnly(s.date) ? "month" : undefined, findings: s.findings, conclusion: s.conclusion }));
  for (const pr of c.procedures)
    await step(`Procedure ${pr.date}`, () => K.recordProcedure(tx, actor, id, { kind: pr.kind as any, date: at(pr.date), details: pr.details }));
  for (const m of c.medications) {
    const def = MEDICATION[m.code];
    await step(def.name, () => K.startMedication(tx, actor, id, {
      code: m.code, doseValue: m.doseValue, frequency: m.frequency, route: m.route ?? def.routes[0], indication: m.indication ?? "unspecified",
      effectiveAt: m.since ? at(m.since) : nowIso(), preexisting: !m.since,
    } as any));
  }
  for (const a of [...c.admissions].sort((x, y) => x.startedOn.localeCompare(y.startedOn)))
    await step(`Admission ${a.startedOn}`, async () => {
      const { recordPastAdmission } = await import("./context-management.js");
      await recordPastAdmission(tx, actor, id, { ...a, note: "", draftVersion: 0 } as any);
    });
  for (const o of c.otherMedications)
    await step(`Other medicine ${o.name}`, () => K.recordOtherMedicine(tx, actor, id, o));
  for (const item of c.plan)
    await step(`Plan: ${item.title}`, () => K.addPlanAction(tx, actor, id, { category: item.category, title: item.title, dueDate: item.dueDate, reason: item.reason } as any));
  if (c.note?.trim())
    await journeyEvent(tx, actor, { patientId: id, occurredAt: nowIso(), kind: "note", category: "visit", title: "History brought into CardioFlow", detail: c.note.trim().slice(0, 4000) });
  return id;
}
