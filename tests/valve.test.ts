// Valve module, slice 1: echo valve grades and measurements, valve interventions as dated
// procedures, the prosthesis on the problem list, the valve profile and the echo-lesion rule.
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
import { procedureSummary } from "../shared/procedures.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const sumOf = async (id: string): Promise<any> => tx((q) => summary(q, id, "sandbox"));
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2 ORDER BY title`, [pid, rule])).rows as any[]);
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("echo: valve grades go into the study and its findings, measurements become observations, bad values are refused", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Echo V " + Date.now(), mrn: "EV" + Date.now(), sex: "Male", birthDate: "1950-01-01", conditions: ["htn"] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 55, findings: [], valves: { as: "Moderate", mr: "Severe", tr: "None" }, mrType: "Secondary", measures: { "av-vmax": 3.4, "av-mg": 28, lvesd: 41 } }));
  const s = await loadState(db, pid);
  const e = s.studies.find((x) => x.kind === "echo")!;
  assert.deepEqual(e.attributes.valves, { as: "Moderate", mr: "Severe", tr: "None" });
  assert.equal(e.attributes.mrType, "Secondary");
  assert.deepEqual(e.findings, ["Moderate AS", "Severe secondary MR"]);
  assert.equal(s.resolved("av-vmax").current!.value_num, 3.4);
  assert.equal(s.resolved("lvesd").current!.value_num, 41);
  await assert.rejects(tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 55, findings: [], measures: { ava: 9 } })), /AVA: 0.1–6/);
});

test("valve interventions: summary, validation, and the prosthesis on the problem list (a redo replaces the listed one)", async () => {
  assert.equal(procedureSummary("valve", { position: "Aortic", procedure: "TAVI", access: "Transfemoral" }), "TAVI · transfemoral");
  assert.equal(procedureSummary("valve", { position: "Mitral", procedure: "Surgical replacement", prosthesis: "Mechanical", design: "Bileaflet / current tilting-disc" }), "Mitral valve replacement (mechanical) · Bileaflet / current tilting-disc");
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Valve P " + Date.now(), mrn: "VP" + Date.now(), sex: "Female", birthDate: "1948-01-01", conditions: ["as"] }));
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(T), details: { position: "Mitral", procedure: "TAVI" } })), /TAVI is an aortic procedure/);
  await assert.rejects(tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(T), details: { position: "Aortic", procedure: "Surgical replacement" } })), /Mechanical or bioprosthetic/);
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -3000)), details: { position: "Aortic", procedure: "Surgical replacement", prosthesis: "Bioprosthetic" } }));
  let pv = (await loadState(db, pid)).conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active");
  assert.equal(pv.length, 1);
  assert.deepEqual(pv[0].attributes, { position: "Aortic", type: "Bioprosthetic (surgical)" });
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -10)), details: { position: "Aortic", procedure: "Valve-in-valve", access: "Transfemoral" } }));
  pv = (await loadState(db, pid)).conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active");
  assert.equal(pv.length, 1, "valve-in-valve replaces the listed aortic prosthesis");
  assert.equal(pv[0].attributes.type, "TAVI");
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -2)), details: { position: "Mitral", procedure: "Transcatheter edge-to-edge repair (TEER)" } }));
  pv = (await loadState(db, pid)).conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active");
  assert.equal(pv.length, 2);
  const v = (await sumOf(pid)).valve;
  assert.equal(v.events[0].title, "Mitral TEER");
  assert.ok(v.lesions.find((l: any) => l.code === "as").treated, "native AS is shown as treated");
});

test("Mariam: severe AS with numbers and a moderate primary MR on today's echo → MR not on the list (yellow); Abdullah's mechanical mitral valve keeps one entry with its design and INR target", async () => {
  const pid = await byName("Mariam Hussain");
  const v = (await sumOf(pid)).valve;
  const as = v.lesions.find((l: any) => l.code === "as");
  assert.equal(as.severity, "Severe");
  assert.equal(as.echo.grade, "Severe");
  assert.ok(v.echo.values.some((x: any) => x.code === "av-vmax" && x.value === "4.6"));
  assert.ok(v.echo.values.some((x: any) => x.code === "ava" && x.value === "0.70"));
  const r = await rec(pid, "valve.echo-lesion-unlisted");
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, "yellow");
  assert.match(r[0].title, /moderate primary mitral regurgitation — not on the problem list/);
  const ab = await byName("Abdullah Al-Enezi");
  const s = await loadState(db, ab);
  const pv = s.conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active");
  assert.equal(pv.length, 1);
  assert.equal(pv[0].attributes.design, "Bileaflet / current tilting-disc");
  assert.equal(pv[0].onset?.slice(0, 10), "2014-06-15");
  const av = (await sumOf(ab)).valve;
  assert.match(av.prostheses[0].inrTarget, /^3\.\d/);
});

test("a severe lesion listed with a lower severity is flagged orange; listing it clears the finding", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ar " + Date.now(), mrn: "AR" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["ar"] }));
  await tx(async (q) => { await K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 52, findings: [], valves: { ar: "Severe" }, measures: { lvesd: 48 } }); await reassess(q, pid, "sandbox"); });
  const r = await rec(pid, "valve.echo-lesion-unlisted");
  assert.equal(r[0].severity, "orange");
  assert.match(r[0].title, /severe aortic regurgitation — listed as severity not recorded/);
  const c = (await loadState(db, pid)).conditions.find((x) => x.code === "ar")!;
  await tx(async (q) => { await K.updateCondition(q, doc, pid, c.logical_id, { attributes: { severity: "Severe" } }); await reassess(q, pid, "sandbox", ["conditions"]); });
  assert.equal((await rec(pid, "valve.echo-lesion-unlisted")).length, 0);
});

// ---- slice 2: Heart Team decision and intervention triggers ----
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { suggest } from "../shared/wizard-guidance.js";
const run = (pid: string, wizard: string, answers: any, recommendationId?: string) =>
  tx(async (q) => { const r = await completeWizard(q, doc, pid, wizard, { answers, recommendationId }); await reassess(q, pid, "sandbox", r.changed); return r; });
const status = async (pid: string, rule: string) => ((await db.query(`SELECT rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])[0]?.rule_status;

