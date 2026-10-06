// Rhythm pathways (rhythm & devices module, slice 2). Content only; the one wizard engine renders them.
//
// AF-CARE (2024 ESC/EACTS AF guidelines): [C] comorbidity and risk-factor management, [A] avoid stroke
// and thromboembolism, [R] reduce symptoms by rate and rhythm control, [E] evaluation and dynamic
// reassessment. Recommendations used (class as recalled from the guideline, to confirm against the
// full text — see the status note):
//  - OAC with CHA₂DS₂-VA ≥2 (I), considered with 1 (IIa); a DOAC in preference to a VKA except
//    mechanical valve or moderate–severe mitral stenosis (I A); DOAC at the label dose; bleeding-risk
//    scores are not used to withhold OAC — modifiable bleeding risk factors are managed; antiplatelet
//    therapy is not used for stroke prevention (III).
//  - Rate control: beta-blocker, digoxin, diltiazem or verapamil when LVEF >40%; beta-blocker and/or
//    digoxin when LVEF ≤40%; lenient target, resting heart rate <110 bpm (class to confirm).
//  - Rhythm control: cardioversion after ≥3 weeks of OAC or TOE, early without TOE only if onset
//    <24 h; OAC for ≥4 weeks after cardioversion and long term by CHA₂DS₂-VA; catheter ablation as a
//    first-line option in paroxysmal AF (I A) and after antiarrhythmic drug failure; ablation in
//    HFrEF when tachycardia-induced cardiomyopathy is suspected; flecainide/propafenone not in
//    structural or ischaemic heart disease.
//  - Comorbidities: treat hypertension; weight loss when obese; alcohol ≤3 drinks/week; physical
//    activity; diabetes control; SGLT2 inhibitor in HF; sleep apnoea assessment when symptomatic.
//  - Evaluation: echocardiography, renal function, blood count, thyroid function; reassess at
//    6 months then at least yearly.
// CardioFlow never doses acute drugs: rate-control and antiarrhythmic choices become plan items;
// only apixaban is started from here, at the label dose computed from age, weight and creatinine.
import { addDays, fmtDay, localDay } from "./clinical.js";
import type { Answers, Assessment, OutcomeItem, WizardContext, WizardDef } from "./wizards.js";

const REVIEW = [
  { value: "none", label: "No extra visit" },
  { value: "clinic-28", label: "Clinic · 4 weeks" },
  { value: "clinic-90", label: "Clinic · 3 months" },
];

// apixaban label dose (ESC AF 2024 / EHRA): 2.5 mg twice daily with ≥2 of age ≥80, weight ≤60 kg,
// creatinine ≥133 µmol/L; otherwise 5 mg twice daily. Null when weight or creatinine is missing.
export function apixabanDose(ctx: WizardContext): { dose: number; why: string } | null {
  const age = ctx.profile?.age ?? null, wt = ctx.values?.weight?.value ?? null, cr = ctx.values?.creatinine?.value ?? null;
  if (age == null || wt == null || cr == null) return null;
  const n = [age >= 80, wt <= 60, cr >= 133].filter(Boolean).length;
  return { dose: n >= 2 ? 2.5 : 5, why: `${n} of 3 reduction criteria (age ${age}, weight ${wt} kg, creatinine ${cr} µmol/L)` };
}

// Anticoagulation around cardioversion and AF ablation (rhythm module, slice 3). Sources: 2024 ESC/EACTS
// AF guidelines (confirmed in the task force's own summary, Rienstra et al., Europace 2024): early
// cardioversion without ≥3 weeks of effective anticoagulation or TOE only with a known AF duration
// <24 h; ≥3 weeks of therapeutic anticoagulation (DOAC adherence, or INR >2 on a VKA) before a
// scheduled cardioversion; long-term anticoagulation follows stroke risk, not the rhythm achieved.
// As recalled from the guideline (to confirm against the full text): anticoagulation for ≥4 weeks
// after cardioversion; uninterrupted anticoagulation through AF ablation and for ≥2 months after it.
const PERI_REVIEW = [
  { value: "none", label: "No extra visit" },
  { value: "clinic-28", label: "Clinic · 4 weeks" },
  { value: "clinic-90", label: "Clinic · 3 months" },
];

