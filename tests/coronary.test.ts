// Coronary module, slice 1: PCI/CABG as dated procedures (migration 005) and the coronary profile.
// Slice 2: the antithrombotic plan pathway and the coronary rules.
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

test("a PCI is recorded with its date and setting, adds past PCI to the problem list, and is append-only", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Cor " + Date.now(), mrn: "C" + Date.now(), sex: "Male", birthDate: "1962-01-01", conditions: ["cad-ccs"] }));
  const r = await tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -10)), details: { setting: "elective", vessels: ["LAD", "LCx"], device: "Drug-eluting stent", stents: 3, complex: ["≥3 stents"], access: "Radial" } }));
  const s = await loadState(db, pid);
  assert.equal(s.procedures.length, 1);
  assert.equal(s.procedures[0].summary, "LAD, LCx DES ×3 · Elective (chronic coronary syndrome) · complex PCI");
  const pciDx = s.conditions.find((c) => c.code === "prior-pci")!;
  assert.equal(pciDx.onset?.slice?.(0, 10) ?? String(pciDx.onset).slice(0, 10), addDays(T, -10));
  assert.deepEqual(pciDx.attributes.vessels, ["LAD", "LCx"]);
  await assert.rejects(db.query(`UPDATE cf.procedure SET summary='x' WHERE id=$1`, [r.id]), /append-only/);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, 2)), details: { setting: "elective", vessels: ["RCA"] } })), /future/);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(T), details: { setting: "elective", vessels: [] } })), /vessel/);
  const j = (await db.query(`SELECT title FROM cf.clinical_event WHERE patient_id=$1 AND category='procedure'`, [pid])).rows as any[];
  assert.match(j[0].title, /^PCI · LAD, LCx DES ×3/);
});

test("coronary profile: events in order, index event, regimen names, LDL against goal", async () => {
  const f: any = (await sumOf("Fatma Al-Ajmi")).cad;
  assert.equal(f.antithrombotic.regimen, "Triple therapy");
  assert.deepEqual(f.antithrombotic.drugs.map((d: any) => d.role).sort(), ["Anticoagulant", "Aspirin", "P2Y12 inhibitor"]);
  assert.ok(f.index.acs, "NSTEMI admission + PCI: acute coronary syndrome");
  assert.equal(f.index.kind, "pci");
  assert.ok(f.events.some((e: any) => e.kind === "acs") && f.events.some((e: any) => e.kind === "pci"));
  const sa: any = (await sumOf("Salem Al-Rashidi")).cad;
  assert.equal(sa.antithrombotic.regimen, "DAPT");
  assert.equal(sa.index.acs, false, "elective PCI: chronic coronary syndrome");
  assert.ok(sa.index.days >= 159 && sa.index.days <= 161);
  const n: any = (await sumOf("Noura Al-Kandari")).cad;
  assert.equal(n.lipids.goal.value, 1.4);
  assert.equal(n.lipids.atGoal, false);
  assert.ok(n.rehab, "rehab referral from the discharge plan is shown");
  const h: any = (await sumOf("Huda Al-Sabah")).cad;
  assert.equal(h, null, "no coronary disease: no panel");
});

test("CABG: grafts recorded, past CABG added once", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Cabg " + Date.now(), mrn: "G" + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "cabg", date: at(addDays(T, -400)), details: { grafts: ["LIMA to LAD", "Vein grafts"], count: 3 } }));
  const s = await loadState(db, pid);
  assert.equal(s.procedures[0].summary, "3 grafts · LIMA to LAD, Vein grafts");
  assert.deepEqual(s.conditions.find((c) => c.code === "prior-cabg")!.attributes.grafts, ["LIMA", "Vein grafts"]);
  assert.ok(s.tags.has("cad"));
});

// ---- slice 2: antithrombotic timeline ----
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])[0];
const complete = (pid: string, answers: any, recommendationId?: string) =>
  tx(async (q) => { const r = await completeWizard(q, doc, pid, "antithrombotic", { answers: { from: "recorded", ...answers }, recommendationId }); await reassess(q, pid, "sandbox", r.changed); return r; });
const newCad = (name: string) => tx((q) => K.createPatient(q, doc, { name: name + " " + Date.now(), mrn: "A" + Math.random().toString(36).slice(2, 8) + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["cad-ccs"] }));
const start = (pid: string, code: string, dose: number, freq: string, indication: string, days: number) =>
  tx(async (q) => { await K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(addDays(T, days)) }); await reassess(q, pid, "sandbox"); });
