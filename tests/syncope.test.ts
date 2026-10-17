import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { SYNCOPE_RULES } from "../server/engine/syncope-rules.js";
import { addDays } from "../shared/clinical.js";
let db: DB,
  n = 0;
const actor: Actor = {
    id: "syncope@test.local",
    name: "Synthetic syncope",
    role: "clinician",
    siteId: SITE_ID,
  },
  T = today();
const tx = <R>(f: (q: any) => Promise<R>) => db.transaction(f);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = (birthDate = "1960-01-01") =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic syncope",
      mrn: "SYNCOPE-" + ++n,
      sex: "Male",
      birthDate,
      conditions: [],
    }),
  );
const visit = (id: string, reason = "Syncope") =>
  tx(async (q) => {
    const r = await K.startVisit(q, actor, id, {
      reasons: [reason],
      service: "Cardiology",
      symptoms:
        reason === "Unexplained fall"
          ? ["Unexplained fall"]
          : ["Syncope / presyncope"],
      startedAt: nowIso(),
    });
    await reassess(q, id, "production");
    return r;
  });
const ecg = (id: string, avBlock = "None") =>
  tx((q) =>
    K.recordStudy(q, actor, id, {
      kind: "ecg",
      date: nowIso(),
      findings: {
        rhythm: "Sinus rhythm",
        qrsMorphology: "Normal",
        qrs: 96,
        rate: 72,
        avBlock,
      },
    }),
  );
const standing = (
  id: string,
  interpretation = "No compatible orthostatic hypotension",
  symptoms = "No symptoms",
) =>
  tx((q) =>
    K.recordStudy(q, actor, id, {
      kind: "orthostatic_bp",
      date: nowIso(),
      findings: {
        supineSbp: 130,
        supineDbp: 80,
        standing3Sbp: interpretation.startsWith("Compatible") ? 95 : 125,
        standing3Dbp: interpretation.startsWith("Compatible") ? 65 : 78,
        symptoms,
        interpretation,
      },
    }),
  );
const evaluate = async (id: string) =>
  SYNCOPE_RULES[0].evaluate(await loadState(db, id), {});
