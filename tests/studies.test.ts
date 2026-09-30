// General-clinic core, slice 2: investigations hub and the rules that read study results.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { cleanStudy, obstructiveCad, studySummary } from "../shared/studies.js";
import { crtClass } from "../server/engine/study-rules.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const iso = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[] = []) =>
  tx((q) => K.createPatient(q, doc, { name: "St " + rnd(), mrn: "S" + rnd() + Date.now(), sex: "Male", birthDate: "1958-01-10", conditions }));
const active = async (pid: string) =>
  (await db.query(`SELECT rule_id, severity, title, detail, action, missing FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows.map((r: any) => ({
    ...r, action: typeof r.action === "string" ? JSON.parse(r.action) : r.action, missing: typeof r.missing === "string" ? JSON.parse(r.missing) : r.missing,
  }));
const ecg = (pid: string, findings: Record<string, unknown>, day?: string) =>
  tx(async (q) => {
    const r = await K.recordStudy(q, doc, pid, { kind: "ecg", date: day ? iso(day) : nowIso(), findings });
    await reassess(q, pid, "sandbox", r.changed);
    return r;
  });

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("templates: required fields, list-only values, conditional fields dropped, one-line summary", () => {
  assert.throws(() => cleanStudy("ecg", { rhythm: "Sinus rhythm", qrsMorphology: "Normal" }), /QRS duration is required/);
  assert.throws(() => cleanStudy("ecg", { rhythm: "Sinus-ish", qrs: 100, qrsMorphology: "Normal" }), /choose from the list/);
  assert.throws(() => cleanStudy("ecg", { rhythm: "Sinus rhythm", qrs: 1000, qrsMorphology: "Normal" }), /40–300/);
  assert.throws(() => cleanStudy("ecg", { rhythm: "Sinus rhythm", qrs: 100, qrsMorphology: "Normal", mood: "happy" }), /Unknown field/);
  // PR only applies in sinus rhythm; it is dropped in AF
  const af = cleanStudy("ecg", { rhythm: "Atrial fibrillation", qrs: 96, qrsMorphology: "Normal", pr: 180 });
  assert.equal(af.pr, undefined);
  assert.equal(studySummary("ecg", { rhythm: "Sinus rhythm", rate: 72, qrs: 156, qrsMorphology: "LBBB", qtc: 470 }), "Sinus rhythm · 72 bpm · QRS 156 ms LBBB · 470 ms QTc");
  assert.equal(obstructiveCad("cath", { lm: "None", lad: "70–99%", lcx: "<50%", rca: "Occluded" }), "2-vessel disease (LAD, RCA)");
  assert.equal(obstructiveCad("cath", { lm: "50–69%", lad: "None", lcx: "None", rca: "None" }), "Left main disease (LM)");
  assert.equal(obstructiveCad("ccta", { cadrads: "2" }), null);
  assert.deepEqual(
    [crtClass(156, "LBBB", { qrs_long: 150, qrs_min: 130 }).cls, crtClass(140, "LBBB", { qrs_long: 150, qrs_min: 130 }).cls, crtClass(160, "RBBB", { qrs_long: 150, qrs_min: 130 }).cls, crtClass(135, "Non-specific IVCD", { qrs_long: 150, qrs_min: 130 }).cls, crtClass(110, "Normal", { qrs_long: 150, qrs_min: 130 }).cls],
    ["I", "IIa", "IIa", "IIb", "none"],
  );
});

test("an ECG becomes a dated study, observations the rules read, a journey event, and closes the planned ECG", async () => {
  const pid = await newPatient(["htn"]);
  await tx((q) => K.addPlanAction(q, doc, pid, { category: "investigation", title: "12-lead ECG", dueDate: addDays(T, 2), completesOn: { type: "study", kind: "ecg" } }));
  const r = await ecg(pid, { rhythm: "Sinus rhythm", rate: 64, pr: 180, qrs: 98, qrsMorphology: "Normal", qtc: 440 });
  assert.equal(r.completed.length, 1);
  const s = await loadState(db, pid);
  assert.equal(s.resolved("qrs").current?.value_num, 98);
  assert.equal(s.resolved("hr").current?.source, "ECG");
  assert.equal(s.studies[0].attributes.qrsMorphology, "Normal");
  const ev = (await db.query(`SELECT title FROM cf.clinical_event WHERE patient_id=$1 AND kind='ecg'`, [pid])).rows[0] as any;
  assert.match(ev.title, /^ECG · Sinus rhythm · 64 bpm/);
  await assert.rejects(tx((q) => K.recordStudy(q, doc, pid, { kind: "ecg", date: iso(addDays(T, 3)), findings: { rhythm: "Sinus rhythm", qrs: 90, qrsMorphology: "Normal" } })), /future/);
});

test("device rule: asks for an ECG, then grades CRT by QRS width and morphology", async () => {
  const pid = await newPatient(["hfref"]);
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: nowIso(), quality: "formal", lvef: 28, findings: [] });
    await reassess(q, pid, "sandbox");
  });
  let dev = (await active(pid)).find((r) => r.rule_id === "hf.device-assessment");
  assert.match(dev.missing[0], /ECG within 12 months/);
  assert.equal(dev.action.template, "ecg");
  await ecg(pid, { rhythm: "Sinus rhythm", qrs: 156, qrsMorphology: "LBBB" });
  dev = (await active(pid)).find((r) => r.rule_id === "hf.device-assessment");
  assert.match(dev.title, /QRS 156 ms LBBB: CRT \(class I\) and ICD assessment/);
  assert.match(dev.detail, /alongside foundational therapy \(IIb\)/);
  assert.deepEqual(dev.missing, []);
  await ecg(pid, { rhythm: "Sinus rhythm", qrs: 118, qrsMorphology: "Normal" });
  dev = (await active(pid)).find((r) => r.rule_id === "hf.device-assessment");
  assert.match(dev.title, /: ICD assessment/);
  assert.match(dev.detail, /QRS <130 ms: CRT not indicated/);
});

test("ivabradine in AF, QTc on a QT-prolonging drug, and CRT rather than RV pacing", async () => {
  const pid = await newPatient(["hfref", "htn"]);
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: nowIso(), quality: "formal", lvef: 32, findings: [] });
    await K.startMedication(q, doc, pid, { code: "ivabradine", doseValue: 5, frequency: "BID", route: "PO", indication: "hf", effectiveAt: iso(addDays(T, -60)) });
    await K.startMedication(q, doc, pid, { code: "amiodarone", doseValue: 200, frequency: "OD", route: "PO", indication: "af", effectiveAt: iso(addDays(T, -60)) });
  });
  await ecg(pid, { rhythm: "Sinus rhythm", qrs: 110, qrsMorphology: "Normal", qtc: 450 }, addDays(T, -20));
  await ecg(pid, { rhythm: "Atrial fibrillation", qrs: 112, qrsMorphology: "Normal", qtc: 520 });
  const recs = await active(pid);
  const iva = recs.find((r) => r.rule_id === "rhythm.ivabradine-sinus");
  assert.equal(iva.severity, "orange");
  assert.equal(iva.action.type, "med-action");
  assert.equal(iva.action.action, "stop");
  const qt = recs.find((r) => r.rule_id === "rhythm.qtc-drug");
  assert.equal(qt.severity, "red");
  assert.match(qt.title, /QTc 520 ms \(\+70 ms\) on amiodarone/);
  assert.ok(qt.missing.includes("Magnesium"));
  // AF on the ECG while not on the problem list
  assert.ok(recs.some((r) => r.rule_id === "studies.problem-list" && /AF\/flutter on ECG/.test(r.title)));

  const p2 = await newPatient(["hfref"]);
  await tx(async (q) => {
    await K.recordEcho(q, doc, p2, { date: nowIso(), quality: "formal", lvef: 36, findings: [] });
  });
  await ecg(p2, { rhythm: "Sinus rhythm", qrs: 120, qrsMorphology: "Normal", avBlock: "Complete" });
  const pm = (await active(p2)).find((r) => r.rule_id === "device.pacing-mode");
  assert.match(pm.title, /Complete AV block with LVEF 36%: if pacing, CRT rather than RV pacing/);
});

test("obstructive disease at angiography prompts adding coronary disease; the API validates studies", async () => {
  const pid = await newPatient(["htn"]);
  await tx(async (q) => {
    const r = await K.recordStudy(q, doc, pid, { kind: "cath", date: iso(addDays(T, -2)), findings: { lm: "None", lad: "70–99%", lcx: "None", rca: "None", outcome: "PCI performed" } });
    await reassess(q, pid, "sandbox", r.changed);
  });
  const cad = (await active(pid)).find((r) => r.rule_id === "studies.problem-list");
  assert.match(cad.title, /1-vessel disease \(LAD\) on Cath/);
  assert.equal(cad.action.type, "history");
  await tx(async (q) => {
    await K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "cad-ccs" }, { code: "prior-pci", attributes: { vessels: ["LAD"] } }] });
    await reassess(q, pid, "sandbox", ["conditions"]);
  });
  assert.equal((await active(pid)).some((r) => r.rule_id === "studies.problem-list"), false);

  const app = createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const login = await fetch(base + "/demo-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const { csrf } = await login.json();
    const post = (body: unknown) => fetch(`${base}/patients/${pid}/studies`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
    assert.equal((await post({ kind: "xray", date: nowIso(), findings: {} })).status, 400);
    const bad = await post({ kind: "holter", date: nowIso(), findings: { duration: "24 h" } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Underlying rhythm is required/);
    const ok = await post({ kind: "holter", date: nowIso(), findings: { duration: "48 h", rhythm: "Sinus rhythm", veBurden: 12.5, nsvt: "Yes" } });
    assert.equal(ok.status, 200);
    const rec = await (await fetch(`${base}/patients/${pid}/record`, { headers: { cookie } })).json();
    assert.ok(rec.studies.some((s: any) => s.kind === "holter" && /VE 12.5%/.test(s.findings[0])));
  } finally {
    server.close();
  }
});