const pci = (pid: string, days: number, setting: string) =>
  tx(async (q) => { const r = await K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, days)), details: { setting, vessels: ["LAD"], device: "Drug-eluting stent", stents: 1 } }); await reassess(q, pid, "sandbox", r.changed); });

test("Fatma (NSTE-ACS PCI on apixaban + aspirin + ticagrelor): switch to clopidogrel, 1 week of triple therapy, dual therapy to 12 months", async () => {
  const pid = await byName("Fatma Al-Ajmi");
  const potent = await rec(pid, "cad.potent-p2y12-with-oac");
  assert.ok(potent, "ticagrelor with an anticoagulant is flagged");
  assert.equal(potent.severity, "orange");
  assert.equal(await rec(pid, "cad.antithrombotic-plan"), undefined, "the more specific finding stands alone");
  assert.equal((await rec(pid, "cad.ppi-combined-antithrombotic")).severity, "yellow");
  const pciAt = (await loadState(db, pid)).procedures.find((p) => p.kind === "pci")!.performed_at.slice(0, 10);

  await complete(pid, { setting: "acs", oac: "yes", hbr: ["oac-long"], ischaemic: ["none"], tat: "1w", dual: "12m", now: ["to-clopidogrel", "ppi"], review: "none" }, potent.id);
  const s = await loadState(db, pid);
  const live = s.meds.filter((m) => m.status === "active").map((m) => m.code);
  assert.ok(!live.includes("ticagrelor") && live.includes("clopidogrel") && live.includes("pantoprazole"));
  const cad: any = (await sumOf("Fatma Al-Ajmi")).cad;
  const stop = (code: string) => cad.antithrombotic.drugs.find((d: any) => d.id === s.meds.find((m) => m.code === code && m.status === "active")!.id).plannedStop;
  assert.equal(stop("aspirin").at, addDays(pciAt, 7));
  assert.match(stop("aspirin").title, /End of triple therapy: stop aspirin/);
  assert.equal(stop("clopidogrel").at, addDays(pciAt, 365));
  assert.equal(stop("apixaban"), null, "the anticoagulant continues");
  for (const r of ["cad.potent-p2y12-with-oac", "cad.antithrombotic-plan", "cad.ppi-combined-antithrombotic"]) assert.equal(await rec(pid, r), undefined, r);
  assert.ok(await rec(pid, "cad.acs-bundle"), "the ACS bundle (with rehabilitation) is still due");
  assert.equal(await rec(pid, "cad.rehab"), undefined, "rehabilitation is carried by the bundle");
});

test("Salem (elective PCI, DAPT): 6-month DAPT then clopidogrel alone; Noura (STEMI): 12 months then aspirin", async () => {
  const sa = await byName("Salem Al-Rashidi");
  const r = await rec(sa, "cad.antithrombotic-plan");
  assert.match(r.title, /^Elective PCI .*antithrombotic stop dates not set/);
  await complete(sa, { setting: "ccs", oac: "no", hbr: ["none"], ischaemic: ["none"], dapt: "6m", sapt: "clopidogrel", now: ["none"], review: "none" }, r.id);
  let s = await loadState(db, sa);
  const pciAt = s.procedures.find((p) => p.kind === "pci")!.performed_at.slice(0, 10);
  const asp = s.meds.find((m) => m.code === "aspirin" && m.status === "active")!;
  const item = s.plan.find((p) => p.medication_id === asp.id && p.status === "planned")!;
  assert.equal(item.due_date, addDays(pciAt, 182));
  assert.match(item.title, /End of 6-month DAPT: stop aspirin, continue clopidogrel/);
  assert.equal(await rec(sa, "cad.antithrombotic-plan"), undefined);

  const no = await byName("Noura Al-Kandari");
  await complete(no, { setting: "acs", oac: "no", hbr: ["none"], ischaemic: ["none"], dapt: "12m", sapt: "aspirin", now: ["none"], review: "none" });
  s = await loadState(db, no);
  const p2 = s.meds.find((m) => m.tags.includes("p2y12") && m.status === "active")!;
  const it = s.plan.find((p) => p.medication_id === p2.id && p.status === "planned")!;
  assert.equal(it.due_date, addDays(s.procedures.find((p) => p.kind === "pci")!.performed_at.slice(0, 10), 365));
  assert.match(it.title, /End of 12-month DAPT: stop .*, continue aspirin/);
  assert.equal(await rec(no, "cad.rehab"), undefined, "Noura has a rehabilitation referral");
});

