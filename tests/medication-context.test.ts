import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentedContexts,
  medicationContexts,
  reviewedDosePresets,
} from "../src/medication-context.js";

test("medication navigation uses documented context and never creates unreviewed dose options", () => {
  const contexts = documentedContexts(
    [
      { title: "HFrEF", family: "HF" },
      { title: "Coronary artery disease", family: "CAD" },
    ],
    ["Chronic kidney disease"],
  );
  assert.deepEqual(contexts, ["HFrEF", "cad", "cardiorenal-protection"]);
  const medication = {
    groups: [
      { group_id: "hf-cardiorenal", name: "Heart Failure / Cardiorenal" },
    ],
  };
  assert.deepEqual(medicationContexts(medication, contexts), [
    "HFrEF",
    "cardiorenal-protection",
  ]);
  assert.deepEqual(
    reviewedDosePresets({
      reviewed_on: null,
      dose_metadata: { state: "reviewed", presets: [{ value: 5, unit: "mg" }] },
    }),
    [],
  );
  assert.deepEqual(
    reviewedDosePresets({
      reviewed_on: "2026-09-23",
      dose_metadata: {
        state: "not_clinically_curated",
        presets: [{ value: 5, unit: "mg" }],
      },
    }),
    [],
  );
  assert.deepEqual(
    reviewedDosePresets({
      reviewed_on: "2026-09-23",
      dose_metadata: {
        state: "reviewed",
        presets: [{ value: 5, unit: "mg", label: "5 mg" }],
      },
    }),
    [{ value: 5, unit: "mg", label: "5 mg" }],
  );
});
