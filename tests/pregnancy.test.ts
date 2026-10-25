import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { reassess } from "../server/engine/engine.js";
import { pregnancyProfile } from "../server/engine/pregnancy-profile.js";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { TodayBoard } from "../src/screens/Today.js";
import { Pulse, toneOf } from "../src/screens/Pulse.js";
import { PREGNANCY_RULES } from "../server/engine/pregnancy-rules.js";
import {
  completeWizard,
  getWizard,
  wizardContext,
} from "../server/engine/wizard.js";
import { previewDecision } from "../server/engine/decide.js";
import { summary } from "../server/kernel/views.js";
import { preStartCheck } from "../server/engine/med-safety.js";
import { MEDICATION } from "../shared/catalog.js";
import { addDays } from "../shared/clinical.js";
import { cleanAttributes } from "../shared/history.js";
import {
  cleanPregnancy,
  pregnancyDrugIssue,
  pregnancyHaemoglobinCutoff,
} from "../shared/pregnancy.js";
import {
  buildOutcome,
  visibleAnswers,
  type Answers,
} from "../shared/wizards.js";
import {
  validatePregnancy,
  pregnancyOutcomeBlocker,
} from "../shared/wizards-pregnancy.js";
let db: DB,
  n = 0;
const T = today(),
  actor: Actor = {
    id: "pregnancy@test.local",
    name: "Synthetic pregnancy",
    role: "clinician",
    siteId: SITE_ID,
  };
const tx = <R>(f: (q: any) => Promise<R>) => db.transaction(f);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = (conditions: string[] = []) =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic pregnancy scenario",
      mrn: "PREG-" + ++n,
      sex: "Female",
      birthDate: "1995-01-01",
      conditions,
    }),
  );
async function context(
  id: string,
  attributes: Record<string, unknown> = {
    phase: "Pregnant",
    edd: addDays(T, 140),
    mwho: "II",
  },
) {
  const c = (await loadState(db, id)).conditions.find(
    (c) => c.code === "pregnancy-care",
  );
  return tx((q) =>
    K.recordHistory(
      q,
      actor,
      id,
      c
        ? {
            effectiveAt: nowIso(),
            update: [{ logicalId: c.logical_id, onset: c.onset, attributes }],
          }
        : {
            effectiveAt: nowIso(),
            add: [{ code: "pregnancy-care", attributes }],
          },
    ),
  );
}
const obs = (
  id: string,
  items: K.ObsInput[],
  at = nowIso(),
  status: "final" | "preliminary" = "final",
) =>
  tx((q) =>
    K.recordObservations(q, actor, id, { effectiveAt: at, items, status }),
  );
const med = (id: string, code: string, dose = 5) =>
  tx((q) =>
    K.startMedication(q, actor, id, {
      code,
      doseValue: dose,
      frequency: "OD",
      route: "PO",
      indication: "other",
      effectiveAt: nowIso(),
      alreadyTaking: true,
    }),
  );
const state = (id: string) => loadState(db, id);
const profile = async (id: string) => pregnancyProfile(await state(id));
async function active(id: string, changed: string[] | null = null) {
  await tx((q) => reassess(q, id, "production", changed));
  return (
    await db.query(
      `SELECT * FROM cf.recommendation WHERE patient_id=$1 AND status='active'`,
      [id],
    )
  ).rows as any[];
}
const base = (extra: Answers = {}): Answers => ({
  safety: "stable",
  focus: "antenatal",
  care: "team",
  medicines: "none",
  anticoag: "none",
  tests: ["none"],
  delivery: "early",
  aspirin: "none",
  actionDate: T,
  counselling: ["choices"],
  followDate: addDays(T, 7),
  ...extra,
});
const ctx = async (id: string) =>
  wizardContext(await state(id), "pregnancy-plan");
async function confirm(id: string, a: Answers = base()) {
  const r = (await active(id)).find((r) => r.rule_id === "pregnancy.care");
  return tx((q) =>
    completeWizard(q, actor, id, "pregnancy-plan", {
      answers: a,
      recommendationId: r?.id,
    }),
  );
}

