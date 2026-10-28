// 28 Oct 2026 — from real clinic cases (synthetic data here): a left main + 3-vessel angiogram referred for
// CABG that the patient declined must reach the overview; a falling or low creatinine is not news; liver
// enzymes use the laboratory's printed limits when none were entered; an LDL above goal is an abnormal result.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { importCase, caseSchema } from "../server/kernel/case-import.js";
import { reassess } from "../server/engine/engine.js";
import { summary } from "../server/kernel/views.js";
import { cathExtent } from "../shared/studies.js";
import type { Actor } from "../server/kernel/base.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const rnd = () => Math.random().toString(36).slice(2, 8);
const load = async (c: any) => {
  const id = await db.transaction(async (q: any) => {
    const id = await importCase(q, doc, caseSchema.parse({ format: "cardioflow-case/1", sample: true, ...c, patient: { name: "Oct28 " + rnd(), mrn: "O28" + rnd(), ...c.patient } }));
    await reassess(q, id, "production");
    return id;
  });
  return { id, s: (await summary(db, id, "production")) as any };
};
const active = async (pid: string) => (await db.query(`SELECT rule_id, title, severity FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
const cath = { lm: "70–99%", lad: "70–99%", lcx: "Occluded", rca: "70–99%" };

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());

test("cathExtent names left main and the vessels", () => {
  assert.equal(cathExtent(cath)!.short, "Left main + 3-vessel disease");
  assert.equal(cathExtent({ lm: "None", lad: "70–99%", lcx: "<50%", rca: "None" })!.prognostic, false);
  assert.equal(cathExtent({ lm: "None", lad: "None", lcx: "None", rca: "None" }), null);
});

test("left main + 3-vessel disease, CABG declined (left against medical advice): a decision on the overview", async () => {
  const { id, s } = await load({
    patient: { sex: "Male", age: 67 },
    conditions: [{ code: "cad-ccs" }],
    studies: [{ kind: "cath", date: "2026-09-16", findings: { ...cath, outcome: "Referred for CABG" } }],
    admissions: [{ startedOn: "2026-09-15", endedOn: "2026-09-16", reasons: ["Elective procedure"], events: ["Coronary angiography"], destination: "Left against medical advice" }],
  });
  const r = (await active(id)).find((x) => x.rule_id === "cad.cath-revascularisation");
  assert.ok(r, "the revascularisation decision is shown");
  assert.match(r.title, /declined CABG/);
  assert.equal(r.severity, "orange");
  assert.match(s.header.ihd.label, /Left main \+ 3-vessel disease \(cath 2026\), CABG declined/);
  assert.ok(s.chronology.items.some((i: any) => /Admitted 1 day: .*left against medical advice/.test(i.text)));
});

test("referred for CABG and not declined: surgery not yet recorded; gone once the CABG is recorded", async () => {
  const { id } = await load({
    patient: { sex: "Female", age: 70 },
    conditions: [{ code: "cad-ccs" }],
    studies: [{ kind: "cath", date: "2026-09-16", findings: { ...cath, outcome: "Referred for CABG" } }],
  });
  assert.match((await active(id)).find((x) => x.rule_id === "cad.cath-revascularisation")?.title ?? "", /referred for CABG — surgery not yet recorded/);
  const { id: id2 } = await load({
    patient: { sex: "Female", age: 70 },
    conditions: [{ code: "cad-ccs" }],
    studies: [{ kind: "cath", date: "2026-09-16", findings: { ...cath, outcome: "Referred for CABG" } }],
    procedures: [{ kind: "cabg", date: "2026-10-01", details: { historical: "day", grafts: ["LIMA to LAD", "Vein grafts"] } }],
  });
  assert.ok(!(await active(id2)).some((x) => x.rule_id === "cad.cath-revascularisation"));
});

test("one-vessel disease treated medically: no revascularisation card", async () => {
  const { id } = await load({
    patient: { sex: "Male", age: 60 },
    conditions: [{ code: "cad-ccs" }],
    studies: [{ kind: "cath", date: "2026-09-16", findings: { lm: "None", lad: "70–99%", lcx: "None", rca: "None", outcome: "Medical therapy" } }],
  });
  assert.ok(!(await active(id)).some((x) => x.rule_id === "cad.cath-revascularisation"));
});

test("a falling or low creatinine is not news; a rising one is", async () => {
  const { s } = await load({
    patient: { sex: "Female", age: 67 },
    conditions: [{ code: "htn" }],
    results: [{ date: "2026-03-25", items: [{ code: "creatinine", value: 70 }] }, { date: "2026-10-20", items: [{ code: "creatinine", value: 45 }] }],
  });
  assert.ok(!(s.story ?? []).some((l: any) => /creatinine/.test(l.text)), JSON.stringify(s.story));
  assert.ok(!s.abnormal.items.some((x: any) => x.code === "creatinine"));
  const { s: s2 } = await load({
    patient: { sex: "Female", age: 67 },
    conditions: [{ code: "htn" }],
    results: [{ date: "2026-03-25", items: [{ code: "creatinine", value: 70 }] }, { date: "2026-10-20", items: [{ code: "creatinine", value: 110 }] }],
  });
  assert.ok((s2.story ?? []).some((l: any) => /creatinine rose/.test(l.text)), JSON.stringify(s2.story));
});

test("liver enzymes use the laboratory's printed limits; no request to enter them", async () => {
  const { id, s } = await load({
    patient: { sex: "Female", age: 60 },
    conditions: [{ code: "dyslipidaemia" }],
    results: [{ date: "2026-10-20", items: [{ code: "alt", value: 30 }, { code: "ast", value: 31 }] }],
  });
  assert.ok(!(await active(id)).some((x) => /verify report limits/.test(x.title)));
  assert.ok(!s.abnormal.items.some((x: any) => x.code === "alt" || x.code === "ast"));
  const { id: id2, s: s2 } = await load({
    patient: { sex: "Female", age: 60 },
    conditions: [{ code: "dyslipidaemia" }],
    results: [{ date: "2026-10-20", items: [{ code: "alt", value: 80 }] }],
  });
  assert.ok((await active(id2)).some((x) => x.rule_id === "lab.liver-enzymes" && /result review/.test(x.title)));
  assert.equal(s2.abnormal.items.find((x: any) => x.code === "alt")?.note, "2.3× ULN");
});

test("an LDL above goal is an abnormal result", async () => {
  const { s } = await load({
    patient: { sex: "Male", age: 67 },
    conditions: [{ code: "cad-ccs" }],
    results: [{ date: "2026-09-15", items: [{ code: "ldl-c", value: 1.61 }] }],
  });
  assert.ok(s.abnormal.items.some((x: any) => x.code === "ldl-c" && /goal/.test(x.note)), JSON.stringify(s.abnormal.items));
});
