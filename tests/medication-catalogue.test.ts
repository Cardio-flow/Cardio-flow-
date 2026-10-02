// Medication catalogue (2 Oct 2026): more antihypertensives, anti-anginals, lipid combinations
// (Atozet, Zympass), Omacor, rivaroxaban 2.5 mg, antibiotics, steroids, colchicine; any frequency;
// a frequency change is recorded and shown.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { summary } from "../server/kernel/views.js";
import { loadState } from "../server/kernel/state.js";
import { FREQUENCIES, MEDICATION, MEDICATIONS, PURPOSE_ORDER, medicationSearchText } from "../shared/catalog.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("catalogue: requested drugs are findable by generic or trade name, with valid purposes and frequencies", () => {
  const find = (q: string) => MEDICATIONS.filter((d) => medicationSearchText(d).includes(q.toLowerCase())).map((d) => d.code);
  assert.ok(find("Zympass").includes("rosuvastatin-ezetimibe"));
  assert.ok(find("Atozet").includes("atorvastatin-ezetimibe"));
  assert.ok(find("Omacor").includes("omega-3-ethyl-esters"));
  assert.ok(MEDICATION.rivaroxaban.doses.includes(2.5) && MEDICATION.rivaroxaban.frequencies.includes("BID"));
  for (const q of ["Augmentin", "Rocephin", "Klacid", "Tavanic", "Tazocin", "Colchicine", "Prednisolone", "Imdur", "Ranexa", "Nebilet", "Exforge", "Aprovel", "Adalat"]) assert.ok(find(q).length, q);
  for (const d of MEDICATIONS) {
    assert.ok(PURPOSE_ORDER.includes(d.purpose), `${d.code} purpose ${d.purpose}`);
    for (const f of d.frequencies) assert.ok(FREQUENCIES.includes(f), `${d.code} frequency ${f}`);
    if (d.doseLabels) assert.equal(d.doseLabels.length, d.doses.length, d.code);
  }
  assert.equal(new Set(MEDICATIONS.map((d) => d.code)).size, MEDICATIONS.length, "no duplicate codes");
  // QT-prolonging antibiotics join the QTc rule; non-evidence beta-blockers are not counted as the HF pillar
  assert.ok(MEDICATION.clarithromycin.tags.includes("qt") && MEDICATION.levofloxacin.tags.includes("qt"));
  assert.ok(!MEDICATION.atenolol.tags.includes("bb"));
});

test("frequency change: recorded as its own event, shown as the current frequency and as 'Frequency changed'", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Freq Patient", mrn: "FQ" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["htn"] }));
  const { medicationId } = await tx((q) => K.startMedication(q, doc, pid, { code: "nifedipine", doseValue: 30, frequency: "OD", route: "PO", indication: "htn", effectiveAt: at(addDays(T, -30)) }));
  await tx((q) => K.medicationEvent(q, doc, pid, medicationId, { kind: "continue", frequency: "BID", reason: "Frequency changed: OD → BID · clinical response", effectiveAt: nowIso() }));
  const st = await db.transaction((q) => loadState(q, pid));
  const m = st.meds.find((x) => x.id === medicationId)!;
  assert.equal(m.frequency, "BID");
  assert.equal(m.doseValue, 30);
  const s: any = await tx((q) => summary(q, pid, "production"));
  const row = s.medications.groups.flatMap((g: any) => g.meds).find((x: any) => x.id === medicationId);
  assert.equal(row.lastChange.kind, "frequency");
  // an antibiotic with a free indication
  await tx((q) => K.startMedication(q, doc, pid, { code: "amoxicillin-clavulanate", doseValue: 1000, frequency: "BID", route: "PO", indication: "Chest infection (community-acquired)", effectiveAt: nowIso() }));
  const s2: any = await tx((q) => summary(q, pid, "production"));
  assert.ok(s2.medications.groups.some((g: any) => g.purpose === "Infection"));
});
