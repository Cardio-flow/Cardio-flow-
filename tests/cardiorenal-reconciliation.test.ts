import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { documents } from "../server/kernel/documents.js";
import { medicationHistory } from "../server/kernel/views.js";
import { createApp } from "../server/app.js";
import { addDays } from "../shared/clinical.js";
import { today, type Actor } from "../server/kernel/base.js";

let db: DB, server: any, base: string, cookie: string, csrf: string;
const actor: Actor = {
  id: "dr.test@cardioflow.local",
  name: "Dr Test",
  role: "clinician",
  siteId: SITE_ID,
};
const T = today(),
  at = (offset = 0) =>
    new Date(`${addDays(T, offset)}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
let n = 0;
const patient = (conditions = ["hfpef", "ckd-1-2"]) =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic renal review ${++n}`,
      mrn: `RENAL-REVIEW-${n}`,
      sex: "Female",
      birthDate: "1956-01-01",
      conditions,
    }),
  );
const labs = (
  id: string,
  items: any[],
  offset = 0,
  status: "final" | "preliminary" = "final",
) =>
  tx((q) =>
    K.recordObservations(q, actor, id, {
      effectiveAt: at(offset),
      items,
      status,
    }),
  );
const medicine = (
  id: string,
  code = "spironolactone",
  alreadyTaking = true,
  offset = 0,
) =>
  tx((q) =>
    K.startMedication(q, actor, id, {
      code,
      doseValue: code === "apixaban" ? 5 : 25,
      frequency: code === "apixaban" ? "BID" : "OD",
      route: "PO",
      indication: code === "apixaban" ? "af" : "hf",
      alreadyTaking,
      effectiveAt: at(offset),
    }),
  );
const run = (id: string) => tx((q) => reassess(q, id, "production"));
const alerts = async (id: string, rule?: string) =>
  (
    await db.query<any>(
      "SELECT * FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND ($2::text IS NULL OR rule_id=$2)",
      [id, rule ?? null],
    )
  ).rows;
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(base + "/demo-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }),
  });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = (await r.json()).csrf;
});
after(async () => {
  server.close();
  await db.close();
});

test("reconciliation preserves current dose, unknown start and truthful history/documents", async () => {
  const id = await patient();
  await medicine(id);
  await run(id);
  const s = await loadState(db, id),
    m = s.meds[0];
  assert.equal(m.status, "active");
  assert.equal(m.doseValue, 25);
  assert.equal(m.startedAt, null);
  assert.equal(m.events[0].kind, "continue");
  assert.equal(medicationHistory(s)[0].kind, "reconciliation");
  assert.equal((await alerts(id, "ops.monitoring-after-change")).length, 0);
  const text = (await documents(db, id)).find((d) => d.id === "summary")!.text;
  assert.ok(text.includes("Spironolactone"));
  assert.ok(!text.includes("Spironolactone start"));
  assert.ok(
    (await alerts(id, "med.monitoring")).some((r) =>
      /Potassium and creatinine/.test(r.title),
    ),
    "routine missing bloods still flagged",
  );
  assert.ok(
    (await alerts(id, "med.monitoring")).every(
      (r) => !r.detail.includes("since the medicine was started"),
    ),
  );
});

test("recent verified baseline meets routine monitoring; a true later increase still needs paired checks", async () => {
  const id = await patient();
  await labs(
    id,
    [
      { code: "creatinine", value: 110 },
      { code: "potassium", value: 4.3 },
    ],
    -2,
  );
  const { medicationId } = await medicine(id, "spironolactone", true, -1);
  await run(id);
  assert.equal((await alerts(id, "med.monitoring")).length, 0);
  await tx((q) =>
    K.medicationEvent(q, actor, id, medicationId, {
      kind: "increase",
      doseValue: 50,
      reason: "Clinician-confirmed increase",
      effectiveAt: at(),
    }),
  );
  await run(id);
  assert.equal((await alerts(id, "ops.monitoring-after-change")).length, 1);
});

test("one post-change result or a preliminary partner cannot clear paired safety monitoring", async () => {
  const id = await patient();
  await medicine(id, "spironolactone", false, -3);
  await labs(id, [{ code: "potassium", value: 4.2 }], -1);
  await run(id);
  assert.equal((await alerts(id, "ops.monitoring-after-change")).length, 1);
  await labs(id, [{ code: "creatinine", value: 110 }], -1, "preliminary");
  await run(id);
  assert.equal((await alerts(id, "ops.monitoring-after-change")).length, 1);
  await labs(id, [{ code: "creatinine", value: 111 }]);
  await run(id);
  assert.equal((await alerts(id, "ops.monitoring-after-change")).length, 0);
});

test("a potassium-only booking cannot hide the missing post-change creatinine", async () => {
  const id = await patient();
  await medicine(id, "spironolactone", false, -2);
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Potassium only",
      dueDate: addDays(T, 7),
      completesOn: { type: "lab", codes: ["potassium"] },
    }),
  );
  await run(id);
  assert.equal((await alerts(id, "ops.monitoring-after-change")).length, 1);
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Paired renal check",
      dueDate: addDays(T, 7),
      completesOn: { type: "lab", codes: ["potassium", "creatinine"] },
    }),
  );
  await run(id);
  assert.equal((await alerts(id, "ops.monitoring-after-change")).length, 0);
});

