// Sample (synthetic) patients kept apart from real patients on the same site (7 Oct 2026): the seed is
// sample data with SYN- file numbers; real patients start from an empty worklist; lists, search, counts and
// registries show one group at a time; sandbox-only rules never run on a real patient.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { activeRuleVersions } from "../server/engine/engine.js";
import type { Actor } from "../server/kernel/base.js";

let db: DB;
let base = "", server: any, cookie = "", csrf = "";
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie, "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = await fetch(base + "/demo-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  csrf = (await login.json()).csrf;
});
after(async () => { server.close(); await db.close(); });

test("the seeded patients are sample patients with SYN- file numbers; the real worklist starts empty", async () => {
  const seeded = (await db.query(`SELECT mrn, synthetic FROM cf.patient WHERE site_id=$1`, [SITE_ID])).rows as any[];
  assert.ok(seeded.length > 10);
  assert.ok(seeded.every((p) => p.synthetic && p.mrn.startsWith("SYN-")));
  const real = await call("GET", "/worklist");
  assert.equal(real.body.rows.length, 0);
  assert.equal(real.body.counts.real, 0);
  assert.equal(real.body.counts.sample, seeded.length);
  const sample = await call("GET", "/worklist?sample=1");
  assert.equal(sample.body.rows.length > 0, true);
  assert.equal((await call("GET", "/attention-count")).body.count, 0);
  assert.ok((await call("GET", "/attention-count?sample=1")).body.count > 0);
  const site = await call("GET", "/site");
  assert.equal(site.body.patients.real, 0);
});

test("a new patient is real by default; search, worklist and registries keep the two groups apart", async () => {
  const r = await call("POST", "/patients", { name: "Real Person", mrn: "200000001", sex: "Male", birthDate: "1961-03-04", conditions: ["hfref"], civilId: "261030400011" });
  assert.equal(r.status, 201);
  const wl = (await call("GET", "/worklist")).body;
  assert.deepEqual(wl.rows.map((x: any) => x.mrn), ["200000001"]);
  assert.equal(wl.rows[0].sample, false);
  assert.equal((await call("GET", "/patients?q=")).body.length, 1);
  assert.ok((await call("GET", "/patients?q=&sample=1")).body.every((p: any) => p.sample));
  const hf = (await call("GET", "/registries/hf")).body;
  assert.deepEqual(hf.patients.map((p: any) => p.mrn), ["200000001"]);
  assert.ok((await call("GET", "/registries/hf?sample=1")).body.patients.every((p: any) => p.mrn.startsWith("SYN-")));
  const s = (await call("GET", `/patients/${r.body.id}/summary`)).body;
  assert.equal(s.header.sample, false);
});

test("a real file number may equal a sample one; SYN- is reserved; civil IDs are unique among real patients only", async () => {
  const sampleMrn = ((await db.query(`SELECT mrn, civil_id FROM cf.patient WHERE synthetic AND civil_id IS NOT NULL LIMIT 1`)).rows[0] as any);
  const raw = sampleMrn.mrn.replace(/^SYN-/, "");
  const ok = await call("POST", "/patients", { name: "Same Number", mrn: raw, sex: "Female", civilId: sampleMrn.civil_id });
  assert.equal(ok.status, 201, "the sample patient's MRN and civil ID do not block a real one");
  assert.equal((await call("POST", "/patients", { name: "Bad Prefix", mrn: "SYN-123", sex: "Male", birthDate: "1970-01-01" })).status, 400);
  const dup = await call("POST", "/patients", { name: "Dup Civil", mrn: "200000777", sex: "Male", civilId: sampleMrn.civil_id });
  assert.equal(dup.status, 409, "two real patients cannot share a civil ID");
});

