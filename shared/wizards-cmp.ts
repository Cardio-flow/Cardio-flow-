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

// Myocarditis (cardiomyopathy module, slice 5; opens an episode). 2025 ESC Guidelines for the
// management of myocarditis and pericarditis (Schulz-Menger et al., Eur Heart J 2025), as reported with
// class and level in guideline summaries (Rev Esp Cardiol 2025 "Insights"; cardiac-imaging.org):
//  - CMR in suspected myocarditis for diagnosis (I B) and for follow-up within 6 months (I B);
//  - hospital admission for patients with myocarditis, for monitoring, investigation and treatment;
//  - coronary CT or invasive angiography only with a moderate-to-high likelihood of coronary disease;
//  - endomyocardial biopsy (with molecular / viral PCR before immunosuppression) strongly recommended in
//    acute heart failure or cardiogenic shock; considered with malignant arrhythmia, conduction disease,
//    LVEF <40%, extensive LGE, a suspected specific aetiology or no response to therapy;
//  - symptoms: paracetamol, aspirin or an NSAID, colchicine if pericarditis is present;
//  - beta-blocker for at least 6 months whatever the LV function (IIa C); HF therapy per HF guidelines;
//    neurohormonal therapy may be withdrawn after 6 months once function has recovered (IIa C);
//  - immunosuppression not as initial therapy: fulminant non-infectious myocarditis (IIa C), refractory
//    ventricular dysfunction (IIb C) or an autoimmune aetiology;
//  - physical activity restricted for 1 month initially, then individualised;
//  - wearable defibrillator for selected high-risk patients in the 3–6-month recovery period;
//  - follow-up of uncomplicated cases at 6, 12 and 24 months.
// CardioFlow plans these steps; it never doses NSAIDs, colchicine or immunosuppression here.
const MYO_FORM: Record<string, string> = { uncomplicated: "Uncomplicated", complicated: "Complicated", fulminant: "Fulminant" };
CMP_WIZARDS["myocarditis"] = {
  id: "myocarditis", title: "Myocarditis", tone: "orange", group: "Inflammatory & infective heart disease",
  source: "ESC 2025 myocarditis and pericarditis",
  note: "Admit and monitor; CMR confirms the diagnosis; biopsy for heart failure or shock. Beta-blocker for at least 6 months, exercise restriction, and CMR again within 6 months.",
  facts: ["hs-troponin", "nt-probnp", "crp", "lvef", "hr", "sbp"],
  steps: [
    {
      id: "presentation", title: "Presentation",
      questions: [
        {
          id: "form", label: "Presentation", type: "single", required: true,
          options: [
            { value: "uncomplicated", label: "Uncomplicated", hint: "Chest pain, preserved LV function, no arrhythmia" },
            { value: "complicated", label: "Complicated", hint: "LV dysfunction, heart failure, ventricular arrhythmia or conduction disease" },
            { value: "fulminant", label: "Fulminant", hint: "Cardiogenic shock / acute heart failure needing support" },
          ],
        },
        { id: "pericarditis", label: "Pericarditis features too", type: "single", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
        { id: "cad", label: "Likelihood of coronary disease", type: "single", required: true, options: [{ value: "low", label: "Low" }, { value: "moderate-high", label: "Moderate to high" }] },
      ],
    },
    {
      id: "workup", title: "Work-up",
      questions: [
        {
          id: "tests", label: "Work-up", type: "multi", required: true,
          options: [
            { value: "none", label: "All done" },
            { value: "admit", label: "Admit with rhythm monitoring", effects: { plan: [{ category: "follow_up", title: "Myocarditis: admission with rhythm monitoring", days: 0, completesOn: manual }] } },
            { value: "bloods", label: "Troponin, NT-proBNP, inflammatory markers", effects: { plan: [{ category: "monitoring", title: "Myocarditis: troponin, NT-proBNP and inflammatory markers", days: 0, completesOn: { type: "lab", codes: ["hs-troponin", "nt-probnp", "crp"] } }] } },
            { value: "echo", label: "ECG and echo", effects: { plan: [{ category: "investigation", title: "Myocarditis: ECG and echo", days: 0, completesOn: { type: "study", kind: "echo" } }] } },
            { value: "cmr", label: "Cardiac MRI", effects: { plan: [{ category: "investigation", title: "Cardiac MRI (myocarditis)", days: 3, completesOn: { type: "study", kind: "cmr" } }] } },
            { value: "coronary", label: "Coronary CT or angiography", effects: { plan: [{ category: "investigation", title: "Coronary CT or angiography (exclude coronary disease)", days: 1, completesOn: manual }] } },
            { value: "emb", label: "Endomyocardial biopsy with viral PCR", effects: { plan: [{ category: "procedure", title: "Endomyocardial biopsy with histology, immunohistochemistry and viral PCR", days: 1, completesOn: manual }] } },
          ],
        },
      ],
    },
    {
      id: "plan", title: "Treatment & follow-up",
      questions: [
        {
          id: "actions", label: "Plan", type: "multi", required: true,
          options: [
            { value: "none", label: "Nothing more" },
            { value: "symptoms", label: "Symptom relief", hint: "Paracetamol, aspirin or NSAID; colchicine if pericarditis", effects: { plan: [{ category: "medication", title: "Myocarditis: symptom relief (paracetamol, aspirin or NSAID; colchicine if pericarditis)", days: 0, completesOn: manual }] } },
            { value: "bb", label: "Beta-blocker for at least 6 months", effects: { plan: [{ category: "medication", title: "Myocarditis: beta-blocker for at least 6 months", days: 0, completesOn: manual }] } },
            { value: "hf", label: "Heart failure therapy (HF guideline)", effects: { plan: [{ category: "medication", title: "Myocarditis with LV dysfunction: heart failure therapy per HF guideline", days: 0, completesOn: manual }] } },
            { value: "immuno", label: "Immunosuppression: specialist decision after biopsy", effects: { plan: [{ category: "referral", title: "Myocarditis: immunosuppression decision (biopsy-proven, non-infectious) with the specialist team", days: 1, completesOn: manual }] } },
            { value: "wcd", label: "Wearable defibrillator (selected high risk)", effects: { plan: [{ category: "referral", title: "Wearable cardioverter-defibrillator for the recovery period (3–6 months)", days: 0, completesOn: manual }] } },
            { value: "exercise", label: "Exercise restriction", effects: { plan: [{ category: "education", title: "Myocarditis: no strenuous exercise or competitive sport for at least 1 month, then individual reassessment", days: 0, completesOn: manual }] } },
            { value: "cmr6", label: "Follow-up CMR within 6 months", effects: { plan: [{ category: "investigation", title: "Follow-up cardiac MRI (myocarditis, within 6 months)", days: 180, completesOn: { type: "study", kind: "cmr" } }] } },
            { value: "followup", label: "Follow-up at 6, 12 and 24 months", effects: { plan: [
              { category: "follow_up", title: "Myocarditis follow-up · 6 months", days: 182, completesOn: { type: "visit" } },
              { category: "follow_up", title: "Myocarditis follow-up · 12 months", days: 365, completesOn: { type: "visit" } },
              { category: "follow_up", title: "Myocarditis follow-up · 24 months", days: 730, completesOn: { type: "visit" } },
            ] } },
          ],
        },
        { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
      ],
    },
  ],
};
CMP_WIZARDS["myocarditis"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const form = MYO_FORM[String(a.form)];
  if (!form) return [];
  const listed = (ctx.dx ?? []).includes("myocarditis");
  return [{ kind: "condition", code: "myocarditis", attributes: { form }, label: `Myocarditis · ${form.toLowerCase()}: ${listed ? "update the problem list" : "add to the problem list"}` }];
};
CMP_WIZARDS["myocarditis"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const ef = ctx.values?.lvef?.value ?? null;
  const tests = ((a.tests as string[]) ?? []);
  const acts = ((a.actions as string[]) ?? []);
  const rows: Assessment["rows"] = [
    { label: "Presentation", value: MYO_FORM[String(a.form)] ?? "Not given", tone: a.form === "fulminant" || a.form === "complicated" ? "orange" : undefined },
    { label: "LVEF", value: ef != null ? `${ef}%` : "Not recorded", tone: ef != null && ef < 40 ? "orange" : undefined },
    { label: "Pericarditis features", value: a.pericarditis === "yes" ? "Yes" : "No" },
  ];
  const rec: string[] = ["Hospital admission for monitoring, investigation and treatment."];
  rec.push("CMR for the diagnosis (I B), and again within 6 months to tell healed from ongoing inflammation and guide return to exercise (I B).");
  if (a.cad === "moderate-high") rec.push("Moderate-to-high likelihood of coronary disease: coronary CT or invasive angiography.");
  if (a.form === "fulminant") rec.push("Acute heart failure or cardiogenic shock: endomyocardial biopsy (with viral PCR) is recommended; immunosuppression may be considered in biopsy-proven non-infectious fulminant myocarditis (IIa C).");
  else if (a.form === "complicated" || (ef != null && ef < 40)) rec.push("Biopsy should be considered with malignant arrhythmia, conduction disease, LVEF <40%, extensive LGE, a suspected specific cause or no response to therapy; immunosuppression for refractory ventricular dysfunction (IIb C).");
  rec.push("Immunosuppression is not initial therapy; viral PCR on the biopsy is needed before starting it.");
  rec.push(a.pericarditis === "yes" ? "Symptoms: paracetamol, aspirin or an NSAID, with colchicine for the pericarditis." : "Symptoms: paracetamol, aspirin or an NSAID.");
  rec.push("Beta-blocker for at least 6 months, whatever the LV function (IIa C); heart failure therapy if the LV is impaired, which may be withdrawn after 6 months once function has recovered (IIa C).");
  rec.push("Restrict physical activity for 1 month at first, then decide individually on symptoms, inflammation and arrhythmias.");
  if (a.form !== "uncomplicated") rec.push("Selected high-risk patients: wearable defibrillator during the 3–6-month recovery period.");
  rec.push("Follow-up at 6, 12 and 24 months in uncomplicated cases.");
  if (!tests.includes("cmr") && !acts.includes("cmr6")) rec.push("No CMR planned in this pathway.");
  return { heading: "Myocarditis: assessment", rows, recommendations: rec };
};

// kept for the shared outcome builder (plan items come from the option effects)
export const noOutcome = (): OutcomeItem[] => [];
