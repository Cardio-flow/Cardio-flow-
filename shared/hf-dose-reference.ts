import { DAILY_FREQUENCY } from "./medication-exposure.js";

// Existing ESC HF catalogue reference regimens. Comparison only; never a dose recommendation.
const FREQUENCY: Record<string, string> = {
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
export function hfDoseReference(
  m: {
    code: string;
    doseValue: number | null;
    doseUnit?: string | null;
    frequency?: string | null;
    route?: string | null;
  },
  catalogueTarget: number | null,
  unit: string,
) {
  const frequency = FREQUENCY[m.code];
  if (!frequency) return null;
  // The catalogue's ramipril 10 mg/day is equivalent to the reference 5 mg BID.
  const target =
    catalogueTarget == null
      ? null
      : m.code === "ramipril"
        ? 5
        : catalogueTarget;
  const daily = DAILY_FREQUENCY[m.frequency ?? ""];
  const comparable =
    target != null &&
    target > 0 &&
    m.doseValue != null &&
    Number.isFinite(m.doseValue) &&
    m.doseValue > 0 &&
    m.doseUnit === unit &&
    m.route === "PO" &&
    !!daily;
  return {
    target,
    frequency,
    percent: comparable
      ? Math.round(
          ((m.doseValue! * daily) / (target! * DAILY_FREQUENCY[frequency])) *
            100,
        )
      : null,
  };
}
