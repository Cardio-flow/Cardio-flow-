// AF procedure decisions use the existing wizard, decisions and dated-plan engine.
// Sources and recommendation/knowledge-gap mapping: docs/af-guideline-matrix.md.
import { addDays } from "./clinical.js";
import { addCalendarMonths } from "./af.js";
import type {
  Assessment,
  OutcomeItem,
  Question,
  WizardContext,
  WizardDef,
} from "./wizards.js";
const single = (
  id: string,
  label: string,
  options: [string, string][],
  help?: string,
): Question => ({
  id,
  label,
  help,
  type: "single",
  required: true,
  options: options.map(([value, label]) => ({ value, label })),
});
const date = (id: string, label: string): Question => ({
  id,
  label,
  type: "date",
  required: true,
});
const plan = (
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
const todayOr = (day: string, c: WizardContext) =>
  day < c.today ? c.today : day;
const hasAf = (c: WizardContext) =>
  (c.dx ?? []).includes("af") || c.af?.ecgRhythm === "Atrial fibrillation";
const recordedThrombus = (c: WizardContext) =>
  (!!c.afProcedures?.preImaging &&
    c.afProcedures.preImaging.findings.laaThrombus !== "Absent") ||
  [
    c.afProcedures?.imaging?.findings.laaThrombus,
    c.afProcedures?.imaging?.findings.deviceThrombus,
  ].some((v) => v === "Present" || v === "Indeterminate");
const shared = {
  tone: "blue" as const,
  group: "Rhythm & devices" as const,
  episode: false,
  facts: ["lvef", "creatinine", "weight", "haemoglobin"],
};
const urgent = (c: WizardContext, title: string) =>
  plan("follow_up", title, c.today, { type: "manual" });
const redFlags = single(
  "safety",
  "Safety today",
  [
    ["stable", "No urgent symptoms reported"],
    ["urgent", "Urgent symptoms / unstable patient"],
  ],
  "Severe chest pain, breathlessness, syncope, stroke symptoms or significant bleeding need emergency assessment. After ablation, fever with swallowing pain or neurological symptoms needs urgent evaluation for an oesophageal complication; avoid oesophageal instrumentation if fistula is suspected.",
);

export const AF_AFTERCARE_WIZARDS: Record<string, WizardDef> = {
  "af-ablation-plan": {
    ...shared,
    id: "af-ablation-plan",
    title: "AF ablation: shared decision & preparation",
    source: "ESC AF 2024; EHRA/HRS/APHRS/LAHRS ablation consensus 2024",
    note: "Catheter ablation is an option for symptom control after drug failure/intolerance, or first-line in selected patients. HFrEF and suspected tachycardia-mediated cardiomyopathy need an EP discussion. PVI is the core procedure; energy and additional lesions are chosen by the operator. Anticoagulation remains based on stroke risk.",
    steps: [
      {
        id: "decision",
        title: "Indication & shared decision",
        questions: [
          redFlags,
          single("indication", "Reason for EP discussion", [
            ["first", "First-line rhythm control after shared decision"],
            ["aad", "Symptoms despite / intolerant of antiarrhythmic therapy"],
            [
              "hf",
              "AF with HFrEF / suspected tachycardia-mediated cardiomyopathy",
            ],
            ["redo", "Symptomatic recurrence: consider repeat ablation"],
            ["surgery", "Surgical / hybrid AF ablation discussion"],
          ]),
          single("decision", "Patient and clinician decision", [
            ["refer", "Refer to EP / multidisciplinary review"],
            ["proceed", "EP agreed: plan catheter ablation"],
            ["defer", "Defer / continue medical management"],
          ]),
          date("when", "Referral / procedure date"),
        ],
      },
      {
        id: "prepare",
        title: "Preparation",
        questions: [
          single(
            "anticoag",
            "Effective anticoagulation / adherence confirmed",
            [
              ["yes", "Confirmed with the EP team"],
              ["no", "Interrupted, absent or not confirmed"],
            ],
            "Check missed DOAC doses, therapeutic INR for VKA, renal function and interactions. Medication start date alone does not prove effective anticoagulation.",
          ),
          single("thrombus", "Thrombus exclusion / EP imaging decision", [
            ["clear", "EP confirms imaging requirements satisfied"],
            ["present", "LA / LAA thrombus present"],
            ["unknown", "Imaging or thrombus status needs review"],
          ]),
          single(
            "periOac",
            "Periprocedural anticoagulation strategy",
            [
              ["continuous", "Uninterrupted anticoagulation"],
              ["minimal", "Minimally interrupted DOAC under EP protocol"],
            ],
            "Uninterrupted VKA; continuous or minimally interrupted DOAC per the operator's protocol. Do not create a generic heparin-bridging schedule.",
          ),
        ],
      },
    ],
    outcome(a, c) {
      if (a.safety === "urgent")
        return [
          urgent(c, "Emergency assessment: unstable AF / significant symptoms"),
        ];
      if (
        hasAf(c) &&
        !recordedThrombus(c) &&
        a.decision === "proceed" &&
        a.indication !== "surgery" &&
        a.anticoag === "yes" &&
        a.thrombus === "clear"
      )
        return [
          plan(
            "procedure",
            `AF catheter ablation (${a.periOac === "minimal" ? "minimally interrupted DOAC per EP protocol" : "anticoagulation uninterrupted"})`,
            String(a.when),
            { type: "procedure", kind: "ablation", target: "AF" },
          ),
          plan(
            "education",
            "AF ablation counselling: recurrence, procedural risks and continued stroke prevention",
            c.today,
          ),
        ];
      if (a.decision === "defer")
        return [
          plan(
            "follow_up",
            "AF medical management and rhythm-control reassessment",
            String(a.when),
            { type: "visit" },
          ),
        ];
      return [
        plan(
          "referral",
          `${a.thrombus === "present" ? "Defer AF ablation: LA/LAA thrombus treatment and EP review" : "EP review: AF ablation eligibility, anticoagulation and imaging"}`,
          String(a.when),
        ),
      ];
    },
    assess(a, c) {
      return {
        heading: "AF ablation decision",
        rows: [
          {
            label: "Stroke risk",
            value: `CHA₂DS₂-VA ${c.af?.score ?? "not available"}`,
          },
        ],
        recommendations: [
          "Confirm symptoms, AF pattern, duration, atrial size, LVEF, patient preference and risks before the EP decision.",
          "A successful ablation does not automatically remove the indication for long-term anticoagulation.",
          ...(recordedThrombus(c)
            ? [
                "Recorded preprocedure thrombus is present or indeterminate. Record updated imaging and obtain EP clearance before scheduling.",
              ]
            : []),
          ...(a.thrombus !== "clear" || a.anticoag !== "yes"
            ? [
                "Preparation is incomplete: this pathway does not book a catheter procedure until the EP safety requirements are confirmed.",
              ]
            : []),
        ],
      };
    },
  },
  "after-af-ablation": {
    ...shared,
    id: "after-af-ablation",
    title: "After AF ablation: anticoagulation & recovery",
    source:
      "ESC AF 2024; EHRA/HRS/APHRS/LAHRS ablation consensus 2024; ACC/AHA/HRS AF 2023",
    note: "Record the actual AF ablation first. Dates count from that procedure. Early recurrence within the 8-week blanking period is not automatically treatment failure. Review symptoms, ECG, stroke prevention and risk factors; never stop anticoagulation automatically.",
    steps: [
      {
        id: "recovery",
        title: "Recovery & recurrence",
        questions: [
          redFlags,
          single("rhythm", "Rhythm / symptoms since ablation", [
            ["well", "No recurrence reported"],
            [
              "recurrence",
              "AF / flutter / atrial tachycardia recurrence or palpitations",
            ],
            ["unknown", "Rhythm not documented"],
          ]),
          single("aad", "Antiarrhythmic therapy review", [
            ["none", "No antiarrhythmic therapy"],
            ["review", "Review short-term antiarrhythmic therapy with EP"],
          ]),
        ],
      },
      {
        id: "stroke",
        title: "Stroke prevention",
        questions: [
          single("basis", "Post-ablation minimum anticoagulation reference", [
            ["esc", "ESC / EHRA: at least 2 calendar months"],
            ["acc", "ACC/AHA/HRS: at least 3 calendar months"],
          ]),
          single(
            "oac",
            "Anticoagulation decision",
            [
              ["continue", "Continue / arrange effective OAC"],
              [
                "bleeding",
                "Bleeding or contraindication: urgent specialist decision",
              ],
              [
                "longterm",
                "Minimum period passed: specialist long-term review",
              ],
            ],
            "The minimum period is not a stop date. Long-term decisions consider stroke risk, valve disease, cardiomyopathy, recurrence and monitoring. Aspirin is not a substitute for AF stroke prevention.",
          ),
        ],
      },
      {
        id: "follow",
        title: "Follow-up",
        questions: [
          date("reviewAt", "EP / clinic review date"),
          date("ecgAt", "12-lead ECG date"),
          single("monitor", "Additional rhythm monitoring", [
            ["no", "No additional monitoring now"],
            ["yes", "Symptoms / recurrence: arrange ambulatory monitoring"],
          ]),
        ],
      },
    ],
    outcome(a, c) {
      const ab = c.afProcedures?.ablation;
      if (!ab) return [];
      if (a.safety === "urgent")
        return [
          urgent(
            c,
            "Emergency assessment after AF ablation: evaluate tamponade, stroke, bleeding or oesophageal complication",
          ),
        ];
      const until = addCalendarMonths(ab.day, a.basis === "acc" ? 3 : 2);
      const out = [
        plan(
          "medication",
          `AF ablation OAC review: minimum period through ${until}; then stroke-risk decision (not an automatic stop)`,
          todayOr(until, c),
        ),
        plan(
          "follow_up",
          "Post-AF-ablation EP / clinic review",
          String(a.reviewAt),
          { type: "visit" },
        ),
        plan(
          "investigation",
          "12-lead ECG after AF ablation",
          String(a.ecgAt),
          { type: "study", kind: "ecg" },
        ),
        plan(
          "education",
          "After AF ablation: emergency symptoms, access-site care, adherence and AF risk-factor management",
          c.today,
        ),
        plan(
          "follow_up",
          "Annual AF review with 12-lead ECG and stroke-risk reassessment",
          todayOr(addCalendarMonths(ab.day, 12), c),
          { type: "visit" },
        ),
        plan(
          "investigation",
          "Annual 12-lead ECG after AF ablation",
          todayOr(addCalendarMonths(ab.day, 12), c),
          { type: "study", kind: "ecg" },
        ),
      ];
      if (a.oac === "bleeding")
        out.unshift(
          urgent(
            c,
            "Urgent EP / bleeding review: post-ablation anticoagulation decision",
          ),
        );
      if (a.monitor === "yes" || a.rhythm === "recurrence")
        out.push(
          plan(
            "investigation",
            "Ambulatory ECG for post-ablation symptoms / recurrence",
            String(a.ecgAt),
            { type: "study", kind: "holter" },
          ),
        );
      if (a.aad === "review")
        out.push(
          plan(
            "medication",
            "EP antiarrhythmic review after AF ablation (short-term therapy; no automatic discontinuation)",
            String(a.reviewAt),
          ),
        );
      return out;
    },
    assess(a, c) {
      const ab = c.afProcedures?.ablation;
      return {
        heading: "Post-ablation care",
        rows: [
          { label: "Actual ablation", value: ab?.day ?? "Not recorded" },
          {
            label: "Blanking period ends",
            value: ab ? addDays(ab.day, 56) : "Not available",
          },
          {
            label: "Minimum OAC review",
            value: ab
              ? addCalendarMonths(ab.day, a.basis === "acc" ? 3 : 2)
              : "Not available",
          },
        ],
        recommendations: [
          "Routine rhythm assessment within 2–3 months includes at least a 12-lead ECG; annual ECG follow-up thereafter, earlier monitoring for symptoms.",
          "The 8-week blanking period describes recurrence interpretation; urgent symptoms still need assessment.",
          "Give written access-site / wound and activity instructions from the EP team. Review chest pain, dyspnoea, swallowing pain / fever, stroke symptoms and bleeding; severe or progressive symptoms need urgent care.",
          "Continue OAC according to stroke risk beyond the minimum period; sinus rhythm alone does not establish that stopping OAC is safe.",
          ...(a.oac === "longterm" &&
          ab &&
          c.today < addCalendarMonths(ab.day, a.basis === "acc" ? 3 : 2)
            ? [
                "The selected minimum period has not passed. Do not treat this visit as clearance to stop OAC.",
              ]
            : []),
        ],
      };
    },
  },
  "laao-selection": {
    ...shared,
    id: "laao-selection",
    title: "LAA closure: eligibility & shared decision",
    source: "SCAI/HRS LAAO 2025 (2026 corrigendum); ESC AF 2024",
    note: "OAC and transcatheter LAAO are shared-decision options for eligible nonvalvular AF. Consider bleeding history, ability to take the postimplant regimen, anatomy, procedural risks and quality life expectancy. Surgical LAA exclusion is a separate strategy, generally adjunctive to OAC.",
    steps: [
      {
        id: "eligibility",
        title: "Eligibility",
        questions: [
          single("reason", "Reason for considering closure", [
            ["contra", "Contraindication to long-term OAC"],
            ["bleeding", "Bleeding complications / elevated bleeding risk"],
            [
              "preference",
              "Patient preference after OAC versus LAAO discussion",
            ],
            ["surgery", "Surgical exclusion during cardiac surgery"],
          ]),
          single("life", "Expected quality survival and benefit", [
            ["adequate", "Expected to benefit for more than 1 year"],
            ["limited", "Less than 1 year / benefit uncertain"],
          ]),
          single(
            "shortTherapy",
            "Ability to take postimplant antithrombotic therapy",
            [
              ["yes", "A feasible OAC / DAPT plan is agreed"],
              ["uncertain", "Not feasible or needs specialist review"],
            ],
          ),
        ],
      },
      {
        id: "preparation",
        title: "Imaging & decision",
        questions: [
          single("imaging", "TEE / CT and LA/LAA thrombus", [
            [
              "clear",
              "Current imaging reviewed: no thrombus, suitable anatomy",
            ],
            ["thrombus", "Thrombus present"],
            ["unknown", "Imaging / anatomy not yet established"],
          ]),
          single("decision", "Shared decision", [
            ["refer", "LAAO team / surgical-team assessment"],
            ["proceed", "Team agreed: schedule transcatheter LAA closure"],
            ["oac", "Continue medical stroke prevention"],
          ]),
          date("when", "Referral / procedure / review date"),
        ],
      },
    ],
    outcome(a, c) {
      const excluded = (c.dx ?? []).some((d) =>
        ["mechanical-valve", "ms-significant"].includes(d),
      );
      if (a.decision === "oac")
        return [
          plan(
            "medication",
            "AF stroke-prevention review: OAC suitability, adherence and label dose",
            String(a.when),
          ),
        ];
      if (
        a.decision === "proceed" &&
        a.reason !== "surgery" &&
        hasAf(c) &&
        !recordedThrombus(c) &&
        !excluded &&
        a.life === "adequate" &&
        a.shortTherapy === "yes" &&
        a.imaging === "clear"
      )
        return [
          plan(
            "procedure",
            "Transcatheter LAA closure (device and antithrombotic protocol agreed with implant team)",
            String(a.when),
            {
              type: "procedure",
              kind: "laao",
              method: "Transcatheter occlusion",
            },
          ),
          plan(
            "medication",
            "Agree LAAO device-specific OAC / DAPT, review date and surveillance imaging",
            c.today,
          ),
        ];
      return [
        plan(
          "referral",
          a.reason === "surgery"
            ? "Surgical LAA exclusion discussion (adjunct to OAC)"
            : "LAAO specialist review: eligibility / thrombus / antithrombotic feasibility",
          String(a.when),
        ),
      ];
    },
    assess(a, c) {
      const rec = [
        ...(!hasAf(c)
          ? [
              "AF is not documented. Confirm the AF diagnosis and indication for stroke prevention before scheduling transcatheter closure.",
            ]
          : []),
        "2025 SCAI/HRS recommendations are conditional: discuss OAC, LAAO and procedure-related harms with the patient.",
        "A closure device does not treat AF or replace anticoagulation for a mechanical valve, venous thromboembolism or another indication.",
        "Confirm the implanted device's current instructions for use and local implant protocol; short-term treatment and surveillance remain necessary.",
      ];
      if (recordedThrombus(c))
        rec.push(
          "Recorded preprocedure thrombus is present or indeterminate. Record updated imaging before scheduling closure.",
        );
      if (a.life === "limited")
        rec.push(
          "LAAO may be inappropriate with less than 1 year of quality life expectancy.",
        );
      if (a.imaging === "thrombus")
        rec.push(
          "LA/LAA thrombus: defer elective closure and arrange specialist treatment / repeat imaging.",
        );
      if (a.shortTherapy !== "yes")
        rec.push(
          "Do not schedule implantation until postimplant therapy is feasible.",
        );
      if (
        (c.dx ?? []).some((d) =>
          ["mechanical-valve", "ms-significant"].includes(d),
        )
      )
        rec.push(
          "Mechanical valve or moderate–severe mitral stenosis: the nonvalvular AF LAAO recommendations do not replace VKA therapy.",
        );
      return {
        heading: "LAA closure decision",
        rows: [
          {
            label: "CHA₂DS₂-VA",
            value: String(c.af?.score ?? "Not available"),
          },
        ],
        recommendations: rec,
      };
    },
  },
  "after-laao": {
    ...shared,
    id: "after-laao",
    title: "After LAA closure: imaging & antithrombotic care",
    source: "SCAI/HRS LAAO 2025; SCAI/HRS LAAC consensus 2023; ESC AF 2024",
    note: "Record the actual closure and device first. This review records the clinician's intended regimen and dates, not an automatic prescription or stop order. OAC or DAPT are post-transcatheter options; SAPT and leak management remain evidence gaps. Device thrombus requires a specialist OAC decision.",
    steps: [
      {
        id: "recovery",
        title: "Recovery",
        questions: [
          redFlags,
          single("regimen", "Intended antithrombotic regimen", [
            ["oac", "OAC per implant-team / device protocol"],
            ["dapt", "DAPT per implant-team / device protocol"],
            ["sapt", "SAPT: specialist exception / evidence gap"],
            ["none", "No therapy: specialist exception / bleeding review"],
          ]),
          date("regimenAt", "Antithrombotic review / transition decision date"),
        ],
      },
      {
        id: "imaging",
        title: "Surveillance",
        questions: [
          single("imagePlan", "TEE / CT surveillance", [
            ["book", "Arrange surveillance or repeat imaging"],
            ["reviewed", "Review the recorded post-closure imaging"],
          ]),
          date("imageAt", "Imaging / findings review date"),
          date("clinicAt", "LAA closure team follow-up date"),
        ],
      },
    ],
    outcome(a, c) {
      const cl = c.afProcedures?.closure;
      if (!cl) return [];
      if (a.safety === "urgent")
        return [
          urgent(
            c,
            "Emergency assessment after LAA closure: stroke, tamponade or significant bleeding",
          ),
        ];
      const im = c.afProcedures?.imaging?.findings;
      const out = [
        plan(
          "medication",
          `LAA closure antithrombotic review: ${String(a.regimen).toUpperCase()} per ${cl.device} protocol; verify imaging and other OAC indications before transition`,
          String(a.regimenAt),
        ),
        plan("follow_up", "LAA closure team follow-up", String(a.clinicAt), {
          type: "visit",
        }),
        plan(
          "education",
          "LAA closure: bleeding / stroke warning signs, adherence, access care and imaging follow-up",
          c.today,
        ),
      ];
      if (cl.method === "Surgical exclusion")
        out.push(
          plan(
            "medication",
            "Surgical LAA exclusion: review ongoing OAC by stroke risk (closure is generally adjunctive)",
            c.today,
          ),
        );
      if (
        a.imagePlan === "book" ||
        !im ||
        im.deviceThrombus === "Present" ||
        im.deviceThrombus === "Indeterminate" ||
        im.laaThrombus === "Present"
      )
        out.push(
          plan(
            "investigation",
            im?.deviceThrombus === "Present" || im?.laaThrombus === "Present"
              ? "Repeat TEE / CT after LAA closure thrombus: confirm resolution"
              : "TEE / CT surveillance after LAA closure (device thrombus and residual leak)",
            String(a.imageAt),
            {
              type: "study",
              kind: "laa_imaging",
              purpose: "After closure",
              after: cl.day,
            },
          ),
        );
      else
        out.push(
          plan(
            "follow_up",
            "Review LAA closure imaging: device thrombus, residual leak and regimen transition",
            String(a.imageAt),
          ),
        );
      if (im?.deviceThrombus === "Present" || im?.laaThrombus === "Present")
        out.unshift(
          plan(
            "medication",
            "Device-related thrombus / LA-LAA thrombus after closure: urgent specialist OAC decision and repeat TEE / CT",
            c.today,
          ),
        );
      if (
        im?.leak === "Present" ||
        im?.deviceThrombus === "Indeterminate" ||
        im?.leak === "Indeterminate" ||
        ["sapt", "none"].includes(String(a.regimen))
      )
        out.push(
          plan(
            "medication",
            "LAAO specialist review: leak / uncertain imaging / antithrombotic exception; no automatic stop",
            c.today,
          ),
        );
      return out;
    },
    assess(a, c): Assessment {
      const cl = c.afProcedures?.closure,
        im = c.afProcedures?.imaging;
      return {
        heading: "LAA closure aftercare",
        rows: [
          {
            label: "Implant",
            value: cl ? `${cl.day} · ${cl.device}` : "Not recorded",
          },
          { label: "Recorded regimen", value: cl?.regimen ?? "Not documented" },
          {
            label: "Post-closure imaging",
            value: im
              ? `${im.day}: device thrombus ${im.findings.deviceThrombus}; leak ${im.findings.leak}`
              : "Not recorded",
          },
        ],
        recommendations: [
          "After transcatheter LAAO, OAC or DAPT is suggested by the 2025 guideline; the device IFU, bleeding risk and implant-team protocol determine drugs and duration.",
          "Confirm the procedure used TEE / ICE guidance and immediate checks for device position, residual flow, pericardial effusion and access-site complications. Provide written access-care / activity instructions and an implant-team contact for bleeding, stroke symptoms, syncope or breathlessness.",
          "SCAI/HRS 2023 suggests surveillance TEE/CT at 45–90 days; 2025 supports imaging but does not establish one optimal timing. Use the clinician-selected date.",
          "Do not transition treatment on the basis of an unreviewed, missing or indeterminate scan. Device thrombus favors OAC; duration and repeat-imaging timing require individualized decisions.",
          "A residual leak has no universal OAC recommendation in the 2025 guideline. No automatic leak-size cutoff or drug stop is applied.",
          ...(cl?.method === "Surgical exclusion"
            ? [
                "Surgical closure is generally adjunctive to OAC. Do not apply a transcatheter-device regimen as a replacement for indicated anticoagulation.",
              ]
            : []),
          ...(["sapt", "none"].includes(String(a.regimen))
            ? [
                "SAPT / no therapy is a specialist exception, not a guideline-default early postimplant regimen.",
              ]
            : []),
        ],
      };
    },
  },
};
