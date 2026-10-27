import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Consult, ProposalPlan } from "../src/screens/Consult.js";
import { carriedScreens } from "../shared/decision-assume.js";
import { withMedicationMonitoring } from "../shared/pathway-monitoring.js";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { summary } from "../server/kernel/views.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { today, nowIso, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import type { WizardContext } from "../shared/wizards.js";

const base = {
  header: { id: "fixture" },
  today: today(),
  attention: [],
  plan: [],
  targets: {},
  medications: { groups: [] },
};
const render = (s: any) =>
  renderToStaticMarkup(
    createElement(Consult, { s, open() {}, done() {}, slots: {} }),
  );
test("confirmation exposes every medication change, with an explicit routine count", () => {
  const plan = Array.from({ length: 8 }, (_, i) => ({
    kind: "medication",
    label: `Medicine ${i}: stop`,
  }));
  const html = renderToStaticMarkup(
    createElement(ProposalPlan, {
      plan: [
        ...plan,
        { kind: "plan", label: "Retinal screening", routine: true },
      ],
    }),
  );
  for (const p of plan) assert.ok(html.includes(p.label));
  assert.match(html, /1 routine actions included/);
  assert.ok(!/<details[^>]*open/.test(html));
});
test("red medication action leads its problem; overdue work cannot be reported as all on track", () => {
  const html = render({
    ...base,
    attention: [
      {
        id: "red",
        rule_id: "dm.safety",
        title: "Urgent medication problem",
        severity: "red",
        action: {
          type: "med-action",
          medicationId: "m",
          label: "Stop medicine",
        },
      },
      {
        id: "orange",
        rule_id: "dm.glycaemic-control",
        title: "Review diabetes",
        severity: "orange",
        action: { type: "wizard", wizard: "diabetes" },
      },
    ],
  });
  assert.match(html, /<article class="cx-dec sev-red"/);
  assert.ok(
    html.indexOf("Urgent medication problem") < html.indexOf("Review diabetes"),
  );
  const task = {
    id: "due",
    title: "Outstanding renal assessment",
    dueDate: addDays(today(), -2),
    status: "planned",
    clinicalContext: { problem: "kidney" },
  };
  const pending = render({ ...base, plan: [task] });
  assert.ok(!pending.includes("Every plan item is on track"));
  assert.ok(pending.includes(task.title));
  assert.match(pending, /1 tasks need completion or review/);
  assert.ok(!render(base).includes("on track"));
});
test("different stability meanings and newer concerns cannot become RDN reassurance", () => {
  const d = (wizard: string, value: string) => ({
    wizard,
    answers: { safety: value },
    at: nowIso(),
    day: today(),
  });
  assert.deepEqual(
    carriedScreens("after-rdn", [d("htn-review", "stable")], today()),
    {},
  );
  assert.deepEqual(
    carriedScreens(
      "rdn-plan",
      [d("htn-review", "pregnancy"), d("rdn-plan", "stable")],
      today(),
    ),
    {},
  );
  assert.equal(
    carriedScreens("rdn-plan", [d("rdn-plan", "stable")], today()).safety.value,
    "stable",
  );
});
test("monitoring arithmetic uses the actual creatinine, weight and age for DOAC renal intervals", () => {
  const ctx: WizardContext = {
    today: today(),
    meds: [],
    facts: [],
    detected: {},
    dx: [],
    profile: { age: 80, sex: "Female", cvd: true, riskFactors: true },
    values: {
      creatinine: { value: 150, at: today(), prev: null },
      weight: { value: 60, at: today(), prev: null },
    },
  };
  const out = withMedicationMonitoring(
    [
      {
        kind: "start",
        code: "apixaban",
        doseValue: 2.5,
        frequency: "BID",
        indication: "AF",
        label: "Apixaban",
      },
    ],
    ctx,
  );
  const plan = out.find((x) => x.kind === "plan");
  assert.ok(plan?.kind === "plan");
  // Cockcroft-Gault 25.05 mL/min, existing EHRA CrCl/10 months convention = 76 days.
  assert.equal(plan.dueDate, addDays(today(), 76));
});
let db: DB;
const actor: Actor = {
  id: "audit@cardioflow.local",
  name: "Synthetic audit",
  role: "clinician",
  siteId: SITE_ID,
};
const tx = <T>(fn: (q: any) => Promise<T>) => db.transaction(fn);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());
test("HF comparison is identical across views and brief keeps the resolved formal EF", async () => {
  const id = await tx((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic audit HF",
      mrn: "CONSULT-HF",
      birthDate: "1960-01-01",
      sex: "Male",
      synthetic: true,
      conditions: ["hfref"],
    }),
  );
  await tx(async (q) => {
    await K.recordObservations(q, actor, id, {
      effectiveAt: nowIso(),
      items: [
        { code: "creatinine", value: 90 },
        { code: "potassium", value: 4.3 },
        { code: "weight", value: 75 },
      ],
    });
    await K.recordObservations(q, actor, id, {
      effectiveAt: addDays(today(), -7) + "T09:00:00Z",
      quality: "formal",
      items: [{ code: "lvef", value: 35 }],
    });
    await K.recordObservations(q, actor, id, {
      effectiveAt: addDays(today(), -1) + "T09:00:00Z",
      quality: "limited",
      items: [{ code: "lvef", value: 55 }],
    });
    for (const [code, doseValue, frequency] of [
      ["ramipril", 5, "BID"],
      ["carvedilol", 25, "OD"],
    ] as const)
      await K.startMedication(q, actor, id, {
        code,
        doseValue,
        frequency,
        route: "PO",
        indication: "HF",
        effectiveAt: nowIso(),
        alreadyTaking: true,
      });
  });
  const ctx = (await tx(q => getWizard(q,id,"hf-medicines"))).context;
  assert.equal(ctx.hfMeds!.items.find(i=>i.key==="raas")!.state,"target");
  const bb = ctx.hfMeds!.items.find(i=>i.key==="bb")!;
  assert.equal(bb.med!.pct,50);
  assert.equal(bb.state,"needs");
  assert.equal(bb.change,null,"OD carvedilol requires regimen clarification before titrating");
  const preview = await tx(q=>previewDecision(q,id,"hf-medicines"));
  assert.ok(!preview.plan.some(x=>x.kind==="medication" && /Ramipril/.test(x.label)));
  await tx(q => reassess(q,id,"production"));
  const s = await tx((q) => summary(q, id));
  assert.equal(
    s.targets.hf!.pillars.find((p) => p.key === "raas")!.percentOfTarget,
    100,
  );
  assert.equal(
    s.targets.hf!.pillars.find((p) => p.key === "bb")!.percentOfTarget,
    50,
  );
  assert.ok(!s.attention.some((a:any)=>a.rule_id === "hf.titration" && /Ramipril/.test(a.title)));
  const html = render(s);
  assert.match(html, /EF 35% \(formal/);
  assert.ok(!html.includes("35% → 55%"));
  assert.match(html, /Latest limited: 55/);
  assert.match(html, /Used for decisions/);
});
test("diabetes confirmation saves finerenone monitoring, removes overlapping HF starts and avoids a missing-monitoring alert", async () => {
  const { id } = (
    await db.query<{ id: string }>(
      "SELECT id FROM cf.patient WHERE name='Khalid Al-Rashidi'",
    )
  ).rows[0];
  const p = await tx((q) => previewDecision(q, id, "diabetes", {}));
  assert.ok(p.ready);
  const check = p.plan.find(
    (x) => x.kind === "plan" && /Finerenone: Potassium/.test(x.label),
  );
  assert.ok(check);
  assert.match(check.label, /day 28/);
  await tx((q) =>
    completeWizard(q, actor, id, "diabetes", {
      answers: p.answers,
      evidenceKey: p.evidenceKey,
    }),
  );
  await tx((q) => reassess(q, id, "production"));
  const s = await tx((q) => summary(q, id));
  assert.ok(
    s.plan.some(
      (x) =>
        /Finerenone: Potassium/.test(x.title) &&
        x.dueDate === addDays(today(), 28),
    ),
  );
  assert.ok(
    !s.attention.some((a: any) => a.rule_id === "ops.monitoring-after-change"),
  );
  assert.ok(!s.attention.some((a: any) => /HFpEF:.*not started/.test(a.title)));
});
