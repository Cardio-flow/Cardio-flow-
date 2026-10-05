// Valve pathways (valve module, slice 2). Content only; the one wizard engine renders them.
//
// Heart Team decision for severe valve disease. Recommendations confirmed verbatim from the 2025
// ESC/EACTS valvular heart disease guidelines' tables of new and revised recommendations (Praz et al.,
// Eur Heart J 2025; doi 10.1093/eurheartj/ehaf194):
//  - Heart Team decision including lifetime management (I C); TAVI ≥70 years with a tricuspid valve and
//    suitable anatomy (I A); SAVR <70 years at low surgical risk (I B); non-transfemoral TAVI (IIa B);
//    TAVI in bicuspid AS (IIb B); intervention in asymptomatic severe high-gradient AS with LVEF ≥50%,
//    a normal exercise test if feasible and low procedural risk, as an alternative to close surveillance
//    (IIa A); low-flow low-gradient AS: intervention with reduced LVEF (I B), with LVEF ≥50% (IIa B).
//  - Primary MR: repair in low-risk asymptomatic patients (LVESD <40 mm, LVESDi <20 mm/m², LVEF >60%)
//    with ≥3 of AF, SPAP >50 mmHg, LA dilatation, TR ≥ moderate (I B); TEER at high surgical risk (IIa B).
//  - Secondary MR: TEER in symptomatic patients with LVEF <50% despite optimised therapy meeting the
//    selection criteria (I A).
//  - AR: surgery when LVESDi >22 mm/m², LVESVi >45 mL/m² or LVEF ≤55% at low risk (IIb B); repair
//    (IIa B); TAVI when ineligible for surgery (IIb B).
//  - TR: Heart Team evaluation (I C); transcatheter treatment (IIa A).
// Class I triggers unchanged from 2021 (symptomatic severe AS; AS with LVEF <50%; AR with LVEF ≤50% or
// LVESD >50 mm; primary MR with LVEF ≤60% or LVESD ≥40 mm) are from secondary summaries: shown "to
// confirm" until read in the guideline text.
import type { Answers, Assessment, WizardContext, WizardDef } from "./wizards.js";

const REVIEW = [
  { value: "none", label: "No extra visit" },
  { value: "clinic-28", label: "Clinic · 4 weeks" },
  { value: "clinic-90", label: "Clinic · 3 months" },
];
const manual = { type: "manual" };
export const LESION_LABEL: Record<string, string> = {
  as: "Severe aortic stenosis", ar: "Severe aortic regurgitation", "mr-primary": "Severe primary mitral regurgitation",
  "mr-secondary": "Severe secondary mitral regurgitation", ms: "Severe mitral stenosis", tr: "Severe tricuspid regurgitation",
};

