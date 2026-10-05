// Medicine monitoring schedules (medication coverage, slice 2): what to check after a medicine is started
// (or its dose changed) and how often while it continues. Read by the medicine drawer (books the checks
// when the medicine is started) and by the rule `med.monitoring` (a check that is due with no result and
// nothing booked). Every interval is the product label's (UK/EU SmPC, section given) or a guideline's /
// ESC practical guide's own; no locally chosen interval. A result recorded at any time after the previous
// check point counts for the next one.
//  - after: days after the start (on: "start") or after any start, restart or dose increase (on: "change");
//  - every: the interval once the "after" checks are past (null = no fixed interval in the source);
//  - when: the schedule applies only in this situation (e.g. ticagrelor after an ACS).
export type MonContext = { age: number; crcl: number | null; egfr: number | null; lvef: number | null; hf: boolean; acs: boolean; daysOnDrug: number; daysSinceChange: number };
export type MonTarget = { lab: string[] } | { study: "echo" | "ecg" };
export type MonCheck = {
  id: string;
  what: string; // "Potassium and creatinine"
  target: MonTarget;
  after?: number[];
  on?: "start" | "change";
  every?: (c: MonContext) => number | null;
  when?: (c: MonContext) => boolean;
  schedule: string; // the schedule in words, as the source gives it
  source: string;
};
export type MonSchedule = { drugs: string[]; checks: MonCheck[] }; // drugs: catalogue codes or tags

