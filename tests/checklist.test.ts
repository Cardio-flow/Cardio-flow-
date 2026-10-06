// Checklists before a procedure (redesign slice 7): read from the record, guideline/label values only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { checklist } from "../server/engine/checklist.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (d: string) => new Date(`${d}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
before(async () => { db = await createLocalDb(); await boot(db, { seed: false }); });
after(async () => db.close());

test("before PCI: eGFR 45 → hydration and stop metformin; missing labs open; before cardioversion: apixaban 10 days → flagged, 30 days → ticked", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ck " + Date.now(), mrn: "CK" + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions: ["af", "t2dm"] }));
  await tx(async (q) => {
    await K.startMedication(q, doc, pid, { code: "metformin", doseValue: 1000, frequency: "BID", route: "PO", indication: "dm", effectiveAt: at(addDays(T, -300)) });
    await K.startMedication(q, doc, pid, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(addDays(T, -10)) });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "creatinine", value: 140 }, { code: "potassium", value: 4.5 }, { code: "haemoglobin", value: 13.5 }] });
  });
  let s = await loadState(db, pid);
  const pci = checklist(s, "pci").items;
  const by = (items: any[], k: string) => items.find((i) => i.key === k);
  assert.equal(by(pci, "hydration").status, "flag");
  assert.equal(by(pci, "metformin").status, "flag");
  assert.equal(by(pci, "platelets").status, "missing");
  assert.equal(by(pci, "haemoglobin").status, "ok");
  assert.equal(by(pci, "oac").action.wizard, "pre-procedure");
  const cv = checklist(s, "cardioversion").items.find((i) => i.key.startsWith("oac-"))!;
  assert.equal(cv.status, "flag");
  assert.match(cv.why!, /less than 3 weeks/);
  const p2 = await tx((q) => K.createPatient(q, doc, { name: "Ck2 " + Date.now(), mrn: "CK2" + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions: ["af"] }));
  await tx((q) => K.startMedication(q, doc, p2, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(addDays(T, -30)) }));
  s = await loadState(db, p2);
  assert.equal(checklist(s, "cardioversion").items.find((i) => i.key.startsWith("oac-"))!.status, "ok");
  assert.equal(checklist(s, "ablation").items.find((i) => i.key === "oac")!.status, "ok");
  assert.equal(checklist(s, "device").items.find((i) => i.key === "antibiotic")!.status, "info");
});
