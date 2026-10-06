// Finishing the pathway audit (6 Oct): every pathway closes with a summary, medicines a pathway starts go
// through the pre-start check, joined pathways record together, P2Y12 monotherapy, chest-pain gaps, and
// amiodarone detected by name.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { completeWizard, getWizard, wizardStartCheck } from "../server/engine/wizard.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { WIZARDS, buildOutcome } from "../shared/wizards.js";
import { JOIN, joinFor } from "../shared/wizard-prefill.js";
import { suggest } from "../shared/wizard-guidance.js";

let db: DB;
let base = "", server: any, cookie = "", csrf = "";
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[]) => tx((q) => K.createPatient(q, doc, { name: "Pw " + rnd(), mrn: "W" + rnd() + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions }));
const start = (pid: string, code: string, dose: number, freq: string, indication = "cad") =>
  tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(addDays(T, -60)) }));
const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", cookie, "x-csrf-token": csrf }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.status !== 200) throw new Error(`${r.status} ${j.error}`);
  return j;
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

test("every pathway closes with a summary; the generic one carries findings, follow-up and the cited suggestions", async () => {
  for (const w of Object.values(WIZARDS)) assert.ok(w.assess, `${w.id} has a closing summary`);
  const pid = await newPatient(["hfref"]);
  await start(pid, "spironolactone", 25, "OD", "hf");
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(T), items: [{ code: "potassium", value: 5.8 }] }));
  const ctx = (await tx((q) => getWizard(q, pid, "hyperkalaemia"))).context;
  const a = WIZARDS.hyperkalaemia.assess!({ result: "confirmed", symptoms: ["none"], ecg: "none", contributors: ["mra"], actions: ["reduce-mra"], recheck: "7", review: "clinic-7" }, ctx);
  assert.match(a.heading, /Hyperkalaemia review: summary/);
  assert.ok(a.rows.some((r) => r.label === "Follow-up" && /Renal function and potassium check · /.test(r.value)));
  assert.ok(a.recommendations.some((x) => /K 5\.5–6\.0: halve the MRA dose/.test(x)));
});

test("a medicine started by a pathway with a red pre-start hit needs a reason (409 without), recorded with the start", async () => {
  const pid = await newPatient(["cad-ccs", "t2dm"]);
  await start(pid, "clarithromycin", 500, "BID", "infection");
  const answers = { type: "nstemi", revasc: "complete", lvef: "le40", start: ["mra"], prevent: ["none"], followup: ["none"], review: "none" };
  const hits = await tx((q) => wizardStartCheck(q, pid, "acs-discharge", answers));
  assert.ok(hits.eplerenone.some((h) => h.severity === "red"), "eplerenone with a strong CYP3A4 inhibitor");
  await assert.rejects(post(`/patients/${pid}/wizards/acs-discharge/complete`, { answers }), /409 Eplerenone: .*Record a reason/);
  await post(`/patients/${pid}/wizards/acs-discharge/complete`, { answers, overrides: { eplerenone: "Clarithromycin stops tomorrow" } });
  const s = await loadState(db, pid);
  const m = s.meds.find((x) => x.code === "eplerenone")!;
  assert.equal(m.status, "active");
  assert.match(m.events[0].reason ?? "", /Started despite: .* — Clarithromycin stops tomorrow/);
});