test("ordinary patients do not acquire a pregnancy assumption or alert", async () => {
  const id = await patient(["hfref", "htn"]);
  await obs(id, [{ code: "sbp", value: 145 }]);
  assert.equal((await profile(id)).eligible, false);
  assert.ok(!(await active(id)).some((r) => r.rule_id === "pregnancy.care"));
});
test("context validation rejects impossible/future dates, unsupported classes and contradictory symptoms", () => {
  for (const a of [
    { phase: "Pregnant", edd: "2026-02-30" },
    { phase: "Postpartum", deliveredOn: addDays(T, 1) },
    { phase: "Pregnant", mwho: "low" },
    {
      phase: "Pregnant",
      symptoms: ["None reported", "Chest pain"],
      assessedOn: T,
    },
    { phase: "Pregnant", symptoms: ["Chest pain"] },
  ])
    assert.throws(() => cleanPregnancy(a));
  assert.deepEqual(
    cleanAttributes("pregnancy-care", {
      phase: "Postpartum",
      deliveredOn: addDays(T, -1),
      edd: addDays(T, 120),
    }),
    { phase: "Postpartum", deliveredOn: addDays(T, -1) },
  );
});
test("saving explicit context activates one care recommendation with known dating and no invented mWHO", async () => {
  const id = await patient();
  await context(id, { phase: "Pregnant", edd: addDays(T, 140) });
  const p = await profile(id);
  assert.equal(p.gestationDays, 140);
  assert.equal(p.mwho, null);
  assert.equal(p.needsHeartTeam, true);
  assert.equal(
    (await active(id)).filter((r) => r.rule_id === "pregnancy.care").length,
    1,
  );
  assert.match(
    validatePregnancy(base({ care: "routine" }), await ctx(id))!,
    /Heart Team/,
  );
});
for (const [sbp, dbp, urgent] of [
  [159, 109, false],
  [160, 90, true],
  [120, 110, true],
] as const)
  test(`pregnancy BP ${sbp}/${dbp}: ${urgent ? "urgent" : "routine triage"}`, async () => {
    const id = await patient(["htn"]);
    await context(id);
    await obs(id, [
      { code: "sbp", value: sbp },
      { code: "dbp", value: dbp },
    ]);
    const r = await active(id),
      preg = r.find((r) => r.rule_id === "pregnancy.care");
    assert.equal(preg.severity, urgent ? "red" : "orange");
    assert.ok(
      !r.some(
        (r) => r.rule_id.startsWith("htn.") || r.rule_id.startsWith("rdn."),
      ),
    );
  });
