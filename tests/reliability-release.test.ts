import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { summary, worklist } from "../server/kernel/views.js";
import { reassess, seedRules } from "../server/engine/engine.js";
import { RULE } from "../server/engine/rules.js";
import { ApiError, today, type Actor } from "../server/kernel/base.js";
import { createApp, type Session } from "../server/app.js";
import { hostedAuth } from "../server/auth.js";
import { NEON_AUTH_SESSION_COOKIE_NAME, NEON_AUTH_SESSION_DATA_COOKIE_NAME } from "@neondatabase/auth/server";

let db: DB;
let count = 0;
const doc: Actor = { id: "review@example.test", name: "Dr Review", role: "clinician", siteId: SITE_ID };
const patient = (conditions: string[] = []) => db.transaction(q => K.createPatient(q, doc, { name: "Synthetic reliability", mrn: `REL-${++count}`, sex: "Male", birthDate: "1960-01-01", conditions }));
const plan = (id: string, codes: string[]) => db.transaction(q => K.addPlanAction(q, doc, id, { title: codes.join(" + "), category: "monitoring", dueDate: today(), completesOn: { type: "lab", codes } }));
const row = async (id: string) => (await db.query("SELECT * FROM cf.plan_action WHERE id=$1", [id])).rows[0];
before(async () => { db = await createLocalDb(); await boot(db, { seed: false }); });
after(async () => db.close());

for (const order of [["potassium", "creatinine"], ["creatinine", "potassium"]]) {
  test(`withdrawing either required result reopens the combined check (${order.join(" first, ")})`, async () => {
    for (const withdrawn of order) {
      const id = await patient();
      const p = await plan(id, ["potassium", "creatinine"]);
      const r = await db.transaction(q => K.recordObservations(q, doc, id, { effectiveAt: new Date().toISOString(), items: order.map(code => ({ code, value: code === "potassium" ? 4.5 : 100 })) }));
      const completed = await row(p.id);
      assert.equal(completed.status, "completed");
      assert.equal(completed.progress, "performed");
      assert.equal(completed.completion_refs.length, 2);
      assert.equal(completed.owner, doc.name);
      await db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "reviewed", version: completed.version }));
      await db.transaction(q => K.correctObservation(q, doc, id, r.saved.find(o => o.code === withdrawn)!.id, { enteredInError: true }));
      const reopened = await row(p.id);
      assert.equal(reopened.status, "planned");
      assert.equal(reopened.reviewed_at, null);
      assert.deepEqual(reopened.completion_refs, []);
    }
  });
}

test("withdrawing an unrelated result in the same batch leaves the potassium check complete", async () => {
  const id = await patient();
  const p = await plan(id, ["potassium"]);
  const r = await db.transaction(q => K.recordObservations(q, doc, id, { effectiveAt: new Date().toISOString(), items: [{ code: "creatinine", value: 100 }, { code: "potassium", value: 4.5 }] }));
  await db.transaction(q => K.correctObservation(q, doc, id, r.ids[0], { enteredInError: true }));
  assert.equal((await row(p.id)).status, "completed");
});

test("withdrawing creatinine reopens a check completed by its derived eGFR", async () => {
  const id = await patient();
  const p = await plan(id, ["egfr"]);
  const r = await db.transaction(q => K.recordObservations(q, doc, id, { effectiveAt: new Date().toISOString(), items: [{ code: "creatinine", value: 100 }] }));
  await db.transaction(q => K.correctObservation(q, doc, id, r.ids[0], { enteredInError: true }));
  assert.equal((await row(p.id)).status, "planned");
});

test("correcting a reviewed value makes its result await review again, without reopening performance", async () => {
  const id = await patient();
  const p = await plan(id, ["potassium"]);
  const r = await db.transaction(q => K.recordObservations(q, doc, id, { effectiveAt: new Date().toISOString(), items: [{ code: "potassium", value: 4.5 }] }));
  await db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "reviewed", version: (r.completed.length ? 2 : 1) }));
  await db.transaction(q => K.correctObservation(q, doc, id, r.ids[0], { value: 5.7 }));
  const corrected = await row(p.id);
  assert.equal(corrected.status, "completed");
  assert.equal(corrected.progress, "performed");
  assert.equal(corrected.reviewed_at, null);
  assert.equal((await summary(db, id)).plan[0].evidence[0].value, 5.7);
});

test("preliminary results do not close a safety check; lab tasks cannot be manually marked done", async () => {
  const id = await patient();
  const p = await plan(id, ["potassium"]);
  await db.transaction(q => K.recordObservations(q, doc, id, { effectiveAt: new Date().toISOString(), status: "preliminary", items: [{ code: "potassium", value: 4.5 }] }));
  assert.equal((await row(p.id)).status, "planned");
  await assert.rejects(db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "complete", version: 1 })), /Add the result/);
});

test("ordered and booked stages retain due dates; stale edits fail; recorded results await review in all views", async () => {
  const id = await patient();
  const p = await plan(id, ["potassium"]);
  await db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "ordered", version: 1 }));
  await assert.rejects(db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "cancel", version: 1 })), /changed by someone else/);
  await db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "booked", version: 2 }));
  assert.equal((await row(p.id)).due_date, today());
  await db.transaction(q => K.recordObservations(q, doc, id, { effectiveAt: new Date().toISOString(), items: [{ code: "potassium", value: 4.5 }] }));
  let s = await summary(db, id);
  assert.equal(s.plan[0].awaitingReview, true);
  assert.equal(s.overview.unfinished.review, 1);
  assert.equal((await worklist(db, SITE_ID)).find(r => r.id === id)!.awaitingReview, 1);
  assert.equal(s.plan[0].evidence[0].value, 4.5);
  const r = await row(p.id);
  await db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "assign", owner: "HF clinic", version: r.version }));
  await db.transaction(q => K.updatePlanAction(q, doc, id, p.id, { action: "reviewed", version: r.version + 1 }));
  s = await summary(db, id);
  assert.equal(s.overview.unfinished.review, 0);
  assert.equal((await row(p.id)).reviewed_by, doc.id);
  assert.equal((await row(p.id)).owner, "HF clinic");
});

