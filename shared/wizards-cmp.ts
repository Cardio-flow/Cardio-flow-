// Cardiomyopathy pathways (cardiomyopathy module, slice 2). Content only; the one wizard engine renders
// them. Recommendations of the 2023 ESC Guidelines for the management of cardiomyopathies, as reported
// verbatim (with class and level) in the guideline tables and the EHJ-QCCO 2025 systematic review of HCM
// guidelines:
//  - SCD: HCM Risk-SCD at first evaluation and every 1–2 years or when the clinical status changes, aged
//    ≥16 (I B); ICD should be considered at ≥6% (IIa B); may be considered at ≥4% to <6% (IIb B); <4%:
//    extensive LGE (≥15%) or LVEF <50% may be considered in shared decision-making (IIb B); LV apical
//    aneurysm: decide on the HCM Risk-SCD assessment (IIa B).
//  - LVOTO: non-vasodilating beta-blockers titrated to the maximum tolerated dose, first line (I B);
//    verapamil or diltiazem if a beta-blocker cannot be taken (I B); disopyramide added to a beta-blocker
//    (I B); mavacamten should be considered (IIa A), or as monotherapy (IIa B); septal reduction for a
//    resting or maximal provoked gradient ≥50 mmHg in NYHA III–IV despite maximum tolerated medical
//    therapy (I B), by experienced operators in a multidisciplinary team (I C).
// CardioFlow plans these steps; it does not dose disopyramide or mavacamten (specialist start).
import type { Answers, Assessment, OutcomeItem, WizardContext, WizardDef } from "./wizards.js";
import { RISK_BAND_TEXT, hcmRiskScd } from "./cmp.js";

const REVIEW = [
  { value: "none", label: "No extra visit" },
  { value: "clinic-28", label: "Clinic · 4 weeks" },
  { value: "clinic-90", label: "Clinic · 3 months" },
];
const manual = { type: "manual" };
const YN = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export const lvotMax = (ctx: WizardContext) => {
  const r = ctx.values?.["lvot-rest"]?.value ?? null, p = ctx.values?.["lvot-provoked"]?.value ?? null;
  return r == null && p == null ? null : Math.max(r ?? 0, p ?? 0);
};
export const riskFor = (a: Answers, ctx: WizardContext) => hcmRiskScd({
  age: ctx.profile?.age ?? null, mwt: ctx.values?.mwt?.value ?? null, la: ctx.values?.["la-diam"]?.value ?? null, lvot: lvotMax(ctx),
  fhx: a.fhx ? a.fhx === "yes" : null, nsvt: a.nsvt === "yes" ? true : a.nsvt === "no" ? false : null, syncope: a.syncope ? a.syncope === "yes" : null,
});
// the 2023 modifiers shown next to the number
export const riskModifiers = (ctx: WizardContext) => {
  const lge = ctx.values?.["lge-extent"]?.value ?? null, ef = ctx.values?.lvef?.value ?? null;
  return [
    lge != null && lge >= 15 && `extensive LGE (${lge}%)`,
    ef != null && ef < 50 && `LVEF ${ef}%`,
    (ctx.cmp?.echoFindings ?? []).includes("LV apical aneurysm") && "LV apical aneurysm",
  ].filter(Boolean) as string[];
};