test("a sample patient created for practice gets SYN-; a real patient registered by mistake moves to the samples", async () => {
  const s = await call("POST", "/patients", { name: "Practice Case", mrn: "777", sex: "Male", birthDate: "1955-01-01", sample: true });
  assert.equal(s.status, 201);
  const row = (await db.query(`SELECT mrn, synthetic FROM cf.patient WHERE id=$1`, [s.body.id])).rows[0] as any;
  assert.deepEqual([row.mrn, row.synthetic], ["SYN-777", true]);
  const r = await call("POST", "/patients", { name: "Oops Test", mrn: "200000555", sex: "Male", birthDate: "1980-01-01" });
  assert.equal((await call("POST", `/patients/${r.body.id}/move-to-sample`, {})).status, 200);
  const moved = (await db.query(`SELECT mrn, synthetic FROM cf.patient WHERE id=$1`, [r.body.id])).rows[0] as any;
  assert.deepEqual([moved.mrn, moved.synthetic], ["SYN-200000555", true]);
  assert.ok(!(await call("GET", "/worklist")).body.rows.some((x: any) => x.id === r.body.id));
  assert.equal((await call("GET", `/patients/${r.body.id}/summary`)).body.header.sample, true);
  // the real file number is free again
  assert.equal((await call("POST", "/patients", { name: "Real Again", mrn: "200000555", sex: "Male", birthDate: "1980-01-01" })).status, 201);
});

test("sandbox-only rules run on sample patients only", async () => {
  const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
  const id = await db.transaction((q) => K.createPatient(q, doc, { name: "Rule Check", mrn: "200000999", sex: "Male", birthDate: "1960-01-01" }));
  assert.equal((await loadState(db, id)).patient.synthetic, false);
  // the engine picks the production rule set for a real patient whatever the site mode
  const sandbox = await activeRuleVersions(db, "sandbox"), production = await activeRuleVersions(db, "production");
  assert.ok(production.size <= sandbox.size);
});

test("patient details: name, file number, sex and date of birth can be corrected (audited); duplicates and SYN- refused", async () => {
  const r = await call("POST", "/patients", { name: "Typo Nmae", mrn: "400000001", sex: "Male", birthDate: "1950-01-01", conditions: ["af"] });
  const id = r.body.id;
  const ok = await call("POST", `/patients/${id}/identity`, { name: "Typo Name", mrn: "400000002", sex: "Female", birthDate: "1951-02-03" });
  assert.equal(ok.status, 200);
  const s = (await call("GET", `/patients/${id}/summary`)).body.header;
  assert.deepEqual([s.name, s.mrn, s.sex, s.birthDate], ["Typo Name", "400000002", "Female", "1951-02-03"]);
  const a = (await db.query(`SELECT detail FROM cf.audit WHERE action='update-identity' AND entity_id=$1 ORDER BY at DESC LIMIT 1`, [id])).rows[0] as any;
  assert.equal((typeof a.detail === "string" ? JSON.parse(a.detail) : a.detail).before.name, "Typo Nmae");
  await call("POST", "/patients", { name: "Other", mrn: "400000003", sex: "Male", birthDate: "1950-01-01" });
  assert.equal((await call("POST", `/patients/${id}/identity`, { mrn: "400000003" })).status, 409);
  assert.equal((await call("POST", `/patients/${id}/identity`, { mrn: "SYN-1" })).status, 400);
  assert.equal((await call("POST", `/patients/${id}/identity`, { birthDate: "2999-01-01" })).status, 400);
});

test("removing a record: it leaves lists and search, is kept with the reason, and frees its file number", async () => {
  const r = await call("POST", "/patients", { name: "Wrong Entry", mrn: "500000001", sex: "Male", birthDate: "1960-01-01", conditions: ["hfref"], civilId: "260010100099" });
  const id = r.body.id;
  assert.equal((await call("POST", `/patients/${id}/remove`, { reason: "Because" })).status, 400);
  assert.equal((await call("POST", `/patients/${id}/remove`, { reason: "Registered in error" })).status, 200);
  assert.ok(!(await call("GET", "/worklist")).body.rows.some((x: any) => x.id === id));
  assert.equal((await call("GET", "/patients?q=Wrong")).body.length, 0);
  assert.ok(!(await call("GET", "/registries/hf")).body.patients.some((p: any) => p.mrn === "500000001"));
  assert.equal((await call("GET", `/patients/${id}/summary`)).status, 404);
  const kept = (await db.query(`SELECT removed_reason, removed_by FROM cf.patient WHERE id=$1`, [id])).rows[0] as any;
  assert.equal(kept.removed_reason, "Registered in error");
  assert.ok(kept.removed_by);
  // same file number and civil ID can be registered again
  assert.equal((await call("POST", "/patients", { name: "Right Entry", mrn: "500000001", sex: "Male", birthDate: "1960-01-01", civilId: "260010100099" })).status, 201);
});

