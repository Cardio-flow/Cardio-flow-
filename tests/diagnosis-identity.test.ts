import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { header, diagnosisLines } from "../server/kernel/views.js";
import {
  checkCase,
  caseSchema,
  importCase,
} from "../server/kernel/case-import.js";
import { reassess } from "../server/engine/engine.js";
import { nowIso, uuid, type Actor } from "../server/kernel/base.js";
import { gdmtPlan } from "../server/engine/guidelines.js";
import { decisionBlocker } from "../shared/decision-validation.js";
import type { WizardContext } from "../shared/wizards.js";
let db: DB,
  seq = 0;
const actor: Actor = {
  id: "diagnosis@example.test",
  name: "Synthetic diagnosis audit",
  role: "clinician",
  siteId: SITE_ID,
};
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = (conditions: string[] = []) =>
  db.transaction((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic diagnoses",
      mrn: "DIAG-" + ++seq,
      sex: "Male",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions,
    }),
  );
const add = (id: string, input: Parameters<typeof K.addCondition>[3]) =>
  db.transaction((q) => K.addCondition(q, actor, id, input));
const state = (id: string) => loadState(db, id);
async function legacy(
  id: string,
  code: string,
  onset: string | null = null,
  attrs: Record<string, unknown> = {},
) {
  const k = uuid();
  const { DIAGNOSIS } = await import("../shared/catalog.js");
  await db.query(
    `INSERT INTO cf.condition(id,logical_id,version,patient_id,code,display,status,onset,detail,recorded_by,attributes) VALUES($1,$1,1,$2,$3,$4,'active',$5,'',$6,$7)`,
    [
      k,
      id,
      code,
      DIAGNOSIS[code].display,
      onset,
      actor.id,
      JSON.stringify(attrs),
    ],
  );
  return k;
}
for (const [a, b] of [
  ["hfref", "hfpef"],
  ["t1dm", "t2dm"],
  ["ckd-3a", "ckd-4"],
]) {
  test(`server refuses concurrent active ${a} and ${b}`, async () => {
    const id = await patient([a]);
    await assert.rejects(
      add(id, { code: b }),
      /already active|change diagnosis|conflict/i,
    );
    assert.deepEqual(
      (await state(id)).conditions.map((c) => c.code),
      [a],
    );
  });
}
test("conflicting registration rolls back the patient", async () => {
  const n = (await db.query(`SELECT count(*)::int AS n FROM cf.patient`))
    .rows[0].n;
  await assert.rejects(
    patient(["hfref", "hfpef"]),
    /already active|change diagnosis|conflict/i,
  );
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM cf.patient`)).rows[0].n,
    n,
  );
});
test("explicit phenotype change keeps its history and prevents reactivation of the old phenotype", async () => {
  const id = await patient(["hfref"]);
  const old = (await state(id)).conditions[0];
  await db.transaction((q) =>
    K.changeCondition(q, actor, id, old.logical_id, {
      code: "hfimpef",
      mode: "changed",
    }),
  );
  assert.deepEqual(
    (await state(id)).conditions.map((c) => c.code),
    ["hfimpef"],
  );
  const row = (
    await db.query(
      `SELECT status FROM cf.condition WHERE logical_id=$1 ORDER BY version DESC LIMIT 1`,
      [old.logical_id],
    )
  ).rows[0];
  assert.equal(row.status, "resolved");
  await assert.rejects(
    db.transaction((q) =>
      K.setConditionStatus(q, actor, id, old.logical_id, "active"),
    ),
    /already active|change diagnosis|conflict/i,
  );
});
test("changing another diagnosis cannot introduce an existing phenotype conflict", async () => {
  const id = await patient(["hfpef", "af"]);
  const af = (await state(id)).conditions.find((c) => c.code === "af")!;
  await assert.rejects(
    db.transaction((q) =>
      K.changeCondition(q, actor, id, af.logical_id, {
        code: "hfref",
        mode: "error",
      }),
    ),
    /already active|change diagnosis|conflict/i,
  );
  assert.ok(
    (await state(id)).conditions.some((c) => c.logical_id === af.logical_id),
  );
});
test("same-code retry preserves one diagnosis", async () => {
  const id = await patient(["htn"]);
  assert.equal((await add(id, { code: "htn" })).id, null);
  assert.equal((await state(id)).conditions.length, 1);
});
test("identical dated MI retry is idempotent; a separate MI remains", async () => {
  const id = await patient();
  const event = {
    code: "prior-mi",
    onset: "2020-01-01",
    attributes: { type: "STEMI" },
  };
  await add(id, event);
  assert.equal((await add(id, event)).id, null);
  await add(id, { ...event, onset: "2021-01-01" });
  assert.equal((await state(id)).conditions.length, 2);
  assert.equal(
    diagnosisLines(await state(id)).diagnoses[0],
    "IHD · STEMI 2020 · STEMI 2021",
  );
});
test("PCI identity ignores set ordering but preserves different vessels and unknown event dates", async () => {
  const id = await patient();
  await add(id, {
    code: "prior-pci",
    onset: "2020-01-01",
    attributes: { vessels: ["LAD", "RCA"] },
  });
  assert.equal(
    (
      await add(id, {
        code: "prior-pci",
        onset: "2020-01-01",
        attributes: { vessels: ["RCA", "LAD"] },
      })
    ).id,
    null,
  );
  await add(id, {
    code: "prior-pci",
    onset: "2020-01-01",
    attributes: { vessels: ["LCx"] },
  });
  await add(id, {
    code: "prior-mi",
    onsetYear: 2020,
    attributes: { type: "STEMI" },
  });
  await add(id, {
    code: "prior-mi",
    onsetYear: 2020,
    attributes: { type: "STEMI" },
  });
  assert.equal((await state(id)).conditions.length, 4);
  const line = diagnosisLines(await state(id)).diagnoses.join(" ");
  assert.match(line, /LAD\/RCA/);
  assert.match(line, /LCx/);
});
test("distinct valve positions remain separate", async () => {
  const id = await patient();
  for (const position of ["Aortic", "Mitral"])
    await add(id, {
      code: "prosthetic-valve",
      onset: "2020-01-01",
      attributes: { position, type: "Mechanical" },
    });
  assert.equal((await state(id)).conditions.length, 2);
});
test("updating or reactivating a dated event cannot make an exact duplicate", async () => {
  const id = await patient();
  const a = await add(id, {
    code: "prior-mi",
    onset: "2020-01-01",
    attributes: { type: "STEMI" },
  });
  const b = await add(id, {
    code: "prior-mi",
    onset: "2021-01-01",
    attributes: { type: "STEMI" },
  });
  await assert.rejects(
    db.transaction((q) =>
      K.updateCondition(q, actor, id, b.id!, {
        onset: "2020-01-01",
        attributes: { type: "STEMI" },
      }),
    ),
    /already|duplicate/i,
  );
  await db.transaction((q) =>
    K.setConditionStatus(q, actor, id, a.id!, "resolved"),
  );
  await add(id, {
    code: "prior-mi",
    onset: "2020-01-01",
    attributes: { type: "STEMI" },
  });
  await assert.rejects(
    db.transaction((q) => K.setConditionStatus(q, actor, id, a.id!, "active")),
    /already|duplicate/i,
  );
});
test("imports reject conflicting types before writing", async () => {
  const c = caseSchema.parse({
    format: "cardioflow-case/1",
    sample: true,
    patient: {
      name: "Synthetic import",
      mrn: "CONFLICT",
      sex: "Female",
      age: 70,
    },
    conditions: [{ code: "t1dm" }, { code: "t2dm" }],
  });
  assert.match(checkCase(c).join(" "), /conflict|one active/i);
  await assert.rejects(
    db.transaction((q) => importCase(q, actor, c)),
    /conflict|one active/i,
  );
});
test("legacy duplicate display is compact but both source records stay editable", async () => {
  const id = await patient();
  await legacy(id, "prior-mi", "2020-01-01", { type: "STEMI" });
  await legacy(id, "prior-mi", "2020-01-01", { type: "STEMI" });
  const s = await state(id),
    h = header(s) as any;
  assert.equal(s.conditions.length, 2);
  assert.equal(h.diagnoses.length, 2);
  assert.equal(h.displayDiagnoses.length, 1);
  assert.deepEqual(diagnosisLines(s).diagnoses, ["IHD · STEMI 2020"]);
});
test("legacy phenotype conflicts need visible reconciliation and clear after correction", async () => {
  const id = await patient(["hfref"]);
  const wrong = await legacy(id, "hfpef");
  await db.transaction((q) => reassess(q, id, "production", ["conditions"]));
  let recs = (
    await db.query(
      `SELECT title,detail FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='record.diagnosis-conflict'`,
      [id],
    )
  ).rows;
  assert.equal(recs.length, 1);
  assert.match(recs[0].detail, /HFrEF/);
  assert.match(recs[0].detail, /HFpEF/);
  await db.transaction(async (q) => {
    await K.setConditionStatus(q, actor, id, wrong, "entered_in_error");
    await reassess(q, id, "production", ["conditions"]);
  });
  recs = (
    await db.query(
      `SELECT id FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='record.diagnosis-conflict'`,
      [id],
    )
  ).rows;
  assert.equal(recs.length, 0);
});
test("legacy HF conflict blocks proposals and confirmation; diabetes conflict blocks routine confirmation", async () => {
  const id = await patient(["hfmref"]);
  await legacy(id, "hfpef");
  await db.transaction((q) =>
    K.recordObservations(q, actor, id, {
      effectiveAt: nowIso(),
      items: [
        { code: "lvef", value: 45 },
        { code: "creatinine", value: 90 },
        { code: "potassium", value: 4.2 },
        { code: "sbp", value: 120 },
        { code: "hr", value: 70 },
      ],
    }),
  );
  assert.ok(
    gdmtPlan(await state(id))!.items.every((item) => item.change == null),
  );
  const ctx: WizardContext = {
    today: "2026-11-01",
    facts: [],
    detected: {},
    meds: [],
    dx: ["hfmref", "hfpef"],
  };
  assert.match(decisionBlocker("hf-medicines", {}, ctx)!, /Reconcile/);
  assert.match(
    decisionBlocker("diabetes", {}, { ...ctx, dx: ["t1dm", "t2dm"] })!,
    /Reconcile/,
  );
});
test("change into an already recorded dated event leaves the original active", async () => {
  const id = await patient(["af"]);
  await add(id, { code: "prior-mi", onset: "2020-01-01" });
  const af = (await state(id)).conditions.find((c) => c.code === "af")!;
  await db.transaction((q) =>
    K.updateCondition(q, actor, id, af.logical_id, { onset: "2020-01-01" }),
  );
  await assert.rejects(
    db.transaction((q) =>
      K.changeCondition(q, actor, id, af.logical_id, {
        code: "prior-mi",
        mode: "error",
      }),
    ),
    /already/i,
  );
  assert.ok(
    (await state(id)).conditions.some((c) => c.logical_id === af.logical_id),
  );
});
test("the version boundary also refuses restoration of a conflicting phenotype", async () => {
  const id = await patient(["hfref"]);
  const old = (await state(id)).conditions[0];
  await db.transaction((q) =>
    K.setConditionStatus(q, actor, id, old.logical_id, "resolved"),
  );
  await add(id, { code: "hfpef" });
  const row = (
    await db.query(
      `SELECT * FROM cf.condition WHERE logical_id=$1 ORDER BY version DESC LIMIT 1`,
      [old.logical_id],
    )
  ).rows[0];
  await assert.rejects(
    db.transaction((q) =>
      K.newConditionVersion(q, actor, row, { status: "active" }),
    ),
    /already active|conflict/i,
  );
});
