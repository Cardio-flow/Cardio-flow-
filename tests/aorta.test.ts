import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { voidStudy } from "../server/kernel/corrections.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { AORTA_RULES } from "../server/engine/aorta-rules.js";
import { aortaProfile } from "../server/engine/aorta-profile.js";
import { aorticTeamClearsTavi } from "../shared/aorta.js";
import { addDays } from "../shared/clinical.js";
import { bicuspidReport, bicuspidMissing } from "../shared/bicuspid.js";
let db: DB,
  n = 0;
const actor: Actor = {
    id: "aorta@test.local",
    name: "Synthetic aorta",
    role: "clinician",
    siteId: SITE_ID,
  },
  T = today();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = (
  conditions: string[] = [],
  birthDate = "1960-01-01",
  withEcho = true,
) =>
  tx(async (q) => {
    const id = await K.createPatient(q, actor, {
      name: "Synthetic aortic scenario",
      mrn: "AORTA-" + ++n,
      sex: "Male",
      birthDate,
      conditions,
    });
    if (withEcho)
      await K.recordEcho(q, actor, id, {
        date: nowIso(),
        quality: "formal",
        lvef: 55,
        findings: [],
        valves: { as: "None", ar: "None" },
      });
    return id;
  });
const findings = (extra: Record<string, unknown> = {}) => ({
  purpose: "Baseline assessment",
  modality: "CT",
  aorticMorphology: "Tricuspid",
  extent: "Entire thoracic aorta",
  sinusDiameter: 40,
  stjDiameter: 35,
  ascendingDiameter: 43,
  aorticPhenotype: "Ascending phenotype",
  coarctation: "Excluded",
  interpretation: "Thoracic aortic dilatation",
  ...extra,
});
const report = (
  id: string,
  extra: Record<string, unknown> = {},
  date = nowIso(),
) =>
  tx((q) =>
    K.recordStudy(q, actor, id, {
      kind: "aortic_imaging",
      date,
      findings: findings(extra),
    }),
  );
const answers = (extra: Record<string, unknown> = {}) => ({
  safety: "stable",
  risks: ["none"],
  strategy: "surveillance",
  imaging: "ct",
  family: "not-needed",
  bpCare: "reviewed",
  reviewDate: addDays(T, 180),
  ...extra,
});
const evaluate = async (id: string) =>
  AORTA_RULES[0].evaluate(await loadState(db, id), {});
