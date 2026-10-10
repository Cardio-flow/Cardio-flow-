import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import {
  editContext,
  removeContext,
} from "../server/kernel/context-management.js";
import { loadState } from "../server/kernel/state.js";
import { draftNote } from "../server/kernel/notes.js";
import { journey, worklist } from "../server/kernel/views.js";
import { getWizard, completeWizard } from "../server/engine/wizard.js";
import { STRUCTURAL_RULES } from "../server/engine/structural-rules.js";
import { buildOutcome } from "../shared/wizards.js";
import {
  planningMissing,
  ventricularTeerMissing,
} from "../shared/wizards-structural.js";
import { cleanProcedure } from "../shared/procedures.js";
import { voidStudy, voidProcedure } from "../server/kernel/corrections.js";
import { today, type Actor, nowIso } from "../server/kernel/base.js";
import { addDays, localDay } from "../shared/clinical.js";
let db: DB;
const doc: Actor = {
  id: "structural@example.test",
  name: "Synthetic structural clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const T = today(),
  at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(f: (q: any) => Promise<R>) => db.transaction(f);
let seq = 0;
const patient = () =>
  tx((q) =>
    K.createPatient(q, doc, {
      name: "Synthetic structural care",
      mrn: "STRUCT-" + ++seq,
      sex: "Male",
      birthDate: "1950-01-01",
      conditions: [],
    }),
  );
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const base = {
  safety: "stable",
  benefit: "yes",
  team: "yes",
  coronary: "reviewed",
  labs: "reviewed",
  infection: "clear",
  decision: "schedule",
  when: T,
};
const tavi = {
  ...base,
  lesion: "as",
  indication: "symptomatic",
  confirmation: "yes",
  exercise: "normal",
  risk: "high",
};
const ct = {
  intervention: "TAVI",
  modality: "Cardiac CT",
  suitability: "Suitable",
  reviewed: "Yes",
  annulusArea: 450,
  leftCoronaryHeight: 14,
  rightCoronaryHeight: 16,
  aorticRoot: "Complete",
  calcification: "Complete",
  access: "Transfemoral feasible",
};
const care = {
  safety: "stable",
  result: "reviewed",
  conduction: "reviewed",
  protocol: "reviewed",
  medAt: addDays(T, 30),
  echoAt: addDays(T, 30),
  clinicAt: addDays(T, 30),
  education: "reviewed",
  annual: "book",
};
const contextEdit = (c: any, changes: any = {}) => ({
  version: c.version,
  reason: "Wrong details",
  startedAt: c.started_at,
  endedAt: c.ended_at,
  location: c.location,
  service: c.service,
  reasons: c.reasons,
  symptoms: [],
  narrative: "Corrected clinical narrative",
  note: "Corrected note",
  ...changes,
});

test("closed admission edits preserve clinical facts, update documents/readmissions and reject stale or invalid dates", async () => {
  const id = await patient();
  const a = await tx((q) =>
    K.startAdmission(q, doc, id, {
      startedAt: at(addDays(T, -10)),
      location: "CCU",
      reasons: ["Acute decompensated HF"],
    }),
  );
  await tx((q) =>
    K.recordObservations(q, doc, id, {
      contextId: a.id,
      effectiveAt: at(addDays(T, -9)),
      items: [{ code: "creatinine", value: 90 }],
    }),
  );
  await tx((q) =>
    K.discharge(q, doc, id, a.id, {
      endedAt: at(addDays(T, -7)),
      status: "Improved",
      plan: [],
    }),
  );
  const b = await tx((q) =>
    K.startAdmission(q, doc, id, {
      startedAt: at(T),
      location: "Ward 3A",
      reasons: ["Acute decompensated HF"],
    }),
  );
  const c = (await loadState(db, id)).contexts.find((c) => c.id === a.id)!;
  await tx((q) =>
    editContext(
      q,
      doc,
      id,
      a.id,
      contextEdit(c, {
        endedAt: at(addDays(T, -5)),
        location: "Ward 3B",
        dischargeStatus: "Stable",
        events: ["IV diuretics"],
        destination: "Home",
      }),
    ),
  );
  const s = await loadState(db, id);
  assert.equal(
    s.contexts.find((c) => c.id === b.id)!.summary.readmission &&
      (s.contexts.find((c) => c.id === b.id)!.summary.readmission as any).days,
    5,
  );
  assert.equal(s.resolved("creatinine").current?.value_num, 90);
  assert.match(
    (await draftNote(db, id, a.id)).text,
    /Corrected clinical narrative/,
  );
  assert.match(
    (await journey(db, id)).events.find((e) => e.kind === "discharge")!.detail,
    /Stable/,
  );
  await assert.rejects(
    tx((q) => editContext(q, doc, id, a.id, contextEdit(c))),
    /changed/,
  );
  const current = s.contexts.find((c) => c.id === a.id)!;
  await assert.rejects(
    tx((q) =>
      editContext(
        q,
        doc,
        id,
        a.id,
        contextEdit(current, { endedAt: at(addDays(T, -11)) }),
      ),
    ),
    /before/,
  );
  await assert.rejects(
    tx((q) =>
      editContext(
        q,
        doc,
        id,
        a.id,
        contextEdit(current, { startedAt: at(addDays(T, 1)) }),
      ),
    ),
    /future/,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) n FROM cf.audit WHERE entity_id=$1 AND action='correct-context'",
        [a.id],
      )
    ).rows[0].n,
    1,
  );
});

