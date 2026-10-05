// Pulmonary hypertension module, slice 1: echo probability of PH (ESC/ERS 2022), the PH diagnosis
// and panel, and the referral finding.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { summary } from "../server/kernel/views.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { phEchoProbability } from "../shared/ph.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, detail, action, rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[]);
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("echo probability (ESC/ERS 2022): TRV bands and signs from ≥2 categories", () => {
  assert.equal(phEchoProbability(2.6, []).probability, "low");
  assert.equal(phEchoProbability(null, ["rv-lv"]).probability, "low", "one category is not enough");
  assert.equal(phEchoProbability(2.6, ["rv-lv", "pa"]).probability, "intermediate");
  assert.equal(phEchoProbability(3.1, []).probability, "intermediate");
  assert.equal(phEchoProbability(3.1, ["rv-lv", "septum"]).probability, "intermediate", "two signs from one category");
  assert.equal(phEchoProbability(3.1, ["septum", "ivc"]).probability, "high");
  assert.equal(phEchoProbability(3.5, []).probability, "high");
  assert.equal(phEchoProbability(2.8, ["ra", "pr"]).probability, "intermediate", "2.8 is not above the threshold");
});

test("Huda (TRV 3.8 m/s, RV/LV >1, PA 31 mm): high probability → orange referral finding; the panel shows it; a planned referral quiets it", async () => {
  const pid = await byName("Huda Al-Mansour");
  const f = (await rec(pid, "ph.echo-probability"))[0];
  assert.equal(f.severity, "orange");
  assert.equal(f.title, "High echo probability of pulmonary hypertension (TRV 3.8 m/s)");
  assert.equal(f.rule_status, "PUBLISHED");
  assert.equal(f.action.wizard, "ph-suspected");
  const p = (await tx((q) => summary(q, pid, "sandbox")) as any).ph;
  assert.equal(p.echo.probability, "high");
  assert.deepEqual(p.echo.categories, ["A", "B"]);
  assert.equal(p.listed, null);
  assert.deepEqual(p.values.map((x: any) => x.code), ["trv", "spap", "nt-probnp"]);
  const s = await loadState(db, pid);
  assert.deepEqual(s.studies.find((x) => x.kind === "echo")!.attributes.phSigns, ["rv-lv", "pa"]);
  await tx((q) => K.addPlanAction(q, doc, pid, { category: "referral", title: "PH centre referral: right heart catheterisation (pulmonary hypertension work-up)", dueDate: addDays(T, 14), completesOn: { type: "manual" } } as any));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "ph.echo-probability")).length, 0);
});

test("intermediate probability → yellow; low probability → no finding and no panel", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ph Int " + Date.now(), mrn: "PI" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: [] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 60, findings: [], measures: { trv: 3.0 } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "ph.echo-probability"))[0].severity, "yellow");
  const low = await tx((q) => K.createPatient(q, doc, { name: "Ph Low " + Date.now(), mrn: "PL" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: [] }));
  await tx((q) => K.recordEcho(q, doc, low, { date: at(T), quality: "formal", lvef: 60, findings: [], measures: { trv: 2.5 } }));
  await tx((q) => reassess(q, low, "sandbox"));
  assert.equal((await rec(low, "ph.echo-probability")).length, 0);
  assert.equal((await tx((q) => summary(q, low, "sandbox")) as any).ph, null);
});

// ---- slice 2: right heart catheterisation ----
import { rhcClass, rhcPvr } from "../shared/procedures.js";
test("RHC classification (ESC/ERS 2022): pre-capillary, isolated and combined post-capillary, no PH; PVR computed from cardiac output", () => {
  assert.equal(rhcPvr({ mpap: 45, pawp: 10, co: 4 }), 8.8);
  assert.equal(rhcClass({ mpap: 45, pawp: 10, co: 4 }), "Pre-capillary");
  assert.equal(rhcClass({ mpap: 30, pawp: 22, co: 5 }), "Isolated post-capillary");
  assert.equal(rhcClass({ mpap: 40, pawp: 20, pvr: 3.5 }), "Combined post- and pre-capillary");
  assert.equal(rhcClass({ mpap: 20, pawp: 8, pvr: 1.2 }), "No pulmonary hypertension at rest");
  assert.equal(rhcClass({ mpap: 24, pawp: 10, pvr: 1.5 }), "mPAP >20 with PAWP ≤15 and PVR ≤2 (neither pre- nor post-capillary)");
  assert.equal(rhcClass({ mpap: 30, pawp: 10 }), "PH (PVR not available)");
});