test("Mariam (81, severe AS, NYHA II): Heart Team finding and class I trigger; the pathway suggests TAVI; deciding clears both", async () => {
  const pid = await byName("Mariam Hussain");
  const ht = (await rec(pid, "valve.severe-heart-team"))[0];
  assert.equal(ht.severity, "orange");
  assert.match(ht.title, /^Severe aortic stenosis: Heart Team decision/);
  assert.equal(await status(pid, "valve.severe-heart-team"), "PUBLISHED");
  const tr = (await rec(pid, "valve.intervention-trigger"))[0];
  assert.match(tr.title, /Severe aortic stenosis with NYHA II: intervention indicated \(class I\)/);
  assert.equal(await status(pid, "valve.intervention-trigger"), "PUBLISHED");
  const ctx = (await tx((q) => getWizard(q, pid, "valve-heart-team"))).context;
  assert.deepEqual(suggest("valve-heart-team", "lesion", {}, ctx).map((x) => x.value), ["as"]);
  assert.deepEqual(suggest("valve-heart-team", "symptoms", {}, ctx).map((x) => x.value), ["symptomatic"]);
  assert.deepEqual(suggest("valve-heart-team", "lv", {}, ctx).map((x) => x.value), ["50-60"]);
  const answers = { lesion: "as", symptoms: "symptomatic", lv: "50-60", lowflow: "no", risk: "intermediate", anatomy: ["tricuspid", "tf"], factors: ["none"] };
  const d = suggest("valve-heart-team", "decision", answers, ctx);
  assert.equal(d[0].value, "tavi");
  assert.match(d[0].why, /I A/);
  const done = await run(pid, "valve-heart-team", { ...answers, decision: "tavi", workup: ["ct", "meeting"], review: "none" }, ht.id);
  assert.ok(done.assessment!.recommendations.some((x: string) => /TAVI \(I A\)/.test(x)));
  assert.ok(done.assessment!.recommendations.some((x: string) => /Symptomatic severe AS: intervention \(I\)/.test(x)));
  const s = await loadState(db, pid);
  assert.ok(s.plan.some((p) => p.title === "TAVI (Heart Team decision)" && p.status === "planned"));
  assert.equal((await rec(pid, "valve.severe-heart-team")).length, 0);
  assert.equal((await rec(pid, "valve.intervention-trigger")).length, 0);
});

