import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolveCurrent, addDays } from "../shared/clinical.js";
import { results, summary } from "../server/kernel/views.js";
import { hfDoseProgress } from "../server/engine/medication-progress.js";
import type { PatientState, MedState } from "../server/kernel/state.js";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { undoLastMedicationChange } from "../server/kernel/corrections.js";
import { today, type Actor } from "../server/kernel/base.js";

const obs = (
  id: string,
  value: number,
  at: string,
  status: "final" | "preliminary" | "entered_in_error" = "final",
  unit = "mmol/L",
) => ({
  id,
  code: "potassium",
  value_num: value,
  value_text: null,
  effective_at: at,
  status,
  quality: "standard" as const,
  source: "Lab",
  unit,
});
const state = (history: any[] = [], preferred: string | null = null) =>
  ({
    today: "2026-10-11",
    tags: new Set(["hf"]),
    conditions: [],
    patient: { age: 66 },
    resolved: (code: string) =>
      resolveCurrent(
        code === "potassium" || code === "egfr" ? history : [],
        preferred,
      ),
  }) as unknown as PatientState;
const med = (
  code: string,
  doseValue: number | null,
  frequency = "OD",
  status = "active",
) =>
  ({
    code,
    doseValue,
    doseUnit: "mg",
    frequency,
    route: "PO",
    status,
  }) as MedState;

test("latest lab trend uses earlier verified comparable measurements, with raw percentage and direction", () => {
  const s = state([
    obs("a", 4, "2026-10-01"),
    obs("b", 5, "2026-10-03"),
    obs("bad", 8, "2026-10-04", "entered_in_error"),
  ]);
  const r = results(s, ["potassium"])[0]!;
  assert.equal(r.latest.value, 5);
  assert.equal(r.trend.previous?.value, 4);
  assert.equal(r.trend.percent, 25);
  assert.equal(r.trend.direction, "up");
  assert.deepEqual(
    r.displaySeries.map((x) => x.value),
    [4, 5],
  );
  const falling = results(
    state([obs("a", 5, "2026-10-01"), obs("b", 4, "2026-10-03")]),
    ["potassium"],
  )[0]!;
  assert.equal(falling.trend.percent, -20);
  assert.equal(falling.trend.direction, "down");
});
test("newer preliminary and preferred older results are explicit and do not corrupt the clinical resolver", () => {
  const history = [
    obs("old", 4, "2026-10-01"),
    obs("new", 5, "2026-10-03"),
    obs("pre", 7, "2026-10-05", "preliminary"),
  ];
  const r = results(state(history), ["potassium"])[0]!;
  assert.equal(r.current.value, 5);
  assert.equal(r.latest.value, 7);
  assert.equal(r.latest.status, "preliminary");
  assert.equal(r.trend.percent, null);
  assert.equal(r.trend.note, "Awaiting verification");
  assert.deepEqual(r.displaySeries, []);
  const p = results(state(history.slice(0, 2), "old"), ["potassium"])[0]!;
  assert.equal(p.current.value, 4);
  assert.equal(p.latest.value, 5);
  assert.equal(p.trend.percent, 25);
});
test("zero baseline, units, duplicate collection times and single results never invent a percentage", () => {
  const zero = results(
    state([obs("a", 0, "2026-10-01"), obs("b", 4, "2026-10-03")]),
    ["potassium"],
  )[0]!;
  assert.equal(zero.trend.percent, null);
  assert.equal(zero.trend.delta, 4);
  for (const h of [
    [obs("a", 4, "2026-10-01")],
    [obs("a", 4, "2026-10-01", "final", "mg/dL"), obs("b", 5, "2026-10-03")],
    [obs("a", 4, "2026-10-01"), obs("b", 5, "2026-10-01")],
  ]) {
    assert.equal(results(state(h), ["potassium"])[0]!.trend.percent, null);
  }
});
test("HF reference percentages account for total daily dose, units, route, unknown regimens and non-HF patients", () => {
  const s = state();
  assert.equal(hfDoseProgress(s, med("valsartan", 160, "OD"))?.percent, 50);
  assert.equal(hfDoseProgress(s, med("valsartan", 160, "BID"))?.percent, 100);
  assert.equal(hfDoseProgress(s, med("ramipril", 5, "BID"))?.percent, 100);
  assert.equal(hfDoseProgress(s, med("ramipril", 5, "OD"))?.percent, 50);
  assert.equal(hfDoseProgress(s, med("bisoprolol", 5))?.percent, 50);
  assert.equal(hfDoseProgress(s, med("bisoprolol", null))?.percent, null);
  assert.equal(hfDoseProgress(s, med("bisoprolol", 5, "PRN"))?.percent, null);
  assert.equal(
    hfDoseProgress(s, { ...med("bisoprolol", 5), doseUnit: "mcg" })?.percent,
    null,
  );
  assert.equal(
    hfDoseProgress(s, { ...med("bisoprolol", 5), route: "IV" })?.percent,
    null,
  );
  assert.equal(
    hfDoseProgress({ ...s, tags: new Set(["htn"]) }, med("bisoprolol", 5)),
    null,
  );
  assert.equal(hfDoseProgress(s, med("furosemide", 40)), null);
  assert.equal(
    hfDoseProgress(s, med("bisoprolol", 5, "OD", "held"))?.status,
    "held",
  );
});
test("finerenone compares with the existing renal-dependent target; missing renal data stays missing", () => {
  assert.equal(
    hfDoseProgress(
      state([obs("renal", 45, "2026-10-01")]),
      med("finerenone", 20),
    )?.percent,
    100,
  );
  assert.equal(
    hfDoseProgress(
      state([obs("renal", 65, "2026-10-01")]),
      med("finerenone", 20),
    )?.percent,
    50,
  );
  assert.equal(hfDoseProgress(state(), med("finerenone", 20))?.percent, null);
});