export const CMP_WIZARDS: Record<string, WizardDef> = {
  "hcm-scd": {
    id: "hcm-scd", title: "HCM: sudden death risk and ICD decision", tone: "orange", group: "Cardiomyopathy", episode: false,
    source: "ESC cardiomyopathies 2023",
    note: "HCM Risk-SCD uses age, maximal wall thickness, LA diameter, the maximal LVOT gradient at rest or with Valsalva (from the record) and three answers below. Valid from 16 years; repeat every 1–2 years or when the clinical picture changes.",
    facts: ["mwt", "la-diam", "lvot-rest", "lvot-provoked", "lge-extent", "lvef"],
    steps: [
      {
        id: "factors", title: "Risk factors",
        questions: [
          { id: "fhx", label: "Family history of sudden cardiac death", help: "A first-degree relative who died suddenly (HCM Risk-SCD definition)", type: "single", required: true, options: YN },
          { id: "nsvt", label: "Non-sustained VT on ambulatory ECG", type: "single", required: true, options: [...YN, { value: "not-done", label: "No ambulatory ECG yet" }] },
          { id: "syncope", label: "Unexplained syncope", type: "single", required: true, options: YN },
        ],
      },
      {
        id: "decision", title: "Decision",
        questions: [
          {
            id: "decision", label: "ICD", type: "single", required: true,
            options: [
              { value: "icd", label: "ICD for primary prevention", effects: { plan: [{ category: "referral", title: "ICD implantation (primary prevention, HCM)", days: 30, completesOn: manual }] } },
              { value: "discuss", label: "Shared decision: discuss again", effects: { plan: [{ category: "follow_up", title: "HCM: ICD discussion (shared decision-making)", days: 30, completesOn: { type: "visit" } }] } },
              { value: "no-icd", label: "No ICD now; reassess the risk", effects: { plan: [{ category: "follow_up", title: "HCM: sudden death risk reassessment", days: 365, completesOn: manual }] } },
            ],
          },
          {
            id: "tests", label: "Tests to complete the assessment", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "holter", label: "Ambulatory ECG 24–48 h", effects: { plan: [{ category: "investigation", title: "Ambulatory ECG 24–48 h (HCM, NSVT)", days: 14, completesOn: { type: "study", kind: "holter" } }] } },
              { value: "cmr", label: "Cardiac MRI with LGE", effects: { plan: [{ category: "investigation", title: "Cardiac MRI with contrast (cardiomyopathy)", days: 28, completesOn: { type: "study", kind: "cmr" } }] } },
              { value: "echo", label: "Echo with LVOT gradient at rest and Valsalva", effects: { plan: [{ category: "investigation", title: "Echo: LVOT gradient at rest and provoked (Valsalva, standing)", days: 14, completesOn: { type: "study", kind: "echo" } }] } },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
  "hcm-lvoto": {
    id: "hcm-lvoto", title: "Obstructive HCM: symptoms and LVOT obstruction", tone: "orange", group: "Cardiomyopathy", episode: false,
    source: "ESC cardiomyopathies 2023",
    note: "Non-vasodilating beta-blocker first, to the maximum tolerated dose; verapamil or diltiazem if a beta-blocker cannot be taken; then disopyramide or mavacamten; septal reduction for NYHA III–IV with a gradient ≥50 mmHg despite maximum tolerated therapy.",
    facts: ["lvot-rest", "lvot-provoked", "mwt", "lvef", "sbp", "hr"],
    steps: [
      {
        id: "now", title: "Symptoms & therapy",
        questions: [
          {
            id: "nyha", label: "Symptoms", type: "single", required: true,
            options: [{ value: "I", label: "NYHA I" }, { value: "II", label: "NYHA II" }, { value: "III-IV", label: "NYHA III–IV" }, { value: "syncope", label: "Exertional syncope" }],
          },
          {
            id: "therapy", label: "Current therapy", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "bb", label: "Beta-blocker", detectTag: ["bb"] },
              { value: "bb-max", label: "Beta-blocker at maximum tolerated dose" },
              { value: "bb-intolerant", label: "Beta-blocker not tolerated / contraindicated" },
              { value: "ccb", label: "Verapamil or diltiazem" },
              { value: "myosin", label: "Mavacamten", detectTag: ["myosin-inhibitor"] },
            ],
          },
        ],
      },
      {
        id: "plan", title: "Plan",
        questions: [
          {
            id: "actions", label: "Plan", type: "multi", required: true,
            options: [
              { value: "none", label: "No change" },
              { value: "bb", label: "Titrate the beta-blocker to the maximum tolerated dose", effects: { plan: [{ category: "medication", title: "Obstructive HCM: titrate the non-vasodilating beta-blocker to the maximum tolerated dose", days: 14, completesOn: { type: "visit" } }] } },
              { value: "ccb", label: "Verapamil or diltiazem (beta-blocker not possible)", effects: { plan: [{ category: "medication", title: "Obstructive HCM: start verapamil or diltiazem (beta-blocker not possible)", days: 7, completesOn: manual }] } },
              { value: "disopyramide", label: "Add disopyramide", effects: { plan: [{ category: "referral", title: "Obstructive HCM: add disopyramide (specialist start, ECG / QTc monitoring)", days: 14, completesOn: manual }] } },
              { value: "myosin", label: "Mavacamten (cardiac myosin inhibitor)", effects: { plan: [{ category: "referral", title: "Obstructive HCM: mavacamten (specialist start, echo LVEF monitoring)", days: 28, completesOn: manual }] } },
              { value: "srt", label: "Septal reduction therapy referral", effects: { plan: [{ category: "referral", title: "Septal reduction therapy (myectomy or alcohol septal ablation), experienced HCM team", days: 28, completesOn: manual }] } },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};

CMP_WIZARDS["hcm-scd"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const r = riskFor(a, ctx);
  const v = (c: string, u: string) => (ctx.values?.[c] ? `${ctx.values[c].value} ${u}` : "Not recorded");
  const lv = lvotMax(ctx);
  const rows: Assessment["rows"] = [
    { label: "Age", value: `${ctx.profile?.age ?? "?"} years` },
    { label: "Max wall thickness · LA", value: `${v("mwt", "mm")} · ${v("la-diam", "mm")}` },
    { label: "Max LVOT gradient", value: lv == null ? "Not recorded" : `${lv} mmHg` },
    { label: "FHx SCD · NSVT · syncope", value: [a.fhx, a.nsvt, a.syncope].map((x) => (x === "yes" ? "yes" : x === "no" ? "no" : "?")).join(" · ") },
    { label: "5-year SCD risk", value: r.risk != null ? `${r.risk}% (HCM Risk-SCD)` : `Cannot calculate: ${r.missing.join(", ")}`, tone: r.band === "high" || r.band === "intermediate" ? "orange" : r.band ? "green" : "orange" },
  ];
  const mods = riskModifiers(ctx);
  if (mods.length) rows.push({ label: "Also present", value: mods.join(", ") });
  const rec: string[] = [];
  if (r.band) rec.push(`HCM Risk-SCD ${r.risk}%: ${RISK_BAND_TEXT[r.band]}.`);
  if (r.band === "low" && mods.some((m) => /LGE|LVEF/.test(m))) rec.push(`${mods.filter((m) => /LGE|LVEF/.test(m)).join(" and ")}: may be considered in shared decision-making about an ICD (IIb B).`);
  if (mods.includes("LV apical aneurysm")) rec.push("LV apical aneurysm: base the primary-prevention ICD decision on the HCM Risk-SCD assessment (IIa B).");
  if (a.nsvt === "not-done") rec.push("No ambulatory ECG yet: the NSVT input is needed for the calculation.");
  rec.push("Re-evaluate the 5-year risk every 1–2 years or when the clinical status changes (I B).");
  return { heading: "HCM: sudden death risk", rows, recommendations: rec };
};

CMP_WIZARDS["hcm-lvoto"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const lv = lvotMax(ctx);
  const t = ((a.therapy as string[]) ?? []).filter((x) => x !== "none");
  const rows: Assessment["rows"] = [
    { label: "Max LVOT gradient", value: lv == null ? "Not recorded" : `${lv} mmHg`, tone: lv != null && lv >= 50 ? "orange" : undefined },
    { label: "Symptoms", value: { I: "NYHA I", II: "NYHA II", "III-IV": "NYHA III–IV", syncope: "Exertional syncope" }[String(a.nyha)] ?? "Not given" },
    { label: "Therapy now", value: t.length ? t.map((x) => ({ bb: "beta-blocker", "bb-max": "beta-blocker at maximum dose", "bb-intolerant": "beta-blocker not tolerated", ccb: "verapamil / diltiazem", myosin: "mavacamten" }[x] ?? x)).join(", ") : "None" },
  ];
  const rec: string[] = [];
  const onBb = t.includes("bb") || t.includes("bb-max");
  if (!onBb && !t.includes("bb-intolerant")) rec.push("Non-vasodilating beta-blocker, titrated to the maximum tolerated dose, first line (I B).");
  if (t.includes("bb") && !t.includes("bb-max")) rec.push("Titrate the beta-blocker to the maximum tolerated dose (I B).");
  if (t.includes("bb-intolerant") && !t.includes("ccb")) rec.push("Beta-blocker not possible: verapamil or diltiazem (I B).");
  if (onBb || t.includes("ccb")) rec.push("Persistent symptoms: add disopyramide to a beta-blocker (I B), or mavacamten (IIa A; monotherapy IIa B).");
  if ((a.nyha === "III-IV" || a.nyha === "syncope") && lv != null && lv >= 50) rec.push("NYHA III–IV or exertional syncope with a gradient ≥50 mmHg despite maximum tolerated medical therapy: septal reduction therapy (I B), by experienced operators in a multidisciplinary HCM team (I C).");
  return { heading: "Obstructive HCM: assessment", rows, recommendations: rec };
};

// Family screening (cardiomyopathy module, slice 3). 2023 ESC cardiomyopathies, recommendation wording
// as transcribed from the guideline tables:
//  - genetic counselling for families with an inherited or suspected inherited cardiomyopathy, whether or
//    not genetic testing is considered (I B);
//  - cascade genetic testing, with pre- and post-test counselling, offered to adult at-risk relatives when
//    a P/LP variant is established in the family, starting with first-degree relatives (I B);
//  - relatives with the family variant: clinical evaluation with ECG and cardiac imaging and long-term
//    follow-up (I B); phenotype-negative relatives without it: discharged, re-assessed if symptoms or new
//    family data (I C);
//  - no P/LP variant in the family: initial clinical evaluation of first-degree relatives with ECG and
//    cardiac imaging (I C); diagnostic genetic testing of phenotype-negative relatives is not recommended
//    (III C);
//  - genetic testing of a deceased relative found to have cardiomyopathy at post-mortem when it helps the
//    surviving relatives (I C).
// No screening interval is given in the text that could be read, so repeat evaluations are dated by the
// clinician (a date question), never by CardioFlow.
export const CMP_FAMILY_SCOPE = (ctx: WizardContext) => (ctx.cmp?.pgene ? "variant" : "no-variant");
CMP_WIZARDS["cmp-family"] = {
  id: "cmp-family", title: "Cardiomyopathy: family screening", tone: "yellow", group: "Cardiomyopathy", episode: false,
  source: "ESC cardiomyopathies 2023",
  note: "With a pathogenic (P/LP) variant in the family, adult relatives are offered cascade genetic testing and those carrying it are followed with ECG and imaging. Without one, first-degree relatives have a clinical evaluation with ECG and imaging, and genetic testing of unaffected relatives is not recommended.",
  facts: [],
  steps: [
    {
      id: "family", title: "The family",
      questions: [
        {
          id: "genetics", label: "Genetic result in the family", type: "single", required: true,
          options: [
            { value: "plp", label: "Pathogenic / likely pathogenic variant" },
            { value: "vus", label: "Variant of uncertain significance only" },
            { value: "negative", label: "No variant found" },
            { value: "not-done", label: "Not tested yet / pending" },
          ],
        },
        {
          id: "relatives", label: "First-degree relatives", type: "multi", required: true,
          options: [
            { value: "none", label: "None known / all already assessed" },
            { value: "parents", label: "Parents" }, { value: "siblings", label: "Siblings" },
            { value: "adult-children", label: "Adult children" }, { value: "minors", label: "Children under 18" },
          ],
        },
        { id: "deceased", label: "A relative died suddenly or had cardiomyopathy at post-mortem", type: "single", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No / not known" }] },
      ],
    },
    {
      id: "plan", title: "Plan",
      questions: [
        {
          id: "actions", label: "Plan", type: "multi", required: true,
          options: [
            { value: "none", label: "Nothing more" },
            { value: "counselling", label: "Genetic counselling for the family", effects: { plan: [{ category: "referral", title: "Genetic counselling for the family (cardiomyopathy)", days: 28, completesOn: manual }] } },
            { value: "cascade", label: "Offer cascade genetic testing to adult relatives", effects: { plan: [{ category: "referral", title: "Offer cascade genetic testing to adult first-degree relatives (pre- and post-test counselling)", days: 28, completesOn: manual }] } },
            { value: "clinical", label: "Clinical evaluation of relatives: ECG and imaging", effects: { plan: [{ category: "referral", title: "First-degree relatives: clinical evaluation with ECG and cardiac imaging", days: 28, completesOn: manual }] } },
            { value: "paediatric", label: "Children: paediatric cardiology", effects: { plan: [{ category: "referral", title: "Children of the patient: paediatric cardiology (family screening)", days: 28, completesOn: manual }] } },
            { value: "postmortem", label: "Genetic testing of the deceased relative's samples", effects: { plan: [{ category: "referral", title: "Genetic testing of the deceased relative (post-mortem samples)", days: 28, completesOn: manual }] } },
          ],
        },
        { id: "repeat", label: "Repeat family evaluation (date chosen by the clinician)", type: "date" },
        { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
      ],
    },
  ],
};
CMP_WIZARDS["cmp-family"].outcome = (a: Answers, _ctx: WizardContext): OutcomeItem[] =>
  a.repeat ? [{ kind: "plan", category: "follow_up", title: "Repeat family evaluation (cardiomyopathy)", dueDate: String(a.repeat), completesOn: { type: "manual" }, label: "" }] : [];
CMP_WIZARDS["cmp-family"].assess = (a: Answers, _ctx: WizardContext): Assessment => {
  const rel = ((a.relatives as string[]) ?? []).filter((x) => x !== "none");
  const rows: Assessment["rows"] = [
    { label: "Family genetics", value: { plp: "P/LP variant", vus: "VUS only", negative: "No variant found", "not-done": "Not tested yet" }[String(a.genetics)] ?? "Not given", tone: a.genetics === "plp" ? "orange" : undefined },
    { label: "Relatives to see", value: rel.length ? rel.map((x) => ({ parents: "parents", siblings: "siblings", "adult-children": "adult children", minors: "children under 18" }[x] ?? x)).join(", ") : "None" },
  ];
  const rec = ["Genetic counselling for the family, whether or not genetic testing is planned (I B)."];
  if (a.genetics === "plp") {
    rec.push("Offer cascade genetic testing with pre- and post-test counselling to adult at-risk relatives, first-degree first (I B).");
    rec.push("Relatives carrying the variant: ECG and cardiac imaging with long-term follow-up (I B); relatives without it and without a phenotype can be discharged and re-assessed if symptoms or new family data (I C).");
  } else {
    rec.push("No P/LP variant in the family: initial clinical evaluation of first-degree relatives with ECG and cardiac imaging (I C).");
    rec.push("Diagnostic genetic testing of phenotype-negative relatives is not recommended without a P/LP variant in the family (III C).");
  }
  if (a.deceased === "yes") rec.push("Cardiomyopathy found at post-mortem: genetic testing of the deceased relative when it helps the survivors (I C).");
  return { heading: "Cardiomyopathy: family screening", rows, recommendations: rec };
};

// kept for the shared outcome builder (plan items come from the option effects)
export const noOutcome = (): OutcomeItem[] => [];
