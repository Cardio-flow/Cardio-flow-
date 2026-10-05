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
