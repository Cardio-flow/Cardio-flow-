// Complication episodes (migration 004): events in the record offer the matching pathway; a
// completed pathway opens an episode; later runs are its reviews (last answers kept); resolving
// closes it. The Overview and the clinical summary show it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard, getWizard, resolveEpisode } from "../server/engine/wizard.js";
import { summary } from "../server/kernel/views.js";
import { documents } from "../server/kernel/documents.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[]) => tx((q) => K.createPatient(q, doc, { name: "Ep " + rnd(), mrn: "E" + rnd() + Date.now(), sex: "Male", birthDate: "1955-01-01", conditions }));
const start = (pid: string, code: string, dose: number, freq: string, indication: string, days = -60) =>
  tx(async (q) => { await K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(addDays(T, days)) }); await reassess(q, pid, "sandbox"); });
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])
    .map((r) => ({ ...r, action: typeof r.action === "string" ? JSON.parse(r.action) : r.action }))[0];
const sum = (pid: string): Promise<any> => tx((q) => summary(q, pid, "sandbox"));
const complete = (pid: string, wizard: string, answers: any, recommendationId?: string) =>
  tx(async (q) => { const r = await completeWizard(q, doc, pid, wizard, { answers, recommendationId }); await reassess(q, pid, "sandbox", r.changed); return r; });

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

const CAP = {
  setting: "cap", curb: ["65"], severity: "moderate", tests: ["bloods"], "cap-abx": "amox-mac",
  cardiac: ["sickday"], recheck: "2", after: ["review"], review: "none",
};

test("an antibiotic for chest infection offers the pathway; completing it opens an episode with holds and the next step", async () => {
  const pid = await newPatient(["hfref"]);
  await start(pid, "dapagliflozin", 10, "OD", "hf");
  await start(pid, "amoxicillin", 500, "TID", "Chest infection (community-acquired)", -1);
  const r = await rec(pid, "event.chest-infection");
  assert.ok(r, "chest infection pathway offered");
  assert.equal(r.severity, "orange");
  assert.deepEqual(r.action, { type: "wizard", wizard: "chest-infection" });
  assert.match(r.title, /Amoxicillin started for chest infection/);

  const done = await complete(pid, "chest-infection", CAP, r.id);
  assert.ok(done.episodeId && !done.review);
  assert.equal(await rec(pid, "event.chest-infection"), undefined, "no second offer while the episode is open");
  const s = await sum(pid);
  const ep = s.episodes[0];
  assert.equal(ep.status, "open");
  assert.equal(ep.day, 1);
  assert.deepEqual(ep.held.map((m: any) => m.name), ["Dapagliflozin"]);
  assert.ok(ep.next && ep.total >= 2);
  const docs = await tx((q) => documents(q, pid));
  assert.match(docs.find((d) => d.id === "summary")!.text, /Complications:\n- Chest infection .*: open since .*on hold: Dapagliflozin/);
});

test("a second run is the episode's review with the last answers kept; resolving closes it and the offer stays quiet", async () => {
  const pid = await newPatient(["hfref"]);
  await start(pid, "amoxicillin", 500, "TID", "Chest infection (community-acquired)", -2);
  const first = await complete(pid, "chest-infection", CAP);
  const w: any = await tx((q) => getWizard(q, pid, "chest-infection"));
  assert.equal(w.episode.id, first.episodeId);
  assert.equal(w.episode.answers["cap-abx"], "amox-mac");
  const second = await complete(pid, "chest-infection", { ...CAP, severity: "low", "cap-abx": "amox", after: ["restart"] });
  assert.equal(second.episodeId, first.episodeId);
  assert.ok(second.review);
  const journey = ((await db.query(`SELECT title FROM cf.clinical_event WHERE patient_id=$1 ORDER BY recorded_at`, [pid])).rows as any[]).map((r) => r.title);
  assert.ok(journey.some((t) => /Chest infection .* · review$/.test(t)));
  assert.equal((await sum(pid)).episodes[0].reviews, 1);

  await tx(async (q) => { const r = await resolveEpisode(q, doc, pid, first.episodeId!, { outcome: "Resolved", note: "Afebrile, CRP falling" }); await reassess(q, pid, "sandbox", r.changed); });
  const s = await sum(pid);
  assert.equal(s.episodes[0].status, "resolved");
  assert.equal(s.episodes[0].outcome, "Resolved");
  assert.equal(await rec(pid, "event.chest-infection"), undefined, "the same antibiotic does not offer the pathway again");
  await assert.rejects(tx((q) => resolveEpisode(q, doc, pid, first.episodeId!, { outcome: "Resolved" })), /already closed/);
  const titles = ((await db.query(`SELECT title, detail FROM cf.clinical_event WHERE patient_id=$1 AND ref_type='episode'`, [pid])).rows as any[]);
  assert.match(titles[0].title, /resolved$/);
  assert.match(titles[0].detail, /Resolved after 1 day · Afebrile, CRP falling/);
  // a new pathway run after resolution opens a new episode
  const third = await complete(pid, "chest-infection", CAP);
  assert.notEqual(third.episodeId, first.episodeId);
});

test("admission and visit reasons, colchicine for pericarditis and TSH on amiodarone offer their pathways", async () => {
  const pid = await newPatient(["af"]);
  await tx(async (q) => { await K.startVisit(q, doc, pid, { reasons: ["Pre-operative assessment"], symptoms: [], service: "Cardiology clinic", startedAt: nowIso() } as any); await reassess(q, pid, "sandbox"); });
  assert.ok(await rec(pid, "event.pre-procedure"));

  const p2 = await newPatient(["cad-ccs"]);
  await start(p2, "colchicine", 0.5, "BID", "Pericarditis", -1);
  assert.match((await rec(p2, "event.pericarditis")).title, /Colchicine started for pericarditis/);

  const p3 = await newPatient(["af"]);
  await start(p3, "amiodarone", 200, "OD", "af");
  assert.equal((await rec(p3, "event.amiodarone-thyroid")).severity, "yellow", "no TSH recorded");
  await tx(async (q) => { await K.recordObservations(q, doc, p3, { effectiveAt: nowIso(), items: [{ code: "tsh", value: 0.05 }] }); await reassess(q, p3, "sandbox"); });
  const r3 = await rec(p3, "event.amiodarone-thyroid");
  assert.equal(r3.severity, "orange");
  assert.match(r3.title, /thyrotoxicosis/);
  await tx(async (q) => { await K.recordObservations(q, doc, p3, { effectiveAt: nowIso(), items: [{ code: "tsh", value: 2.1 }] }); await reassess(q, p3, "sandbox"); });
  assert.equal(await rec(p3, "event.amiodarone-thyroid"), undefined, "normal TSH: nothing to do");
});

test("management plans are not complications: diabetes and Ramadan open no episode", async () => {
  const { WIZARDS } = await import("../shared/wizards.js");
  assert.equal(WIZARDS.diabetes.episode, false);
  assert.equal(WIZARDS.ramadan.episode, false);
  assert.notEqual(WIZARDS.hyperkalaemia.episode, false);
});
