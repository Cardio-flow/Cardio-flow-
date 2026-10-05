import { test } from "node:test";
import assert from "node:assert/strict";
import { laneOf, triage, type Finding } from "../shared/triage.js";

let n = 0;
const f = (rule_id: string, severity: Finding["severity"], action: any = {}, title = rule_id): Finding => ({ id: "f" + n++, rule_id, severity, title, detail: "", action });

test("lanes: red and orange safety act now; due tests are ordered; blue is considered; the rest is decided", () => {
  assert.equal(laneOf(f("lipids.ldl-goal", "red")), "act");
  assert.equal(laneOf(f("med.interaction", "orange", { type: "tab", tab: "medications" })), "act");
  assert.equal(laneOf(f("event.chest-infection", "orange", { type: "wizard", wizard: "chest-infection" })), "act");
  assert.equal(laneOf(f("hf.congestion", "orange", { type: "wizard", wizard: "congestion" })), "act");
  assert.equal(laneOf(f("hf.foundational-therapy", "orange", { type: "start-med" })), "decide");
  assert.equal(laneOf(f("cardiorenal.screening", "yellow", { type: "add-labs", codes: ["uacr"] })), "order");
  assert.equal(laneOf(f("lipids.lpa-once", "blue", { type: "add-labs", codes: ["lpa"] })), "order");
  assert.equal(laneOf(f("med.monitoring", "yellow", { type: "add-plan", template: "mon-doac" })), "order");
  assert.equal(laneOf(f("hf.advanced-hf", "orange", { type: "add-plan", template: "advanced-hf" })), "decide", "a referral is a decision");
  assert.equal(laneOf(f("hf.device-assessment", "blue", { type: "add-plan", template: "echo" })), "consider");
  assert.equal(laneOf(f("metabolic.obesity", "blue", { type: "start-med" })), "consider");
});

test("merges: HF medicines become one card with the device note; one card per pathway; antithrombotic + PPI together", () => {
  const cards = triage([
    f("hf.foundational-therapy", "orange", { type: "start-med" }),
    f("hf.titration", "blue", { type: "titrate" }),
    f("hf.titration", "blue", { type: "titrate" }),
    f("hf.device-assessment", "blue", { type: "add-plan", template: "ecg" }),
    f("valve.severe-heart-team", "orange", { type: "wizard", wizard: "valve-heart-team" }),
    f("valve.intervention-trigger", "orange", { type: "wizard", wizard: "valve-heart-team" }),
    f("med.oac-antiplatelet", "yellow", { type: "tab", tab: "medications" }),
    f("cad.ppi-combined-antithrombotic", "yellow", { type: "start-med" }),
    f("med.interaction", "red", { type: "tab", tab: "medications" }),
  ]);
  assert.deepEqual(cards.map((c) => [c.lane, c.key.replace(/^f\d+$/, "single"), c.items.length]), [
    ["act", "single", 1],
    ["decide", "hf-meds", 3],
    ["decide", "wiz-valve-heart-team", 2],
    ["decide", "antithrombotic", 2],
  ]);
  assert.equal(cards[1].title, "Heart failure medicines: 3 steps");
  assert.match(cards[1].note!, /ICD \/ CRT/);
});

test("no bundle from a PPI alone, and a single HF finding keeps the device note", () => {
  const cards = triage([f("cad.ppi-combined-antithrombotic", "yellow", { type: "start-med" }), f("hf.foundational-therapy", "orange", { type: "start-med" }), f("hf.device-assessment", "blue", { type: "add-plan", template: "ecg" })]);
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.items.length === 1));
  assert.match(cards.find((c) => c.lead.rule_id === "hf.foundational-therapy")!.note!, /ICD/);
});