test("Huda's RHC: pre-capillary PH → listed with its haemodynamics, measurements recorded, the echo finding goes quiet, the panel shows the catheter", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Rhc " + Date.now(), mrn: "RH" + Date.now(), sex: "Female", birthDate: "1972-01-01", conditions: [] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(addDays(T, -10)), quality: "formal", lvef: 62, findings: [], measures: { trv: 3.9 } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "ph.echo-probability")).length, 1);
  const r = await tx((q) => K.recordProcedure(q, doc, pid, { kind: "rhc", date: at(T), details: { mpap: 44, pawp: 9, co: 3.8, rap: 11, svo2: 62, vasoreactivity: "Negative" } }));
  assert.ok(r.changed.includes("mpap"));
  await tx((q) => reassess(q, pid, "sandbox"));
  const s = await loadState(db, pid);
  const ph = s.conditions.find((c) => c.code === "ph")!;
  assert.equal(ph.attributes.haemo, "Pre-capillary");
  assert.equal(ph.attributes.group, "Not yet classified");
  assert.equal(s.resolved("pvr").current!.value_num, 9.2);
  const p = s.procedures.find((x) => x.kind === "rhc")!;
  assert.equal(p.summary, "mPAP 44 · PAWP 9 · PVR 9.2 WU · pre-capillary PH · vasoreactivity negative");
  assert.equal((await rec(pid, "ph.echo-probability")).length, 0);
  const v = (await tx((q) => summary(q, pid, "sandbox")) as any).ph;
  assert.equal(v.rhc.class, "Pre-capillary");
  assert.deepEqual(v.values.map((x: any) => x.code), ["mpap", "pawp", "pvr", "trv"]);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "rhc", date: at(T), details: { mpap: 44 } })), /wedge pressure are required/);
});

// ---- slice 3: PAH four-strata risk ----
import { fourStrata } from "../shared/ph.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { suggest } from "../shared/wizard-guidance.js";
test("four-strata model (ESC/ERS 2022): points per variable, mean rounded to the nearest integer, missing variables", () => {
  const r = fourStrata({ fc: "III", sixmwd: 350, ntprobnp: 820 });
  assert.deepEqual(r.items.map((i) => i.score), [3, 2, 3]);
  assert.equal(r.mean, 2.67);
  assert.equal(r.category, "intermediate-high");
  assert.equal(fourStrata({ fc: "II", sixmwd: 480, ntprobnp: 210 }).category, "low");
  assert.equal(fourStrata({ fc: "II", sixmwd: 400, ntprobnp: 500 }).category, "intermediate-low", "1,2,2 → 1.67 → 2");
  assert.equal(fourStrata({ fc: "IV", sixmwd: 150, ntprobnp: 2400 }).category, "high");
  assert.deepEqual(fourStrata({ fc: null, sixmwd: 300, ntprobnp: null }).missing, ["functional class", "NT-proBNP"]);
});

