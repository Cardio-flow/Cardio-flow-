import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { draftNote } from "../server/kernel/notes.js";
import {
  getVisitDraft,
  saveVisitDraft,
} from "../server/kernel/visit-drafts.js";
import { evidenceKey } from "../server/kernel/evidence.js";
import { removeContext } from "../server/kernel/context-management.js";
import { reconcileExistingPlans } from "../server/kernel/plan-bookings.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { reassess } from "../server/engine/engine.js";
import {
  preStartCheck,
  proposedMedicines,
} from "../server/engine/med-safety.js";
import { monitoringPreview } from "../server/engine/med-rules.js";
import { MEDICATION } from "../shared/catalog.js";
import { nowIso, today, uuid, type Actor } from "../server/kernel/base.js";
let db: DB,
  server: any,
  base: string,
  cookie: string,
  csrf: string,
  seq = 0;
const actor: Actor = {
  id: "integrity@example.test",
  name: "Synthetic clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const tx = <T>(fn: (q: any) => Promise<T>) => db.transaction(fn);
const patient = (conditions: string[] = []) =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic integrity ${++seq}`,
      mrn: `INT-${seq}`,
      sex: "Male",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions,
    }),
  );
const med = (id: string, code = "atorvastatin") =>
  tx((q) =>
    K.startMedication(q, actor, id, {
      code,
      doseValue: 40,
      frequency: "OD",
      route: "PO",
      indication: "lipids",
      effectiveAt: nowIso(),
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
const visit = (id: string) =>
  tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      reasons: ["Routine cardiology"],
      service: "Cardiology clinic",
    }),
  );
const ckAnswers = {
  redflags: ["none"],
  symptoms: "no",
  report: "checked",
  actions: ["stop", "cause", "rechallenge"],
  recheck: "14",
};
const request = async (path: string, body: any) => {
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

test("corrected evidence blocks stale CK confirmation, without stopping the statin", async () => {
  for (const correction of [{ value: 100 }, { referenceHigh: 3000 }]) {
    const id = await patient();
    await med(id);
    const r = await labs(id, [{ code: "ck", value: 2400, referenceHigh: 200 }]);
    const context = (await getWizard(db, id, "statin-ck-result")).context;
    await tx(async (q) => {
      await K.correctObservation(q, actor, id, r.ids[0], correction);
      await reassess(q, id, "sandbox");
    });
    const result = await request(
      `/patients/${id}/wizards/statin-ck-result/complete`,
      { answers: ckAnswers, evidenceKey: context.evidenceKey },
    );
    assert.equal(result.status, 409);
    assert.equal((await loadState(db, id)).meds[0].status, "active");
  }
});
test("alert linkage rejects foreign, wrong-pathway, missing and closed recommendations with clean errors", async () => {
  const id = await patient(),
    foreign = await patient();
  await med(id);
  await med(foreign);
  await labs(id, [
    { code: "ck", value: 2400, referenceHigh: 200 },
    { code: "haemoglobin", value: 10 },
  ]);
  await labs(foreign, [{ code: "ck", value: 2400, referenceHigh: 200 }]);
  const recs = (
    await db.query(
      `SELECT id,rule_id FROM cf.recommendation WHERE patient_id=$1 AND status='active'`,
      [id],
    )
  ).rows;
  const other = (
    await db.query(
      `SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='lab.statin-ck' AND status='active'`,
      [foreign],
    )
  ).rows[0].id;
  for (const [recommendationId, status] of [
    [other, 404],
    [recs.find((r: any) => r.rule_id === "lab.anaemia").id, 400],
    [uuid(), 404],
  ] as const) {
    const r = await request(
      `/patients/${id}/wizards/statin-ck-result/complete`,
      { answers: ckAnswers, recommendationId },
    );
    assert.equal(r.status, status, JSON.stringify(r.body));
  }
  const good = recs.find((r: any) => r.rule_id === "lab.statin-ck").id;
  assert.equal(
    (
      await request(`/patients/${id}/wizards/statin-ck-result/complete`, {
        answers: ckAnswers,
        recommendationId: good,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/patients/${id}/wizards/statin-ck-result/complete`, {
        answers: ckAnswers,
        recommendationId: good,
      })
    ).status,
    409,
  );
});
test("contradictory statin actions cannot be committed", async () => {
  const id = await patient();
  await med(id);
  await labs(id, [{ code: "ck", value: 2400, referenceHigh: 200 }]);
  const r = await request(`/patients/${id}/wizards/statin-ck-result/complete`, {
    answers: { ...ckAnswers, actions: ["continue", "hold", "stop"] },
  });
  assert.equal(r.status, 400);
  assert.equal((await loadState(db, id)).meds[0].status, "active");
});
test("prospective checks catch combination ingredients and duplicate statins", async () => {
  const id = await patient();
  await med(id, "amlodipine-valsartan");
  await med(id);
  const s = await loadState(db, id);
  for (const code of ["amlodipine", "rosuvastatin"])
    assert.ok(
      preStartCheck(s, code, MEDICATION[code]).some((h) => h.requiresReview),
    );
  const proposed = proposedMedicines(s, ["spironolactone", "eplerenone"]);
  for (const code of ["spironolactone", "eplerenone"])
    assert.ok(
      preStartCheck(proposed, code, MEDICATION[code]).some(
        (h) => /Two potassium-sparing/.test(h.title) || h.severity === "red",
      ),
    );
});
test("conflicting batch is blocked atomically and preview reports the same warnings", async () => {
  const id = await patient();
  await labs(id, [
    { code: "potassium", value: 4.2 },
    { code: "creatinine", value: 90 },
    { code: "sbp", value: 130 },
  ]);
  const codes = ["spironolactone", "eplerenone"];
  const preview = await request(`/patients/${id}/medication-check-batch`, {
    codes,
  });
  assert.equal(preview.status, 200);
  for (const code of codes)
    assert.ok(preview.body.hits[code].some((h: any) => h.severity === "red"));
  const r = await request(`/patients/${id}/medications/batch`, {
    items: codes.map((code) => ({
      code,
      doseValue: 25,
      frequency: "OD",
      route: "PO",
      indication: "htn",
    })),
  });
  assert.equal(r.status, 409);
  assert.equal((await loadState(db, id)).meds.length, 0);
});
test("visit draft persists edits, rejects lost-update overwrite and closes with visit", async () => {
  const id = await patient(),
    v = await visit(id);
  await labs(id, [{ code: "potassium", value: 4.2 }]);
  const n = await draftNote(db, id, v.id);
  const input = {
    version: 0,
    note: n.text + "\nMy clinical assessment",
    narrative: "Patient discussed",
    generatedNote: n.text,
    evidenceKey: n.evidenceKey,
  };
  await tx((q) => saveVisitDraft(q, actor, id, v.id, input));
  assert.equal((await getVisitDraft(db, id, v.id)).note, input.note);
  await assert.rejects(
    tx((q) => saveVisitDraft(q, actor, id, v.id, input)),
    /another window/,
  );
  await labs(id, [{ code: "potassium", value: 6.8 }]);
  const newer = await draftNote(db, id, v.id);
  assert.notEqual(newer.evidenceKey, n.evidenceKey);
  assert.match(newer.text, /K 6.8/);
  const stale = await request(`/patients/${id}/visits/${v.id}/close`, {
    note: input.note,
    evidenceKey: n.evidenceKey,
  });
  assert.equal(stale.status, 409);
  const close = await request(`/patients/${id}/visits/${v.id}/close`, {
    note: newer.text,
    evidenceKey: newer.evidenceKey,
    draftVersion: 1,
  });
  assert.equal(close.status, 200);
  assert.equal(
    (
      await db.query(
        `SELECT status FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2`,
        [id, `visit:${v.id}`],
      )
    ).rows[0].status,
    "completed",
  );
});
test("generic clinic visit leaves specialist review open but completes a general follow-up", async () => {
  const id = await patient();
  const plans = await tx(async (q) => {
    const specialist = await K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "RDN specialist recovery review",
      dueDate: today(),
      completesOn: { type: "visit" },
    });
    const general = await K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "Clinic review",
      dueDate: today(),
      completesOn: { type: "visit" },
    });
    return { specialist, general };
  });
  await visit(id);
  const s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.id === plans.specialist.id)!.status,
    "planned",
  );
  assert.equal(
    s.plan.find((p) => p.id === plans.general.id)!.status,
    "completed",
  );
});
test("equivalent same-date imaging reuses a booking and retains indications and decisions", async () => {
  const id = await patient();
  const refs = [uuid(), uuid()];
  await tx(async (q) => {
    for (const ref of refs)
      await q.query(
        `INSERT INTO cf.decision(id,patient_id,wizard,outcome,decided_by) VALUES($1,$2,'after-laao','acted',$3)`,
        [ref, id, actor.id],
      );
    const input = {
      category: "investigation" as const,
      dueDate: today(),
      completesOn: {
        type: "study",
        kind: "laa_imaging",
        purpose: "LAA closure surveillance",
      },
    };
    const a = await K.addPlanAction(q, actor, id, {
      ...input,
      title: "LAA surveillance TEE / CT",
      decisionId: refs[0],
    });
    const b = await K.addPlanAction(q, actor, id, {
      ...input,
      title: "Repeat TEE / CT after thrombus",
      decisionId: refs[1],
    });
    assert.equal(a.id, b.id);
  });
  const s = await loadState(db, id);
  assert.equal(s.plan.length, 1);
  assert.equal(s.plan[0].indications.length, 2);
  assert.deepEqual(new Set(s.plan[0].decision_refs), new Set(refs));
});
test("separate final K/Cr writes from one collection complete paired check; unrelated samples do not", async () => {
  const id = await patient();
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Renal function and potassium check",
      dueDate: today(),
      completesOn: { type: "lab", codes: ["potassium", "creatinine"] },
    }),
  );
  const at = nowIso();
  await labs(id, [{ code: "potassium", value: 4.2 }], { effectiveAt: at });
  assert.equal((await loadState(db, id)).plan[0].status, "planned");
  await labs(id, [{ code: "creatinine", value: 90 }], {
    effectiveAt: new Date(Date.parse(at) - 1000).toISOString(),
  });
  assert.equal((await loadState(db, id)).plan[0].status, "planned");
  await labs(id, [{ code: "creatinine", value: 91 }], { effectiveAt: at });
  const p = (await loadState(db, id)).plan[0];
  assert.equal(p.status, "completed");
  assert.equal(p.completion_refs.length, 2);
});
test("preliminary or withdrawn collection components never close a paired check", async () => {
  const id = await patient();
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Renal check",
      dueDate: today(),
      completesOn: { type: "lab", codes: ["potassium", "creatinine"] },
    }),
  );
  const at = nowIso();
  await labs(id, [{ code: "potassium", value: 4.2 }], {
    effectiveAt: at,
    status: "preliminary",
  });
  await labs(id, [{ code: "creatinine", value: 90 }], { effectiveAt: at });
  assert.equal((await loadState(db, id)).plan[0].status, "planned");
  const k = await labs(id, [{ code: "potassium", value: 4.3 }], {
    effectiveAt: at,
  });
  assert.equal((await loadState(db, id)).plan[0].status, "completed");
  await tx((q) =>
    K.correctObservation(q, actor, id, k.ids[0], { enteredInError: true }),
  );
  assert.equal((await loadState(db, id)).plan[0].status, "planned");
});
test("monitoring checkpoint dates can be set manually without changing default policy", async () => {
  const id = await patient(["hfref"]);
  await labs(id, [
    { code: "potassium", value: 4.2 },
    { code: "creatinine", value: 90 },
    { code: "sbp", value: 130 },
  ]);
  const s = await loadState(db, id),
    preview = monitoringPreview(s, "spironolactone"),
    manual = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  assert.ok(preview.length > 1);
  const r = await request(`/patients/${id}/medications`, {
    code: "spironolactone",
    doseValue: 25,
    frequency: "OD",
    route: "PO",
    indication: "htn",
    bookSchedule: true,
    monitoringDates: { [preview[0].key]: manual },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok((await loadState(db, id)).plan.some((p) => p.due_date === manual));
});
test("legacy erroneous specialist completion reopens with an audit trail", async () => {
  const id = await patient(),
    v = await visit(id);
  const p = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "RDN specialist recovery review",
      dueDate: today(),
      completesOn: { type: "visit" },
    }),
  );
  await db.query(
    `UPDATE cf.plan_action SET status='completed',completed_at=now(),completed_by_ref=$2 WHERE id=$1`,
    [p.id, v.id],
  );
  await tx((q) => reconcileExistingPlans(q, actor));
  assert.equal((await loadState(db, id)).plan[0].status, "planned");
  assert.equal(
    (
      await db.query(
        `SELECT count(*) n FROM cf.audit WHERE entity_id=$1 AND action='specialist-review-required'`,
        [p.id],
      )
    ).rows[0].n,
    1,
  );
});

