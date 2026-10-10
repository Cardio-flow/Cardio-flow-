import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { voidProcedure, voidStudy } from "../server/kernel/corrections.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { AF_AFTERCARE_RULES } from "../server/engine/af-aftercare-rules.js";
import { suggest } from "../shared/wizard-guidance.js";
import { RHYTHM_RULES } from "../server/engine/rhythm-rules.js";
import { addCalendarMonths } from "../shared/af.js";
import { cleanProcedure } from "../shared/procedures.js";
import { buildOutcome, WIZARDS } from "../shared/wizards.js";
import { prefill } from "../shared/wizard-prefill.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
let db: DB;
const doc: Actor = {
  id: "af@example.test",
  name: "Synthetic AF clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const T = today();
const at = (d: string) => new Date(`${d}T08:00:00+03:00`).toISOString();
const tx = <R>(f: (q: any) => Promise<R>) => db.transaction(f);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
let seq = 0;
const patient = () =>
  tx((q) =>
    K.createPatient(q, doc, {
      name: "Synthetic AF aftercare",
      mrn: "AF-AFTER-" + ++seq,
      sex: "Male",
      birthDate: "1950-01-01",
      conditions: ["af", "htn"],
    }),
  );
const la = {
  method: "Transcatheter occlusion",
  device: "WATCHMAN FLX",
  result: "Implanted / completed",
  regimen: "DAPT",
};
const laAnswers = {
  safety: "stable",
  protocol: "regional",
  lateImaging: "individual",
  regimen: "dapt",
  regimenAt: addDays(T, 30),
  imagePlan: "book",
  imageAt: addDays(T, 45),
  clinicAt: addDays(T, 45),
};
const run = (id: string, wizard: string, answers: any) =>
  tx(async (q) => {
    const r = await completeWizard(q, doc, id, wizard, { answers });
    await reassess(q, id, "sandbox");
    return r;
  });
const recs = async (id: string) =>
  (
    await db.query(
      "SELECT rule_id FROM cf.recommendation WHERE patient_id=$1 AND status='active'",
      [id],
    )
  ).rows.map((r: any) => r.rule_id);
const meds = (id: string) =>
  tx(async (q) => {
    for (const [code, dose] of [
      ["aspirin", 100],
      ["clopidogrel", 75],
    ] as const)
      await K.startMedication(q, doc, id, {
        code,
        doseValue: dose,
        frequency: "OD",
        route: "PO",
        indication: "other",
        effectiveAt: at(addDays(T, -1)),
      });
  });
test("calendar month boundaries are preserved for clinical minimums", () => {
  assert.equal(addCalendarMonths("2026-01-31", 2), "2026-03-31");
  assert.equal(addCalendarMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addCalendarMonths("2026-12-31", 2), "2027-02-28");
});
test("LAA device/method and dates are validated without inventing a regimen", () => {
  assert.throws(
    () => cleanProcedure("laao", { ...la, device: "Surgical clip" }),
    /match/,
  );
  assert.throws(
    () => cleanProcedure("laao", { ...la, reviewDate: "2026-02-30" }),
    /date/,
  );
  assert.equal(
    cleanProcedure("laao", { ...la, regimen: undefined }).regimen,
    "Not documented",
  );
});
test("actual closure, DAPT, follow-up and decisions are linked; repeat implant needs new aftercare", async () => {
  const id = await patient();
  const admission = await tx((q) =>
    K.startAdmission(q, doc, id, {
      startedAt: at(addDays(T, -1)),
      location: "CCU",
      reasons: ["Other"],
    }),
  );
  const p = await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "laao",
      // Keep the first implant before the later repeat, including around Kuwait midnight.
      date: new Date(Date.now() - 60_000).toISOString(),
      details: la,
      contextId: admission.id,
    }),
  );
  await meds(id);
  await tx((q) => reassess(q, id, "sandbox"));
  assert.ok((await recs(id)).includes("rhythm.laao-aftercare"));
  assert.ok(!(await recs(id)).includes("af.anticoagulation"));
  const result = await tx(async (q) => {
    const r = await completeWizard(q, doc, id, "after-laao", {
      answers: laAnswers,
      contextId: admission.id,
    });
    await reassess(q, id, "sandbox");
    return r;
  });
  assert.ok(
    result.outcome.some(
      (x) => x.kind === "plan" && x.completesOn.kind === "laa_imaging",
    ),
  );
  const s = await loadState(db, id);
  assert.equal(s.afReviews?.["after-laao"].answers._procedureId, p.id);
  assert.ok(!(await recs(id)).includes("rhythm.laao-aftercare"));
  const care = (await tx((q) => getWizard(q, id, "af-care"))).context;
  assert.deepEqual(
    suggest("af-care", "oac", {}, care).map((x) => x.value),
    ["laao"],
  );
  assert.ok(
    !suggest("af-care", "bleed", {}, care).some((x) => x.value === "stop-asa"),
  );
  assert.ok(
    !buildOutcome("af-care", { oac: "laao", bleed: ["stop-asa"] }, care).some(
      (x) => x.kind === "medication" && x.event === "stop",
    ),
  );
  const careRule = AF_AFTERCARE_RULES.find(
    (r) => r.id === "rhythm.laao-aftercare",
  )!;
  const beforeDue = careRule.evaluate({ ...s, meds: [] }, {})[0];
  const atDue = careRule.evaluate(
    { ...s, meds: [], today: laAnswers.regimenAt },
    {},
  )[0];
  assert.notEqual(
    beforeDue.signature,
    atDue.signature,
    "A due regimen review must not inherit a previously decided finding",
  );
  assert.equal(
    careRule.evaluate({ ...s, plan: [] }, {}).length,
    1,
    "Cancelled surveillance needs a new plan",
  );
  const aspirin = s.meds.find((m) => m.code === "aspirin")!;
  const duplicate = { ...s, meds: [aspirin, { ...aspirin, id: "duplicate" }] };
  assert.equal(
    AF_AFTERCARE_RULES.find((r) => r.id === "rhythm.laao-aftercare")!.evaluate(
      duplicate,
      {},
    ).length,
    1,
    "Two aspirin entries cannot represent DAPT",
  );
  const d = (
    await db.query("SELECT context_id FROM cf.decision WHERE id=$1", [
      result.decisionId,
    ])
  ).rows[0];
  assert.equal(d.context_id, admission.id);
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "laao",
      date: new Date().toISOString(),
      details: { ...la, device: "Amplatzer Amulet" },
    }),
  );
  await tx((q) => reassess(q, id, "sandbox"));
  assert.ok((await recs(id)).includes("rhythm.laao-aftercare"));
});
test("pre-closure imaging cannot complete surveillance; DRT/leak need review and withdrawn clear scan restores DRT", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "laao",
      date: at(addDays(T, -2)),
      details: la,
    }),
  );
  await meds(id);
  await run(id, "after-laao", { ...laAnswers, imageAt: T });
  await tx((q) =>
    K.recordStudy(q, doc, id, {
      kind: "laa_imaging",
      date: new Date().toISOString(),
      findings: {
        purpose: "Before closure",
        modality: "TOE / TEE",
        laaThrombus: "Absent",
      },
    }),
  );
  let s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.completes_on.kind === "laa_imaging")?.status,
    "planned",
  );
  await tx(async (q) => {
    await K.recordStudy(q, doc, id, {
      kind: "laa_imaging",
      date: new Date().toISOString(),
      findings: {
        purpose: "After closure",
        modality: "Cardiac CT",
        laaThrombus: "Absent",
        deviceThrombus: "Present",
        leak: "Present",
        leakMm: 3,
      },
    });
    await reassess(q, id, "sandbox");
  });
  s = await loadState(db, id);
  assert.equal(
    s.plan.find((p) => p.completes_on.kind === "laa_imaging")?.progress,
    "performed",
  );
  assert.ok((await recs(id)).includes("rhythm.laao-thrombus"));
  assert.ok((await recs(id)).includes("rhythm.laao-uncertain"));
  const r = await run(id, "after-laao", {
    ...laAnswers,
    imagePlan: "reviewed",
    imageAt: T,
  });
  assert.ok(
    r.outcome.some(
      (o) => o.kind === "plan" && o.title.includes("Device-related thrombus"),
    ),
  );
  assert.ok(
    r.outcome.some(
      (o) => o.kind === "plan" && o.completesOn.kind === "laa_imaging",
    ),
  );
  assert.ok(!r.outcome.some((o) => o.kind === "medication"));
  const clear = await tx(async (q) => {
    const st = await K.recordStudy(q, doc, id, {
      kind: "laa_imaging",
      date: new Date().toISOString(),
      findings: {
        purpose: "After closure",
        modality: "TOE / TEE",
        laaThrombus: "Absent",
        deviceThrombus: "Absent",
        leak: "Absent",
      },
    });
    await reassess(q, id, "sandbox");
    return st;
  });
  assert.ok(!(await recs(id)).includes("rhythm.laao-thrombus"));
  await tx(async (q) => {
    await voidStudy(q, doc, id, clear.id, "Wrong entry");
    await reassess(q, id, "sandbox");
  });
  assert.ok((await recs(id)).includes("rhythm.laao-thrombus"));
});
test("aborted closure and surgical exclusion do not remove the OAC indication", async () => {
  const aborted = await patient();
  await tx(async (q) => {
    await K.recordProcedure(q, doc, aborted, {
      kind: "laao",
      date: at(T),
      details: { ...la, result: "Aborted / not implanted" },
    });
    await reassess(q, aborted, "sandbox");
  });
  assert.ok((await recs(aborted)).includes("af.anticoagulation"));
  assert.ok(!(await recs(aborted)).includes("rhythm.laao-aftercare"));
  await assert.rejects(
    run(aborted, "after-laao", laAnswers),
    /completed LAA closure/,
  );
  const surgery = await patient();
  await tx(async (q) => {
    await K.recordProcedure(q, doc, surgery, {
      kind: "laao",
      date: at(T),
      details: { ...la, method: "Surgical exclusion", device: "Surgical clip" },
    });
    await reassess(q, surgery, "sandbox");
  });
  assert.ok((await recs(surgery)).includes("af.anticoagulation"));
});
test("procedure completion requires matching actual evidence; correction reopens the task", async () => {
  const id = await patient();
  const task = await tx((q) =>
    K.addPlanAction(q, doc, id, {
      category: "procedure",
      title: "Transcatheter LAA closure",
      dueDate: addDays(T, 10),
      completesOn: { type: "procedure", kind: "laao" },
    }),
  );
  await assert.rejects(
    tx((q) =>
      K.updatePlanAction(q, doc, id, task.id, {
        action: "complete",
        version: 1,
      }),
    ),
    /record/,
  );
  const p = await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "laao",
      date: new Date().toISOString(),
      details: la,
    }),
  );
  let s = await loadState(db, id);
  assert.equal(s.plan.find((x) => x.id === task.id)?.status, "completed");
  await tx((q) => voidProcedure(q, doc, id, p.id, "Wrong entry"));
  s = await loadState(db, id);
  assert.equal(s.plan.find((x) => x.id === task.id)?.status, "planned");
  assert.equal(s.procedures.length, 0);
});
test("ablation preparation defers unsafe procedures; aftercare uses actual date and no automatic medicine stop", async () => {
  const id = await patient();
  const ctx = (await tx((q) => getWizard(q, id, "af-ablation-plan"))).context;
  const a = {
    safety: "stable",
    indication: "aad",
    decision: "proceed",
    when: addDays(T, 10),
    anticoag: "no",
    thrombus: "unknown",
    periOac: "continuous",
  };
  assert.ok(
    !buildOutcome("af-ablation-plan", a, ctx).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
  const ab = await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "ablation",
      date: at(addDays(T, -10)),
      details: {
        targets: ["AF (pulmonary vein isolation)"],
        energy: "Pulsed field",
        result: "Acute success",
      },
    }),
  );
  const r = await run(id, "after-af-ablation", {
    safety: "stable",
    rhythm: "recurrence",
    aad: "review",
    basis: "acc",
    oac: "continue",
    reviewAt: addDays(T, 60),
    ecgAt: addDays(T, 60),
    monitor: "yes",
  });
  assert.ok(
    r.outcome.some(
      (x) =>
        x.kind === "plan" &&
        x.title.includes(addCalendarMonths(addDays(T, -10), 3)),
    ),
  );
  assert.ok(
    r.outcome.some((x) => x.kind === "plan" && x.completesOn.kind === "holter"),
  );
  assert.ok(!r.outcome.some((x) => x.kind === "medication"));
  assert.equal(
    (await loadState(db, id)).afReviews?.["after-af-ablation"].answers
      ._procedureId,
    ab.id,
  );
});
test("post-ablation minimum is two calendar months and flutter-only ablation is excluded", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "ablation",
      date: at(addDays(T, -5)),
      details: { targets: ["Atrial flutter (CTI)"] },
    }),
  );
  let s = await loadState(db, id);
  const rule = RHYTHM_RULES.find((r) => r.id === "rhythm.post-ablation-oac")!;
  assert.deepEqual(rule.evaluate(s, {}), []);
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "ablation",
      date: at(addDays(T, -5)),
      details: { targets: ["AF (pulmonary vein isolation)"] },
    }),
  );
  s = await loadState(db, id);
  assert.equal(rule.evaluate(s, {}).length, 1);
  s.today = addCalendarMonths(addDays(T, -5), 2);
  assert.equal(rule.evaluate(s, {}).length, 0);
  const ab = s.procedures.find(
    (p) =>
      p.kind === "ablation" &&
      p.attributes.targets.includes("AF (pulmonary vein isolation)"),
  )!;
  s.afReviews = {
    "after-af-ablation": {
      at: new Date().toISOString(),
      answers: { _procedureId: ab.id, basis: "acc" },
    },
  };
  assert.equal(
    rule.evaluate(s, {}).length,
    1,
    "ACC minimum still requires OAC after 2 months",
  );
  s.today = addCalendarMonths(addDays(T, -5), 3);
  assert.equal(rule.evaluate(s, {}).length, 0);
});
test("LAAO scheduling with unknown anatomy, thrombus, limited survival or valve exclusion is deferred", async () => {
  const id = await patient();
  const c = (await tx((q) => getWizard(q, id, "laao-selection"))).context;
  const base = {
    reason: "contra",
    life: "adequate",
    shortTherapy: "yes",
    imaging: "clear",
    decision: "proceed",
    when: T,
  };
  const blocked = {
    ...c,
    afProcedures: {
      ...c.afProcedures!,
      preImaging: {
        id: "thrombus",
        day: T,
        findings: { purpose: "Before closure", laaThrombus: "Present" },
      },
    },
  };
  assert.ok(
    !buildOutcome("laao-selection", base, blocked).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
  assert.ok(
    !buildOutcome(
      "af-ablation-plan",
      {
        safety: "stable",
        indication: "aad",
        decision: "proceed",
        when: T,
        anticoag: "yes",
        thrombus: "clear",
        periOac: "continuous",
      },
      blocked,
    ).some((x) => x.kind === "plan" && x.category === "procedure"),
  );
  assert.ok(
    buildOutcome("laao-selection", base, c).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
  for (const delta of [
    { imaging: "thrombus" },
    { imaging: "unknown" },
    { life: "limited" },
    { shortTherapy: "uncertain" },
    { reason: "surgery" },
  ])
    assert.ok(
      !buildOutcome("laao-selection", { ...base, ...delta }, c).some(
        (x) => x.kind === "plan" && x.category === "procedure",
      ),
    );
  assert.ok(
    !buildOutcome("laao-selection", base, { ...c, dx: [], af: undefined }).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    ),
  );
  assert.ok(
    !buildOutcome("laao-selection", base, {
      ...c,
      dx: ["mechanical-valve"],
    }).some((x) => x.kind === "plan" && x.category === "procedure"),
  );
});

test("medication duration never confirms effective preprocedure anticoagulation", async () => {
  const id = await patient();
  await tx((q) =>
    K.startMedication(q, doc, id, {
      code: "apixaban",
      doseValue: 5,
      frequency: "BID",
      route: "PO",
      indication: "af",
      effectiveAt: at(addDays(T, -30)),
    }),
  );
  const c = (await tx((q) => getWizard(q, id, "peri-af-procedure"))).context;
  assert.deepEqual(suggest("peri-af-procedure", "oacNow", {}, c), []);
  c.meds[0].startedAt = null;
  assert.deepEqual(suggest("peri-af-procedure", "oacNow", {}, c), []);
});

test("ESC defaults preserve the distinct SCAI closure eligibility decision", async () => {
  const id = await patient();
  const c = (await tx((q) => getWizard(q, id, "laao-selection"))).context;
  assert.equal(prefill("laao-selection", c).answers.basis, "esc");
  assert.equal(prefill("after-af-ablation", c).answers.basis, "esc");
  const a = {
    basis: "esc",
    reason: "preference",
    life: "adequate",
    shortTherapy: "yes",
    imaging: "clear",
    decision: "proceed",
    when: T,
  };
  const scheduled = (answers: any) =>
    buildOutcome("laao-selection", answers, c).some(
      (x) => x.kind === "plan" && x.category === "procedure",
    );
  assert.equal(scheduled(a), false);
  assert.equal(scheduled({ ...a, basis: "scai" }), true);
  assert.equal(scheduled({ ...a, reason: "contra" }), true);
  assert.match(
    WIZARDS["laao-selection"].assess!(
      { ...a, basis: "scai" },
      c,
    ).recommendations.join(" "),
    /moderate-certainty/,
  );
});

test("device protocol validation rejects mismatched devices, regimen and unrecorded ablation", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordProcedure(q, doc, id, { kind: "laao", date: at(T), details: la }),
  );
  await assert.rejects(
    run(id, "after-laao", { ...laAnswers, protocol: "flxpro-dapt" }),
    /does not match/,
  );
  const pro = await patient();
  await tx((q) =>
    K.recordProcedure(q, doc, pro, {
      kind: "laao",
      date: at(T),
      details: { ...la, device: "WATCHMAN FLX Pro" },
    }),
  );
  await assert.rejects(
    run(pro, "after-laao", { ...laAnswers, protocol: "flxpro-oac" }),
    /regimen must match/,
  );
  await assert.rejects(
    run(pro, "after-laao", {
      ...laAnswers,
      protocol: "flxpro-ablation",
      regimen: "oac",
    }),
    /Record AF ablation/,
  );
  const r = await run(pro, "after-laao", {
    ...laAnswers,
    protocol: "flxpro-dapt",
    lateImaging: "book",
  });
  const late = r.outcome.find(
    (x) => x.kind === "plan" && x.title.includes("12-month LAA"),
  );
  assert.ok(late?.kind === "plan");
  assert.equal(late.dueDate, addCalendarMonths(T, 12));
  assert.equal(late.completesOn.after, addCalendarMonths(T, 12));
  assert.ok(!r.outcome.some((x) => ["start", "medication"].includes(x.kind)));
  assert.equal(
    (await loadState(db, pro)).afReviews?.["after-laao"].answers.protocol,
    "flxpro-dapt",
  );
});

