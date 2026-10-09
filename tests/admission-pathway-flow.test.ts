import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { draftNote } from "../server/kernel/notes.js";
import { summary, journey } from "../server/kernel/views.js";
import { reassess } from "../server/engine/engine.js";
import {
  completeWizard,
  declineRecommendation,
} from "../server/engine/wizard.js";
import { addDays } from "../shared/clinical.js";
import { existingClinicReview } from "../shared/follow-up.js";
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

test("discharge reuses an earlier general clinic booking, preserves its decision, and allows a separate review", async () => {
  for (const separate of [false, true]) {
    const pid = await db.transaction((q) =>
      K.createPatient(q, actor, {
        name: "Synthetic follow-up",
        mrn: "FOLLOWUP-" + separate,
        sex: "Male",
        birthDate: "1960-01-01",
        conditions: ["hfref"],
      }),
    );
    const ctx = await db.transaction((q) =>
      K.startAdmission(q, actor, pid, {
        startedAt: nowIso(),
        location: "CCU",
        reasons: ["Acute decompensated HF"],
      }),
    );
    const original = await db.transaction((q) =>
      K.addPlanAction(q, actor, pid, {
        title: "Clinic review",
        category: "follow_up",
        dueDate: addDays(today(), 7),
        completesOn: { type: "visit" },
        contextId: ctx.id,
        reason: "Original pathway review",
      }),
    );
    await db.transaction((q) =>
      K.discharge(q, actor, pid, ctx.id, {
        endedAt: nowIso(),
        status: "Euvolaemic",
        plan: [
          {
            title: "HF clinic review",
            category: "follow_up",
            dueDate: addDays(today(), 14),
            completesOn: { type: "visit" },
          },
        ],
        reuseClinicFollowUp: !separate,
        handover: "Repeat renal profile with the named clinic team",
      }),
    );
    const plan = (await loadState(db, pid)).plan;
    assert.equal(plan.length, separate ? 2 : 1);
    assert.equal(
      plan.find((p) => p.id === original.id)!.reason,
      "Original pathway review",
    );
    assert.equal(
      plan.find((p) => p.id === original.id)!.due_date,
      addDays(today(), 7),
    );
    assert.match(
      (await draftNote(db, pid, ctx.id)).text,
      /Handover \/ outstanding issues: Repeat renal profile/,
    );
    const discharge = (await journey(db, pid)).events.find(
      (e: any) => e.kind === "discharge",
    )!;
    assert.match(
      discharge.title,
      separate ? /1 plan action created/ : /0 plan actions created/,
    );
  }
});

test("follow-up reuse excludes overdue, later, specialist and serial appointments", () => {
  const booking = {
    id: "booking",
    title: "Clinic review",
    status: "planned",
    category: "follow_up",
    dueDate: addDays(today(), 7),
    completesOn: { type: "visit" },
  };
  assert.equal(
    existingClinicReview(
      [booking],
      "HF clinic review",
      addDays(today(), 14),
      today(),
    )?.id,
    "booking",
  );
  for (const change of [
    { dueDate: addDays(today(), -1) },
    { dueDate: addDays(today(), 28) },
    { title: "Device clinic review" },
    { title: "Myocarditis follow-up · 6 months" },
    { status: "completed" },
    { completesOn: { type: "manual" } },
  ]) {
    assert.equal(
      existingClinicReview(
        [{ ...booking, ...change }],
        "HF clinic review",
        addDays(today(), 14),
        today(),
      ),
      undefined,
    );
  }
  assert.equal(
    existingClinicReview(
      [booking],
      "Myocarditis follow-up · 12 months",
      addDays(today(), 365),
      today(),
    ),
    undefined,
  );
});

test("deferred decision and its reason belong to the open admission narrative, not another encounter", async () => {
  const pid = await db.transaction((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic deferred decision",
      mrn: "FLOW-DEFER",
      sex: "Male",
      birthDate: "1960-01-01",
      conditions: ["hfref"],
    }),
  );
  const earlier = await db.transaction((q) =>
    K.startVisit(q, actor, pid, {
      startedAt: nowIso(),
      reasons: ["Routine cardiology"],
      service: "Cardiology",
    }),
  );
  await db.transaction((q) =>
    K.closeVisit(q, actor, pid, earlier.id, { note: "Earlier visit" }),
  );
  const ctx = await db.transaction((q) =>
    K.startAdmission(q, actor, pid, {
      startedAt: nowIso(),
      location: "CCU",
      reasons: ["Acute decompensated HF"],
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
  )!;
  await db.transaction((q) =>
    declineRecommendation(q, actor, pid, rec.id, {
      outcome: "deferred",
      reason: "Waiting for a repeat sample",
    }),
  );
  const note = await draftNote(db, pid, ctx.id);
  assert.match(note.text, /Decisions:/);
  assert.match(note.text, /deferred — Waiting for a repeat sample/);
  assert.doesNotMatch(
    (await draftNote(db, pid, earlier.id)).text,
    /Waiting for a repeat sample/,
  );
  assert.equal(
    (await journey(db, pid)).events.find((e: any) => e.kind === "decision")!
      .context_id,
    ctx.id,
  );
});
