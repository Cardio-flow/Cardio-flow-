// Medication exceptions only (Ahmed, 2 Oct 2026): by default every medicine is taken as
// prescribed; the clinician records only what differs (not taking, other dose, stopped by the
// patient) and, once, why a drug class is not given. Suggestions follow those records.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { summary } from "../server/kernel/views.js";
import { documents } from "../server/kernel/documents.js";
import { reassess } from "../server/engine/engine.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
let base = "";
let server: any;
let cookie = "", csrf = "";
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", cookie, "x-csrf-token": csrf }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.status !== 200) throw new Error(`${r.status} ${j.error}`);
  return j;
};
const att = async (pid: string) => (await tx((q) => summary(q, pid, "sandbox"))).attention as any[];

async function hfPatient() {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ex " + rnd(), mrn: "X" + rnd() + Date.now(), sex: "Male", birthDate: "1962-01-01", conditions: ["hfref"] }));
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -30)), quality: "formal", lvef: 30, findings: [] });
    for (const [code, dose, freq] of [["sacubitril-valsartan", 49, "BID"], ["bisoprolol", 5, "OD"], ["spironolactone", 25, "OD"]] as const)
      await K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(addDays(T, -90)) });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 4.4 }, { code: "creatinine", value: 95 }, { code: "sbp", value: 118 }, { code: "hr", value: 72 }] });
    await reassess(q, pid, "sandbox");
  });
  return pid;
}

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = await fetch(base + "/demo-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  csrf = (await login.json()).csrf;
});
after(async () => (server.close(), db.close()));

test("nothing to record by default: every medicine counts as taken", async () => {
  const pid = await hfPatient();
  const s = await loadState(db, pid);
  assert.ok(s.meds.every((m) => m.status === "active"));
  assert.ok(!(await att(pid)).some((a) => a.rule_id === "meds.not-taking"));
});

test("'not taking' replaces the start suggestion with one not-taking alert; 'taking again' clears it", async () => {
  const pid = await hfPatient();
  const bb = (await loadState(db, pid)).meds.find((m) => m.code === "bisoprolol")!;
  await post(`/patients/${pid}/medications/${bb.id}/events`, { kind: "not_taking", reason: "Side effect" });
  let a = await att(pid);
  const nt = a.find((x) => x.rule_id === "meds.not-taking");
  assert.equal(nt.severity, "orange");
  assert.equal(nt.title, "Bisoprolol prescribed but not taken: side effect");
  assert.ok(!a.some((x) => x.action?.type === "start-med" && x.action.code === "bisoprolol"), "no 'start a beta-blocker' while one is prescribed");
  assert.ok(!a.some((x) => x.rule_id === "hf.titration" && x.title.includes("Bisoprolol")), "no uptitration of a drug not taken");
  const pillar = (await tx((q) => summary(q, pid, "sandbox"))).targets.hf!.pillars.find((p: any) => p.key === "bb")!;
  assert.match(pillar.med!, /\(not taking\)/);
  const docs = await tx((q) => documents(q, pid));
  assert.match(docs.find((d) => d.id === "summary")!.text, /Bisoprolol \(Concor\) 5 mg OD — NOT TAKING \(patient report: side effect\)/);
  await assert.rejects(post(`/patients/${pid}/medications/${bb.id}/events`, { kind: "not_taking", reason: "Side effect" }), /409/);
  await post(`/patients/${pid}/medications/${bb.id}/events`, { kind: "resume", reason: "Taking it again as prescribed" });
  a = await att(pid);
  assert.ok(!a.some((x) => x.rule_id === "meds.not-taking"));
  assert.equal((await loadState(db, pid)).meds.find((m) => m.code === "bisoprolol")!.status, "active");
});

