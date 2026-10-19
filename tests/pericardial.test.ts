import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { voidStudy, voidProcedure } from "../server/kernel/corrections.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { EPISODE_RULES } from "../server/engine/episode-rules.js";
import { pericardialProfile } from "../server/engine/pericardial-profile.js";
import {
  validatePericardial,
  pericardialSuggestions,
} from "../shared/wizards-pericardial.js";
import { pericardialSize } from "../shared/pericardial.js";
import {
  buildOutcome,
  visibleQuestions,
  visibleAnswers,
  WIZARDS,
} from "../shared/wizards.js";
import { addDays } from "../shared/clinical.js";
import { cleanProcedure } from "../shared/procedures.js";
import { cleanStudy } from "../shared/studies.js";
let db: DB,
  n = 0;
const actor: Actor = {
    id: "pericardial@test.local",
    name: "Synthetic pericardial",
    role: "clinician",
    siteId: SITE_ID,
  },
  T = today();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = (conditions: string[] = []) =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic pericardial scenario",
      mrn: "PERI-" + ++n,
      sex: "Female",
      birthDate: "1960-01-01",
      conditions,
    }),
  );
const data = (extra: Record<string, unknown> = {}) => ({
  purpose: "Initial assessment",
  modality: "TTE",
  effusion: "Circumferential",
  size: 25,
  haemodynamics: "No tamponade features after assessment",
  inflammation: "Absent",
  constriction: "Absent",
  ...extra,
});
const report = (
  id: string,
  extra: Record<string, unknown> = {},
  date = nowIso(),
) =>
  tx((q) =>
    K.recordStudy(q, actor, id, {
      kind: "pericardial_imaging",
      date,
      findings: data(extra),
    }),
  );
const answers = (extra: Record<string, unknown> = {}) => ({
  safety: "stable",
  type: "effusion",
  symptoms: "none",
  route: "observe",
  cause: "reviewed",
  inflammation: "absent",
  actionDate: T,
  tests: ["echo"],
  followDate: addDays(T, 180),
  activity: "reviewed",
  ...extra,
});
const peri = (extra: Record<string, unknown> = {}) =>
  answers({
    type: "pericarditis",
    presentation: "compatible",
    criteria: ["ecg", "crp"],
    episode: "first",
    myocardium: "no",
    highrisk: ["none"],
    route: "medical",
    inflammation: "confirmed",
    drugSafety: "reviewed",
    first: ["nsaid", "colchicine", "ppi"],
    refractory: "no",
    infection: "excluded",
    second: "none",
    followDate: addDays(T, 7),
    ...extra,
  });
const context = async (id: string) =>
  (await tx((q) => getWizard(q, id, "pericarditis"))).context;
const rule = EPISODE_RULES.find((r) => r.id === "event.pericarditis")!;
const evaluate = async (id: string) =>
  rule.evaluate(await loadState(db, id), {});
const complete = (id: string, a: any, dueDates?: Record<string, string>) =>
  tx((q) =>
    completeWizard(q, actor, id, "pericarditis", { answers: a, dueDates }),
  );
const drainData = (extra: Record<string, unknown> = {}) => ({
  method: "Image-guided pericardiocentesis",
  result: "Drainage performed",
  indication: "Tamponade",
  volume: 400,
  drain: "Left in situ",
  complications: ["None identified"],
  ...extra,
});
const drain = (
  id: string,
  extra: Record<string, unknown> = {},
  date = nowIso(),
) =>
  tx((q) =>
    K.recordProcedure(q, actor, id, {
      kind: "pericardiocentesis",
      date,
      details: drainData(extra),
    }),
  );
const fluid = (
  id: string,
  procedureId: string,
  extra: Record<string, unknown> = {},
  date = nowIso(),
) =>
  tx((q) =>
    K.recordStudy(q, actor, id, {
      kind: "pericardial_fluid",
      date,
      procedureId,
      findings: {
        microbiology: "No growth",
        cytology: "Negative for malignancy",
        tb: "Not indicated",
        ...extra,
      },
    }),
  );
