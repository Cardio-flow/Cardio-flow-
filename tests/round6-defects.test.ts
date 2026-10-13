import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import {
  entryDraft,
  getVisitDraft,
  saveVisitDraft,
} from "../server/kernel/visit-drafts.js";
import { confirmAssessment } from "../server/kernel/assessment.js";
import { loadState } from "../server/kernel/state.js";
import { hypertensionProfile } from "../server/engine/hypertension-profile.js";
import { nowIso, type Actor } from "../server/kernel/base.js";
let db: DB,
  server: any,
  base: string,
  cookie: string,
  csrf: string,
  seq = 0;
const actor: Actor = {
  id: "dr.ahmed@cardioflow.local",
  name: "Synthetic R6 clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const tx = <T>(f: (q: any) => Promise<T>) => db.transaction(f);
const patient = () =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic R6 fix ${++seq}`,
      mrn: `R6FIX-${seq}`,
      sex: "Male",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions: ["htn"],
    }),
  );
const visit = (id: string, narrative = "") =>
  tx((q) =>
    K.startVisit(q, actor, id, {
      startedAt: nowIso(),
      service: "Clinic",
      reasons: ["Routine cardiology"],
      narrative,
    }),
  );
const labs = (id: string, items: K.ObsInput[]) =>
  tx((q) =>
    K.recordObservations(q, actor, id, { effectiveAt: nowIso(), items }),
  );
const draft = (id: string, v: any) =>
  entryDraft(db, actor, id, `assessment:${v.id}`) as Promise<any>;
const post = async (path: string, body: any) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(base + "/demo-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: actor.id }),
  });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = (await r.json()).csrf;
});
after(async () => {
  server.close();
  await db.close();
});
for (const changed of ["sbp", "dbp"])
  test(`a ${changed}-only edit requires paired review and saves the confirmed BP together`, async () => {
    const id = await patient(),
      v = await visit(id);
    await labs(id, [
      { code: "sbp", value: 148 },
      { code: "dbp", value: 88 },
    ]);
    const d = await draft(id, v),
      s = await loadState(db, id),
      count = s.observations.length;
    const input = {
      draftVersion: d.version,
      baseline: d.answers.baseline,
      items: [
        { code: "sbp", value: changed === "sbp" ? 158 : 148 },
        { code: "dbp", value: changed === "dbp" ? 98 : 88 },
      ],
    };
    await assert.rejects(
      tx((q) => confirmAssessment(q, actor, id, v.id, input)),
      (e: any) => e.code === "bp_pair_review",
    );
    assert.equal((await loadState(db, id)).observations.length, count);
    await tx((q) =>
      confirmAssessment(q, actor, id, v.id, { ...input, confirmBpPair: true }),
    );
    const next = await loadState(db, id),
      bp = hypertensionProfile(next).office;
    assert.equal(next.observations.length, count + 2);
    assert.ok(bp);
    assert.equal(bp.sbp, input.items[0].value);
    assert.equal(bp.dbp, input.items[1].value);
    assert.equal(
      next.resolved("sbp").current!.effective_at,
      next.resolved("dbp").current!.effective_at,
    );
    assert.equal(next.resolved("dbp").current!.context_id, v.id);
  });
test("saving unchanged BP with a changed weight does not duplicate the BP pair", async () => {
  const id = await patient(),
    v = await visit(id);
  await labs(id, [
    { code: "sbp", value: 148 },
    { code: "dbp", value: 88 },
  ]);
  const d = await draft(id, v),
    before = hypertensionProfile(await loadState(db, id)).office;
  await tx((q) =>
    confirmAssessment(q, actor, id, v.id, {
      draftVersion: d.version,
      baseline: d.answers.baseline,
      confirmBpPair: true,
      items: [
        { code: "sbp", value: 148 },
        { code: "dbp", value: 88 },
        { code: "weight", value: 70 },
      ],
    }),
  );
  const next = await loadState(db, id);
  assert.deepEqual(hypertensionProfile(next).office, before);
  assert.equal(
    next.observations.filter((o) => ["sbp", "dbp"].includes(o.code)).length,
    2,
  );
  assert.equal(next.resolved("weight").current!.value_num, 70);
});
test("a partial BP entry never copies the other component from an earlier reading", async () => {
  const id = await patient(),
    v = await visit(id);
  await labs(id, [
    { code: "sbp", value: 148 },
    { code: "dbp", value: 88 },
  ]);
  const d = await draft(id, v),
    old = (await loadState(db, id)).resolved("dbp").current!;
  await tx((q) =>
    confirmAssessment(q, actor, id, v.id, {
      draftVersion: d.version,
      baseline: d.answers.baseline,
      items: [{ code: "sbp", value: 158 }],
    }),
  );
  const next = await loadState(db, id);
  assert.equal(next.resolved("dbp").current!.id, old.id);
  assert.equal(hypertensionProfile(next).office, null);
});
const admissionAnswers = (narrative: string) => ({
  narrative,
  reasons: ["Chest pain (ACS to exclude)"],
  hfChoice: "no",
  route: "Emergency department",
  symptoms: [],
  loc: "CCU",
  bed: "",
  conf: {},
});
const admit = (id: string, extra: any = {}) => ({
  startedAt: nowIso(),
  location: "CCU",
  reasons: ["Chest pain (ACS to exclude)"],
  ...extra,
});
test("admission confirmation refuses stale or omitted draft versions without consuming the newer draft", async () => {
  const id = await patient();
  await tx((q) =>
    entryDraft(q, actor, id, "admission-entry", {
      version: 0,
      answers: admissionAnswers("Synthetic initial history"),
    }),
  );
  await tx((q) =>
    entryDraft(q, actor, id, "admission-entry", {
      version: 1,
      answers: admissionAnswers("Synthetic newer history"),
    }),
  );
  for (const extra of [{ draftVersion: 1 }, {}]) {
    const r = await post(
      `/patients/${id}/admissions`,
      admit(id, { narrative: "Synthetic stale history", ...extra }),
    );
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "entry_draft_changed");
  }
  assert.equal((await loadState(db, id)).contexts.length, 0);
  const latest: any = await entryDraft(db, actor, id, "admission-entry");
  assert.equal(latest.version, 2);
  assert.equal(latest.answers.narrative, "Synthetic newer history");
  const r = await post(
    `/patients/${id}/admissions`,
    admit(id, {
      narrative: latest.answers.narrative,
      draftVersion: latest.version,
    }),
  );
  assert.equal(r.status, 200);
  assert.equal(
    (await loadState(db, id)).contexts[0].summary.narrative,
    "Synthetic newer history",
  );
});
test("admission drafts remain clinician scoped on confirmation", async () => {
  const id = await patient(),
    other = { ...actor, id: "other-r6@example.test" };
  await tx((q) =>
    entryDraft(q, other, id, "admission-entry", {
      version: 0,
      answers: admissionAnswers("Synthetic other clinician history"),
    }),
  );
  const r = await post(`/patients/${id}/admissions`, admit(id));
  assert.equal(r.status, 200);
  const otherDraft: any = await entryDraft(db, other, id, "admission-entry");
  assert.equal(otherDraft.version, 1);
  assert.equal(
    otherDraft.answers.narrative,
    "Synthetic other clinician history",
  );
});
test("an existing admission is identified even when a stale draft version is supplied", async () => {
  const id = await patient(),
    a = await tx((q) => K.startAdmission(q, actor, id, admit(id)));
  const r = await post(
    `/patients/${id}/admissions`,
    admit(id, { draftVersion: 90 }),
  );
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "admission_open");
  assert.equal(r.body.details.contextId, a.id);
  assert.equal((await loadState(db, id)).contexts.length, 1);
});
test("narrative-only drafts save before note generation, preserve clears and retain their original clinical narrative", async () => {
  const id = await patient(),
    v = await visit(id, "Synthetic original narrative");
  const initial: any = await getVisitDraft(db, id, v.id);
  assert.equal(initial.narrative, "Synthetic original narrative");
  assert.equal(initial.evidenceKey, "");
  const body = {
    note: "",
    generatedNote: "",
    evidenceKey: "",
    narrative: "Synthetic edited at assessment",
  };
  const r = await post(`/patients/${id}/contexts/${v.id}/draft`, {
    ...body,
    version: 0,
  });
  assert.equal(r.status, 200);
  const restored: any = await getVisitDraft(db, id, v.id);
  assert.equal(restored.narrative, body.narrative);
  assert.equal(restored.originalNarrative, "Synthetic original narrative");
  assert.equal(
    (await loadState(db, id)).contexts[0].summary.narrative,
    "Synthetic original narrative",
  );
  const clear = await post(`/patients/${id}/contexts/${v.id}/draft`, {
    ...body,
    narrative: "",
    version: r.body.version,
  });
  assert.equal(clear.status, 200);
  assert.equal(((await getVisitDraft(db, id, v.id)) as any).narrative, "");
  const stale = await post(`/patients/${id}/contexts/${v.id}/draft`, {
    ...body,
    version: r.body.version,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "visit_draft_changed");
});
test("a closed visit returns its real state for both note and assessment drafts", async () => {
  const id = await patient(),
    v = await visit(id);
  await tx((q) =>
    K.closeVisit(q, actor, id, v.id, {
      draftVersion: 0,
      note: "Synthetic final note",
    }),
  );
  for (const suffix of [
    `contexts/${v.id}/draft`,
    `entry-draft/assessment:${v.id}`,
  ]) {
    const r = await fetch(base + `/patients/${id}/${suffix}`, {
      headers: { cookie },
    });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, "visit_closed");
  }
  const r = await post(`/patients/${id}/visits/${v.id}/assessment`, {
    draftVersion: 0,
    baseline: { sbp: null },
    items: [{ code: "sbp", value: 158 }],
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "visit_closed");
  assert.equal((await loadState(db, id)).observations.length, 0);
});
test("a stale note draft cannot overwrite newer narrative and explicit latest-version replacement remains possible", async () => {
  const id = await patient(),
    v = await visit(id),
    body = {
      note: "",
      narrative: "Synthetic first narrative",
      generatedNote: "",
      evidenceKey: "",
    };
  await tx((q) => saveVisitDraft(q, actor, id, v.id, { ...body, version: 0 }));
  await tx((q) =>
    saveVisitDraft(q, actor, id, v.id, {
      ...body,
      narrative: "Synthetic newer narrative",
      version: 1,
    }),
  );
  await assert.rejects(
    tx((q) =>
      saveVisitDraft(q, actor, id, v.id, {
        ...body,
        narrative: "Synthetic stale narrative",
        version: 1,
      }),
    ),
    (e: any) => e.code === "visit_draft_changed",
  );
  const current: any = await getVisitDraft(db, id, v.id);
  assert.equal(current.narrative, "Synthetic newer narrative");
  await tx((q) =>
    saveVisitDraft(q, actor, id, v.id, {
      ...body,
      narrative: "Synthetic deliberately retained narrative",
      version: current.version,
    }),
  );
  assert.equal(
    ((await getVisitDraft(db, id, v.id)) as any).narrative,
    "Synthetic deliberately retained narrative",
  );
});
test("duplicate assessment measurement codes are refused atomically", async () => {
  const id = await patient(),
    v = await visit(id),
    d = await draft(id, v);
  await assert.rejects(
    tx((q) =>
      confirmAssessment(q, actor, id, v.id, {
        draftVersion: 0,
        baseline: d.answers.baseline,
        items: [
          { code: "sbp", value: 148 },
          { code: "sbp", value: 158 },
        ],
      }),
    ),
    /only once/,
  );
  assert.equal((await loadState(db, id)).observations.length, 0);
});