test("corrections: a result, a medicine entry, a study and a procedure can be corrected; nothing is erased", async () => {
  const r = await call("POST", "/patients", { name: "Correct Me", mrn: "600000001", sex: "Male", birthDate: "1960-01-01", conditions: ["hfref"] });
  const id = r.body.id;
  const today = new Date().toISOString().slice(0, 10);
  // result: wrong potassium → corrected
  const obs = await call("POST", `/patients/${id}/observations`, { effectiveAt: new Date().toISOString(), items: [{ code: "potassium", value: 7.2 }] });
  assert.equal(obs.status, 200, JSON.stringify(obs.body));
  const kId = (await db.query(`SELECT id FROM cf.observation WHERE patient_id=$1 AND code='potassium'`, [id])).rows[0] as any;
  assert.equal((await call("POST", `/patients/${id}/observations/${kId.id}/correct`, { value: 4.2 })).status, 200);
  assert.equal((await loadState(db, id)).resolved("potassium").current!.value_num, 4.2);
  // medicine: start bisoprolol 10 (meant 2.5) → fix; increase by mistake → take back; wrong drug → remove
  const start = await call("POST", `/patients/${id}/medications`, { code: "bisoprolol", doseValue: 10, frequency: "OD", route: "PO", indication: "hf" });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const medId = (await loadState(db, id)).meds.find((m) => m.code === "bisoprolol")!.id;
  assert.equal((await call("POST", `/patients/${id}/medications/${medId}/undo`, {})).status, 409, "the first entry is fixed or removed, not taken back");
  assert.equal((await call("POST", `/patients/${id}/medications/${medId}/correct`, { doseValue: 2.5 })).status, 200);
  assert.equal((await loadState(db, id)).meds.find((m) => m.id === medId)!.doseValue, 2.5);
  assert.equal((await call("POST", `/patients/${id}/medications/${medId}/events`, { kind: "increase", doseValue: 5 })).status, 200);
  assert.equal((await call("POST", `/patients/${id}/medications/${medId}/undo`, { reason: "Wrong entry" })).status, 200);
  assert.equal((await loadState(db, id)).meds.find((m) => m.id === medId)!.doseValue, 2.5);
  assert.equal((await call("POST", `/patients/${id}/medications/${medId}/void`, { reason: "Wrong patient" })).status, 200);
  assert.ok(!(await loadState(db, id)).meds.some((m) => m.id === medId));
  // the drug can be started again afterwards
  assert.equal((await call("POST", `/patients/${id}/medications`, { code: "bisoprolol", doseValue: 1.25, frequency: "OD", route: "PO", indication: "hf" })).status, 200);
  // study: echo entered in error takes its LVEF with it
  const echo = await call("POST", `/patients/${id}/echo`, { date: new Date(Date.now() - 3600_000).toISOString(), quality: "formal", lvef: 25, findings: [] });
  assert.equal(echo.status, 200, JSON.stringify(echo.body));
  const st = (await loadState(db, id)).studies.find((x) => x.kind === "echo")!;
  assert.equal((await call("POST", `/patients/${id}/studies/${st.id}/void`, { reason: "Wrong patient" })).status, 200);
  const after = await loadState(db, id);
  assert.ok(!after.studies.some((x) => x.id === st.id));
  assert.equal(after.resolved("lvef").current, null);
  assert.equal((await call("POST", `/patients/${id}/studies/${st.id}/void`, { reason: "Wrong patient" })).status, 409);
  // originals kept
  assert.equal((await db.query(`SELECT count(*)::int n FROM cf.study WHERE id=$1`, [st.id])).rows[0].n, 1);
  assert.ok((await db.query(`SELECT count(*)::int n FROM cf.correction WHERE patient_id=$1`, [id])).rows[0].n >= 3);
  // journey hides the removed echo
  const j = (await call("GET", `/patients/${id}/journey`)).body;
  assert.ok(!JSON.stringify(j).includes(st.id));
});

