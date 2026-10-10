import type { PatientState } from "../kernel/state.js";
// A readiness decision covers the facts reviewed at that time, not later corrected data.
export const STRUCTURAL_INPUTS = [
  "lvef",
  "lvesd",
  "spap",
  "nyha",
  "ava",
  "av-vmax",
  "av-mg",
  "nt-probnp",
  "bnp",
  "creatinine",
  "haemoglobin",
];
export function structuralEvidenceKey(s: PatientState) {
  return JSON.stringify({
    studies: s.studies
      .filter((st) => ["echo", "structural_imaging"].includes(st.kind))
      .map((st) => st.id),
    rhc: s.procedures.filter((p) => p.kind === "rhc").map((p) => p.id),
    values: STRUCTURAL_INPUTS.map(
      (code) => s.resolved(code).current?.id ?? null,
    ),
    conditions: s.conditions.map((c) => c.id),
    medicines: s.meds.map((m) => [m.id, m.status, m.doseValue, m.frequency]),
    admissions: s.contexts
      .filter((c) => c.kind === "admission")
      .map((c) => [c.id, c.version, c.status]),
  });
}
