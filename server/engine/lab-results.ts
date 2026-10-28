import type { PatientState } from "../kernel/state.js";
import { defaultUln, type LabReview } from "../../shared/lab-review.js";
export function labResults(s: PatientState): LabReview {
  const out: LabReview = {};
  for (const code of [
    "vitamin-d",
    "calcium",
    "egfr",
    "haemoglobin",
    "mcv",
    "ferritin",
    "tsat",
    "b12",
    "folate",
    "alt",
    "ast",
    "ck",
    "bilirubin",
    "alp",
    "lvef",
  ]) {
    const o = s.resolved(code).current;
    if (o?.status === "final" && o.value_num != null)
      out[code] = {
        id: o.id,
        value: o.value_num,
        at: o.effective_at,
        referenceHigh: o.reference_high ?? defaultUln(code, s.patient.sex),
      };
  }
  return out;
}
