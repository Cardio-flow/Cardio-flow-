// Rhythm & devices module, slice 1: device implants, ablations and cardioversions as dated
// procedures, the device on the problem list, and the rhythm profile.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { summary } from "../server/kernel/views.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const sumOf = async (name: string): Promise<any> => { const id = await byName(name); return tx((q) => summary(q, id, "sandbox")); };
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("a device implant lists the device on the problem list; an upgrade changes it; a loop recorder does not replace a pacemaker", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Dev " + Date.now(), mrn: "V" + Date.now(), sex: "Male", birthDate: "1950-01-01", conditions: ["av-block"] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -300)), details: { type: "Pacemaker (dual chamber)", action: "New implant", indication: "AV block", pacing: "Conduction system pacing (His / LBBAP)" } }));
  let s = await loadState(db, pid);
  assert.equal(s.procedures[0].summary, "Pacemaker (dual chamber) · AV block · Conduction system pacing (His / LBBAP)");
  assert.equal(s.conditions.find((c) => c.code === "cied")!.attributes.type, "Pacemaker");
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -20)), details: { type: "Implantable loop recorder", action: "New implant" } }));
  assert.equal((await loadState(db, pid)).conditions.find((c) => c.code === "cied")!.attributes.type, "Pacemaker");
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -2)), details: { type: "CRT-P", action: "Upgrade", indication: "CRT for heart failure", pacing: "Biventricular" } }));
  s = await loadState(db, pid);
  const cied = s.conditions.filter((c) => c.code === "cied" && c.status === "active");
  assert.equal(cied.length, 1);
  assert.equal(cied[0].attributes.type, "CRT-P");
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "ablation", date: at(T), details: { targets: [] } })), /ablated/);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "cardioversion", date: at(T), details: {} })), /Electrical or pharmacological/);
});

test("rhythm profile: Fatma's paroxysmal AF with CHA2DS2-VA, apixaban dose check and her procedures; Abdullah's pacemaker; not shown without arrhythmia", async () => {
  const f: any = (await sumOf("Fatma Al-Ajmi")).rhythm;
  assert.equal(f.af.pattern, "Paroxysmal");
  assert.ok(f.stroke.score >= 2);
  assert.equal(f.stroke.advice, "OAC recommended (I)");
  assert.equal(f.anticoagulation[0].name, "Apixaban");
  assert.ok(f.anticoagulation[0].doseCheck);
  assert.deepEqual(f.events.map((e: any) => e.kind), ["ablation", "cardioversion"]);
  const cad: any = (await sumOf("Fatma Al-Ajmi")).cad;
  assert.ok(!cad.events.some((e: any) => e.kind === "ablation" || e.title === "Ablation"), "rhythm procedures are not coronary events");
  const a: any = (await sumOf("Abdullah Al-Enezi")).rhythm;
  assert.equal(a.af.pattern, "Permanent");
  assert.equal(a.devices[0].type, "Pacemaker (single chamber)");
  assert.equal(a.anticoagulation[0].doseCheck, "INR-guided");
  assert.equal((await sumOf("Noura Al-Kandari")).rhythm, null);
});
