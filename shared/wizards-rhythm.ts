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
//    digoxin when LVEF ≤40%; lenient target, resting heart rate <110 bpm (IIa).
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
import { addDays } from "./clinical.js";
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

export const RHYTHM_WIZARDS: Record<string, WizardDef> = {
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
    cardioversion: ["procedure", "Cardioversion (after ≥3 weeks of OAC or TOE-guided)"],
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
  if (score != null && score >= 2 && !onOac && !["apixaban", "other-doac"].includes(String(a.oac))) rec.push(`CHA₂DS₂-VA ${score}: oral anticoagulation is recommended (I), a DOAC in preference to warfarin.`);
  if (score === 1 && !onOac && a.oac !== "apixaban" && a.oac !== "other-doac") rec.push("CHA₂DS₂-VA 1: oral anticoagulation should be considered (IIa).");
  for (const d of af?.doac ?? []) if (d.dose != null && d.dose !== d.right) rec.push(`${d.code[0].toUpperCase() + d.code.slice(1)} ${d.dose} mg: the label dose is ${d.right} mg (${d.why}).`);
  if (ctx.meds.some((m) => m.code === "aspirin") && !(ctx.dx ?? []).some((x) => ["cad", "pad", "ascvd"].includes(x)) && !pick(a, "bleed").includes("stop-asa")) rec.push("Aspirin is not used for stroke prevention in AF (III).");
  if (hr != null && hr >= 110 && !pick(a, "rate").length) rec.push(`Heart rate ${hr} bpm: lenient rate control targets a resting rate <110 bpm (IIa).`);
  if (lvef != null && lvef <= 40 && pick(a, "rate").includes("ccb")) rec.push("LVEF ≤40%: diltiazem and verapamil are avoided; beta-blocker and/or digoxin.");
  if (lvef == null && !pick(a, "tests").includes("echo")) rec.push("No LVEF recorded: echocardiography guides rate and rhythm choices.");
  if (a.pattern === "paroxysmal" && !pick(a, "rhythm").includes("ablation")) rec.push("Paroxysmal AF: catheter ablation is a first-line rhythm-control option (I A) within shared decision-making.");
  if (pick(a, "rhythm").includes("cardioversion")) rec.push("Cardioversion: ≥3 weeks of effective anticoagulation or TOE first (without TOE only if onset <24 h); continue anticoagulation ≥4 weeks after, then by CHA₂DS₂-VA.");
  if (pick(a, "rhythm").includes("aad") && (ctx.dx ?? []).some((x) => ["cad", "hf", "ascvd"].includes(x))) rec.push("Structural or ischaemic heart disease: no flecainide or propafenone; amiodarone (or dronedarone if no HFrEF).");
  rec.push("Reassess AF-CARE at 6 months, then at least yearly.");
  return { heading: "AF-CARE: risk and recommendations", rows, recommendations: rec };
};
