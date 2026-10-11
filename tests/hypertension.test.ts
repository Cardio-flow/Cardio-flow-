import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState, type PatientState } from "../server/kernel/state.js";
import { today, nowIso, type Actor } from "../server/kernel/base.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { HYPERTENSION_RULES } from "../server/engine/hypertension-rules.js";
import { ACUTE_RULES } from "../server/engine/acute-rules.js";
import { hypertensionProfile } from "../server/engine/hypertension-profile.js";
import { buildOutcome } from "../shared/wizards.js";
import { addDays } from "../shared/clinical.js";
import { voidStudy } from "../server/kernel/corrections.js";
import { reassess } from "../server/engine/engine.js";
let db: DB;
let seq = 0;
const a: Actor = {
  id: "hypertension@example.test",
  name: "Synthetic hypertension clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const T = today(),
  past = (days = 1) =>
    new Date(`${addDays(T, -days)}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());

test("resistance remains verified while secondary and anatomy results arrive; RDN progresses without repeating the regimen review", async () => {
  const id = await prepared(false);
  const initial = hypertensionProfile(await loadState(db, id));
  await study(id, anatomy);
  let s = await loadState(db, id);
  assert.equal(
    hypertensionProfile(s).resistance?._resistanceKey,
    initial.resistanceKey,
  );
  assert.equal(hypertensionProfile(s).rdnEligible, true);
  assert.equal(rules(s, "htn.resistance").length, 0);
  assert.equal(rules(s, "htn.management").length, 0);
  assert.equal(rules(s, "htn.rdn").length, 1);
  await study(id, { ...secondary, secondaryResult: "Work-up incomplete" });
  s = await loadState(db, id);
  assert(hypertensionProfile(s).resistance);
  assert.equal(hypertensionProfile(s).rdnEligible, false);
  assert.match(rules(s, "htn.rdn")[0].title, /complete RDN eligibility/);
  await assert.rejects(
    () => complete(id, "rdn-plan", rdn),
    /cannot be scheduled/,
  );
  await study(id, {
    ...secondary,
    secondaryResult: "Secondary cause identified",
    cause: "Obstructive sleep apnoea",
  });
  assert.equal(rules(await loadState(db, id), "htn.rdn").length, 0);
});

test("legacy resistance evidence survives new work-up results but never new BP or treatment", async () => {
  const id = await prepared(false),
    s = await loadState(db, id);
  const legacy = { ...s.procedureReviews!["htn-resistance"]!.answers };
  delete legacy._resistanceKey;
  await study(id, anatomy);
  const later = await loadState(db, id);
  const withLegacy = {
    ...later,
    procedureReviews: {
      ...later.procedureReviews,
      "htn-resistance": {
        ...later.procedureReviews!["htn-resistance"]!,
        answers: legacy,
      },
    },
  };
  assert(hypertensionProfile(withLegacy).resistance);
  await obs(id, 160, 95);
  const changed = await loadState(db, id);
  assert.equal(
    hypertensionProfile({
      ...changed,
      procedureReviews: withLegacy.procedureReviews,
    }).resistance,
    null,
  );
});

test("continuing treatment creates no optimization task and existing equivalent future reviews/tests are reused", async () => {
  const id = await prepared(false);
  const c = (await tx((q) => getWizard(q, id, "htn-resistance"))).context;
  const result = buildOutcome(
    "htn-resistance",
    { ...resistance, decision: "continue" },
    c,
  );
  assert(
    !result.some((i) => i.kind === "plan" && /optimization/.test(i.title)),
  );
  assert(
    result.some((i) => i.kind === "note" && /Already planned/.test(i.label)),
  );
  assert(
    !result.some((i) => i.kind === "plan" && i.completesOn?.type === "lab"),
  );
  const moved = buildOutcome(
    "htn-resistance",
    { ...resistance, decision: "continue" },
    c,
    { "Hypertension: renal function and electrolytes": T },
  );
  assert(moved.some((i) => i.kind === "plan" && i.dueDate === T));
});

test("manual pathway dates reject incomplete and impossible dates instead of keeping a previous suggestion", async () => {
  const id = await prepared(false);
  for (const value of ["", "2026-02-31", "31/02/2026"])
    await assert.rejects(
      () =>
        tx((q) =>
          completeWizard(q, a, id, "htn-resistance", {
            answers: { ...resistance, reviewDate: addDays(T, 1) },
            dueDates: {
              "Hypertension: renal function and electrolytes": value,
            },
          }),
        ),
      /choose today or a later date/,
    );
});
const patient = (birthDate = "1960-01-01") =>
  tx((q) =>
    K.createPatient(q, a, {
      name: "Synthetic hypertension",
      mrn: "HTN-" + ++seq,
      sex: "Male",
      birthDate,
      conditions: ["htn"],
    }),
  );
const obs = (id: string, sbp = 155, dbp = 95) =>
  tx((q) =>
    K.recordObservations(q, a, id, {
      effectiveAt: nowIso(),
      items: [
        { code: "sbp", value: sbp },
        { code: "dbp", value: dbp },
        { code: "creatinine", value: 90 },
        { code: "potassium", value: 4.2 },
        { code: "sodium", value: 140 },
      ],
    }),
  );
const abpm = (id: string, changes: any = {}) =>
  tx((q) =>
    K.recordStudy(q, a, id, {
      kind: "abpm",
      date: past(),
      findings: {
        duration: "24 h",
        onTreatment: "On treatment",
        sbp24: 145,
        dbp24: 90,
        valid: 80,
        conclusion: "Uncontrolled on treatment",
        ...changes,
      },
    }),
  );
const study = (id: string, findings: any) =>
  tx((q) =>
    K.recordStudy(q, a, id, {
      kind: "hypertension_workup",
      date: past(),
      findings,
    }),
  );
const pa = {
  purpose: "Primary aldosteronism screen",
  aldosterone: 5,
  aldosteroneUnit: "ng/dL",
  assay: "Immunoassay",
  renin: 2,
  reninUnit: "PRA ng/mL/h",
  samplePotassium: 4.2,
  interpretation: "Interpretable after assay, potassium and medication review",
  screenResult: "Negative",
};
const secondary = {
  purpose: "Secondary hypertension review",
  tests: [
    "Primary aldosteronism",
    "Renal parenchymal disease",
    "Renovascular disease / FMD",
    "Obstructive sleep apnoea",
    "Drugs / substances",
  ],
  secondaryResult: "No secondary cause identified",
};
const anatomy = {
  purpose: "RDN anatomical assessment",
  modality: "CT angiography",
  device: "Symplicity Spyral — current regional IFU",
  anatomy: "Suitable under the selected device IFU",
  contraindications: "Excluded by specialist",
  reviewed: "Yes",
};
const resistance = {
  basis: "resistant",
  technique: "yes",
  adherence: "yes",
  doses: "yes",
  lifestyle: "yes",
  decision: "specialist",
  when: T,
  reviewDate: addDays(T, 7),
};
const rdn = {
  safety: "stable",
  team: "yes",
  consent: "yes",
  centre: "yes",
  protocol: "yes",
  decision: "schedule",
  when: T,
};
const complete = (id: string, wizard: string, answers: any) =>
  tx((q) => completeWizard(q, a, id, wizard, { answers }));
const rules = (s: PatientState, id: string) =>
  HYPERTENSION_RULES.find((r) => r.id === id)!.evaluate(s, {});
async function prepared(anatomical = true) {
  const id = await patient();
  for (const [code, doseValue] of [
    ["amlodipine-valsartan", 10],
    ["indapamide", 1.5],
  ] as const)
    await tx((q) =>
      K.startMedication(q, a, id, {
        code,
        doseValue,
        frequency: "OD",
        route: "PO",
        indication: "Hypertension",
        effectiveAt: past(5),
        reason: "Synthetic current regimen",
      }),
    );
  await obs(id);
  await abpm(id);
  await study(id, pa);
  await study(id, secondary);
  if (anatomical) await study(id, anatomy);
  await complete(id, "htn-resistance", resistance);
  return id;
}

test("paired office BP, valid ABPM and combination components distinguish white-coat, masked and true resistance", async () => {
  const id = await prepared();
  let s = await loadState(db, id);
  let h = hypertensionProfile(s);
  assert.equal(h.triple, true);
  assert.equal(h.rdnEligible, true);
  assert.equal(rules(s, "htn.rdn").length, 1);
  await abpm(id, {
    sbp24: 120,
    dbp24: 70,
    conclusion: "White-coat hypertension",
  });
  s = await loadState(db, id);
  assert.equal(hypertensionProfile(s).phenotype, "White-coat phenotype");
  assert.equal(rules(s, "htn.resistance").length, 0);
  assert.equal(rules(s, "htn.rdn").length, 0);
  const whitecoat = buildOutcome(
    "htn-review",
    {
      safety: "stable",
      confirmation: "whitecoat",
      when: T,
      reviewDate: T,
      actions: [],
    },
    (await getWizard(db, id, "htn-review")).context,
  );
  assert.equal(
    whitecoat.some((item) => item.kind === "condition"),
    false,
  );
  await obs(id, 125, 75);
  await abpm(id, { sbp24: 135, dbp24: 85 });
  s = await loadState(db, id);
  assert.equal(hypertensionProfile(s).phenotype, "Masked hypertension");
  assert.match(rules(s, "htn.management")[0].title, /masked/);
  const masked = buildOutcome(
    "htn-review",
    {
      safety: "stable",
      confirmation: "masked",
      when: T,
      reviewDate: T,
      actions: [],
    },
    (await getWizard(db, id, "htn-review")).context,
  );
  assert(
    masked.some((item) => item.kind === "condition" && item.code === "htn"),
  );
});
test("RDN blocks missing confirmations, invalid ABPM, low eGFR, secondary disease and unreliable aldosteronism samples", async () => {
  const id = await prepared();
  let s = await loadState(db, id);
  for (const [field, value] of [
    ["adherence", "no"],
    ["doses", "unknown"],
    ["technique", "no"],
    ["lifestyle", "no"],
  ]) {
    await complete(id, "htn-resistance", { ...resistance, [field]: value });
    assert.equal(rules(await loadState(db, id), "htn.rdn").length, 0);
  }
  await complete(id, "htn-resistance", resistance);
  s = await loadState(db, id);
  const egfr = s.resolved("egfr").current!;
  const boundary = (value: number) =>
    ({
      ...s,
      resolved: (code: string) =>
        code === "egfr"
          ? { ...s.resolved(code), current: { ...egfr, value_num: value } }
          : s.resolved(code),
    }) as PatientState;
  assert.equal(hypertensionProfile(boundary(39.9)).rdnEligible, false);
  assert.equal(hypertensionProfile(boundary(40)).rdnEligible, true);
  await abpm(id, { valid: 69 });
  await complete(id, "htn-resistance", resistance);
  assert.equal(rules(await loadState(db, id), "htn.rdn").length, 0);
  await abpm(id);
  await study(id, {
    ...secondary,
    secondaryResult: "Secondary cause identified",
    cause: "Obstructive sleep apnoea",
  });
  await complete(id, "htn-resistance", resistance);
  assert.equal(rules(await loadState(db, id), "htn.rdn").length, 0);
  await study(id, secondary);
  await study(id, { ...pa, samplePotassium: 3, screenResult: "Negative" });
  await complete(id, "htn-resistance", resistance);
  assert.equal(rules(await loadState(db, id), "htn.rdn").length, 0);
});
test("current treatment changes invalidate older resistance approval and BP on a previous regimen", async () => {
  const id = await prepared();
  const s = await loadState(db, id);
  await tx((q) =>
    K.medicationEvent(
      q,
      a,
      id,
      s.meds.find((m) => m.code === "indapamide")!.id,
      {
        kind: "not_taking",
        reason: "Patient reports not taking",
        effectiveAt: nowIso(),
      },
    ),
  );
  const h = hypertensionProfile(await loadState(db, id));
  assert.equal(h.triple, false);
  assert.equal(h.resistance, null);
  assert.equal(h.outside?.valid, false);
  assert.equal(h.rdnEligible, false);
});
test("RDN evidence expires, admission resolves an existing offer, and stopped MRA invalidates an earlier BP study", async () => {
  const id = await prepared();
  const current = await loadState(db, id);
  const aged = hypertensionProfile({ ...current, today: addDays(T, 91) });
  assert.equal(aged.rdnEligible, false);
  assert.equal(aged.resistance, null);
  await tx((q) => reassess(q, id, "sandbox"));
  const activeRdn = async () =>
    (
      await db.query(
        "SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='htn.rdn' AND status='active'",
        [id],
      )
    ).rows;
  assert.equal((await activeRdn()).length, 1);
  const admitted = await tx((q) =>
    K.startAdmission(q, a, id, {
      startedAt: nowIso(),
      location: "Synthetic ward",
      reasons: ["Other"],
    }),
  );
  await tx((q) => reassess(q, id, "sandbox", admitted.changed));
  assert.equal((await activeRdn()).length, 0);
  assert.equal(hypertensionProfile(await loadState(db, id)).rdnEligible, false);

  const second = await prepared();
  const med = await tx((q) =>
    K.startMedication(q, a, second, {
      code: "eplerenone",
      doseValue: 25,
      frequency: "OD",
      route: "PO",
      indication: "Heart failure",
      effectiveAt: past(3),
      reason: "Synthetic prior treatment",
    }),
  );
  await complete(second, "htn-resistance", resistance);
  assert.equal(
    hypertensionProfile(await loadState(db, second)).outside?.valid,
    true,
  );
  await tx((q) =>
    K.medicationEvent(q, a, second, med.medicationId, {
      kind: "stop",
      effectiveAt: nowIso(),
      reason: "Synthetic stop",
    }),
  );
  assert.equal(
    hypertensionProfile(await loadState(db, second)).outside?.valid,
    false,
  );
});
test("fewer-drug RDN alternative needs increased CVD risk and documented intolerance; cannot be inferred from pill count", async () => {
  const id = await patient();
  await tx((q) =>
    K.startMedication(q, a, id, {
      code: "amlodipine-valsartan",
      doseValue: 10,
      frequency: "OD",
      route: "PO",
      indication: "Hypertension",
      effectiveAt: past(5),
      reason: "Synthetic",
    }),
  );
  await obs(id);
  await abpm(id);
  await study(id, pa);
  await study(id, secondary);
  const alt = {
    ...resistance,
    basis: "alternative",
    risk: "yes",
    intolerance: "yes",
  };
  await complete(id, "htn-resistance", alt);
  assert.equal(hypertensionProfile(await loadState(db, id)).rdnEligible, false);
  await tx((q) => K.addCondition(q, a, id, { code: "cad-ccs" }));
  await complete(id, "htn-resistance", alt);
  assert.equal(hypertensionProfile(await loadState(db, id)).rdnEligible, true);
  await complete(id, "htn-resistance", { ...alt, intolerance: "no" });
  assert.equal(hypertensionProfile(await loadState(db, id)).rdnEligible, false);
});
test("RDN scheduling rejects missing anatomy or shared decision and closes only on actual completed RDN", async () => {
  const id = await prepared(false);
  await assert.rejects(
    () => complete(id, "rdn-plan", rdn),
    /cannot be scheduled/,
  );
  await study(id, anatomy);
  await complete(id, "htn-resistance", resistance);
  await assert.rejects(
    () => complete(id, "rdn-plan", { ...rdn, consent: "no" }),
    /Patient preference/,
  );
  await complete(id, "rdn-plan", rdn);
  let s = await loadState(db, id);
  const p = s.plan.find((p) => p.completes_on.kind === "rdn")!;
  assert.equal(p.status, "planned");
  await tx((q) =>
    K.recordProcedure(q, a, id, {
      kind: "rdn",
      date: nowIso(),
      details: {
        device: "Symplicity Spyral",
        result: "Aborted / not performed",
        arteries: "No treatment",
        complications: [],
      },
    }),
  );
  s = await loadState(db, id);
  assert.equal(s.plan.find((x) => x.id === p.id)!.status, "planned");
  assert.equal(rules(s, "htn.rdn-aftercare").length, 1);
  await tx((q) =>
    K.recordProcedure(q, a, id, {
      kind: "rdn",
      date: nowIso(),
      details: {
        device: "Symplicity Spyral",
        result: "Completed",
        arteries: "Bilateral",
        complications: [],
      },
    }),
  );
  s = await loadState(db, id);
  assert.equal(s.plan.find((x) => x.id === p.id)!.status, "completed");
  await complete(id, "after-rdn", {
    safety: "stable",
    meds: "yes",
    education: "yes",
    renalDate: T,
    bpDate: addDays(T, 30),
    monitor: "abpm",
    reviewDate: addDays(T, 30),
  });
  assert.equal(rules(await loadState(db, id), "htn.rdn-aftercare").length, 0);
});
test("aldosteronism screening is offered without hypokalaemia; new results reopen review and purpose matching prevents wrong closure", async () => {
  const id = await patient();
  await obs(id, 125, 75);
  let s = await loadState(db, id);
  assert.equal(rules(s, "htn.secondary").length, 1);
  await complete(id, "htn-secondary", {
    paAction: "screen",
    tests: [],
    disposition: "workup",
    when: T,
  });
  s = await loadState(db, id);
  assert.equal(rules(s, "htn.secondary").length, 0);
  const screen = s.plan.find(
    (p) => p.completes_on.purpose === "Primary aldosteronism screen",
  )!;
  await tx((q) =>
    K.recordStudy(q, a, id, {
      kind: "hypertension_workup",
      date: nowIso(),
      findings: secondary,
    }),
  );
  s = await loadState(db, id);
  assert.equal(s.plan.find((p) => p.id === screen.id)!.status, "planned");
  const r = await tx((q) =>
    K.recordStudy(q, a, id, {
      kind: "hypertension_workup",
      date: nowIso(),
      findings: {
        ...pa,
        screenResult: "Positive",
        aldosterone: 20,
        renin: 0.2,
        arr: 100,
      },
    }),
  );
  s = await loadState(db, id);
  assert.equal(s.plan.find((p) => p.id === screen.id)!.status, "completed");
  assert.match(rules(s, "htn.secondary")[0].title, /Positive/);
  await tx((q) => voidStudy(q, a, id, r.id, "Synthetic correction"));
  s = await loadState(db, id);
  assert.equal(s.plan.find((p) => p.id === screen.id)!.status, "planned");
});
test("HBPM requires multi-day valid protocol and sufficient ABPM readings; mixed-date and preliminary office values never prove eligibility", async () => {
  const id = await prepared();
  await tx((q) =>
    K.recordStudy(q, a, id, {
      kind: "home_bp",
      date: past(),
      findings: {
        meanSbp: 150,
        meanDbp: 90,
        days: 2,
        validated: "Yes",
        protocol: "Twice daily, two readings each time",
        onTreatment: "On treatment",
      },
    }),
  );
  let s = await loadState(db, id);
  assert.equal(hypertensionProfile(s).outside?.valid, false);
  await tx((q) =>
    K.recordStudy(q, a, id, {
      kind: "home_bp",
      date: past(),
      findings: {
        meanSbp: 150,
        meanDbp: 90,
        days: 7,
        validated: "Yes",
        protocol: "Twice daily, two readings each time",
        onTreatment: "On treatment",
      },
    }),
  );
  s = await loadState(db, id);
  assert.equal(hypertensionProfile(s).outside?.valid, true);
  await tx((q) =>
    K.recordObservations(q, a, id, {
      effectiveAt: nowIso(),
      items: [{ code: "sbp", value: 190 }],
    }),
  );
  s = await loadState(db, id);
  assert.equal(hypertensionProfile(s).office, null);
  assert.equal(hypertensionProfile(s).rdnEligible, false);
});
test("young onset, low potassium and non-dipping generate screening clues; marked BP requests damage assessment without diagnosing emergency", async () => {
  const id = await patient("2000-01-01");
  await obs(id, 180, 110);
  await abpm(id, { dipping: "Non-dipper" });
  await tx((q) =>
    K.recordObservations(q, a, id, {
      effectiveAt: nowIso(),
      items: [{ code: "potassium", value: 3.1 }],
    }),
  );
  const s = await loadState(db, id),
    h = hypertensionProfile(s);
  assert(h.secondaryClues.some((c) => c.includes("40")));
  assert(h.secondaryClues.includes("Hypokalaemia"));
  assert(h.secondaryClues.some((c) => c.includes("apnoea")));
  assert.equal(rules(s, "htn.management").length, 0);
  const acute = ACUTE_RULES.find((r) => r.id === "htn.severe")!;
  assert.equal(acute.evaluate(s, acute.defaultParams).length, 1);
  const c = (await tx((q) => getWizard(q, id, "htn-review"))).context;
  const outcome = buildOutcome(
    "htn-review",
    {
      safety: "urgent",
      confirmation: "repeat",
      risk: "unknown",
      target: "individual",
      actions: ["medication"],
      when: T,
      reviewDate: T,
    },
    c,
  );
  assert.equal(
    outcome.some((i) => i.kind === "start"),
    false,
  );
  assert(outcome.some((i) => i.kind === "plan" && /now/.test(i.title)));
});