let db: DB;
const doc: Actor = {
  id: "dr.test@cardioflow.local",
  name: "Dr Test",
  role: "clinician",
  siteId: SITE_ID,
};
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
test("overview changes follow recorded labs, medication frequency changes, stops and correction replay", async () => {
  const T = today();
  const at = (n: number) => addDays(T, n) + "T06:00:00Z";
  const id = await db.transaction((q) =>
    K.createPatient(q, doc, {
      name: "Synthetic overview",
      mrn: "OVERVIEW-" + Date.now(),
      sex: "Male",
      birthDate: "1960-01-01",
      conditions: ["hfref"],
    }),
  );
  await db.transaction((q) =>
    K.recordObservations(q, doc, id, {
      effectiveAt: at(-5),
      items: [
        { code: "nt-probnp", value: 2000 },
        { code: "inr", value: 2 },
      ],
    }),
  );
  await db.transaction((q) =>
    K.recordObservations(q, doc, id, {
      effectiveAt: at(-2),
      items: [
        { code: "nt-probnp", value: 1500 },
        { code: "inr", value: 2.5 },
      ],
    }),
  );
  const { medicationId: mid } = await db.transaction((q) =>
    K.startMedication(q, doc, id, {
      code: "valsartan",
      doseValue: 160,
      frequency: "OD",
      route: "PO",
      indication: "hf",
      effectiveAt: at(-10),
    }),
  );
  await db.transaction((q) =>
    K.medicationEvent(q, doc, id, mid, {
      kind: "continue",
      frequency: "BID",
      reason: "Frequency changed to BID",
      effectiveAt: at(-4),
    }),
  );
  let s: any = await db.transaction((q) => summary(q, id, "sandbox"));
  assert.equal(
    s.results.find((r: any) => r.code === "nt-probnp").trend.percent,
    -25,
  );
  assert.ok(s.results.some((r: any) => r.code === "inr"));
  assert.equal(s.medications.groups[0].meds[0].targetProgress.percent, 100);
  assert.equal(s.medications.history[0].kind, "frequency");
  assert.match(s.medications.history[0].before, /OD/);
  assert.match(s.medications.history[0].after, /BID/);
  assert.equal(
    s.hf.pillars.find((p: any) => p.key === "raas").percentOfTarget,
    100,
  );
  await db.transaction((q) =>
    K.medicationEvent(q, doc, id, mid, {
      kind: "stop",
      reason: "Stopped for testing",
      effectiveAt: at(-1),
    }),
  );
  s = await db.transaction((q) => summary(q, id, "sandbox"));
  assert.equal(s.medications.history[0].kind, "stop");
  assert.equal(s.medications.groups.length, 0);
  await db.transaction((q) =>
    undoLastMedicationChange(q, doc, id, mid, "Mistaken stop"),
  );
  s = await db.transaction((q) => summary(q, id, "sandbox"));
  assert.ok(!s.medications.history.some((e: any) => e.kind === "stop"));
  assert.equal(s.medications.groups[0].meds[0].targetProgress.percent, 100);
  assert.ok(s.hf.timeline.lanes[0].segments.some((g: any) => g.pct === 50));
  assert.equal(s.hf.timeline.lanes[0].segments.at(-1).pct, 100);
  await db.transaction((q) =>
    K.medicationEvent(q, doc, id, mid, {
      kind: "hold",
      reason: "Held for review",
      effectiveAt: at(-1),
    }),
  );
  await db.transaction((q) =>
    K.medicationEvent(q, doc, id, mid, {
      kind: "continue",
      frequency: "OD",
      reason: "Frequency changed to OD",
      effectiveAt: at(0),
    }),
  );
  s = await db.transaction((q) => summary(q, id, "sandbox"));
  assert.equal(s.medications.groups[0].meds[0].status, "held");
  assert.equal(s.hf.timeline.lanes[0].segments.at(-1).state, "held");
  assert.equal(s.hf.timeline.lanes[0].segments.at(-1).pct, 50);
});