test("deleting a visit reopens its follow-up, cancels originating plans, hides notes and preserves observations/audit", async () => {
  const id = await patient();
  const task = await tx((q) =>
    K.addPlanAction(q, doc, id, {
      category: "follow_up",
      title: "General clinic review",
      dueDate: T,
      completesOn: { type: "visit" },
    }),
  );
  const v = await tx((q) =>
    K.startVisit(q, doc, id, {
      startedAt: nowIso(),
      service: "Cardiology",
      reasons: ["Routine cardiology"],
    }),
  );
  await tx((q) =>
    K.recordObservations(q, doc, id, {
      contextId: v.id,
      effectiveAt: nowIso(),
      items: [{ code: "sbp", value: 120 }],
    }),
  );
  const own = await tx((q) =>
    K.addPlanAction(q, doc, id, {
      contextId: v.id,
      category: "investigation",
      title: "Visit investigation",
      dueDate: addDays(T, 5),
    }),
  );
  const c = (await loadState(db, id)).contexts[0];
  assert.equal(
    (await loadState(db, id)).plan.find((p) => p.id === task.id)!.status,
    "completed",
  );
  await tx((q) =>
    removeContext(q, doc, id, v.id, {
      version: c.version,
      reason: "Duplicate entry",
    }),
  );
  const s = await loadState(db, id);
  assert.equal(s.contexts.length, 0);
  assert.equal(s.resolved("sbp").current?.value_num, 120);
  assert.equal(s.plan.find((p) => p.id === task.id)!.status, "planned");
  assert.equal(s.plan.find((p) => p.id === own.id)!.status, "cancelled");
  assert.ok(!(await journey(db, id)).events.some((e) => e.ref_id === v.id));
  await assert.rejects(draftNote(db, id, v.id), /not found/);
  await assert.rejects(
    tx((q) =>
      K.recordObservations(q, doc, id, {
        contextId: v.id,
        effectiveAt: nowIso(),
        items: [{ code: "hr", value: 70 }],
      }),
    ),
    /not found/,
  );
  const reopened = await tx((q) =>
    K.startVisit(q, doc, id, {
      startedAt: nowIso(),
      service: "Cardiology",
      reasons: ["Routine cardiology"],
    }),
  );
  assert.notEqual(reopened.id, v.id);
  assert.ok(
    (
      await db.query("SELECT removed_at FROM cf.care_context WHERE id=$1", [
        v.id,
      ])
    ).rows[0].removed_at,
  );
});