test("old BP and old symptom reports are dated history rather than today's urgent findings", async () => {
  const id = await patient();
  await context(id, {
    phase: "Pregnant",
    edd: addDays(T, 140),
    assessedOn: addDays(T, -10),
    symptoms: ["Chest pain"],
  });
  await obs(
    id,
    [
      { code: "sbp", value: 180 },
      { code: "dbp", value: 115 },
    ],
    new Date(addDays(T, -10) + "T09:00:00Z").toISOString(),
  );
  assert.equal((await profile(id)).urgent.length, 0);
});
test("a newer preliminary severe BP remains an urgent verification signal", async () => {
  const id = await patient();
  await context(id);
  await obs(
    id,
    [{ code: "sbp", value: 120 }],
    new Date(T + "T00:00:00+03:00").toISOString(),
  );
  await obs(id, [{ code: "sbp", value: 165 }], nowIso(), "preliminary");
  assert.ok((await profile(id)).urgent.some((s) => /preliminary/.test(s)));
});
test("hypertension with organ abnormalities after 20 weeks prompts assessment, without recording pre-eclampsia as fact", async () => {
  const id = await patient(["ckd-3a"]);
  await context(id);
  await obs(id, [
    { code: "sbp", value: 145 },
    { code: "creatinine", value: 151 },
    { code: "platelets", value: 130 },
  ]);
  const p = await profile(id);
  assert.equal(p.possiblePreeclampsia, true);
  assert.ok(p.urgent.some((s) => /pre-existing CKD/.test(s)));
  assert.ok(
    !(await state(id)).conditions.some((c) => /eclampsia/.test(c.code)),
  );
});
test("postpartum severe BP is urgent, including diastolic-only hypertension", async () => {
  const id = await patient();
  await context(id, {
    phase: "Postpartum",
    deliveredOn: addDays(T, -10),
    breastfeeding: "Yes",
    mwho: "II",
  });
  await obs(id, [
    { code: "sbp", value: 125 },
    { code: "dbp", value: 112 },
  ]);
  assert.ok((await profile(id)).urgent.length);
});
test("urgent route ignores hidden outpatient, aspirin and old dates and cannot be deferred", async () => {
  const id = await patient();
  await context(id);
  await obs(id, [{ code: "sbp", value: 170 }]);
  const c = await ctx(id),
    a = base({
      safety: "urgent",
      aspirin: "start",
      aspirinDose: "150",
      followDate: addDays(T, 90),
      review: "clinic-14",
      recheck: "7",
    });
  const items = buildOutcome("pregnancy-plan", a, c),
    plans = items.filter((i) => i.kind === "plan");
  assert.equal(plans.length, 1);
  assert.equal(plans[0].dueDate, T);
  assert.ok(!items.some((i) => i.kind === "start"));
  assert.ok(!("aspirin" in visibleAnswers("pregnancy-plan", a)));
  assert.match(
    validatePregnancy(a, c, { [plans[0].title]: addDays(T, 1) })!,
    /today/,
  );
  await confirm(id, a);
  assert.equal((await state(id)).meds.length, 0);
  await active(id, ["plan", "pathways"]);
  let view = await summary(db, id, "production");
  let task = view.plan.find(p => p.completesOn.purpose === "pregnancy-urgent")!;
  assert.equal(task.clinicalContext.problem, "pregnancy");
  assert.equal(task.clinicalContext.urgent, true);
  assert.equal(view.attention.find(a => a.action?.planId === task.id)?.severity, "red");
  assert.equal(view.overview.next[0].id, task.id);
  assert.equal(view.overview.counts.tasks, 1);
  const html = renderToStaticMarkup(createElement(TodayBoard, { s: view, open() {}, done() {} }));
  assert.match(html, /aria-label="Pregnancy &amp; heart disease"/);
  assert.match(html, /Open task/);
  // A performed assessment still needs its explicit clinical review.
  await tx(q => K.updatePlanAction(q, actor, id, task.id, { action: "performed", version: task.version, outcome: "Synthetic specialist assessment recorded" }));
  await active(id, ["plan"]);
  view = await summary(db, id, "production");
  task = view.plan.find(p => p.id === task.id)!;
  assert.equal(view.attention.find(a => a.action?.planId === task.id)?.severity, "red");
  assert.equal(view.overview.counts.tasks, 0);
  assert.equal(view.overview.counts.review, 1);
  assert.equal(view.overview.next[0].view, "review");
  await tx(q => K.updatePlanAction(q, actor, id, task.id, { action: "reviewed", version: task.version, outcome: "Synthetic care reviewed" }));
  await active(id, ["plan"]);
  view = await summary(db, id, "production");
  assert.ok(!view.attention.some(a => a.action?.planId === task.id));
  assert.equal(view.overview.counts.review, 0);
});
for (const ef of [29, 30, 45])
  test(`recorded EF ${ef}% cannot be cleared as low-risk routine pregnancy care`, async () => {
    const id = await patient(["hfref"]);
    await context(id, { phase: "Pregnant", edd: addDays(T, 150), mwho: "I" });
    await obs(id, [{ code: "lvef", value: ef }]);
    assert.equal((await profile(id)).needsHeartTeam, true);
    assert.match(
      validatePregnancy(base({ care: "routine" }), await ctx(id))!,
      /Heart Team/,
    );
  });
