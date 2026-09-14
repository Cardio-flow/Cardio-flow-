import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  addDays,
  taskState,
  patientSchema,
  episodeSchema,
  csv,
} from "../server/domain.js";
test("Calendar month arithmetic clamps month ends and preserves leap days", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2025-01-31", 1), "2025-02-28");
  assert.equal(addMonths("2024-02-29", 12), "2025-02-28");
  assert.equal(addMonths("2025-12-31", 3), "2026-03-31");
});
test("Follow-up status changes at exact due and window boundaries", () => {
  const t = {
    state: "scheduled",
    due_date: "2026-09-10",
    window_end: "2026-09-24",
  };
  assert.equal(taskState(t, "2026-09-02"), "scheduled");
  assert.equal(taskState(t, "2026-09-03"), "due soon");
  assert.equal(taskState(t, "2026-09-10"), "due");
  assert.equal(taskState(t, "2026-09-24"), "due");
  assert.equal(taskState(t, "2026-09-25"), "overdue");
  assert.equal(
    taskState({ ...t, state: "satisfied" }, "2027-01-01"),
    "satisfied",
  );
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
});
test("Identity validation rejects invalid dates and non-synthetic identifiers", () => {
  const p = {
    name: "Test Sample",
    mrn: "SYN-TEST",
    sex: "Female",
    birth_date: "1980-01-01",
  };
  assert.ok(patientSchema.safeParse(p).success);
  assert.equal(
    patientSchema.safeParse({ ...p, birth_date: "2025-02-30" }).success,
    false,
  );
  assert.equal(patientSchema.safeParse({ ...p, mrn: "123456" }).success, false);
});
test("Structural validation rejects chronology and stents without PCI", () => {
  const e = {
    version: 1,
    admission_date: "2025-01-02",
    discharge_date: "2025-01-01",
    presentation: null,
    management: null,
    access_site: null,
    discharge_status: null,
    lesions: [],
  };
  assert.equal(episodeSchema.safeParse(e).success, false);
  assert.equal(
    episodeSchema.safeParse({
      ...e,
      discharge_date: null,
      lesions: [
        {
          vessel: "LAD",
          segment: "Mid",
          stenosis: 50,
          treatment: "Medical therapy",
          stents: [{ diameter: 3, length: 24, type: "DES" }],
        },
      ],
    }).success,
    false,
  );
});
test("CSV quoting protects formula injection and preserves commas and newlines", () => {
  assert.equal(
    csv([["=SUM(A1)", 'a,"b"', "two\nlines", null]]),
    '"\'=SUM(A1)","a,""b""","two\nlines",""',
  );
});
