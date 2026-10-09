import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { draftNote } from "../server/kernel/notes.js";
import { summary, journey } from "../server/kernel/views.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard } from "../server/engine/wizard.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
let db: DB;
const actor: Actor = {
  id: "flow@example.test",
  name: "Dr Flow",
  role: "clinician",
  siteId: SITE_ID,
};
const answers = {
  result: "confirmed",
  symptoms: ["none"],
  ecg: "none",
  contributors: ["mra"],
  actions: ["reduce-mra"],
  mraDose: 12.5,
  recheck: "7",
  review: "clinic-7",
};
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
for (const kind of ["admission", "clinic_visit"] as const) {
  test(`${kind}: pathway decision, dose change, dated tasks, journey, and note stay connected`, async () => {
    const pid = await db.transaction((q) =>
      K.createPatient(q, actor, {
        name: "Synthetic pathway flow",
        mrn: `FLOW-${kind}`,
        sex: "Male",
        birthDate: "1960-01-01",
        conditions: ["hfref"],
      }),
    );
    const ctx =
      kind === "admission"
        ? await db.transaction((q) =>
            K.startAdmission(q, actor, pid, {
              startedAt: nowIso(),
              location: "CCU",
              reasons: ["Acute decompensated HF"],
            }),
          )
        : await db.transaction((q) =>
            K.startVisit(q, actor, pid, {
              startedAt: nowIso(),
              reasons: ["Heart failure"],
              service: "HF clinic",
            }),
          );
    const med = await db.transaction((q) =>
      K.startMedication(q, actor, pid, {
        code: "spironolactone",
        doseValue: 25,
        frequency: "OD",
        route: "PO",
        indication: "hf",
        effectiveAt: nowIso(),
        contextId: ctx.id,
      }),
    );
    await db.transaction(async (q) => {
      await K.recordObservations(q, actor, pid, {
        effectiveAt: nowIso(),
        contextId: ctx.id,
        items: [{ code: "potassium", value: 5.8 }],
      });
      await reassess(q, pid, "production");
    });
    const rec = (await summary(db, pid)).attention.find(
      (a: any) => a.action?.wizard === "hyperkalaemia",
    );
    assert.ok(rec);
    const result = await db.transaction(async (q) => {
      const r = await completeWizard(q, actor, pid, "hyperkalaemia", {
        answers,
        contextId: ctx.id,
        recommendationId: rec.id,
        dueDates: { "Renal function and potassium check": today() },
      });
      await reassess(q, pid, "production", r.changed);
      return r;
    });
    const decision = (
      await db.query("SELECT * FROM cf.decision WHERE id=$1", [
        result.decisionId,
      ])
    ).rows[0];
    assert.equal(decision.context_id, ctx.id);
    assert.equal(decision.recommendation_id, rec.id);
    assert.equal(
      (
        await db.query("SELECT status FROM cf.recommendation WHERE id=$1", [
          rec.id,
        ])
      ).rows[0].status,
      "decided",
    );
    const s = await loadState(db, pid);
    const changed = s.meds.find((m) => m.id === med.medicationId)!;
    assert.equal(changed.doseValue, 12.5);
    const event = changed.events.find(
      (e) => e.decision_id === result.decisionId,
    )!;
    assert.ok(event);
    assert.equal(
      (
        await db.query(
          "SELECT context_id FROM cf.medication_event WHERE id=$1",
          [event.id],
        )
      ).rows[0].context_id,
      ctx.id,
    );
    const tasks = s.plan.filter((p) => p.decision_id === result.decisionId);
    assert.ok(tasks.length >= 2);
    assert.ok(
      tasks.every(
        (p) => p.source_context_id === ctx.id && p.due_date! >= today(),
      ),
    );
    assert.ok(
      (await journey(db, pid)).contexts
        .find((c: any) => c.id === ctx.id)!
        .actions.some((p: any) => p.id === tasks[0].id),
    );
    const note = await draftNote(db, pid, ctx.id);
    assert.match(note.text, /Hyperkalaemia review/);
    assert.match(note.text, /12.5 mg/);
    assert.match(note.text, /Renal function and potassium check/);
    const labTask = tasks.find((p) => p.completes_on.type === "lab")!;
    await db.transaction((q) =>
      K.recordObservations(q, actor, pid, {
        effectiveAt: nowIso(),
        contextId: ctx.id,
        items: [
          { code: "potassium", value: 4.5 },
          { code: "creatinine", value: 100 },
        ],
      }),
    );
    assert.equal(
      (await summary(db, pid)).plan.find((p: any) => p.id === labTask.id)!
        .awaitingReview,
      true,
    );
  });
}
test("a failed second joined pathway rolls back the first decision and its medication change", async () => {
  const pid = await db.transaction((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic atomic flow",
      mrn: "FLOW-ATOMIC",
      sex: "Male",
      birthDate: "1960-01-01",
      conditions: ["hfref"],
    }),
  );
  await db.transaction((q) =>
    K.startMedication(q, actor, pid, {
      code: "spironolactone",
      doseValue: 25,
      frequency: "OD",
      route: "PO",
      indication: "hf",
      effectiveAt: nowIso(),
    }),
  );
  await assert.rejects(
    db.transaction(async (q) => {
      await completeWizard(q, actor, pid, "hyperkalaemia", { answers });
      await completeWizard(q, actor, pid, "unknown", { answers: {} });
    }),
    /Unknown wizard/,
  );
  const s = await loadState(db, pid);
  assert.equal(s.meds[0].doseValue, 25);
  assert.equal(s.plan.length, 0);
  assert.equal(
    (await db.query("SELECT id FROM cf.decision WHERE patient_id=$1", [pid]))
      .rows.length,
    0,
  );
});