export const VALVE_WIZARDS: Record<string, WizardDef> = {
  "valve-heart-team": {
    id: "valve-heart-team", title: "Severe valve disease: Heart Team decision", tone: "orange", group: "Valve disease", episode: false,
    source: "ESC/EACTS VHD 2025",
    note: "Symptoms, LV function and dimensions, age, surgical risk and anatomy decide between intervention and surveillance, and between the surgical and the transcatheter route. The Heart Team decides, including lifetime management.",
    facts: ["lvef", "av-vmax", "av-mg", "ava", "lvesd", "spap", "creatinine"],
    steps: [
      {
        id: "lesion", title: "The lesion",
        questions: [
          {
            id: "lesion", label: "Severe lesion to decide on", type: "single", required: true,
            options: Object.entries(LESION_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            id: "symptoms", label: "Symptoms", type: "single", required: true,
            options: [
              { value: "symptomatic", label: "Symptomatic", hint: "Dyspnoea NYHA II–IV, angina, syncope" },
              { value: "asymptomatic", label: "Asymptomatic" },
              { value: "equivocal", label: "Equivocal", hint: "Exercise testing clarifies" },
            ],
          },
          {
            id: "lv", label: "LV function", type: "single", required: true,
            options: [
              { value: "lt50", label: "LVEF <50%" }, { value: "50-60", label: "LVEF 50–60%" }, { value: "gt60", label: "LVEF >60%" },
            ],
          },
          {
            id: "lowflow", label: "Low-flow, low-gradient AS", type: "single", showIf: { question: "lesion", includes: "as" },
            options: [{ value: "no", label: "No: high gradient" }, { value: "yes", label: "Yes: low flow, low gradient" }],
          },
          {
            id: "mrFeatures", label: "Primary MR: features present", type: "multi", showIf: { question: "lesion", includes: "mr-primary" },
            options: [
              { value: "none", label: "None" }, { value: "af", label: "Atrial fibrillation" }, { value: "spap", label: "SPAP >50 mmHg" },
              { value: "la", label: "LA dilatation" }, { value: "tr", label: "TR moderate or more" }, { value: "lvesd", label: "LVESD ≥40 mm" },
            ],
          },
        ],
      },
      {
        id: "patient", title: "Patient & anatomy",
        questions: [
          {
            id: "risk", label: "Surgical risk (Heart Team / EuroSCORE II / STS)", type: "single", required: true,
            options: [
              { value: "low", label: "Low" }, { value: "intermediate", label: "Intermediate" }, { value: "high", label: "High" },
              { value: "prohibitive", label: "Prohibitive / inoperable" },
            ],
          },
          {
            id: "anatomy", label: "Anatomy", type: "multi", required: true, showIf: { question: "lesion", includes: "as" },
            options: [
              { value: "tricuspid", label: "Tricuspid aortic valve" }, { value: "bicuspid", label: "Bicuspid aortic valve" },
              { value: "tf", label: "Transfemoral access suitable" }, { value: "no-tf", label: "Transfemoral access not suitable" },
            ],
          },
          {
            id: "factors", label: "Other factors", type: "multi", required: true,
            options: [
              { value: "none", label: "None" }, { value: "frailty", label: "Frailty" }, { value: "cad", label: "Coronary disease needing revascularisation" },
              { value: "aorta", label: "Ascending aorta dilatation" }, { value: "comorbid", label: "Limited life expectancy (<1 year)" },
              { value: "preference", label: "Patient preference stated" },
            ],
          },
        ],
      },
      {
        id: "decision", title: "Decision",
        questions: [
          {
            id: "decision", label: "Heart Team decision", type: "single", required: true,
            options: [
              { value: "tavi", label: "TAVI", effects: { plan: [{ category: "procedure", title: "TAVI (Heart Team decision)", days: 28, completesOn: manual }] } },
              { value: "savr", label: "Surgical aortic valve replacement", effects: { plan: [{ category: "referral", title: "Cardiac surgery referral: aortic valve replacement", days: 14, completesOn: manual }] } },
              { value: "mv-surgery", label: "Mitral valve surgery (repair preferred)", effects: { plan: [{ category: "referral", title: "Cardiac surgery referral: mitral valve repair", days: 14, completesOn: manual }] } },
              { value: "teer", label: "Transcatheter edge-to-edge repair (TEER)", effects: { plan: [{ category: "procedure", title: "Mitral / tricuspid TEER (Heart Team decision)", days: 28, completesOn: manual }] } },
              { value: "pmc", label: "Percutaneous mitral commissurotomy", effects: { plan: [{ category: "procedure", title: "Percutaneous mitral commissurotomy", days: 28, completesOn: manual }] } },
              { value: "tr-intervention", label: "Tricuspid intervention (surgical or transcatheter)", effects: { plan: [{ category: "referral", title: "Tricuspid intervention: surgical or transcatheter (Heart Team)", days: 28, completesOn: manual }] } },
              { value: "ar-surgery", label: "Aortic valve surgery for AR", effects: { plan: [{ category: "referral", title: "Cardiac surgery referral: aortic regurgitation", days: 14, completesOn: manual }] } },
              { value: "surveillance", label: "Close surveillance", effects: { plan: [{ category: "investigation", title: "Repeat echo (valve surveillance)", days: 90, completesOn: { type: "study", kind: "echo" } }] } },
              { value: "medical", label: "Medical therapy only / palliative" },
            ],
          },
          {
            id: "workup", label: "Work-up before the procedure", type: "multi", required: true,
            options: [
              { value: "none", label: "Nothing more" },
              { value: "ct", label: "Cardiac CT (TAVI / annulus planning)", effects: { plan: [{ category: "investigation", title: "Cardiac CT for valve intervention planning", days: 14, completesOn: { type: "study", kind: "ccta" } }] } },
              { value: "cath", label: "Coronary angiography", effects: { plan: [{ category: "investigation", title: "Coronary angiography before valve intervention", days: 14, completesOn: { type: "study", kind: "cath" } }] } },
              { value: "exercise", label: "Exercise test (symptoms unclear)", effects: { plan: [{ category: "investigation", title: "Exercise test (asymptomatic valve disease)", days: 14, completesOn: { type: "study", kind: "stress" } }] } },
              { value: "tee", label: "TOE (mitral anatomy)", effects: { plan: [{ category: "investigation", title: "TOE for valve anatomy", days: 14, completesOn: manual }] } },
              { value: "dental", label: "Dental review before the valve", effects: { plan: [{ category: "referral", title: "Dental review before valve intervention", days: 14, completesOn: manual }] } },
              { value: "meeting", label: "Present at the Heart Team meeting", effects: { plan: [{ category: "referral", title: "Heart Team meeting (valve)", days: 7, completesOn: manual }] } },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};

// how many of the primary-MR features in the 2025 low-risk asymptomatic repair recommendation
export const mrRepairFeatures = (a: Answers) => ((a.mrFeatures as string[]) ?? []).filter((v) => ["af", "spap", "la", "tr"].includes(v)).length;

VALVE_WIZARDS["valve-heart-team"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const age = ctx.profile?.age ?? null;
  const ef = ctx.values?.lvef?.value ?? null;
  const rows: Assessment["rows"] = [
    { label: "Lesion", value: LESION_LABEL[String(a.lesion)] ?? "Not given", tone: "orange" },
    { label: "Symptoms", value: { symptomatic: "Symptomatic", asymptomatic: "Asymptomatic", equivocal: "Equivocal" }[String(a.symptoms)] ?? "Not given" },
    { label: "LV function", value: [{ lt50: "LVEF <50%", "50-60": "LVEF 50–60%", gt60: "LVEF >60%" }[String(a.lv)], ef != null ? `latest ${ef}%` : null].filter(Boolean).join(" · ") || "Not given" },
    { label: "Age · surgical risk", value: `${age ?? "?"} years · ${String(a.risk ?? "not given")}` },
  ];
  const v = (c: string) => ctx.values?.[c]?.value;
  const nums = [v("av-vmax") != null && `Vmax ${v("av-vmax")} m/s`, v("av-mg") != null && `MG ${v("av-mg")} mmHg`, v("ava") != null && `AVA ${v("ava")} cm²`, v("lvesd") != null && `LVESD ${v("lvesd")} mm`, v("spap") != null && `SPAP ${v("spap")} mmHg`].filter(Boolean);
  if (nums.length) rows.push({ label: "Echo", value: nums.join(" · ") });
  const rec: string[] = ["Heart Team decision, including lifetime management (I C)."];
  const sym = a.symptoms === "symptomatic", low = a.risk === "low", anat = (a.anatomy as string[]) ?? [];
  if (a.lesion === "as") {
    if (a.lowflow === "yes") rec.push(a.lv === "lt50" ? "Low-flow, low-gradient AS with reduced LVEF: intervention (I B)." : "Low-flow, low-gradient AS with LVEF ≥50%: intervention should be considered (IIa B).");
    if (sym) rec.push("Symptomatic severe AS: intervention (class I — to confirm in the guideline text).");
    if (a.lv === "lt50" && !sym) rec.push("Asymptomatic severe AS with LVEF <50%: intervention (class I — to confirm in the guideline text).");
    if (!sym && a.lv !== "lt50" && low && a.lowflow !== "yes") rec.push("Asymptomatic severe high-gradient AS, LVEF ≥50%, low procedural risk (normal exercise test if feasible): intervention should be considered as an alternative to close surveillance (IIa A).");
    if (age != null && age >= 70 && anat.includes("tricuspid") && !anat.includes("no-tf")) rec.push(`Age ${age}, tricuspid valve, suitable anatomy: TAVI (I A).`);
    if (age != null && age < 70 && low) rec.push(`Age ${age}, low surgical risk: SAVR (I B).`);
    if (anat.includes("bicuspid")) rec.push("Bicuspid AS: TAVI may be considered (IIb B); surgery is the reference.");
    if (anat.includes("no-tf")) rec.push("No transfemoral access: non-transfemoral TAVI should be considered when surgery is not suitable (IIa B).");
  }
  if (a.lesion === "mr-primary") {
    if (sym) rec.push("Symptomatic severe primary MR: surgery, repair preferred (class I — to confirm in the guideline text).");
    if (a.lv !== "gt60" || ((a.mrFeatures as string[]) ?? []).includes("lvesd")) rec.push("LVEF ≤60% or LVESD ≥40 mm: surgery (class I — to confirm in the guideline text).");
    else if (!sym && low && mrRepairFeatures(a) >= 3) rec.push(`Asymptomatic, low risk, LVEF >60%, LVESD <40 mm with ${mrRepairFeatures(a)} of AF, SPAP >50, LA dilatation, TR ≥ moderate: repair (I B).`);
    if (a.risk === "high" || a.risk === "prohibitive") rec.push("High surgical risk: TEER should be considered (IIa B).");
  }
  if (a.lesion === "mr-secondary" && sym && a.lv === "lt50") rec.push("Symptomatic secondary MR with LVEF <50% despite optimised therapy, meeting the selection criteria: TEER (I A).");
  if (a.lesion === "ar") {
    if (sym) rec.push("Symptomatic severe AR: surgery (class I — to confirm in the guideline text).");
    if (a.lv === "lt50") rec.push("LVEF ≤50%: surgery (class I — to confirm in the guideline text).");
    if (!sym && low) rec.push("Asymptomatic, low risk: surgery may be considered with LVESDi >22 mm/m², LVESVi >45 mL/m² or LVEF ≤55% (IIb B).");
    rec.push("Valve repair in selected patients (IIa B); TAVI only when ineligible for surgery (IIb B).");
  }
  if (a.lesion === "tr") rec.push("Severe TR: Heart Team evaluation (I C); transcatheter treatment should be considered when surgery is not suitable (IIa A).");
  if (((a.factors as string[]) ?? []).includes("comorbid")) rec.push("Limited life expectancy: intervention is unlikely to improve outcome; consider medical therapy.");
  return { heading: "Severe valve disease: Heart Team assessment", rows, recommendations: rec };
};