test("Nadia (PAH on ERA + PDE5i, NYHA III, 6MWD 350, NT-proBNP 820): intermediate-high → orange; the pathway suggests IV/SC prostacyclin and transplant evaluation and dates the reassessment", async () => {
  const pid = await byName("Nadia Al-Ali");
  const f = (await rec(pid, "ph.pah-risk"))[0];
  assert.equal(f.severity, "orange");
  assert.equal(f.title, "PAH: intermediate-high risk on the latest values — review therapy (goal: low risk)");
  const w = await tx((q) => getWizard(q, pid, "pah-followup"));
  assert.deepEqual(w.context.detected.therapy, ["era", "pde5"]);
  assert.deepEqual(suggest("pah-followup", "stage", {}, w.context).map((x) => x.value), ["follow"]);
  const a = { stage: "follow", comorbid: "no", therapy: ["era", "pde5"] };
  assert.deepEqual(suggest("pah-followup", "actions", a, w.context).map((x) => x.value), ["parenteral", "transplant"]);
  const done = await tx((q) => completeWizard(q, doc, pid, "pah-followup", { answers: { ...a, actions: ["parenteral", "transplant"], reassess: "91" }, recommendationId: f.id } as any));
  assert.ok(done.assessment!.recommendations.some((x: string) => /IV\/SC prostacyclin analogue and\/or refer for lung transplant/.test(x)));
  const s = await loadState(db, pid);
  assert.equal(String(s.plan.find((p) => /^PAH: risk reassessment/.test(p.title))!.due_date).slice(0, 10), addDays(T, 91));
  assert.ok(s.plan.some((p) => p.title === "Lung transplant evaluation (PAH)"));
  assert.equal((await rec(pid, "ph.pah-risk")).length, 0);
  const v = (await tx((q) => summary(q, pid, "sandbox")) as any).ph;
  assert.equal(v.strata.category, "intermediate-high");
});

// ---- slice 4: CTEPH after pulmonary embolism; PH with left heart or lung disease ----
test("Khalid (PE 5 months ago, NYHA II, TRV 3.0): orange CTEPH evaluation finding; the pathway suggests the work-up, then confirmed CTEPH lists PH group 4 and the anticoagulation rule reads the DOAC with APS", async () => {
  const pid = await byName("Khalid Al-Dosari");
  const f = (await rec(pid, "ph.after-pe"))[0];
  assert.equal(f.severity, "orange");
  assert.equal(f.rule_status, "PUBLISHED");
  assert.match(f.detail, /^NYHA II and intermediate echo probability of PH more than 3 months after the embolism/);
  assert.equal(f.action.wizard, "post-pe");
  const w = await tx((q) => getWizard(q, pid, "post-pe"));
  assert.deepEqual(w.context.detected.time, ["3m"]);
  assert.deepEqual(w.context.detected.symptoms, ["yes"], "NYHA II after the embolism");
  assert.deepEqual(w.context.ph!.anticoagulants, [{ name: "Apixaban", doac: true }]);
  assert.deepEqual(suggest("post-pe", "actions", { time: "3m", symptoms: "yes", vq: "none", dx: "pending" }, w.context).map((x) => x.value), ["workup"]);
  assert.deepEqual(suggest("post-pe", "actions", { time: "3m", symptoms: "yes", vq: "mismatch", dx: "pending" }, w.context).map((x) => x.value), ["refer"]);
  const done = await tx((q) => completeWizard(q, doc, pid, "post-pe", { answers: { time: "3m", symptoms: "yes", vq: "mismatch", dx: "cteph", actions: ["team", "aps", "follow"] }, recommendationId: f.id } as any));
  assert.ok(done.assessment!.recommendations.some((x: string) => /Lifelong therapeutic anticoagulation in all patients with CTEPH \(I\)/.test(x)));
  let s = await loadState(db, pid);
  assert.equal(s.conditions.find((c) => c.code === "ph")!.attributes.group, "Group 4 · CTEPH / PA obstruction");
  assert.ok(s.plan.some((p) => p.title === "CTEPH team review: multimodality management (PEA, BPA, riociguat)"));
  assert.equal((await rec(pid, "ph.after-pe")).length, 0, "quiet once CTEPH is listed");
  assert.equal((await rec(pid, "ph.cteph-anticoagulation")).length, 0, "on apixaban, no APS");
  assert.equal((await rec(pid, "ph.cteph-team")).length, 0, "the pathway was completed");
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: new Date().toISOString(), add: [{ code: "aps" }] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  const aps = (await rec(pid, "ph.cteph-anticoagulation"))[0];
  assert.equal(aps.severity, "orange");
  assert.equal(aps.title, "CTEPH with antiphospholipid syndrome on a DOAC: a VKA is recommended");
});

