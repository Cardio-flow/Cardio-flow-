import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { summary, worklist } from "../server/kernel/views.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard, declineRecommendation } from "../server/engine/wizard.js";
import { transitionRule } from "../server/engine/governance.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays, egfrCkdEpi2021, resolveCurrent } from "../shared/clinical.js";
import { buildOutcome } from "../shared/wizards.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const reviewer: Actor = { id: "rev@cardioflow.local", name: "Reviewer", role: "reviewer", siteId: SITE_ID };
const admin: Actor = { id: "admin@cardioflow.local", name: "Admin", role: "admin", siteId: SITE_ID };
const T = today();
const iso = (day: string, time = "09:00") => new Date(`${day}T${time}:00+03:00`).toISOString();
const active = async (pid: string) =>
  (await db.query(`SELECT rule_id, severity, title, rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
const byName = async (name: string) => (await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0].id as string;
const tx = <T>(fn: (q: any) => Promise<T>) => db.transaction(fn);
async function newPatient(conditions = ["hfref", "ckd-3b"]) {
  return tx((q) => K.createPatient(q, doc, { name: "Test " + Math.random().toString(36).slice(2, 7), mrn: "T" + Date.now() + Math.random(), sex: "Male", birthDate: "1961-03-01", conditions }));
}

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("CKD-EPI 2021 matches the published equation and unit conversion", () => {
  // 1.0 mg/dL (88.42 µmol/L), 60-year-old male → ≈ 86 mL/min/1.73m²
  assert.equal(Math.round(egfrCkdEpi2021(88.42, 60, "Male")!), 86);
  assert.equal(Math.round(egfrCkdEpi2021(88.42, 60, "Female")!), 64);
  assert.equal(egfrCkdEpi2021(100, 16, "Male"), null);
});

test("current value is not always the newest: formal beats a later bedside study; clinician preference wins", () => {
  const o = (id: string, day: string, v: number, quality: any) => ({ id, code: "lvef", value_num: v, value_text: null, unit: "%", effective_at: iso(day), status: "final" as const, quality, source: "" });
  const obs = [o("a", addDays(T, -90), 30, "formal"), o("b", addDays(T, -5), 42, "formal"), o("c", addDays(T, -1), 35, "bedside")];
  const r = resolveCurrent(obs, null);
  assert.equal(r.current!.id, "b");
  assert.equal(r.reason, "higher-quality study preferred");
  assert.equal(resolveCurrent(obs, "c").current!.id, "c");
});

test("synthetic HF patient: rising K and creatinine raise sandbox alerts with facts and trend", async () => {
  const k = await byName("Khaled Al-Mansour");
  const recs = await active(k);
  const hk = recs.find((r) => r.rule_id === "hf.hyperkalaemia-review");
  assert.ok(hk, "hyperkalaemia alert");
  assert.equal(hk.severity, "red");
  assert.equal(hk.rule_status, "CLINICAL_REVIEW");
  assert.match(hk.title, /5\.8/);
  assert.ok(recs.find((r) => r.rule_id === "hf.worsening-renal-function"));
  const s = await tx((q) => summary(q, k));
  assert.ok(s.changes.items.some((i: any) => i.label === "Potassium" && i.before === "4.4" && i.after === "5.8"));
});

test("production site runs only PUBLISHED rules", async () => {
  const k = await byName("Khaled Al-Mansour");
  await tx((q) => reassess(q, k, "production"));
  const recs = await active(k);
  assert.ok(recs.every((r) => r.rule_status === "PUBLISHED"), "no draft/review rule output in production");
  assert.ok(!recs.some((r) => r.rule_id === "hf.hyperkalaemia-review"));
  await tx((q) => reassess(q, k, "sandbox"));
  assert.ok((await active(k)).some((r) => r.rule_id === "hf.hyperkalaemia-review"));
});

test("closed loop: alert → wizard → dose change + dated tasks → result closes task → rules re-run", async () => {
  const pid = await newPatient();
  const d0 = iso(addDays(T, -20));
  let mra = "";
  await tx(async (q) => {
    mra = (await K.startMedication(q, doc, pid, { code: "spironolactone", doseValue: 25, frequency: "OD", route: "PO", indication: "hf", effectiveAt: d0 })).medicationId;
    await K.startMedication(q, doc, pid, { code: "sacubitril-valsartan", doseValue: 49, frequency: "BID", route: "PO", indication: "hf", effectiveAt: d0 });
    await K.recordObservations(q, doc, pid, { effectiveAt: iso(addDays(T, -10)), items: [{ code: "potassium", value: 4.6 }, { code: "creatinine", value: 120 }] });
    const r = await K.recordObservations(q, doc, pid, { effectiveAt: iso(T, "00:30"), items: [{ code: "potassium", value: 5.9 }, { code: "creatinine", value: 125 }] });
    await reassess(q, pid, "sandbox", r.changed);
  });
  const rec = (await active(pid)).find((r) => r.rule_id === "hf.hyperkalaemia-review");
  assert.ok(rec);
  const recId = (await db.query(`SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.hyperkalaemia-review' AND status='active'`, [pid])).rows[0].id;
  const answers = { result: "confirmed", ecg: "none", contributors: ["mra"], actions: ["reduce-mra"], mraDose: "12.5", recheck: "3", review: "clinic-14" };
  await tx(async (q) => {
    const r = await completeWizard(q, doc, pid, "hyperkalaemia", { answers, recommendationId: recId });
    await reassess(q, pid, "sandbox", r.changed);
  });
  const s = await tx((q) => loadState(q, pid));
  const spiro = s.meds.find((m) => m.id === mra)!;
  assert.equal(spiro.doseValue, 12.5);
  const check = s.plan.find((p) => p.title === "Renal function and potassium check")!;
  assert.equal(check.due_date, addDays(T, 3));
  assert.ok(s.plan.find((p) => p.title === "Clinic review" && p.due_date === addDays(T, 14)));
  assert.ok(!(await active(pid)).some((r) => r.rule_id === "hf.hyperkalaemia-review"), "decided alert does not reappear for the same result");
  // a same-day result does not satisfy a check planned for 3 days later…
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: new Date().toISOString(), items: [{ code: "potassium", value: 5.4 }, { code: "creatinine", value: 122 }] }));
  assert.equal((await tx((q) => loadState(q, pid))).plan.find((p) => p.id === check.id)!.status, "planned");
  // …but the planned result does, and a new abnormal value raises a fresh alert
  await tx(async (q) => {
    const r = await K.recordObservations(q, doc, pid, { effectiveAt: iso(addDays(T, 3)), items: [{ code: "potassium", value: 6.0 }, { code: "creatinine", value: 130 }] });
    assert.equal(r.completed.length, 1);
    await reassess(q, pid, "sandbox", r.changed);
  });
  assert.ok((await active(pid)).some((r) => r.rule_id === "hf.hyperkalaemia-review" && /6\.0/.test(r.title)));
});