test("DAPT beyond the default and triple therapy beyond 1 month are flagged", async () => {
  const a = await newCad("Dapt");
  await pci(a, -200, "elective");
  await start(a, "aspirin", 81, "OD", "cad", -200);
  await start(a, "clopidogrel", 75, "OD", "cad", -200);
  const d = await rec(a, "cad.dapt-beyond-default");
  assert.ok(d);
  assert.equal(d.severity, "yellow");
  assert.match(d.title, /beyond the 6-month default/);
  assert.equal(await rec(a, "cad.antithrombotic-plan"), undefined, "elective PCI more than 6 months ago: the plan finding gives way");

  const b = await newCad("Triple");
  await pci(b, -60, "nste-acs");
  await start(b, "apixaban", 5, "BID", "af", -60);
  await start(b, "aspirin", 81, "OD", "cad", -60);
  await start(b, "clopidogrel", 75, "OD", "cad", -60);
  const t = await rec(b, "cad.triple-beyond-1-month");
  assert.ok(t);
  assert.match(t.title, /^Triple therapy 2 months after PCI: stop aspirin/);
  const act = typeof t.action === "string" ? JSON.parse(t.action) : t.action;
  assert.equal(act.type, "med-action");
  assert.equal(await rec(b, "cad.dapt-beyond-default"), undefined, "no DAPT finding on an anticoagulant");
});

// ---- slice 3: ACS discharge bundle ----
const run = (pid: string, wizard: string, answers: any, recommendationId?: string) =>
  tx(async (q) => { const r = await completeWizard(q, doc, pid, wizard, { answers, recommendationId }); await reassess(q, pid, "sandbox", r.changed); return r; });

test("Noura (STEMI, no LVEF since): the bundle is offered once, suggests echo and lipids, and dates follow-up from the ACS", async () => {
  const pid = await byName("Noura Al-Kandari");
  const b = await rec(pid, "cad.acs-bundle");
  assert.ok(b && b.severity === "orange");
  assert.match(b.title, /secondary-prevention bundle not completed/);
  assert.equal(await rec(pid, "cad.rehab"), undefined, "the bundle carries rehabilitation");
  const ctx = (await tx((q) => getWizard(q, pid, "acs-discharge"))).context;
  assert.deepEqual(suggest("acs-discharge", "type", {}, ctx).map((x) => x.value), ["stemi"]);
  assert.deepEqual(suggest("acs-discharge", "lvef", {}, ctx).map((x) => x.value), ["not-measured"]);
  assert.ok(!suggest("acs-discharge", "start", { lvef: "not-measured" }, ctx).some((x) => x.value === "statin"), "already on atorvastatin 80");
  assert.ok(!suggest("acs-discharge", "prevent", {}, ctx).some((x) => x.value === "rehab"), "rehabilitation referral already planned");

  const r = await run(pid, "acs-discharge", { type: "stemi", revasc: "complete", lvef: "not-measured", start: ["none"], prevent: ["flu"], followup: ["lipids"], review: "none" }, b.id);
  assert.ok(r.assessment!.recommendations.some((x: string) => /echo to assess LV function/.test(x)));
  assert.ok(!r.assessment!.recommendations.some((x: string) => /rehabilitation/.test(x)), "referral already planned");
  const s = await loadState(db, pid);
  assert.equal(s.plan.filter((p) => /lipid/i.test(p.title) && p.status === "planned").length, 1, "the planned lipid profile is not duplicated");
  assert.equal(await rec(pid, "cad.acs-bundle"), undefined, "bundle done");
  assert.ok(s.plan.some((p) => p.title === "Echo: LV function after ACS" && p.due_date === T), "LVEF not measured: echo planned today");
  assert.equal(await rec(pid, "cad.lvef-after-acs"), undefined, "echo planned");
});

