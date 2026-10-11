// Structural intervention pathways on the existing decision/plan engine.
// Verified sources and limits: docs/structural-guideline-matrix.md.
import type {
  Answers,
  Assessment,
  OutcomeItem,
  Question,
  WizardContext,
  WizardDef,
} from "./wizards.js";
import { addCalendarMonths } from "./af.js";
const source =
  "ESC/EACTS VHD 2025 · doi:10.1093/eurheartj/ehaf194; current regional device IFU";
const q = (
  id: string,
  label: string,
  options: [string, string][],
  help?: string,
): Question => ({
  id,
  label,
  type: "single",
  required: true,
  help,
  options: options.map(([value, label]) => ({ value, label })),
});
const date = (id: string, label: string): Question => ({
  id,
  label,
  type: "date",
  required: true,
});
const p = (
  category: string,
  title: string,
  dueDate: string,
  completesOn: Record<string, unknown> = { type: "manual" },
): OutcomeItem => ({
  kind: "plan",
  category,
  title,
  dueDate,
  completesOn,
  label: "",
});
const base = {
  tone: "blue" as const,
  group: "Valve disease" as const,
  episode: false,
  source,
  sourceShort: "ESC/EACTS 2025 · Device IFU",
  facts: ["lvef", "lvesd", "spap", "creatinine", "haemoglobin", "nt-probnp"],
};
const conditional = (
  question: Question,
  id: string,
  value: string,
): Question => ({ ...question, showIf: { question: id, includes: value } });
const common = [
  q("safety", "Clinical stability", [
    ["stable", "Stable for elective evaluation"],
    ["urgent", "Unstable / urgent symptoms"],
  ]),
  q("benefit", "Expected benefit and patient goals", [
    ["yes", "Meaningful benefit and goals agreed"],
    ["unknown", "Uncertain benefit / needs discussion"],
  ]),
  q("team", "Heart Team and patient decision", [
    ["yes", "Documented shared decision for this intervention"],
    ["pending", "Heart Team / consent pending"],
  ]),
];
const checks = [
  q("coronary", "Coronary assessment and treatment strategy", [
    ["reviewed", "Reviewed; coronary strategy agreed"],
    ["pending", "Missing / revascularization decision pending"],
  ]),
  q("labs", "Blood count, renal function and bleeding assessment", [
    ["reviewed", "Results and contrast / bleeding plan reviewed"],
    ["pending", "Missing / needs optimization"],
  ]),
  q("infection", "Infection and endocarditis assessment", [
    ["clear", "No active infection; prevention plan reviewed"],
    ["pending", "Active infection / clearance uncertain"],
  ]),
  q("decision", "Next step", [
    ["workup", "Complete work-up / structural team review"],
    ["schedule", "Team agreed: schedule intervention"],
    ["defer", "Defer / alternative treatment"],
  ]),
  date("when", "Work-up / procedure / review date"),
];
function severe(c: WizardContext, code: string) {
  return (
    c.valve?.lesions.some((l) => l.code === code && l.severity === "Severe") ||
    c.valve?.echo[code.startsWith("mr-") ? "mr" : code] === "Severe"
  );
}
export function structuralPlanning(c: WizardContext, target: string) {
  return c.structural?.planning.find(
    (st) => st.findings.intervention === target,
  );
}
export function planningMissing(c: WizardContext, target: string): string[] {
  const st = structuralPlanning(c, target),
    a = st?.findings;
  if (!a) return ["Structural CT / 3D TOE report"];
  const missing: string[] = [];
  if (a.reviewed !== "Yes") missing.push("Structural team report review");
  if (a.suitability !== "Suitable") missing.push("Anatomical suitability");
  if (target === "TAVI") {
    if (!a.annulusArea && !a.annulusPerimeter)
      missing.push("Annulus measurement");
    if (!(a.leftCoronaryHeight > 0) || !(a.rightCoronaryHeight > 0))
      missing.push("Coronary heights");
    if (a.aorticRoot !== "Complete" || a.calcification !== "Complete")
      missing.push("Root / LVOT and calcification assessment");
    if (
      !["Transfemoral feasible", "Alternative access planned"].includes(
        a.access,
      )
    )
      missing.push("Vascular access plan");
  } else if (target.endsWith("TEER")) {
    if (!a.jetLocation || a.jetLocation === "Not assessed")
      missing.push("Jet / target segment");
    if (
      a.coaptationGap == null ||
      !(a.leafletLength > 0) ||
      a.leafletReview !== "Suitable under selected device IFU"
    )
      missing.push("Leaflet grasping and coaptation review");
    if (target === "Mitral TEER") {
      if (!(a.valveArea > 0) || a.meanGradient == null)
        missing.push("Valve area and baseline gradient");
      if (a.septum !== "Access suitable and no thrombus")
        missing.push("Transseptal access / thrombus review");
    } else {
      if (!["No lead", "No relevant interference"].includes(a.leadInteraction))
        missing.push("CIED lead strategy");
      if (
        a.rvFunction !== "No severe dysfunction" ||
        a.pulmonaryVascular !== "No pre-capillary PH"
      )
        missing.push("RV function / invasive pulmonary haemodynamics");
    }
  }
  return missing;
}
export function ventricularTeerMissing(c: WizardContext, a: Answers) {
  const n = (code: string) => c.values?.[code]?.value;
  const ef = n("lvef"),
    lv = n("lvesd"),
    pa = n("spap");
  const out: string[] = [];
  if (ef == null || ef < 20 || ef >= 50)
    out.push("LVEF 20–<50% for the Class I pathway");
  if (lv == null || lv > 70) out.push("LVESD ≤70 mm");
  if (pa == null || pa > 70) out.push("SPAP ≤70 mmHg");
  if (!["II", "III", "IV"].includes(c.valve?.nyha ?? ""))
    out.push("Documented NYHA ≥II");
  if (
    !c.structural?.hfAdmissionInYear &&
    !((n("nt-probnp") ?? -1) >= 1000) &&
    !((n("bnp") ?? -1) >= 300)
  )
    out.push("HF admission within a year or qualifying natriuretic peptide");
  if (
    a.exclusions !== "clear" ||
    (c.dx ?? []).some((x) => ["hcm", "rcm", "amyloid"].includes(x))
  )
    out.push(
      "Advanced HF / severe RV dysfunction / other valve disease / cardiomyopathy review",
    );
  return out;
}
function missing(a: Answers, c: WizardContext, target: string) {
  const out = planningMissing(c, target);
  if (!c.structural?.latestEchoId) out.push("Recorded baseline echocardiogram");
  if (c.values?.lvef?.value == null) out.push("Recorded LVEF");
  for (const [id, label] of [
    ["benefit", "Patient goals and benefit"],
    ["team", "Heart Team agreement"],
    ["coronary", "Coronary strategy"],
    ["labs", "Blood count / renal / bleeding assessment"],
    ["infection", "Infection assessment"],
  ] as const) {
    if (
      a[id] !==
      (
        {
          benefit: "yes",
          team: "yes",
          coronary: "reviewed",
          labs: "reviewed",
          infection: "clear",
        } as any
      )[id]
    )
      out.push(label);
  }
  if (target === "TAVI") {
    if (
      a.lesion !== "ar" &&
      ["ava", "av-vmax", "av-mg"].some(
        (code) => c.values?.[code]?.value == null,
      )
    )
      out.push("Recorded AV area, velocity and mean gradient");
    if (!severe(c, a.lesion === "ar" ? "ar" : "as"))
      out.push("Recorded severe aortic lesion");
    if (a.indication === "uncertain") out.push("Intervention indication");
    if (a.confirmation !== "yes") out.push("Integrated severity confirmation");
    if (a.lesion === "ar" && a.indication !== "symptomatic")
      out.push("Symptomatic severe AR indication");
    if (a.lesion === "ar" && a.risk !== "ineligible")
      out.push("Severe AR: surgery ineligibility");
    if (
      a.indication === "asymptomatic" &&
      (a.risk !== "low" ||
        a.exercise !== "normal" ||
        (c.values?.lvef?.value ?? 0) < 50)
    )
      out.push("Asymptomatic high-gradient AS selection review");
    if (a.indication === "lv" && !((c.values?.lvef?.value ?? 100) < 50))
      out.push("Recorded LV dysfunction");
    if (a.lesion === "lowflow" && a.confirmation !== "yes")
      out.push("Integrated low-flow severity confirmation");
  } else if (target.endsWith("TEER")) {
    if (a.symptoms !== "yes") out.push("Persistent symptoms");
    if (target === "Tricuspid TEER") {
      if (!severe(c, "tr")) out.push("Recorded severe TR");
      if (a.risk !== "high" && a.risk !== "ineligible")
        out.push("High surgical risk assessment");
      if (a.optimized !== "yes") out.push("Optimized medical therapy");
      if (a.rhc !== "reviewed" || !c.structural?.rhcId)
        out.push("Recorded RHC and PVR assessment");
    } else {
      if (!severe(c, a.phenotype === "primary" ? "mr-primary" : "mr-secondary"))
        out.push("Recorded severe MR");
      if (
        a.phenotype === "primary" &&
        !["high", "ineligible"].includes(String(a.risk))
      )
        out.push("Primary MR: high surgical risk");
      if (a.phenotype !== "primary" && a.optimized !== "yes")
        out.push("GDMT / CRT or HFpEF / rhythm optimization");
      if (a.phenotype === "atrial" && a.risk !== "ineligible")
        out.push("Atrial SMR: surgery ineligibility");
      if (a.phenotype === "ventricular")
        out.push(...ventricularTeerMissing(c, a));
    }
  }
  return [...new Set(out)];
}
function prepare(a: Answers, c: WizardContext, target: string): OutcomeItem[] {
  if (a.safety === "urgent")
    return [
      p("follow_up", "Urgent structural / emergency assessment", c.today),
    ];
  const gaps = missing(a, c, target),
    when = String(a.when);
  if (a.decision === "schedule" && !gaps.length)
    return [
      p("procedure", `${target} (documented Heart Team decision)`, when, {
        type: "procedure",
        kind: "valve",
        ...(target === "TAVI"
          ? { position: "Aortic", procedure: "TAVI" }
          : target.endsWith("TEER")
            ? {
                position: target.split(" ")[0],
                procedure: "Transcatheter edge-to-edge repair (TEER)",
              }
            : {}),
      }),
      p(
        "medication",
        `${target}: confirm device IFU, peri-procedure and postprocedure antithrombotic plan`,
        when,
      ),
    ];
  const out = [
    p(
      "referral",
      `${target}: ${a.decision === "defer" ? "alternative treatment / benefit review" : "complete Heart Team preparation"}${gaps.length ? ` (${gaps.length} requirements missing)` : ""}`,
      when,
    ),
  ];
  if (!c.structural?.latestEchoId)
    out.push(
      p(
        "investigation",
        `${target}: baseline echocardiogram and valve measurements`,
        when,
        { type: "study", kind: "echo" },
      ),
    );
  if (!structuralPlanning(c, target))
    out.push(
      p("investigation", `${target}: structural CT / 3D TOE planning`, when, {
        type: "study",
        kind: "structural_imaging",
        intervention: target,
      }),
    );
  if (a.labs === "pending")
    out.push(
      p(
        "investigation",
        `${target}: blood count and renal / electrolyte results`,
        when,
        { type: "lab", codes: ["haemoglobin", "creatinine", "potassium"] },
      ),
    );
  if (target === "Tricuspid TEER" && a.rhc !== "reviewed")
    out.push(
      p(
        "procedure",
        "Tricuspid TEER: right heart catheterisation / PVR assessment",
        when,
        { type: "procedure", kind: "rhc" },
      ),
    );
  return out;
}
function assessment(
  a: Answers,
  c: WizardContext,
  target: string,
  rec: string[],
): Assessment {
  const st = structuralPlanning(c, target),
    gaps = missing(a, c, target);
  return {
    heading: `${target}: indication and readiness`,
    rows: [
      { label: "Reference", value: "ESC/EACTS VHD 2025" },
      { label: "Age", value: String(c.profile?.age ?? "Not recorded") },
      {
        label: "Planning report",
        value: st
          ? `${st.day} · ${st.findings.modality} · ${st.findings.suitability}`
          : "Not recorded",
      },
      {
        label: "Readiness",
        value: gaps.length
          ? gaps.join("; ")
          : "Recorded requirements and clinician confirmations complete",
      },
    ],
    recommendations: [
      ...rec,
      "Review surgical alternatives, frailty, organ function, life expectancy, patient goals and lifetime valve strategy with the Heart Team. A planning report is not an independent treatment indication.",
      "Exact device and local IFU determine anatomical limits. CardioFlow does not select device size or a procedural technique automatically.",
    ],
  };
}
export const STRUCTURAL_WIZARDS: Record<string, WizardDef> = {
  "tavi-plan": {
    ...base,
    id: "tavi-plan",
    title: "TAVI: indication & preparation",
    note: "Confirm the severe lesion, indication and Heart Team strategy before scheduling. Integrative assessment is required for discordant or low-flow AS. CT evaluates annulus, root, coronary obstruction and access.",
    steps: [
      {
        id: "indication",
        title: "Indication & benefit",
        questions: [
          ...common,
          q("lesion", "Aortic lesion", [
            ["as", "Severe high-gradient AS"],
            ["lowflow", "Severe low-flow / low-gradient AS"],
            ["ar", "Severe aortic regurgitation"],
          ]),
          q("indication", "Intervention indication", [
            ["symptomatic", "Symptoms attributable to severe valve disease"],
            ["lv", "Asymptomatic severe AS with LVEF <50%"],
            [
              "asymptomatic",
              "Asymptomatic high-gradient AS: low-risk early intervention discussion",
            ],
            ["uncertain", "Uncertain indication / surveillance"],
          ]),
          q("confirmation", "Integrated severity confirmation", [
            ["yes", "Echo and any required DSE / CT calcium review complete"],
            ["pending", "Discordant / incomplete severity assessment"],
          ]),
          conditional(
            q("exercise", "Exercise assessment when asymptomatic", [
              [
                "normal",
                "Normal exercise test, or not feasible with documented team assessment",
              ],
              ["pending", "Not assessed / symptoms or abnormal test"],
            ]),
            "indication",
            "asymptomatic",
          ),
          q("risk", "Surgical / procedural risk", [
            ["low", "Low procedural / surgical risk"],
            ["high", "Increased / high surgical risk"],
            ["ineligible", "Ineligible for surgery"],
          ]),
        ],
      },
      {
        id: "preparation",
        title: "Required data & decision",
        questions: checks,
      },
    ],
    outcome: (a, c) => prepare(a, c, "TAVI"),
    assess: (a, c) =>
      assessment(a, c, "TAVI", [
        "ESC 2025: TAVI is preferred from age 70 with a tricuspid aortic valve and suitable transfemoral anatomy (I A); younger low-risk patients need SAVR discussion (I B). Bicuspid, alternative-access and pure-AR decisions require their own Heart Team assessment.",
      ]),
  },
  "teer-plan": {
    ...base,
    id: "teer-plan",
    title: "TEER: mitral / tricuspid selection & preparation",
    note: "Keep primary, ventricular secondary and atrial secondary MR separate. Review GDMT/CRT and advanced HF before ventricular MR treatment. Tricuspid candidates need invasive haemodynamics and a CIED lead strategy.",
    steps: [
      {
        id: "indication",
        title: "Lesion & indication",
        questions: [
          q("target", "TEER valve", [
            ["mitral", "Mitral"],
            ["tricuspid", "Tricuspid"],
          ]),
          ...common,
          conditional(
            q("phenotype", "MR mechanism (mitral only)", [
              ["primary", "Primary / degenerative MR"],
              ["ventricular", "Ventricular secondary MR"],
              ["atrial", "Atrial secondary MR"],
            ]),
            "target",
            "mitral",
          ),
          q("symptoms", "Symptoms despite appropriate treatment", [
            ["yes", "Persistent symptoms documented"],
            ["no", "Asymptomatic / uncertain"],
          ]),
          q("risk", "Surgical risk / eligibility", [
            ["standard", "Surgery remains suitable"],
            ["high", "High surgical risk"],
            ["ineligible", "Ineligible for surgery"],
          ]),
          q("optimized", "Medical therapy / CRT / rhythm review", [
            [
              "yes",
              "Optimized or contraindications documented; CRT if indicated reviewed",
            ],
            ["pending", "Treatment optimization / reassessment pending"],
          ]),
          conditional(
            q(
              "exclusions",
              "Ventricular SMR outcome criteria: other disease review",
              [
                [
                  "clear",
                  "No severe RV dysfunction, advanced HF, untreated CAD, severe other valve disease or excluded cardiomyopathy",
                ],
                ["uncertain", "One or more concerns / not assessed"],
              ],
            ),
            "phenotype",
            "ventricular",
          ),
          conditional(
            q("rhc", "Tricuspid candidates: RHC / PVR", [
              ["reviewed", "Recorded invasive haemodynamics reviewed"],
              ["pending", "Not recorded / not reviewed"],
              ["na", "Not a tricuspid candidate"],
            ]),
            "target",
            "tricuspid",
          ),
        ],
      },
      { id: "preparation", title: "Anatomy & decision", questions: checks },
    ],
    outcome: (a, c) =>
      prepare(
        a,
        c,
        a.target === "tricuspid" ? "Tricuspid TEER" : "Mitral TEER",
      ),
    assess: (a, c) =>
      assessment(
        a,
        c,
        a.target === "tricuspid" ? "Tricuspid TEER" : "Mitral TEER",
        [
          a.target === "tricuspid"
            ? "Symptomatic severe TR at high surgical risk after medical optimization, without severe RV dysfunction or pre-capillary PH: transcatheter treatment IIa A."
            : a.phenotype === "primary"
              ? "Symptomatic severe primary MR with high surgical risk and suitable anatomy: TEER IIa B; repair surgery remains the reference when appropriate."
              : a.phenotype === "atrial"
                ? "Atrial SMR: optimized medical/rhythm therapy and surgery review; TEER in symptomatic patients ineligible for surgery IIb B."
                : "Ventricular SMR: stable symptomatic severe MR after GDMT/CRT, selected clinical/echo criteria: I A. Outside these criteria, specialist symptom-directed treatment may be considered after LVAD/transplant review (IIb B); it is not the Class I pathway.",
        ],
      ),
  },
  "other-structural-plan": {
    ...base,
    id: "other-structural-plan",
    title: "Valve-in-valve / other transcatheter valve: Heart Team work-up",
    note: "Specialist assessment covers failed bioprostheses and other transcatheter replacements. Coronary obstruction, patient–prosthesis mismatch and neo-LVOT / landing-zone risk require procedure-specific imaging and device IFU review.",
    steps: [
      {
        id: "review",
        title: "Heart Team work-up",
        questions: [
          ...common,
          q("failure", "Mechanism / indication established", [
            ["yes", "Valve failure or target lesion verified with imaging"],
            ["pending", "Mechanism or severity uncertain"],
          ]),
          q("device", "Exact valve model and regional IFU", [
            [
              "reviewed",
              "Device / previous implant details and current IFU reviewed",
            ],
            ["pending", "Model, size, implant history or IFU missing"],
          ]),
          ...checks.map((question) =>
            question.id === "decision"
              ? {
                  ...question,
                  options: question.options?.filter(
                    (o) => o.value !== "schedule",
                  ),
                }
              : question,
          ),
        ],
      },
    ],
    outcome: (a, c) =>
      a.safety === "urgent"
        ? [p("follow_up", "Urgent structural / emergency assessment", c.today)]
        : [
            p(
              "referral",
              "Valve-in-valve / transcatheter replacement: specialist review of indication, coronary / neo-LVOT risk, landing zone, prior valve model and surgical alternatives",
              String(a.when),
            ),
            ...(!structuralPlanning(
              c,
              "Valve-in-valve / other transcatheter valve",
            )
              ? [
                  p(
                    "investigation",
                    "Valve-in-valve / other transcatheter valve imaging",
                    String(a.when),
                    {
                      type: "study",
                      kind: "structural_imaging",
                      intervention:
                        "Valve-in-valve / other transcatheter valve",
                    },
                  ),
                ]
              : []),
          ],
    assess: (a, c) =>
      assessment(a, c, "Valve-in-valve / other transcatheter valve", [
        "This pathway prepares an expert decision; it does not declare every replacement or valve-in-valve procedure suitable. Device-specific thresholds remain in the reviewed current IFU.",
      ]),
  },
  "after-structural": {
    ...base,
    id: "after-structural",
    title: "After TAVI / TEER: recovery & follow-up",
    note: "Record the completed intervention first. Review the procedural result, residual valve disease, complications, antithrombotic indications and device-specific instructions. Follow-up dates are clinician-selected.",
    steps: [
      {
        id: "recovery",
        title: "Result & recovery",
        questions: [
          q("safety", "Safety today", [
            ["stable", "No urgent symptoms"],
            [
              "urgent",
              "Stroke, severe chest pain, dyspnoea, syncope or major bleeding",
            ],
          ]),
          q("result", "Procedure report and residual valve result", [
            [
              "reviewed",
              "Result, residual leak / regurgitation and gradient reviewed",
            ],
            ["pending", "Report / result review incomplete"],
          ]),
          q("conduction", "ECG / conduction and device review", [
            ["reviewed", "ECG / conduction / device plan reviewed"],
            ["pending", "ECG or conduction / device review needed"],
          ]),
          q("protocol", "Antithrombotic and current device protocol", [
            [
              "reviewed",
              "Implant-team protocol, OAC / PCI indications and bleeding risk reviewed",
            ],
            ["pending", "Regimen / device IFU or indication review pending"],
          ]),
          date("medAt", "Antithrombotic review date"),
        ],
      },
      {
        id: "followup",
        title: "Surveillance & education",
        questions: [
          date("echoAt", "Baseline / reassessment echocardiogram date"),
          date("clinicAt", "Structural / valve clinic date"),
          q("education", "Aftercare education", [
            [
              "reviewed",
              "Access care, warning signs, endocarditis prevention and contact provided",
            ],
            ["pending", "Written education / contact pending"],
          ]),
          q("annual", "Later imaging plan", [
            ["book", "Plan annual valve imaging"],
            ["individual", "Individualized imaging plan with valve team"],
          ]),
        ],
      },
    ],
    outcome(a, c) {
      const actual = c.structural?.actual;
      if (!actual)
        return [
          p(
            "follow_up",
            "Record the completed structural intervention before aftercare",
            c.today,
          ),
        ];
      if (a.safety === "urgent")
        return [
          p(
            "follow_up",
            "Urgent post-intervention / emergency assessment",
            c.today,
          ),
        ];
      const out = [
        p(
          "investigation",
          `${actual.target}: baseline / reassessment echocardiogram`,
          String(a.echoAt),
          { type: "study", kind: "echo" },
        ),
        p(
          "follow_up",
          `${actual.target}: structural / valve clinic review`,
          String(a.clinicAt),
          { type: "visit" },
        ),
        p(
          "medication",
          `${actual.target}: antithrombotic and current device IFU review; retain independent OAC / PCI indications`,
          String(a.medAt),
        ),
        p(
          "education",
          `${actual.target}: access care, warning signs, endocarditis prevention and implant-team contact`,
          c.today,
        ),
      ];
      if (a.protocol === "pending" || a.result === "pending")
        out.unshift(
          p(
            "follow_up",
            `${actual.target}: implant-team report / regimen confirmation before treatment transition`,
            c.today,
          ),
        );
      if (a.conduction === "pending")
        out.push(
          p(
            "investigation",
            `${actual.target}: ECG / conduction and device review`,
            c.today,
            { type: "study", kind: "ecg" },
          ),
        );
      if (a.annual === "book")
        out.push(
          p(
            "investigation",
            `${actual.target}: annual valve echocardiogram`,
            addCalendarMonths(actual.day, 12) < c.today
              ? c.today
              : addCalendarMonths(actual.day, 12),
            {
              type: "study",
              kind: "echo",
              after: addCalendarMonths(actual.day, 12),
            },
          ),
        );
      return out;
    },
    assess(a, c) {
      const actual = c.structural?.actual;
      return {
        heading: "Structural intervention aftercare",
        rows: [
          {
            label: "Actual procedure",
            value: actual ? `${actual.day} · ${actual.target}` : "Not recorded",
          },
          {
            label: "Device",
            value: actual?.findings.deviceModel || "Not recorded",
          },
          {
            label: "Residual result",
            value: actual
              ? `${actual.findings.residualGrade ?? "Not assessed"} · mean gradient ${actual.findings.meanGradient ?? "not assessed"}`
              : "Not recorded",
          },
        ],
        recommendations: [
          "TAVI: without an OAC indication, aspirin 75–100 mg for 12 months (I A); routine DAPT or OAC without another indication is discouraged. Use the linked antithrombotic pathway for clinician-confirmed medication actions.",
          "TEER / other transcatheter valves: confirm the actual device IFU and implant-team regimen; do not copy a TAVI schedule to a clip or replacement. Continue indicated HF treatment.",
          "Review residual MR/TR or paravalvular leak, valve gradient, LV/RV function, vascular complications, bleeding, renal function and ECG/conduction findings. Prosthetic/device-related infection prevention follows the applicable guidance.",
          "Ventricular SMR after TEER needs clinical/laboratory/echo review every 3–6 months according to HF stage; annual imaging alone is insufficient for such patients.",
        ],
      };
    },
  },
};