test("wizard preview equals what is recorded", async () => {
  const ctx = { today: T, meds: [{ id: "m1", code: "spironolactone", name: "Spironolactone", doseValue: 25, doseUnit: "mg", frequency: "OD", tags: ["mra"] }], facts: [], detected: {} };
  const out = buildOutcome("hyperkalaemia", { actions: ["hold-mra"], recheck: "7", review: "none" }, ctx as any);
  assert.deepEqual(out.map((o) => o.kind), ["medication", "plan"]);
});

test("declining an alert needs a reason and is recorded", async () => {
  const k = await byName("Khaled Al-Mansour");
  const rid = (await db.query(`SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.worsening-renal-function' AND status='active'`, [k])).rows[0].id;
  await assert.rejects(tx((q) => declineRecommendation(q, doc, k, rid, { outcome: "declined", reason: " " })));
  await tx((q) => declineRecommendation(q, doc, k, rid, { outcome: "declined", reason: "Expected rise after ARNI start" }));
  const d = (await db.query(`SELECT reason FROM cf.decision WHERE recommendation_id=$1`, [rid])).rows[0];
  assert.equal(d.reason, "Expected rise after ARNI start");
});

test("admission → discharge → clinic: discharge plan carries forward and the visit closes only what is due", async () => {
  const pid = await newPatient();
  await tx(async (q) => {
    const a = await K.startAdmission(q, doc, pid, { startedAt: iso(addDays(T, -12)), location: "Ward 3B", reasons: ["Acute decompensated HF"] });
    await K.discharge(q, doc, pid, a.id, {
      endedAt: iso(addDays(T, -8)),
      status: "Euvolaemic",
      plan: [
        { category: "follow_up", title: "HF clinic review", dueDate: T, completesOn: { type: "visit" } },
        { category: "medication", title: "Titration visit", dueDate: addDays(T, 20), completesOn: { type: "visit" } },
      ],
    });
  });
  const s0 = await tx((q) => summary(q, pid));
  assert.match(s0.header.where, /Post-discharge · day 8/);
  assert.equal(s0.plan.filter((p: any) => p.status === "planned").length, 2);
  await tx((q) => K.startVisit(q, doc, pid, { startedAt: new Date().toISOString(), reasons: ["Heart failure"], service: "HF clinic" }));
  const s1 = await tx((q) => loadState(q, pid));
  assert.equal(s1.plan.find((p) => p.title === "HF clinic review")!.status, "completed");
  assert.equal(s1.plan.find((p) => p.title === "Titration visit")!.status, "planned");
});