test("severe primary MR, asymptomatic, LVEF >60%, AF + SPAP >50 + TR moderate, low risk: features suggested and repair suggested (I B)", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Mr " + Date.now(), mrn: "MR" + Date.now(), sex: "Female", birthDate: "1966-01-01", conditions: ["af"] }));
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 66, findings: [], valves: { mr: "Severe", tr: "Moderate" }, mrType: "Primary", measures: { lvesd: 36, spap: 55 } });
    await K.recordObservations(q, doc, pid, { effectiveAt: at(T), items: [{ code: "nyha", text: "I" }], silentEvent: true });
    await reassess(q, pid, "sandbox");
  });
  assert.match((await rec(pid, "valve.severe-heart-team"))[0].title, /^Severe primary mitral regurgitation: Heart Team/);
  assert.equal((await rec(pid, "valve.intervention-trigger")).length, 0, "no class I trigger: LVEF 66%, LVESD 36 mm, NYHA I");
  const ctx = (await tx((q) => getWizard(q, pid, "valve-heart-team"))).context;
  assert.deepEqual(suggest("valve-heart-team", "lesion", {}, ctx).map((x) => x.value), ["mr-primary"]);
  assert.deepEqual(suggest("valve-heart-team", "mrFeatures", {}, ctx).map((x) => x.value).filter(Boolean).sort(), ["af", "spap", "tr"]);
  const d = suggest("valve-heart-team", "decision", { lesion: "mr-primary", symptoms: "asymptomatic", lv: "gt60", risk: "low", mrFeatures: ["af", "spap", "tr"], factors: ["none"] }, ctx);
  assert.equal(d[0].value, "mv-surgery");
  assert.match(d[0].why, /3 of AF.*I B/);
});

// ---- slice 3: echo surveillance (intervals in review) ----
test("Latifa (TAVI 40 days ago, no echo since): baseline echo due; an echo clears it and sets yearly follow-up", async () => {
  const pid = await byName("Latifa Al-Fadhli");
  const r = (await rec(pid, "valve.echo-surveillance"))[0];
  assert.match(r.title, /^Baseline echo after TAVI: due by/);
  assert.equal(await status(pid, "valve.echo-surveillance"), "PUBLISHED");
  assert.equal(r.action.template, "valve-echo");
  let v = (await sumOf(pid)).valve;
  assert.ok(v.surveillance.some((x: any) => /Baseline echo/.test(x.what)));
  await tx(async (q) => { await K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 60, findings: [], valves: { ar: "Mild" }, measures: { "av-mg": 9 } }); await reassess(q, pid, "sandbox"); });
  assert.equal((await rec(pid, "valve.echo-surveillance")).length, 0);
  v = (await sumOf(pid)).valve;
  const next = v.surveillance.find((x: any) => /aortic TAVI follow-up/.test(x.what));
  assert.ok(next && next.dueAt > addDays(T, 360) && next.dueAt < addDays(T, 370));
  assert.ok(v.echo.values.some((x: any) => x.code === "av-mg" && x.value === "9"), "post-TAVI gradient shown");
});

test("moderate AS last imaged 14 months ago → surveillance due (every 1–2 years, ACC/AHA 2020); a planned echo quiets it", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Mod AS " + Date.now(), mrn: "MA" + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions: ["htn"] }));
  await tx(async (q) => { await K.recordEcho(q, doc, pid, { date: at(addDays(T, -425)), quality: "formal", lvef: 60, findings: [], valves: { as: "Moderate" } }); await reassess(q, pid, "sandbox"); });
  const r = (await rec(pid, "valve.echo-surveillance"))[0];
  assert.match(r.title, /^Echo: moderate AS surveillance: due by/);
  await tx(async (q) => { await K.addPlanAction(q, doc, pid, { category: "investigation", title: "Echo (valve surveillance)", dueDate: addDays(T, 7), completesOn: { type: "study", kind: "echo" } }); await reassess(q, pid, "sandbox", ["plan"]); });
  assert.equal((await rec(pid, "valve.echo-surveillance")).length, 0);
});