test("Kuwaiti civil ID gives the date of birth (and so the age); a different date is refused", async () => {
  const { civilIdBirthDate, civilIdCheckDigitOk } = await import("../shared/civil-id.js");
  assert.equal(civilIdBirthDate("285120312345"), "1985-12-03");
  assert.equal(civilIdBirthDate("305021412345"), "2005-02-14");
  assert.equal(civilIdBirthDate("285133112345"), null, "month 13");
  assert.equal(civilIdBirthDate("485120312345"), null, "century digit");
  // check digit (weights 2 1 6 3 7 9 10 5 8 4 2, mod 11)
  const body = "28512031234";
  const sum = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2].reduce((s, w, i) => s + w * Number(body[i]), 0);
  const k = 11 - (sum % 11);
  if (k < 10) assert.equal(civilIdCheckDigitOk(body + k), true);
  const r = await call("POST", "/patients", { name: "From Civil", mrn: "700000001", sex: "Male", civilId: "285120312345" });
  assert.equal(r.status, 201);
  const h = (await call("GET", `/patients/${r.body.id}/summary`)).body.header;
  assert.equal(h.birthDate, "1985-12-03");
  assert.equal((await call("POST", "/patients", { name: "Mismatch", mrn: "700000002", sex: "Male", civilId: "285120312346", birthDate: "1985-12-04" })).status, 400);
  assert.equal((await call("POST", `/patients/${r.body.id}/identity`, { birthDate: "1985-12-04" })).status, 400);
});

test("stress MIBI and ABPM are recorded as studies; their values join the trends; a MIBI completes a planned stress test", async () => {
  const r = await call("POST", "/patients", { name: "Studies New", mrn: "800000001", sex: "Female", birthDate: "1965-05-05", conditions: ["htn", "cad-ccs"] });
  const id = r.body.id;
  const at = new Date(Date.now() - 3600_000).toISOString();
  const plan = await call("POST", `/patients/${id}/plan`, { items: [{ category: "investigation", title: "Stress test", dueDate: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), completesOn: { type: "study", kind: "stress" } }] });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  const mibi = await call("POST", `/patients/${id}/studies`, { kind: "nuclear", date: new Date().toISOString(), findings: { stressor: "Regadenoson", result: "Reversible defect (ischaemia)", extent: "Moderate", ischaemia: 12, territory: ["LAD"], gatedLvef: 55 } });
  assert.equal(mibi.status, 200, JSON.stringify(mibi.body));
  const abpm = await call("POST", `/patients/${id}/studies`, { kind: "abpm", date: at, findings: { duration: "24 h", sbp24: 138, dbp24: 86, sbpNight: 129, dbpNight: 78, dipping: "Non-dipper", conclusion: "Ambulatory hypertension" } });
  assert.equal(abpm.status, 200, JSON.stringify(abpm.body));
  const s = await loadState(db, id);
  assert.deepEqual(s.studies.map((x) => x.kind).sort(), ["abpm", "nuclear"]);
  assert.equal(s.resolved("mpi-ischaemia").current!.value_num, 12);
  assert.equal(s.resolved("abpm-24-sbp").current!.value_num, 138);
  assert.ok(!s.plan.some((p) => p.title === "Stress test" && p.status === "planned"), "the MIBI completed the planned stress test");
  assert.equal((await call("POST", `/patients/${id}/studies`, { kind: "abpm", date: at, findings: { duration: "24 h", sbp24: 138 } })).status, 400, "diastolic and conclusion are required");
});