test("effusion boundaries and unknown size", () => {
  assert.equal(pericardialSize(undefined), null);
  assert.equal(pericardialSize(9.9), "Mild");
  assert.equal(pericardialSize(10), "Moderate");
  assert.equal(pericardialSize(20), "Moderate");
  assert.equal(pericardialSize(20.1), "Large");
});
test("data entry triggers one published decision without automatic diagnoses or prescriptions", async () => {
  const id = await patient();
  await report(id);
  await tx((q) => reassess(q, id, "production"));
  const r = await db.query(
    "SELECT id FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='event.pericarditis'",
    [id],
  );
  assert.equal(r.rows.length, 1);
  const s = await loadState(db, id);
  assert.equal(s.conditions.length, 0);
  assert.equal(s.meds.length, 0);
  assert.equal(s.plan.length, 0);
  const p = await tx((q) => previewDecision(q, id, "pericarditis"));
  assert(p.needed.some((q) => q.id === "safety"));
  assert.equal(p.answers.type, "effusion");
});
test("new problem-list pericardial disease triggers assessment", async () => {
  for (const code of [
    "pericarditis",
    "pericardial-effusion",
    "constrictive-pericarditis",
  ]) {
    const id = await patient([code]);
    assert.equal((await evaluate(id)).length, 1);
  }
});
test("stable large non-inflammatory effusion permits surveillance without automatic drainage / medicine", async () => {
  const id = await patient();
  await report(id);
  await complete(id, answers());
  const s = await loadState(db, id);
  assert(
    !s.plan.some(
      (p) => p.category === "medication" || p.category === "procedure",
    ),
  );
  assert.equal(s.meds.length, 0);
  assert(s.plan.some((p) => p.completes_on.kind === "pericardial_imaging"));
  assert.equal((await evaluate(id)).length, 0);
});
test("a new tamponade report reopens a previously reviewed decision", async () => {
  const id = await patient();
  await report(id);
  await complete(id, answers());
  await report(id, { haemodynamics: "Clinical tamponade" });
  assert.equal((await evaluate(id))[0].severity, "red");
  assert.match(validatePericardial(answers(), await context(id))!, /urgent/);
});
test("tamponade cannot be deferred via answer date or task-date override", async () => {
  const id = await patient();
  await report(id, { haemodynamics: "Clinical tamponade" });
  const c = await context(id);
  assert.match(
    validatePericardial(
      { safety: "urgent", route: "urgent", actionDate: addDays(T, 1) },
      c,
    )!,
    /today/,
  );
  assert.match(
    validatePericardial(
      { safety: "urgent", route: "urgent", actionDate: T },
      c,
      { urgent: addDays(T, 1) },
    )!,
    /today/,
  );
  await assert.rejects(
    complete(id, {
      safety: "urgent",
      route: "urgent",
      actionDate: addDays(T, 1),
    }),
    /today/,
  );
  await complete(id, { safety: "urgent", route: "urgent", actionDate: T });
  assert((await loadState(db, id)).plan.every((p) => p.due_date === T));
});
test("urgent route hides all routine questions despite a stale pericarditis draft", () => {
  const a = peri({ safety: "urgent", route: "urgent" });
  assert.deepEqual(
    WIZARDS.pericarditis.steps
      .flatMap((st) => visibleQuestions(st, a))
      .map((q) => q.id),
    ["safety", "route", "actionDate"],
  );
});
test("definite pericarditis treatment requires compatible presentation and two supporting criteria", async () => {
  const c = await context(await patient());
  assert.match(
    validatePericardial(peri({ criteria: ["crp"] }), c)!,
    /at least two/,
  );
  assert.match(
    validatePericardial(peri({ presentation: "uncertain" }), c)!,
    /compatible/,
  );
  assert.equal(validatePericardial(peri(), c), null);
  assert.deepEqual(pericardialSuggestions.first(answers(), c), []);
});
test("stale hidden medication answers cannot write treatment for isolated effusion", async () => {
  const c = await context(await patient());
  const a = answers({ first: ["nsaid", "colchicine"] });
  assert.equal(visibleAnswers("pericarditis", a).first, undefined);
  assert(
    !buildOutcome("pericarditis", a, c).some(
      (p) => p.kind === "plan" && p.category === "medication",
    ),
  );
});
test("routine surveillance requires measured haemodynamics, assessed cause and no current symptoms", async () => {
  const id = await patient();
  await report(id, { haemodynamics: "Not assessed", size: undefined });
  const c = await context(id);
  assert.match(validatePericardial(answers(), c)!, /complete/);
  assert.match(
    validatePericardial(answers({ symptoms: "present" }), c)!,
    /complete/,
  );
});
test("large effusion with pericarditis requires hospital assessment, not automatic drainage", async () => {
  const id = await patient();
  await report(id, { inflammation: "Present" });
  const c = await context(id);
  assert.match(validatePericardial(peri(), c)!, /hospital/);
  assert.equal(validatePericardial(peri({ route: "hospital" }), c), null);
});
test("anticoagulation suppresses routine NSAID suggestions and requires an individualized hospital plan", async () => {
  const id = await patient();
  await tx((q) =>
    K.startMedication(q, actor, id, {
      code: "apixaban",
      doseValue: 5,
      frequency: "BID",
      route: "PO",
      effectiveAt: nowIso(),
      indication: "AF",
    }),
  );
  const c = await context(id);
  assert.deepEqual(pericardialSuggestions.first(peri(), c), []);
  assert.match(
    validatePericardial(peri({ route: "hospital" }), c)!,
    /Anticoagulation/,
  );
  assert.equal(
    validatePericardial(
      peri({ route: "hospital", first: ["none"], drugSafety: "needed" }),
      c,
    ),
    null,
  );
});
test("steroid and IL-1 escalation preserve infection / refractory-recurrence safeguards", async () => {
  const c = await context(await patient());
  assert.match(
    validatePericardial(peri({ second: "steroid", infection: "possible" }), c)!,
    /Exclude/,
  );
  assert.match(
    validatePericardial(
      peri({ second: "il1", episode: "first", refractory: "yes" }),
      c,
    )!,
    /IL-1/,
  );
  assert.equal(
    validatePericardial(
      peri({ second: "il1", episode: "recurrent", refractory: "yes" }),
      c,
    ),
    null,
  );
});
test("constriction needs specialist strategy and confirmed inflammation for an inflammatory route", async () => {
  const c = await context(await patient());
  assert.match(
    validatePericardial(
      answers({
        type: "constriction",
        constrictionPlan: "diagnostic",
        persistence: "new",
      }),
      c,
    )!,
    /pericardial-team/,
  );
  assert.match(
    validatePericardial(
      answers({
        type: "constriction",
        route: "specialist",
        constrictionPlan: "inflammatory",
        persistence: "new",
      }),
      c,
    )!,
    /confirmed inflammation/,
  );
  assert.match(
    validatePericardial(
      answers({
        type: "constriction",
        route: "specialist",
        constrictionPlan: "inflammatory",
        inflammation: "confirmed",
        persistence: "persistent",
      }),
      c,
    )!,
    /surgical/,
  );
});
test("post-drainage care and fluid results require a completed procedure from this patient", async () => {
  const id = await patient();
  assert.match(
    validatePericardial(
      answers({ type: "aftercare", route: "specialist" }),
      await context(id),
    )!,
    /actual drainage/,
  );
  await assert.rejects(
    fluid(id, "00000000-0000-0000-0000-000000000000"),
    /Link a completed/,
  );
  const d = await drain(id);
  await assert.rejects(fluid(await patient(), d.id), /Link a completed/);
  await assert.rejects(
    fluid(id, d.id, {}, addDays(T, -1) + "T09:00:00Z"),
    /precede/,
  );
});
test("attempted drainage cannot complete the procedure or qualify for aftercare", async () => {
  const id = await patient();
  await report(id);
  await complete(id, answers({ route: "drain", drainReason: "diagnostic" }));
  await drain(id, { result: "Attempted / no drainage", volume: 0 });
  const s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.category === "procedure")!.status,
    "planned",
  );
  assert.equal(pericardialProfile(s).drainage, null);
});
test("completed drainage closes its actual procedure and opens an aftercare decision", async () => {
  const id = await patient();
  await report(id);
  await complete(id, answers({ route: "drain", drainReason: "diagnostic" }));
  await drain(id);
  const s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.category === "procedure")!.status,
    "completed",
  );
  assert.equal(pericardialProfile(s).suggestedType, "aftercare");
  assert.equal((await evaluate(id)).length, 1);
});
test("pending / unsent fluid tests do not close performance; final results await clinical review", async () => {
  const id = await patient();
  const d = await drain(id);
  await complete(
    id,
    answers({
      type: "aftercare",
      route: "specialist",
      tests: ["echo", "fluid"],
    }),
  );
  for (const microbiology of ["Pending", "Not sent"]) {
    await fluid(id, d.id, { microbiology });
    assert.equal(
      (await loadState(db, id)).plan.find(
        (p) => p.completes_on.kind === "pericardial_fluid",
      )!.status,
      "planned",
    );
  }
  await fluid(id, d.id);
  const p = (await loadState(db, id)).plan.find(
    (p) => p.completes_on.kind === "pericardial_fluid",
  )!;
  assert.equal(p.status, "completed");
  assert.equal(p.progress, "performed");
  assert.equal(p.reviewed_at, null);
  assert(p.completion_refs.includes(d.id));
});
test("another drainage sample cannot complete an existing result task", async () => {
  const id = await patient();
  await drain(id);
  await complete(
    id,
    answers({ type: "aftercare", route: "specialist", tests: ["fluid"] }),
  );
  const d2 = await drain(id);
  await fluid(id, d2.id);
  assert.equal(
    (await loadState(db, id)).plan.find(
      (p) => p.completes_on.kind === "pericardial_fluid",
    )!.status,
    "planned",
  );
});
test("withdrawal of either the fluid report or its source drainage reopens the result task", async () => {
  const id = await patient();
  const d = await drain(id);
  await complete(
    id,
    answers({ type: "aftercare", route: "specialist", tests: ["fluid"] }),
  );
  const f = await fluid(id, d.id);
  await tx((q) => voidStudy(q, actor, id, f.id, "Synthetic correction"));
  assert.equal(
    (await loadState(db, id)).plan.find(
      (p) => p.completes_on.kind === "pericardial_fluid",
    )!.status,
    "planned",
  );
  await fluid(id, d.id);
  await tx((q) => voidProcedure(q, actor, id, d.id, "Synthetic correction"));
  assert.equal(
    (await loadState(db, id)).plan.find(
      (p) => p.completes_on.kind === "pericardial_fluid",
    )!.status,
    "planned",
  );
});
test("imaging completion preserves post-drainage purpose and CMR modality", async () => {
  const id = await patient();
  await drain(id);
  await complete(
    id,
    answers({ type: "aftercare", route: "specialist", tests: ["echo", "cmr"] }),
  );
  await report(id, { purpose: "Initial assessment" });
  let s = await loadState(db, id);
  assert(
    s.plan
      .filter((p) => p.completes_on.kind === "pericardial_imaging")
      .every((p) => p.status === "planned"),
  );
  await report(id, { purpose: "After drainage" });
  s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.completes_on.method === "CMR")!.status,
    "planned",
  );
  assert.equal(
    s.plan.find((p) => p.completes_on.purpose === "After drainage")!.status,
    "completed",
  );
});
test("matching future bookings are reused", async () => {
  const id = await patient();
  await report(id);
  await complete(id, answers());
  await report(id, { size: 26 });
  await complete(id, answers());
  assert.equal(
    (await loadState(db, id)).plan.filter(
      (p) => p.completes_on.kind === "pericardial_imaging",
    ).length,
    1,
  );
});
test("contradictory reporting / procedure outcomes are rejected", () => {
  assert.throws(
    () =>
      cleanStudy(
        "pericardial_imaging",
        data({ effusion: "Absent", haemodynamics: "Clinical tamponade" }),
      ),
    /reconcile/,
  );
  assert.throws(
    () =>
      cleanProcedure(
        "pericardiocentesis",
        drainData({ complications: ["None identified", "Arrhythmia"] }),
      ),
    /not both/,
  );
  assert.throws(
    () =>
      cleanProcedure(
        "pericardiocentesis",
        drainData({ result: "Attempted / no drainage", volume: 10 }),
      ),
    /No-drainage/,
  );
});

