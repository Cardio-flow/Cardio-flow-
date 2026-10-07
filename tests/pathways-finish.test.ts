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
  const at2 = { from: "recorded", setting: "ccs", oac: "no", hbr: ["none"], ischaemic: ["none"], dapt: "6m", sapt: "aspirin", now: ["none"], review: "none" };
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

const recs = async (pid: string, rule: string) =>
  ((await db.query(`SELECT title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[]).map((r) => ({ ...r, action: typeof r.action === "string" ? JSON.parse(r.action) : r.action }));

test("PCI complications act: kidney injury → creatinine, access bleeding → haemoglobin, stent thrombosis → echo; each closes with its result", async () => {
  const { reassess } = await import("../server/engine/engine.js");
  const pid = await newPatient(["cad-ccs"]);
  await tx(async (q) => {
    await K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -2)), details: { setting: "nste-acs", vessels: ["LAD"], devices: ["Drug-eluting stent"], stents: 1, access: "Femoral", complications: ["Contrast-associated kidney injury", "Access-site haematoma or bleeding", "Acute stent thrombosis"] } });
    await reassess(q, pid, "sandbox");
  });
  let r = await recs(pid, "cad.pci-complication");
  assert.equal(r.length, 3);
  assert.deepEqual(r.find((x) => /creatinine/.test(x.title))!.action.codes, ["creatinine", "potassium"]);
  assert.ok(r.some((x) => /Acute stent thrombosis during PCI: echo/.test(x.title) && x.action.template === "echo"));
  await tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: at(T), items: [{ code: "creatinine", value: 110 }, { code: "haemoglobin", value: 12.5 }] }); await reassess(q, pid, "sandbox"); });
  r = await recs(pid, "cad.pci-complication");
  assert.deepEqual(r.map((x) => x.title), ["Acute stent thrombosis during PCI: echo for LV function"]);
});

test("after CABG: aspirin and statin started, P2Y12 resumed to 12 months after the ACS, dates from the operation", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "cabg", date: at(addDays(T, -5)), details: { grafts: ["LIMA to LAD", "Vein grafts"], count: 3, setting: "elective" } }));
  const ctx = (await tx((q) => getWizard(q, pid, "after-cabg"))).context;
  assert.equal(ctx.cabgAt, addDays(T, -5));
  const v = suggest("after-cabg", "meds", { setting: "ccs", poaf: "no" }, ctx).map((x) => x.value);
  assert.ok(v.includes("aspirin") && v.includes("statin") && !v.includes("p2y12"));
  const out = buildOutcome("after-cabg", { setting: "ccs", poaf: "no", meds: ["aspirin", "statin"], followup: ["lipids", "rehab"], review: "none" }, ctx);
  assert.ok(out.some((o) => o.kind === "start" && o.code === "aspirin" && o.doseValue === 100));
  assert.ok(out.some((o) => o.kind === "start" && o.code === "atorvastatin" && o.doseValue === 80));
  assert.ok(out.some((o) => o.kind === "plan" && /Lipid profile 4–6 weeks after CABG/.test(o.title) && o.dueDate === addDays(T, 37)));
  const sum = WIZARDS["after-cabg"].assess!({ setting: "acs", poaf: "yes", meds: ["aspirin"], followup: ["none"] }, ctx);
  assert.ok(sum.recommendations.some((x) => /resume the P2Y12 inhibitor/.test(x)));
  assert.ok(sum.recommendations.some((x) => /Post-operative AF/.test(x)));
});

test("after a device implant: device from the record, first check and remote monitoring planned, infection concern same day", async () => {
  const pid = await newPatient(["hfref"]);
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -1)), details: { type: "CRT-D", action: "New implant", indication: "CRT for heart failure", pacing: "Biventricular", remote: "Not enrolled" } }));
  const ctx = (await tx((q) => getWizard(q, pid, "after-device"))).context;
  assert.deepEqual(suggest("after-device", "device", {}, ctx).map((x) => x.value), ["crt"]);
  const f = suggest("after-device", "followup", { device: "crt" }, ctx).map((x) => x.value);
  assert.ok(f.includes("check") && f.includes("remote") && f.includes("hf"));
  const out = buildOutcome("after-device", { device: "crt", wound: "concern", followup: ["check", "remote"], review: "none" }, ctx) as any[];
  assert.ok(out.some((o) => /Same-day review by the implanting team: possible CRT pocket infection/.test(o.title) && o.dueDate === T));
  assert.ok(out.some((o) => o.title === "First CRT check after implant (in person)" && o.completesOn.kind === "device_check"));
});

test("checklists: valve and right heart catheterisation, and planned procedures carry their checklist", async () => {
  const { checklist } = await import("../server/engine/checklist.js");
  const { checklistForPlan } = await import("../shared/procedures.js");
  const { planView } = await import("../server/kernel/views.js");
  const pid = await newPatient(["as"]);
  let c = checklist(await loadState(db, pid), "valve");
  assert.equal(c.items.find((i) => i.key === "team")!.status, "flag");
  assert.equal(c.items.find((i) => i.key === "coronary")!.status, "missing");
  assert.match(c.items.find((i) => i.key === "dental")!.source!, /ESC endocarditis 2023/);
  c = checklist(await loadState(db, pid), "rhc");
  assert.equal(c.items.find((i) => i.key === "echo")!.status, "missing");
  assert.equal(c.items.find((i) => i.key === "vq")!.status, "info");

  assert.equal(checklistForPlan("TAVI (Heart Team decision)", "procedure"), "valve");
  assert.equal(checklistForPlan("Cardioversion (after 3 weeks of effective anticoagulation)", "procedure"), "cardioversion");
  assert.equal(checklistForPlan("Anticoagulation for at least 4 weeks after cardioversion, then by CHA₂DS₂-VA", "medication"), null);
  assert.equal(checklistForPlan("Staged PCI (complete revascularisation within 45 days)", "follow_up"), "pci");
  assert.equal(checklistForPlan("Immediate coronary angiography (primary PCI pathway)", "procedure"), null);
  assert.equal(checklistForPlan("PH centre referral: right heart catheterisation (pulmonary hypertension work-up)", "referral"), "rhc");
  await tx((q) => K.addPlanAction(q, doc, pid, { category: "procedure", title: "TAVI (Heart Team decision)", reason: "test", dueDate: addDays(T, 20), completesOn: { type: "manual" } }));
  assert.equal(planView(await loadState(db, pid)).find((p) => p.title.startsWith("TAVI"))!.checklist, "valve");
});