test("LVEF ≤40% after NSTEMI with diabetes: beta-blocker, ACE inhibitor and MRA suggested and started; LVEF reassessment due after 6 weeks", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Acs " + Date.now(), mrn: "S" + Math.random().toString(36).slice(2, 8) + Date.now(), sex: "Female", birthDate: "1958-01-01", conditions: ["t2dm"] }));
  await pci(pid, -50, "nste-acs");
  await tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -49)), items: [{ code: "lvef", value: 35 }] }); await reassess(q, pid, "sandbox"); });
  const re = await rec(pid, "cad.lvef-reassess-after-mi");
  assert.ok(re && re.severity === "orange");
  assert.match(re.title, /^LVEF 35% after MI: reassess LVEF now/);
  const ctx = (await tx((q) => getWizard(q, pid, "acs-discharge"))).context;
  assert.deepEqual(suggest("acs-discharge", "lvef", {}, ctx).map((x) => x.value), ["le40"]);
  const st = suggest("acs-discharge", "start", { lvef: "le40" }, ctx).map((x) => x.value);
  for (const v of ["statin", "bb", "acei", "mra"]) assert.ok(st.includes(v), v);
  assert.ok(suggest("acs-discharge", "followup", { lvef: "le40" }, ctx).some((x) => x.value === "echo"));

  await run(pid, "acs-discharge", { type: "nstemi", revasc: "complete", lvef: "le40", start: ["statin", "bb", "acei", "mra"], prevent: ["rehab", "flu"], followup: ["lipids", "echo"], review: "clinic-14" });
  const s = await loadState(db, pid);
  const live = s.meds.filter((m) => m.status === "active").map((m) => `${m.code} ${m.doseValue} ${m.frequency}`).sort();
  assert.deepEqual(live, ["atorvastatin 80 OD", "bisoprolol 1.25 OD", "eplerenone 25 OD", "ramipril 2.5 BID"]);
  assert.equal(s.plan.find((p) => p.title.startsWith("Repeat echo 6–12 weeks after MI"))!.due_date, addDays(T, 34), "12 weeks after the ACS");
  assert.equal(s.plan.find((p) => p.title === "Lipid profile 4–6 weeks after ACS")!.due_date, T, "6 weeks already passed: due today");
  assert.equal(await rec(pid, "cad.lvef-reassess-after-mi"), undefined, "echo planned");
  assert.equal(await rec(pid, "cad.rehab"), undefined, "rehab referral planned");
});

test("bundle done but no LVEF and nothing planned: the LVEF finding stands alone", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Lv " + Date.now(), mrn: "L" + Math.random().toString(36).slice(2, 8) + Date.now(), sex: "Male", birthDate: "1965-01-01", conditions: [] }));
  await pci(pid, -10, "stemi");
  await run(pid, "acs-discharge", { type: "stemi", revasc: "complete", lvef: "ge50", start: ["none"], prevent: ["none"], followup: ["none"], review: "none" });
  assert.equal(await rec(pid, "cad.acs-bundle"), undefined);
  assert.equal((await rec(pid, "cad.lvef-after-acs")).severity, "yellow", "the answer said LVEF ≥50% but none is recorded");
  assert.ok(await rec(pid, "cad.rehab"), "rehab declined in the bundle: the rehab finding returns");
});

// ---- slice 4: coronary complications ----
test("Salem (PCI 5 months ago) with chest pain at clinic: the pathway is offered; troponin rise → NSTE-ACS, invasive within 24 h; summary names late stent thrombosis", async () => {
  const pid = await byName("Salem Al-Rashidi");
  const r = await rec(pid, "event.chest-pain-cad");
  assert.ok(r && r.severity === "orange");
  assert.match(r.title, /^Visit for chest pain · /);
  const ctx = (await tx((q) => getWizard(q, pid, "chest-pain-cad"))).context;
  assert.deepEqual(suggest("chest-pain-cad", "adherence", {}, ctx).map((x) => x.value), ["taking"]);
  const a = { pattern: "rest", ecg: "dynamic", troponin: "rising", instability: ["none"], adherence: "missed" };
  const acts = suggest("chest-pain-cad", "actions", a, ctx).map((x) => x.value);
  assert.ok(acts.includes("invasive-24") && acts.includes("restart-ap") && !acts.includes("cath-now"));
  const done = await run(pid, "chest-pain-cad", { ...a, actions: ["invasive-24", "restart-ap"], review: "none" }, r.id);
  assert.ok(done.episodeId, "a complication episode is opened");
  assert.equal(done.assessment!.rows[0].value, "High-risk NSTE-ACS");
  assert.match(done.assessment!.rows[1].value, /stent thrombosis would be late \(31 days–1 year\)/);
  assert.ok(done.assessment!.recommendations.some((x: string) => /within 24 h should be considered \(IIa A\)/.test(x)));
  assert.equal(await rec(pid, "event.chest-pain-cad"), undefined, "quiet while the episode is open");
  const s = await loadState(db, pid);
  assert.ok(s.plan.some((p) => p.title === "Invasive coronary angiography within 24 h" && p.due_date === T));
});

