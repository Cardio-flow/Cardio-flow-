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
// Class I triggers (2025, read in guideline summaries — Rev Esp Cardiol 2025, Eur Heart J Suppl 2026,
// EJPC 2026): symptomatic severe AS; asymptomatic AS with LVEF <50%; AR symptomatic or LVEF ≤50%, LVESD
// >50 mm or LVESDi >25 mm/m² (I B); primary MR symptomatic or LVESD ≥40 mm, LVESDi ≥20 mm/m², LVEF ≤60%.
import type { Answers, Assessment, OutcomeItem, WizardContext, WizardDef } from "./wizards.js";
import { addDays, fmtDay } from "./clinical.js";

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

// Antithrombotic therapy after valve intervention (valve module, slice 4). Recommendations read verbatim
// from the 2025 ESC/EACTS VHD guidelines (Praz et al., Eur Heart J 2025):
//  - TAVI: low-dose ASA (75–100 mg/day) for 12 months without an indication for OAC (I A); DAPT not
//    recommended unless there is a clear indication (III B); routine OAC not recommended without a
//    baseline indication (III A); OAC recommended with another indication for OAC (I B).
//  - Surgical bioprosthesis: OAC continued when there is a clear indication (I B); lifelong low-dose ASA
//    from 3 months may be considered (IIb C). The first 3 months are left to the surgical team.
//  - Surgical MV/TV repair: OAC (VKA or DOAC) during the first 3 months should be considered (IIa B);
//    low-dose ASA in preference to OAC may be considered without an OAC indication at high bleeding
//    risk (IIb B).
//  - Mechanical valve: lifelong VKA (I A); INR target by valve type, position and patient risk factors
//    (I A); patient education (I A); DOACs and/or DAPT not recommended (III A); adding low-dose ASA should
//    be considered with symptomatic atherosclerotic disease (IIa B).
// Starts are maintenance only: aspirin 100 mg daily (catalogue dose, within 75–100 mg), and apixaban at
// the AF label dose only when the anticoagulation indication is AF. Warfarin is never dosed here.
const INTERVENTION: Record<string, string> = {
  tavi: "TAVI", bio: "Surgical bioprosthesis", mech: "Mechanical valve", repair: "Surgical mitral or tricuspid repair",
};
export const interventionFor = (type: string, procedure: string, position: string) =>
  type === "TAVI" || (procedure === "Valve-in-valve" && position === "Aortic") ? "tavi"
  : type === "Mechanical" ? "mech"
  : type === "Bioprosthetic (surgical)" ? "bio"
  : procedure === "Surgical repair" && (position === "Mitral" || position === "Tricuspid") ? "repair" : null;

