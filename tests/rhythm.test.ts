// Rhythm & devices module, slice 1: device implants, ablations and cardioversions as dated
// procedures, the device on the problem list, and the rhythm profile.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { suggest } from "../shared/wizard-guidance.js";
import { summary } from "../server/kernel/views.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const sumOf = async (name: string): Promise<any> => { const id = await byName(name); return tx((q) => summary(q, id, "sandbox")); };
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("a device implant lists the device on the problem list; an upgrade changes it; a loop recorder does not replace a pacemaker", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Dev " + Date.now(), mrn: "V" + Date.now(), sex: "Male", birthDate: "1950-01-01", conditions: ["av-block"] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -300)), details: { type: "Pacemaker (dual chamber)", action: "New implant", indication: "AV block", pacing: "Conduction system pacing (His / LBBAP)" } }));
  let s = await loadState(db, pid);
  assert.equal(s.procedures[0].summary, "Pacemaker (dual chamber) · AV block · Conduction system pacing (His / LBBAP)");
  assert.equal(s.conditions.find((c) => c.code === "cied")!.attributes.type, "Pacemaker");
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -20)), details: { type: "Implantable loop recorder", action: "New implant" } }));
  assert.equal((await loadState(db, pid)).conditions.find((c) => c.code === "cied")!.attributes.type, "Pacemaker");
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -2)), details: { type: "CRT-P", action: "Upgrade", indication: "CRT for heart failure", pacing: "Biventricular" } }));
  s = await loadState(db, pid);
  const cied = s.conditions.filter((c) => c.code === "cied" && c.status === "active");
  assert.equal(cied.length, 1);
  assert.equal(cied[0].attributes.type, "CRT-P");
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "ablation", date: at(T), details: { targets: [] } })), /ablated/);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "cardioversion", date: at(T), details: {} })), /Electrical or pharmacological/);
});

test("rhythm profile: Fatma's paroxysmal AF with CHA2DS2-VA, apixaban dose check and her procedures; Abdullah's pacemaker; not shown without arrhythmia", async () => {
  const f: any = (await sumOf("Fatma Al-Ajmi")).rhythm;
  assert.equal(f.af.pattern, "Paroxysmal");
  assert.ok(f.stroke.score >= 2);
  assert.equal(f.stroke.advice, "OAC recommended (I)");
  assert.equal(f.anticoagulation[0].name, "Apixaban");
  assert.ok(f.anticoagulation[0].doseCheck);
  assert.deepEqual(f.events.map((e: any) => e.kind), ["ablation", "cardioversion"]);
  const cad: any = (await sumOf("Fatma Al-Ajmi")).cad;
  assert.ok(!cad.events.some((e: any) => e.kind === "ablation" || e.title === "Ablation"), "rhythm procedures are not coronary events");
  const a: any = (await sumOf("Abdullah Al-Enezi")).rhythm;
  assert.equal(a.af.pattern, "Permanent");
  assert.equal(a.devices[0].type, "Pacemaker (single chamber)");
  assert.equal(a.anticoagulation[0].doseCheck, "INR-guided");
  assert.equal((await sumOf("Noura Al-Kandari")).rhythm, null);
});

// ---- slice 2: AF-CARE ----
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])[0];
const run = (pid: string, wizard: string, answers: any, recommendationId?: string) =>
  tx(async (q) => { const r = await completeWizard(q, doc, pid, wizard, { answers, recommendationId }); await reassess(q, pid, "sandbox", r.changed); return r; });