test("severe AR with LVESD 46 mm in a small patient: LVESDi above 25 mm/m² triggers surgery (class I); mechanical valve gets the baseline echo only, a surgical bioprosthesis is imaged at 5 years", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ari " + Date.now(), mrn: "AI" + Date.now(), sex: "Female", birthDate: "1970-01-01", conditions: [] }));
  await tx(async (q) => {
    await K.recordObservations(q, doc, pid, { effectiveAt: at(T), items: [{ code: "height", value: 150 }, { code: "weight", value: 50 }] });
    await K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 58, findings: [], valves: { ar: "Severe" }, measures: { lvesd: 46 } });
    await reassess(q, pid, "sandbox");
  });
  const r = (await rec(pid, "valve.intervention-trigger"))[0];
  assert.match(r.title, /Severe aortic regurgitation with LVESDi 31\.9 mm\/m²: intervention indicated \(class I\)/);
  const m = await tx((q) => K.createPatient(q, doc, { name: "Mech " + Date.now(), mrn: "MV" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, m, { kind: "valve", date: at(addDays(T, -400)), details: { position: "Aortic", procedure: "Surgical replacement", prosthesis: "Mechanical", design: "Bileaflet / current tilting-disc" } }));
  await tx((q) => K.recordEcho(q, doc, m, { date: at(addDays(T, -330)), quality: "formal", lvef: 60, findings: [] }));
  assert.equal((await sumOf(m)).valve.surveillance.length, 0, "mechanical valve: baseline only");
  const b = await tx((q) => K.createPatient(q, doc, { name: "Bio " + Date.now(), mrn: "BV" + Date.now(), sex: "Male", birthDate: "1950-01-01", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, b, { kind: "valve", date: at(addDays(T, -800)), details: { position: "Aortic", procedure: "Surgical replacement", prosthesis: "Bioprosthetic" } }));
  await tx((q) => K.recordEcho(q, doc, b, { date: at(addDays(T, -740)), quality: "formal", lvef: 60, findings: [] }));
  const sv = (await sumOf(b)).valve.surveillance[0];
  assert.match(sv.reason, /at 5 years/);
});

// ---- slice 4: antithrombotic therapy after valve intervention ----
test("Latifa (TAVI 40 days ago, aspirin + clopidogrel, no PCI/ACS): DAPT finding (orange, III B); the pathway is prefilled, stops clopidogrel and dates the 12-month aspirin review", async () => {
  const pid = await byName("Latifa Al-Fadhli");
  const f = (await rec(pid, "valve.tavi-antithrombotic"))[0];
  assert.equal(f.severity, "orange");
  assert.match(f.title, /DAPT after TAVI without a clear indication \(aspirin \+ clopidogrel\)/);
  assert.equal(f.action.wizard, "valve-antithrombotic");
  assert.equal(await status(pid, "valve.tavi-antithrombotic"), "PUBLISHED");
  const w = await tx((q) => getWizard(q, pid, "valve-antithrombotic"));
  assert.deepEqual(w.context.detected.intervention, ["tavi"]);
  assert.deepEqual(suggest("valve-antithrombotic", "indications", {}, w.context).map((x) => x.value), ["none"]);
  assert.deepEqual(suggest("valve-antithrombotic", "tavi", { indications: ["none"] }, w.context).map((x) => x.value), ["asa"]);
  const answers = { intervention: "tavi", indications: ["none"], bleeding: "usual", tavi: "asa", care: ["endocarditis"], review: "none" };
  const done = await run(pid, "valve-antithrombotic", answers, f.id);
  assert.ok(done.assessment!.recommendations.some((x: string) => /12 months \(I A\)/.test(x)));
  assert.ok(done.assessment!.recommendations.some((x: string) => /III B/.test(x)));
  const s = await loadState(db, pid);
  assert.equal(s.meds.find((m) => m.code === "clopidogrel")!.status, "stopped");
  assert.equal(s.meds.find((m) => m.code === "aspirin")!.status, "active");
  const review = s.plan.find((p) => p.title === "Review aspirin 12 months after TAVI")!;
  assert.equal(String(review.due_date).slice(0, 10), addDays(addDays(T, -40), 365));
  assert.ok(review.medication_id, "linked to the aspirin");
  assert.ok(s.plan.some((p) => /Endocarditis prevention advice/.test(p.title)));
  assert.equal((await rec(pid, "valve.tavi-antithrombotic")).length, 0);
});