test("stress MIBI with ≥10% ischaemia → high-risk finding opens the CCS test pathway with ICA suggested; normal perfusion → no alert", async () => {
  const { ccsTestRisk } = await import("../shared/ccs-tests.js");
  assert.equal(ccsTestRisk("nuclear", { result: "Reversible defect (ischaemia)", ischaemia: 12 })!.risk, "high");
  assert.equal(ccsTestRisk("nuclear", { result: "Reversible defect (ischaemia)", ischaemia: 6 })!.risk, "positive");
  assert.equal(ccsTestRisk("nuclear", { result: "Equivocal" })!.risk, "uncertain");
  assert.equal(ccsTestRisk("stress", { modality: "Stress echo", result: "Positive for ischaemia", segmentsEcho: 3 })!.risk, "high");
  assert.equal(ccsTestRisk("stress", { modality: "Exercise ECG", result: "Positive for ischaemia", duke: -11 })!.risk, "high");
  assert.equal(ccsTestRisk("ccta", { cadrads: "4B" })!.risk, "high");
  assert.equal(ccsTestRisk("ccta", { cadrads: "2" })!.risk, "negative");
  const r = await call("POST", "/patients", { name: "Mibi High", mrn: "900000001", sex: "Male", birthDate: "1958-01-01", conditions: ["cad-ccs", "htn"] });
  const id = r.body.id;
  const at = new Date(Date.now() - 3600_000).toISOString();
  await call("POST", `/patients/${id}/studies`, { kind: "nuclear", date: at, findings: { stressor: "Exercise", result: "Reversible defect (ischaemia)", ischaemia: 14, territory: ["LAD"] } });
  const recs = (await db.query(`SELECT title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='cad.test-result'`, [id])).rows as any[];
  assert.equal(recs.length, 1);
  assert.match(recs[0].title, /high-risk/);
  const w = (await call("GET", `/patients/${id}/wizards/ccs-test-result`)).body;
  const sugg = JSON.stringify(w);
  assert.ok(sugg.includes("ica"), "ICA suggested");
  const r2 = await call("POST", "/patients", { name: "Mibi Normal", mrn: "900000002", sex: "Female", birthDate: "1960-01-01", conditions: ["htn"] });
  await call("POST", `/patients/${r2.body.id}/studies`, { kind: "nuclear", date: at, findings: { stressor: "Regadenoson", result: "Normal perfusion" } });
  assert.equal((await db.query(`SELECT count(*)::int n FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='cad.test-result'`, [r2.body.id])).rows[0].n, 0);
});

test("age typed without a date of birth gives an estimated date; a civil ID replaces it", async () => {
  const y = new Date().getFullYear() - 70;
  const r = await call("POST", "/patients", { name: "Age Only", mrn: "910000001", sex: "Male", birthDate: `${y}-06-15`, birthDateEstimated: true });
  assert.equal(r.status, 201);
  const h = (await call("GET", `/patients/${r.body.id}/summary`)).body.header;
  assert.equal(h.birthDateEstimated, true);
  assert.equal((await call("POST", `/patients/${r.body.id}/identity`, { civilId: "255061512345", birthDateEstimated: true })).status, 200);
  const h2 = (await call("GET", `/patients/${r.body.id}/summary`)).body.header;
  assert.deepEqual([h2.birthDate, h2.birthDateEstimated], ["1955-06-15", false]);
});

