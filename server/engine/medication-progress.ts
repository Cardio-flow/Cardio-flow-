// Descriptive dose comparisons only. These do not change treatment or rule eligibility.
import { DAILY_FREQUENCY as DAILY } from "../../shared/medication-exposure.js";
import { MEDICATION, doseLabel } from "../../shared/catalog.js";
import type { PatientState, MedState } from "../kernel/state.js";
import { hfPhenotype, targetDose } from "./guidelines.js";
import { daysBetween } from "../../shared/clinical.js";

// Frequency of the existing catalogue reference target. ESC HF 2021 Table 8;
// finerenone uses the existing patient-specific SmPC targetDose resolver.
const TARGET_FREQUENCY: Record<string, string> = {
  "sacubitril-valsartan": "BID",
  ramipril: "BID",
  lisinopril: "OD",
  candesartan: "OD",
  valsartan: "BID",
  losartan: "OD",
  enalapril: "BID",
  captopril: "TID",
  bisoprolol: "OD",
  carvedilol: "BID",
  "metoprolol-succinate": "OD",
  nebivolol: "OD",
  spironolactone: "OD",
  eplerenone: "OD",
  finerenone: "OD",
  dapagliflozin: "OD",
  empagliflozin: "OD",
  vericiguat: "OD",
};
export function hfDoseProgress(
  s: PatientState,
  m: Pick<
    MedState,
    "code" | "doseValue" | "doseUnit" | "frequency" | "route" | "status"
  >,
) {
  if (!hfPhenotype(s) || !TARGET_FREQUENCY[m.code]) return null;
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
  // ESC uses ramipril 5 mg BID (the catalogue stores the equivalent 10 mg daily target).
  const target = renalMissing
    ? null
    : m.code === "ramipril"
      ? 5
      : targetDose(s, m.code, def.target)!;
  const frequency = TARGET_FREQUENCY[m.code];
  const comparable =
    target != null &&
    m.doseValue != null &&
    Number.isFinite(m.doseValue) &&
    m.doseValue > 0 &&
    m.doseUnit === def.unit &&
    m.route === "PO" &&
    !!DAILY[m.frequency ?? ""];
  const percent = comparable
    ? Math.round(
        ((m.doseValue! * DAILY[m.frequency!]) / (target! * DAILY[frequency])) *
          100,
      )
    : null;
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
