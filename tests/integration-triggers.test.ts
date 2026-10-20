import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { reassess } from "../server/engine/engine.js";
import * as K from "../server/kernel/clinical.js";
import { nowIso, type Actor } from "../server/kernel/base.js";

let db: DB;
let sequence = 0;
const actor: Actor = { id: "integration@cardioflow.local", name: "Synthetic integration", role: "clinician", siteId: SITE_ID };
const active = async (id: string, rule: string) => (await db.query<{ title: string; detail: string; missing: string[]; facts: { label: string; value: string }[]; action: { type: string; dose?: number } }>(
  "SELECT title,detail,missing,facts,action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2", [id, rule],
)).rows;
const sample = async (name: string) => (await db.query<{ id: string }>("SELECT id FROM cf.patient WHERE name=$1", [name])).rows[0].id;
const patient = (conditions: string[], sex: "Male" | "Female" = "Female") => db.transaction((tx) => K.createPatient(tx, actor, {
  name: `Synthetic integration ${++sequence}`, mrn: `INT-${sequence}`, sex,
  birthDate: "1980-01-01", synthetic: true, conditions,
}));
const record = (id: string, items: K.ObsInput[]) => db.transaction(async (tx) => {
  const result = await K.recordObservations(tx, actor, id, { effectiveAt: nowIso(), items });
  await reassess(tx, id, "production", result.changed);
});
const start = (id: string, code: string, doseValue: number, indication: string) => db.transaction(async (tx) => {
  const result = await K.startMedication(tx, actor, id, {
    code, doseValue, frequency: "OD", route: "PO", indication, effectiveAt: nowIso(),
  });
  await reassess(tx, id, "production", result.changed);
});

before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("a new congestion finding withdraws an HF uptitration suggestion, then clearing it restores review", async () => {
  const id = await sample("Abdullah Al-Enezi");
  assert.ok((await active(id, "hf.titration")).length > 0);
  await record(id, [{ code: "congestion", text: "Moderate" }]);
  assert.equal((await active(id, "hf.titration")).length, 0);
  await record(id, [{ code: "congestion", text: "None" }]);
  assert.ok((await active(id, "hf.titration")).length > 0);
});

test("HF congestion advice resolves during admission and returns after discharge while weight gain persists", async () => {
  const id = await sample("Hamad Al-Shammari");
  assert.equal((await active(id, "hf.congestion")).length, 1);
  const admission = await db.transaction(async (tx) => {
    const result = await K.startAdmission(tx, actor, id, { startedAt: nowIso(), reasons: ["Acute decompensated HF"], hfRelated: true });
    await reassess(tx, id, "production", result.changed);
    return result.id;
  });
  assert.equal((await active(id, "hf.congestion")).length, 0);
  await db.transaction(async (tx) => {
    const changed = await K.discharge(tx, actor, id, admission, { endedAt: nowIso(), status: "Home", destination: "Home", plan: [] });
    await reassess(tx, id, "production", changed);
  });
  assert.equal((await active(id, "hf.congestion")).length, 1);
});

test("a new low haemoglobin updates bleeding risk in the PCI antithrombotic plan", async () => {
  const id = await sample("Noura Al-Kandari");
  assert.equal((await active(id, "cad.antithrombotic-plan")).length, 1);
  await record(id, [{ code: "haemoglobin", value: 10 }]);
  const updated = await active(id, "cad.antithrombotic-plan");
  assert.equal(updated.length, 1);
  assert.match(updated[0].title, /high bleeding risk/);
  assert.match(updated[0].detail, /Haemoglobin 10/);
});

test("a new haemoglobin appears in an existing out-of-range INR alert", async () => {
  const id = await sample("Abdullah Al-Enezi");
  assert.equal((await active(id, "safety.inr")).length, 1);
  await record(id, [{ code: "haemoglobin", value: 10.5 }]);
  const updated = await active(id, "safety.inr");
  assert.equal(updated.length, 1);
  const facts = typeof updated[0].facts === "string" ? JSON.parse(updated[0].facts) : updated[0].facts;
  assert.ok(facts.some((fact: { label: string; value: string }) => fact.label === "Haemoglobin" && /10\.5/.test(fact.value)));
});

test("new weight and creatinine update the AF anticoagulant dose suggestion", async () => {
  const id = await db.transaction(async (tx) => {
    const id = await K.createPatient(tx, actor, {
      name: `Synthetic AF dose ${++sequence}`, mrn: `INT-AF-${sequence}`, sex: "Female",
      birthDate: "1940-01-01", synthetic: true, conditions: ["af", "htn"],
    });
    await reassess(tx, id, "production");
    return id;
  });
  const before = (await active(id, "af.anticoagulation"))[0];
  assert.equal(before.action.type, "wizard");
  assert.ok(before.missing.some((item) => /creatinine/.test(item)));
  assert.ok(before.missing.some((item) => /weight/.test(item)));
  await record(id, [{ code: "creatinine", value: 140 }, { code: "weight", value: 55 }]);
  const updated = await active(id, "af.anticoagulation");
  assert.equal(updated.length, 1);
  const action = typeof updated[0].action === "string" ? JSON.parse(updated[0].action) : updated[0].action;
  assert.equal(action.dose, 2.5);
});

test("AF on warfarin opens the switching pathway instead of a direct DOAC start", async () => {
  const id = await patient(["af", "htn"]);
  await start(id, "warfarin", 5, "af");
  const recommendation = (await active(id, "af.anticoagulation"))[0];
  assert.match(recommendation.title, /DOAC is preferred/);
  const action = typeof recommendation.action === "string" ? JSON.parse(recommendation.action) : recommendation.action;
  assert.deepEqual(action, { type: "wizard", wizard: "af-care" });
});

test("starting oral iron changes deficiency advice from replacement to response review", async () => {
  const id = await patient([]);
  await record(id, [{ code: "haemoglobin", value: 13 }, { code: "ferritin", value: 8 }]);
  assert.match((await active(id, "lab.iron-deficiency"))[0].title, /find the cause and replace/);
  await start(id, "ferrous-sulfate", 200, "Confirmed iron deficiency");
  const updated = await active(id, "lab.iron-deficiency");
  assert.equal(updated.length, 1);
  assert.match(updated[0].title, /on ferrous sulfate.*check the cause and the response/);
});

test("a new creatinine result removes the missing-renal-data flag from congestion review", async () => {
  const id = await patient(["hfpef"]);
  await record(id, [{ code: "congestion", text: "Moderate" }]);
  assert.deepEqual((await active(id, "hf.congestion"))[0].missing, ["Creatinine"]);
  await record(id, [{ code: "creatinine", value: 100 }]);
  assert.deepEqual((await active(id, "hf.congestion"))[0].missing, []);
});

test("HCM advice recognizes mavacamten when it is added after the LVOTO result", async () => {
  const id = await patient(["hcm"]);
  await db.transaction(async (tx) => {
    const result = await K.recordEcho(tx, actor, id, {
      date: nowIso(), quality: "formal", lvef: 70, findings: [], measures: { "lvot-rest": 64, "lvot-provoked": 90 },
    });
    await reassess(tx, id, "production", result.changed);
  });
  await record(id, [{ code: "nyha", text: "III" }]);
  assert.match((await active(id, "cmp.hcm-lvoto"))[0].detail, /Maximum tolerated medical therapy/);
  await start(id, "mavacamten", 5, "hcm");
  assert.match((await active(id, "cmp.hcm-lvoto"))[0].detail, /On mavacamten/);
});