test("an unconfirmed device protocol remains an actionable finding despite clear imaging and matching medicines", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "laao",
      date: at(addDays(T, -1)),
      details: la,
    }),
  );
  await meds(id);
  await tx((q) =>
    K.recordStudy(q, doc, id, {
      kind: "laa_imaging",
      date: at(T),
      findings: {
        purpose: "After closure",
        modality: "TOE / TEE",
        laaThrombus: "Absent",
        deviceThrombus: "Absent",
        leak: "Absent",
      },
    }),
  );
  await run(id, "after-laao", {
    ...laAnswers,
    protocol: "unconfirmed",
    imagePlan: "reviewed",
  });
  const rule = AF_AFTERCARE_RULES.find(
    (r) => r.id === "rhythm.laao-aftercare",
  )!;
  assert.equal(rule.evaluate(await loadState(db, id), {}).length, 1);
  await run(id, "after-laao", {
    ...laAnswers,
    protocol: "regional",
    imagePlan: "reviewed",
  });
  assert.equal(rule.evaluate(await loadState(db, id), {}).length, 0);
});

test("PFA recovery and long-term risk review read the actual procedure and create no automatic drug change", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordProcedure(q, doc, id, {
      kind: "ablation",
      date: at(addDays(T, -10)),
      details: {
        targets: ["AF (pulmonary vein isolation)"],
        energy: "Pulsed field",
        result: "Acute success",
      },
    }),
  );
  const c = (await tx((q) => getWizard(q, id, "after-af-ablation"))).context;
  assert.equal(c.afProcedures?.ablation?.energy, "Pulsed field");
  const a = {
    safety: "stable",
    rhythm: "well",
    aad: "none",
    basis: "esc",
    oac: "longterm",
    reviewAt: T,
    ecgAt: T,
    monitor: "no",
  };
  const low = { ...c, af: { ...c.af!, score: 0 } };
  const assessment = WIZARDS["after-af-ablation"].assess!(a, low);
  assert.match(assessment.recommendations.join(" "), /haemolysis/);
  assert.match(assessment.recommendations.join(" "), /other indications/);
  assert.match(
    assessment.recommendations.join(" "),
    /minimum period has not passed/,
  );
  const out = buildOutcome("after-af-ablation", a, low);
  assert.ok(
    out.some(
      (x) =>
        x.kind === "plan" &&
        x.title.includes("rhythm-monitoring / restart plan"),
    ),
  );
  assert.ok(out.every((x) => x.kind === "plan"));
});
