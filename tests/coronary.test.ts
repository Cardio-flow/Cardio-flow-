// Coronary module, slice 1: PCI/CABG as dated procedures (migration 005) and the coronary profile.
// Slice 2: the antithrombotic plan pathway and the coronary rules.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard } from "../server/engine/wizard.js";
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
  tx(async (q) => { const r = await completeWizard(q, doc, pid, "antithrombotic", { answers, recommendationId }); await reassess(q, pid, "sandbox", r.changed); return r; });
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
  const pciAt = (await loadState(db, pid)).procedures[0].performed_at.slice(0, 10);

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
  assert.ok(await rec(pid, "cad.rehab"), "rehabilitation is still due");
});

test("Salem (elective PCI, DAPT): 6-month DAPT then clopidogrel alone; Noura (STEMI): 12 months then aspirin", async () => {
  const sa = await byName("Salem Al-Rashidi");
  const r = await rec(sa, "cad.antithrombotic-plan");
  assert.match(r.title, /^Elective PCI .*antithrombotic stop dates not set/);
  await complete(sa, { setting: "ccs", oac: "no", hbr: ["none"], ischaemic: ["none"], dapt: "6m", sapt: "clopidogrel", now: ["none"], review: "none" }, r.id);
  let s = await loadState(db, sa);
  const pciAt = s.procedures[0].performed_at.slice(0, 10);
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
  assert.equal(it.due_date, addDays(s.procedures[0].performed_at.slice(0, 10), 365));
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