test("new measured aortic report triggers a published decision without assigning a diagnosis or prescription", async () => {
  const id = await patient();
  await report(id);
  await tx((q) => reassess(q, id, "production"));
  assert(
    (
      await db.query(
        "SELECT rule_id FROM cf.recommendation WHERE patient_id=$1 AND status='active'",
        [id],
      )
    ).rows.some((r) => r.rule_id === "aorta.assessment"),
  );
  const s = await loadState(db, id);
  assert.equal(s.conditions.length, 0);
  assert.equal(s.meds.length, 0);
  assert.equal(s.plan.length, 0);
  const p = await tx((q) => previewDecision(q, id, "aorta-plan"));
  assert(!p.answers.safety);
  assert(p.needed.some((q) => q.id === "safety"));
});
test("normal unrelated patient and child do not enter this adult thoracic pathway", async () => {
  assert.equal((await evaluate(await patient())).length, 0);
  const id = await patient(["bav"], `${Number(T.slice(0, 4)) - 12}-01-01`);
  assert.equal((await evaluate(id)).length, 0);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "aorta-plan", { answers: answers() }),
    ),
    /paediatric/,
  );
});
test("recorded BAV triggers imaging/family review and flows into structural assessment", async () => {
  const id = await patient(["bav"]);
  const c = (await tx((q) => getWizard(q, id, "aorta-plan"))).context;
  assert(c.aorta?.bicuspid);
  assert(c.valve?.bicuspid);
  const p = await tx((q) =>
    previewDecision(q, id, "aorta-plan", { safety: "stable", risks: ["none"] }),
  );
  assert.equal(p.answers.strategy, "workup");
  assert.equal(p.answers.family, "screen");
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "aorta-plan", {
        answers: answers({ strategy: "workup", family: "not-needed" }),
      }),
    ),
    /family screening/,
  );
});
test("missing anatomy cannot be presented as cleared routine surveillance", async () => {
  const id = await patient(["thoracic-aortic-dilatation"]);
  await report(id, { extent: "Incomplete", stjDiameter: undefined });
  const p = await tx((q) => previewDecision(q, id, "aorta-plan", answers()));
  assert.equal(p.ready, false);
  assert(p.blockers.some((b) => /missing/.test(b)));
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "aorta-plan", {
        answers: answers({ strategy: "workup", imaging: "tte" }),
      }),
    ),
    /CT \/ CMR/,
  );
});
test("sporadic 55 mm and BAV root-phenotype 50 mm require aortic-team strategy", async () => {
  for (const [diameter, bav] of [
    [55, false],
    [50, true],
  ] as const) {
    const id = await patient(bav ? ["bav"] : []);
    await report(id, {
      sinusDiameter: diameter,
      ascendingDiameter: 45,
      aorticMorphology: bav ? "Bicuspid" : "Tricuspid",
      aorticPhenotype: bav ? "Root phenotype" : "Ascending phenotype",
    });
    assert(
      (await aortaProfile(await loadState(db, id))).referral.some((r) =>
        /threshold/.test(r),
      ),
    );
    const a = answers({ family: bav ? "screen" : "not-needed" });
    await assert.rejects(
      tx((q) => completeWizard(q, actor, id, "aorta-plan", { answers: a })),
      /aortic-team strategy/,
    );
    const p = await tx((q) =>
      previewDecision(q, id, "aorta-plan", {
        safety: "stable",
        risks: ["none"],
      }),
    );
    assert.equal(p.answers.strategy, "specialist");
  }
});
test("heritable disease never receives generic size-based clearance", async () => {
  const id = await patient(["heritable-aortopathy"]);
  await report(id, { sinusDiameter: 36, ascendingDiameter: 35 });
  const p = await tx((q) =>
    previewDecision(q, id, "aorta-plan", { safety: "stable", risks: ["none"] }),
  );
  assert.equal(p.answers.strategy, "specialist");
  assert.equal(p.answers.family, "genetics");
});
test("arch/descending size, coarctation, prior repair and chronic dissection reach specialist review", async () => {
  for (const extra of [
    { archDiameter: 55 },
    { descendingDiameter: 55 },
    { coarctation: "Present" },
    { purpose: "After aortic repair" },
    { interpretation: "Chronic dissection / residual aortic disease" },
  ]) {
    const id = await patient();
    await report(id, extra);
    assert(aortaProfile(await loadState(db, id)).referral.length > 0);
  }
});
test("only explicitly comparable reported growth informs rapid-growth review", async () => {
  const id = await patient();
  await report(id, {
    comparison: "Not comparable / unavailable",
    aorticGrowth: 5,
  });
  assert(
    !aortaProfile(await loadState(db, id)).referral.some((r) =>
      /growth/.test(r),
    ),
  );
  await report(id, {
    comparison: "Comparable same-segment measurements reviewed",
    aorticGrowth: 3,
  });
  assert(
    aortaProfile(await loadState(db, id)).referral.some((r) =>
      /growth/.test(r),
    ),
  );
});
test("acute reported concern cannot be overridden or postponed; urgent pathway needs no irrelevant family questions", async () => {
  const id = await patient();
  await report(id, { interpretation: "Suspected acute aortic syndrome" });
  assert.equal((await evaluate(id))[0].severity, "red");
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "aorta-plan", { answers: answers() }),
    ),
    /urgent same-day/,
  );
  const a = { safety: "acute", strategy: "urgent", reviewDate: T };
  const p = await tx((q) => previewDecision(q, id, "aorta-plan", a));
  assert.equal(p.ready, true);
  assert(!p.needed.length);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "aorta-plan", {
        answers: a,
        dueDates: {
          "Thoracic aorta: urgent same-day specialist assessment": addDays(
            T,
            1,
          ),
        },
      }),
    ),
    /dated today/,
  );
  await tx((q) => completeWizard(q, actor, id, "aorta-plan", { answers: a }));
  assert((await loadState(db, id)).plan.some((p) => p.due_date === T));
});
test("new acute symptoms and explicit risk modifiers cannot enter routine surveillance", async () => {
  const id = await patient();
  await report(id);
  for (const a of [
    answers({ safety: "acute" }),
    answers({ risks: ["pregnancy"] }),
    answers({ risks: ["none", "family"] }),
  ]) {
    const p = await tx((q) => previewDecision(q, id, "aorta-plan", a));
    assert.equal(p.ready, false);
  }
});
test("review stays quiet, a new scan reopens it, and a stale preview cannot be applied", async () => {
  const id = await patient();
  await report(id);
  let p = await tx((q) => previewDecision(q, id, "aorta-plan", answers()));
  await tx((q) =>
    completeWizard(q, actor, id, "aorta-plan", {
      answers: p.answers,
      evidenceKey: p.evidenceKey,
    }),
  );
  assert.equal((await evaluate(id)).length, 0);
  await report(id, { ascendingDiameter: 56 });
  assert.equal((await evaluate(id)).length, 1);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "aorta-plan", {
        answers: p.answers,
        evidenceKey: p.evidenceKey,
      }),
    ),
    /record changed/,
  );
});
test("matching modality result closes only the due imaging task, awaiting clinical review; correction reopens it", async () => {
  const id = await patient();
  await report(id);
  await tx((q) =>
    completeWizard(q, actor, id, "aorta-plan", {
      answers: answers({ reviewDate: T }),
    }),
  );
  await report(id, { modality: "TTE", purpose: "Surveillance" });
  let s = await loadState(db, id);
  let task = s.plan.find((p) => /CT surveillance/.test(p.title))!;
  assert.equal(task.status, "planned");
  const r = await report(id, { modality: "CT", purpose: "Surveillance" });
  s = await loadState(db, id);
  task = s.plan.find((p) => p.id === task.id)!;
  assert.equal(task.status, "completed");
  assert.equal(task.reviewed_at, null);
  assert.equal(task.completes_on.requiresReview, true);
  await tx((q) => voidStudy(q, actor, id, r.id, "Synthetic incorrect scan"));
  s = await loadState(db, id);
  assert.equal(s.plan.find((p) => p.id === task.id)!.status, "planned");
});
test("future matching appointments are reused but a different modality remains a distinct task", async () => {
  const id = await patient();
  await report(id);
  await tx((q) =>
    completeWizard(q, actor, id, "aorta-plan", { answers: answers() }),
  );
  const count = (await loadState(db, id)).plan.length;
  const p = await tx((q) => previewDecision(q, id, "aorta-plan", answers()));
  assert(p.plan.some((p) => /Already planned/.test(p.label)));
  await tx((q) =>
    completeWizard(q, actor, id, "aorta-plan", { answers: p.answers }),
  );
  assert.equal((await loadState(db, id)).plan.length, count);
  const other = await tx((q) =>
    previewDecision(q, id, "aorta-plan", answers({ imaging: "cmr" })),
  );
  assert(other.plan.some((p) => /CMR surveillance/.test(p.label)));
});
test("newer measured aortic evidence cannot be bypassed by an older bicuspid TAVI report", () => {
  const c: any = {
    today: T,
    meds: [],
    facts: [],
    detected: {},
    valve: { bicuspid: true },
    structural: {
      planning: [
        {
          id: "old",
          day: addDays(T, -2),
          findings: {
            intervention: "TAVI",
            aorticMorphology: "Bicuspid",
            sinusDiameter: 42,
            stjDiameter: 35,
            ascendingDiameter: 44,
            aorticPhenotype: "Root phenotype",
            aorticStrategy: "No aortic surgery indication after review",
          },
        },
      ],
    },
    aorta: {
      report: {
        id: "new",
        at: T,
        attributes: findings({
          aorticMorphology: "Bicuspid",
          sinusDiameter: 52,
          aorticPhenotype: "Root phenotype",
        }),
      },
    },
  };
  assert.equal(bicuspidReport(c)?.sinusDiameter, 52);
  assert(bicuspidMissing(c).some((s) => /surgery indication/.test(s)));
});

