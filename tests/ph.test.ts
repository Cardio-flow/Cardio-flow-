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
  assert.equal(f.action.template, "ph-referral");
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