export const RHYTHM_WIZARDS: Record<string, WizardDef> = {
  "peri-af-procedure": {
    id: "peri-af-procedure", title: "Anticoagulation around cardioversion or AF ablation", tone: "blue", group: "Rhythm & devices", episode: false,
    source: "ESC/EACTS AF 2024",
    note: "Dates the anticoagulation before and after the procedure: 3 weeks before a scheduled cardioversion (or TOE), 4 weeks after it; uninterrupted through ablation and 2 months after. Long-term anticoagulation then follows CHA₂DS₂-VA, not the rhythm.",
    facts: ["creatinine", "weight", "haemoglobin", "inr"],
    steps: [
      {
        id: "proc", title: "The procedure",
        questions: [
          {
            id: "proc", label: "Procedure", type: "single", required: true,
            options: [{ value: "cardioversion", label: "Cardioversion" }, { value: "ablation", label: "AF catheter ablation" }],
          },
          { id: "when", label: "Planned date (earliest)", type: "date", required: true },
          {
            id: "onset", label: "AF duration", type: "single", showIf: { question: "proc", includes: "cardioversion" },
            options: [
              { value: "lt24", label: "Known onset <24 h", hint: "Early cardioversion without TOE is possible" },
              { value: "ge24", label: "≥24 h or unknown", hint: "≥3 weeks of anticoagulation or TOE first" },
            ],
          },
        ],
      },
      {
        id: "oac", title: "Anticoagulation before",
        questions: [
          {
            id: "oacNow", label: "Anticoagulation now", type: "single", required: true,
            options: [
              { value: "3w", label: "Therapeutic for ≥3 weeks", hint: "DOAC taken every day, or INR >2 throughout", requires: ["oac"] },
              { value: "short", label: "Started less than 3 weeks ago", requires: ["oac"] },
              { value: "none", label: "Not anticoagulated", unless: ["oac"] },
            ],
          },
          {
            id: "start", label: "Start", type: "single", showIf: { question: "oacNow", includes: "none" },
            options: [
              { value: "apixaban", label: "Apixaban at the label dose", hint: "Dose from age, weight and creatinine" },
              { value: "other", label: "Another anticoagulant (dose by renal function)" },
            ],
          },
          {
            id: "prep", label: "Before the cardioversion", type: "single", showIf: { question: "proc", includes: "cardioversion" },
            options: [
              { value: "wait", label: "After ≥3 weeks of effective anticoagulation" },
              { value: "toe", label: "TOE-guided cardioversion" },
              { value: "early", label: "Early cardioversion (onset <24 h)" },
            ],
          },
        ],
      },
      {
        id: "after", title: "After",
        questions: [
          {
            id: "post", label: "After the procedure", type: "multi", required: true,
            options: [
              { value: "oac", label: "Continue anticoagulation (4 weeks after cardioversion · 2 months after ablation), then by CHA₂DS₂-VA" },
              { value: "ecg", label: "12-lead ECG at 1 week" },
              { value: "holter", label: "Ambulatory ECG at 3 months (recurrence)" },
            ],
          },
          { id: "review", label: "Review", type: "single", options: PERI_REVIEW, required: true },
        ],
      },
    ],
  },
  "af-care": {
    id: "af-care", title: "Atrial fibrillation: AF-CARE", tone: "blue", group: "Rhythm & devices", episode: false,
    source: "ESC/EACTS AF 2024",
    note: "Comorbidities, stroke prevention, symptom control by rate or rhythm, and evaluation. Rate-control and antiarrhythmic drug choices become plan items; only apixaban is started here, at its label dose.",
    facts: ["hr", "sbp", "lvef", "creatinine", "egfr", "weight", "haemoglobin", "tsh"],
    steps: [
      {
        id: "c", title: "Comorbidities & risk factors",
        questions: [
          {
            id: "pattern", label: "AF pattern", type: "single", required: true,
            options: [
              { value: "first", label: "First diagnosed" }, { value: "paroxysmal", label: "Paroxysmal", hint: "Ends within 7 days" },
              { value: "persistent", label: "Persistent", hint: ">7 days or needs cardioversion" }, { value: "permanent", label: "Permanent", hint: "No further rhythm control" },
            ],
          },
          {
            id: "comorb", label: "Risk factors to treat", type: "multi", required: true,
            options: [
              { value: "none", label: "None to address" },
              { value: "htn", label: "Blood pressure above target" },
              { value: "weight", label: "Obesity: weight loss" },
              { value: "alcohol", label: "Alcohol: reduce to ≤3 drinks a week" },
              { value: "activity", label: "Physical activity programme" },
              { value: "osa", label: "Sleep apnoea assessment" },
              { value: "dm", label: "Diabetes control" },
              { value: "hf", label: "Heart failure therapy (SGLT2 inhibitor and foundational therapy)" },
              { value: "smoking", label: "Smoking cessation" },
            ],
          },
        ],
      },
      {
        id: "a", title: "Avoid stroke",
        questions: [
          {
            id: "oac", label: "Anticoagulation", type: "single", required: true,
            options: [
              { value: "continue", label: "Continue the current anticoagulant", requires: ["oac"] },
              { value: "apixaban", label: "Start apixaban at the label dose", unless: ["oac"], hint: "Dose from age, weight and creatinine" },
              { value: "other-doac", label: "Start another DOAC (dose by renal function)", unless: ["oac"] },
              { value: "vka-to-doac", label: "Switch warfarin to a DOAC", requires: ["vka"], hint: "Not with a mechanical valve or moderate–severe mitral stenosis" },
              { value: "not-indicated", label: "Not indicated (CHA₂DS₂-VA 0)" },
              { value: "declined", label: "Contraindicated or declined" },
            ],
          },
          {
            id: "bleed", label: "Modifiable bleeding risk factors", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "bp", label: "Uncontrolled blood pressure" },
              { value: "nsaid", label: "NSAID / unnecessary antiplatelet", requires: ["nsaid", "antiplatelet"] },
              { value: "stop-asa", label: "Stop aspirin given for stroke prevention only", requires: ["antiplatelet"] },
              { value: "alcohol", label: "Excess alcohol" },
              { value: "labile-inr", label: "Labile INR", requires: ["vka"] },
            ],
          },
        ],
      },
      {
        id: "r", title: "Reduce symptoms: rate & rhythm",
        questions: [
          {
            id: "rate", label: "Rate control", type: "multi", required: true,
            options: [
              { value: "none", label: "No change" },
              { value: "bb", label: "Beta-blocker (start or up-titrate)" },
              { value: "ccb", label: "Diltiazem or verapamil (LVEF >40% only)", hint: "Not with LVEF ≤40%" },
              { value: "digoxin", label: "Digoxin (add-on)" },
            ],
          },
          {
            id: "rhythm", label: "Rhythm control", type: "multi", required: true,
            options: [
              { value: "none", label: "Not now" },
              { value: "cardioversion", label: "Plan cardioversion", hint: "After ≥3 weeks of OAC, or TOE-guided; without TOE only if onset <24 h" },
              { value: "ablation", label: "Refer for catheter ablation", hint: "First-line option in paroxysmal AF" },
              { value: "aad", label: "Antiarrhythmic drug", hint: "Choice by structural heart disease" },
            ],
          },
        ],
      },
      {
        id: "e", title: "Evaluation & follow-up",
        questions: [
          {
            id: "tests", label: "Evaluation", type: "multi", required: true,
            options: [
              { value: "none", label: "All done" },
              { value: "echo", label: "Echocardiogram" },
              { value: "bloods", label: "Renal function, blood count, thyroid function" },
              { value: "holter", label: "Ambulatory ECG (burden / rate control)" },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};

const pick = (a: Answers, id: string) => ((a[id] as string[]) ?? []).filter((v) => v !== "none");

RHYTHM_WIZARDS["af-care"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const out: OutcomeItem[] = [];
  const t = ctx.today;
  const plan = (category: string, title: string, due = t, completesOn: Record<string, unknown> = { type: "manual" }, medicationId: string | null = null): OutcomeItem =>
    ({ kind: "plan", category, title, dueDate: due, completesOn, label: "", medicationId });
  const has = (re: RegExp) => (ctx.planned ?? []).some((x) => re.test(x));
  // the AF diagnosis with its pattern (added when AF was found on an ECG/Holter only)
  const PAT: Record<string, string> = { first: "First diagnosed", paroxysmal: "Paroxysmal", persistent: "Persistent", permanent: "Permanent" };
  if (PAT[String(a.pattern)] && PAT[String(a.pattern)] !== ctx.af?.pattern)
    out.push({ kind: "condition", code: (ctx.dx ?? []).includes("flutter") && !(ctx.dx ?? []).includes("af") ? "flutter" : "af", attributes: { pattern: PAT[String(a.pattern)] }, label: `Atrial fibrillation · ${PAT[String(a.pattern)].toLowerCase()}: ${(ctx.dx ?? []).includes("af") || (ctx.dx ?? []).includes("flutter") ? "update the problem list" : "add to the problem list"}` });
  const C: Record<string, [string, string]> = {
    htn: ["medication", "AF: blood pressure to target"], weight: ["education", "AF: weight loss programme"], alcohol: ["education", "AF: alcohol ≤3 drinks a week"],
    activity: ["education", "AF: physical activity programme"], osa: ["referral", "AF: sleep apnoea assessment"], dm: ["medication", "AF: diabetes control review"],
    hf: ["medication", "AF with HF: SGLT2 inhibitor and foundational therapy review"], smoking: ["education", "Smoking cessation support"],
  };
  for (const v of pick(a, "comorb")) if (C[v] && !has(new RegExp(C[v][1].replace(/[()]/g, ".")))) out.push(plan(C[v][0], C[v][1]));
  if (a.oac === "apixaban") {
    const d = apixabanDose(ctx);
    if (d) out.push({ kind: "start", code: "apixaban", doseValue: d.dose, frequency: "BID", indication: "af", label: `Apixaban ${d.dose} mg twice daily: start (${d.why})` });
    else out.push(plan("medication", "Start apixaban: record weight and creatinine for the label dose"));
  }
  if (a.oac === "other-doac") out.push(plan("medication", "Start a DOAC at the label dose (renal function, age, weight)"));
  if (a.oac === "vka-to-doac") {
    const w = ctx.meds.find((m) => m.tags.includes("vka"));
    out.push(plan("medication", "Switch warfarin to a DOAC (start when INR <2)", t, { type: "manual" }, w?.id ?? null));
  }
  const bleed = pick(a, "bleed");
  if (bleed.includes("stop-asa")) {
    const asa = ctx.meds.find((m) => m.code === "aspirin");
    if (asa) out.push({ kind: "medication", medicationId: asa.id, event: "stop", doseValue: null, label: "Aspirin: stop (not for stroke prevention in AF)" });
  }
  if (bleed.includes("bp") && !pick(a, "comorb").includes("htn")) out.push(plan("medication", "AF: blood pressure to target (bleeding risk)"));
  if (bleed.includes("nsaid")) out.push(plan("medication", "Stop NSAID / antiplatelet without an indication"));
  if (bleed.includes("labile-inr")) out.push(plan("medication", "Labile INR: consider switching to a DOAC"));
  const R: Record<string, [string, string]> = {
    bb: ["medication", "Rate control: start or up-titrate a beta-blocker (resting HR <110)"],
    ccb: ["medication", "Rate control: diltiazem or verapamil (LVEF >40%)"],
    digoxin: ["medication", "Rate control: add digoxin"],
    cardioversion: ["procedure", "Cardioversion (after ≥3 weeks of effective anticoagulation)"],
    ablation: ["referral", "Referral for AF catheter ablation"],
    aad: ["medication", "Antiarrhythmic drug choice (by structural heart disease)"],
  };
  for (const v of [...pick(a, "rate"), ...pick(a, "rhythm")]) if (R[v]) out.push(plan(R[v][0], R[v][1], v === "cardioversion" ? addDays(t, 21) : t));
  const tests = pick(a, "tests");
  if (tests.includes("echo") && !has(/echo/i)) out.push(plan("investigation", "Echocardiogram (AF evaluation)", t, { type: "study", kind: "echo" }));
  if (tests.includes("bloods")) out.push(plan("monitoring", "Renal function, blood count and thyroid function (AF)", t, { type: "lab", codes: ["creatinine", "haemoglobin", "tsh"] }));
  if (tests.includes("holter")) out.push(plan("investigation", "Ambulatory ECG (AF burden / rate)", addDays(t, 14), { type: "study", kind: "holter" }));
  return out;
};

RHYTHM_WIZARDS["af-care"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const af = ctx.af;
  const lvef = ctx.values?.lvef?.value ?? null;
  const hr = ctx.af?.ecgRate ?? ctx.values?.hr?.value ?? null;
  const onOac = ctx.meds.some((m) => m.tags.includes("oac"));
  const score = af?.score ?? null;
  const rows: Assessment["rows"] = [
    { label: "Pattern", value: { first: "First diagnosed", paroxysmal: "Paroxysmal", persistent: "Persistent", permanent: "Permanent" }[String(a.pattern)] ?? "Not given" },
    { label: "CHA₂DS₂-VA", value: score == null ? "Not available" : `${score}${af!.items.length ? ` (${af!.items.join(", ")})` : ""}`, tone: score != null && score >= 2 && !onOac && a.oac !== "apixaban" && a.oac !== "other-doac" ? "orange" : undefined },
    { label: "Heart rate", value: hr != null ? `${hr} bpm` : "Not recorded", tone: hr != null && hr >= 110 ? "orange" : hr != null ? "green" : undefined },
    { label: "LVEF", value: lvef != null ? `${lvef}%` : "Not recorded", tone: lvef == null ? "orange" : undefined },
  ];
  const rec: string[] = [];
  const cmpOac = !!(ctx.dx?.includes("hcm") || ctx.dx?.includes("amyloid"));
  if (cmpOac && !onOac && !["apixaban", "other-doac"].includes(String(a.oac))) rec.push("HCM or cardiac amyloidosis with AF: oral anticoagulation is recommended whatever the CHA₂DS₂-VA score (I B).");
  else if (score != null && score >= 2 && !onOac && !["apixaban", "other-doac"].includes(String(a.oac))) rec.push(`CHA₂DS₂-VA ${score}: oral anticoagulation is recommended (I), a DOAC in preference to warfarin.`);
  if (score === 1 && !onOac && a.oac !== "apixaban" && a.oac !== "other-doac") rec.push("CHA₂DS₂-VA 1: oral anticoagulation should be considered (IIa).");
  for (const d of af?.doac ?? []) if (d.dose != null && d.dose !== d.right) rec.push(`${d.code[0].toUpperCase() + d.code.slice(1)} ${d.dose} mg: the label dose is ${d.right} mg (${d.why}).`);
  if (ctx.meds.some((m) => m.code === "aspirin") && !(ctx.dx ?? []).some((x) => ["cad", "pad", "ascvd"].includes(x)) && !pick(a, "bleed").includes("stop-asa")) rec.push("Aspirin is not used for stroke prevention in AF (III).");
  if (hr != null && hr >= 110 && !pick(a, "rate").length) rec.push(`Heart rate ${hr} bpm: lenient rate control targets a resting rate <110 bpm.`);
  if (lvef != null && lvef <= 40 && pick(a, "rate").includes("ccb")) rec.push("LVEF ≤40%: diltiazem and verapamil are avoided; beta-blocker and/or digoxin.");
  if (lvef == null && !pick(a, "tests").includes("echo")) rec.push("No LVEF recorded: echocardiography guides rate and rhythm choices.");
  if (a.pattern === "paroxysmal" && !pick(a, "rhythm").includes("ablation")) rec.push("Paroxysmal AF: catheter ablation is a first-line rhythm-control option (I A) within shared decision-making.");
  if (pick(a, "rhythm").includes("cardioversion")) rec.push("Cardioversion: ≥3 weeks of effective anticoagulation or TOE first (without TOE only if onset <24 h); continue anticoagulation ≥4 weeks after, then by CHA₂DS₂-VA.");
  if (pick(a, "rhythm").includes("aad") && (ctx.dx ?? []).some((x) => ["cad", "hf", "ascvd"].includes(x))) rec.push("Structural or ischaemic heart disease: no flecainide or propafenone; amiodarone (or dronedarone if no HFrEF).");
  rec.push("Reassess AF-CARE at 6 months, then at least yearly.");
  return { heading: "AF-CARE: risk and recommendations", rows, recommendations: rec };
};

// The procedure dated after the anticoagulation it needs; anticoagulation dated after it.
RHYTHM_WIZARDS["peri-af-procedure"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const out: OutcomeItem[] = [];
  const t = ctx.today;
  const plan = (category: string, title: string, due: string, completesOn: Record<string, unknown> = { type: "manual" }, link: { id?: string | null; ref?: string } = {}): OutcomeItem =>
    ({ kind: "plan", category, title, dueDate: due, completesOn, label: "", medicationId: link.id ?? null, medicationRef: link.ref });
  const oac = ctx.meds.find((m) => m.tags.includes("oac"));
  let link: { id?: string | null; ref?: string } = oac ? { id: oac.id } : {};
  let oacFrom: string | null = oac?.startedAt ? localDay(oac.startedAt) : null;
  if (a.oacNow === "none" && a.start === "apixaban") {
    const d = apixabanDose(ctx);
    if (d) {
      out.push({ kind: "start", code: "apixaban", doseValue: d.dose, frequency: "BID", indication: "af", label: `Apixaban ${d.dose} mg twice daily: start (${d.why})` });
      link = { ref: "code:apixaban" }; oacFrom = t;
    } else out.push(plan("medication", "Start apixaban: record weight and creatinine for the label dose", t));
  } else if (a.oacNow === "none" && a.start === "other") { out.push(plan("medication", "Start an anticoagulant at the label dose (renal function, age, weight)", t)); oacFrom = t; }
  if (a.oacNow === "3w") oacFrom = null; // already covered
  const when = String(a.when ?? t);
  const later = (x: string, y: string) => (x > y ? x : y);
  if (a.proc === "cardioversion") {
    const needs3w = a.prep === "wait" && a.oacNow !== "3w";
    const day = needs3w ? later(when, addDays(oacFrom ?? t, 21)) : when;
    if (a.prep === "toe") out.push(plan("investigation", "TOE before cardioversion (exclude LA appendage thrombus)", day));
    out.push(plan("procedure", `Cardioversion${needs3w ? " (after 3 weeks of effective anticoagulation)" : a.prep === "toe" ? " (TOE-guided)" : a.prep === "early" ? " (onset <24 h)" : ""}`, day));
    if (((a.post as string[]) ?? []).includes("oac")) out.push(plan("medication", "Anticoagulation for at least 4 weeks after cardioversion, then by CHA₂DS₂-VA", addDays(day, 28), { type: "manual" }, link));
    if (((a.post as string[]) ?? []).includes("ecg")) out.push(plan("investigation", "12-lead ECG after cardioversion", addDays(day, 7), { type: "study", kind: "ecg" }));
    if (((a.post as string[]) ?? []).includes("holter")) out.push(plan("investigation", "Ambulatory ECG after cardioversion (recurrence)", addDays(day, 90), { type: "study", kind: "holter" }));
  } else {
    out.push(plan("procedure", "AF catheter ablation (anticoagulation uninterrupted)", when));
    if (((a.post as string[]) ?? []).includes("oac")) out.push(plan("medication", "Anticoagulation for at least 2 months after AF ablation, then by CHA₂DS₂-VA", addDays(when, 60), { type: "manual" }, link));
    if (((a.post as string[]) ?? []).includes("ecg")) out.push(plan("investigation", "12-lead ECG after ablation", addDays(when, 7), { type: "study", kind: "ecg" }));
    if (((a.post as string[]) ?? []).includes("holter")) out.push(plan("investigation", "Ambulatory ECG 3 months after ablation (recurrence)", addDays(when, 90), { type: "study", kind: "holter" }));
  }
  return out;
};

// ICD shock or ventricular arrhythmia (rhythm module, slice 4; opens an episode). Sources, as found in
// the 2022 ESC VA guideline task-force summary (Könemann et al., Europace 2023;25:euad091) and the 2023
// HRS/EHRA/APHRS/LAHRS remote device clinic consensus (Ferrick et al.):
//  - electrical storm = ≥3 separate sustained VA within 24 h, each needing termination; with structural
//    heart disease and monomorphic VT: amiodarone and a non-selective beta-blocker with mild–moderate
//    sedation (each I); for recurrent storm, catheter ablation in an experienced centre is preferred
//    over deep sedation, autonomic modulation or mechanical support.
//  - IHD with recurrent sustained monomorphic VT despite chronic amiodarone: catheter ablation rather
//    than escalating antiarrhythmics (I); despite a beta-blocker or sotalol (IIa); early ablation after a
//    first VT episode in an ICD candidate (IIb).
//  - ICDs on remote monitoring alert the clinic for every shock (I).
// The work-up of triggers (electrolytes, ischaemia, HF, thyroid, QT-prolonging drugs) is listed without
// a class. CardioFlow never doses antiarrhythmics or sedation: they are plan items for the treating team.
const ICD_REVIEW = [
  { value: "none", label: "No extra visit" },
  { value: "phone-3", label: "Phone call · 3 days" },
  { value: "clinic-14", label: "Clinic · 2 weeks" },
  { value: "clinic-28", label: "Clinic · 4 weeks" },
];
const manual = { type: "manual" };
RHYTHM_WIZARDS["icd-shock"] = {
  id: "icd-shock", title: "ICD shock or ventricular arrhythmia", tone: "orange", group: "Rhythm & devices",
  source: "ESC VA 2022 · HRS/EHRA/APHRS/LAHRS 2023",
  note: "Was the shock appropriate? Find and correct the trigger, then prevent the next one. Electrical storm (≥3 sustained VA within 24 h, each needing termination) is an emergency. CardioFlow never doses antiarrhythmics or sedation: they become plan items for the treating team.",
  facts: ["potassium", "magnesium", "lvef", "hs-troponin", "egfr", "tsh", "qtc"], trend: "potassium",
  steps: [
    {
      id: "event", title: "The event",
      questions: [
        {
          id: "what", label: "What happened", type: "single", required: true,
          options: [
            { value: "single", label: "One shock" },
            { value: "multiple", label: "Two shocks or more, not a storm" },
            { value: "storm", label: "Electrical storm", hint: "≥3 sustained VA within 24 h, each needing termination" },
            { value: "atp", label: "ATP only, no shock" },
            { value: "vt", label: "Sustained VT / VF without ICD therapy" },
          ],
        },
        {
          id: "state", label: "Patient now", type: "single", required: true,
          options: [
            { value: "stable", label: "Stable, in a supraventricular rhythm" },
            { value: "recurrent", label: "Recurrent or ongoing VT" },
            { value: "unstable", label: "Haemodynamically unstable", hint: "Immediate cardioversion / defibrillation (ALS) first" },
          ],
        },
        {
          id: "interrogation", label: "Device interrogation", type: "single", required: true,
          options: [
            { value: "appropriate-mono", label: "Appropriate: monomorphic VT" },
            { value: "appropriate-poly", label: "Appropriate: polymorphic VT / VF" },
            { value: "inappropriate-svt", label: "Inappropriate: AF / SVT / sinus tachycardia" },
            { value: "inappropriate-lead", label: "Inappropriate: oversensing / noise / lead fault" },
            { value: "pending", label: "Not interrogated yet" },
          ],
        },
      ],
    },
    {
      id: "triggers", title: "Triggers",
      questions: [
        {
          id: "triggers", label: "Triggers found", type: "multi", required: true,
          options: [
            { value: "none", label: "None found" },
            { value: "electrolytes", label: "Low potassium or magnesium" },
            { value: "ischaemia", label: "Acute ischaemia" },
            { value: "hf", label: "Heart failure decompensation" },
            { value: "thyroid", label: "Thyroid dysfunction" },
            { value: "qt", label: "QT-prolonging drug" },
            { value: "infection", label: "Infection / fever" },
            { value: "adherence", label: "Missed beta-blocker or antiarrhythmic" },
          ],
        },
      ],
    },
    {
      id: "management", title: "Management",
      questions: [
        {
          id: "actions", label: "What will you do?", type: "multi", required: true,
          options: [
            { value: "interrogate", label: "Interrogate the device", effects: { plan: [{ category: "investigation", title: "Device check (interrogation after ICD therapy)", days: 0, completesOn: { type: "study", kind: "device_check" } }] } },
            { value: "ecg", label: "12-lead ECG", effects: { plan: [{ category: "investigation", title: "12-lead ECG", days: 0, completesOn: { type: "study", kind: "ecg" } }] } },
            { value: "bloods", label: "Potassium, magnesium, renal function", effects: { plan: [{ category: "monitoring", title: "Potassium, magnesium and renal function", days: 0, completesOn: { type: "lab", codes: ["potassium", "magnesium"] } }] } },
            { value: "troponin", label: "hs-troponin (ischaemia suspected)", effects: { plan: [{ category: "monitoring", title: "hs-troponin", days: 0, completesOn: { type: "lab", codes: ["hs-troponin"] } }] } },
            { value: "monitor", label: "Admit to a monitored bed", effects: { plan: [{ category: "procedure", title: "Admit to a monitored bed (ventricular arrhythmia)", days: 0, completesOn: manual }] } },
            { value: "sedation", label: "Mild–moderate sedation", effects: { plan: [{ category: "medication", title: "Mild–moderate sedation for electrical storm (treating team)", days: 0, completesOn: manual }] } },
            { value: "bb", label: "Beta-blocker: start or optimise (non-selective in storm)", effects: { plan: [{ category: "medication", title: "Beta-blocker after ventricular arrhythmia: start or optimise (non-selective in storm)", days: 0, completesOn: manual }] } },
            { value: "amiodarone", label: "Amiodarone (dose by the treating team)", effects: { plan: [{ category: "medication", title: "Amiodarone for ventricular arrhythmia (dose by the treating team)", days: 0, completesOn: manual }] } },
            { value: "ablation", label: "Refer for VT catheter ablation", effects: { plan: [{ category: "referral", title: "VT catheter ablation referral", days: 7, completesOn: manual }] } },
            { value: "reprogram", label: "Reprogram detection / ATP", effects: { plan: [{ category: "procedure", title: "ICD reprogramming (detection zones, ATP)", days: 0, completesOn: manual }] } },
            { value: "svt", label: "Treat AF / SVT (rate or rhythm control)", effects: { plan: [{ category: "medication", title: "Rate or rhythm control of the AF / SVT that caused the shock", days: 0, completesOn: manual }] } },
            { value: "lead", label: "Lead revision referral", effects: { plan: [{ category: "referral", title: "Device lead review (EP)", days: 0, completesOn: manual }] } },
            { value: "ischaemia", label: "Ischaemia evaluation / coronary angiography", effects: { plan: [{ category: "investigation", title: "Ischaemia evaluation after ventricular arrhythmia", days: 7, completesOn: manual }] } },
            { value: "echo", label: "Echo: LV function", effects: { plan: [{ category: "investigation", title: "Echo after ventricular arrhythmia", days: 7, completesOn: { type: "study", kind: "echo" } }] } },
            { value: "remote", label: "Remote monitoring with shock alerts", effects: { plan: [{ category: "follow_up", title: "Remote monitoring: alerts on for every shock", days: 7, completesOn: manual }] } },
            { value: "driving", label: "Driving advice (national rules)", effects: { plan: [{ category: "education", title: "Driving advice after ICD therapy (national rules)", days: 0, completesOn: manual }] } },
          ],
        },
        { id: "review", label: "Review", type: "single", options: ICD_REVIEW, required: true },
      ],
    },
  ],
};

export const vaGroup = (a: Answers) =>
  a.state === "unstable" ? "unstable" : a.what === "storm" ? "storm" : String(a.interrogation ?? "").startsWith("appropriate") || a.what === "vt" ? "appropriate" : String(a.interrogation ?? "").startsWith("inappropriate") ? "inappropriate" : "pending";
const onDrug = (ctx: WizardContext, test: (m: WizardContext["meds"][number]) => boolean) => ctx.meds.some(test);
export const onAmiodarone = (ctx: WizardContext) => onDrug(ctx, (m) => m.code === "amiodarone");
export const onBbOrSotalol = (ctx: WizardContext) => onDrug(ctx, (m) => m.code === "sotalol" || m.tags.includes("bb") || m.tags.includes("bb-other"));
export const ihd = (ctx: WizardContext) => (ctx.dx ?? []).some((x) => ["cad", "ascvd", "prior-mi", "prior-pci", "prior-cabg", "acs-stemi", "acs-nstemi"].includes(x));

RHYTHM_WIZARDS["icd-shock"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const g = vaGroup(a);
  const k = ctx.values?.potassium, mg = ctx.values?.magnesium, ef = ctx.values?.lvef;
  const dev = ctx.device;
  const label: Record<string, string> = { single: "One shock", multiple: "Two shocks or more", storm: "Electrical storm", atp: "ATP only", vt: "Sustained VT / VF" };
  const rows: Assessment["rows"] = [
    { label: "Event", value: label[String(a.what)] ?? "Not given", tone: a.what === "storm" || a.state === "unstable" ? "orange" : undefined },
    { label: "Interrogation", value: { "appropriate-mono": "Appropriate · monomorphic VT", "appropriate-poly": "Appropriate · polymorphic VT / VF", "inappropriate-svt": "Inappropriate · AF / SVT", "inappropriate-lead": "Inappropriate · oversensing / lead", pending: "Not interrogated yet" }[String(a.interrogation)] ?? "Not given", tone: a.interrogation === "pending" ? "orange" : undefined },
  ];
  if (dev?.type) rows.push({ label: "Device", value: [dev.type, dev.checkAt ? `last check ${fmtDay(dev.checkAt, { year: true })}` : null].filter(Boolean).join(" · ") });
  if (ef) rows.push({ label: "LVEF", value: `${ef.value}% (${fmtDay(ef.at, { year: true })})` });
  rows.push({ label: "Potassium / magnesium", value: [k ? `K ${k.value} (${fmtDay(k.at)})` : "K not recorded", mg ? `Mg ${mg.value} (${fmtDay(mg.at)})` : "Mg not recorded"].join(" · "), tone: (k && k.value < 3.5) || (mg && mg.value < 0.7) ? "orange" : undefined });
  const drugs = ctx.meds.filter((m) => m.code === "amiodarone" || m.code === "sotalol" || m.tags.includes("bb") || m.tags.includes("bb-other")).map((m) => m.name);
  rows.push({ label: "Beta-blocker / antiarrhythmic", value: drugs.join(" + ") || "None" });
  const rec: string[] = [];
  if (g === "unstable") rec.push("Haemodynamically unstable VT/VF: immediate cardioversion or defibrillation (ALS), then this pathway.");
  if (a.what === "storm") {
    rec.push("Electrical storm with structural heart disease and monomorphic VT: amiodarone and a non-selective beta-blocker, with mild–moderate sedation (each class I, ESC VA 2022). Admit to a monitored bed; interrogate and reprogram the ICD.");
    rec.push("Recurrent storm: catheter ablation in an experienced centre is preferred over deep sedation, autonomic modulation or mechanical support.");
  }
  if (a.interrogation === "appropriate-mono" && ihd(ctx)) {
    if (onAmiodarone(ctx)) rec.push("Ischaemic heart disease, recurrent monomorphic VT despite amiodarone: catheter ablation rather than escalating antiarrhythmics (I).");
    else if (onBbOrSotalol(ctx)) rec.push("Ischaemic heart disease, recurrent monomorphic VT on a beta-blocker or sotalol: catheter ablation should be considered (IIa).");
    else rec.push("Ischaemic heart disease, first monomorphic VT: early catheter ablation may be considered (IIb).");
  }
  if (a.interrogation === "appropriate-poly") rec.push("Polymorphic VT / VF: look for acute ischaemia, electrolyte disturbance, QT prolongation and drugs.");
  if (a.interrogation === "inappropriate-svt") rec.push("Inappropriate shock for AF / SVT: control the rate or rhythm and reprogram detection to avoid further shocks.");
  if (a.interrogation === "inappropriate-lead") rec.push("Oversensing or lead fault: urgent device-team review; reprogram and revise the lead.");
  if (a.interrogation === "pending") rec.push("Interrogate the device: whether the shock was appropriate decides the management.");
  if (pickT(a).length) rec.push(`Correct the triggers found: ${pickT(a).join(", ")}.`);
  else rec.push("Look for triggers: potassium and magnesium, ischaemia, heart failure, thyroid function, QT-prolonging drugs.");
  rec.push("ICDs on remote monitoring should alert the clinic for every shock (I, HRS/EHRA/APHRS/LAHRS 2023). Driving advice follows the national rules.");
  return { heading: "ICD shock / ventricular arrhythmia: assessment", rows, recommendations: rec };
};
const TRIG: Record<string, string> = { electrolytes: "low potassium or magnesium", ischaemia: "ischaemia", hf: "heart failure", thyroid: "thyroid dysfunction", qt: "QT-prolonging drug", infection: "infection", adherence: "missed doses" };
const pickT = (a: Answers) => ((a.triggers as string[]) ?? []).filter((v) => v !== "none").map((v) => TRIG[v] ?? v);

// Closing summary: the procedure date the anticoagulation allows, and what the guideline asks around it.
RHYTHM_WIZARDS["peri-af-procedure"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const items = RHYTHM_WIZARDS["peri-af-procedure"].outcome!(a, ctx);
  const proc = items.find((o) => o.kind === "plan" && o.category === "procedure");
  const after = items.find((o) => o.kind === "plan" && /at least (4 weeks|2 months)/.test(o.title));
  const oac = ctx.meds.find((m) => m.tags.includes("oac"));
  const rows: Assessment["rows"] = [
    { label: "Procedure", value: proc && proc.kind === "plan" ? `${proc.title} · ${fmtDay(proc.dueDate, { year: true })}` : String(a.proc ?? "Not chosen") },
    {
      label: "Anticoagulation",
      value: oac ? `${oac.name}${a.oacNow === "3w" ? " · ≥3 weeks" : a.oacNow === "short" ? " · less than 3 weeks" : ""}` : a.start === "apixaban" ? "Apixaban to start" : a.start === "other" ? "Anticoagulant to start" : "None",
      tone: a.oacNow === "3w" || (a.proc === "cardioversion" && a.prep === "toe") ? "green" : "orange",
    },
  ];
  if (after && after.kind === "plan") rows.push({ label: "Anticoagulation until at least", value: fmtDay(after.dueDate, { year: true }) });
  if (ctx.af) rows.push({ label: "CHA₂DS₂-VA", value: String(ctx.af.score), tone: ctx.af.score >= 2 ? "orange" : undefined });
  const rec: string[] = [];
  if (a.proc === "cardioversion") {
    if (a.prep === "early" && a.onset !== "lt24") rec.push("Early cardioversion without TOE only with a known AF onset <24 h; otherwise ≥3 weeks of effective anticoagulation or TOE first (I B).");
    if (a.prep === "wait" && a.oacNow !== "3w") rec.push("Cardioversion after ≥3 weeks of effective anticoagulation (I B): the date above counts from the start of anticoagulation.");
    rec.push("Anticoagulation for at least 4 weeks after cardioversion.");
  } else if (a.proc === "ablation") {
    rec.push("AF ablation on uninterrupted oral anticoagulation (I A), continued for at least 2 months after it.");
  }
  rec.push(ctx.af ? `Long-term anticoagulation follows the stroke risk (CHA₂DS₂-VA ${ctx.af.score}), not the rhythm achieved.` : "Long-term anticoagulation follows CHA₂DS₂-VA, not the rhythm achieved.");
  if (oac?.tags.includes("vka")) rec.push("Warfarin: INR 2.0–3.0 throughout the weeks before cardioversion.");
  return { heading: "Anticoagulation around the procedure", rows, recommendations: rec };
};