test("NYHA III/IV and PAH require Heart Team review; PH group 2 is not mislabelled PAH", async () => {
  const id = await patient(["hfpef"]);
  await context(id, { phase: "Pregnant", mwho: "II" });
  await obs(id, [{ code: "nyha", text: "III" }]);
  assert.equal((await profile(id)).needsHeartTeam, true);
  const ph = await patient();
  await tx((q) =>
    K.recordHistory(q, actor, ph, {
      effectiveAt: nowIso(),
      add: [
        { code: "ph", attributes: { group: "Group 2 · left heart disease" } },
      ],
    }),
  );
  await context(ph);
  assert.ok(
    !(await profile(ph)).risks.some((s) => s.startsWith("Pulmonary arterial")),
  );
});
test("pregnancy medication flags integrate with the existing review and do not automatically stop treatment", async () => {
  const id = await patient(["hfref"]);
  await context(id);
  for (const code of ["ramipril", "dapagliflozin", "spironolactone"])
    await med(id, code);
  const p = await profile(id);
  assert.equal(p.medicationFlags.length, 3);
  await active(id);
  const view = (await summary(db, id, "production")) as any;
  assert.equal(
    view.medicationReview.issues.filter(
      (r: any) => r.rule_id === "pregnancy.care",
    ).length,
    1,
  );
  await confirm(id, base({ medicines: "review" }));
  assert.ok((await state(id)).meds.every((m) => m.status === "active"));
  assert.ok(
    (await active(id)).some((r) => r.rule_id === "pregnancy.care"),
    "a booking alone cannot clear unsafe current medicines",
  );
});
test("mechanical valve and VKA are never subjected to an automatic anticoagulation stop", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordHistory(q, actor, id, {
      effectiveAt: nowIso(),
      add: [
        {
          code: "prosthetic-valve",
          attributes: { position: "Mitral", type: "Mechanical" },
        },
      ],
    }),
  );
  await context(id);
  await med(id, "warfarin");
  assert.match(
    validatePregnancy(base({ medicines: "review" }), await ctx(id))!,
    /anticoagulation/,
  );
  await confirm(id, base({ medicines: "review", anticoag: "team" }));
  assert.equal(
    (await state(id)).meds.find((m) => m.code === "warfarin")?.status,
    "active",
  );
});
test("breastfeeding preserves compatible HF medicines and flags SGLT2/ARNI and apixaban", async () => {
  const id = await patient(["hfref"]);
  await context(id, {
    phase: "Postpartum",
    deliveredOn: addDays(T, -7),
    breastfeeding: "Yes",
    mwho: "III",
  });
  for (const code of [
    "enalapril",
    "spironolactone",
    "dapagliflozin",
    "apixaban",
  ])
    await med(id, code);
  const flags = (await profile(id)).medicationFlags.map((m) => m.code);
  assert.ok(flags.includes("dapagliflozin"));
  assert.ok(flags.includes("apixaban"));
  assert.ok(!flags.includes("enalapril"));
  assert.ok(!flags.includes("spironolactone"));
});
test("not-breastfeeding postpartum does not inherit pregnancy-only drug restrictions", () => {
  assert.equal(
    pregnancyDrugIssue("Postpartum", "No", "ramipril", ["acei"]),
    null,
  );
  assert.equal(
    pregnancyDrugIssue("Postpartum", "No", "dapagliflozin", ["sglt2"]),
    null,
  );
});
test("statin advice retains specialist ASCVD nuance and lactation differences", () => {
  assert.match(
    pregnancyDrugIssue("Pregnant", null, "atorvastatin", ["statin"])!.reason,
    /established ASCVD/,
  );
  assert.equal(
    pregnancyDrugIssue("Pregnant", null, "atorvastatin", ["statin"])!.avoid,
    false,
  );
  assert.equal(
    pregnancyDrugIssue("Postpartum", "Yes", "atorvastatin", ["statin"])!.avoid,
    true,
  );
});
test("prescribing preview and confirmation reject generic pregnancy-incompatible drug increases / starts", async () => {
  const id = await patient();
  await context(id);
  const c = await ctx(id);
  for (const code of [
    "ramipril",
    "dapagliflozin",
    "apixaban",
    "mavacamten",
    "semaglutide",
  ])
    assert.ok(
      pregnancyOutcomeBlocker(
        "diabetes",
        [
          {
            kind: "start",
            code,
            doseValue: 5,
            frequency: "OD",
            indication: "other",
            label: "",
          },
        ],
        c,
      ),
      code,
    );
  assert.match(pregnancyOutcomeBlocker("rdn-plan", [], c)!, /RDN/);
  assert.ok(
    preStartCheck(await state(id), "ramipril", MEDICATION.ramipril).some((h) =>
      /pregnancy/.test(h.title),
    ),
  );
});
test("NSAIDs after 20 weeks and high-dose aspirin require specialist review, while low-dose prophylaxis stays available", async () => {
  const id = await patient();
  await context(id);
  const c = await ctx(id);
  assert.ok(
    pregnancyOutcomeBlocker(
      "pericarditis",
      [
        {
          kind: "start",
          code: "ibuprofen",
          doseValue: 400,
          frequency: "TID",
          indication: "pericarditis",
          label: "",
        },
      ],
      c,
    ),
  );
  assert.ok(
    pregnancyOutcomeBlocker(
      "pericarditis",
      [
        {
          kind: "start",
          code: "aspirin",
          doseValue: 1000,
          frequency: "TID",
          indication: "pericarditis",
          label: "",
        },
      ],
      c,
    ),
  );
  assert.equal(
    pregnancyOutcomeBlocker(
      "pregnancy-plan",
      [
        {
          kind: "start",
          code: "aspirin",
          doseValue: 100,
          frequency: "OD",
          indication: "Pre-eclampsia prophylaxis",
          label: "",
        },
      ],
      c,
    ),
    null,
  );
});
test("aspirin prophylaxis uses known risk and dating, not pregnancy alone", async () => {
  const low = await patient();
  await context(low);
  assert.equal((await profile(low)).aspirinCandidate, false);
  const htn = await patient(["htn"]);
  await context(htn);
  assert.equal((await profile(htn)).aspirinCandidate, true);
  await context(htn, { phase: "Pregnant", edd: addDays(T, 210), mwho: "II" });
  assert.equal(
    (await profile(htn)).aspirinCandidate,
    false,
    "10 weeks is before the routine starting window",
  );
  await context(htn, { phase: "Pregnant", mwho: "II" });
  assert.equal(
    (await profile(htn)).aspirinCandidate,
    false,
    "missing dating never authorizes treatment",
  );
});
test("confirmed aspirin creates one regimen and review, and does not immediately reopen its own care decision", async () => {
  const id = await patient(["htn"]);
  await context(id);
  const a = base({
    aspirin: "start",
    aspirinSafety: "reviewed",
    aspirinDose: "100",
    aspirinDate: addDays(T, 112),
  });
  assert.equal(validatePregnancy(a, await ctx(id)), null);
  await confirm(id, a);
  const s = await state(id);
  assert.equal(s.meds.filter((m) => m.code === "aspirin").length, 1);
  assert.equal(s.meds[0].doseValue, 100);
  assert.ok(!(await active(id)).some((r) => r.rule_id === "pregnancy.care"));
});
test("concurrent anticoagulants and existing aspirin cannot acquire a duplicated prophylaxis regimen", async () => {
  const id = await patient(["htn"]);
  await context(id);
  await med(id, "apixaban");
  const a = base({
    aspirin: "start",
    aspirinSafety: "reviewed",
    aspirinDose: "100",
    aspirinDate: addDays(T, 112),
    anticoag: "team",
    medicines: "review",
  });
  assert.match(validatePregnancy(a, await ctx(id))!, /Concurrent/);
  const other = await patient(["htn"]);
  await context(other);
  await med(other, "aspirin", 100);
  assert.match(validatePregnancy(a, await ctx(other))!, /already recorded/);
});
test("new data reopens the decision but same-date Heart Team and follow-up bookings are reused", async () => {
  const id = await patient();
  await context(id);
  await confirm(id);
  const first = (await state(id)).plan.length;
  await obs(id, [{ code: "sbp", value: 135 }]);
  assert.ok((await active(id)).some((r) => r.rule_id === "pregnancy.care"));
  await confirm(id);
  assert.equal((await state(id)).plan.length, first);
});
test("aortic, congenital and genetic disease share the pregnancy care plan", async () => {
  const id = await patient(["bav", "asd"]);
  await context(id);
  const p = await profile(id);
  assert.ok(p.aortic && p.congenital && p.genetic && p.needsHeartTeam);
  const out = buildOutcome(
    "pregnancy-plan",
    base({ tests: ["aorta", "fetal"] }),
    await ctx(id),
  );
  assert.ok(
    out.some((o) => o.kind === "plan" && /Fetal cardiology/.test(o.title)),
  );
  assert.ok(
    out.some((o) => o.kind === "plan" && /aorta imaging/.test(o.title)),
  );
});
test("a completed care context clears pregnancy-only recommendations and restores adult BP care", async () => {
  const id = await patient(["htn"]);
  await context(id);
  await obs(id, [
    { code: "sbp", value: 155 },
    { code: "dbp", value: 95 },
  ]);
  await active(id);
  await context(id, { phase: "Follow-up complete" });
  const rows = await active(id, ["conditions"]);
  assert.ok(!rows.some((r) => r.rule_id === "pregnancy.care"));
  assert.ok(rows.some((r) => r.rule_id.startsWith("htn.")));
});
test("WHO pregnancy Hb cutoffs use collection-time trimester, not adult Hb 12 or today's gestation", () => {
  const edd = addDays(T, 140);
  assert.equal(pregnancyHaemoglobinCutoff(edd, T), 10.5);
  assert.equal(pregnancyHaemoglobinCutoff(edd, addDays(T, -70)), 11);
  assert.equal(pregnancyHaemoglobinCutoff(edd, addDays(T, 70)), 11);
  assert.equal(pregnancyHaemoglobinCutoff(undefined, T), null);
});
test("normal second-trimester Hb is not labelled adult anaemia, and pregnancy scope is prefilled", async () => {
  const id = await patient();
  await context(id);
  await obs(id, [{ code: "haemoglobin", value: 11.3 }]);
  assert.ok(!(await active(id)).some((r) => r.rule_id === "lab.anaemia"));
  await obs(id, [{ code: "haemoglobin", value: 10.2 }]);
  assert.ok((await active(id)).some((r) => r.rule_id === "lab.anaemia"));
  const c = (await getWizard(db, id, "anaemia-result")).context;
  assert.deepEqual(c.detected.scope, ["specialist"]);
  assert.match(
    pregnancyOutcomeBlocker("anaemia-result", [], c, { scope: "standard" })!,
    /specialist/,
  );
});
test("IV iron cannot use an assumed gestational age or a first-trimester adult route", async () => {
  const id = await patient();
  await context(id, { phase: "Pregnant", edd: addDays(T, 224), mwho: "II" });
  assert.match(
    pregnancyOutcomeBlocker("iv-iron", [], await ctx(id), {
      decision: "give",
    })!,
    /first trimester/,
  );
  await context(id, { phase: "Pregnant", mwho: "II" });
  assert.ok(
    pregnancyOutcomeBlocker("iv-iron", [], await ctx(id), { decision: "give" }),
  );
});
test("preview and server share mandatory context, risk and date validation", async () => {
  const id = await patient();
  await context(id, { phase: "Pregnant", mwho: "IV" });
  const preview = await previewDecision(
    db,
    id,
    "pregnancy-plan",
    base({ care: "routine" }),
  );
  assert.equal(preview.ready, false);
  assert.ok(preview.blockers.some((s) => /Heart Team/.test(s)));
  await assert.rejects(
    () => confirm(id, base({ care: "routine" })),
    /Heart Team/,
  );
  await assert.rejects(
    () => confirm(id, base({ followDate: addDays(T, -1) })),
    /date|precede/i,
  );
});

