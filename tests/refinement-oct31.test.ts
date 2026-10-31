import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveCurrent, addDays } from "../shared/clinical.js";
import { MEASURES } from "../shared/catalog.js";
import { results } from "../server/kernel/views.js";
import { abnormal } from "../server/kernel/story.js";
import { Consult } from "../src/screens/Consult.js";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { today, type Actor } from "../server/kernel/base.js";

const observation = (
  id: string,
  code: string,
  value: number,
  day: string,
  status = "final",
) => ({
  id,
  code,
  value_num: value,
  value_text: null,
  unit: MEASURES[code].unit,
  effective_at: day + "T06:00:00Z",
  status,
  quality: "standard",
  source: "Synthetic lab",
});
const state = (observations: any[], preferred: string | null = null): any => ({
  today: "2026-10-31",
  patient: { sex: "Female", age: 65 },
  tags: new Set(["hf"]),
  conditions: [],
  resolved: (code: string) =>
    resolveCurrent(
      observations.filter((o) => o.code === code),
      preferred,
    ),
});
const abnormalResults = (s: any) => abnormal(s, results(s), {});
test("abnormal percentage compares the selected value with its own earlier measurement", () => {
  const s = state(
    [
      observation("baseline", "creatinine", 100, "2026-10-01"),
      observation("selected", "creatinine", 180, "2026-10-15"),
      observation("latest", "creatinine", 90, "2026-10-20"),
    ],
    "selected",
  );
  const r = abnormalResults(s).items.find((x) => x.code === "creatinine")!;
  assert.equal(r.value, 180);
  assert.equal(r.previous.value, 100);
  assert.equal(r.percent, 80);
  // Existing latest-result API remains a separate, correctly labelled comparison.
  assert.equal(results(s, ["creatinine"])[0]!.trend.percent, -50);
});
test("selected first measurement does not borrow the newest result's percentage", () => {
  const s = state(
    [
      observation("selected", "potassium", 5.8, "2026-10-01"),
      observation("latest", "potassium", 4, "2026-10-20"),
    ],
    "selected",
  );
  const r = abnormalResults(s).items[0];
  assert.equal(r.previous, null);
  assert.equal(r.percent, null);
});
test("a lone preliminary result is not classified as a normal verified result", () => {
  const s = state([
    observation("pre", "potassium", 4.2, "2026-10-20", "preliminary"),
  ]);
  const r = abnormalResults(s);
  assert.equal(r.normal.length, 0);
  assert.equal(r.items.length, 0);
});
for (const ferritin of [null, 400, 200])
  test(`low TSAT with ferritin ${ferritin}: the display uses the same combined HF definition`, () => {
    const s = state([
      observation("tsat", "tsat", 10, "2026-10-20"),
      ...(ferritin == null
        ? []
        : [observation("ferritin", "ferritin", ferritin, "2026-10-20")]),
    ]);
    const r = abnormalResults(s).items.find((x) => x.code === "tsat")!;
    assert.ok(r);
    assert.equal(
      r.note?.includes("iron deficiency (ESC HF)"),
      ferritin === 200,
    );
  });
const render = (s: any) =>
  renderToStaticMarkup(
    createElement(Consult, {
      s: {
        header: { id: "synthetic" },
        today: "2026-10-31",
        attention: [],
        plan: [],
        targets: {},
        medications: { groups: [] },
        ...s,
      },
      open() {},
      done() {},
      slots: {},
    }),
  );