test("TAVI with no antithrombotic → aspirin (yellow, I A), and the pathway starts aspirin 100 mg; with AF it points to anticoagulation (I B); OAC without an indication → yellow (III A)", async () => {
  const mk = async (tag: string, conditions: string[]) => {
    const pid = await tx((q) => K.createPatient(q, doc, { name: `Tavi ${tag} ${Date.now()}`, mrn: `TV${tag}${Date.now()}`, sex: "Male", birthDate: "1944-02-02", conditions }));
    await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -5)), details: { position: "Aortic", procedure: "TAVI", access: "Transfemoral" } }));
    return pid;
  };
  const a = await mk("A", ["htn"]);
  await tx((q) => reassess(q, a, "sandbox"));
  const none = (await rec(a, "valve.tavi-antithrombotic"))[0];
  assert.equal(none.severity, "yellow");
  assert.match(none.title, /with no antiplatelet or anticoagulant/);
  await run(a, "valve-antithrombotic", { intervention: "tavi", indications: ["none"], bleeding: "usual", tavi: "asa", care: ["none"], review: "none" }, none.id);
  const sa = await loadState(db, a);
  const asa = sa.meds.find((m) => m.code === "aspirin")!;
  assert.equal(asa.status, "active");
  assert.equal(asa.doseValue, 100);
  assert.equal((await rec(a, "valve.tavi-antithrombotic")).length, 0);

  const b = await mk("B", ["af", "htn"]);
  await tx((q) => reassess(q, b, "sandbox"));
  assert.match((await rec(b, "valve.tavi-antithrombotic"))[0].title, /no antiplatelet or anticoagulant/);
  const ctx = (await tx((q) => getWizard(q, b, "valve-antithrombotic"))).context;
  assert.ok(suggest("valve-antithrombotic", "indications", {}, ctx).some((x) => x.value === "af"));
  assert.deepEqual(suggest("valve-antithrombotic", "tavi", { indications: ["af"] }, ctx).map((x) => x.value), ["oac"]);

  const c = await mk("C", ["htn"]);
  await tx((q) => K.startMedication(q, doc, c, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "valve", effectiveAt: at(addDays(T, -4)) }));
  await tx((q) => reassess(q, c, "sandbox"));
  const o = (await rec(c, "valve.tavi-antithrombotic"))[0];
  assert.equal(o.severity, "yellow");
  assert.match(o.title, /Apixaban after TAVI with no anticoagulation indication recorded/);
});

test("TAVI with a PCI in the last year: aspirin + clopidogrel is not flagged", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Tavi Pci " + Date.now(), mrn: "TP" + Date.now(), sex: "Male", birthDate: "1946-03-03", conditions: ["cad-ccs"] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -60)), details: { setting: "elective", vessels: ["LAD"], stents: 1 } }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -20)), details: { position: "Aortic", procedure: "TAVI", access: "Transfemoral" } }));
  for (const code of ["aspirin", "clopidogrel"] as const)
    await tx((q) => K.startMedication(q, doc, pid, { code, doseValue: code === "aspirin" ? 100 : 75, frequency: "OD", route: "PO", indication: "cad", effectiveAt: at(addDays(T, -60)) }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "valve.tavi-antithrombotic")).length, 0);
});

