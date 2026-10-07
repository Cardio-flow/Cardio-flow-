// Audit of 7 Oct 2026: data integrity (restart dates, eGFR on correction, future dates, rules re-running on
// results, linked plan items on stop, real dates), joined-pathway context, and the clinical fixes (DOAC label
// doses, VKA with a mechanical valve, hypotension stops, statin change, interactions).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { getWizard } from "../server/engine/wizard.js";
import { doacDoseCheck } from "../server/engine/guidelines.js";
import { checklist } from "../server/engine/checklist.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays, apixabanAfDose } from "../shared/clinical.js";
import { WIZARDS, buildOutcome, optionsFor } from "../shared/wizards.js";
import { suggest } from "../shared/wizard-guidance.js";

let db: DB;
let base = "", server: any, cookie = "", csrf = "";
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[], birthDate = "1960-01-01", sex: "Male" | "Female" = "Male") =>
  tx((q) => K.createPatient(q, doc, { name: "Au " + rnd(), mrn: "U" + rnd() + Date.now(), sex, birthDate, conditions }));
const start = (pid: string, code: string, dose: number, freq: string, day = addDays(T, -60), indication = "hf") =>
  tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(day) }));
const obs = (pid: string, items: any[], day = T) => tx(async (q) => { const r = await K.recordObservations(q, doc, pid, { effectiveAt: at(day), items }); await reassess(q, pid, "sandbox", r.changed); return r; });
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie, "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (r.status !== 200 && r.status !== 201) throw new Error(`${r.status} ${j.error}`);
  return j;
};
const active = async (pid: string, rule: string) => (await db.query(`SELECT title FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[];

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

test("a medicine restarted after a stop counts from the restart (cardioversion checklist)", async () => {
  const pid = await newPatient(["af"]);
  const { medicationId } = await start(pid, "apixaban", 5, "BID", "2025-01-01", "af");
  await tx((q) => K.medicationEvent(q, doc, pid, medicationId, { kind: "stop", effectiveAt: at("2026-06-01") }));
  await tx((q) => K.medicationEvent(q, doc, pid, medicationId, { kind: "restart", doseValue: 5, effectiveAt: at(addDays(T, -5)) }));
  const m = (await loadState(db, pid)).meds.find((x) => x.code === "apixaban")!;
  assert.equal(m.startedAt!.slice(0, 10) <= addDays(T, -4), true);
  assert.ok(m.startedAt! > "2026-06-01");
  const item = checklist(await loadState(db, pid), "cardioversion").items.find((i) => i.key.startsWith("oac"))!;
  assert.equal(item.status, "flag", "5 days, not 2 years");
});

test("correcting a creatinine recalculates its eGFR; empty or derived corrections are refused; results cannot be dated in the future", async () => {
  const pid = await newPatient(["hfref"]);
  const r = await obs(pid, [{ code: "creatinine", value: 400 }]);
  const crId = r.saved.find((x: any) => x.code === "creatinine")!.id, egfrId = r.saved.find((x: any) => x.code === "egfr")!.id;
  const before = (await loadState(db, pid)).resolved("egfr").current!.value_num!;
  const out = await call("POST", `/patients/${pid}/observations/${crId}/correct`, { value: 90 });
  assert.ok(out.changed.includes("egfr"));
  const after = (await loadState(db, pid)).resolved("egfr").current!.value_num!;
  assert.ok(before < 15 && after > 60, `${before} → ${after}`);
  await assert.rejects(call("POST", `/patients/${pid}/observations/${crId}/correct`, {}), /400/);
  await assert.rejects(call("POST", `/patients/${pid}/observations/${egfrId}/correct`, { value: 50 }), /400 .*calculated/);
  await assert.rejects(tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, 200)), items: [{ code: "potassium", value: 6.4 }] })), /cannot be dated in the future/);
  await assert.rejects(call("POST", `/patients/${pid}/plan`, { items: [{ category: "monitoring", title: "Check", dueDate: "2026-02-30" }] }), /400/);
  await assert.rejects(call("POST", `/patients/${pid}/plan`, { items: [{ category: "monitoring", title: "Check", dueDate: addDays(T, -3) }] }), /400 .*today or a later date/);
});

test("recording the due lab closes the monitoring alert (rules that read any result re-run)", async () => {
  const pid = await newPatient(["af"]);
  await start(pid, "amiodarone", 200, "OD", addDays(T, -400), "af");
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.ok((await active(pid, "med.monitoring")).length > 0);
  await obs(pid, [{ code: "tsh", value: 2.1 }, { code: "alt", value: 20 }]);
  assert.equal((await active(pid, "med.monitoring")).length, 0);
});

test("stopping a medicine cancels its own dated medication steps and keeps its monitoring", async () => {
  const pid = await newPatient(["cad-ccs"]);
  const { medicationId } = await start(pid, "ticagrelor", 90, "BID", addDays(T, -30), "cad");
  await tx(async (q) => {
    await K.addPlanAction(q, doc, pid, { category: "medication", title: "End of 12-month DAPT: stop ticagrelor", dueDate: addDays(T, 300), completesOn: { type: "manual" }, medicationId });
    await K.addPlanAction(q, doc, pid, { category: "monitoring", title: "Renal function after ticagrelor", dueDate: addDays(T, 5), completesOn: { type: "lab", codes: ["creatinine"] }, medicationId });
  });
  await tx((q) => K.medicationEvent(q, doc, pid, medicationId, { kind: "stop", effectiveAt: at(T) }));
  const plan = (await loadState(db, pid)).plan;
  assert.equal(plan.find((p) => p.title.startsWith("End of 12-month"))!.status, "cancelled");
  assert.equal(plan.find((p) => p.title.startsWith("Renal function"))!.status, "planned");
});

test("joined pathway: the later part reads the record after the earlier part (AF-CARE starts apixaban → peri-AF sees it)", async () => {
  const pid = await newPatient(["af"]);
  await obs(pid, [{ code: "creatinine", value: 90 }, { code: "weight", value: 80 }]);
  const afcare = { pattern: "persistent", comorb: ["none"], oac: "apixaban", bleed: ["none"], symptoms: "3", rate: ["none"], rhythm: ["cardioversion"], tests: ["none"], review: "none" };
  const plain = await call("GET", `/patients/${pid}/wizards/peri-af-procedure`);
  const q = WIZARDS["peri-af-procedure"].steps.flatMap((s) => s.questions).find((x) => x.id === "oacNow")!;
  assert.deepEqual(optionsFor(q, plain.context).map((o) => o.value), ["none"]);
  const after = await call("POST", `/patients/${pid}/wizards/peri-af-procedure/context`, { before: [{ wizard: "af-care", answers: afcare }] });
  assert.deepEqual(optionsFor(q, after.context).map((o) => o.value), ["3w", "short"]);
  // nothing was recorded by reading it
  assert.equal((await loadState(db, pid)).meds.filter((m) => m.code === "apixaban").length, 0);
  const peri = { proc: "cardioversion", when: addDays(T, 1), onset: "ge24", oacNow: "short", prep: "wait", post: ["oac"], review: "none" };
  const r = await call("POST", `/patients/${pid}/wizards-joined/complete`, { parts: [{ wizard: "af-care", answers: afcare }, { wizard: "peri-af-procedure", answers: peri }] });
  assert.equal(r.parts.length, 2);
  assert.ok((await loadState(db, pid)).plan.some((p) => /^Cardioversion \(after 3 weeks/.test(p.title) && p.due_date === addDays(T, 21)));
});

test("DOAC label doses: apixaban by CrCl 15–29, dabigatran only on fixed criteria; VKA with a mechanical valve in AF-CARE", async () => {
  assert.equal(apixabanAfDose(70, 70, 250, "Male").dose, 2.5, "CrCl ~23");
  assert.equal(apixabanAfDose(85, 40, 400, "Female").dose, null, "CrCl <15: not recommended");
  assert.equal(apixabanAfDose(70, 80, 90, "Male").dose, 5);
  const d = await newPatient(["af"], "1948-06-01");
  await start(d, "dabigatran", 110, "BID", addDays(T, -60), "af");
  await obs(d, [{ code: "creatinine", value: 90 }, { code: "weight", value: 80 }]);
  assert.equal(doacDoseCheck(await loadState(db, d)).length, 0, "age 78: 110 or 150 is the clinician's choice");

  const v = await newPatient(["af", "htn"]);
  await tx((q) => K.recordHistory(q, doc, v, { effectiveAt: at(T), add: [{ code: "prosthetic-valve", attributes: { position: "Mitral", type: "Mechanical" } }] }));
  const ctx = (await tx((q) => getWizard(q, v, "af-care"))).context;
  const oacQ = WIZARDS["af-care"].steps.flatMap((s) => s.questions).find((x) => x.id === "oac")!;
  const vals = optionsFor(oacQ, ctx).map((o) => o.value);
  assert.ok(vals.includes("warfarin") && !vals.includes("apixaban") && !vals.includes("other-doac"));
  assert.deepEqual(suggest("af-care", "oac", {}, ctx).map((x) => x.value), ["warfarin"]);
});

test("low BP on HF therapy: 'stop non-HF BP-lowering drugs' keeps hydralazine, rate control and RAAS", async () => {
  const pid = await newPatient(["hfref", "af"]);
  for (const [c, dz, f] of [["amlodipine", 5, "OD"], ["hydralazine", 25, "TID"], ["diltiazem", 120, "OD"], ["ramipril", 5, "OD"], ["doxazosin", 2, "OD"]] as const) await start(pid, c, dz, f);
  const ctx = (await tx((q) => getWizard(q, pid, "hypotension"))).context;
  const out = buildOutcome("hypotension", { actions: ["stop-vasodilator"] }, ctx).filter((o) => o.kind === "medication").map((o) => o.label);
  assert.deepEqual(out.sort(), ["Amlodipine: stop", "Doxazosin: stop"]);
});

test("statin that cannot reach high intensity is changed, not 'increased' to the same dose; new label interactions fire", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await start(pid, "simvastatin", 40, "OD", addDays(T, -90), "cad");
  await obs(pid, [{ code: "ldl-c", value: 2.6 }]);
  await tx((q) => reassess(q, pid, "sandbox"));
  const r = (await db.query(`SELECT action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='lipids.ldl-goal'`, [pid])).rows[0] as any;
  const action = typeof r.action === "string" ? JSON.parse(r.action) : r.action;
  assert.equal(action.type, "start-med");
  assert.equal(action.code, "atorvastatin");
  await start(pid, "amiodarone", 200, "OD", addDays(T, -10), "af");
  await tx((q) => reassess(q, pid, "sandbox"));
  const titles = (await db.query(`SELECT title FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id LIKE 'med.%'`, [pid])).rows.map((x: any) => x.title);
  assert.ok(titles.some((t: string) => /Simvastatin above 20 mg with Amiodarone/.test(t)), titles.join(" | "));
});
