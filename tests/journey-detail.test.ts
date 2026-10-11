import { test } from "node:test";
import assert from "node:assert/strict";
import { journeySummary } from "../server/kernel/journey-detail.js";

test("legacy AF entry separates recorded facts from plan dates and unchosen suggestions", () => {
  const original =
    "Pattern: Permanent · CHA₂DS₂-VA: 3 (Heart failure +1, Hypertension +1, Age 65–74 +1) · Heart rate: 112 bpm · LVEF: Not recorded · No LVEF recorded: echocardiography guides rate and rhythm choices. · Reassess AF-CARE at 6 months, then at least yearly. · Clinic review · Sun 08 Nov 2026 · Rate control: add digoxin · Sun 11 Oct 2026 · Guideline suggestions not taken: Echocardiogram";
  const reading = journeySummary(original, [
    "Clinic review",
    "Rate control: add digoxin",
  ]);
  assert.deepEqual(reading.facts, [
    { label: "Pattern", value: "Permanent" },
    {
      label: "CHA₂DS₂-VA",
      value: "3 (Heart failure +1, Hypertension +1, Age 65–74 +1)",
    },
    { label: "Heart rate", value: "112 bpm" },
    { label: "LVEF", value: "Not recorded" },
  ]);
  assert.deepEqual(reading.notes, [
    "No LVEF recorded: echocardiography guides rate and rhythm choices.",
    "Reassess AF-CARE at 6 months, then at least yearly.",
  ]);
  assert(!JSON.stringify(reading).includes("08 Nov"));
  assert(
    original.includes("Guideline suggestions not taken"),
    "Original entry remains available without alteration",
  );
});

test("summary does not repeat a linked medicine change or invent facts for a free-text decision", () => {
  assert.deepEqual(
    journeySummary(
      "Pattern: First diagnosed · Apixaban 5 mg twice daily: start · Clinic review",
      ["Clinic review"],
      ["Apixaban"],
    ),
    { facts: [{ label: "Pattern", value: "First diagnosed" }], notes: [] },
  );
  assert.deepEqual(
    journeySummary("Patient requested postponement; review booked next week"),
    {
      facts: [],
      notes: ["Patient requested postponement; review booked next week"],
    },
  );
  assert.deepEqual(journeySummary(""), { facts: [], notes: [] });
});