test("surgical mitral repair 3 weeks ago with no anticoagulant → yellow (IIa B); the pathway plans the anticoagulant and dates its stop at 3 months; the finding ends after 3 months", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Mv Repair " + Date.now(), mrn: "MR" + Date.now(), sex: "Female", birthDate: "1965-05-05", conditions: ["mr-primary"] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -21)), details: { position: "Mitral", procedure: "Surgical repair" } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  const f = (await rec(pid, "valve.repair-oac"))[0];
  assert.equal(f.severity, "yellow");
  assert.match(f.title, /no anticoagulant in the first 3 months/);
  assert.equal(await status(pid, "valve.repair-oac"), "PUBLISHED");
  const ctx = (await tx((q) => getWizard(q, pid, "valve-antithrombotic"))).context;
  assert.deepEqual(ctx.detected.intervention, ["repair"]);
  assert.deepEqual(suggest("valve-antithrombotic", "repair", { indications: ["none"], bleeding: "usual" }, ctx).map((x) => x.value), ["oac"]);
  assert.deepEqual(suggest("valve-antithrombotic", "repair", { indications: ["none"], bleeding: "high" }, ctx).map((x) => x.value), ["asa"]);
  await run(pid, "valve-antithrombotic", { intervention: "repair", indications: ["none"], bleeding: "usual", repair: "oac", care: ["none"], review: "none" }, f.id);
  const s = await loadState(db, pid);
  assert.ok(s.plan.some((p) => /^Start an anticoagulant \(first 3 months after valve repair/.test(p.title)));
  const stop = s.plan.find((p) => p.title === "Stop anticoagulation 3 months after valve repair (no other indication)")!;
  assert.equal(String(stop.due_date).slice(0, 10), addDays(addDays(T, -21), 91));
  const old = await tx((q) => K.createPatient(q, doc, { name: "Mv Old " + Date.now(), mrn: "MO" + Date.now(), sex: "Female", birthDate: "1965-05-05", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, old, { kind: "valve", date: at(addDays(T, -120)), details: { position: "Mitral", procedure: "Surgical repair" } }));
  await tx((q) => reassess(q, old, "sandbox"));
  assert.equal((await rec(old, "valve.repair-oac")).length, 0);
});

test("mechanical valve: no anticoagulant → red (I A); aspirin + clopidogrel without PCI/ACS → orange (III A); the pathway suggests warfarin and education and plans the INR target", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Mhv " + Date.now(), mrn: "MH" + Date.now(), sex: "Male", birthDate: "1975-07-07", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -400)), details: { position: "Aortic", procedure: "Surgical replacement", prosthesis: "Mechanical", design: "Bileaflet / current tilting-disc" } }));
  for (const code of ["aspirin", "clopidogrel"] as const)
    await tx((q) => K.startMedication(q, doc, pid, { code, doseValue: code === "aspirin" ? 100 : 75, frequency: "OD", route: "PO", indication: "valve", effectiveAt: at(addDays(T, -30)) }));
  await tx((q) => reassess(q, pid, "sandbox"));
  const fs = await rec(pid, "valve.mechanical-antithrombotic");
  const red = fs.find((x) => x.severity === "red")!;
  assert.match(red.title, /Mechanical valve with no anticoagulant/);
  assert.ok(fs.some((x) => x.severity === "orange" && /dual antiplatelet/.test(x.title)));
  const ctx = (await tx((q) => getWizard(q, pid, "valve-antithrombotic"))).context;
  assert.deepEqual(ctx.detected.intervention, ["mech"]);
  assert.equal(ctx.valve!.inrTarget, "2.5 (2.0–3.0)");
  assert.deepEqual(suggest("valve-antithrombotic", "mech", { indications: ["none"] }, ctx).map((x) => x.value), ["vka"]);
  const done = await run(pid, "valve-antithrombotic", { intervention: "mech", indications: ["none"], bleeding: "usual", mech: ["vka"], care: ["education"], review: "none" });
  assert.ok(done.assessment!.recommendations.some((x: string) => /III A/.test(x)));
  const s = await loadState(db, pid);
  assert.ok(s.plan.some((p) => p.title === "Start warfarin for the mechanical valve · INR target 2.5 (2.0–3.0)"));
  assert.ok(s.plan.some((p) => p.title === "Anticoagulation education (INR target 2.5 (2.0–3.0))"));
  assert.equal(s.meds.find((m) => m.code === "clopidogrel")!.status, "stopped");
  assert.equal(s.meds.find((m) => m.code === "aspirin")!.status, "active", "aspirin is the clinician's call (symptomatic atherosclerosis)");
});

