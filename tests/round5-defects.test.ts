import {
  assessmentDraftView,
  confirmAssessment,
} from "../server/kernel/assessment.js";
import { correctMedicationEntry } from "../server/kernel/corrections.js";
import { atClinicalDay, localDay } from "../shared/clinical.js";
import { undoLastMedicationChange } from "../server/kernel/corrections.js";
import { evidenceKey } from "../server/kernel/evidence.js";
import { entryDraft } from "../server/kernel/visit-drafts.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { draftNote } from "../server/kernel/notes.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import {
  getVisitDraft,
  saveVisitDraft,
  getDischargeDraft,
  saveDischargeDraft,
} from "../server/kernel/visit-drafts.js";
import { preStartCheck } from "../server/engine/med-safety.js";
import { MEDICATION } from "../shared/catalog.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
let db: DB,
  server: any,
  base: string,
  cookie: string,
  csrf: string,
  seq = 0;
const actor: Actor = {
  id: "r5@example.test",
  name: "Synthetic R5 clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const tx = <T>(f: (q: any) => Promise<T>) => db.transaction(f);
const patient = () =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic R5 fix ${++seq}`,
      mrn: `R5FIX-${seq}`,
      sex: "Male",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions: ["hfref"],
    }),
  );
const at = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
const med = (id: string, code = "eplerenone") =>
  tx((q) =>
    K.startMedication(q, actor, id, {
      code,
      doseValue: 25,
      frequency: "OD",
      route: "PO",
      indication: "hf",
      effectiveAt: at(-2),
    }),
  );
const labs = (id: string, items: K.ObsInput[], extra: any = {}) =>
  tx(async (q) => {
    const r = await K.recordObservations(q, actor, id, {
      effectiveAt: nowIso(),
      items,
      ...extra,
    });
    await reassess(q, id, "sandbox");
    return r;
  });
const event = (id: string, mid: string, kind: any, extra: any = {}) =>
  tx(async (q) => {
    const r = await K.medicationEvent(q, actor, id, mid, {
      kind,
      effectiveAt: nowIso(),
      ...extra,
    });
    await reassess(q, id, "sandbox");
    return r;
  });
const post = async (path: string, body: any) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(base + "/demo-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }),
  });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = (await r.json()).csrf;
});
after(async () => {
  server.close();
  await db.close();
});
const visit = (id: string) =>
  tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      service: "Clinic",
      reasons: ["Routine cardiology"],
    }),
  );
const assessment = (sbp: string, dbp = "", extra: any = {}) => ({
  vit: { sbp, dbp },
  hfa: {},
  nyha: "",
  cong: "",
  ...extra,
});
test("a confirmed legacy assessment draft cannot republish its old BP after a newer reading", async () => {
  const id = await patient(),
    v = await visit(id);
  await tx((q) =>
    entryDraft(q, actor, id, `assessment:${v.id}`, {
      version: 0,
      answers: assessment("148", "88"),
    }),
  );
  await labs(
    id,
    [
      { code: "sbp", value: 148 },
      { code: "dbp", value: 88 },
    ],
    { contextId: v.id },
  );
  await labs(id, [
    { code: "sbp", value: 98 },
    { code: "dbp", value: 60 },
  ]);
  const d: any = await entryDraft(db, actor, id, `assessment:${v.id}`);
  assert.equal(d.answers.vit.sbp, "98");
  assert.equal(d.answers.vit.dbp, "60");
  assert.equal(d.recordChanged, false);
  const count = (await loadState(db, id)).observations.length;
  await tx((q) =>
    confirmAssessment(q, actor, id, v.id, {
      draftVersion: d.version,
      baseline: d.answers.baseline,
      items: [
        { code: "sbp", value: 98 },
        { code: "dbp", value: 60 },
      ],
    }),
  );
  assert.equal((await loadState(db, id)).observations.length, count);
  assert.equal(
    (await loadState(db, id)).resolved("sbp").current!.value_num,
    98,
  );
});
test("a confirmed assessment refreshes after correction of its original observation", async () => {
  const id = await patient(),
    v = await visit(id);
  const initial: any = await entryDraft(db, actor, id, `assessment:${v.id}`);
  const r = await tx((q) =>
    confirmAssessment(q, actor, id, v.id, {
      draftVersion: 0,
      baseline: initial.answers.baseline,
      items: [{ code: "sbp", value: 148 }],
    }),
  );
  await tx((q) => K.correctObservation(q, actor, id, r.ids[0], { value: 98 }));
  const d: any = await entryDraft(db, actor, id, `assessment:${v.id}`);
  assert.equal(d.answers.vit.sbp, "98");
  assert.equal(d.recordChanged, false);
});
test("genuine pending edits require review if a newer reading arrives", async () => {
  const id = await patient(),
    v = await visit(id);
  await labs(id, [{ code: "sbp", value: 148 }]);
  const initial: any = await entryDraft(db, actor, id, `assessment:${v.id}`);
  await tx((q) =>
    entryDraft(q, actor, id, `assessment:${v.id}`, {
      version: 0,
      answers: {
        ...initial.answers,
        vit: { ...initial.answers.vit, sbp: "158" },
      },
    }),
  );
  await labs(id, [{ code: "sbp", value: 98 }]);
  const d: any = await entryDraft(db, actor, id, `assessment:${v.id}`);
  assert.equal(d.answers.vit.sbp, "158");
  assert.equal(d.latestAnswers.vit.sbp, "98");
  assert.equal(d.recordChanged, true);
  await assert.rejects(
    tx((q) =>
      confirmAssessment(q, actor, id, v.id, {
        draftVersion: d.version,
        baseline: d.answers.baseline,
        items: [{ code: "sbp", value: 158 }],
      }),
    ),
    /New readings/,
  );
  assert.equal(
    (await loadState(db, id)).resolved("sbp").current!.value_num,
    98,
  );
  await tx((q) =>
    confirmAssessment(q, actor, id, v.id, {
      draftVersion: d.version,
      baseline: d.latestAnswers.baseline,
      items: [{ code: "sbp", value: 158 }],
    }),
  );
  assert.equal(
    (await loadState(db, id)).resolved("sbp").current!.value_num,
    158,
  );
});
test("assessment confirmation checks both draft version and observation baseline under its lock", async () => {
  const id = await patient(),
    v = await visit(id);
  await labs(id, [{ code: "sbp", value: 148 }]);
  const d: any = await entryDraft(db, actor, id, `assessment:${v.id}`);
  await tx((q) =>
    entryDraft(q, actor, id, `assessment:${v.id}`, {
      version: 0,
      answers: d.answers,
    }),
  );
  const body = {
    baseline: d.answers.baseline,
    items: [{ code: "sbp", value: 158 }],
  };
  await assert.rejects(
    tx((q) =>
      confirmAssessment(q, actor, id, v.id, { ...body, draftVersion: 0 }),
    ),
    /another window/,
  );
  await labs(id, [{ code: "sbp", value: 98 }]);
  await assert.rejects(
    tx((q) =>
      confirmAssessment(q, actor, id, v.id, { ...body, draftVersion: 1 }),
    ),
    /New readings/,
  );
  assert.equal(
    (await loadState(db, id)).resolved("sbp").current!.value_num,
    98,
  );
});
test("older unconfirmed draft readings require review on a later clinical day", async () => {
  const id = await patient(),
    v = await visit(id);
  const view = await assessmentDraftView(db, id, v.id, {
    answers: assessment("148"),
    updated_at: at(-1),
  });
  assert.equal(view.recordChanged, true);
  assert.equal(view.latestAnswers.vit.sbp, "");
});
async function reduced(id: string) {
  const m = await med(id);
  await event(id, m.medicationId, "increase", {
    doseValue: 50,
    override: "Synthetic clinician reviewed",
  });
  await labs(id, [
    { code: "potassium", value: 5.8 },
    { code: "creatinine", value: 90 },
    { code: "sbp", value: 120 },
  ]);
  const rec = (
    await db.query(
      `SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`,
      [id],
    )
  ).rows[0];
  const w = await getWizard(db, id, "hyperkalaemia");
  await tx((q) =>
    completeWizard(q, actor, id, "hyperkalaemia", {
      recommendationId: rec.id,
      evidenceKey: w.context.evidenceKey,
      answers: {
        result: "confirmed",
        ecg: "none",
        contributors: ["mra"],
        actions: ["reduce-mra"],
        mraDose: 25,
        recheck: "3",
        review: "none",
      },
    }),
  );
  await tx((q) => reassess(q, id, "sandbox"));
  return m;
}
const activeK = async (id: string) =>
  (
    await db.query(
      `SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`,
      [id],
    )
  ).rows;
test("undoing a potassium reduction requires fresh review without duplicating existing plans", async () => {
  const id = await patient(),
    m = await reduced(id);
  assert.equal((await activeK(id)).length, 0);
  const count = (await loadState(db, id)).plan.length;
  await tx(async (q) => {
    await undoLastMedicationChange(q, actor, id, m.medicationId, "Wrong entry");
    await reassess(q, id, "sandbox");
  });
  assert.equal((await activeK(id)).length, 1);
  assert.equal((await loadState(db, id)).meds[0].doseValue, 50);
  assert.equal((await loadState(db, id)).plan.length, count);
});
test("corrected dose increases reopen review while lower exposure stays quiet", async () => {
  const id = await patient(),
    m = await reduced(id);
  await tx(async (q) => {
    await correctMedicationEntry(q, actor, id, m.medicationId, {
      doseValue: 50,
      reason: "Corrected",
    });
    await reassess(q, id, "sandbox");
  });
  assert.equal((await activeK(id)).length, 1);
  const other = await patient(),
    n = await reduced(other);
  await tx(async (q) => {
    await correctMedicationEntry(q, actor, other, n.medicationId, {
      frequency: "Alternate days",
      reason: "Corrected",
    });
    await reassess(q, other, "sandbox");
  });
  assert.equal((await activeK(other)).length, 0);
});
test("frequency corrections compare inherited dose exposure rather than an empty event dose", async () => {
  const id = await patient(),
    m = await reduced(id);
  await event(id, m.medicationId, "continue", {
    frequency: "BID",
    override: "Synthetic warning reviewed",
  });
  const rec = (await activeK(id))[0];
  await db.query(`UPDATE cf.recommendation SET status='decided' WHERE id=$1`, [
    rec.id,
  ]);
  await tx(async (q) => {
    await correctMedicationEntry(q, actor, id, m.medicationId, {
      frequency: "OD",
      reason: "Corrected",
    });
    await reassess(q, id, "sandbox");
  });
  assert.equal((await activeK(id)).length, 0);
});
test("stop cancellation provenance survives multiple corrections and preserves independent changes", async () => {
  const id = await patient(),
    m = await med(id, "atorvastatin");
  const automatic = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      title: "Synthetic titration review",
      category: "follow_up",
      medicationId: m.medicationId,
      dueDate: today(),
    }),
  );
  const edited = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      title: "Synthetic later cancellation",
      category: "follow_up",
      medicationId: m.medicationId,
      dueDate: today(),
    }),
  );
  const monitor = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      title: "Synthetic independent monitoring",
      category: "monitoring",
      medicationId: m.medicationId,
      dueDate: today(),
    }),
  );
  await event(id, m.medicationId, "stop", { effectiveAt: at(-1) });
  await tx((q) =>
    correctMedicationEntry(q, actor, id, m.medicationId, {
      effectiveAt: at(-0.8),
      reason: "Corrected",
    }),
  );
  await tx((q) =>
    correctMedicationEntry(q, actor, id, m.medicationId, {
      effectiveAt: at(-0.5),
      reason: "Corrected",
    }),
  );
  await db.query(
    `UPDATE cf.plan_action SET status='cancelled',outcome='Atorvastatin stopped',version=version+1 WHERE id = ANY($1::uuid[])`,
    [[edited.id, monitor.id]],
  );
  await tx((q) =>
    undoLastMedicationChange(q, actor, id, m.medicationId, "Wrong entry"),
  );
  const s = await loadState(db, id);
  assert.equal(s.meds[0].status, "active");
  assert.equal(s.plan.find((p) => p.id === automatic.id)!.status, "planned");
  assert.equal(s.plan.find((p) => p.id === edited.id)!.status, "cancelled");
  assert.equal(s.plan.find((p) => p.id === monitor.id)!.status, "cancelled");
});
test("medication corrections preserve local clock, selected day and milliseconds at midnight and date boundaries", () => {
  for (const [original, day] of [
    ["2026-10-11T22:30:00.123Z", "2026-10-12"],
    ["2026-10-11T22:30:00.123Z", "2026-10-13"],
    ["2026-12-31T22:30:00Z", "2027-01-02"],
    ["2024-02-28T23:30:00Z", "2024-03-01"],
    ["2026-10-11T09:30:00Z", "2026-10-11"],
  ]) {
    const moved = atClinicalDay(original, day);
    assert.equal(localDay(moved), day);
    assert.equal(
      new Date(moved).getUTCHours(),
      new Date(original).getUTCHours(),
    );
    assert.equal(
      new Date(moved).getUTCMinutes(),
      new Date(original).getUTCMinutes(),
    );
    assert.equal(
      new Date(moved).getUTCMilliseconds(),
      new Date(original).getUTCMilliseconds(),
    );
  }
  assert.equal(
    atClinicalDay("2026-10-11T22:30:00.123Z", "2026-10-12"),
    "2026-10-11T22:30:00.123Z",
  );
});