test("overview shows the percentage and comparison date for a non-timeline abnormal lab", () => {
  const s = state([
    observation("a", "alt", 40, "2026-10-01"),
    observation("b", "alt", 80, "2026-10-20"),
  ]);
  const html = render({ results: results(s), abnormal: abnormalResults(s) });
  assert.match(html, /\+100(?:\.0)?%/);
  assert.match(html, /01 Oct 2026/);
});
test("an unseen latest preliminary abnormal result is disclosed beside the verified current value", () => {
  const s = state([
    observation("a", "potassium", 4.2, "2026-10-01"),
    observation("b", "potassium", 6.8, "2026-10-20", "preliminary"),
  ]);
  const html = render({ results: results(s), abnormal: abnormalResults(s) });
  assert.match(html, /6\.8/);
  assert.match(html, /[Aa]waiting verification|[Pp]reliminary/);
});
test("sparse overview hides empty standing headings and unrecorded vital placeholders", () => {
  assert.doesNotMatch(render({}), /Where things stand/);
  const s = state([observation("a", "alt", 80, "2026-10-20")]);
  const html = render({ results: results(s), abnormal: abnormalResults(s) });
  assert.match(html, /Latest results/);
  assert.doesNotMatch(html, /cx-vitals/);
});
test("an isolated diastolic BP remains visible without fabricating a systolic reading", () => {
  const html = render({
    vitals: [{ code: "dbp", value: 95, at: "2026-10-20" }],
  });
  assert.match(html, /95<\/b> DBP/);
  assert.doesNotMatch(html, /SBP/);
});
let db: DB;
const actor: Actor = {
  id: "audit31@example.test",
  name: "Synthetic audit",
  role: "clinician",
  siteId: SITE_ID,
};
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
test("new EF data immediately changes the HF iron decision, without waiting for full reassessment", async () => {
  const id = await db.transaction((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic EF iron handoff",
      mrn: "AUD31-EF",
      sex: "Female",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions: ["hfpef"],
    }),
  );
  await db.transaction(async (q) => {
    await K.recordObservations(q, actor, id, {
      effectiveAt: addDays(today(), -1) + "T06:00:00Z",
      items: [
        { code: "haemoglobin", value: 14 },
        { code: "ferritin", value: 50 },
        { code: "tsat", value: 15 },
        { code: "lvef", value: 55 },
      ],
    });
    await reassess(q, id, "production");
  });
  const current = async () =>
    (
      await db.query<any>(
        "SELECT title,action FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.iron-deficiency' AND status='active'",
        [id],
      )
    ).rows;
  assert.equal((await current())[0].action.type, "add-labs");
  await db.transaction(async (q) => {
    const r = await K.recordObservations(q, actor, id, {
      effectiveAt: today() + "T06:00:00Z",
      items: [{ code: "lvef", value: 40 }],
    });
    await reassess(q, id, "production", r.changed);
  });
  assert.equal((await current())[0].action.wizard, "iv-iron");
  const incremental = await current();
  await db.transaction((q) => reassess(q, id, "production"));
  assert.deepEqual(await current(), incremental);
  await db.transaction(async (q) => {
    const r = await K.recordObservations(q, actor, id, {
      effectiveAt: today() + "T07:00:00Z",
      items: [{ code: "lvef", value: 55 }],
    });
    await reassess(q, id, "production", r.changed);
  });
  assert.equal((await current())[0].action.type, "add-labs");
});
test("EF-only entry moves secondary MR out of the generic Heart Team route when HF optimization owns it", async () => {
  const id = await db.transaction(async (q) => {
    const id = await K.createPatient(q, actor, {
      name: "Synthetic secondary MR handoff",
      mrn: "AUD31-MR",
      sex: "Female",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions: ["hfpef"],
    });
    await K.addCondition(q, actor, id, {
      code: "mr-secondary",
      attributes: { severity: "Severe" },
    });
    await K.recordObservations(q, actor, id, {
      effectiveAt: addDays(today(), -1) + "T06:00:00Z",
      items: [{ code: "lvef", value: 55 }],
    });
    await reassess(q, id, "production");
    return id;
  });
  const current = async () =>
    (
      await db.query(
        "SELECT id FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='valve.severe-heart-team'",
        [id],
      )
    ).rows;
  assert.equal((await current()).length, 1);
  await db.transaction(async (q) => {
    const r = await K.recordObservations(q, actor, id, {
      effectiveAt: today() + "T06:00:00Z",
      items: [{ code: "lvef", value: 40 }],
    });
    await reassess(q, id, "production", r.changed);
  });
  assert.equal((await current()).length, 0);
  await db.transaction(async (q) => {
    const r = await K.recordObservations(q, actor, id, {
      effectiveAt: today() + "T07:00:00Z",
      items: [{ code: "lvef", value: 55 }],
    });
    await reassess(q, id, "production", r.changed);
  });
  assert.equal((await current()).length, 1);
});
