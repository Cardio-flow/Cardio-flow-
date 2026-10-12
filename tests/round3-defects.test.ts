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
  id: "r3@example.test",
  name: "Synthetic R3 clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const tx = <T>(f: (q: any) => Promise<T>) => db.transaction(f);
const patient = () =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic R3 fix ${++seq}`,
      mrn: `R3FIX-${seq}`,
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
test("held medicine restarts use current safety checks without duplicating themselves", async () => {
  const id = await patient();
  await labs(id, [
    { code: "potassium", value: 4.2 },
    { code: "creatinine", value: 90 },
    { code: "sbp", value: 120 },
  ]);
  const m = await med(id);
  await event(id, m.medicationId, "hold");
  assert.equal(
    preStartCheck(
      await loadState(db, id),
      "eplerenone",
      MEDICATION.eplerenone,
    ).some((h) => h.requiresReview),
    false,
  );
  await event(id, m.medicationId, "restart");
  await event(id, m.medicationId, "hold");
  await labs(id, [{ code: "potassium", value: 6.8 }]);
  const rejected = await post(
    `/patients/${id}/medications/${m.medicationId}/events`,
    { kind: "restart" },
  );
  assert.equal(rejected.status, 409, JSON.stringify(rejected));
  assert.equal((await loadState(db, id)).meds[0].status, "held");
  const accepted = await post(
    `/patients/${id}/medications/${m.medicationId}/events`,
    {
      kind: "restart",
      override: "Synthetic specialist reviewed current warning",
    },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  const s = await loadState(db, id);
  assert.equal(s.meds[0].status, "active");
  assert.match(s.meds[0].events.at(-1)!.reason, /warnings reviewed/);
});
test("restart does not permit two statins without acknowledged reconciliation", async () => {
  const id = await patient();
  const old = await med(id, "atorvastatin");
  await event(id, old.medicationId, "stop");
  await med(id, "rosuvastatin");
  await assert.rejects(
    event(id, old.medicationId, "restart"),
    /duplicate treatment/i,
  );
  assert.equal(
    (await loadState(db, id)).meds.filter((m) => m.status === "active").length,
    1,
  );
});
test("increase and resumption cannot bypass current contraindications; a hold remains available", async () => {
  const id = await patient();
  const m = await med(id);
  await labs(id, [{ code: "potassium", value: 6.8 }]);
  await assert.rejects(
    event(id, m.medicationId, "increase", { doseValue: 50 }),
    /warning/,
  );
  await event(id, m.medicationId, "not_taking", {
    reason: "Synthetic ran out",
  });
  await assert.rejects(event(id, m.medicationId, "resume"), /warning/);
  await event(id, m.medicationId, "hold");
  await event(id, m.medicationId, "continue", { frequency: "OD" });
  await assert.rejects(
    event(id, m.medicationId, "decrease", { doseValue: 12.5 }),
    /restarting/,
  );
  assert.equal((await loadState(db, id)).meds[0].status, "held");
});
test("backdated stop and dose change are refused atomically and do not cancel a review", async () => {
  const id = await patient();
  const m = await med(id, "atorvastatin");
  const plan = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "Synthetic titration review",
      dueDate: today(),
      completesOn: { type: "visit" },
      medicationId: m.medicationId,
    }),
  );
  for (const body of [{ kind: "stop" }, { kind: "increase", doseValue: 80 }]) {
    const r = await post(
      `/patients/${id}/medications/${m.medicationId}/events`,
      { ...body, effectiveAt: at(-3) },
    );
    assert.equal(r.status, 400, JSON.stringify(r));
  }
  let s = await loadState(db, id);
  assert.equal(s.meds[0].status, "active");
  assert.equal(s.meds[0].doseValue, 25);
  assert.equal(s.meds[0].events.length, 1);
  assert.equal(s.plan.find((p) => p.id === plan.id)!.status, "planned");
  await event(id, m.medicationId, "stop", { effectiveAt: at(-1) });
  s = await loadState(db, id);
  assert.equal(s.meds[0].status, "stopped");
  assert.equal(s.plan.find((p) => p.id === plan.id)!.status, "cancelled");
  const r = await post(`/patients/${id}/medications`, {
    code: "atorvastatin",
    doseValue: 40,
    frequency: "OD",
    route: "PO",
    indication: "lipids",
    effectiveAt: at(-3),
  });
  assert.equal(r.status, 400);
});
test("stale or omitted draft versions cannot close a visit, while reviewed newer text can", async () => {
  const id = await patient();
  const v = await tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      reasons: ["Routine cardiology"],
      service: "Clinic",
    }),
  );
  const n = await draftNote(db, id, v.id);
  const body = {
    narrative: "",
    generatedNote: n.text,
    evidenceKey: n.evidenceKey,
  };
  await tx((q) =>
    saveVisitDraft(q, actor, id, v.id, {
      ...body,
      version: 0,
      note: "Synthetic A",
    }),
  );
  await tx((q) =>
    saveVisitDraft(q, actor, id, v.id, {
      ...body,
      version: 1,
      note: "Synthetic newer B",
    }),
  );
  for (const draftVersion of [1, undefined]) {
    const r = await post(`/patients/${id}/visits/${v.id}/close`, {
      note: "Synthetic A",
      evidenceKey: n.evidenceKey,
      ...(draftVersion === undefined ? {} : { draftVersion }),
    });
    assert.equal(r.status, 409);
  }
  assert.equal(
    (await loadState(db, id)).contexts.find((c) => c.id === v.id)!.status,
    "open",
  );
  assert.equal((await getVisitDraft(db, id, v.id)).note, "Synthetic newer B");
  const good = await post(`/patients/${id}/visits/${v.id}/close`, {
    note: "Synthetic newer B",
    draftVersion: 2,
    evidenceKey: n.evidenceKey,
  });
  assert.equal(good.status, 200, JSON.stringify(good));
  assert.equal(
    (await loadState(db, id)).contexts.find((c) => c.id === v.id)!.summary.note,
    "Synthetic newer B",
  );
});
test("active warning facts refresh after a hold without duplicating that warning", async () => {
  const id = await patient();
  const m = await med(id);
  await labs(id, [
    { code: "potassium", value: 6.8 },
    { code: "creatinine", value: 90 },
  ]);
  const before = (
    await db.query(
      `SELECT * FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`,
      [id],
    )
  ).rows[0];
  assert.match(before.detail, /on eplerenone/);
  await event(id, m.medicationId, "hold");
  const after = (
    await db.query(
      `SELECT * FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`,
      [id],
    )
  ).rows;
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before.id);
  assert.match(after[0].detail, /no RAAS/);
  assert.equal(
    after[0].facts.some((f: any) => f.label === "Therapy"),
    false,
  );
});
test("a potassium decision stays quiet after its own hold, but a later restart requires fresh review", async () => {
  const id = await patient();
  const m = await med(id);
  await labs(id, [
    { code: "potassium", value: 6.8 },
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
      answers: {
        result: "confirmed",
        ecg: "none",
        contributors: ["mra"],
        actions: ["hold-mra", "urgent"],
        recheck: "0",
        review: "none",
      },
      recommendationId: rec.id,
      evidenceKey: w.context.evidenceKey,
    }),
  );
  await tx((q) => reassess(q, id, "sandbox"));
  assert.equal(
    (
      await db.query(
        `SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`,
        [id],
      )
    ).rows.length,
    0,
  );
  await event(id, m.medicationId, "restart", {
    override: "Synthetic specialist reviewed warning",
  });
  const active = (
    await db.query(
      `SELECT id,detail FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`,
      [id],
    )
  ).rows;
  assert.equal(active.length, 1);
  assert.notEqual(active[0].id, rec.id);
  assert.match(active[0].detail, /on eplerenone/);
});
test("explicit existing draw joins split lab entry while new draws remain separate", async () => {
  const id = await patient();
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Synthetic paired renal check",
      dueDate: today(),
      completesOn: { type: "lab", codes: ["potassium", "creatinine"] },
    }),
  );
  const k = await labs(id, [{ code: "potassium", value: 4.2 }]);
  await labs(id, [{ code: "creatinine", value: 90 }], {
    collectionRef: k.ids[0],
  });
  const s = await loadState(db, id);
  assert.equal(s.plan[0].status, "completed");
  assert.equal(s.plan[0].progress, "performed");
  assert.equal(new Set(s.observations.map((o) => o.effective_at)).size, 1);
  const other = await patient();
  await tx((q) =>
    K.addPlanAction(q, actor, other, {
      category: "monitoring",
      title: "Synthetic paired renal check",
      dueDate: today(),
      completesOn: { type: "lab", codes: ["potassium", "creatinine"] },
    }),
  );
  await labs(other, [{ code: "potassium", value: 4.2 }], {
    effectiveAt: at(-1),
  });
  await labs(other, [{ code: "creatinine", value: 90 }]);
  assert.equal((await loadState(db, other)).plan[0].status, "planned");
});
test("draw continuation rejects foreign, withdrawn, duplicate and wrong-context evidence", async () => {
  const id = await patient(),
    other = await patient();
  const k = await labs(id, [{ code: "potassium", value: 4.2 }]);
  await assert.rejects(
    labs(other, [{ code: "creatinine", value: 90 }], {
      collectionRef: k.ids[0],
    }),
    /no longer available/,
  );
  await assert.rejects(
    labs(id, [{ code: "potassium", value: 4.3 }], { collectionRef: k.ids[0] }),
    /already has/,
  );
  const v = await tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      service: "Clinic",
      reasons: ["Routine cardiology"],
    }),
  );
  await assert.rejects(
    labs(id, [{ code: "creatinine", value: 90 }], {
      collectionRef: k.ids[0],
      contextId: v.id,
    }),
    /no longer available/,
  );
  await tx((q) =>
    K.correctObservation(q, actor, id, k.ids[0], { enteredInError: true }),
  );
  await assert.rejects(
    labs(id, [{ code: "creatinine", value: 90 }], { collectionRef: k.ids[0] }),
    /no longer available/,
  );
});
test("discharge draft restores all fields, rejects stale finalization and completes with discharge", async () => {
  const id = await patient();
  const a = await tx((q) =>
    K.startAdmission(q, actor, id, {
      startedAt: at(-1),
      location: "CCU",
      reasons: ["Heart failure"],
    }),
  );
  const body = {
    outcome: "alive",
    status: "Euvolaemic",
    destination: "Home",
    events: ["None"],
    cause: "",
    weight: "70",
    reuseClinicFollowUp: true,
    handover: "Synthetic handover",
    picked: { "renal-k": today() },
  };
  let r = await post(`/patients/${id}/admissions/${a.id}/draft`, {
    ...body,
    version: 0,
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  const saved = await getDischargeDraft(db, id, a.id);
  assert.deepEqual(saved, { ...body, version: 1 });
  r = await post(`/patients/${id}/admissions/${a.id}/draft`, {
    ...body,
    handover: "Synthetic newer handover",
    version: 1,
  });
  assert.equal(r.status, 200);
  await assert.rejects(
    tx((q) => saveDischargeDraft(q, actor, id, a.id, { ...body, version: 1 })),
    /another window/,
  );
  const discharge = {
    endedAt: nowIso(),
    status: "Euvolaemic",
    destination: "Home",
    handover: "Synthetic newer handover",
    plan: [],
  };
  for (const draftVersion of [1, undefined]) {
    const r = await post(`/patients/${id}/admissions/${a.id}/discharge`, {
      ...discharge,
      ...(draftVersion === undefined ? {} : { draftVersion }),
    });
    assert.equal(r.status, 409);
  }
  assert.equal((await loadState(db, id)).contexts[0].status, "open");
  r = await post(`/patients/${id}/admissions/${a.id}/discharge`, {
    ...discharge,
    draftVersion: 2,
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(
    (await loadState(db, id)).contexts[0].summary.handover,
    discharge.handover,
  );
  assert.equal(
    (
      await db.query(
        `SELECT status FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2`,
        [id, `discharge:${a.id}`],
      )
    ).rows[0].status,
    "completed",
  );
  await assert.rejects(getDischargeDraft(db, id, a.id), /already closed/);
});
test("generated notes retain the year of historical labs", async () => {
  const id = await patient();
  await labs(id, [{ code: "potassium", value: 4.2 }], {
    effectiveAt: "2024-10-12T09:00:00Z",
  });
  const v = await tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      service: "Clinic",
      reasons: ["Routine cardiology"],
    }),
  );
  assert.match(
    (await draftNote(db, id, v.id)).text,
    /Latest results: K 4.2 \(12 Oct 2024\)/,
  );
});
test("same-title plans retain conflicting criteria or medicine dependencies separately", async () => {
  const id = await patient();
  for (const codes of [["potassium"], ["creatinine"]])
    await tx((q) =>
      K.addPlanAction(q, actor, id, {
        category: "monitoring",
        title: "Synthetic blood check",
        dueDate: today(),
        completesOn: { type: "lab", codes },
      }),
    );
  let s = await loadState(db, id);
  assert.equal(s.plan.length, 2);
  const m1 = await med(id, "atorvastatin"),
    m2 = await med(id, "rosuvastatin");
  for (const m of [m1, m2])
    await tx((q) =>
      K.addPlanAction(q, actor, id, {
        category: "follow_up",
        title: "Synthetic medicine review",
        dueDate: today(),
        completesOn: { type: "visit" },
        medicationId: m.medicationId,
      }),
    );
  await event(id, m1.medicationId, "stop");
  s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.medication_id === m2.medicationId)!.status,
    "planned",
  );
  assert.equal(
    s.plan.find((p) => p.medication_id === m1.medicationId)!.status,
    "cancelled",
  );
});
test("equivalent lab criteria and ECG bookings still reuse and retain all indications", async () => {
  const id = await patient();
  const input = {
    category: "monitoring",
    title: "Synthetic renal check",
    dueDate: today(),
  };
  const a = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      ...input,
      completesOn: { type: "lab", codes: ["potassium", "creatinine"] },
    }),
  );
  const b = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      ...input,
      completesOn: { codes: ["creatinine", "potassium"], type: "lab" },
    }),
  );
  assert.equal(a.id, b.id);
  for (const title of ["Synthetic rhythm ECG", "Synthetic QTc ECG"])
    await tx((q) =>
      K.addPlanAction(q, actor, id, {
        category: "investigation",
        title,
        dueDate: today(),
        completesOn: { type: "study", kind: "ecg" },
      }),
    );
  const s = await loadState(db, id);
  const ecgs = s.plan.filter((p) => p.completes_on.type === "study");
  assert.equal(ecgs.length, 1);
  assert.equal(ecgs[0].indications.length, 2);
});