test("after PE: quiet before 3 months and without symptoms; CTEPH with no anticoagulant → orange", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Pe Early " + Date.now(), mrn: "PE" + Date.now(), sex: "Female", birthDate: "1970-01-01", conditions: [] }));
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: at(addDays(T, -40)), add: [{ code: "pe", onset: addDays(T, -40) }] }));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(T), items: [{ code: "nyha", text: "II" }] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "ph.after-pe")).length, 0, "less than 3 months");
  const late = await tx((q) => K.createPatient(q, doc, { name: "Pe Late " + Date.now(), mrn: "PL" + Date.now(), sex: "Female", birthDate: "1970-01-01", conditions: [] }));
  await tx((q) => K.recordHistory(q, doc, late, { effectiveAt: at(addDays(T, -200)), add: [{ code: "pe", onset: addDays(T, -200) }] }));
  await tx((q) => K.recordObservations(q, doc, late, { effectiveAt: at(T), items: [{ code: "nyha", text: "I" }] }));
  await tx((q) => reassess(q, late, "sandbox"));
  assert.equal((await rec(late, "ph.after-pe")).length, 0, "NYHA I, no echo");
  await tx((q) => K.recordObservations(q, doc, late, { effectiveAt: new Date().toISOString(), items: [{ code: "nyha", text: "III" }] }));
  await tx((q) => reassess(q, late, "sandbox"));
  assert.equal((await rec(late, "ph.after-pe"))[0].severity, "yellow", "NYHA III without an echo");
  await tx((q) => K.recordHistory(q, doc, late, { effectiveAt: new Date().toISOString(), add: [{ code: "ph", attributes: { group: "Group 4 · CTEPH / PA obstruction" } }] }));
  await tx((q) => reassess(q, late, "sandbox"));
  assert.equal((await rec(late, "ph.cteph-anticoagulation"))[0].title, "CTEPH without anticoagulation: lifelong therapeutic anticoagulation is recommended");
  assert.equal((await rec(late, "ph.cteph-team"))[0].action.template, "cteph-team");
  assert.equal((await rec(late, "ph.after-pe")).length, 0);
});

test("Mona (HFpEF, combined post- and pre-capillary PH, PVR 5.5 WU, on sildenafil): orange PH centre referral, yellow PAH-drug review; the pathway detects left heart disease", async () => {
  const pid = await byName("Mona Al-Harbi");
  const r = (await rec(pid, "ph.severe-precapillary"))[0];
  assert.equal(r.severity, "orange");
  assert.equal(r.title, "PH with left heart disease and PVR 5.5 WU: refer to a PH centre");
  const d = (await rec(pid, "ph.pah-drug-group-2-3"))[0];
  assert.equal(d.severity, "yellow");
  assert.equal(d.title, "PAH drug in PH from left heart disease");
  const w = await tx((q) => getWizard(q, pid, "ph-lhd-lung"));
  assert.deepEqual(w.context.detected.cause, ["lhd"]);
  assert.deepEqual(suggest("ph-lhd-lung", "actions", { cause: ["lhd"], optimised: "yes", rv: "no" }, w.context).map((x) => x.value), ["refer"]);
  const done = await tx((q) => completeWizard(q, doc, pid, "ph-lhd-lung", { answers: { cause: ["lhd"], optimised: "yes", rv: "no", actions: ["refer"] }, recommendationId: r.id } as any));
  assert.ok(done.assessment!.recommendations.some((x: string) => /PVR 5.5 WU \(>5\): refer to a PH centre/.test(x)));
  assert.equal((await rec(pid, "ph.severe-precapillary")).length, 0, "referral planned");
});