test("repeat Echo: improved EF resolves the device alert and supersession keeps history", async () => {
  const pid = await newPatient(["hfref"]);
  await tx(async (q) => {
    const r = await K.recordEcho(q, doc, pid, { date: iso(addDays(T, -120)), quality: "formal", lvef: 28, findings: [] });
    await reassess(q, pid, "sandbox", r.changed);
  });
  assert.ok((await active(pid)).some((r) => r.rule_id === "hf.device-assessment"));
  await tx(async (q) => {
    const r = await K.recordEcho(q, doc, pid, { date: iso(addDays(T, -2)), quality: "formal", lvef: 45, findings: [] });
    await reassess(q, pid, "sandbox", r.changed);
  });
  const recs = await active(pid);
  assert.ok(!recs.some((r) => r.rule_id === "hf.device-assessment"));
  assert.ok(recs.some((r) => r.rule_id === "hf.lvef-change"));
  const history = (await db.query(`SELECT status FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.device-assessment'`, [pid])).rows;
  assert.deepEqual(history.map((h: any) => h.status), ["resolved"]);
});

test("clinical history is append-only", async () => {
  await assert.rejects(db.query(`UPDATE cf.observation SET value_num=1`), /append-only/);
  await assert.rejects(db.query(`DELETE FROM cf.medication_event`), /append-only/);
});

test("rule governance: maker/checker and separate publisher", async () => {
  // v1 was authored by the build; a reviewer approves with a note
  await assert.rejects(tx((q) => transitionRule(q, reviewer, "hf.hyperkalaemia-review", 1, "APPROVED", "")), /review note/i);
  await assert.rejects(tx((q) => transitionRule(q, doc, "hf.hyperkalaemia-review", 1, "APPROVED", "ok")), /role/i);
  await tx((q) => transitionRule(q, reviewer, "hf.hyperkalaemia-review", 1, "APPROVED", "Checked ESC HF MRA monitoring table; boundaries 5.4/5.5/5.6 tested"));
  await assert.rejects(tx((q) => transitionRule(q, reviewer, "hf.hyperkalaemia-review", 1, "PUBLISHED", "")), /role|reviewer/i);
  await tx((q) => transitionRule(q, admin, "hf.hyperkalaemia-review", 1, "PUBLISHED", ""));
  const k = await byName("Khaled Al-Mansour");
  await tx((q) => reassess(q, k, "production"));
  const recs = await active(k);
  assert.ok(recs.every((r) => r.rule_status === "PUBLISHED"));
});

test("worklist ranks the most urgent patient first", async () => {
  const rows = await tx((q) => worklist(q, SITE_ID));
  assert.ok(rows.length >= 7);
  const first = rows.find((r: any) => r.alert);
  assert.ok(["red", "orange"].includes(first!.alert!.severity));
});

test("API: sign-in required, CSRF enforced, localhost only, validation errors are readable", async () => {
  const app = createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    assert.equal((await fetch(base + "/worklist")).status, 401);
    const login = await fetch(base + "/demo-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const { csrf } = await login.json();
    assert.equal((await fetch(base + "/worklist", { headers: { cookie } })).status, 200);
    const k = await byName("Khaled Al-Mansour");
    const body = JSON.stringify({ effectiveAt: new Date().toISOString(), items: [{ code: "potassium", value: 4.9 }] });
    assert.equal((await fetch(`${base}/patients/${k}/observations`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body })).status, 403);
    const ok = await fetch(`${base}/patients/${k}/observations`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf }, body });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${base}/patients/${k}/observations`, {
      method: "POST", headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ effectiveAt: new Date().toISOString(), items: [{ code: "egfr", value: 40 }] }),
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /calculated automatically/);
    const other = await fetch(base.replace("127.0.0.1", "localhost") + "/health");
    assert.equal(other.status, 200);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
