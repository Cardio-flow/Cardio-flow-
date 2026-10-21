import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { planContext } from "../server/engine/plan-context.js";
import { RULES } from "../server/engine/rules.js";
import { overviewCounts } from "../shared/overview.js";
import { TodayBoard } from "../src/screens/Today.js";
import { planView, overview } from "../server/kernel/views.js";
import type { PatientState, PlanRow } from "../server/kernel/state.js";

const task = (extra: Partial<PlanRow> = {}) =>
  ({
    id: "task",
    title: "Recorded assessment",
    category: "referral",
    reason: "",
    due_date: "2026-10-21",
    status: "planned",
    progress: "planned",
    version: 1,
    completes_on: { type: "manual" },
    decision_id: "decision",
    decision_refs: ["decision"],
    completion_refs: [],
    ...extra,
  }) as PlanRow;
const state = (plan: PlanRow[]) =>
  ({
    today: "2026-10-21",
    plan,
    episodes: [],
    contexts: [],
    observations: [],
    procedures: [],
    studies: [],
    patient: {},
    meds: [],
    status: { vital: null },
    deceased: false,
  }) as unknown as PatientState;
const rule = RULES.find((r) => r.id === "ops.plan-due")!;

for (const [wizard, answers] of [
  ["pregnancy-plan", { safety: "urgent" }],
  ["syncope", { disposition: "urgent" }],
  ["aorta-plan", { strategy: "urgent" }],
  ["pericarditis", { route: "urgent" }],
  ["after-rdn", { safety: "urgent" }],
  ["htn-review", { safety: "urgent" }],
] as const) {
  test(`${wizard}: recorded urgent care stays red through performance, including a moved date`, () => {
    const p = task({
      decision_sources: [{ id: "decision", wizard, ruleId: null, answers }],
    });
    const s = state([p]);
    assert.equal(rule.evaluate(s, {})[0].severity, "red");
    p.due_date = "2026-10-22";
    assert.equal(rule.evaluate(s, {})[0].severity, "red");
    assert.match(rule.evaluate(s, {})[0].title, /outstanding$/);
    p.status = "completed";
    p.progress = "performed";
    assert.equal(rule.evaluate(s, {})[0].severity, "red");
    p.progress = "reviewed";
    assert.equal(rule.evaluate(s, {}).length, 0);
  });
}
test("routine monitoring never inherits urgency from a safety rule; reused booking keeps source ownership", () => {
  const p = task({
    decision_sources: [
      {
        id: "decision",
        wizard: "hyperkalaemia",
        ruleId: "hf.hyperkalaemia-review",
        answers: {},
      },
    ],
  });
  const s = state([p]);
  assert.equal(rule.evaluate(s, {})[0].severity, "yellow");
  assert.equal(planContext(s, p).problem, "kidney");
  p.decision_id = null; // legacy or reused booking, with the recorded decision_refs retained
  assert.equal(planContext(s, p).problem, "kidney");
});
test("Next puts today's outstanding assessment before a future appointment", () => {
  const s = state([task(), task({ id: "future", due_date: "2026-11-01" })]);
  const view = overview(s, [], planView(s), {
    since: null,
    label: null,
    items: [],
  });
  assert.equal(view.next[0].id, "task");
  assert.equal(view.counts.tasks, 1);
});
test("counts distinguish unique decisions, due tasks and performed results", () => {
  const attention = [
    {
      id: "a",
      severity: "orange",
      action: { type: "wizard", wizard: "diabetes" },
    },
    {
      id: "b",
      severity: "yellow",
      action: { type: "wizard", wizard: "diabetes" },
    },
    { id: "c", severity: "red", action: { type: "med-action" } },
    { id: "d", severity: "yellow", action: { type: "plan" } },
    { id: "e", severity: "yellow", action: { type: "add-labs" } },
  ];
  assert.deepEqual(
    overviewCounts(attention, [
      { view: "due" },
      { view: "overdue" },
      { view: "review", awaitingReview: true },
    ]),
    { urgent: 1, decisions: 2, tasks: 2, review: 1 },
  );
});
test("one diabetes pathway button while specific medication safety actions remain visible", () => {
  const attention = [
    {
      id: "a",
      title: "Review glycaemic control",
      rule_id: "dm.glycaemic-control",
      severity: "orange",
      rule_status: "PUBLISHED",
      action: { type: "wizard", wizard: "diabetes" },
    },
    {
      id: "b",
      title: "Annual checks due",
      rule_id: "dm.annual-checks",
      severity: "yellow",
      rule_status: "PUBLISHED",
      action: { type: "wizard", wizard: "diabetes" },
    },
    {
      id: "c",
      title: "Medicine safety",
      rule_id: "dm.safety",
      severity: "red",
      rule_status: "PUBLISHED",
      action: {
        type: "med-action",
        medicationId: "med",
        label: "Stop unsafe medicine",
      },
    },
  ];
  const s = {
    attention,
    today: "2026-10-21",
    header: { id: "patient" },
    plan: [],
    targets: {},
    medications: { groups: [] },
  };
  const html = renderToStaticMarkup(
    createElement(TodayBoard, { s, open() {}, done() {} }),
  );
  assert.equal(
    (html.match(/>Review diabetes care<\/button>/g) ?? []).length,
    1,
  );
  assert.ok(!html.includes(">Diabetes plan</button>"));
  assert.match(html, />Stop unsafe medicine<\/button>/);
  assert.match(html, /Annual checks due/);
});

test("episode results awaiting review stay in the episode, not duplicated on Today", () => {
  const s = {
    attention: [],
    today: "2026-10-21",
    header: { id: "patient" },
    targets: {},
    medications: { groups: [] },
    episodes: [{ id: "infection", status: "open", open: [] }],
    plan: [
      {
        id: "lab",
        title: "Episode blood panel",
        status: "completed",
        awaitingReview: true,
        clinicalContext: {
          episodeId: "infection",
          problem: "infection",
          urgent: false,
        },
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(TodayBoard, { s, open() {}, done() {} }),
  );
  assert.ok(!html.includes("Episode blood panel"));
  assert.match(html, /1 awaiting review/);
});