test("group 3: ambrisentan with IPF and riociguat with an IIP → orange (III); non-severe PH on a PDE5i → yellow", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ph Ild " + Date.now(), mrn: "PD" + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions: [] }));
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: new Date().toISOString(), add: [{ code: "ild", attributes: { type: "IPF" } }, { code: "ph", attributes: { group: "Group 3 · lung disease / hypoxia" } }] }));
  for (const code of ["ambrisentan", "riociguat"]) {
    const def = (await import("../shared/catalog.js")).MEDICATION[code];
    await tx((q) => K.startMedication(q, doc, pid, { code, doseValue: def.doses[0], frequency: def.frequencies[0], route: "PO", indication: "ph", effectiveAt: new Date().toISOString() } as any));
  }
  await tx((q) => reassess(q, pid, "sandbox"));
  const f = await rec(pid, "ph.pah-drug-group-2-3");
  assert.deepEqual(f.map((x) => x.severity).sort(), ["orange", "orange"]);
  assert.ok(f.some((x) => x.title === "Ambrisentan in PH with idiopathic pulmonary fibrosis: not recommended"));
  const ns = await tx((q) => K.createPatient(q, doc, { name: "Ph Copd " + Date.now(), mrn: "PC" + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions: ["copd"] }));
  await tx((q) => K.recordProcedure(q, doc, ns, { kind: "rhc", date: new Date().toISOString(), details: { mpap: 28, pawp: 10, co: 5.0 } }));
  const ph = ((await db.query(`SELECT logical_id FROM cf.condition WHERE patient_id=$1 AND code='ph' LIMIT 1`, [ns])).rows[0] as any).logical_id;
  await tx((q) => K.recordHistory(q, doc, ns, { effectiveAt: new Date().toISOString(), update: [{ logicalId: ph, attributes: { group: "Group 3 · lung disease / hypoxia" } }] }));
  await tx((q) => K.startMedication(q, doc, ns, { code: "sildenafil", doseValue: 20, frequency: "TID", route: "PO", indication: "ph", effectiveAt: new Date().toISOString() } as any));
  await tx((q) => reassess(q, ns, "sandbox"));
  const y = (await rec(ns, "ph.pah-drug-group-2-3"))[0];
  assert.equal(y.severity, "yellow");
  assert.match(y.detail, /^PVR 3\.6 WU \(not >5\)/);
  assert.equal((await rec(ns, "ph.severe-precapillary")).length, 0);
});

// ---- slice 5: suspected pulmonary hypertension ----
test("suspected PH pathway: Huda's high echo probability is prefilled; risk factors → PH centre referral (I C); warning signs → immediate referral; no risk factors → lung work-up", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ph Susp " + Date.now(), mrn: "PS" + Date.now(), sex: "Female", birthDate: "1970-01-01", conditions: [] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 62, findings: [], measures: { trv: 3.6 } }));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: new Date().toISOString(), items: [{ code: "nyha", text: "III" }] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "ph.echo-probability"))[0].action.wizard, "ph-suspected");
  const w = await tx((q) => getWizard(q, pid, "ph-suspected"));
  assert.deepEqual(w.context.detected.echo, ["high"]);
  assert.deepEqual(w.context.detected.warning, ["severe"]);
  const s1 = suggest("ph-suspected", "actions", { warning: ["severe"], echo: "high", risk: ["ctd"], cause: ["none"] }, w.context).map((x) => x.value);
  assert.deepEqual(s1, ["urgent"]);
  assert.deepEqual(suggest("ph-suspected", "actions", { warning: ["none"], echo: "high", risk: ["ctd"], cause: ["none"] }, w.context).map((x) => x.value), ["refer"]);
  assert.deepEqual(suggest("ph-suspected", "actions", { warning: ["none"], echo: "intermediate", risk: ["none"], cause: ["none"] }, w.context).map((x) => x.value), ["lung", "cpet"]);
  const done = await tx((q) => completeWizard(q, doc, pid, "ph-suspected", { answers: { warning: ["severe"], echo: "high", risk: ["pe"], cause: ["none"], actions: ["urgent", "vq"] } } as any));
  assert.ok(done.assessment!.recommendations.includes("Warning signs: refer immediately to a PH centre."));
  assert.ok(done.assessment!.recommendations.some((x: string) => /V\/Q scan \(I C\)/.test(x)));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "ph.echo-probability")).length, 0, "a PH centre referral is planned");
});