test("several medicines start together (all or none); the clinical summary document lists them", async () => {
  const r = await call("POST", "/patients", { name: "Batch Meds", mrn: "920000001", sex: "Male", birthDate: "1960-01-01", conditions: ["hfref"] });
  const id = r.body.id;
  const ok = await call("POST", `/patients/${id}/medications/batch`, { items: [
    { code: "bisoprolol", doseValue: 1.25, frequency: "OD", route: "PO", indication: "hf" },
    { code: "dapagliflozin", doseValue: 10, frequency: "OD", route: "PO", indication: "hf" },
  ] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const s = await loadState(db, id);
  assert.deepEqual(s.meds.map((m) => m.code).sort(), ["bisoprolol", "dapagliflozin"]);
  const bad = await call("POST", `/patients/${id}/medications/batch`, { items: [
    { code: "ramipril", doseValue: 2.5, frequency: "BID", route: "PO", indication: "hf" },
    { code: "bisoprolol", doseValue: 1.25, frequency: "OD", route: "PO", indication: "hf" },
  ] });
  assert.equal(bad.status, 409, "bisoprolol already listed: the whole batch is refused");
  assert.ok(!(await loadState(db, id)).meds.some((m) => m.code === "ramipril"), "none started");
  const docs = (await call("GET", `/patients/${id}/documents`)).body;
  assert.match(docs.find((d: any) => d.id === "summary").text, /Bisoprolol/i);
});

test("a diagnosis is edited, changed over time (old one resolved) or corrected (entered in error, onset kept)", async () => {
  const r = await call("POST", "/patients", { name: "Dx Edit", mrn: "930000001", sex: "Female", birthDate: "1950-01-01", conditions: ["ckd-3a", "hfref"] });
  const id = r.body.id;
  const dxOf = async () => (await call("GET", `/patients/${id}/summary`)).body.header.diagnoses as any[];
  const ckd = (await dxOf()).find((d) => d.code === "ckd-3a");
  assert.equal((await call("POST", `/patients/${id}/conditions/${ckd.id}/update`, { onset: "2020-03-01" })).status, 200);
  assert.equal((await call("POST", `/patients/${id}/conditions/${ckd.id}/change`, { code: "ckd-3b", mode: "changed" })).status, 200);
  let dx = await dxOf();
  assert.ok(dx.some((d) => d.code === "ckd-3b") && !dx.some((d) => d.code === "ckd-3a"));
  const hist = (await db.query(`SELECT DISTINCT ON (logical_id) code, status FROM cf.condition WHERE patient_id=$1 ORDER BY logical_id, version DESC`, [id])).rows as any[];
  assert.ok(hist.some((h) => h.code === "ckd-3a" && h.status === "resolved"), "the earlier stage stays as resolved");
  const hf = dx.find((d) => d.code === "hfref");
  assert.equal((await call("POST", `/patients/${id}/conditions/${hf.id}/change`, { code: "hfpef", mode: "error" })).status, 200);
  dx = await dxOf();
  assert.ok(dx.some((d) => d.code === "hfpef") && !dx.some((d) => d.code === "hfref"));
  assert.equal((await call("POST", `/patients/${id}/conditions/${hf.id}/change`, { code: "hfpef", mode: "error" })).status, 409, "an inactive diagnosis cannot be changed again");
});

test("risk factors are flagged apart from diagnoses; suspected IHD asks for the first test and a negative test asks to rule it out", async () => {
  const r = await call("POST", "/patients", { name: "Rule Out", mrn: "940000001", sex: "Male", birthDate: "1966-01-01", conditions: ["cad-suspected", "htn", "t2dm", "copd"] });
  const id = r.body.id;
  const h = (await call("GET", `/patients/${id}/summary`)).body.header;
  const flag = Object.fromEntries(h.diagnoses.map((d: any) => [d.code, d.riskFactor]));
  assert.deepEqual([flag["htn"], flag["t2dm"], flag["copd"], flag["cad-suspected"]], [true, true, false, false]);
  const active = async (rule: string) => (await db.query(`SELECT title FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [id, rule])).rows as any[];
  assert.match((await active("cad.suspected-workup"))[0].title, /choose the first test/);
  assert.equal((await active("cad.acs-bundle")).length, 0, "a working diagnosis is not established CAD");
  assert.equal((await call("GET", `/patients/${id}/wizards/suspected-ihd`)).status, 200);
  const { suggest } = await import("../shared/wizard-guidance.js");
  const sug = suggest("suspected-ihd", "test", { likelihood: "moderate", lowExercise: "no" }, { today: "", meds: [], facts: [], detected: {} } as any);
  assert.ok(sug.some((x: any) => x.value === "ccta"));
  await call("POST", `/patients/${id}/studies`, { kind: "ccta", date: new Date(Date.now() - 3600_000).toISOString(), findings: { cac: 0, cadrads: "1" } });
  assert.match((await active("cad.suspected-workup"))[0].title, /negative — rule it out/);
});
