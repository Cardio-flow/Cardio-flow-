// Coronary module, slice 1: PCI/CABG as dated procedures (migration 005) and the coronary profile.
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

test("a PCI is recorded with its date and setting, adds past PCI to the problem list, and is append-only", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Cor " + Date.now(), mrn: "C" + Date.now(), sex: "Male", birthDate: "1962-01-01", conditions: ["cad-ccs"] }));
  const r = await tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -10)), details: { setting: "elective", vessels: ["LAD", "LCx"], device: "Drug-eluting stent", stents: 3, complex: ["≥3 stents"], access: "Radial" } }));
  const s = await loadState(db, pid);
  assert.equal(s.procedures.length, 1);
  assert.equal(s.procedures[0].summary, "LAD, LCx DES ×3 · Elective (chronic coronary syndrome) · complex PCI");
  const pciDx = s.conditions.find((c) => c.code === "prior-pci")!;
  assert.equal(pciDx.onset?.slice?.(0, 10) ?? String(pciDx.onset).slice(0, 10), addDays(T, -10));
  assert.deepEqual(pciDx.attributes.vessels, ["LAD", "LCx"]);
  await assert.rejects(db.query(`UPDATE cf.procedure SET summary='x' WHERE id=$1`, [r.id]), /append-only/);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, 2)), details: { setting: "elective", vessels: ["RCA"] } })), /future/);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(T), details: { setting: "elective", vessels: [] } })), /vessel/);
  const j = (await db.query(`SELECT title FROM cf.clinical_event WHERE patient_id=$1 AND category='procedure'`, [pid])).rows as any[];
  assert.match(j[0].title, /^PCI · LAD, LCx DES ×3/);
});

test("coronary profile: events in order, index event, regimen names, LDL against goal", async () => {
  const f: any = (await sumOf("Fatma Al-Ajmi")).cad;
  assert.equal(f.antithrombotic.regimen, "Triple therapy");
  assert.deepEqual(f.antithrombotic.drugs.map((d: any) => d.role).sort(), ["Anticoagulant", "Aspirin", "P2Y12 inhibitor"]);
  assert.ok(f.index.acs, "NSTEMI admission + PCI: acute coronary syndrome");
  assert.equal(f.index.kind, "pci");
  assert.ok(f.events.some((e: any) => e.kind === "acs") && f.events.some((e: any) => e.kind === "pci"));
  const sa: any = (await sumOf("Salem Al-Rashidi")).cad;
  assert.equal(sa.antithrombotic.regimen, "DAPT");
  assert.equal(sa.index.acs, false, "elective PCI: chronic coronary syndrome");
  assert.ok(sa.index.days >= 159 && sa.index.days <= 161);
  const n: any = (await sumOf("Noura Al-Kandari")).cad;
  assert.equal(n.lipids.goal.value, 1.4);
  assert.equal(n.lipids.atGoal, false);
  assert.ok(n.rehab, "rehab referral from the discharge plan is shown");
  const h: any = (await sumOf("Huda Al-Sabah")).cad;
  assert.equal(h, null, "no coronary disease: no panel");
});

test("CABG: grafts recorded, past CABG added once", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Cabg " + Date.now(), mrn: "G" + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "cabg", date: at(addDays(T, -400)), details: { grafts: ["LIMA to LAD", "Vein grafts"], count: 3 } }));
  const s = await loadState(db, pid);
  assert.equal(s.procedures[0].summary, "3 grafts · LIMA to LAD, Vein grafts");
  assert.deepEqual(s.conditions.find((c) => c.code === "prior-cabg")!.attributes.grafts, ["LIMA", "Vein grafts"]);
  assert.ok(s.tags.has("cad"));
});
