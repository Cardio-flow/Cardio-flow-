// Medicine coverage, slice 1: the medicine safety table (label contraindications and interactions, ESC AF
// 2024 antiplatelet + anticoagulant rows) read by med.interaction, med.contraindication and med.oac-antiplatelet.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { MEDICATION } from "../shared/catalog.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const now = () => new Date().toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const recs = async (pid: string) =>
  ((await db.query(`SELECT rule_id, severity, title, detail, rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id IN ('med.interaction','med.contraindication','med.oac-antiplatelet') ORDER BY title`, [pid])).rows as any[]);
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

let n = 0;
async function patient(opts: { conditions?: string[]; meds: (string | [string, number])[]; obs?: { code: string; value: number }[]; add?: any[]; nyha?: string; birthDate?: string }) {
  const pid = await tx((q) => K.createPatient(q, doc, { name: `Med Safety ${++n} ${Date.now()}`, mrn: `MS${n}${Date.now()}`, sex: "Male", birthDate: opts.birthDate ?? "1955-01-01", conditions: opts.conditions ?? [] }));
  if (opts.add) await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: now(), add: opts.add }));
  for (const x of opts.meds) {
    const [code, dose] = Array.isArray(x) ? x : [x, MEDICATION[x].doses[0]];
    const def = MEDICATION[code];
    await tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: def.frequencies[0], route: def.routes[0], indication: def.indicationChoices?.[0] ?? def.indications[0] ?? "other", effectiveAt: now() } as any));
  }
  if (opts.obs?.length) await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: now(), items: opts.obs!.map((o) => ({ code: o.code, value: o.value })) } as any));
  if (opts.nyha) await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: now(), items: [{ code: "nyha", text: opts.nyha }] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  return pid;
}

test("Yaqoub (seed): simvastatin + clarithromycin red, diltiazem with LVEF 35% orange, AF on apixaban + aspirin with no recent PCI yellow (III B); all published", async () => {
  const f = await recs(await byName("Yaqoub Al-Enezi"));
  assert.deepEqual(f.map((x) => [x.rule_id, x.severity, x.title]), [
    ["med.oac-antiplatelet", "yellow", "AF on Apixaban with Aspirin: review the antiplatelet"],
    ["med.contraindication", "orange", "Diltiazem with heart failure and reduced ejection fraction"],
    ["med.interaction", "red", "Simvastatin with Clarithromycin (strong CYP3A4 inhibitor): contraindicated"],
  ]);
  assert.ok(f.every((x) => x.rule_status === "PUBLISHED"));
});

test("PH drugs: sildenafil + nitrate and riociguat + sildenafil are red", async () => {
  const pid = await patient({ meds: ["sildenafil", "isosorbide-mononitrate", "riociguat"] });
  const t = (await recs(pid)).map((x) => `${x.severity} ${x.title}`);
  assert.ok(t.includes("red Sildenafil with Isosorbide mononitrate: contraindicated"));
  assert.ok(t.includes("red Riociguat with Sildenafil: contraindicated"));
  assert.ok(t.includes("red Riociguat with Isosorbide mononitrate: contraindicated"));
});

test("HF drugs: sacubitril/valsartan + ACE inhibitor red; ACEi + ARB orange; spironolactone + finerenone is not a label pair, spironolactone + amiloride is", async () => {
  const a = await patient({ meds: ["sacubitril-valsartan", "ramipril", "candesartan"] });
  const t = (await recs(a)).map((x) => `${x.severity} ${x.title}`);
  assert.ok(t.includes("red Sacubitril/valsartan with an ACE inhibitor: contraindicated"));
  assert.ok(t.includes("orange Dual RAS blockade: ACE inhibitor with an ARB"));
  const b = await patient({ meds: ["spironolactone", "finerenone"] });
  assert.equal((await recs(b)).length, 0);
  const c = await patient({ meds: ["spironolactone", "amiloride"] });
  assert.equal((await recs(c))[0].title, "Two potassium-sparing medicines: contraindicated");
});