const MONTH = 30;
export const DRUG_MONITORING: MonSchedule[] = [
  {
    drugs: ["amiodarone"],
    checks: [
      { id: "amiodarone-alt", what: "Liver function (transaminases)", target: { lab: ["alt"] }, every: () => 182, schedule: "before treatment and every 6 months", source: "SmPC amiodarone 4.4" },
      // TSH: before treatment and every 6 months; a missing TSH is already flagged by event.amiodarone-thyroid
      { id: "amiodarone-tsh", what: "TSH", target: { lab: ["tsh"] }, every: () => 182, schedule: "before treatment, every 6 months and for several months after stopping", source: "SmPC amiodarone 4.3/4.4" },
    ],
  },
  {
    drugs: ["dronedarone"],
    checks: [
      { id: "dronedarone-lft", what: "Liver function tests", target: { lab: ["alt"] }, on: "start", after: [7, 30, 61, 91, 122, 152, 182, 273, 365], schedule: "before, after 1 week and 1 month, then monthly for 6 months, at months 9 and 12, then periodically", source: "SmPC dronedarone (Multaq) 4.4" },
      { id: "dronedarone-creatinine", what: "Creatinine", target: { lab: ["creatinine"] }, on: "start", after: [7], schedule: "before and 7 days after initiation", source: "SmPC dronedarone (Multaq) 4.4" },
    ],
  },
  {
    drugs: ["sotalol"],
    checks: [
      { id: "sotalol-qtc", what: "ECG with QTc", target: { study: "ecg" }, on: "change", after: [3], schedule: "at initiation and each dose change (2–3 days between increments to monitor the QT interval)", source: "SmPC sotalol 4.2" },
    ],
  },
  {
    drugs: ["doac"],
    checks: [
      {
        id: "doac-bloods", what: "Haemoglobin, renal and liver function", target: { lab: ["haemoglobin", "creatinine", "alt"] },
        every: (c) => Math.min(365, c.age >= 75 ? 122 : 365, c.crcl != null && c.crcl <= 60 ? Math.round((c.crcl / 10) * 30.4) : 365),
        schedule: "yearly; every 4 months at age ≥75 or frail; with CrCl ≤60 mL/min every CrCl/10 months",
        source: "EHRA practical guide on NOACs 2021, Table 3",
      },
    ],
  },
  {
    drugs: ["metformin"],
    checks: [
      { id: "metformin-egfr", what: "Renal function (eGFR)", target: { lab: ["creatinine"] }, every: (c) => (c.egfr != null && c.egfr < 60 ? 182 : 365), schedule: "at least annually; every 3–6 months with eGFR <60", source: "SmPC metformin 4.2; KDIGO 2022 diabetes in CKD, practice point 4.1.2" },
    ],
  },
  {
    drugs: ["eplerenone"],
    checks: [
      { id: "eplerenone-k", what: "Potassium", target: { lab: ["potassium"] }, on: "change", after: [7, 30], schedule: "within the first week and at one month after a start or dose change", source: "SmPC eplerenone (Inspra) 4.2" },
    ],
  },
  {
    drugs: ["spironolactone"],
    checks: [
      {
        id: "spironolactone-k", what: "Potassium and creatinine", target: { lab: ["potassium", "creatinine"] }, on: "change", after: [7, 30, 61, 91],
        every: (c) => (c.daysSinceChange <= 91 + 365 ? 91 : 182), when: (c) => c.hf,
        schedule: "1 week after a start or increase, monthly for 3 months, quarterly for a year, then every 6 months (heart failure)",
        source: "SmPC spironolactone (Aldactone) 4.2",
      },
    ],
  },
  {
    drugs: ["finerenone"],
    checks: [
      { id: "finerenone-k", what: "Potassium and eGFR", target: { lab: ["potassium", "creatinine"] }, on: "change", after: [28], schedule: "4 weeks after a start, restart or dose increase", source: "SmPC finerenone (Kerendia) 4.2" },
    ],
  },
  {
    drugs: ["ticagrelor"],
    checks: [
      { id: "ticagrelor-renal", what: "Renal function", target: { lab: ["creatinine"] }, on: "start", after: [30], when: (c) => c.acs, schedule: "one month after starting, in ACS", source: "SmPC ticagrelor (Brilique) 4.4" },
    ],
  },
  {
    drugs: ["statin", "ezetimibe", "pcsk9", "bempedoic-acid"],
    checks: [
      { id: "lipids-after-change", what: "LDL-C", target: { lab: ["ldl-c"] }, on: "change", after: [42], schedule: "4–6 weeks after starting or intensifying lipid-lowering therapy", source: "ESC/EAS 2025 focused update (as in 2019)" },
    ],
  },
  {
    drugs: ["bosentan"],
    checks: [
      { id: "bosentan-alt", what: "Liver aminotransferases", target: { lab: ["alt"] }, every: () => MONTH, schedule: "before treatment, monthly, and 2 weeks after any dose increase", source: "SmPC bosentan (Tracleer) 4.2/4.4" },
      { id: "bosentan-hb", what: "Haemoglobin", target: { lab: ["haemoglobin"] }, every: (c) => (c.daysOnDrug <= 4 * MONTH ? MONTH : 91), schedule: "before treatment, monthly for 4 months, then quarterly", source: "SmPC bosentan (Tracleer) 4.4" },
    ],
  },
  {
    drugs: ["macitentan"],
    checks: [
      { id: "macitentan-alt", what: "ALT and AST", target: { lab: ["alt"] }, every: () => MONTH, schedule: "before treatment and monthly", source: "SmPC macitentan (Opsumit) 4.4" },
    ],
  },
  {
    drugs: ["ambrisentan"],
    checks: [
      { id: "ambrisentan-alt", what: "ALT and AST", target: { lab: ["alt"] }, every: () => MONTH, schedule: "before treatment and monthly", source: "SmPC ambrisentan (Volibris) 4.4" },
      { id: "ambrisentan-hb", what: "Haemoglobin", target: { lab: ["haemoglobin"] }, on: "start", after: [30, 91], schedule: "at 1 month and 3 months, then periodically", source: "SmPC ambrisentan (Volibris) 4.4" },
    ],
  },
  {
    drugs: ["mavacamten"],
    checks: [
      {
        id: "mavacamten-echo", what: "Echo (LVEF, LVOT gradient with Valsalva)", target: { study: "echo" }, on: "start", after: [28, 56],
        every: (c) => (c.lvef == null ? null : c.lvef >= 55 ? 182 : c.lvef >= 50 ? 91 : null),
        schedule: "4 and 8 weeks after starting; then every 6 months with LVEF ≥55%, every 3 months with LVEF 50–<55%",
        source: "SmPC mavacamten (Camzyos) 4.2",
      },
    ],
  },
];

export const monitoringFor = (code: string, tags: string[]) => DRUG_MONITORING.filter((s) => s.drugs.includes(code) || s.drugs.some((d) => tags.includes(d))).flatMap((s) => s.checks);
export const targetCodes = (t: MonTarget) => ("lab" in t ? t.lab : []);

// the checks to book when a medicine is started today: each "after" point, or the first periodic check
export function bookingsAtStart(code: string, tags: string[], c: MonContext) {
  const out: { check: MonCheck; days: number }[] = [];
  for (const k of monitoringFor(code, tags)) {
    if (k.when && !k.when(c)) continue;
    if (k.after?.length) for (const d of k.after) out.push({ check: k, days: d });
    else {
      const e = k.every?.(c);
      if (e) out.push({ check: k, days: e });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