test("a newer normal pericardial report supersedes an older echo effusion signal", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordEcho(q, actor, id, {
      date: nowIso(),
      quality: "formal",
      lvef: 55,
      findings: ["Pericardial effusion"],
    }),
  );
  assert.equal((await evaluate(id)).length, 1);
  await report(id, { effusion: "Absent", size: undefined });
  assert.equal((await evaluate(id)).length, 0);
});
test("a new fever reopens assessment and requires a hospital pericarditis route", async () => {
  const id = await patient(["pericarditis"]);
  await complete(id, peri());
  assert.equal((await evaluate(id)).length, 0);
  await tx((q) =>
    K.recordObservations(q, actor, id, {
      effectiveAt: nowIso(),
      items: [{ code: "temp", value: 39 }],
    }),
  );
  assert.equal((await evaluate(id)).length, 1);
  assert.match(validatePericardial(peri(), await context(id))!, /hospital/);
});
test("surveillance booked on a different day does not replace the deliberately selected interval", async () => {
  const id = await patient();
  await report(id);
  await complete(id, answers());
  const c = await context(id);
  const out = buildOutcome(
    "pericarditis",
    answers({ actionDate: addDays(T, 180), followDate: addDays(T, 180) }),
    c,
  );
  assert(
    out.some(
      (p) =>
        p.kind === "plan" &&
        p.completesOn?.kind === "pericardial_imaging" &&
        p.dueDate === addDays(T, 180),
    ),
  );
});
test("a reported constrictive condition is prioritized over a concurrent pericarditis code", async () => {
  const id = await patient(["pericarditis", "constrictive-pericarditis"]);
  assert.equal(
    pericardialProfile(await loadState(db, id)).suggestedType,
    "constriction",
  );
});

