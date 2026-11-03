// 3 Nov 2026 — the overview snapshot (Ahmed: "what is needed to be done, the story and the actual running problem";
// "result of stress MIBI done recently does not show"; "patient is going for operation so the pre-procedure pathway,
// echo results and stress MIBI result are priorities to show"). Synthetic patients.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { importCase, caseSchema } from "../server/kernel/case-import.js";
import { reassess } from "../server/engine/engine.js";
import { summary } from "../server/kernel/views.js";
import { today, type Actor } from "../server/kernel/base.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const ago = (days: number) => new Date(Date.parse(today() + "T09:00:00Z") - days * 864e5).toISOString().slice(0, 10);
const load = async (c: any) => {
  const id = await db.transaction(async (q: any) => { const id = await importCase(q, doc, caseSchema.parse({ format: "cardioflow-case/1", sample: true, ...c })); await reassess(q, id, "production"); return id; });
  return summary(db, id) as Promise<any>;
};
const pt = (sex: "Male" | "Female" = "Female") => ({ name: "Snap " + Math.random().toString(36).slice(2, 7), mrn: "S" + Date.now() + Math.random().toString(36).slice(2, 5), sex, age: 70 });

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());

test("a recent stress MIBI shows in the latest tests and the story, with its tone", async () => {
  const s = await load({
    patient: pt(), conditions: [{ code: "htn" }, { code: "cad-suspected" }],
    echoes: [{ date: ago(60), lvef: 60, findings: ["LV hypertrophy"] }],
    studies: [{ kind: "nuclear", date: ago(20), findings: { stressor: "Adenosine", result: "Normal perfusion", wall: "Normal" }, conclusion: "No ischaemia." }],
  });
  const tests = s.snapshot.tests;
  assert.equal(tests[0].label, "Stress MIBI");
  assert.equal(tests[0].tone, "good");
  assert.match(tests[0].text, /Normal perfusion/);
  assert.equal(tests[0].recent, true);
  assert.equal(tests[1].label, "Echo");
  assert.match(tests[1].text, /EF 60% · LV hypertrophy/);
  assert.ok(s.chronology.items.some((i: any) => /Stress MIBI: Adenosine · Normal perfusion/.test(i.text) && i.tone === "good"));
});

test("a planned operation is the running problem and offers the pre-procedure pathway", async () => {
  const s = await load({
    patient: pt(), conditions: [{ code: "af", attributes: { pattern: "Permanent" } }],
    plan: [{ category: "follow_up", title: "Pre-operative cardiac clearance for hernia repair", dueDate: null }],
  });
  assert.ok(s.snapshot.now.some((n: any) => /Pre-operative cardiac clearance/.test(n.text)));
  const pre = s.attention.find((a: any) => a.action?.wizard === "pre-procedure");
  assert.ok(pre, "pre-procedure pathway offered");
  assert.match(pre.title, /^Planned: Pre-operative cardiac clearance/);
});

test("a work-up test is awaited, not the operation itself", async () => {
  const s = await load({
    patient: pt(), conditions: [{ code: "liver-disease" }],
    plan: [{ category: "investigation", title: "Echocardiogram (pre-transplant work-up)", dueDate: null }],
  });
  assert.ok(s.snapshot.now.some((n: any) => /^Awaiting: Echocardiogram/.test(n.text)));
  assert.ok(!s.snapshot.now.some((n: any) => n.text === "Echocardiogram (pre-transplant work-up)"));
  assert.ok(!s.attention.some((a: any) => a.action?.wizard === "pre-procedure"));
});

test("a positive ischaemia test without a later angiogram is a running problem; PCI at the same cath is not", async () => {
  const pos = await load({
    patient: pt("Male"), conditions: [{ code: "t2dm" }, { code: "cad-suspected" }],
    studies: [{ kind: "nuclear", date: ago(10), findings: { stressor: "Adenosine", result: "Reversible defect (ischaemia)", extent: "Moderate", territory: ["RCA"] } }],
  });
  const line = pos.snapshot.now.find((n: any) => /^Stress MIBI/.test(n.text));
  assert.equal(line?.tone, "bad");
  assert.equal(pos.snapshot.tests[0].tone, "bad");
  const pci = await load({
    patient: pt("Male"), conditions: [{ code: "prior-mi", onset: ago(120), attributes: { type: "STEMI", territory: "Inferior" } }],
    studies: [{ kind: "cath", date: ago(120), findings: { lm: "None", lad: "None", lcx: "None", rca: "Occluded", outcome: "PCI performed" } }],
    procedures: [{ kind: "pci", date: ago(120), details: { historical: "day", setting: "stemi", vessels: ["RCA"], devices: ["Drug-eluting stent"], stents: 1 } }],
  });
  assert.ok(!pci.snapshot.now.some((n: any) => /^Cath/.test(n.text)), "treated at the same cath");
  assert.ok(pci.snapshot.now.some((n: any) => /Inferior STEMI → PCI RCA/.test(n.text)));
  assert.ok(!pci.chronology.items.some((i: any) => /^Cath:/.test(i.text)), "the PCI tells the cath");
});

test("a recent discharge and a new diagnosis are the running problem", async () => {
  const s = await load({
    patient: pt("Male"), conditions: [{ code: "af", onset: ago(7), attributes: { pattern: "First diagnosed" } }],
    admissions: [{ startedOn: ago(7), endedOn: ago(6), reasons: ["AF / flutter"], events: ["New AF"], destination: "Home" }],
  });
  assert.ok(s.snapshot.now.some((n: any) => /^Discharged .* after admission for AF \/ flutter$/.test(n.text)));
  assert.ok(s.snapshot.now.some((n: any) => n.text === "New: Atrial fibrillation"));
});
