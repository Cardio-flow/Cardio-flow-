// Risk-factor hints in the History drawer, read from the record (moved out of src/drawers/History.tsx on
// 10 Nov 2026, unchanged: the screen shows a hint, it does not decide what counts as one).
import { MEDICATION } from "./catalog.js";

// Hints from the record (never answers): guideline diagnostic values and the medicines the patient takes.
//  - diabetes: HbA1c ≥6.5% (ADA 2026 / ESC 2023 diagnostic threshold) or a glucose-lowering medicine
//  - obesity: BMI ≥30 kg/m² (WHO)
//  - CKD: eGFR <60 (KDIGO 2024), with the G stage preselected
//  - hypertension: a blood-pressure medicine; dyslipidaemia: a lipid-lowering medicine
export type Hint = { text: string; code?: string };
const KDIGO = (e: number) => (e >= 45 ? "ckd-3a" : e >= 30 ? "ckd-3b" : e >= 15 ? "ckd-4" : "ckd-5");
export function riskHints(s: any, bmi?: { value: number } | null): Record<string, Hint> {
  if (!s) return {};
  const out: Record<string, Hint> = {};
  const res = (code: string) => s.results?.find((r: any) => r.code === code)?.current?.value as number | undefined;
  const meds: { name: string; code: string }[] = (s.medications?.groups ?? []).flatMap((g: any) => g.meds);
  const on = (pred: (d: any) => boolean) => meds.filter((m) => MEDICATION[m.code] && pred(MEDICATION[m.code])).map((m) => m.name);
  const a1c = res("hba1c");
  const dm = on((d) => d.tags.some((t: string) => ["metformin", "insulin", "sulfonylurea", "dpp4", "tzd"].includes(t)));
  if ((a1c != null && a1c >= 6.5) || dm.length) out.diabetes = { text: [a1c != null && a1c >= 6.5 ? `HbA1c ${a1c}%` : null, dm.length ? `on ${dm.join(", ").toLowerCase()}` : null].filter(Boolean).join(" · "), code: "t2dm" };
  const egfr = res("egfr");
  if (egfr != null && egfr < 60) out.ckd = { text: `eGFR ${Math.round(egfr)}`, code: KDIGO(egfr) };
  const bp = on((d) => d.purpose === "Blood pressure");
  if (bp.length) out.hypertension = { text: `on ${bp.join(", ").toLowerCase()}` };
  //  - obesity: BMI ≥30 kg/m² (WHO)
  if (bmi && bmi.value >= 30) out.obesity = { text: `BMI ${bmi.value.toFixed(1)}` };
  const lip = on((d) => d.tags.includes("lipid"));
  if (lip.length) out.dyslipidaemia = { text: `on ${lip.join(", ").toLowerCase()}` };
  return out;
}