test("ST elevation → immediate angiography; stable exertional angina → nitrate, anti-anginal and ischaemia testing", async () => {
  const pid = await byName("Salem Al-Rashidi");
  const ctx = (await tx((q) => getWizard(q, pid, "chest-pain-cad"))).context;
  assert.deepEqual(suggest("chest-pain-cad", "actions", { pattern: "ongoing", ecg: "ste", troponin: "pending", instability: ["none"] }, ctx).map((x) => x.value).slice(0, 1), ["cath-now"]);
  const st = suggest("chest-pain-cad", "actions", { pattern: "exertional", ecg: "normal", troponin: "normal", instability: ["none"], adherence: "taking" }, ctx).map((x) => x.value);
  for (const v of ["antianginal", "functional"]) assert.ok(st.includes(v), v);
  assert.ok(!st.includes("invasive-24") && !st.includes("cath-now"));
});

test("bleeding on DAPT: a bleeding visit offers the pathway; moderate bleeding → keep the P2Y12 inhibitor, hold aspirin, or switch to clopidogrel", async () => {
  const pid = await newCad("Bleed");
  await pci(pid, -40, "nste-acs");
  await start(pid, "aspirin", 100, "OD", "cad", -40);
  await start(pid, "ticagrelor", 90, "BID", "cad", -40);
  await tx(async (q) => { await K.startVisit(q, doc, pid, { reasons: ["Bleeding"], symptoms: [], service: "Cardiology clinic", startedAt: new Date(Date.now() - 60_000).toISOString() } as any); await reassess(q, pid, "sandbox"); });
  const r = await rec(pid, "event.bleeding");
  assert.ok(r, "bleeding pathway offered");
  const ctx = (await tx((q) => getWizard(q, pid, "bleeding"))).context;
  const sug = suggest("bleeding", "actions", { severity: "moderate", site: "gi" }, ctx).map((x) => x.value);
  for (const v of ["sapt", "to-clopidogrel", "ppi", "restart"]) assert.ok(sug.includes(v), v);
  assert.ok(!sug.includes("hold-ap"), "moderate bleeding on DAPT: not all antiplatelets");
  assert.ok(suggest("bleeding", "actions", { severity: "life" }, ctx).some((x) => x.value === "hold-ap"));
  assert.ok(suggest("bleeding", "actions", { severity: "minor" }, ctx).some((x) => x.value === "continue-dapt"));
  await run(pid, "bleeding", { severity: "moderate", site: "gi", agents: ["aspirin"], actions: ["sapt", "to-clopidogrel", "ppi", "restart"], recheck: "3", review: "none" }, r.id);
  const s = await loadState(db, pid);
  const st = Object.fromEntries(s.meds.map((m) => [m.code, m.status]));
  assert.equal(st.aspirin, "held");
  assert.equal(st.ticagrelor, "stopped");
  assert.equal(st.clopidogrel, "active");
});

test("a PCI already on the problem list (same week, or no date) is completed, not listed twice", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Dup " + Date.now(), mrn: "D" + Math.random().toString(36).slice(2, 8) + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["prior-pci"] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -20)), details: { setting: "elective", vessels: ["RCA"] } }));
  const s = await loadState(db, pid);
  const pcis = s.conditions.filter((c) => c.code === "prior-pci" && c.status === "active");
  assert.equal(pcis.length, 1);
  assert.deepEqual(pcis[0].attributes.vessels, ["RCA"]);
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -2)), details: { setting: "elective", vessels: ["LAD"] } }));
  assert.equal((await loadState(db, pid)).conditions.filter((c) => c.code === "prior-pci" && c.status === "active").length, 2, "a second PCI weeks later is its own entry");
});