test("intolerance recorded once silences the class until it is removed", async () => {
  const pid = await hfPatient();
  const sg = (await att(pid)).find((x) => x.action?.type === "start-med" && x.action.code === "dapagliflozin");
  assert.ok(sg, "SGLT2i suggested");
  await post(`/patients/${pid}/recommendations/${sg.id}/decline`, { outcome: "declined", reason: "Recurrent genital infection", category: "intolerance", also: sg.also.map((x: any) => x.id) });
  let s = await tx((q) => summary(q, pid, "sandbox"));
  assert.ok(!s.attention.some((x: any) => x.action?.type === "start-med" && x.action.code === "dapagliflozin"));
  assert.deepEqual(s.barriers.map((b: any) => [b.cls, b.reason, b.detail, b.active]), [["sglt2", "Intolerance / side effect", "Recurrent genital infection", true]]);
  const pillar = s.targets.hf!.pillars.find((p: any) => p.key === "sglt2")!;
  assert.equal(pillar.state, "blocked");
  assert.match(pillar.note!, /Not given: intolerance \/ side effect \(Recurrent genital infection\)/);
  // a new visit does not bring a lasting reason back
  await tx(async (q) => { await K.startVisit(q, doc, pid, { reasons: ["HF follow-up"], service: "HF clinic", startedAt: new Date(Date.now() + 60000).toISOString() }); await reassess(q, pid, "sandbox"); });
  assert.ok(!(await att(pid)).some((x) => x.action?.code === "dapagliflozin"));
  const d = (await db.query(`SELECT reason, outcome FROM cf.decision WHERE recommendation_id=$1`, [sg.id])).rows[0] as any;
  assert.equal(d.reason, "Intolerance / side effect: Recurrent genital infection");
  // removed → the suggestion returns
  await post(`/patients/${pid}/barriers/sglt2/clear`, {});
  s = await tx((q) => summary(q, pid, "sandbox"));
  assert.ok(s.attention.some((x: any) => x.action?.type === "start-med" && x.action.code === "dapagliflozin"));
  assert.deepEqual(s.barriers, []);
});

test("'patient declines' lasts until the next visit; a dose-increase reason only stops uptitration", async () => {
  const pid = await hfPatient();
  const sg = (await att(pid)).find((x) => x.action?.code === "dapagliflozin");
  await post(`/patients/${pid}/recommendations/${sg.id}/decline`, { outcome: "deferred", reason: "Wants to think about it", category: "declined" });
  assert.ok(!(await att(pid)).some((x) => x.action?.code === "dapagliflozin"));
  await tx(async (q) => { await K.startVisit(q, doc, pid, { reasons: ["HF follow-up"], service: "HF clinic", startedAt: new Date(Date.now() + 60000).toISOString() }); await reassess(q, pid, "sandbox", ["contexts"]); });
  assert.ok((await att(pid)).some((x) => x.action?.code === "dapagliflozin"), "back at the next visit");

  const up = (await att(pid)).find((x) => x.rule_id === "hf.titration" && x.title.startsWith("Uptitrate Bisoprolol"));
  assert.ok(up, "bisoprolol uptitration suggested");
  await post(`/patients/${pid}/recommendations/${up.id}/decline`, { outcome: "declined", reason: "Fatigue at higher dose", category: "intolerance" });
  const s = await tx((q) => summary(q, pid, "sandbox"));
  assert.ok(!s.attention.some((x: any) => x.rule_id === "hf.titration" && x.title.startsWith("Uptitrate Bisoprolol")));
  assert.ok(s.barriers.some((b: any) => b.cls === "up:bb" && b.label === "Dose increase: Beta-blocker"));
  assert.ok(s.attention.some((x: any) => x.rule_id === "hf.titration" && x.title.startsWith("Uptitrate Sacubitril")), "other drugs still uptitrated");
});

test("a reason category is refused on a non-medicine suggestion; 'other' needs a note", async () => {
  const pid = await hfPatient();
  const iron = (await att(pid)).find((x) => x.rule_id === "hf.iron-deficiency");
  await assert.rejects(post(`/patients/${pid}/recommendations/${iron.id}/decline`, { outcome: "declined", reason: "x", category: "cost" }), /medicine suggestions only/);
  const sg = (await att(pid)).find((x) => x.action?.code === "dapagliflozin");
  await assert.rejects(post(`/patients/${pid}/recommendations/${sg.id}/decline`, { outcome: "declined", reason: "", category: "other" }), /400/);
});

test("start with a red pre-start hit needs a reason (409 without); a past start date is kept, a future one refused", async () => {
  const pid = await hfPatient();
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "hr", value: 62 }] }));
  const body = { code: "ivabradine", doseValue: 5, frequency: "BID", route: "PO", indication: "hf" };
  await assert.rejects(post(`/patients/${pid}/medications`, body), /^Error: 409 Ivabradine: do not initiate/);
  await post(`/patients/${pid}/medications`, { ...body, override: "Specialist advice", effectiveAt: at(addDays(T, -3)) });
  const iv = (await loadState(db, pid)).meds.find((m) => m.code === "ivabradine")!;
  assert.equal(iv.startedAt!.slice(0, 10), addDays(T, -3));
  const ev = (await db.query(`SELECT reason FROM cf.medication_event WHERE medication_id=$1`, [iv.id])).rows[0] as any;
  assert.match(ev.reason, /Started despite: Ivabradine: do not initiate.* — Specialist advice/);
  await assert.rejects(post(`/patients/${pid}/medications`, { code: "dapagliflozin", doseValue: 10, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(addDays(T, 3)) }), /^Error: 400 The start date cannot be in the future/);
});