const answers = (extra: any = {}) => ({
  presentation: "syncope",
  circumstances: "reflex",
  frequency: "single",
  redflags: ["none"],
  ecg: "reviewed",
  orthostatic: "negative",
  mechanism: "reflex",
  tests: ["none"],
  disposition: "routine",
  reviewDate: addDays(T, 14),
  ...extra,
});
test("explicit symptoms trigger a published production assessment, not a silent diagnosis or prescription", async () => {
  const id = await patient();
  await visit(id);
  const rec = (
    await db.query<any>(
      "SELECT rule_id,action FROM cf.recommendation WHERE patient_id=$1 AND status='active'",
      [id],
    )
  ).rows;
  assert(rec.some((r) => r.rule_id === "event.syncope"));
  const s = await loadState(db, id);
  assert.equal(s.meds.length, 0);
  assert.equal(s.plan.length, 0);
  const p = await tx((q) => previewDecision(q, id, "syncope"));
  assert(p.needed.some((q) => q.id === "redflags"));
  assert(!p.answers.redflags);
});
test("unexplained falls trigger assessment; children do not enter the adult algorithm", async () => {
  const id = await patient();
  await visit(id, "Unexplained fall");
  assert.equal((await evaluate(id)).length, 1);
  assert.equal(
    (await tx((q) => getWizard(q, id, "syncope"))).context.syncope
      ?.presentation,
    "fall",
  );
  const child = await patient(`${Number(T.slice(0, 4)) - 12}-01-01`);
  await visit(child);
  assert.equal((await evaluate(child)).length, 0);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, child, "syncope", { answers: answers() }),
    ),
    /adult pathway/,
  );
});
test("a normal office BP does not clear incomplete initial assessment", async () => {
  const id = await patient();
  await visit(id);
  const a = answers({
    ecg: "needed",
    orthostatic: "not-done",
    mechanism: "uncertain",
  });
  await assert.rejects(
    tx((q) => completeWizard(q, actor, id, "syncope", { answers: a })),
    /Complete the ECG/,
  );
  const p = await tx((q) =>
    previewDecision(q, id, "syncope", { ...a, disposition: "specialist" }),
  );
  assert(p.plan.some((x) => /12-lead ECG/.test(x.label)));
  assert(p.plan.some((x) => /supine and standing BP/.test(x.label)));
});
test("high-grade AV block forces urgent assessment and cannot be deferred by a date override", async () => {
  const id = await patient();
  await visit(id);
  await ecg(id, "Complete");
  assert.equal((await evaluate(id))[0].severity, "red");
  await assert.rejects(
    tx((q) => completeWizard(q, actor, id, "syncope", { answers: answers() })),
    /High-risk/,
  );
  const a = answers({
    redflags: ["cardiac"],
    disposition: "urgent",
    reviewDate: T,
  });
  const p = await tx((q) => previewDecision(q, id, "syncope", a));
  assert.equal(p.ready, true);
  const title = p.plan.find((x) => x.kind === "plan")!.title!;
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "syncope", {
        answers: a,
        dueDates: { [title]: addDays(T, 1) },
      }),
    ),
    /must be dated today/,
  );
  await tx((q) =>
    completeWizard(q, actor, id, "syncope", {
      answers: a,
      evidenceKey: p.evidenceKey,
    }),
  );
  assert(
    (await loadState(db, id)).plan.some((p) => /urgent same-day/.test(p.title)),
  );
});
test("exertional or supine events cannot be mislabeled as low risk by choosing none", async () => {
  const id = await patient();
  await visit(id);
  for (const circumstances of ["exertion", "supine", "palpitations"]) {
    const p = await tx((q) =>
      previewDecision(q, id, "syncope", answers({ circumstances })),
    );
    assert.equal(p.ready, false);
    assert(p.blockers.some((b) => b.includes("High-risk")));
  }
});
test("standing BP is recorded with actual readings and an explicit clinical interpretation", async () => {
  const id = await patient();
  await visit(id);
  await assert.rejects(
    standing(id).then(() =>
      tx((q) =>
        K.recordStudy(q, actor, id, {
          kind: "orthostatic_bp",
          date: nowIso(),
          findings: {
            interpretation: "Compatible symptomatic orthostatic hypotension",
          },
        }),
      ),
    ),
    /required|Enter|complete|Supine|supine/i,
  );
  await standing(
    id,
    "Compatible symptomatic orthostatic hypotension",
    "Usual symptoms reproduced",
  );
  const c = (await tx((q) => getWizard(q, id, "syncope"))).context;
  assert.deepEqual(c.detected.orthostatic, ["positive"]);
});
test("reviewed facts stay quiet; a later concerning ECG reopens the assessment", async () => {
  const id = await patient();
  await visit(id);
  await ecg(id);
  await standing(id);
  const p = await tx((q) => previewDecision(q, id, "syncope", answers()));
  await tx((q) =>
    completeWizard(q, actor, id, "syncope", {
      answers: p.answers,
      evidenceKey: p.evidenceKey,
    }),
  );
  assert.equal((await evaluate(id)).length, 0);
  await ecg(id, "Mobitz II");
  assert.equal((await evaluate(id))[0].severity, "red");
});
test("a syncope ECG plan closes with the matching result and remains awaiting clinical review", async () => {
  const id = await patient();
  await visit(id);
  const p = await tx((q) =>
    previewDecision(
      q,
      id,
      "syncope",
      answers({
        ecg: "needed",
        orthostatic: "not-done",
        mechanism: "uncertain",
        disposition: "specialist",
      }),
    ),
  );
  await tx((q) =>
    completeWizard(q, actor, id, "syncope", {
      answers: p.answers,
      evidenceKey: p.evidenceKey,
    }),
  );
  await ecg(id);
  const s = await loadState(db, id),
    task = s.plan.find((p) => /12-lead ECG/.test(p.title))!;
  assert.equal(task.status, "completed");
  assert.equal(task.reviewed_at, null);
  assert.equal(task.completes_on.requiresReview, true);
});

test("the recorded device and cardiomyopathy feed targeted investigation suggestions",async()=>{
 const id=await patient();await visit(id);
 await tx(q=>K.addCondition(q,actor,id,{code:"cied",attributes:{type:"Pacemaker"}}));
 await tx(q=>K.addCondition(q,actor,id,{code:"hcm"}));
 const p=await tx(q=>previewDecision(q,id,"syncope"));
 assert((p.answers.tests as string[]).includes("device"));
 assert((p.answers.tests as string[]).includes("echo"));
});

test("a standing BP result before the new event is not copied forward as today's assessment",async()=>{
 const id=await patient();
 await tx(q=>K.recordStudy(q,actor,id,{kind:"orthostatic_bp",date:new Date(`${addDays(T,-10)}T09:00:00Z`).toISOString(),findings:{supineSbp:130,supineDbp:80,standing3Sbp:125,standing3Dbp:78,symptoms:"No symptoms",interpretation:"No compatible orthostatic hypotension"}}));
 await visit(id);const c=(await tx(q=>getWizard(q,id,"syncope"))).context;assert.equal(c.detected.orthostatic,undefined);
});
