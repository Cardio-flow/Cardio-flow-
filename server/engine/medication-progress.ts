// Descriptive dose comparisons only. These do not change treatment or rule eligibility.
import { hfDoseReference } from "../../shared/hf-dose-reference.js";
import { MEDICATION, doseLabel } from "../../shared/catalog.js";
import type { PatientState, MedState } from "../kernel/state.js";
import { hfPhenotype, targetDose } from "./guidelines.js";
import { daysBetween } from "../../shared/clinical.js";

export function hfDoseProgress(
  s: PatientState,
  m: Pick<
    MedState,
    "code" | "doseValue" | "doseUnit" | "frequency" | "route" | "status"
  >,
) {
  if(s.conditions.some(c=>c.code === "pregnancy-care" && (c.attributes.phase === "Pregnant" || c.attributes.phase === "Postpartum" && c.attributes.breastfeeding!=="No")))return null;
  if (!hfPhenotype(s)) return null;
  const def = MEDICATION[m.code];
  if (!def?.target) return null;
  // Do not infer a renal-dependent target from missing renal data.
  const renal = s.resolved("egfr").current;
  const renalMissing =
    m.code === "finerenone" &&
    (renal?.status !== "final" ||
      renal.value_num == null ||
      daysBetween(renal.effective_at, s.today) > 365 ||
      daysBetween(renal.effective_at, s.today) < 0);
  const comparison=hfDoseReference(m, renalMissing ? null : targetDose(s,m.code,def.target) ?? null, def.unit);
  if (!comparison) return null;
  const {percent,target,frequency}=comparison;
  return {
    percent,
    target:
      target != null
        ? `${doseLabel(def, target, def.unit)} ${frequency}`
        : null,
    status: m.status,
    note: renalMissing
      ? "Renal result needed"
      : percent == null
        ? "Dose / regimen not comparable"
        : null,
    source:
      m.code === "finerenone"
        ? "Kerendia SmPC · renal-dependent HF reference"
        : "ESC HF 2021 Table 8 · existing catalogue reference",
  };
}