// ---- slice 5: prosthetic valve thrombosis or dysfunction ----
test("Yousef (2016 surgical bioprosthesis, severe prosthesis stenosis and 'Prosthetic valve dysfunction' on echo, NYHA III): pathway offered (orange); suggestions; reintervention and ViV; an episode opens and the offer goes", async () => {
  const pid = await byName("Yousef Al-Shammari");
  const o = (await rec(pid, "event.prosthetic-valve"))[0];
  assert.equal(o.severity, "orange");
  assert.match(o.title, /^Echo .*: Prosthetic valve dysfunction, severe aortic prosthesis stenosis → prosthetic valve pathway$/);
  assert.equal(o.action.wizard, "prosthetic-valve");
  assert.equal((await rec(pid, "valve.severe-heart-team")).length, 0, "a treated position is not a native lesion");
  assert.equal((await rec(pid, "valve.echo-lesion-unlisted")).length, 0);
  const ctx = (await tx((q) => getWizard(q, pid, "prosthetic-valve"))).context;
  assert.deepEqual(suggest("prosthetic-valve", "prosthesis", {}, ctx).map((x) => x.value), ["bio"]);
  assert.deepEqual(suggest("prosthetic-valve", "presentation", {}, ctx).map((x) => x.value), ["echo", "ahf"]);
  assert.deepEqual(suggest("prosthetic-valve", "cause", {}, ctx).map((x) => x.value), ["dysfunction"]);
  const answers = { prosthesis: "bio", presentation: ["echo", "dyspnoea"], imaging: ["tte", "ct"], cause: "dysfunction", risk: "intermediate" };
  assert.deepEqual(suggest("prosthetic-valve", "actions", answers, ctx).map((x) => x.value), ["redo", "viv"]);
  const done = await run(pid, "prosthetic-valve", { ...answers, actions: ["heart-team", "viv"], review: "clinic-28" }, o.id);
  assert.ok(done.assessment!.recommendations.some((x: string) => /reintervention \(I C\)/.test(x)));
  assert.ok(done.assessment!.recommendations.some((x: string) => /valve-in-valve .*\(IIa B\)/.test(x)));
  const s = await loadState(db, pid);
  assert.ok(s.plan.some((p) => p.title === "Heart Team: prosthetic valve (urgent)"));
  assert.ok(s.plan.some((p) => p.title === "Valve-in-valve assessment (CT, Heart Team)"));
  assert.ok(s.episodes.some((e) => e.wizard === "prosthetic-valve" && e.status === "open"));
  assert.equal((await rec(pid, "event.prosthetic-valve")).length, 0);
});

test("mechanical valve thrombus on echo → red offer; obstructive with acute HF → Heart Team (I B) and TOE/CT (I C); bioprosthetic thrombosis → VKA suggested (I B) and planned", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Mhv Thr " + Date.now(), mrn: "MT" + Date.now(), sex: "Female", birthDate: "1970-01-01", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -900)), details: { position: "Mitral", procedure: "Surgical replacement", prosthesis: "Mechanical", design: "Bileaflet / current tilting-disc" } }));
  await tx((q) => K.startMedication(q, doc, pid, { code: "warfarin", doseValue: 5, frequency: "OD", route: "PO", indication: "valve", effectiveAt: at(addDays(T, -900)) }));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -2)), items: [{ code: "inr", value: 1.6 }] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 55, findings: ["Prosthetic valve thrombus"], valves: { ms: "Severe" } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  const o = (await rec(pid, "event.prosthetic-valve"))[0];
  assert.equal(o.severity, "red");
  const ctx = (await tx((q) => getWizard(q, pid, "prosthetic-valve"))).context;
  assert.deepEqual(suggest("prosthetic-valve", "prosthesis", {}, ctx).map((x) => x.value), ["mech"]);
  assert.deepEqual(suggest("prosthetic-valve", "inr", {}, ctx).map((x) => x.value), ["low"], "INR 1.6 below the 3.0 (2.5–3.5) target");
  const answers = { prosthesis: "mech", presentation: ["ahf", "echo"], inr: "low", imaging: ["tte", "toe"], cause: "thrombus-obstructive", risk: "intermediate" };
  assert.deepEqual(suggest("prosthetic-valve", "actions", answers, ctx).map((x) => x.value), ["heart-team"]);
  const done = await run(pid, "prosthetic-valve", { ...answers, actions: ["heart-team"], review: "none" }, o.id);
  const r = done.assessment!.recommendations.join(" ");
  assert.match(r, /TOE and\/or 4D-CT .*\(I C\)/);
  assert.match(r, /repeat valve replacement and low-dose slow-infusion fibrinolysis \(I B\)/);
  assert.match(r, /INR below target/);

  const b = await tx((q) => K.createPatient(q, doc, { name: "Thv Thr " + Date.now(), mrn: "TT" + Date.now(), sex: "Male", birthDate: "1945-01-01", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, b, { kind: "valve", date: at(addDays(T, -200)), details: { position: "Aortic", procedure: "TAVI", access: "Transfemoral" } }));
  await tx((q) => K.recordEcho(q, doc, b, { date: at(T), quality: "formal", lvef: 60, findings: ["Prosthetic valve thrombus"], valves: { as: "Moderate" } }));
  await tx((q) => reassess(q, b, "sandbox"));
  const ob = (await rec(b, "event.prosthetic-valve"))[0];
  const cb = (await tx((q) => getWizard(q, b, "prosthetic-valve"))).context;
  assert.deepEqual(suggest("prosthetic-valve", "prosthesis", {}, cb).map((x) => x.value), ["thv"]);
  const ab = { prosthesis: "thv", presentation: ["echo"], imaging: ["tte", "ct"], cause: "thrombus" };
  assert.deepEqual(suggest("prosthetic-valve", "actions", ab, cb).map((x) => x.value), ["vka"]);
  const db2 = await run(b, "prosthetic-valve", { ...ab, actions: ["vka"], review: "clinic-90" }, ob.id);
  assert.ok(db2.assessment!.recommendations.some((x: string) => /VKA before considering reintervention \(I B\)/.test(x)));
  assert.ok((await loadState(db, b)).plan.some((p) => p.title === "Start warfarin (prosthetic valve thrombosis)"));
});