test("removing an admission recomputes readmission links and releases the open-admission guard", async () => {
  const id = await patient();
  const a = await tx((q) =>
    K.startAdmission(q, doc, id, {
      startedAt: at(addDays(T, -8)),
      location: "CCU",
      reasons: ["Acute decompensated HF"],
    }),
  );
  await tx((q) =>
    K.discharge(q, doc, id, a.id, {
      endedAt: at(addDays(T, -4)),
      status: "Improved",
      plan: [],
    }),
  );
  const b = await tx((q) =>
    K.startAdmission(q, doc, id, {
      startedAt: at(T),
      location: "CCU",
      reasons: ["Acute decompensated HF"],
    }),
  );
  let s = await loadState(db, id);
  await tx((q) =>
    removeContext(q, doc, id, a.id, {
      version: s.contexts.find((c) => c.id === a.id)!.version,
      reason: "Wrong entry",
    }),
  );
  s = await loadState(db, id);
  assert.equal(s.contexts[0].summary.readmission, null);
  assert.equal(s.contexts[0].previous_context_id, null);
  await tx((q) =>
    removeContext(q, doc, id, b.id, {
      version: s.contexts[0].version,
      reason: "Duplicate entry",
    }),
  );
  await tx((q) =>
    K.startAdmission(q, doc, id, {
      startedAt: at(T),
      location: "CCU",
      reasons: ["Other"],
    }),
  );
  await assert.rejects(
    tx((q) =>
      editContext(
        q,
        { ...doc, siteId: "00000000-0000-0000-0000-000000000000" },
        id,
        b.id,
        {} as any,
      ),
    ),
    /Patient not found/,
  );
});