test("joined pathways: the join follows the answers, and both parts are recorded in one call", async () => {
  for (const [a, j] of Object.entries(JOIN)) assert.ok(WIZARDS[a] && WIZARDS[j.next], `${a} → ${j.next}`);
  const pid = await newPatient(["cad-ccs"]);
  const ctx = (await tx((q) => getWizard(q, pid, "pericarditis"))).context;
  assert.equal(joinFor("pericarditis", { myocardium: "no" }, ctx), null);
  assert.equal(joinFor("pericarditis", { myocardium: "yes" }, ctx)?.next, "myocarditis");
  assert.equal(joinFor("af-care", { rhythm: ["none"] }, ctx), null);
  assert.equal(joinFor("af-care", { rhythm: ["ablation"] }, ctx)?.next, "peri-af-procedure");
  assert.equal(joinFor("chest-pain-cad", { ecg: "normal", troponin: "normal", adherence: "taking" }, ctx), null, "stable pain: no new antithrombotic plan");

  const p = await newPatient(["cad-ccs"]);
  const hb = { severity: "minor", agents: [], actions: ["restart"], recheck: "7", review: "none" };
  const at2 = { setting: "ccs", oac: "no", hbr: ["none"], ischaemic: ["none"], dapt: "6m", sapt: "aspirin", now: ["none"], review: "none" };
  const r = await post(`/patients/${p}/wizards-joined/complete`, { parts: [{ wizard: "bleeding", answers: hb }, { wizard: "antithrombotic", answers: at2 }] });
  assert.equal(r.parts.length, 2);
  const d = (await db.query(`SELECT wizard FROM cf.decision WHERE patient_id=$1`, [p])).rows.map((x: any) => x.wizard).sort();
  assert.deepEqual(d, ["antithrombotic", "bleeding"]);
  // a refused second part records neither
  const q = await newPatient(["cad-ccs"]);
  await assert.rejects(post(`/patients/${q}/wizards-joined/complete`, { parts: [{ wizard: "bleeding", answers: hb }, { wizard: "antithrombotic", answers: { setting: "ccs" } }] }), /400/);
  assert.equal((await db.query(`SELECT count(*)::int n FROM cf.decision WHERE patient_id=$1`, [q])).rows[0].n, 0);
});

test("P2Y12 monotherapy after 3–6 months of DAPT (ACS): suggested, and the dated stop is aspirin", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await start(pid, "aspirin", 100, "OD");
  await start(pid, "ticagrelor", 90, "BID");
  const ctx = (await tx((q) => getWizard(q, pid, "antithrombotic"))).context;
  const a = { setting: "acs", oac: "no", hbr: ["none"], ischaemic: ["none"], dapt: "3-6m" };
  assert.deepEqual(suggest("antithrombotic", "sapt", a, ctx).map((x) => x.value), ["p2y12"]);
  const out = buildOutcome("antithrombotic", { ...a, sapt: "p2y12", now: ["none"], review: "none" }, ctx);
  const stop = out.find((o) => o.kind === "plan") as any;
  assert.match(stop.title, /stop aspirin, continue ticagrelor alone/);
  assert.equal(stop.medicationId, ctx.meds.find((m) => m.code === "aspirin")!.id);
  const sum = WIZARDS.antithrombotic.assess!({ ...a, sapt: "p2y12", now: ["none"] }, ctx);
  assert.ok(sum.rows.some((r) => /Bleeding risk/.test(r.label) && /Not high/.test(r.value)));
  assert.ok(sum.recommendations.some((x) => /first 30 days/.test(x)));
});

test("recurrent chest pain with a troponin rise: parenteral anticoagulation and admission are suggested", async () => {
  const pid = await newPatient(["cad-ccs"]);
  const ctx = (await tx((q) => getWizard(q, pid, "chest-pain-cad"))).context;
  const a = { pattern: "rest", ecg: "normal", troponin: "rising", instability: ["none"], adherence: "taking" };
  const v = suggest("chest-pain-cad", "actions", a, ctx).map((x) => x.value);
  assert.ok(v.includes("anticoag") && v.includes("admit") && v.includes("invasive-24"));
  const sum = WIZARDS["chest-pain-cad"].assess!({ ...a, actions: ["invasive-24"] }, ctx);
  assert.ok(sum.recommendations.some((x) => /Parenteral anticoagulation/.test(x)));
});

test("digoxin and bradycardia: amiodarone detected by name, not by the QT tag", async () => {
  const pid = await newPatient(["af"]);
  await start(pid, "digoxin", 0.125, "OD", "af");
  await start(pid, "clarithromycin", 500, "BID", "infection");
  let ctx = (await tx((q) => getWizard(q, pid, "digoxin"))).context;
  assert.ok(!(ctx.detected.causes ?? []).includes("amiodarone"), "clarithromycin is QT-prolonging, not amiodarone");
  await start(pid, "dronedarone", 400, "BID", "af");
  ctx = (await tx((q) => getWizard(q, pid, "digoxin"))).context;
  assert.ok(ctx.detected.causes.includes("amiodarone"));
});