test("malignant cytology and positive TB testing create explicit cause-specific review actions", async () => {
  const id = await patient();
  const d = await drain(id);
  await fluid(id, d.id, {
    cytology: "Malignant cells identified",
    tb: "Positive",
  });
  const c = await context(id);
  const out = buildOutcome(
    "pericarditis",
    answers({ type: "aftercare", route: "specialist", tests: ["none"] }),
    c,
  );
  assert(
    out.some(
      (p) => p.kind === "plan" && /cardiology \/ oncology/.test(p.title),
    ),
  );
  assert(out.some((p) => p.kind === "plan" && /TB testing/.test(p.title)));
});
test("a positive bacterial pericardial culture creates an urgent reassessment", async () => {
  const id = await patient();
  const d = await drain(id);
  await fluid(id, d.id, { microbiology: "Organism identified" });
  assert.equal((await evaluate(id))[0].severity, "red");
});

test("changing focus ignores hidden treatment and legacy follow-up answers in preview and confirmation", async () => {
  const id = await patient();
  await report(id);
  const a = answers({
    first: ["nsaid", "colchicine"],
    second: "steroid",
    infection: "possible",
    review: "clinic-7",
    recheck: "7",
  });
  const preview = await tx((q) => previewDecision(q, id, "pericarditis", a));
  assert.equal(preview.blockers.length, 0);
  await complete(id, a);
  const s = await loadState(db, id);
  assert(
    !s.plan.some(
      (p) =>
        p.category === "medication" ||
        p.category === "monitoring" ||
        p.title === "Clinic review",
    ),
  );
});
test("an urgent decision discards old hidden dates and creates no leftover outpatient appointment", async () => {
  const id = await patient();
  await report(id, { haemodynamics: "Clinical tamponade" });
  await complete(
    id,
    peri({
      safety: "urgent",
      route: "urgent",
      followDate: addDays(T, -1),
      review: "clinic-7",
      recheck: "7",
      activity: "myo",
    }),
  );
  const s = await loadState(db, id);
  assert.equal(s.plan.length, 1);
  assert(s.plan.every((p) => p.due_date === T && p.category === "referral"));
});