VALVE_WIZARDS["valve-antithrombotic"] = {
  id: "valve-antithrombotic", title: "Antithrombotic therapy after valve intervention", tone: "yellow", group: "Valve disease", episode: false,
  source: "ESC/EACTS VHD 2025",
  note: "The regimen follows the intervention and whether there is another indication for anticoagulation or for dual antiplatelet therapy. After TAVI, aspirin alone unless another indication; after a mechanical valve, lifelong warfarin to the INR target.",
  facts: ["inr", "haemoglobin", "creatinine", "egfr"],
  steps: [
    {
      id: "intervention", title: "The intervention",
      questions: [
        { id: "intervention", label: "Intervention", type: "single", required: true, options: Object.entries(INTERVENTION).map(([value, label]) => ({ value, label })) },
        {
          id: "indications", label: "Other antithrombotic indications", type: "multi", required: true,
          options: [
            { value: "none", label: "None" },
            { value: "af", label: "AF / atrial flutter", detectCondition: ["af", "flutter"] },
            { value: "vte", label: "Venous thromboembolism", detectCondition: ["pe"] },
            { value: "pci", label: "PCI or ACS in the last 12 months" },
            { value: "athero", label: "Symptomatic atherosclerotic disease", hint: "Coronary, cerebrovascular or peripheral" },
          ],
        },
        {
          id: "bleeding", label: "Bleeding risk", type: "single", required: true,
          options: [{ value: "usual", label: "Not high" }, { value: "high", label: "High bleeding risk" }],
        },
      ],
    },
    {
      id: "regimen", title: "Regimen",
      questions: [
        {
          id: "tavi", label: "After TAVI", type: "single", required: true, showIf: { question: "intervention", includes: "tavi" },
          options: [
            { value: "asa", label: "Aspirin 100 mg daily for 12 months", hint: "No indication for anticoagulation (I A)" },
            { value: "oac", label: "Anticoagulant", hint: "Another indication for anticoagulation (I B)" },
            { value: "dapt", label: "Dual antiplatelet therapy", hint: "Only with a clear indication, e.g. recent PCI or ACS" },
          ],
        },
        {
          id: "bio", label: "After a surgical bioprosthesis", type: "single", required: true, showIf: { question: "intervention", includes: "bio" },
          options: [
            { value: "oac", label: "Continue the anticoagulant", hint: "Clear indication for anticoagulation (I B)" },
            { value: "early-vka", label: "Warfarin for the first 3 months, then aspirin", hint: "Mitral, tricuspid or aortic bioprosthesis · class to confirm" },
            { value: "early-asa", label: "Aspirin 100 mg from the start", hint: "Aortic bioprosthesis only · class to confirm" },
            { value: "asa", label: "Lifelong aspirin 100 mg from 3 months", hint: "May be considered (IIb C)" },
            { value: "surgeon", label: "As set by the surgical team" },
          ],
        },
        {
          id: "repair", label: "After surgical mitral or tricuspid repair", type: "single", required: true, showIf: { question: "intervention", includes: "repair" },
          options: [
            { value: "oac", label: "Anticoagulant for the first 3 months", hint: "VKA or DOAC (IIa B)" },
            { value: "asa", label: "Aspirin 100 mg instead", hint: "High bleeding risk, no indication for anticoagulation (IIb B)" },
          ],
        },
        {
          id: "mech", label: "Mechanical valve", type: "multi", required: true, showIf: { question: "intervention", includes: "mech" },
          options: [
            { value: "vka", label: "Warfarin for life, to the INR target", hint: "I A" },
            { value: "asa", label: "Add aspirin 100 mg", hint: "Symptomatic atherosclerotic disease (IIa B)" },
            { value: "switch", label: "Switch a DOAC to warfarin", hint: "DOACs are not recommended (III A)", requires: ["doac"] },
          ],
        },
        {
          id: "care", label: "Also", type: "multi", required: true,
          options: [
            { value: "none", label: "Nothing more" },
            { value: "education", label: "Anticoagulation education", hint: "INR target, interactions, bleeding" },
            { value: "endocarditis", label: "Endocarditis prevention advice", hint: "Dental and skin hygiene; dental check-ups" },
            { value: "echo", label: "Baseline echo after the intervention", hint: "Reference for later follow-up: 6 weeks–3 months after implantation (EACVI 2016)" },
          ],
        },
        { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
      ],
    },
  ],
};

const picks = (a: Answers, id: string) => ((a[id] as string[]) ?? []).filter((v) => v !== "none");
// the latest intervention of the chosen kind, for the dates counted from it
const interventionOf = (a: Answers, ctx: WizardContext) =>
  (ctx.valve?.interventions ?? []).find((v) => interventionFor(v.type, v.procedure, v.position) === a.intervention) ?? null;

VALVE_WIZARDS["valve-antithrombotic"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const out: OutcomeItem[] = [];
  const t = ctx.today;
  const plan = (category: string, title: string, due = t, link: { id?: string | null; ref?: string } = {}): OutcomeItem =>
    ({ kind: "plan", category, title, dueDate: due < t ? t : due, completesOn: { type: "manual" }, label: "", medicationId: link.id ?? null, medicationRef: link.ref });
  const has = (re: RegExp) => (ctx.planned ?? []).some((x) => re.test(x));
  const asa = ctx.meds.find((m) => m.code === "aspirin");
  const p2y12 = ctx.meds.filter((m) => m.tags.includes("p2y12"));
  const oac = ctx.meds.filter((m) => m.tags.includes("oac"));
  const doac = oac.filter((m) => m.tags.includes("doac"));
  const ind = picks(a, "indications");
  const iv = interventionOf(a, ctx);
  const day = iv?.day ?? t;
  const startAsa = (why: string) => {
    if (!asa) out.push({ kind: "start", code: "aspirin", doseValue: 100, frequency: "OD", indication: "valve", label: `Aspirin 100 mg daily: start (${why})` });
    return asa ? { id: asa.id } : { ref: "code:aspirin" };
  };
  const stopP2y12 = (why: string) => {
    if (!ind.includes("pci")) for (const m of p2y12) out.push({ kind: "medication", medicationId: m.id, event: "stop", doseValue: null, label: `${m.name}: stop (${why})` });
  };
  const startOac = (why: string) => {
    if (oac.length) return;
    out.push(plan("medication", `Start an anticoagulant (${why})`));
  };
  if (a.intervention === "tavi") {
    if (a.tavi === "asa") {
      const link = startAsa("12 months after TAVI");
      stopP2y12("dual antiplatelet therapy is not recommended after TAVI without a clear indication");
      if (!ind.includes("af") && !ind.includes("vte"))
        for (const m of oac) out.push({ kind: "medication", medicationId: m.id, event: "stop", doseValue: null, label: `${m.name}: stop (no indication for anticoagulation after TAVI)` });
      if (!has(/aspirin.*TAVI|TAVI.*aspirin/i)) out.push(plan("medication", "Review aspirin 12 months after TAVI", addDays(day, 365), link));
    }
    if (a.tavi === "oac") startOac(ind.includes("af") ? "AF, at the label dose" : "indication other than the valve");
    if (a.tavi === "dapt" && !ind.includes("pci")) out.push(plan("medication", "Dual antiplatelet therapy after TAVI: record the indication or step down to aspirin"));
  }
  if (a.intervention === "bio") {
    if (a.bio === "oac") startOac("clear indication after a surgical bioprosthesis");
    if (a.bio === "early-vka") {
      const vka = oac.find((m) => m.tags.includes("vka"));
      const end = addDays(day, 91);
      if (!vka) out.push(plan("medication", "Start warfarin for the first 3 months after the surgical bioprosthesis"));
      if (!ind.includes("af") && !ind.includes("vte") && end > t) {
        out.push(plan("medication", "Stop warfarin 3 months after the surgical bioprosthesis (no other indication)", end, vka ? { id: vka.id } : {}));
        if (!asa) out.push(plan("medication", "Start long-term aspirin 100 mg when warfarin stops (surgical bioprosthesis)", end));
      }
    }
    if (a.bio === "early-asa") startAsa("from the start after an aortic bioprosthesis, then long-term");
    if (a.bio === "asa") {
      const from = addDays(day, 91);
      if (from > t && !asa) out.push(plan("medication", "Start lifelong aspirin 100 mg (3 months after the surgical bioprosthesis)", from));
      else startAsa("lifelong after a surgical bioprosthesis");
    }
  }
  if (a.intervention === "repair") {
    const end = addDays(day, 91);
    if (a.repair === "oac") {
      startOac("first 3 months after valve repair: VKA or DOAC");
      if (!ind.includes("af") && !ind.includes("vte") && end > t)
        out.push(plan("medication", "Stop anticoagulation 3 months after valve repair (no other indication)", end, oac[0] ? { id: oac[0].id } : {}));
    }
    if (a.repair === "asa") startAsa("after valve repair, high bleeding risk");
  }
  if (a.intervention === "mech") {
    const mech = picks(a, "mech");
    const target = ctx.valve?.inrTarget ? ` · INR target ${ctx.valve.inrTarget}` : "";
    if (mech.includes("vka") && !oac.some((m) => m.tags.includes("vka"))) out.push(plan("medication", `Start warfarin for the mechanical valve${target}`));
    if (mech.includes("switch")) for (const m of doac) out.push(plan("medication", `Switch ${m.name.toLowerCase()} to warfarin (mechanical valve)${target}`, t, { id: m.id }));
    if (mech.includes("asa")) startAsa("mechanical valve with symptomatic atherosclerotic disease");
    stopP2y12("dual antiplatelet therapy is not recommended with a mechanical valve");
  }
  const care = picks(a, "care");
  if (care.includes("education")) out.push({ kind: "plan", category: "education", title: a.intervention === "mech" && ctx.valve?.inrTarget ? `Anticoagulation education (INR target ${ctx.valve.inrTarget})` : "Antithrombotic therapy education", dueDate: t, completesOn: { type: "manual" }, label: "" });
  if (care.includes("endocarditis") && !has(/endocarditis prevention/i)) out.push({ kind: "plan", category: "education", title: "Endocarditis prevention advice (prosthetic valve / repair)", dueDate: t, completesOn: { type: "manual" }, label: "" });
  if (care.includes("echo") && !has(/baseline echo/i)) {
    const d = addDays(day, 42);
    out.push({ kind: "plan", category: "investigation", title: "Baseline echo after the valve intervention (reference for follow-up)", dueDate: d < t ? t : d, completesOn: { type: "study", kind: "echo" }, label: "" });
  }
  return out;
};

VALVE_WIZARDS["valve-antithrombotic"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const iv = interventionOf(a, ctx);
  const on = ctx.meds.filter((m) => m.tags.includes("oac") || m.tags.includes("antiplatelet")).map((m) => m.name);
  const ind = picks(a, "indications");
  const rows: Assessment["rows"] = [
    { label: "Intervention", value: iv ? `${iv.name} · ${fmtDay(iv.day, { year: true })}` : INTERVENTION[String(a.intervention)] ?? "Not given" },
    { label: "Antithrombotic now", value: on.length ? on.join(" + ") : "None", tone: on.length ? undefined : "orange" },
    { label: "Other indications", value: ind.length ? ind.map((v) => ({ af: "AF / flutter", vte: "Venous thromboembolism", pci: "Recent PCI / ACS", athero: "Symptomatic atherosclerosis" }[v] ?? v)).join(", ") : "None" },
  ];
  if (a.intervention === "mech") rows.push({ label: "INR target", value: ctx.valve?.inrTarget ?? "Record the valve design and position", tone: ctx.valve?.inrTarget ? undefined : "orange" });
  const rec: string[] = [];
  const oacInd = ind.includes("af") || ind.includes("vte");
  if (a.intervention === "tavi") {
    rec.push(oacInd ? "Another indication for anticoagulation: anticoagulation after TAVI (I B)." : "No indication for anticoagulation: aspirin 75–100 mg daily for 12 months (I A); routine anticoagulation is not recommended (III A).");
    if (!ind.includes("pci")) rec.push("Dual antiplatelet therapy is not recommended after TAVI without a clear indication (III B).");
  }
  if (a.intervention === "bio") {
    if (oacInd) rec.push("Clear indication: continue anticoagulation (I B).");
    else {
      rec.push("First 3 months: VKA after a mitral or tricuspid bioprosthesis; VKA or single antiplatelet therapy after an aortic bioprosthesis; then long-term single antiplatelet therapy (ESC/EACTS 2025 as quoted in the EJPC 2026 comparison review; class to confirm in the guideline table).");
      rec.push("Lifelong aspirin 75–100 mg from 3 months may be considered (IIb C).");
      const iv = interventionOf(a, ctx);
      if (a.bio === "early-asa" && iv && iv.position !== "Aortic") rec.push(`${iv.position} bioprosthesis: aspirin alone in the first 3 months is described for aortic bioprostheses only; VKA is the described option.`);
    }
  }
  if (a.intervention === "repair") rec.push(a.bleeding === "high" && !oacInd ? "High bleeding risk, no indication for anticoagulation: aspirin in preference to anticoagulation may be considered (IIb B)." : "Anticoagulation (VKA or DOAC) during the first 3 months after repair should be considered (IIa B).");
  if (a.intervention === "mech") {
    rec.push("Lifelong warfarin to the INR target set by valve type, position and patient risk factors (I A), with patient education (I A).");
    rec.push("DOACs and dual antiplatelet therapy are not recommended with a mechanical valve (III A).");
    if (ind.includes("athero")) rec.push("Symptomatic atherosclerotic disease: adding aspirin 75–100 mg should be considered (IIa B).");
  }
  return { heading: "Antithrombotic therapy after valve intervention", rows, recommendations: rec };
};

// Prosthetic valve thrombosis or dysfunction (valve module, slice 5; opens an episode). Recommendations
// read verbatim from the 2025 ESC/EACTS VHD guidelines (Praz et al., Eur Heart J 2025):
//  - TOE and/or 4D-CT to confirm suspected valve thrombosis (I C).
//  - Acute HF (NYHA III–IV) from obstructive mechanical valve thrombosis: Heart Team evaluation to decide
//    between repeat valve replacement and low-dose slow-infusion fibrinolysis (I B). CardioFlow names the
//    options; it never doses fibrinolysis or heparin.
//  - Bioprosthetic valve thrombosis: OAC with a VKA before considering reintervention (I B).
//  - Mechanical valve dysfunction not due to thrombosis, symptomatic: reoperation (I C). Bioprosthetic:
//    reintervention (I C); transfemoral aortic valve-in-valve at intermediate or high surgical risk with
//    suitable anatomy (IIa B); transvenous mitral or tricuspid valve-in-valve (IIa B).
//  - Paravalvular leak: Heart Team decides transcatheter vs surgical closure (I C); transcatheter closure
//    for suitable leaks with significant regurgitation and/or haemolysis (IIa B).
// Not encoded (not found in the 2025 text): the fibrinolysis regimen, management of non-obstructive
// thrombosis and of obstruction without acute HF, the haemodynamic valve deterioration criteria.
export const PROSTHESIS_KIND: Record<string, string> = {
  mech: "Mechanical valve", bio: "Surgical bioprosthesis", thv: "Transcatheter valve (TAVI)", repair: "Valve repair / ring / clip",
};
export const prosthesisKind = (type: string | null | undefined) =>
  type === "Mechanical" ? "mech" : type === "Bioprosthetic (surgical)" || type === "Bioprosthetic" ? "bio"
  : type === "TAVI" || type === "Transcatheter valve" ? "thv" : type === "Repair / ring" || type === "Edge-to-edge repair (clip)" ? "repair" : null;
const FINDING: Record<string, string> = {
  "thrombus-obstructive": "Valve thrombosis, obstructive", "thrombus": "Valve thrombosis, not obstructive / leaflet thickening",
  dysfunction: "Structural valve dysfunction (degeneration, pannus, failed repair)", pvl: "Paravalvular leak", endocarditis: "Suspected prosthetic valve endocarditis", unclear: "Not yet clear",
};

VALVE_WIZARDS["prosthetic-valve"] = {
  id: "prosthetic-valve", title: "Prosthetic valve thrombosis or dysfunction", tone: "orange", group: "Valve disease",
  source: "ESC/EACTS VHD 2025",
  note: "Confirm the cause first: thrombosis, structural dysfunction, a paravalvular leak or endocarditis. Thrombosis is confirmed with TOE and/or 4D-CT; the Heart Team decides between reoperation, fibrinolysis and transcatheter options.",
  facts: ["inr", "haemoglobin", "creatinine", "av-mg", "av-vmax"],
  steps: [
    {
      id: "presentation", title: "Presentation",
      questions: [
        { id: "prosthesis", label: "Prosthesis", type: "single", required: true, options: Object.entries(PROSTHESIS_KIND).map(([value, label]) => ({ value, label })) },
        {
          id: "presentation", label: "How it presented", type: "multi", required: true,
          options: [
            { value: "ahf", label: "Acute heart failure, NYHA III–IV" },
            { value: "dyspnoea", label: "New or worse breathlessness" },
            { value: "embolism", label: "Stroke, TIA or systemic embolism" },
            { value: "haemolysis", label: "Haemolysis (anaemia, raised LDH)" },
            { value: "click", label: "New murmur or muffled valve click" },
            { value: "fever", label: "Fever / possible endocarditis" },
            { value: "echo", label: "Found on echo (gradient or regurgitation)" },
          ],
        },
        {
          id: "inr", label: "INR in the weeks before", type: "single", showIf: { question: "prosthesis", includes: "mech" },
          options: [{ value: "in-range", label: "In range" }, { value: "low", label: "Below target" }, { value: "unknown", label: "Not known" }],
        },
      ],
    },
    {
      id: "finding", title: "Imaging & cause",
      questions: [
        {
          id: "imaging", label: "Imaging", type: "multi", required: true,
          options: [
            { value: "tte", label: "Transthoracic echo done" },
            { value: "toe", label: "TOE", effects: { plan: [{ category: "investigation", title: "TOE: prosthetic valve (thrombus, leaflet motion, leak)", days: 0, completesOn: { type: "manual" } }] } },
            { value: "ct", label: "4D cardiac CT", effects: { plan: [{ category: "investigation", title: "4D cardiac CT: prosthetic valve", days: 0, completesOn: { type: "study", kind: "ccta" } }] } },
            { value: "cultures", label: "Blood cultures ×3", effects: { plan: [{ category: "investigation", title: "Blood cultures ×3 (prosthetic valve)", days: 0, completesOn: { type: "manual" } }] } },
          ],
        },
        { id: "cause", label: "Cause, so far", type: "single", required: true, options: Object.entries(FINDING).map(([value, label]) => ({ value, label })) },
        { id: "risk", label: "Surgical risk", type: "single", options: [{ value: "low", label: "Low" }, { value: "intermediate", label: "Intermediate" }, { value: "high", label: "High / prohibitive" }] },
      ],
    },
    {
      id: "management", title: "Management",
      questions: [
        {
          id: "actions", label: "Plan", type: "multi", required: true,
          options: [
            { value: "none", label: "Observe; no change yet" },
            { value: "heart-team", label: "Heart Team now", hint: "Reoperation, fibrinolysis or transcatheter options", effects: { plan: [{ category: "referral", title: "Heart Team: prosthetic valve (urgent)", days: 0, completesOn: { type: "manual" } }] } },
            { value: "vka", label: "Warfarin (VKA)", hint: "Bioprosthetic thrombosis: before any reintervention" },
            { value: "redo", label: "Reoperation / reintervention referral", effects: { plan: [{ category: "referral", title: "Cardiac surgery referral: prosthetic valve reintervention", days: 7, completesOn: { type: "manual" } }] } },
            { value: "viv", label: "Valve-in-valve assessment", effects: { plan: [{ category: "investigation", title: "Valve-in-valve assessment (CT, Heart Team)", days: 14, completesOn: { type: "manual" } }] } },
            { value: "pvl", label: "Paravalvular leak closure assessment", effects: { plan: [{ category: "referral", title: "Paravalvular leak: transcatheter vs surgical closure (Heart Team)", days: 14, completesOn: { type: "manual" } }] } },
            { value: "haemolysis", label: "Haemolysis bloods", effects: { plan: [{ category: "monitoring", title: "Haemolysis screen: Hb, LDH, bilirubin, reticulocytes, haptoglobin", days: 0, completesOn: { type: "manual" } }] } },
            { value: "endocarditis", label: "Endocarditis pathway", hint: "Duke-ISCVID, Endocarditis Team" },
          ],
        },
        { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
      ],
    },
  ],
};

VALVE_WIZARDS["prosthetic-valve"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const out: OutcomeItem[] = [];
  const t = ctx.today;
  const acts = ((a.actions as string[]) ?? []).filter((v) => v !== "none");
  const target = a.prosthesis === "mech" && ctx.valve?.inrTarget ? ` · INR target ${ctx.valve.inrTarget}` : "";
  const vka = ctx.meds.find((m) => m.tags.includes("vka"));
  if (acts.includes("vka"))
    out.push({ kind: "plan", category: "medication", title: vka ? `Warfarin: INR to target (prosthetic valve)${target}` : `Start warfarin (prosthetic valve ${String(a.cause).startsWith("thrombus") ? "thrombosis" : "dysfunction"})${target}`, dueDate: t, completesOn: { type: "manual" }, label: "", medicationId: vka?.id ?? null });
  if (acts.includes("endocarditis")) out.push({ kind: "note", label: "Open the endocarditis pathway next (Pathways → Inflammatory & infective heart disease)" });
  return out;
};

VALVE_WIZARDS["prosthetic-valve"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const kind = String(a.prosthesis), cause = String(a.cause);
  const pres = (a.presentation as string[]) ?? [];
  const pros = (ctx.valve?.prostheses ?? []).filter((p) => prosthesisKind(p.type) === kind);
  const inr = ctx.values?.inr;
  const rows: Assessment["rows"] = [
    { label: "Prosthesis", value: pros.length ? pros.map((p) => `${p.position} · ${p.type}`).join(", ") : PROSTHESIS_KIND[kind] ?? "Not given" },
    { label: "Cause so far", value: FINDING[cause] ?? "Not given", tone: "orange" },
  ];
  if (kind === "mech") rows.push({ label: "INR", value: inr ? `${inr.value}${ctx.valve?.inrTarget ? ` · target ${ctx.valve.inrTarget}` : ""}` : "Not recorded", tone: a.inr === "low" ? "orange" : undefined });
  const rec: string[] = [];
  if (cause.startsWith("thrombus") || cause === "unclear") rec.push("Suspected valve thrombosis: TOE and/or 4D-CT to confirm the diagnosis (I C).");
  if (cause === "thrombus-obstructive" && kind === "mech")
    rec.push(pres.includes("ahf") ? "Acute HF (NYHA III–IV) from obstructive mechanical valve thrombosis: Heart Team evaluation to decide between repeat valve replacement and low-dose slow-infusion fibrinolysis (I B)." : "Obstructive mechanical valve thrombosis: urgent Heart Team discussion.");
  if (cause.startsWith("thrombus") && (kind === "bio" || kind === "thv")) rec.push("Bioprosthetic valve thrombosis: anticoagulation with a VKA before considering reintervention (I B).");
  if (kind === "mech" && a.inr === "low") rec.push("INR below target before the event: review adherence, interactions and INR monitoring.");
  if (cause === "dysfunction") {
    if (kind === "mech") rec.push("Symptomatic significant mechanical valve dysfunction not due to thrombosis: reoperation (I C).");
    else {
      rec.push("Symptomatic significant valve dysfunction not due to thrombosis: reintervention (I C).");
      if (a.risk === "intermediate" || a.risk === "high") {
        const pos = new Set(pros.map((p) => p.position));
        const aortic = "transcatheter transfemoral aortic valve-in-valve when the anatomy and prosthesis are suitable, as assessed by the Heart Team (IIa B)";
        const av = "transcatheter transvenous mitral or tricuspid valve-in-valve if the anatomy is suitable (IIa B)";
        rec.push(`Intermediate or high surgical risk: ${pos.has("Aortic") && !pos.has("Mitral") && !pos.has("Tricuspid") ? aortic : !pos.has("Aortic") && pos.size ? av : `${aortic}; ${av}`}.`);
      }
    }
  }
  if (cause === "pvl") rec.push("Clinically significant paravalvular leak: Heart Team decides transcatheter vs surgical closure (I C); transcatheter closure for suitable leaks with significant regurgitation and/or haemolysis (IIa B).");
  if (cause === "endocarditis" || pres.includes("fever")) rec.push("Possible prosthetic valve endocarditis: blood cultures before antibiotics, TOE, and the endocarditis pathway.");
  if (pres.includes("embolism") && kind === "mech") rec.push("Embolism with a mechanical valve: confirm the INR history and image the valve for thrombus.");
  return { heading: "Prosthetic valve: assessment", rows, recommendations: rec };
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
    if (sym) rec.push("Symptomatic severe AS: intervention (I).");
    if (a.lv === "lt50" && !sym) rec.push("Asymptomatic severe AS with LVEF <50%: intervention (I).");
    if (!sym && a.lv !== "lt50" && low && a.lowflow !== "yes") rec.push("Asymptomatic severe high-gradient AS, LVEF ≥50%, low procedural risk (normal exercise test if feasible): intervention should be considered as an alternative to close surveillance (IIa A).");
    if (age != null && age >= 70 && anat.includes("tricuspid") && !anat.includes("no-tf")) rec.push(`Age ${age}, tricuspid valve, suitable anatomy: TAVI (I A).`);
    if (age != null && age < 70 && low) rec.push(`Age ${age}, low surgical risk: SAVR (I B).`);
    if (anat.includes("bicuspid")) rec.push("Bicuspid AS: TAVI may be considered (IIb B); surgery is the reference.");
    if (anat.includes("no-tf")) rec.push("No transfemoral access: non-transfemoral TAVI should be considered when surgery is not suitable (IIa B).");
  }
  if (a.lesion === "mr-primary") {
    if (sym) rec.push("Symptomatic severe primary MR: surgery, repair preferred (I).");
    if (a.lv !== "gt60" || ((a.mrFeatures as string[]) ?? []).includes("lvesd")) rec.push("LVEF ≤60%, LVESD ≥40 mm or LVESDi ≥20 mm/m²: surgery (I).");
    else if (!sym && low && mrRepairFeatures(a) >= 3) rec.push(`Asymptomatic, low risk, LVEF >60%, LVESD <40 mm with ${mrRepairFeatures(a)} of AF, SPAP >50, LA dilatation, TR ≥ moderate: repair (I B).`);
    if (a.risk === "high" || a.risk === "prohibitive") rec.push("High surgical risk: TEER should be considered (IIa B).");
  }
  if (a.lesion === "mr-secondary" && sym && a.lv === "lt50") rec.push("Symptomatic secondary MR with LVEF <50% despite optimised therapy, meeting the selection criteria: TEER (I A).");
  if (a.lesion === "ar") {
    if (sym) rec.push("Symptomatic severe AR: surgery (I).");
    if (a.lv === "lt50") rec.push("LVEF ≤50% (or LVESD >50 mm / LVESDi >25 mm/m²): surgery (I B).");
    if (!sym && low) rec.push("Asymptomatic, low risk: surgery may be considered with LVESDi >22 mm/m², LVESVi >45 mL/m² or LVEF ≤55% (IIb B).");
    rec.push("Valve repair in selected patients (IIa B); TAVI only when ineligible for surgery (IIb B).");
  }
  if (a.lesion === "tr") rec.push("Severe TR: Heart Team evaluation (I C); transcatheter treatment should be considered when surgery is not suitable (IIa A).");
  if (((a.factors as string[]) ?? []).includes("comorbid")) rec.push("Limited life expectancy: intervention is unlikely to improve outcome; consider medical therapy.");
  return { heading: "Severe valve disease: Heart Team assessment", rows, recommendations: rec };
};
