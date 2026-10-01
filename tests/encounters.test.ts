// General-clinic core, slice 3: admission, discharge, vital and follow-up status.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { draftNote } from "../server/kernel/notes.js";
import { worklist } from "../server/kernel/views.js";
import { reassess } from "../server/engine/engine.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string, time = "10:00") => new Date(`${day}T${time}:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions = ["hfref"]) => tx((q) => K.createPatient(q, doc, { name: "Enc " + rnd(), mrn: "E" + rnd() + Date.now(), sex: "Male", birthDate: "1955-06-01", conditions }));
const active = async (pid: string) => (await db.query(`SELECT rule_id, severity, title, detail FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
const re = (pid: string) => tx((q) => reassess(q, pid, "sandbox"));

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("readmission: interval band, HF readmission flag, and the 30-day rule", async () => {
  const pid = await newPatient();
  const first = await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(addDays(T, -20)), location: "Ward 3B", reasons: ["Acute decompensated HF"], route: "Emergency department", symptoms: ["Dyspnoea", "Leg swelling"] }));
  await tx((q) => K.discharge(q, doc, pid, first.id, { endedAt: at(addDays(T, -12)), status: "Still congested", destination: "Home", events: ["IV diuretics"], dischargeWeight: 82, plan: [] }));
  const second = await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(addDays(T, -1)), location: "CCU", reasons: ["Acute decompensated HF"] }));
  await re(pid);
  const s = await loadState(db, pid);
  const cur = s.contexts.find((c) => c.id === second.id)!.summary as any;
  assert.equal(cur.hfRelated, true);
  assert.equal(cur.readmission.days, 11);
  assert.equal(cur.readmission.band, "≤30 days");
  assert.equal(cur.readmission.hfReadmission, true);
  const prev = s.contexts.find((c) => c.id === first.id)!.summary as any;
  assert.equal(prev.los, 8);
  assert.deepEqual(prev.events, ["IV diuretics"]);
  assert.equal(s.resolved("weight").current?.value_num, 82);
  assert.equal((await active(pid)).some((x) => x.rule_id === "hf.post-discharge-review"), false, "readmitted: no post-discharge prompt");
  const r = (await active(pid)).find((x) => x.rule_id === "hf.readmission-30d");
  assert.match(r.title, /HF readmission 11 days after discharge/);
  assert.match(r.detail, /still congested/i);
  assert.match(r.detail, /No clinic review between/);
  const note = await tx((q) => draftNote(q, pid, first.id));
  assert.match(note.text, /Presenting symptoms: Dyspnoea, Leg swelling/);
  assert.match(note.text, /Length of stay 8 days/);
  assert.match(note.text, /At discharge: Still congested · to home/);
  await assert.rejects(tx((q) => K.discharge(q, doc, pid, second.id, { endedAt: at(addDays(T, -3)), status: "Improved", plan: [] })), /before admission/);
});

test("post-discharge review: flagged until a visit is booked within 1–2 weeks; congestion is a priority, not a different deadline", async () => {
  const pid = await newPatient();
  const a = await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(addDays(T, -6)), location: "Ward 3A", reasons: ["Acute decompensated HF"] }));
  await tx((q) => K.discharge(q, doc, pid, a.id, { endedAt: at(addDays(T, -2)), status: "Still congested", destination: "Home", plan: [] }));
  await re(pid);
  let f = (await active(pid)).find((x) => x.rule_id === "hf.post-discharge-review");
  assert.equal(f.severity, "yellow");
  assert.match(f.detail, /still congested: prioritise an early review \(within 1–2 weeks\)/i);
  // booked, but later than the window
  await tx(async (q) => {
    await K.addPlanAction(q, doc, pid, { category: "follow_up", title: "HF clinic review", dueDate: addDays(T, 20), completesOn: { type: "visit" } });
    await reassess(q, pid, "sandbox", ["plan"]);
  });
  f = (await active(pid)).find((x) => x.rule_id === "hf.post-discharge-review");
  assert.match(f.title, /later than 14 days after discharge/);
  await tx(async (q) => {
    await K.addPlanAction(q, doc, pid, { category: "follow_up", title: "HF clinic review (early)", dueDate: addDays(T, 3), completesOn: { type: "visit" } });
    await reassess(q, pid, "sandbox", ["plan"]);
  });
  assert.equal((await active(pid)).some((x) => x.rule_id === "hf.post-discharge-review"), false);
});

test("death in hospital: status recorded, plans cancelled, alerts resolved, off the worklist, no new visits", async () => {
  const pid = await newPatient(["hfref", "ckd-3b"]);
  await tx(async (q) => {
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 6.1 }] });
    await K.addPlanAction(q, doc, pid, { category: "monitoring", title: "K check", dueDate: addDays(T, 2), completesOn: { type: "lab", codes: ["potassium"] } });
    await reassess(q, pid, "sandbox");
  });
  assert.ok((await active(pid)).length > 0);
  assert.ok((await worklist(db, SITE_ID)).some((r) => r.id === pid));
  const a = await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(addDays(T, -1)), location: "CCU", reasons: ["Acute decompensated HF"] }));
  await assert.rejects(tx((q) => K.discharge(q, doc, pid, a.id, { endedAt: nowIso(), outcome: "died", status: "Died", plan: [] })), /Cause of death/);
  await tx(async (q) => {
    const changed = await K.discharge(q, doc, pid, a.id, { endedAt: nowIso(), outcome: "died", status: "Died", causeGroup: "hf", events: ["Cardiogenic shock"], plan: [] });
    await reassess(q, pid, "sandbox", changed);
  });
  const s = await loadState(db, pid);
  assert.equal(s.deceased, true);
  assert.equal(s.status.vital?.place, "in_hospital");
  assert.equal(s.status.vital?.cause_group, "hf");
  assert.equal((await active(pid)).length, 0);
  assert.equal(s.plan.filter((p) => p.status === "planned").length, 0);
  assert.equal((await worklist(db, SITE_ID)).some((r) => r.id === pid), false);
  await assert.rejects(tx((q) => K.startVisit(q, doc, pid, { startedAt: nowIso(), reasons: ["Heart failure"], service: "HF clinic" })), /deceased/);
  await assert.rejects(db.query(`DELETE FROM cf.status_event WHERE patient_id=$1`, [pid]), /append-only/);
});

test("API: follow-up status, validation, and a mistaken death corrected by 'alive'", async () => {
  const pid = await newPatient(["htn"]);
  const app = createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const login = await fetch(base + "/demo-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const { csrf } = await login.json();
    const post = (path: string, body: unknown) => fetch(`${base}/patients/${pid}/${path}`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
    assert.equal((await post("status", { kind: "follow_up", status: "died", effectiveOn: T })).status, 400);
    assert.equal((await post("status", { kind: "vital", status: "died", effectiveOn: T })).status, 400);
    assert.equal((await post("status", { kind: "vital", status: "died", effectiveOn: addDays(T, 1), causeGroup: "non_cv" })).status, 400);
    assert.equal((await post("status", { kind: "follow_up", status: "lost", effectiveOn: T, detail: "No answer to 3 calls" })).status, 200);
    let sum = await (await fetch(`${base}/patients/${pid}/summary`, { headers: { cookie } })).json();
    assert.equal(sum.header.status.followUp.status, "lost");
    assert.equal((await post("status", { kind: "vital", status: "died", effectiveOn: T, place: "out_of_hospital", causeGroup: "sudden_cardiac" })).status, 200);
    sum = await (await fetch(`${base}/patients/${pid}/summary`, { headers: { cookie } })).json();
    assert.equal(sum.header.deceased, true);
    assert.match(sum.header.where, /^Deceased/);
    assert.equal((await post("status", { kind: "vital", status: "alive", effectiveOn: T, detail: "Entered for the wrong patient" })).status, 200);
    sum = await (await fetch(`${base}/patients/${pid}/summary`, { headers: { cookie } })).json();
    assert.equal(sum.header.deceased, false);
    const ok = await post("admissions", { startedAt: nowIso(), location: "Ward 3B", reasons: ["Syncope"], route: "Clinic", symptoms: ["Syncope / presyncope"] });
    assert.equal(ok.status, 200);
    assert.equal((await post("admissions", { startedAt: nowIso(), location: "Ward 3B", reasons: ["Syncope"], symptoms: ["Headache"] })).status, 400);
  } finally {
    server.close();
  }
});