test("TAVI schedules only with recorded severe disease and complete reviewed anatomy; withdrawn reports remove readiness", async () => {
  const id = await patient();
  await tx((q) =>
    K.addCondition(q, doc, id, {
      code: "as",
      attributes: { severity: "Severe" },
    }),
  );
  await tx((q) =>
    K.recordEcho(q, doc, id, {
      date: nowIso(),
      quality: "formal",
      lvef: 55,
      findings: [],
      valves: { as: "Severe" },
      measures: { ava: 0.8, "av-vmax": 4.3, "av-mg": 45 },
    }),
  );
  let c = (await tx((q) => getWizard(q, id, "tavi-plan"))).context;
  assert.equal(
    buildOutcome("tavi-plan", tavi, c).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
    false,
  );
  const st = await tx((q) =>
    K.recordStudy(q, doc, id, {
      kind: "structural_imaging",
      date: at(T),
      findings: ct,
    }),
  );
  c = (await tx((q) => getWizard(q, id, "tavi-plan"))).context;
  assert.deepEqual(planningMissing(c, "TAVI"), []);
  assert.ok(
    buildOutcome("tavi-plan", tavi, c).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
  c.valve!.lesions = [];
  c.valve!.echo = {};
  assert.ok(
    !buildOutcome("tavi-plan", tavi, c).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
  await tx((q) => voidStudy(q, doc, id, st.id, "Wrong entry"));
  c = (await tx((q) => getWizard(q, id, "tavi-plan"))).context;
  assert.ok(planningMissing(c, "TAVI").length);
});

test("ventricular TEER uses recorded outcome criteria and tricuspid candidates need actual RHC", async () => {
  const id = await patient();
  let c = (await tx((q) => getWizard(q, id, "teer-plan"))).context;
  c.values = {
    lvef: { value: 35, at: T, prev: null },
    lvesd: { value: 60, at: T, prev: null },
    spap: { value: 55, at: T, prev: null },
    "nt-probnp": { value: 1200, at: T, prev: null },
  };
  c.valve!.nyha = "II";
  assert.deepEqual(ventricularTeerMissing(c, { exclusions: "clear" }), []);
  c.values.lvef.value = 50;
  assert.ok(
    ventricularTeerMissing(c, { exclusions: "clear" }).some((x) =>
      x.includes("LVEF"),
    ),
  );
  c.values.lvef.value = 35;
  c.dx!.push("amyloid");
  assert.ok(ventricularTeerMissing(c, { exclusions: "clear" }).length);
  const a = {
    ...base,
    target: "tricuspid",
    symptoms: "yes",
    risk: "high",
    optimized: "yes",
    rhc: "reviewed",
  };
  c.valve!.lesions = [{ code: "tr", severity: "Severe" }];
  c.structural!.latestEchoId = "recorded-echo";
  c.structural!.planning = [
    {
      id: "report",
      day: T,
      findings: {
        intervention: "Tricuspid TEER",
        suitability: "Suitable",
        reviewed: "Yes",
        jetLocation: "Central",
        coaptationGap: 4,
        leafletLength: 12,
        leafletReview: "Suitable under selected device IFU",
        leadInteraction: "No lead",
        rvFunction: "No severe dysfunction",
        pulmonaryVascular: "No pre-capillary PH",
      },
    },
  ];
  assert.ok(
    !buildOutcome("teer-plan", a, c).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
  c.structural!.rhcId = "actual-rhc";
  assert.ok(
    buildOutcome("teer-plan", a, c).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
});

test("aborted structural procedures add no implant and cannot close intervention tasks; aftercare is actual-procedure-linked", async () => {
  const id = await patient();
  const plan = await tx((q) =>
    K.addPlanAction(q, doc, id, {
      category: "procedure",
      title: "Mitral TEER",
      createdAt: at(addDays(T, -2)),
      dueDate: T,
      completesOn: {
        type: "procedure",
        kind: "valve",
        position: "Mitral",
        procedure: "Transcatheter edge-to-edge repair (TEER)",
      },
    }),
  );
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "valve",
      date: at(T),
      details: {
        position: "Mitral",
        procedure: "Transcatheter edge-to-edge repair (TEER)",
        result: "Aborted / no implant",
      },
    }),
  );
  assert.equal(
    (await loadState(db, id)).conditions.some(
      (c) => c.code === "prosthetic-valve",
    ),
    false,
  );
  assert.equal(
    (await loadState(db, id)).plan.find((p) => p.id === plan.id)!.status,
    "planned",
  );
  await assert.rejects(
    tx((q) =>
      completeWizard(q, doc, id, "after-structural", { answers: care }),
    ),
    /completed structural/,
  );
  const actual = await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "valve",
      date: nowIso(),
      details: {
        position: "Mitral",
        procedure: "Transcatheter edge-to-edge repair (TEER)",
        deviceModel: "Synthetic clip",
        implantCount: 2,
        residualGrade: "Mild",
        meanGradient: 3,
      },
    }),
  );
  assert.equal(
    (await loadState(db, id)).plan.find((p) => p.id === plan.id)!.status,
    "completed",
  );
  await tx((q) =>
    completeWizard(q, doc, id, "after-structural", { answers: care }),
  );
  let s = await loadState(db, id);
  assert.equal(
    s.procedureReviews?.["after-structural"].answers._procedureId,
    actual.id,
  );
  assert.equal(s.meds.length, 0);
  assert.equal(STRUCTURAL_RULES[1].evaluate(s, {}).length, 0);
  await tx((q) => voidProcedure(q, doc, id, actual.id, "Wrong entry"));
  s = await loadState(db, id);
  assert.equal(s.plan.find((p) => p.id === plan.id)!.status, "planned");
  assert.throws(
    () =>
      cleanProcedure("valve", {
        position: "Aortic",
        procedure: "Transcatheter edge-to-edge repair (TEER)",
      }),
    /mitral or tricuspid/,
  );
});