test("renal rise keeps dates and clinical review without falsely attributing a later reconciliation", async () => {
  const id = await patient();
  await labs(id, [{ code: "creatinine", value: 90 }], -60);
  await labs(
    id,
    [
      { code: "creatinine", value: 155 },
      { code: "potassium", value: 4.4 },
    ],
    -1,
  );
  await medicine(id);
  await run(id);
  const r = (await alerts(id, "hf.worsening-renal-function"))[0];
  assert.match(r.title, /cardiorenal review/);
  assert.ok(!/stop RAAS|halve/.test(r.title + r.detail));
  assert.match(
    r.detail,
    /does not establish drug causation or acute kidney injury/,
  );
  assert.ok(
    r.facts.some(
      (f: any) =>
        f.label === "Previous creatinine" && f.date.startsWith(addDays(T, -60)),
    ),
  );
});

test("CKD mismatch asks for chronicity review without changing the diagnosis", async () => {
  const id = await patient();
  await labs(id, [{ code: "creatinine", value: 150 }], -1);
  await run(id);
  const r = (await alerts(id, "cardiorenal.stage-review"))[0];
  assert.match(r.title, /review chronicity/);
  assert.equal(r.action.type, "edit-dx");
  assert.ok(
    (await loadState(db, id)).conditions.some((c) => c.code === "ckd-1-2"),
  );
  await labs(id, [{ code: "creatinine", value: 75 }]);
  await run(id);
  assert.equal((await alerts(id, "cardiorenal.stage-review")).length, 0);
});

test("missing DOAC weight remains visible rather than implying the dose is validated", async () => {
  const id = await patient(["af"]);
  await labs(id, [{ code: "creatinine", value: 110 }]);
  await medicine(id, "apixaban");
  await run(id);
  assert.ok(
    (await alerts(id, "af.doac-dose")).some(
      (r) =>
        r.title.includes("incomplete") && r.missing.includes("Current weight"),
    ),
  );
  await labs(id, [{ code: "weight", value: 80 }]);
  await run(id);
  assert.equal((await alerts(id, "af.doac-dose")).length, 0);
});

test("isolated historical AKI prompts assessment; renal deterioration owns the current alert; stronger HF markers retain referral", async () => {
  const id = await patient();
  const a = await tx((q) =>
    K.startAdmission(q, actor, id, {
      startedAt: at(-70),
      reasons: ["Heart failure"],
    }),
  );
  await tx((q) =>
    K.discharge(q, actor, id, a.id, {
      endedAt: at(-65),
      status: "Euvolaemic",
      destination: "Home",
      events: ["Acute kidney injury"],
      plan: [],
    }),
  );
  await run(id);
  let r = (await alerts(id, "hf.advanced-hf"))[0];
  assert.match(r.title, /cardiorenal status/);
  assert.equal(r.action.wizard, "renal-function");
  await labs(id, [{ code: "creatinine", value: 90 }], -60);
  await labs(id, [{ code: "creatinine", value: 155 }], -1);
  await medicine(id);
  await run(id);
  assert.equal((await alerts(id, "hf.advanced-hf")).length, 0);
  assert.equal((await alerts(id, "hf.worsening-renal-function")).length, 1);
  await labs(id, [{ code: "nyha", text: "III" }]);
  await run(id);
  r = (await alerts(id, "hf.advanced-hf"))[0];
  assert.equal(r.action.template, "advanced-hf");
});

test("API supports existing-medicine batches atomically and refuses an invented initiation schedule", async () => {
  const id = await patient();
  await labs(id, [
    { code: "creatinine", value: 110 },
    { code: "potassium", value: 4.3 },
  ]);
  const send = (path: string, body: any) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const item = {
    code: "spironolactone",
    doseValue: 25,
    frequency: "OD",
    route: "PO",
    indication: "hf",
    alreadyTaking: true,
  };
  const bad = await send(`/patients/${id}/medications/batch`, {
    items: [{ ...item, bookSchedule: true }],
  });
  assert.equal(bad.status, 400);
  assert.equal((await loadState(db, id)).meds.length, 0);
  const good = await send(`/patients/${id}/medications/batch`, {
    items: [item, { ...item, code: "bisoprolol", doseValue: 2.5 }],
  });
  assert.equal(good.status, 200, await good.text());
  const s = await loadState(db, id);
  assert.equal(s.meds.length, 2);
  assert.ok(s.meds.every((m) => m.status === "active" && m.startedAt === null));
  assert.equal(s.plan.length, 0);
});

test("the copied clinical summary includes non-urgent optimization recommendations", async () => {
  const id = await patient(["t2dm", "prior-pci"]);
  await run(id);
  const blue = (await alerts(id)).filter((r) => r.severity === "blue");
  assert.ok(blue.length > 0);
  const text = (await documents(db, id)).find((d) => d.id === "summary")!.text;
  assert.match(text, /Non-urgent recommendations:/);
  for (const r of blue) assert.ok(text.includes(r.title), r.title);
});

test("missing-input dose alerts preserve non-AF indications and held-treatment behavior", async () => {
  const id = await patient(["af"]);
  const { medicationId } = await tx(q => K.startMedication(q, actor, id, {code:"apixaban",doseValue:2.5,frequency:"BID",route:"PO",indication:"Extended VTE prevention",alreadyTaking:true,effectiveAt:at(-1)}));
  await run(id);
  assert.equal((await alerts(id,"af.doac-dose")).length,0);
  await tx(q => K.medicationEvent(q, actor, id, medicationId, {kind:"hold",reason:"Procedure",effectiveAt:at()}));
  await run(id);
  assert.equal((await alerts(id,"af.doac-dose")).length,0);
  const af = await patient(["af"]);
  const current = await medicine(af,"apixaban",true,-1);
  await tx(q => K.medicationEvent(q, actor, af, current.medicationId, {kind:"hold",reason:"Procedure",effectiveAt:at()}));
  await run(af);
  assert.equal((await alerts(af,"af.doac-dose")).length,0);
});