test("an echo before the intervention, or a mild grade, does not offer the pathway; an admission for a prosthetic valve problem does", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Pv Quiet " + Date.now(), mrn: "PQ" + Date.now(), sex: "Male", birthDate: "1950-01-01", conditions: ["as"] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(addDays(T, -100)), quality: "formal", lvef: 55, findings: [], valves: { as: "Severe" } }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -60)), details: { position: "Aortic", procedure: "TAVI", access: "Transfemoral" } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "event.prosthetic-valve")).length, 0, "the severe AS was before the TAVI");
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(addDays(T, -30)), quality: "formal", lvef: 55, findings: [], valves: { ar: "Mild" } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "event.prosthetic-valve")).length, 0, "mild regurgitation");
  await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(T), location: "CCU", reasons: ["Prosthetic valve problem"], route: "Emergency department", symptoms: ["Dyspnoea"] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.match((await rec(pid, "event.prosthetic-valve"))[0].title, /^Admission for prosthetic valve problem/);
});

test("surgical bioprosthesis in the first 3 months: mitral → warfarin suggested (class to confirm) with a dated stop and aspirin after; aortic → warfarin or aspirin suggested; later → lifelong aspirin (IIb C)", async () => {
  const mk = async (pos: string, daysAgo: number) => {
    const pid = await tx((q) => K.createPatient(q, doc, { name: `Bio ${pos} ${daysAgo} ${Date.now()}`, mrn: `BP${pos[0]}${daysAgo}${Date.now()}`, sex: "Female", birthDate: "1955-01-01", conditions: [] }));
    await tx((q) => K.recordProcedure(q, doc, pid, { kind: "valve", date: at(addDays(T, -daysAgo)), details: { position: pos, procedure: "Surgical replacement", prosthesis: "Bioprosthetic" } }));
    return pid;
  };
  const m = await mk("Mitral", 10);
  const cm = (await tx((q) => getWizard(q, m, "valve-antithrombotic"))).context;
  assert.deepEqual(cm.detected.intervention, ["bio"]);
  const sm = suggest("valve-antithrombotic", "bio", { indications: ["none"] }, cm);
  assert.deepEqual(sm.map((x) => x.value), ["early-vka"]);
  assert.match(sm[0].why, /class to confirm/);
  const done = await run(m, "valve-antithrombotic", { intervention: "bio", indications: ["none"], bleeding: "usual", bio: "early-vka", care: ["none"], review: "none" });
  assert.ok(done.assessment!.recommendations.some((x: string) => /class to confirm/.test(x)));
  const s = await loadState(db, m);
  assert.ok(s.plan.some((p) => p.title === "Start warfarin for the first 3 months after the surgical bioprosthesis"));
  const stop = s.plan.find((p) => p.title === "Stop warfarin 3 months after the surgical bioprosthesis (no other indication)")!;
  assert.equal(String(stop.due_date).slice(0, 10), addDays(addDays(T, -10), 91));
  assert.ok(s.plan.some((p) => /^Start long-term aspirin 100 mg when warfarin stops/.test(p.title)));

  const a = await mk("Aortic", 20);
  const ca = (await tx((q) => getWizard(q, a, "valve-antithrombotic"))).context;
  assert.deepEqual(suggest("valve-antithrombotic", "bio", { indications: ["none"] }, ca).map((x) => x.value), ["early-vka", "early-asa"]);
  const late = await mk("Aortic", 400);
  const cl = (await tx((q) => getWizard(q, late, "valve-antithrombotic"))).context;
  assert.deepEqual(suggest("valve-antithrombotic", "bio", { indications: ["none"] }, cl).map((x) => x.value), ["asa"]);
});