test("Hamad: AF on today's ECG, not on the problem list → AF-CARE suggests the pattern, apixaban by CHA2DS2-VA, rate control, tests; completing it lists AF and starts apixaban", async () => {
  const pid = await byName("Hamad Al-Shammari");
  const r = await rec(pid, "rhythm.ecg-af-undiagnosed");
  assert.ok(r && r.severity === "orange");
  assert.match(r.title, /atrial fibrillation — not on the problem list/);
  assert.equal(await rec(pid, "rhythm.af-fast-rate"), undefined, "the undiagnosed-AF finding covers the rate");
  const ctx = (await tx((q) => getWizard(q, pid, "af-care"))).context;
  assert.ok(ctx.af!.score >= 2);
  assert.deepEqual(suggest("af-care", "pattern", {}, ctx).map((x) => x.value), ["first"]);
  assert.deepEqual(suggest("af-care", "oac", {}, ctx).map((x) => x.value), ["apixaban"]);
  assert.ok(suggest("af-care", "rate", { pattern: "first" }, ctx).length === 1, "rate 118: one rate-control suggestion");
  assert.ok(suggest("af-care", "comorb", {}, ctx).some((x) => x.value === "hf") || ctx.meds.some((m) => m.tags.includes("sglt2")));
  const done = await run(pid, "af-care", { pattern: "first", comorb: ["none"], oac: "apixaban", bleed: ["none"], rate: ["digoxin"], rhythm: ["none"], tests: ["bloods"], review: "none" }, r.id);
  assert.ok(done.assessment!.recommendations.some((x: string) => /6 months/.test(x)));
  const s = await loadState(db, pid);
  const af = s.conditions.find((c) => c.code === "af" && c.status === "active")!;
  assert.equal(af.attributes.pattern, "First diagnosed");
  const apx = s.meds.find((m) => m.code === "apixaban" && m.status === "active")!;
  assert.ok(apx && (apx.doseValue === 5 || apx.doseValue === 2.5));
  assert.ok(s.plan.some((p) => p.title === "Rate control: add digoxin"));
  assert.equal(await rec(pid, "rhythm.ecg-af-undiagnosed"), undefined, "AF now on the problem list");
  assert.equal(await rec(pid, "rhythm.af-first-plan"), undefined, "AF-CARE done for this AF");
  assert.equal((await rec(pid, "rhythm.af-fast-rate")).severity, "yellow", "the fast rate stands on its own now");
});

test("Abdullah (permanent AF, warfarin, ECG 112 bpm): fast-rate finding; AF-CARE suggests no rhythm control and keeps warfarin with his mechanical valve", async () => {
  const pid = await byName("Abdullah Al-Enezi");
  assert.match((await rec(pid, "rhythm.af-fast-rate")).title, /^AF at 112 bpm .*above the lenient target <110/);
  const ctx = (await tx((q) => getWizard(q, pid, "af-care"))).context;
  assert.deepEqual(suggest("af-care", "pattern", {}, ctx).map((x) => x.value), ["permanent"]);
  assert.deepEqual(suggest("af-care", "rhythm", { pattern: "permanent" }, ctx).map((x) => x.value), ["none"]);
  assert.deepEqual(suggest("af-care", "oac", {}, ctx).map((x) => x.value), ["continue"], "mechanical valve: warfarin stays");
});

test("aspirin alone for AF without vascular disease: AF-CARE suggests stopping it; completing stops aspirin", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Asa " + Date.now(), mrn: "Q" + Date.now(), sex: "Female", birthDate: "1950-01-01", conditions: ["af", "htn"] }));
  await tx(async (q) => { await K.startMedication(q, doc, pid, { code: "aspirin", doseValue: 100, frequency: "OD", route: "PO", indication: "af", effectiveAt: at(addDays(T, -100)) }); await reassess(q, pid, "sandbox"); });
  const ctx = (await tx((q) => getWizard(q, pid, "af-care"))).context;
  assert.ok(suggest("af-care", "bleed", {}, ctx).some((x) => x.value === "stop-asa"));
  await run(pid, "af-care", { pattern: "paroxysmal", comorb: ["none"], oac: "other-doac", bleed: ["stop-asa"], rate: ["none"], rhythm: ["ablation"], tests: ["none"], review: "none" });
  const s = await loadState(db, pid);
  assert.equal(s.meds.find((m) => m.code === "aspirin")!.status, "stopped");
  assert.ok(s.plan.some((p) => p.title === "Referral for AF catheter ablation"));
  assert.equal(s.conditions.find((c) => c.code === "af")!.attributes.pattern, "Paroxysmal");
});