test("an established Heart Team plan avoids a second referral", async () => {
  const id = await patient();
  await context(id, { phase: "Pregnant", edd: addDays(T, 100), mwho: "III" });
  await confirm(id, base({ care: "established", delivery: "needed" }));
  const plans = (await state(id)).plan;
  assert.ok(!plans.some((p) => p.category === "referral"));
  assert.equal(
    plans.filter((p) => /delivery-plan review/.test(p.title)).length,
    1,
  );
});
test("pregnancy display uses pregnancy BP goals and avoids adult HF dose / renal validation badges", async () => {
  const id = await patient(["hfref", "htn", "t2dm"]);
  await context(id);
  await obs(id, [
    { code: "sbp", value: 135 },
    { code: "dbp", value: 85 },
    { code: "lvef", value: 35 },
    { code: "creatinine", value: 65 },
    { code: "weight", value: 65 },
  ]);
  await med(id, "bisoprolol", 5);
  await active(id);
  const view = (await summary(db, id, "production")) as any;
  assert.equal(view.targets.bp.target, "<140");
  assert.match(view.targets.bp.label, /ESC 2025/);
  assert.equal(view.targets.hf, null);
  assert.equal(view.medicationReview.renal, null);
  assert.match(view.medicationReview.renalNote, /creatinine/);
  assert.match(view.targets.diabetes.target, /Pregnancy-specific/);
  assert.ok(
    view.medications.groups
      .flatMap((g: any) => g.meds)
      .every((m: any) => m.targetProgress === null),
  );
});
test("pregnancy keeps urgent potassium safety while removing incompatible elective prescribing prompts", async () => {
  const id = await patient(["hfref"]);
  await context(id);
  await med(id, "ramipril", 5);
  await obs(id, [
    { code: "potassium", value: 6.3 },
    { code: "creatinine", value: 90 },
    { code: "lvef", value: 35 },
  ]);
  const rows = await active(id);
  assert.ok(rows.some((r) => r.rule_id === "hf.hyperkalaemia-review"));
  assert.ok(
    !rows.some(
      (r) =>
        r.action?.type === "start-med" &&
        [
          "ramipril",
          "sacubitril-valsartan",
          "spironolactone",
          "dapagliflozin",
        ].includes(r.action.code),
    ),
  );
});