test("a BAV report with missing phenotype cannot clear routine surveillance", async () => {
  const id = await patient(["bav"]);
  await report(id, {
    aorticMorphology: "Bicuspid",
    aorticPhenotype: "Not assessed",
    sinusDiameter: 51,
  });
  const p = await tx((q) =>
    previewDecision(q, id, "aorta-plan", answers({ family: "screen" })),
  );
  assert.equal(p.ready, false);
  assert(p.blockers.some((b) => /missing/.test(b)));
});
test("an imaging-reported thoracic aneurysm prompts family review without silently creating a condition", async () => {
  const id = await patient();
  await report(id, {
    interpretation: "Thoracic aortic aneurysm",
    ascendingDiameter: 47,
  });
  const p = await tx((q) =>
    previewDecision(q, id, "aorta-plan", { safety: "stable", risks: ["none"] }),
  );
  assert.equal(p.answers.family, "screen");
  assert.equal((await loadState(db, id)).conditions.length, 0);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "aorta-plan", { answers: answers() }),
    ),
    /family screening/,
  );
});

test("a baseline or acute CT cannot close surveillance, and a much earlier booking is not reused", async () => {
  const id = await patient();
  await report(id);
  await tx((q) =>
    completeWizard(q, actor, id, "aorta-plan", {
      answers: answers({ reviewDate: T }),
    }),
  );
  await report(id, { purpose: "Baseline assessment" });
  let s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => /CT surveillance/.test(p.title))!.status,
    "planned",
  );
  const p = await tx((q) => previewDecision(q, id, "aorta-plan", answers()));
  assert(
    p.plan.some((p) => p.kind === "plan" && /CT surveillance/.test(p.label)),
  );
});