// ---- slice 3: anticoagulation around cardioversion and ablation ----
test("Fatma (apixaban for 2 days): a cardioversion is dated 3 weeks after the apixaban start, with 4 weeks of anticoagulation after it", async () => {
  const pid = await byName("Fatma Al-Ajmi");
  const ctx = (await tx((q) => getWizard(q, pid, "peri-af-procedure"))).context;
  assert.deepEqual(suggest("peri-af-procedure", "oacNow", {}, ctx).map((x) => x.value), ["short"]);
  assert.deepEqual(suggest("peri-af-procedure", "prep", { onset: "ge24", oacNow: "short" }, ctx).map((x) => x.value), ["wait"]);
  await assert.rejects(run(pid, "peri-af-procedure", { proc: "cardioversion", when: addDays(T, -1), onset: "ge24", oacNow: "short", prep: "wait", post: ["oac"], review: "none" }), /later date/);
  await run(pid, "peri-af-procedure", { proc: "cardioversion", when: addDays(T, 3), onset: "ge24", oacNow: "short", prep: "wait", post: ["oac", "ecg"], review: "none" });
  const s = await loadState(db, pid);
  const apx = s.meds.find((m) => m.code === "apixaban" && m.status === "active")!;
  const from = new Date(apx.startedAt!).toISOString().slice(0, 10);
  const cv = s.plan.find((p) => p.title === "Cardioversion (after 3 weeks of effective anticoagulation)")!;
  assert.ok(cv.due_date! >= addDays(from, 20) && cv.due_date! <= addDays(from, 22));
  const after = s.plan.find((p) => /^Anticoagulation for at least 4 weeks after cardioversion/.test(p.title))!;
  assert.equal(after.due_date, addDays(cv.due_date!, 28));
  assert.equal(after.medication_id, apx.id);
  assert.equal(await rec(pid, "rhythm.cardioversion-before-3w"), undefined);
});

test("AF ablation: dated with uninterrupted anticoagulation and 2 months after; no anticoagulant after an ablation or a cardioversion is flagged", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Abl " + Date.now(), mrn: "B" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["af", "htn"] }));
  await tx(async (q) => { await K.startMedication(q, doc, pid, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(addDays(T, -100)) }); await reassess(q, pid, "sandbox"); });
  await run(pid, "peri-af-procedure", { proc: "ablation", when: addDays(T, 10), oacNow: "3w", post: ["oac", "holter"], review: "none" });
  let s = await loadState(db, pid);
  assert.equal(s.plan.find((p) => p.title === "AF catheter ablation (anticoagulation uninterrupted)")!.due_date, addDays(T, 10));
  assert.equal(s.plan.find((p) => /^Anticoagulation for at least 2 months after AF ablation/.test(p.title))!.due_date, addDays(T, 70));
  assert.equal(s.plan.find((p) => /^Ambulatory ECG 3 months after ablation/.test(p.title))!.due_date, addDays(T, 100));

  const p2 = await tx((q) => K.createPatient(q, doc, { name: "Cv " + Date.now(), mrn: "C2" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["af"] }));
  await tx(async (q) => { await K.recordProcedure(q, doc, p2, { kind: "cardioversion", date: at(addDays(T, -5)), details: { method: "Electrical", prep: "AF onset <24 h", result: "Sinus rhythm restored" } }); await reassess(q, p2, "sandbox"); });
  assert.match((await rec(p2, "rhythm.post-cardioversion-oac")).title, /^Cardioversion 5 days ago with no anticoagulant/);
  await tx(async (q) => { await K.recordProcedure(q, doc, p2, { kind: "ablation", date: at(addDays(T, -3)), details: { targets: ["AF (pulmonary vein isolation)"], energy: "Pulsed field" } }); await reassess(q, p2, "sandbox"); });
  assert.ok(await rec(p2, "rhythm.post-ablation-oac"));
  await tx(async (q) => { await K.startMedication(q, doc, p2, { code: "edoxaban", doseValue: 60, frequency: "OD", route: "PO", indication: "af", effectiveAt: at(T) }); await reassess(q, p2, "sandbox"); });
  assert.equal(await rec(p2, "rhythm.post-cardioversion-oac"), undefined);
  assert.equal(await rec(p2, "rhythm.post-ablation-oac"), undefined);
});

