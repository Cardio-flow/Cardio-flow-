// Audit fixes (6 Oct): starting RAAS/MRA needs its safety values first; a creatinine rise >50% blocks it;
// severe secondary MR in HFrEF waits for optimised therapy (hf.secondary-mr) instead of an immediate Heart Team card.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string, h = "09") => new Date(`${day}T${h}:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const recs = async (pid: string, rule: string) =>
  (await db.query(`SELECT severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[];

before(async () => { db = await createLocalDb(); await boot(db, { seed: false }); });
after(async () => db.close());

test("HFrEF without a blood pressure: the ARNI card asks for BP and K first, then offers the start; a creatinine rise >50% stops RAAS/MRA suggestions", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Gate " + rnd(), mrn: "G" + rnd(), sex: "Male", birthDate: "1960-01-01", conditions: ["hfref"] }));
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -3)), quality: "formal", lvef: 30, findings: [] });
    await K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -3)), items: [{ code: "creatinine", value: 90 }, { code: "hr", value: 80 }] });
    await reassess(q, pid, "production");
  });
  let raas = (await recs(pid, "hf.foundational-therapy")).find((r) => /ARNI/.test(r.title));
  assert.equal(raas.action.type, "add-labs");
  assert.deepEqual(raas.action.codes, ["potassium", "sbp"]);
  assert.equal(raas.action.label, "Check K and BP first");
  await tx(async (q) => {
    await K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -2)), items: [{ code: "potassium", value: 4.5 }, { code: "sbp", value: 118 }] });
    await reassess(q, pid, "production");
  });
  raas = (await recs(pid, "hf.foundational-therapy")).find((r) => /ARNI/.test(r.title));
  assert.equal(raas.action.type, "start-med");
  await tx(async (q) => {
    await K.recordObservations(q, doc, pid, { effectiveAt: at(T, "08"), items: [{ code: "creatinine", value: 150 }] });
    await reassess(q, pid, "production");
  });
  const titles = (await recs(pid, "hf.foundational-therapy")).map((r) => r.title);
  assert.ok(!titles.some((t) => /ARNI|MRA/.test(t)), "creatinine up 67%: no RAAS/MRA start");
  assert.ok(titles.some((t) => /SGLT2|Beta-blocker/.test(t)));
});

test("severe secondary MR in HFrEF: no immediate Heart Team card", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Smr " + rnd(), mrn: "S" + rnd(), sex: "Male", birthDate: "1958-01-01", conditions: ["hfref"] }));
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -3)), quality: "formal", lvef: 30, findings: [] });
    await K.recordHistory(q, doc, pid, { effectiveAt: at(addDays(T, -3)), add: [{ code: "mr-secondary", attributes: { severity: "Severe" } }] });
    await reassess(q, pid, "production");
  });
  assert.equal((await recs(pid, "valve.severe-heart-team")).length, 0);
});