test("a CT without recorded valve function cannot clear routine surveillance and proposes TTE", async () => {
  const id = await patient([], "1960-01-01", false);
  await report(id);
  const p = await tx((q) => previewDecision(q, id, "aorta-plan", answers()));
  assert.equal(p.ready, false);
  const work = await tx((q) =>
    previewDecision(q, id, "aorta-plan", answers({ strategy: "workup" })),
  );
  assert(work.plan.some((p) => /TTE valve-function/.test(p.label)));
});

test("aortic TAVI review has a documented specialist route; no unexplained or unqualified surgical-risk bypass", () => {
  const p: any = {
    urgent: [],
    referral: ["Specialist assessment required"],
    report: { attributes: { sinusDiameter: 56 }, conclusion: "" },
  };
  assert.equal(aorticTeamClearsTavi(p, "ineligible"), false);
  p.report.conclusion =
    "Synthetic aortic-team rationale: surgery judged prohibitive";
  p.report.attributes.aorticStrategy =
    "Aortic surgery deferred for prohibitive risk; rationale documented";
  assert.equal(aorticTeamClearsTavi(p, "high"), false);
  assert.equal(aorticTeamClearsTavi(p, "ineligible"), true);
  p.report.attributes.aorticStrategy =
    "No aortic surgery indication after review";
  assert.equal(aorticTeamClearsTavi(p, "high"), false);
  p.report.attributes.sinusDiameter = 45;
  assert.equal(aorticTeamClearsTavi(p, "high"), true);
  p.urgent = ["Suspected acute syndrome"];
  assert.equal(aorticTeamClearsTavi(p, "ineligible"), false);
});

test("family risk already recorded in TAVI imaging is not lost when a new aortic scan omits history", async () => {
  const id = await patient();
  const p: any = await loadState(db, id);
  p.studies.push({
    id: "old-bav",
    kind: "structural_imaging",
    performed_at: addDays(T, -5),
    attributes: {
      intervention: "TAVI",
      aorticMorphology: "Bicuspid",
      aorticRisks: ["Family history of acute aortic syndrome"],
    },
    findings: [],
    conclusion: "",
    quality: "formal",
  });
  p.studies.push({
    id: "new-aorta",
    kind: "aortic_imaging",
    performed_at: T,
    attributes: findings({ aorticMorphology: "Not assessed" }),
    findings: [],
    conclusion: "",
    quality: "formal",
  });
  const a = aortaProfile(p);
  assert(a.bicuspid);
  assert(a.familyRecommended);
  assert(a.referral.some((r) => /family history/.test(r)));
});

test("isolated reported distal aneurysm with measured non-dilated proximal aorta does not force proximal-disease family screening", async () => {
  const id = await patient(["thoracic-aortic-aneurysm"]);
  await report(id, {
    sinusDiameter: 34,
    ascendingDiameter: 35,
    descendingDiameter: 56,
    interpretation: "Thoracic aortic aneurysm",
  });
  const p = await tx((q) =>
    previewDecision(q, id, "aorta-plan", answers({ strategy: "specialist" })),
  );
  assert.equal(aortaProfile(await loadState(db, id)).familyRecommended, false);
  assert.equal(p.ready, true);
});