test("a cardioversion planned with no anticoagulant is flagged until anticoagulation covers 3 weeks", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Cv3 " + Date.now(), mrn: "C3" + Date.now(), sex: "Female", birthDate: "1962-01-01", conditions: ["af"] }));
  await run(pid, "af-care", { pattern: "persistent", comorb: ["none"], oac: "declined", bleed: ["none"], rate: ["none"], rhythm: ["cardioversion"], tests: ["none"], review: "none" });
  const r = await rec(pid, "rhythm.cardioversion-before-3w");
  assert.ok(r && r.severity === "yellow");
  assert.match(r.title, /no anticoagulant$/);
  await tx(async (q) => { await K.startMedication(q, doc, pid, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(T) }); await reassess(q, pid, "sandbox"); });
  assert.equal(await rec(pid, "rhythm.cardioversion-before-3w"), undefined, "apixaban today: 21 days before the planned date");
});

// ---- slice 4: device follow-up, ICD shock / VA ----
const check = (pid: string, day: string, findings: Record<string, unknown>, time = "10:00") =>
  tx(async (q) => { await K.recordStudy(q, doc, pid, { kind: "device_check", date: new Date(`${day}T${time}:00+03:00`).toISOString(), findings }); await reassess(q, pid, "sandbox"); });

test("device check template: validated, summarised; a shock is recognised", async () => {
  const { cleanStudy, studySummary, checkHasShock } = await import("../shared/studies.js");
  assert.throws(() => cleanStudy("device_check", { setting: "Remote", device: "ICD" }), /Battery is required/);
  const a = cleanStudy("device_check", { setting: "Remote", device: "ICD", battery: "OK", longevity: 6, vpace: 1, va: "Sustained VT", therapies: ["ATP", "Shock"], shocks: 1, shockType: "Appropriate (VT/VF)", storm: "No", bivpace: 98 });
  assert.equal(a.bivpace, undefined, "BiV pacing only for CRT");
  assert.equal(studySummary("device_check", a), "ICD remote check · battery 6 y · V-pacing 1% · Sustained VT · 1 shock · appropriate");
  assert.ok(checkHasShock(a));
});

test("Abdullah: pacemaker last checked 14 months ago → device check overdue (yellow); a check today clears it and sets the next one 12 months on", async () => {
  const pid = await byName("Abdullah Al-Enezi");
  const r = await rec(pid, "rhythm.device-check-due");
  assert.ok(r && r.severity === "yellow");
  assert.match(r.title, /^Pacemaker: device check overdue since/);
  assert.equal(r.action.template, "device-check");
  let dev: any = (await sumOf("Abdullah Al-Enezi")).rhythm.device;
  assert.equal(dev.intervalMonths, 12);
  assert.ok(dev.overdue);
  await check(pid, T, { setting: "In clinic", device: "Pacemaker", battery: "OK", longevity: 8.4, leads: "Normal", vpace: 95, va: "None" });
  assert.equal(await rec(pid, "rhythm.device-check-due"), undefined);
  dev = (await sumOf("Abdullah Al-Enezi")).rhythm.device;
  assert.equal(dev.overdue, false);
  assert.ok(dev.dueAt > addDays(T, 360) && dev.dueAt < addDays(T, 370));
});

test("battery at ERI, a lead problem and atrial high-rate episodes each raise their finding; a generator change clears the battery one", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ppm " + Date.now(), mrn: "P" + Date.now(), sex: "Female", birthDate: "1948-03-01", conditions: ["htn", "t2dm"] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -3000)), details: { type: "Pacemaker (dual chamber)", action: "New implant", indication: "Sinus node dysfunction", pacing: "RV pacing" } }));
  await check(pid, T, { setting: "In clinic", device: "Pacemaker", battery: "Elective replacement (ERI)", leads: "Abnormal", leadIssue: ["Noise / oversensing"], apace: 60, vpace: 12, ahre: "Yes", ahreLongest: "≥24 h", va: "None" });
  assert.equal((await rec(pid, "rhythm.device-battery")).severity, "orange");
  assert.match((await rec(pid, "rhythm.device-lead")).title, /lead problem/);
  const af = await rec(pid, "rhythm.device-af");
  assert.equal(af.severity, "yellow");
  assert.match(af.title, /longest ≥24 h/);
  assert.equal((await sumOf(((await db.query(`SELECT name FROM cf.patient WHERE id=$1`, [pid])).rows[0] as any).name)).rhythm.device.intervalMonths, 3, "near replacement: every 1–3 months");
  await tx(async (q) => { await K.recordProcedure(q, doc, pid, { kind: "device", date: at(T), details: { type: "Pacemaker (dual chamber)", action: "Generator change", indication: "Sinus node dysfunction" } }); await reassess(q, pid, "sandbox"); });
  assert.equal(await rec(pid, "rhythm.device-battery"), undefined);
  assert.ok(await rec(pid, "rhythm.device-lead"), "a generator change does not fix the lead");
  await tx(async (q) => { await K.startMedication(q, doc, pid, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(T) }); await reassess(q, pid, "sandbox"); });
  assert.equal(await rec(pid, "rhythm.device-af"), undefined, "anticoagulated");
  await check(pid, T, { setting: "Remote", device: "Pacemaker", battery: "End of service (EOS)", va: "None" }, "10:30");
  assert.equal((await rec(pid, "rhythm.device-battery")).severity, "red");
});

