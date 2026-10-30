import { test } from "node:test";
import assert from "node:assert/strict";
import { story } from "../server/kernel/story.js";
import { studySummary } from "../shared/studies.js";
import { CAD_TEST_RULES } from "../server/engine/cad-tests.js";
const today = "2026-10-29";
const obs = (id: string, code: string, value: number, day: string) => ({
  id,
  code,
  value_num: value,
  status: "final",
  effective_at: day + "T09:00:00Z",
});
function state(observations: any[] = [], contexts: any[] = []): any {
  return {
    today,
    patient: { sex: "Male" },
    contexts,
    observations,
    meds: [],
    conditions: [],
    studies: [],
    procedures: [],
    pathwaysDone: {},
    plan: [],
    resolved: (code: string) => ({
      current: observations.filter((o) => o.code === code).at(-1),
      history: observations.filter((o) => o.code === code),
    }),
  };
}
const admission = {
  kind: "admission",
  status: "closed",
  started_at: "2026-09-20T09:00:00Z",
  ended_at: "2026-10-01T09:00:00Z",
  summary: {},
};
const suspected = (attributes: any) => ({
  ...state(),
  conditions: [
    {
      id: "dx",
      code: "cad-suspected",
      onset: "2026-09-01",
      recorded_at: "2026-09-01",
    },
  ],
  studies: [
    {
      id: "cath",
      kind: "cath",
      performed_at: "2026-10-01T09:00:00Z",
      attributes,
    },
  ],
});
const evaluate = (s: any) =>
  CAD_TEST_RULES.find((r) => r.id === "cad.suspected-workup")!.evaluate(s, {});
test("not-assessed coronary anatomy never becomes a negative angiogram", () => {
  const a = {
    lm: "Not assessed",
    lad: "None",
    lcx: "None",
    rca: "None",
    outcome: "Medical therapy",
  };
  assert.ok(!studySummary("cath", a).includes("No obstructive"));
  assert.ok(
    !evaluate(suspected(a)).some((r) => r.title.includes("no obstructive")),
  );
});
test("fully documented nonobstructive anatomy still offers diagnosis resolution", () => {
  const a = {
    lm: "None",
    lad: "<50%",
    lcx: "None",
    rca: "None",
    outcome: "Medical therapy",
  };
  assert.match(studySummary("cath", a), /No obstructive/);
  assert.ok(
    evaluate(suspected(a)).some((r) => r.title.includes("no obstructive")),
  );
});
for (const [code, a, b] of [
  ["potassium", 6.2, 5.5],
  ["sodium", 120, 128],
  ["magnesium", 0.4, 0.6],
] as const)
  test(`${code}: improving abnormality is not described as harmful deterioration`, () => {
    const s = state(
      [obs("a", code, a, "2026-09-30"), obs("b", code, b, "2026-10-20")],
      [admission],
    );
    assert.equal(
      story(s).some((l) => l.key === "since"),
      false,
    );
  });
test("a worsening electrolyte still reaches the clinical story", () => {
  const s = state(
    [
      obs("a", "potassium", 4, "2026-09-30"),
      obs("b", "potassium", 5.8, "2026-10-20"),
    ],
    [admission],
  );
  assert.ok(story(s).some((l) => l.key === "since"));
});
test("a clinician-selected result controls the current trend, not a later discarded interpretation", () => {
  const selected = obs("selected", "creatinine", 100, "2026-10-20");
  const s = state(
    [
      obs("base", "creatinine", 150, "2026-09-30"),
      selected,
      obs("later", "creatinine", 250, "2026-10-22"),
    ],
    [admission],
  );
  s.resolved = () => ({ current: selected, history: s.observations });
  assert.equal(
    story(s).some((l) => l.key === "since"),
    false,
  );
});
test("a later clinic visit is the comparison anchor instead of an older discharge", () => {
  const s = state(
    [
      obs("a", "creatinine", 90, "2026-09-30"),
      obs("b", "creatinine", 180, "2026-10-09"),
      obs("c", "creatinine", 170, "2026-10-20"),
    ],
    [
      admission,
      {
        kind: "clinic_visit",
        status: "closed",
        started_at: "2026-10-10T09:00:00Z",
        ended_at: "2026-10-10T10:00:00Z",
        summary: {},
      },
    ],
  );
  assert.equal(
    story(s).some((l) => l.key === "since"),
    false,
  );
});
test("leaving against advice alone is not documentation of declining CABG", () => {
  const s = state();
  s.studies = [
    {
      id: "cath",
      kind: "cath",
      performed_at: "2026-10-01T09:00:00Z",
      attributes: {
        lm: "70–99%",
        lad: "70–99%",
        lcx: "70–99%",
        rca: "70–99%",
        outcome: "Referred for CABG",
      },
    },
  ];
  s.contexts = [
    { ...admission, summary: { destination: "Left against medical advice" } },
  ];
  const r = CAD_TEST_RULES.find(
    (r) => r.id === "cad.cath-revascularisation",
  )!.evaluate(s, {});
  assert.ok(r.length);
  assert.ok(!r[0].title.includes("patient declined CABG"));
});
test("explicit CABG refusal remains a visible management decision", () => {
  const s = state();
  s.studies = [
    {
      id: "cath",
      kind: "cath",
      performed_at: "2026-10-01T09:00:00Z",
      attributes: {
        lm: "70–99%",
        lad: "70–99%",
        lcx: "70–99%",
        rca: "70–99%",
        outcome: "CABG declined by patient",
      },
    },
  ];
  const r = CAD_TEST_RULES.find(
    (r) => r.id === "cad.cath-revascularisation",
  )!.evaluate(s, {});
  assert.match(r[0].title, /patient declined CABG/);
});
test("a dated historical admission remains a valid fallback when no clinical encounter exists", () => {
  const s = state(
    [
      obs("a", "creatinine", 90, "2026-09-30"),
      obs("b", "creatinine", 180, "2026-10-20"),
    ],
    [{ ...admission, summary: { historical: true } }],
  );
  assert.ok(story(s).some((l) => l.label === "Since discharge"));
});
test("an open admission does not get described as a completed discharge", () => {
  const s = state(
    [
      obs("a", "creatinine", 90, "2026-09-30"),
      obs("b", "creatinine", 180, "2026-10-20"),
    ],
    [{ ...admission, status: "open", ended_at: null }],
  );
  assert.ok(!story(s).some((l) => l.label === "Since discharge"));
});
test('crossing from hyperkalaemia to hypokalaemia is a new abnormal direction, not reassurance',()=>{
 const s=state([obs('a','potassium',6.2,'2026-09-30'),obs('b','potassium',2.9,'2026-10-20')],[admission]);
 assert.ok(story(s).some(l=>l.key==='since'&&l.text.includes('potassium fell')));
});