test("removing one source encounter retains a shared booking for the other", async () => {
  const id = await patient(),
    first = await visit(id);
  await tx((q) =>
    K.closeVisit(q, actor, id, first.id, { note: "Synthetic visit complete" }),
  );
  const second = await visit(id);
  const input = {
    category: "investigation" as const,
    dueDate: today(),
    completesOn: { type: "study", kind: "ecg" },
  };
  const p = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      ...input,
      title: "Rhythm ECG",
      contextId: first.id,
    }),
  );
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      ...input,
      title: "QTc ECG",
      contextId: second.id,
    }),
  );
  const version = (
    await db.query(`SELECT version FROM cf.care_context WHERE id=$1`, [
      first.id,
    ])
  ).rows[0].version;
  await tx((q) =>
    removeContext(q, actor, id, first.id, {
      version,
      reason: "Synthetic erroneous encounter",
    }),
  );
  const remaining = (await loadState(db, id)).plan.find((x) => x.id === p.id)!;
  assert.equal(remaining.status, "planned");
  assert.equal(remaining.source_context_id, second.id);
  assert.ok(remaining.context_refs.includes(first.id));
});
test("legacy duplicate imaging reconciles into one audited booking", async () => {
  const id = await patient();
  const input = { category: "investigation" as const, dueDate: today() };
  const a = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      ...input,
      title: "Surveillance TEE",
      completesOn: {
        type: "study",
        kind: "laa_imaging",
        purpose: "surveillance",
      },
    }),
  );
  const b = await tx((q) =>
    K.addPlanAction(q, actor, id, {
      ...input,
      title: "Thrombus repeat TEE",
      completesOn: { type: "study", kind: "laa_imaging", purpose: "other" },
    }),
  );
  await db.query(
    `UPDATE cf.plan_action SET completes_on=(SELECT completes_on FROM cf.plan_action WHERE id=$2) WHERE id=$1`,
    [b.id, a.id],
  );
  await tx((q) => reconcileExistingPlans(q, actor));
  let s = await loadState(db, id);
  assert.equal(s.plan.filter((p) => p.status === "planned").length, 1);
  assert.equal(s.plan.find((p) => p.id === a.id)!.indications.length, 2);
  assert.equal(s.plan.find((p) => p.id === b.id)!.status, "cancelled");
  await tx((q) => reconcileExistingPlans(q, actor));
  s = await loadState(db, id);
  assert.equal(s.plan.filter((p) => p.status === "planned").length, 1);
});

test("changing the preferred verified result invalidates an open decision", async () => {
  const id = await patient();
  await med(id);
  const previous = await labs(
    id,
    [{ code: "ck", value: 100, referenceHigh: 200 }],
    { effectiveAt: new Date(Date.now() - 86400000).toISOString() },
  );
  await labs(id, [{ code: "ck", value: 2400, referenceHigh: 200 }]);
  const old = (await getWizard(db, id, "statin-ck-result")).context;
  await tx(async (q) => {
    await K.preferValue(
      q,
      actor,
      id,
      "ck",
      previous.ids[0],
      "Verified preferred report",
    );
    await reassess(q, id, "sandbox");
  });
  assert.equal(
    (await loadState(db, id)).resolved("ck").current!.value_num,
    100,
  );
  const r = await request(`/patients/${id}/wizards/statin-ck-result/complete`, {
    answers: ckAnswers,
    evidenceKey: old.evidenceKey,
  });
  assert.equal(r.status, 409);
  assert.equal((await loadState(db, id)).meds[0].status, "active");
});