test("Bader: two appropriate shocks for VT on today's remote check → ICD shock pathway offered; suggestions from the check, potassium and amiodarone; completing opens an episode with an ablation referral", async () => {
  const pid = await byName("Bader Al-Mutairi");
  const r = await rec(pid, "event.icd-shock");
  assert.ok(r && r.severity === "orange");
  assert.match(r.title, /2 shocks/);
  const ctx = (await tx((q) => getWizard(q, pid, "icd-shock"))).context;
  assert.equal(ctx.device!.type, "CRT-D");
  assert.deepEqual(suggest("icd-shock", "what", {}, ctx).map((x) => x.value), ["multiple"]);
  assert.deepEqual(suggest("icd-shock", "interrogation", {}, ctx).map((x) => x.value), ["appropriate-mono"]);
  assert.deepEqual(suggest("icd-shock", "triggers", {}, ctx).map((x) => x.value), ["electrolytes"]);
  const acts = suggest("icd-shock", "actions", { what: "multiple", interrogation: "appropriate-mono", triggers: ["electrolytes"] }, ctx);
  assert.ok(acts.some((x) => x.value === "ablation" && /despite amiodarone.*\(ESC VA 2022, I\)/.test(x.why)));
  assert.ok(acts.some((x) => x.value === "bloods") && acts.some((x) => x.value === "remote"));
  assert.ok(!acts.some((x) => x.value === "sedation"), "not a storm");
  const done = await run(pid, "icd-shock", { what: "multiple", state: "stable", interrogation: "appropriate-mono", triggers: ["electrolytes"], actions: ["bloods", "ablation", "remote"], review: "clinic-14" }, r.id);
  assert.ok(done.episodeId);
  assert.ok(done.assessment!.recommendations.some((x: string) => /despite amiodarone: catheter ablation rather than escalating antiarrhythmics \(I\)/.test(x)));
  const s = await loadState(db, pid);
  assert.ok(s.plan.some((p) => p.title === "VT catheter ablation referral" && p.status === "planned"));
  assert.ok(s.episodes.some((e) => e.wizard === "icd-shock" && e.status === "open"));
  assert.equal(await rec(pid, "event.icd-shock"), undefined, "handled by the open episode");
  assert.equal(await rec(pid, "rhythm.device-check-due"), undefined, "checked today; CRT-D next in 6 months");
  assert.equal((await sumOf("Bader Al-Mutairi")).rhythm.device.intervalMonths, 6);
});

test("electrical storm on a device check → red offer; the pathway suggests monitoring, amiodarone, non-selective beta-blocker and sedation", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Icd " + Date.now(), mrn: "I" + Date.now(), sex: "Male", birthDate: "1960-06-01", conditions: ["hfref"] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -400)), details: { type: "ICD (transvenous)", action: "New implant", indication: "Secondary prevention ICD" } }));
  await check(pid, T, { setting: "Remote", device: "ICD", battery: "OK", va: "Sustained VT", therapies: ["Shock"], shocks: 4, shockType: "Appropriate (VT/VF)", storm: "Yes" });
  const r = await rec(pid, "event.icd-shock");
  assert.equal(r.severity, "red");
  assert.match(r.title, /electrical storm/);
  const ctx = (await tx((q) => getWizard(q, pid, "icd-shock"))).context;
  assert.deepEqual(suggest("icd-shock", "what", {}, ctx).map((x) => x.value), ["storm"]);
  const acts = suggest("icd-shock", "actions", { what: "storm", interrogation: "appropriate-mono" }, ctx).map((x) => x.value);
  for (const v of ["monitor", "amiodarone", "bb", "sedation", "reprogram"]) assert.ok(acts.includes(v), v);
});

