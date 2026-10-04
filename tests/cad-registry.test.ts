// Coronary module, slice 5: the CAD Registry projection (read-only, the registry's own keys).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot } from "../server/boot.js";
import { loadState } from "../server/kernel/state.js";
import { cadRegistryCohort, cadRegistryProjection } from "../server/engine/cad-registry.js";

let db: DB;
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());
const stateOf = async (name: string) => loadState(db, ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id);
const fields = (p: any) => Object.fromEntries(p.sections.flatMap((s: any) => s.fields).map((f: any) => [f.key, f]));

test("Noura (primary PCI, discharged): presentation, procedure, in-hospital events and discharge medicines in the registry's wording", async () => {
  const p = cadRegistryProjection(await stateOf("Noura Al-Kandari"))!;
  assert.equal(p.registry, "CAD Registry");
  assert.match(p.index, /^PCI .* · LAD DES ×1 · Primary PCI \(STEMI\)$/);
  const f = fields(p);
  assert.equal(f.CA_Reason.value, "Primary PCI (STEMI)");
  assert.equal(f.Presentation_Type.value, "STEMI");
  assert.equal(f.Procedure_Urgency.value, "Emergent / salvage");
  assert.equal(f.Culprit_Vessel.value, "LAD");
  assert.equal(f.Total_Stents.value, "1");
  assert.equal(f.Prior_PCI.value, "No", "the index PCI is not a prior PCI");
  assert.equal(f.In_Hospital_Outcome.value, "Survived to discharge");
  assert.equal(f.Major_Bleeding.value, "No");
  assert.equal(f.Discharge_Aspirin.value, "Yes");
  assert.equal(f.Discharge_Ticagrelor.value, "Yes");
  assert.equal(f.Discharge_Statin.value, "High intensity");
  assert.equal(f.Home_Aspirin.value, "No", "started during the admission");
  assert.equal(f.Killip_Class.mapped, false, "asked in the registry");
  assert.ok(p.csv.split("\n")[0].includes("CA_Reason"));
});

test("Fatma (NSTE-ACS PCI, still in hospital): baseline and nadir haemoglobin over the stay; discharge fields wait for discharge", async () => {
  const f = fields(cadRegistryProjection(await stateOf("Fatma Al-Ajmi"))!);
  assert.equal(f.CA_Reason.value, "Urgent / early invasive (NSTEMI / high-risk ACS)");
  assert.equal(f.Presentation_Type.value, "NSTEMI");
  assert.equal(f.In_Hospital_Outcome.value, "In hospital");
  assert.equal(f.Discharge_Aspirin.value, null);
  assert.equal(f.Hemoglobin.value, "11.8");
  assert.equal(f.Hemoglobin_Nadir.value, "10.4");
  assert.equal(f.Atrial_Fibrillation.value, "Yes");
});

test("cohort: every patient with a PCI, angiography or ACS admission, one CSV row each; HF-only patients are not in it", async () => {
  const ids = ((await db.query(`SELECT id, name FROM cf.patient`)).rows as any[]);
  const states = [];
  for (const r of ids) states.push(await loadState(db, r.id));
  const c = cadRegistryCohort(states);
  const names = c.patients.map((p: any) => p.name);
  for (const n of ["Noura Al-Kandari", "Fatma Al-Ajmi", "Salem Al-Rashidi", "Saad Al-Otaibi"]) assert.ok(names.includes(n), n);
  assert.ok(!names.includes("Huda Al-Sabah"));
  assert.equal(c.csv.split("\n").length, c.patients.length + 1);
  assert.equal(c.counts.byType.STEMI >= 2, true);
});