test("explicit pregnancy concerns from existing hypertension/aorta pathways request context without assuming pregnancy", async () => {
  const id = await patient(["htn"]),
    s = await state(id);
  for (const [wizard, answers] of [
    ["htn-review", { safety: "pregnancy" }],
    ["aorta-plan", { risks: ["pregnancy"] }],
  ] as const) {
    const snapshot = {
      ...s,
      procedureReviews: {
        [wizard]: { id: "test-explicit-hint", at: nowIso(), answers },
      },
    };
    const p = pregnancyProfile(snapshot);
    assert.equal(p.eligible, true);
    assert.equal(p.phase, null);
    assert.equal(
      PREGNANCY_RULES[0].evaluate(snapshot, {} as any)[0].action.type,
      "pregnancy-context",
    );
  }
});

test("single systolic reading leaves a paired BP gap and cannot show On track", async () => {
  const id = await patient(["htn"]);
  await obs(id, [{ code: "sbp", value: 125 }]);
  await active(id);
  const s = await tx((q) => summary(q, id));
  assert.equal(s.targets.bp?.met, null);
  const html = renderToStaticMarkup(createElement(TodayBoard, { s, open: () => {}, done: () => {} }));
  const bp = html.match(/<section class="problem[^>]*aria-label="Blood pressure"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(bp, /Incomplete reading/);
  assert.match(bp, /Record Blood pressure: BP/);
  assert.doesNotMatch(bp, /On track/);
  assert.match(bp, /<button[^>]*Record[\s\S]*?<\/button>/);
});

test("pregnancy BP 148\/94 gets a dated routine review, not a green or urgent card", async () => {
  const id = await patient(["htn"]);
  await context(id, { phase: "Pregnant", edd: addDays(T, 196), mwho: "I" });
  await obs(id, [{ code: "sbp", value: 148 }, { code: "dbp", value: 94 }]);
  const rows = await active(id);
  const p = rows.find((r) => r.rule_id === "pregnancy.care");
  assert.equal(p.severity, "orange");
  assert.match(JSON.stringify(p.facts), /Above pregnancy target/);
  const s = await tx((q) => summary(q, id));
  assert.equal(s.targets.bp?.met, false);
  const html = renderToStaticMarkup(createElement(TodayBoard, { s, open: () => {}, done: () => {} }));
  assert.match(html, /Above pregnancy target/);
  assert.equal((html.match(/>Review pregnancy care<\/button>/g) ?? []).length, 1);
  const out = buildOutcome("pregnancy-plan", base(), await ctx(id));
  assert.ok(out.some((x) => x.kind === "plan" && x.title === "Pregnancy: BP and antihypertensive treatment review" && x.dueDate === T));
  assert.ok(!out.some((x) => x.kind === "start"));
  await confirm(id);
  assert.equal((await state(id)).plan.filter((x) => x.title === "Pregnancy: BP and antihypertensive treatment review").length, 1);
  await obs(id, [{ code: "sbp", value: 150 }, { code: "dbp", value: 94 }]);
  await confirm(id);
  assert.equal((await state(id)).plan.filter((x) => x.title === "Pregnancy: BP and antihypertensive treatment review").length, 1);
});

test("pregnancy Hb and kidney display follow pregnancy interpretation", async () => {
  const id = await patient(["htn"]);
  await context(id, { phase: "Pregnant", edd: addDays(T, 196), mwho: "I" });
  await obs(id, [{ code: "haemoglobin", value: 11.5 }, { code: "creatinine", value: 65 }, { code: "uacr", value: 1 }]);
  const rows = await active(id);
  assert.ok(!rows.some((r) => r.rule_id === "lab.anaemia" || r.rule_id === "cardiorenal.screening"));
  const s = await tx((q) => summary(q, id));
  assert.equal(s.targets.kidney.egfr, null);
  assert.equal(s.targets.kidney.creatinineCurrent, 65);
  assert.equal(toneOf(s.results.find((r: any) => r.code === "haemoglobin"), s), "blue");
  const html = renderToStaticMarkup(createElement(TodayBoard, { s, open: () => {}, done: () => {} }));
  assert.doesNotMatch(html, /aria-label="Blood count &amp; iron"/);
  const pulse = renderToStaticMarkup(createElement(Pulse, { s, open: () => {}, go: () => {} }));
  assert.doesNotMatch(pulse, /eGFR/);
  // since 20 Oct 2026 the kidney card lists its results once ("Normal: Cr 65 …"); never eGFR in pregnancy
  assert.match(html, /Normal: Cr 65/);
  assert.doesNotMatch(html, /eGFR/);
  const other = await patient(["htn"]);
  await context(other, { phase: "Pregnant", edd: addDays(T, 196), mwho: "I" });
  const missing = await active(other);
  const renal = missing.find((r) => r.rule_id === "cardiorenal.screening");
  assert.match(renal.title, /serum creatinine/);
  assert.doesNotMatch(renal.detail, /finerenone|classify CKD/);
  await obs(other, [{ code: "creatinine", value: 65 }]);
  const remaining = (await active(other)).find((r) => r.rule_id === "cardiorenal.screening");
  assert.deepEqual(remaining.action.codes, ["uacr"]);
});

test("pregnancy blood panels require actual complete evidence and leave clinical review outstanding", async () => {
  const id = await patient();
  await context(id);
  await confirm(id, base({ tests: ["bloods"] }));
  await obs(id, [{ code: "haemoglobin", value: 11.5 }]);
  assert.equal(
    (await state(id)).plan.find((p) =>
      p.title.includes("BP / medication bloods"),
    )?.status,
    "planned",
  );
  const codes = [
      "haemoglobin",
      "platelets",
      "creatinine",
      "potassium",
      "alt",
      "ast",
      "uacr",
      "urate",
    ],
    values = [11.5, 220, 65, 4.2, 20, 20, 1, 250];
  await obs(
    id,
    codes.map((code, i) => ({ code, value: values[i] })),
  );
  const row = (await state(id)).plan.find((p) =>
    p.title.includes("BP / medication bloods"),
  )!;
  assert.equal(row.status, "completed");
  assert.equal(row.progress, "performed");
  assert.equal(row.reviewed_at, null);
});

test("pregnancy anaemia preview does not inherit the adult severe-Hb threshold", async () => {
  const id = await patient();
  await context(id);
  await obs(id, [{ code: "haemoglobin", value: 7.5 }]);
  const c = wizardContext(await state(id), "anaemia-result");
  const items = buildOutcome(
    "anaemia-result",
    {
      scope: "specialist",
      flags: ["none"],
      cause: "other",
      actions: ["specialist"],
      recheck: "14",
      review: "none",
    },
    c,
  );
  assert.ok(
    !items.some((i) => i.kind === "plan" && /Urgent assessment/.test(i.title)),
  );
  assert.ok(
    items.some((i) => i.kind === "plan" && /Specialist anaemia/.test(i.title)),
  );
});

test("missing pregnancy stage cannot authorize a pregnancy-sensitive medicine suggestion", async () => {
  const id = await patient(["pregnancy-care", "hfref"]),
    c = await ctx(id);
  assert.match(
    pregnancyOutcomeBlocker(
      "diabetes",
      [
        {
          kind: "start",
          code: "ramipril",
          doseValue: 5,
          frequency: "OD",
          indication: "hf",
          label: "",
        },
      ],
      c,
    )!,
    /Confirm pregnancy stage/,
  );
  const rows = await active(id);
  assert.ok(
    !rows.some(
      (r) =>
        r.action?.type === "start-med" &&
        [
          "ramipril",
          "sacubitril-valsartan",
          "spironolactone",
          "dapagliflozin",
        ].includes(r.action.code),
    ),
  );
});
