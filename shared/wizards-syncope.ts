import type {
  Answers,
  OutcomeItem,
  WizardContext,
  WizardDef,
  Question,
} from "./wizards.js";
export const SYNCOPE_SOURCE =
  "ESC syncope 2018 · ESC pacing 2021 · NEJM review 2026";
const choose = (
  id: string,
  label: string,
  items: [string, string][],
  multi = false,
): Question => ({
  id,
  label,
  type: multi ? "multi" : "single",
  required: true,
  ...(multi ? { exclusive: ["none"] } : {}),
  options: items.map(([value, label]) => ({ value, label })),
});
export function syncopeConcern(a: Answers, c: WizardContext) {
  return (
    ["exertion", "supine", "palpitations"].includes(String(a.circumstances)) ||
    (a.redflags as string[] | undefined)?.some((x) => x !== "none") ||
    !!c.syncope?.urgent?.length
  );
}
export function validateSyncope(
  a: Answers,
  c: WizardContext,
  dates: Record<string, string> = {},
) {
  if ((c.profile?.age ?? 18) < 18)
    return "This adult pathway is not validated for children; arrange paediatric assessment";
  if (
    a.disposition === "urgent" &&
    (a.reviewDate !== c.today ||
      Object.values(dates).some((d) => d !== c.today))
  )
    return "Urgent syncope assessment must be dated today";
  if (syncopeConcern(a, c) && a.disposition !== "urgent")
    return "High-risk syncope features need urgent assessment; choose the urgent route";
  if (
    a.disposition === "routine" &&
    (a.ecg !== "reviewed" ||
      a.orthostatic === "not-done" ||
      a.mechanism === "uncertain")
  )
    return "Complete the ECG, standing BP and mechanism review before selecting routine outpatient care";
  if (a.mechanism === "orthostatic" && a.orthostatic !== "positive")
    return "Record a compatible orthostatic BP result before attributing the event to orthostatic hypotension";
  return null;
}
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
export function syncopeOutcome(a: Answers, c: WizardContext): OutcomeItem[] {
  const when = String(a.reviewDate ?? c.today),
    out: OutcomeItem[] = [];
  const tests = (a.tests as string[] | undefined) ?? [];
  if (a.disposition === "urgent")
    return [
      plan(
        "follow_up",
        "Syncope: urgent same-day assessment and ECG monitoring",
        c.today,
        { type: "visit", requiresReview: true },
      ),
      {
        kind: "note",
        label:
          "Assess immediate causes and injuries; monitored observation, syncope unit or admission depends on clinical findings. Do not delay urgent care to complete outpatient tests.",
      },
    ];
  if (a.ecg === "needed")
    out.push(
      plan("investigation", "Syncope: 12-lead ECG", c.today, {
        type: "study",
        kind: "ecg",
        requiresReview: true,
      }),
    );
  if (a.orthostatic === "not-done")
    out.push(
      plan(
        "investigation",
        "Syncope: supine and standing BP with symptom correlation",
        c.today,
        { type: "study", kind: "orthostatic_bp", requiresReview: true },
      ),
    );
  if (tests.includes("echo"))
    out.push(
      plan("investigation", "Syncope: targeted echocardiogram", when, {
        type: "study",
        kind: "echo",
        requiresReview: true,
      }),
    );
  if (tests.includes("holter"))
    out.push(
      plan(
        "investigation",
        "Syncope: ambulatory ECG with symptom correlation",
        when,
        { type: "study", kind: "holter", requiresReview: true },
      ),
    );
  if (tests.includes("device"))
    out.push(
      plan("investigation", "Syncope: device interrogation", when, {
        type: "study",
        kind: "device_check",
        requiresReview: true,
      }),
    );
  if (tests.includes("ilr"))
    out.push(
      plan(
        "referral",
        "Syncope: electrophysiology review for prolonged monitoring / loop recorder",
        when,
      ),
    );
  if (tests.includes("eps"))
    out.push(
      plan(
        "referral",
        "Syncope: electrophysiology review of conduction disease / scar",
        when,
      ),
    );
  if (tests.includes("tilt"))
    out.push(
      plan("referral", "Syncope: specialist tilt / autonomic assessment", when),
    );
  if (tests.includes("meds"))
    out.push(
      plan(
        "medication",
        "Syncope: review hypotensive and rate-slowing medicines",
        when,
      ),
    );
  if (tests.includes("labs"))
    out.push(
      plan(
        "other",
        "Syncope: targeted blood tests for the suspected cause",
        when,
      ),
    );
  if (a.mechanism === "reflex" || a.mechanism === "orthostatic")
    out.push(
      plan(
        "education",
        "Syncope: trigger avoidance, injury prevention and counter-pressure education",
        c.today,
      ),
    );
  out.push(
    plan(
      "education",
      "Syncope: driving and occupational safety advice under local rules",
      c.today,
    ),
  );
  out.push(
    plan(
      "follow_up",
      a.disposition === "specialist"
        ? "Syncope: specialist assessment and result review"
        : "Syncope: clinical follow-up and result review",
      when,
      { type: "visit", requiresReview: true },
    ),
  );
  out.push({
    kind: "note",
    label:
      "Use targeted tests. No routine CT brain, EEG or carotid imaging without a neurological/trauma indication. Do not increase salt or fluid indiscriminately in HF, CKD or hypertension. Pacing or ablation requires a documented mechanism and specialist selection.",
  });
  return out;
}
export const SYNCOPE_WIZARDS: Record<string, WizardDef> = {
  syncope: {
    id: "syncope",
    title: "Syncope & unexplained falls: assessment and plan",
    shortTitle: "Assess syncope",
    tone: "orange",
    group: "Rhythm & devices",
    episode: false,
    source: SYNCOPE_SOURCE,
    sourceShort: "ESC syncope 2018 · pacing 2021",
    note: "History, ECG and standing BP guide risk and targeted testing. Confirm the event and the mechanism; normal office vitals alone do not exclude cardiac syncope.",
    facts: ["sbp", "dbp", "hr", "lvef"],
    steps: [
      {
        id: "history",
        title: "Event and risk",
        questions: [
          choose("presentation", "Recorded event", [
            ["syncope", "Transient loss of consciousness with recovery"],
            ["presyncope", "Presyncope without loss of consciousness"],
            ["fall", "Unexplained fall / uncertain loss of consciousness"],
            ["other", "Another cause suspected: assess the differential"],
          ]),
          choose("circumstances", "Circumstances / prodrome", [
            [
              "reflex",
              "Prolonged standing, trigger and typical autonomic prodrome",
            ],
            ["standing", "On standing / after a meal or medicine"],
            ["exertion", "During exertion"],
            ["supine", "While supine"],
            ["palpitations", "Abrupt event with palpitations"],
            ["unclear", "Unclear / witness history needed"],
          ]),
          choose("frequency", "Recurrence", [
            ["single", "First / isolated event"],
            ["frequent", "Frequent episodes (at least weekly)"],
            ["infrequent", "Recurrent but less frequent"],
            ["uncertain", "Frequency uncertain"],
          ]),
          choose(
            "redflags",
            "High-risk features assessed",
            [
              ["none", "None after assessment"],
              ["exertion", "During exertion or while supine"],
              [
                "palpitations",
                "Palpitations immediately before loss of consciousness",
              ],
              [
                "cardiac",
                "Significant structural heart disease / concerning ECG",
              ],
              ["family", "Family history of unexplained sudden death"],
              [
                "acute",
                "Ongoing chest pain, breathlessness, bleeding or haemodynamic concern",
              ],
              ["injury", "Serious injury or incomplete recovery"],
            ],
            true,
          ),
        ],
      },
      {
        id: "assessment",
        title: "Core assessment",
        questions: [
          choose("ecg", "12-lead ECG", [
            ["reviewed", "ECG reviewed for this assessment"],
            ["needed", "ECG needed / not yet reviewed"],
          ]),
          choose("orthostatic", "Supine / standing BP and symptoms", [
            ["positive", "Compatible symptomatic orthostatic BP result"],
            ["negative", "Assessed: no compatible symptomatic fall"],
            ["not-done", "Not yet assessed / uncertain"],
          ]),
          choose("mechanism", "Working assessment", [
            ["reflex", "Probable reflex syncope"],
            ["orthostatic", "Probable orthostatic hypotension"],
            ["cardiac", "Possible cardiac / arrhythmic mechanism"],
            ["uncertain", "Unexplained: further assessment required"],
            ["other", "Alternative cause: targeted assessment"],
          ]),
        ],
      },
      {
        id: "plan",
        title: "Disposition and targeted plan",
        questions: [
          choose(
            "tests",
            "Tests / actions needed",
            [
              [
                "none",
                "No further tests indicated after the initial assessment",
              ],
              ["echo", "Echo for suspected structural disease"],
              ["holter", "Ambulatory ECG when arrhythmia is suspected"],
              ["ilr", "Prolonged monitoring / ILR specialist assessment"],
              ["device", "Interrogate an existing device"],
              ["eps", "EP review: conduction disease / previous MI or scar"],
              ["tilt", "Tilt / autonomic assessment when indicated"],
              [
                "meds",
                "Review medicines contributing to hypotension / bradycardia",
              ],
              ["labs", "Targeted blood tests for the suspected cause"],
            ],
            true,
          ),
          choose("disposition", "Site of care", [
            ["urgent", "Urgent same-day monitored assessment"],
            ["specialist", "Expedited syncope / specialist assessment"],
            [
              "routine",
              "Routine outpatient care after a complete low-risk assessment",
            ],
          ]),
          {
            id: "reviewDate",
            label: "Assessment / follow-up date",
            type: "date",
            required: true,
          },
        ],
      },
    ],
    outcome: syncopeOutcome,
    assess: (a, c) => ({
      heading: "Syncope assessment",
      rows: [
        { label: "Event", value: String(a.presentation ?? "Not recorded") },
        {
          label: "Working mechanism",
          value: String(a.mechanism ?? "Uncertain"),
        },
        {
          label: "Disposition",
          value: String(a.disposition ?? "Not selected"),
        },
      ],
      recommendations: validateSyncope(a, c)
        ? [validateSyncope(a, c)!]
        : ["Review the actual results before closing the investigation plan."],
    }),
  },
};