test("ACE inhibitor to ARNI substitution is not an advanced-HF reduction; genuine intolerance still is", async () => {
  for (const reason of ["Switch to ARNI (36-hour washout)", "Adverse effect"]) {
    const id = await patient(["hfref"]);
    const at = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
    await db.transaction(async q => {
      const m = await K.startMedication(q, doc, id, { code: "ramipril", doseValue: 5, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(4) });
      await K.medicationEvent(q, doc, id, m.medicationId, { kind: "stop", reason, effectiveAt: at(3) });
      await K.startMedication(q, doc, id, { code: "sacubitril-valsartan", doseValue: 24, frequency: "BID", route: "PO", indication: "hf", effectiveAt: at(1) });
      await reassess(q, id, "production");
    });
    const recs = (await db.query("SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.advanced-hf' AND status='active'", [id])).rows;
    assert.equal(recs.length, reason === "Adverse effect" ? 1 : 0);
  }
});

test("restarting a held medicine clears its medication-reduction marker", async () => {
  const id = await patient(["hfref"]);
  const at = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  await db.transaction(async q => {
    const m = await K.startMedication(q, doc, id, { code: "bisoprolol", doseValue: 5, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(4) });
    await K.medicationEvent(q, doc, id, m.medicationId, { kind: "hold", reason: "Bradycardia", effectiveAt: at(3) });
    await K.medicationEvent(q, doc, id, m.medicationId, { kind: "restart", doseValue: 5, reason: "Recovered", effectiveAt: at(1) });
    await reassess(q, id, "production");
  });
  assert.equal((await db.query("SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.advanced-hf' AND status='active'", [id])).rows.length, 0);
});

test("changed published rule content creates a new version and preserves historical content", async () => {
  const rule = RULE["hf.hyperkalaemia-review"];
  const original = (await db.query("SELECT * FROM cf.rule_version WHERE rule_id=$1 AND status='PUBLISHED'", [rule.id])).rows[0];
  const title = rule.title;
  try {
    rule.title = title + " (release test)";
    await db.transaction(q => seedRules(q));
    const rows = (await db.query("SELECT * FROM cf.rule_version WHERE rule_id=$1 ORDER BY version", [rule.id])).rows;
    assert.equal(rows[0].title, original.title);
    assert.equal(rows[0].status, "RETIRED");
    assert.equal(rows[1].version, original.version + 1);
    assert.notEqual(rows[1].content_hash, original.content_hash);
    assert.equal(rows[1].status, "PUBLISHED");
    assert.equal(await db.transaction(q => seedRules(q)), 0);
    await assert.rejects(db.transaction(q => q.query("UPDATE cf.rule_version SET evidence='overwritten' WHERE rule_id=$1 AND version=$2", [rule.id, rows[1].version])), /immutable/);
  } finally { rule.title = title; }
});

test("hosted logout invokes the provider, invalidates the session and fails visibly if provider logout fails", async () => {
  let active = true, fail = false, calls = 0;
  const session: Session = { ...doc, email: doc.id, csrf: "test-csrf", expires: Date.now() + 60000 };
  const server = createApp(db, { origin: "http://127.0.0.1", mount() {}, async authenticate() { return active ? session : null; }, async signOut(_req, res) { calls++; if (fail) throw new ApiError(503, "Sign-out failed. You are still signed in. Try again."); active = false; res.clearCookie(NEON_AUTH_SESSION_COOKIE_NAME); } }).listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    fail = true;
    assert.equal((await fetch(url + "/api/logout", { method: "POST", headers: { "x-csrf-token": session.csrf } })).status, 503);
    assert.equal((await fetch(url + "/api/session")).status, 200);
    fail = false;
    const response = await fetch(url + "/api/logout", { method: "POST", headers: { "x-csrf-token": session.csrf } });
    assert.equal(response.status, 200);
    assert.ok(response.headers.getSetCookie().some(c => c.startsWith(NEON_AUTH_SESSION_COOKIE_NAME)));
    assert.equal((await fetch(url + "/api/session")).status, 401);
    assert.equal(calls, 2);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test("Neon adapter sends sign-out upstream and clears both provider and cached-session cookies", async () => {
  let method = "", cookies = "";
  const upstream = createServer((req, res) => { method = req.method!; cookies = req.headers.cookie ?? ""; res.setHeader("content-type", "application/json"); res.end('{"success":true}'); }).listen(0, "127.0.0.1");
  await new Promise<void>(r => upstream.once("listening", r));
  const cleared: string[] = [];
  const adapter = hostedAuth(db, "https://cardio.example.test", `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, "synthetic-secret-only-for-test-123456789");
  try {
    await adapter.signOut({ headers: { cookie: `${NEON_AUTH_SESSION_COOKIE_NAME}=synthetic; ${NEON_AUTH_SESSION_DATA_COOKIE_NAME}=synthetic-cache` } } as any, { append(_key: string, value: string) { cleared.push(value); } } as any);
    assert.equal(method, "POST");
    assert.match(cookies, /synthetic/);
    for (const name of [NEON_AUTH_SESSION_COOKIE_NAME, NEON_AUTH_SESSION_DATA_COOKIE_NAME]) assert.ok(cleared.some(c => c.startsWith(name + "=") && /Max-Age=0/.test(c)));
  } finally { await new Promise<void>(r => upstream.close(() => r())); }
});
