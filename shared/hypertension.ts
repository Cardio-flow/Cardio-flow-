// ESC 2024 hypertension (ehae178): measurement-specific diagnostic thresholds.
// These identify a phenotype; they are not treatment targets or a diagnosis by themselves.
export type BpPair = { sbp: number; dbp: number; at: string; id: string };
export type HypertensionContext = {
  key: string;
  managementKey: string;
  newlyDiagnosed: boolean;
  apparentResistance: boolean;
  screeningIndicated: boolean;
  resistanceKey: string;
  office: BpPair | null;
  outside: (BpPair & { method: string; high: boolean; valid: boolean }) | null;
  phenotype: string;
  egfr: number | null;
  potassium: number | null;
  triple: boolean;
  treated: boolean;
  highRisk: boolean;
  secondaryClues: string[];
  secondary: { id: string; result: string } | null;
  pa: { id: string; result: string; reliable: boolean } | null;
  anatomy: { id: string; suitable: boolean } | null;
  resistance: Record<string, any> | null;
  rdnMissing: string[];
  rdnEligible: boolean;
  actual: { id: string; at: string; result: string } | null;
};
export const HTN_DIAGNOSIS_STATUS = [
  "Newly diagnosed",
  "Established",
  "Unknown",
] as const;
export type HypertensionDiagnosisStatus = (typeof HTN_DIAGNOSIS_STATUS)[number];
export const officeHigh = (p: BpPair | null) =>
  !!p && (p.sbp >= 140 || p.dbp >= 90);
export const severeBp = (p: BpPair | null) =>
  !!p && (p.sbp >= 180 || p.dbp >= 110);
export const HTN_MEASURES = [
  "sbp",
  "dbp",
  "egfr",
  "potassium",
  "creatinine",
  "uacr",
  "tsh",
  "calcium",
  "abpm-24-sbp",
  "abpm-24-dbp",
  "abpm-day-sbp",
  "abpm-day-dbp",
  "abpm-night-sbp",
  "abpm-night-dbp",
  "home-sbp",
  "home-dbp",
];
export const HTN_STUDY_PURPOSES = [
  "Primary aldosteronism screen",
  "Secondary hypertension review",
  "RDN anatomical assessment",
];

// ESC 2024: consider spironolactone 25–50 mg/day after confirmed resistant
// hypertension; restrict use to eGFR ≥30 and K ≤4.5, with close monitoring.
// Confirmation is tied to the current regimen/out-of-office BP, never inferred
// merely from having three medicines on the list.
export function resistantMraEligible(a: import("./wizards.js").Answers, c: import("./wizards.js").WizardContext) {
  const h = c.hypertension;
  const recent = (code: string) => {
    const v = c.values?.[code];
    const days = v ? (Date.parse(c.today) - Date.parse(v.at.slice(0,10))) / 86400000 : NaN;
    return !!v && Number.isFinite(v.value) && days >= 0 && days <= 30;
  };
  return a.basis === "resistant" && ["technique","adherence","doses"].every(k => a[k] === "yes") &&
    !!h?.triple && !!h.outside?.valid && h.outside.high && recent("egfr") && recent("potassium") &&
    c.values!.egfr.value >= 30 && c.values!.potassium.value <= 4.5 &&
    !c.meds.some(m => m.status !== "stopped" && m.tags.some(t => ["mra","potassium-sparing"].includes(t))) &&
    !c.dx?.some(d => ["pregnancy", "pregnancy-care"].includes(d));
}