test("structural planning and annual surveillance cannot be closed by the wrong report or an early echo", async () => {
  const id = await patient();
  const planning = await tx((q) =>
    K.addPlanAction(q, doc, id, {
      createdAt: at(addDays(T, -2)),
      category: "investigation",
      title: "Mitral TEER planning",
      dueDate: T,
      completesOn: {
        type: "study",
        kind: "structural_imaging",
        intervention: "Mitral TEER",
      },
    }),
  );
  await tx((q) =>
    K.recordStudy(q, doc, id, {
      kind: "structural_imaging",
      date: nowIso(),
      findings: ct,
    }),
  );
  assert.equal(
    (await loadState(db, id)).plan.find((p) => p.id === planning.id)!.status,
    "planned",
  );
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "valve",
      date: at(addDays(T, -1)),
      details: { position: "Aortic", procedure: "TAVI" },
    }),
  );
  await tx((q) =>
    completeWizard(q, doc, id, "after-structural", { answers: care }),
  );
  const echo = await tx((q) =>
    K.recordEcho(q, doc, id, {
      date: nowIso(),
      lvef: 55,
      quality: "formal",
      findings: [],
    }),
  );
  const s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.title.includes("annual valve"))!.status,
    "planned",
  );
  assert.equal(
    STRUCTURAL_RULES[1].evaluate(s, {}).length,
    1,
    "new echo needs a decision",
  );
});

test("scheduled structural decisions quiet preparation only for the reviewed facts; new results reopen it", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordEcho(q, doc, id, {
      date: nowIso(),
      quality: "formal",
      lvef: 55,
      findings: [],
      valves: { as: "Severe" },
      measures: { ava: 0.8, "av-vmax": 4.3, "av-mg": 45 },
    }),
  );
  await tx((q) =>
    K.recordStudy(q, doc, id, {
      kind: "structural_imaging",
      date: nowIso(),
      findings: ct,
    }),
  );
  await tx((q) => completeWizard(q, doc, id, "tavi-plan", { answers: tavi }));
  let s = await loadState(db, id);
  assert.equal(
    STRUCTURAL_RULES[0].evaluate(s, {}).length,
    0,
    "the plan belongs to this reviewed decision",
  );
  await tx((q) =>
    K.recordObservations(q, doc, id, {
      effectiveAt: nowIso(),
      items: [{ code: "creatinine", value: 140 }],
    }),
  );
  s = await loadState(db, id);
  assert.equal(
    STRUCTURAL_RULES[0].evaluate(s, {}).length,
    1,
    "changed renal data need renewed preparation review",
  );
  await tx((q) => completeWizard(q, doc, id, "tavi-plan", { answers: tavi }));
  assert.equal(
    STRUCTURAL_RULES[0].evaluate(await loadState(db, id), {}).length,
    0,
  );
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "valve",
      date: nowIso(),
      details: { position: "Aortic", procedure: "TAVI" },
    }),
  );
  await tx((q) =>
    completeWizard(q, doc, id, "after-structural", {
      answers: { ...care, safety: "urgent" },
    }),
  );
  assert.equal(
    STRUCTURAL_RULES[1].evaluate(await loadState(db, id), {}).length,
    1,
    "urgent symptoms do not quietly complete recovery review",
  );
});

test("generic TEER booking follows the selected valve; a mitral decision cannot cover an explicit tricuspid booking", async () => {
  for (const explicit of [false, true]) {
    const id = await patient();
    await tx((q) =>
      K.addPlanAction(q, doc, id, {
        category: "procedure",
        title: explicit
          ? "Tricuspid TEER (Heart Team decision)"
          : "Mitral / tricuspid TEER (Heart Team decision)",
        dueDate: T,
      }),
    );
    await tx((q) =>
      completeWizard(q, doc, id, "teer-plan", {
        answers: {
          ...base,
          target: "mitral",
          phenotype: "primary",
          symptoms: "no",
          risk: "standard",
          optimized: "pending",
          decision: "workup",
        },
      }),
    );
    assert.equal(
      STRUCTURAL_RULES[0].evaluate(await loadState(db, id), {}).length,
      explicit ? 1 : 0,
    );
  }
});
