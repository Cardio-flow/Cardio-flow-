import { test } from "node:test";
import assert from "node:assert/strict";
import { consultationPriorities } from "../shared/consultation.js";
const today = "2026-10-28";
const rec = (
  id: string,
  rule_id: string,
  severity = "orange",
  extra: any = {},
) => ({
  id,
  rule_id,
  severity,
  title: id,
  action: { type: "wizard" },
  ...extra,
});
test("mixed HF/CKD case separates safety, missing evidence, management and preventive care", () => {
  const x = consultationPriorities(
    [
      rec("K", "hf.hyperkalaemia-review", "red"),
      rec("HF", "hf.titration"),
      rec("renal", "hf.worsening-renal-function", "orange", {
        missing: ["Potassium"],
      }),
      rec("retina", "dm.annual-checks", "yellow"),
      rec("lpa", "lipids.lpa-once", "yellow"),
    ],
    [],
    today,
  );
  assert.deepEqual(x.urgentIds, ["K"]);
  assert.deepEqual(x.clarifyIds, ["renal"]);
  assert.deepEqual(x.decisionIds, ["HF"]);
  assert.deepEqual(x.routineIds, ["retina", "lpa"]);
  assert.equal(x.connected.length, 1);
  assert.deepEqual(x.gaps, ["Potassium"]);
});
test("AF and coronary review stays connected without claiming either decision completed", () => {
  const x = consultationPriorities(
    [rec("AF", "af.anticoagulation"), rec("CAD", "cad.dapt-beyond-default")],
    [],
    today,
  );
  assert.equal(x.connected.length, 1);
  assert.deepEqual(x.connected[0].recommendationIds, ["AF", "CAD"]);
  assert.equal(x.counts.decisions, 2);
  assert.equal(x.counts.review, 0);
});
test("a result received is still awaiting review; cancelled and reviewed actions do not reappear", () => {
  const plan = [
    {
      id: "review",
      title: "Renal assessment",
      status: "completed",
      awaitingReview: true,
    },
    {
      id: "done",
      title: "Reviewed",
      status: "completed",
      awaitingReview: false,
    },
    { id: "cancel", title: "Cancelled", status: "cancelled", dueDate: today },
    { id: "due", title: "Potassium", status: "planned", dueDate: today },
    { id: "next", title: "HF visit", status: "planned", dueDate: "2026-11-04" },
    { id: "later", title: "Echo", status: "planned", dueDate: "2026-12-04" },
    {
      id: "annual",
      title: "Diabetic retinal screening",
      status: "planned",
      dueDate: today,
    },
  ];
  const x = consultationPriorities([], plan, today);
  assert.deepEqual(x.reviewIds, ["review"]);
  assert.deepEqual(x.dueIds, ["due"]);
  assert.equal(x.next?.id, "next");
});
test("a red preventive-rule finding stays visible, and missing regimens require reconciliation", () => {
  const x = consultationPriorities(
    [rec("urgent", "dm.annual-checks", "red")],
    [],
    today,
    [
      {
        id: "m",
        name: "Bisoprolol",
        status: "active",
        doseValue: null,
        frequency: null,
        route: "PO",
      },
      {
        id: "stopped",
        name: "Old drug",
        status: "stopped",
        doseValue: null,
        frequency: null,
      },
    ],
  );
  assert.deepEqual(x.urgentIds, ["urgent"]);
  assert.equal(x.reconciliation.length, 1);
  assert.match(x.reconciliation[0].label, /confirm dose, frequency/);
});
test("an empty chart does not imply clinical stability or a completed assessment", () => {
  const x = consultationPriorities([], [], today);
  assert.equal(x.next, null);
  assert.deepEqual(x.connected, []);
  assert.deepEqual(x.gaps, []);
  assert.ok(!("stable" in x));
});

test("clinical links follow a selected older result instead of a later contradictory report", async () => {
  const { linkAttention } = await import("../server/engine/links.js");
  const old = {
    id: "old",
    code: "haemoglobin",
    status: "final",
    value_num: 10,
    effective_at: "2026-10-01",
  };
  const newer = {
    ...old,
    id: "new",
    value_num: 14,
    effective_at: "2026-10-20",
  };
  const s: any = {
    today,
    patient: { sex: "Female" },
    meds: [],
    contexts: [],
    conditions: [],
    observations: [old, newer],
    resolved: (code: string) => ({
      current: code === "haemoglobin" ? old : null,
      history: code === "haemoglobin" ? [newer, old] : [],
    }),
  };
  const items = linkAttention(s, [
    { id: "dapt", rule_id: "cad.dapt-beyond-default", title: "Review DAPT" },
  ]);
  assert.ok(items[0].links?.some((l) => l.includes("Hb 10")));
  assert.ok(!items[0].links?.some((l) => l.includes("Hb 14")));
});
test("several HF titration recommendations count as one management problem", () => {
  const x = consultationPriorities(
    [
      rec("bb", "hf.titration"),
      rec("raas", "hf.titration"),
      rec("mra", "hf.foundational-therapy"),
    ],
    [],
    today,
  );
  assert.equal(x.decisionIds.length, 3);
  assert.equal(x.counts.decisions, 1);
});