test("a later limited echo without pericardial assessment cannot erase a formal effusion finding", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordEcho(q, actor, id, {
      date: nowIso(),
      quality: "formal",
      lvef: 55,
      findings: ["Pericardial effusion"],
    }),
  );
  await tx((q) =>
    K.recordEcho(q, actor, id, {
      date: nowIso(),
      quality: "limited",
      lvef: 55,
      findings: [],
    }),
  );
  assert.equal((await evaluate(id)).length, 1);
  await report(id, { effusion: "Absent", size: undefined });
  assert.equal((await evaluate(id)).length, 0);
});

test("historical fever is dated evidence, not today's high-risk feature", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordObservations(q, actor, id, {
      effectiveAt: addDays(T, -30) + "T09:00:00Z",
      items: [{ code: "temp", value: 39 }],
    }),
  );
  const c = await context(id);
  assert.equal(validatePericardial(peri(), c), null);
  assert(
    !pericardialSuggestions
      .highrisk(peri(), c)
      .some((s) => s?.value === "fever"),
  );
});

test("reviewed advice creates no repeat task and aftercare has one clinical follow-up", async () => {
  const id = await patient();
  await drain(id);
  await complete(
    id,
    answers({
      type: "aftercare",
      route: "specialist",
      tests: ["fluid"],
      activity: "reviewed",
    }),
  );
  const s = await loadState(db, id);
  assert.equal(s.plan.filter((p) => p.category === "follow_up").length, 1);
  assert(!s.plan.some((p) => p.category === "education"));
  const out = buildOutcome(
    "pericarditis",
    answers({
      type: "aftercare",
      route: "specialist",
      tests: ["none"],
      activity: "needed",
    }),
    await context(id),
  );
  assert.equal(
    out.filter((p) => p.kind === "plan" && p.category === "education").length,
    1,
  );
});

test("aftercare reuses the same dated pericardial clinical review across earlier decisions", async () => {
  const id = await patient();
  await report(id);
  await complete(id, answers({ tests: ["none"], followDate: addDays(T, 7) }));
  await drain(id);
  await complete(
    id,
    answers({
      type: "aftercare",
      route: "specialist",
      tests: ["fluid"],
      followDate: addDays(T, 7),
    }),
  );
  assert.equal(
    (await loadState(db, id)).plan.filter((p) => p.category === "follow_up")
      .length,
    1,
  );
});
