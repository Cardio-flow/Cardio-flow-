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
  id: "r4@example.test",
  name: "Synthetic R4 clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const tx = <T>(f: (q: any) => Promise<T>) => db.transaction(f);
const patient = () =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic R4 fix ${++seq}`,
      mrn: `R4FIX-${seq}`,
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
test("frequency increases use the same current safety gate; reductions remain available", async () => {
  const id = await patient(),
    m = await med(id);
  await labs(id, [{ code: "potassium", value: 6.8 }]);
  const blocked = await post(
    `/patients/${id}/medications/${m.medicationId}/events`,
    { kind: "continue", frequency: "BID" },
  );
  assert.equal(blocked.status, 409, JSON.stringify(blocked));
  assert.equal((await loadState(db, id)).meds[0].frequency, "OD");
  await event(id, m.medicationId, "continue", {
    frequency: "BID",
    override: "Synthetic specialist reviewed potassium",
  });
  await event(id, m.medicationId, "continue", { frequency: "OD" });
  await assert.rejects(
    event(id, m.medicationId, "continue", { frequency: "PRN" }),
    /cannot be compared/,
  );
  await event(id, m.medicationId, "continue", {
    frequency: "PRN",
    override: "Synthetic regimen reviewed",
  });
  assert.match(
    (await loadState(db, id)).meds[0].events.at(-1)!.reason,
    /Regimen reviewed/,
  );
});
test("continue, increase, hold and restart inherit the latest prescribed frequency", async () => {
  const id = await patient(),
    m = await med(id, "furosemide");
  await event(id, m.medicationId, "continue", { frequency: "BID" });
  for (const [kind, extra] of [
    ["continue", {}],
    ["increase", { doseValue: 40 }],
    ["hold", {}],
    ["restart", {}],
  ] as const) {
    await event(id, m.medicationId, kind, extra);
    const current = (await loadState(db, id)).meds[0];
    assert.equal(current.frequency, "BID", kind);
    assert.equal(current.events.at(-1)!.frequency, "BID", kind);
  }
  assert.equal((await loadState(db, id)).meds[0].doseValue, 40);
});
test("undoing a potassium pathway hold opens a fresh review without duplicating urgent plans", async () => {
  const id = await patient(),
    m = await med(id);
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
  const count = (await loadState(db, id)).plan.length;
  assert.equal(
    (
      await db.query(
        `SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`,
        [id],
      )
    ).rows.length,
    0,
  );
  await tx(async (q) => {
    await undoLastMedicationChange(q, actor, id, m.medicationId, "Wrong entry");
    await reassess(q, id, "sandbox");
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
  assert.equal((await loadState(db, id)).plan.length, count);
});
test("derived eGFR fulfills a same-draw task with parent references and withdrawal reopens it", async () => {
  const id = await patient();
  const p = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Synthetic eGFR review",
      dueDate: today(),
      completesOn: { type: "lab", codes: ["potassium", "egfr"] },
    }),
  );
  const k = await labs(id, [{ code: "potassium", value: 4.2 }]);
  const cr = await labs(id, [{ code: "creatinine", value: 90 }], {
    collectionRef: k.ids[0],
  });
  let s = await loadState(db, id),
    plan = s.plan.find((x) => x.id === p.id)!;
  assert.equal(plan.status, "completed");
  const egfr = s.observations.find((o) => o.code === "egfr")!;
  assert.equal(Math.round(egfr.value_num!), 81);
  assert.ok(plan.completion_refs.includes(egfr.id));
  assert.ok(plan.completion_refs.includes(cr.ids[0]));
  assert.ok(plan.completion_refs.includes(k.ids[0]));
  await tx((q) =>
    K.correctObservation(q, actor, id, cr.ids[0], { enteredInError: true }),
  );
  s = await loadState(db, id);
  assert.equal(s.plan.find((x) => x.id === p.id)!.status, "planned");
});
test("derived results from separate blood draws cannot close a paired task", async () => {
  const id = await patient();
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Synthetic paired eGFR",
      dueDate: today(),
      completesOn: { type: "lab", codes: ["potassium", "egfr"] },
    }),
  );
  await labs(id, [{ code: "potassium", value: 4.2 }]);
  await labs(id, [{ code: "creatinine", value: 90 }]);
  assert.equal((await loadState(db, id)).plan[0].status, "planned");
});
test("large generated baseline saves with a concise edited note and finalizes", async () => {
  const id = await patient();
  const v = await tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      service: "Clinic",
      reasons: ["Routine cardiology"],
    }),
  );
  for (let i = 0; i < 60; i++)
    await tx((q) =>
      K.addPlanAction(q, actor, id, {
        category: "follow_up",
        title: `Synthetic comprehensive follow-up ${i} ${"clinical record review ".repeat(5)}`,
        dueDate: today(),
        contextId: v.id,
      }),
    );
  const n = await draftNote(db, id, v.id);
  assert.ok(n.text.length > 8000, n.text.length.toString());
  const note = "Synthetic concise clinical note reviewed by clinician.";
  const saved = await post(`/patients/${id}/contexts/${v.id}/draft`, {
    version: 0,
    note,
    narrative: "",
    generatedNote: n.text,
    evidenceKey: n.evidenceKey,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved));
  const finish = await post(`/patients/${id}/visits/${v.id}/close`, {
    note,
    evidenceKey: n.evidenceKey,
    draftVersion: 1,
  });
  assert.equal(finish.status, 200, JSON.stringify(finish));
  assert.equal((await loadState(db, id)).contexts[0].summary.note, note);
});
test("discharge refuses a changed potassium result and retains the open admission and draft", async () => {
  const id = await patient();
  const a = await tx((q) =>
    K.startAdmission(q, actor, id, {
      startedAt: at(-1),
      location: "CCU",
      reasons: ["Heart failure"],
    }),
  );
  await labs(id, [{ code: "potassium", value: 4.2 }]);
  const key = evidenceKey(await loadState(db, id));
  await tx((q) =>
    saveDischargeDraft(q, actor, id, a.id, {
      version: 0,
      evidenceKey: key,
      handover: "Synthetic handover",
    }),
  );
  await labs(id, [{ code: "potassium", value: 6.8 }]);
  const body = {
    endedAt: nowIso(),
    status: "Euvolaemic",
    plan: [],
    draftVersion: 1,
  };
  for (const expected of [key, undefined]) {
    const r = await post(`/patients/${id}/admissions/${a.id}/discharge`, {
      ...body,
      ...(expected ? { evidenceKey: expected } : {}),
    });
    assert.equal(r.status, 409, JSON.stringify(r));
  }
  assert.equal((await loadState(db, id)).contexts[0].status, "open");
  assert.equal(
    (await getDischargeDraft(db, id, a.id)).handover,
    "Synthetic handover",
  );
  const fresh = evidenceKey(await loadState(db, id));
  const reviewed = await post(`/patients/${id}/admissions/${a.id}/discharge`, {
    ...body,
    evidenceKey: fresh,
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed));
});
test("discharge detects separately cancelled follow-up booking before closing", async () => {
  const id = await patient(),
    a = await tx((q) =>
      K.startAdmission(q, actor, id, {
        startedAt: at(-1),
        location: "Ward",
        reasons: ["Heart failure"],
      }),
    );
  const p = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "HF clinic review",
      dueDate: today(),
      completesOn: { type: "visit" },
    }),
  );
  const key = evidenceKey(await loadState(db, id));
  await db.query(
    `UPDATE cf.plan_action SET status='cancelled',version=version+1 WHERE id=$1`,
    [p.id],
  );
  const r = await post(`/patients/${id}/admissions/${a.id}/discharge`, {
    endedAt: nowIso(),
    status: "Euvolaemic",
    plan: [],
    evidenceKey: key,
  });
  assert.equal(r.status, 409);
  assert.equal((await loadState(db, id)).contexts[0].status, "open");
  assert.equal((await loadState(db, id)).plan[0].status, "cancelled");
});
test("unconfirmed admission and assessment drafts restore without creating clinical facts", async () => {
  const id = await patient();
  await tx((q) =>
    entryDraft(q, actor, id, "admission-entry", {
      version: 0,
      answers: {
        narrative: "Synthetic pending history",
        reasons: ["Acute decompensated HF"],
      },
    }),
  );
  assert.equal(
    (await entryDraft(db, actor, id, "admission-entry")).answers!.narrative,
    "Synthetic pending history",
  );
  assert.equal((await loadState(db, id)).contexts.length, 0);
  assert.equal(
    (
      await entryDraft(
        db,
        { ...actor, id: "another@example.test" },
        id,
        "admission-entry",
      )
    ).version,
    0,
  );
  await assert.rejects(
    tx((q) =>
      entryDraft(q, actor, id, "admission-entry", { version: 0, answers: {} }),
    ),
    /another window/,
  );
  const a = await tx((q) =>
    K.startAdmission(q, actor, id, {
      startedAt: nowIso(),
      location: "Ward",
      reasons: ["Heart failure"],
    }),
  );
  assert.equal((await entryDraft(db, actor, id, "admission-entry")).version, 0);
  const v = await tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      service: "Clinic",
      reasons: ["Routine cardiology"],
    }),
  );
  await tx((q) =>
    entryDraft(q, actor, id, `assessment:${v.id}`, {
      version: 0,
      answers: { vit: { sbp: "148", dbp: "88" }, hfa: {}, nyha: "", cong: "" },
    }),
  );
  assert.equal(
    (await entryDraft(db, actor, id, `assessment:${v.id}`)).answers!.vit.sbp,
    "148",
  );
  assert.equal((await loadState(db, id)).observations.length, 0);
});
test("undo stop reopens only its automatic cancellations and preserves later clinician changes", async () => {
  const id = await patient(),
    m = await med(id, "atorvastatin");
  const p = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "Synthetic titration",
      dueDate: today(),
      medicationId: m.medicationId,
    }),
  );
  const edited = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "Synthetic later cancellation",
      dueDate: today(),
      medicationId: m.medicationId,
    }),
  );
  const monitor = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Synthetic monitoring",
      dueDate: today(),
      medicationId: m.medicationId,
    }),
  );
  await event(id, m.medicationId, "stop");
  await db.query(
    `UPDATE cf.plan_action SET status='cancelled',outcome='Atorvastatin stopped',version=version+1 WHERE id = ANY($1::uuid[])`,
    [[edited.id, monitor.id]],
  );
  await tx((q) =>
    undoLastMedicationChange(q, actor, id, m.medicationId, "Wrong entry"),
  );
  const s = await loadState(db, id);
  assert.equal(s.plan.find((x) => x.id === p.id)!.status, "planned");
  assert.equal(s.plan.find((x) => x.id === edited.id)!.status, "cancelled");
  assert.equal(s.plan.find((x) => x.id === monitor.id)!.status, "cancelled");
});