test("anticoagulants: renal thresholds (dabigatran CrCl <30 red; apixaban CrCl <15 orange), antiphospholipid syndrome, rifampicin by label wording", async () => {
  // 80-year-old, 60 kg, creatinine 300 µmol/L → CrCl ≈ 13 mL/min
  const a = await patient({ birthDate: addDays(T, -(80 * 365 + 30)), meds: ["apixaban"], obs: [{ code: "creatinine", value: 300 }, { code: "weight", value: 60 }] });
  const fa = await recs(a);
  assert.equal(fa[0].severity, "orange");
  assert.equal(fa[0].title, "Apixaban with CrCl <15 mL/min or dialysis: not recommended");
  const d = await patient({ birthDate: addDays(T, -(80 * 365 + 30)), meds: [["dabigatran", 110]], obs: [{ code: "creatinine", value: 190 }, { code: "weight", value: 60 }] });
  const fd = (await recs(d)).find((x) => x.rule_id === "med.contraindication");
  assert.equal(fd.severity, "red");
  assert.match(fd.title, /^Dabigatran with CrCl \d+ mL\/min: contraindicated$/);
  const p = await patient({ meds: ["rivaroxaban"], add: [{ code: "aps" }] });
  assert.equal((await recs(p))[0].title, "Rivaroxaban with antiphospholipid syndrome: not recommended");
  const r = await patient({ meds: ["dabigatran", "edoxaban", "rifampicin"] });
  const fr = (await recs(r)).filter((x) => /strong inducer/.test(x.title));
  assert.deepEqual(fr.map((x) => [x.title.split(" ")[0], x.severity]).sort(), [["Dabigatran", "orange"], ["Edoxaban", "yellow"]]);
});

test("rhythm drugs: dronedarone with HF and permanent AF, flecainide with HF (red); ivabradine + diltiazem (red)", async () => {
  const pid = await patient({ conditions: ["hfmref"], add: [{ code: "af", attributes: { pattern: "Permanent" } }], meds: ["dronedarone", "flecainide"] });
  const t = (await recs(pid)).map((x) => `${x.severity} ${x.title}`);
  assert.ok(t.includes("red Dronedarone with heart failure or LV systolic dysfunction: contraindicated"));
  assert.ok(t.includes("red Dronedarone in permanent AF: contraindicated"));
  assert.ok(t.includes("red Flecainide with heart failure: contraindicated"));
  const iv = await patient({ meds: ["ivabradine", "diltiazem"] });
  assert.ok((await recs(iv)).some((x) => x.title === "Ivabradine with Diltiazem: contraindicated" && x.severity === "red"));
});

test("ibuprofen with HF: orange, red at NYHA IV; clopidogrel + omeprazole yellow; colchicine + clarithromycin red only with renal or hepatic impairment", async () => {
  const a = await patient({ conditions: ["hfpef"], meds: ["ibuprofen"], nyha: "IV" });
  assert.equal((await recs(a))[0].severity, "red");
  const b = await patient({ conditions: ["hfpef"], meds: ["ibuprofen"], nyha: "II" });
  assert.equal((await recs(b))[0].severity, "orange");
  const c = await patient({ meds: ["clopidogrel", "omeprazole"] });
  assert.deepEqual((await recs(c)).map((x) => [x.severity, x.title]), [["yellow", "Clopidogrel with Omeprazole: discouraged"]]);
  const d = await patient({ meds: ["colchicine", "clarithromycin"] });
  assert.equal((await recs(d)).filter((x) => /Colchicine/.test(x.title)).length, 0);
  const e = await patient({ conditions: ["ckd-3b"], meds: ["colchicine", "clarithromycin"] });
  assert.equal((await recs(e)).find((x) => /Colchicine/.test(x.title)).severity, "red");
});

test("AF on anticoagulant + antiplatelet: quiet within 12 months of a PCI", async () => {
  const pid = await patient({ add: [{ code: "af", attributes: { pattern: "Paroxysmal" } }, { code: "prior-pci", onset: addDays(T, -100) }], meds: ["apixaban", "clopidogrel"] });
  assert.equal((await recs(pid)).filter((x) => x.rule_id === "med.oac-antiplatelet").length, 0);
});

import { loadState } from "../server/kernel/state.js";
import { preStartCheck } from "../server/engine/med-safety.js";
test("pre-start check: ivabradine proposed for Yaqoub (diltiazem, clarithromycin) → two red contraindications; pantoprazole → none", async () => {
  const s = await loadState(db, await byName("Yaqoub Al-Enezi"));
  const h = preStartCheck(s, "ivabradine", MEDICATION.ivabradine);
  assert.deepEqual(h.map((x) => [x.severity, x.title]), [
    ["red", "Ivabradine with Diltiazem: contraindicated"],
    ["red", "Ivabradine with Clarithromycin (strong CYP3A4 inhibitor): contraindicated"],
  ]);
  assert.deepEqual(preStartCheck(s, "pantoprazole", MEDICATION.pantoprazole), []);
});
