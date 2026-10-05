// Pulmonary hypertension (PH module, slice 1). 2022 ESC/ERS Guidelines for the diagnosis and treatment
// of pulmonary hypertension (Humbert et al., Eur Heart J 2022;43:3618), as reported in guideline
// summaries (Rev Esp Cardiol 2022 comments; echo reference tables):
//  - definitions: PH = mPAP >20 mmHg at rest; pre-capillary PH = PAWP ≤15 mmHg and PVR >2 WU; isolated
//    post-capillary PH = PAWP >15 mmHg and PVR ≤2 WU; combined post- and pre-capillary = PAWP >15 mmHg
//    and PVR >2 WU; exercise PH = mPAP/CO slope >3 mmHg/L/min between rest and exercise;
//  - echocardiographic probability: the peak TR velocity threshold >2.8 m/s (I C) with additional signs in
//    three categories — A ventricles (RV/LV basal diameter ratio >1.0; septal flattening), B pulmonary
//    artery (RVOT acceleration time <105 ms and/or mid-systolic notching; early diastolic PR velocity
//    >2.2 m/s; PA diameter >25 mm), C IVC and RA (IVC >21 mm with decreased inspiratory collapse; RA area
//    >18 cm²). Low: TRV ≤2.8 m/s (or not measurable) without signs; intermediate: TRV ≤2.8 with signs from
//    ≥2 categories, or 2.9–3.4 without; high: 2.9–3.4 with signs from ≥2 categories, or >3.4 m/s;
//  - referral to a PH centre for intermediate or high probability with risk factors for PAH or a history of
//    pulmonary embolism (I C).
export const PH_SIGNS = [
  { key: "rv-lv", label: "RV/LV basal diameter ratio >1.0", cat: "A" },
  { key: "septum", label: "Septal flattening", cat: "A" },
  { key: "rvot", label: "RVOT acceleration time <105 ms / mid-systolic notching", cat: "B" },
  { key: "pr", label: "Early diastolic PR velocity >2.2 m/s", cat: "B" },
  { key: "pa", label: "PA diameter >25 mm", cat: "B" },
  { key: "ivc", label: "IVC >21 mm with decreased collapse", cat: "C" },
  { key: "ra", label: "RA area >18 cm²", cat: "C" },
] as const;
export type PhProbability = "low" | "intermediate" | "high";
export function phEchoProbability(trv: number | null | undefined, signs: string[] | null | undefined) {
  const cats = [...new Set((signs ?? []).map((k) => PH_SIGNS.find((s) => s.key === k)?.cat).filter(Boolean))] as string[];
  const many = cats.length >= 2;
  let probability: PhProbability;
  if (trv != null && trv > 3.4) probability = "high";
  else if (trv != null && trv > 2.8) probability = many ? "high" : "intermediate";
  else probability = many ? "intermediate" : "low";
  return { probability, categories: cats, trv: trv ?? null };
}
export const PROBABILITY_LABEL: Record<PhProbability, string> = { low: "Low", intermediate: "Intermediate", high: "High" };

// PAH follow-up risk (PH module, slice 3): the ESC/ERS 2022 four-strata model, cut-offs confirmed in two
// sources (COMPERA 2.0 calculator; the guideline table as reprinted): functional class I–II = 1, III = 3,
// IV = 4; 6MWD >440 m = 1, 320–440 = 2, 165–319 = 3, <165 = 4; NT-proBNP <300 = 1, 300–649 = 2,
// 650–1100 = 3, >1100 ng/L = 4. The category is the mean of the available variables rounded to the
// nearest integer: 1 low, 2 intermediate-low, 3 intermediate-high, 4 high. Treatment goal: low risk.
export type Strata = "low" | "intermediate-low" | "intermediate-high" | "high";
export const STRATA_LABEL: Record<Strata, string> = { low: "Low", "intermediate-low": "Intermediate-low", "intermediate-high": "Intermediate-high", high: "High" };
export function fourStrata(x: { fc: string | null; sixmwd: number | null; ntprobnp: number | null }) {
  const items: { label: string; value: string; score: number }[] = [];
  const fc = x.fc ? x.fc.replace(/^NYHA\s*/i, "").trim() : null;
  if (fc === "I" || fc === "II") items.push({ label: "Functional class", value: fc, score: 1 });
  else if (fc === "III") items.push({ label: "Functional class", value: fc, score: 3 });
  else if (fc === "IV") items.push({ label: "Functional class", value: fc, score: 4 });
  if (x.sixmwd != null) items.push({ label: "6-minute walk", value: `${x.sixmwd} m`, score: x.sixmwd > 440 ? 1 : x.sixmwd >= 320 ? 2 : x.sixmwd >= 165 ? 3 : 4 });
  if (x.ntprobnp != null) items.push({ label: "NT-proBNP", value: `${x.ntprobnp} ng/L`, score: x.ntprobnp < 300 ? 1 : x.ntprobnp < 650 ? 2 : x.ntprobnp <= 1100 ? 3 : 4 });
  const missing = [!items.some((i) => i.label === "Functional class") && "functional class", x.sixmwd == null && "6-minute walk", x.ntprobnp == null && "NT-proBNP"].filter(Boolean) as string[];
  if (!items.length) return { items, missing, mean: null, category: null } as const;
  const mean = items.reduce((s, i) => s + i.score, 0) / items.length;
  const r = Math.round(mean);
  const category: Strata = r <= 1 ? "low" : r === 2 ? "intermediate-low" : r === 3 ? "intermediate-high" : "high";
  return { items, missing, mean: Math.round(mean * 100) / 100, category } as const;
}