test("after a new implant: first in-person check 2–12 weeks, clinic wound check 7–10 days (owner-approved), remote monitoring when not enrolled; each clears when done or planned", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Implant " + Date.now(), mrn: "N" + Date.now(), sex: "Male", birthDate: "1955-02-01", conditions: ["av-block"] }));
  const day = addDays(T, -3);
  await tx(async (q) => { await K.recordProcedure(q, doc, pid, { kind: "device", date: at(day), details: { type: "Pacemaker (dual chamber)", action: "New implant", indication: "AV block", pacing: "RV pacing", remote: "Not enrolled" } }); await reassess(q, pid, "sandbox"); });
  const status = async (rule: string) => ((await db.query(`SELECT rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])[0]?.rule_status;
  const first = await rec(pid, "rhythm.device-first-check");
  assert.equal(first.severity, "yellow");
  assert.match(first.title, /first in-person device check due/);
  assert.equal(await status("rhythm.device-first-check"), "PUBLISHED");
  assert.match((await rec(pid, "rhythm.device-wound-check")).title, /clinic wound check/);
  assert.equal(await status("rhythm.device-wound-check"), "PUBLISHED", "local 7–10 days, approved by the clinical owner");
  assert.match((await rec(pid, "rhythm.remote-monitoring")).title, /remote monitoring not started/);
  await tx(async (q) => { await K.addPlanAction(q, doc, pid, { category: "follow_up", title: "Device wound check", dueDate: addDays(day, 8), completesOn: { type: "manual" } }); await reassess(q, pid, "sandbox", ["plan"]); });
  assert.equal(await rec(pid, "rhythm.device-wound-check"), undefined);
  await check(pid, T, { setting: "Remote", device: "Pacemaker", battery: "OK", va: "None" });
  assert.equal(await rec(pid, "rhythm.remote-monitoring"), undefined, "a remote check shows enrolment");
  assert.ok(await rec(pid, "rhythm.device-first-check"), "a remote check is not the in-person check");
  await check(pid, T, { setting: "In clinic", device: "Pacemaker", battery: "OK", leads: "Normal", va: "None" }, "10:30");
  assert.equal(await rec(pid, "rhythm.device-first-check"), undefined);
});

test("the clinic wound check clears with a clinic visit from day 7, and does not apply to a leadless pacemaker", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Wound " + Date.now(), mrn: "W" + Date.now(), sex: "Male", birthDate: "1950-05-01", conditions: ["av-block"] }));
  await tx(async (q) => { await K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -8)), details: { type: "Pacemaker (dual chamber)", action: "New implant", indication: "AV block" } }); await reassess(q, pid, "sandbox"); });
  assert.ok(await rec(pid, "rhythm.device-wound-check"));
  await tx(async (q) => { await K.startVisit(q, doc, pid, { reasons: ["Device"], symptoms: ["No symptoms"], service: "Cardiology clinic", startedAt: new Date().toISOString() } as any); await reassess(q, pid, "sandbox", ["contexts"]); });
  assert.equal(await rec(pid, "rhythm.device-wound-check"), undefined, "seen in the clinic");
  const p2 = await tx((q) => K.createPatient(q, doc, { name: "Leadless " + Date.now(), mrn: "LL" + Date.now(), sex: "Male", birthDate: "1945-05-01", conditions: ["av-block"] }));
  await tx(async (q) => { await K.recordProcedure(q, doc, p2, { kind: "device", date: at(addDays(T, -8)), details: { type: "Leadless pacemaker", action: "New implant", indication: "AV block" } }); await reassess(q, p2, "sandbox"); });
  assert.equal(await rec(p2, "rhythm.device-wound-check"), undefined, "no pocket");
});
