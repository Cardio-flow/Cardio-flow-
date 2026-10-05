// HCM Risk-SCD (O'Mahony et al., Eur Heart J 2014;35:2010), the model the 2023 ESC cardiomyopathy
// guidelines recommend for the 5-year risk of sudden death in patients aged ≥16 years (I B). Equation
// checked in two independent publications of it (J Clin Med 2025;14:7355; Akhtar et al., Heart):
//   PI = 0.15939858·MWT − 0.00294271·MWT² + 0.0259082·LA + 0.00446131·LVOTmax + 0.4583082·FHx SCD
//        + 0.82639195·NSVT + 0.71650361·unexplained syncope − 0.01799934·age
//   P(SCD at 5 years) = 1 − 0.998^exp(PI)
// MWT and LA diameter in mm, LVOTmax = the maximal LVOT gradient at rest or with Valsalva (mmHg), age in
// years. ESC 2023 bands: ≥6% → ICD should be considered (IIa B); ≥4% to <6% → may be considered (IIb B);
// <4% → extensive LGE (≥15%) or LVEF <50% may be considered in shared decision-making (IIb B).
export type RiskScdInput = { age: number | null; mwt: number | null; la: number | null; lvot: number | null; fhx: boolean | null; nsvt: boolean | null; syncope: boolean | null };
export function hcmRiskScd(x: RiskScdInput) {
  const missing = [
    x.mwt == null && "maximal wall thickness", x.la == null && "LA diameter", x.lvot == null && "LVOT gradient (rest or Valsalva)",
    x.fhx == null && "family history of sudden death", x.nsvt == null && "NSVT on ambulatory ECG", x.syncope == null && "unexplained syncope", x.age == null && "age",
  ].filter(Boolean) as string[];
  if (missing.length) return { risk: null, band: null, missing } as const;
  if (x.age! < 16) return { risk: null, band: null, missing: ["age ≥16 years (HCM Risk-Kids applies below 16)"] } as const;
  const pi = 0.15939858 * x.mwt! - 0.00294271 * x.mwt! ** 2 + 0.0259082 * x.la! + 0.00446131 * x.lvot!
    + 0.4583082 * Number(x.fhx) + 0.82639195 * Number(x.nsvt) + 0.71650361 * Number(x.syncope) - 0.01799934 * x.age!;
  const risk = (1 - Math.pow(0.998, Math.exp(pi))) * 100;
  const r = Math.round(risk * 10) / 10;
  return { risk: r, band: r >= 6 ? "high" : r >= 4 ? "intermediate" : "low", missing: [] as string[] } as const;
}
export const RISK_BAND_TEXT: Record<string, string> = {
  high: "≥6%: an ICD should be considered (IIa B)",
  intermediate: "4 to <6%: an ICD may be considered (IIb B)",
  low: "<4%: extensive LGE (≥15%) or LVEF <50% may be considered in shared decision-making (IIb B)",
};
