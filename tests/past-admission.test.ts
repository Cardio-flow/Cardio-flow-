import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp, type Session } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import {
  recordPastAdmission,
  editContext,
  removeContext,
} from "../server/kernel/context-management.js";
import { entryDraft } from "../server/kernel/visit-drafts.js";
import { loadState } from "../server/kernel/state.js";
import { draftNote } from "../server/kernel/notes.js";
import { historyView, summary, journey } from "../server/kernel/views.js";
import { emptyPastAdmission } from "../shared/admission-history.js";
import { RISK_FACTOR_CODES } from "../shared/history.js";
import { nowIso, today } from "../server/kernel/base.js";
let db: DB,
  server: any,
  base: string,
  adminToken = "",
  seq = 0;
const actor: Session = {
  id: "past@example.test",
  email: "past@example.test",
  name: "Synthetic history administrator",
  role: "admin",
  siteId: SITE_ID,
  csrf: "synthetic-past",
  expires: Date.now() + 3600000,
};
const tx = <T>(f: (q: any) => Promise<T>) => db.transaction(f);
const patient = () =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic past admission ${++seq}`,
      mrn: `PAST-${seq}`,
      sex: "Male",
      birthDate: "1960-01-01",
      synthetic: true,
    }),
  );
const history = (extra: any = {}) => ({
  ...emptyPastAdmission(),
  startedOn: "2025-03-01",
  endedOn: "2025-03-05",
  location: "Hospital A",
  reasons: ["Acute decompensated HF"],
  source: "Discharge summary",
  draftVersion: 0,
  ...extra,
});
const post = async (path: string, body: any, csrf = actor.csrf) => {
  const r = await fetch(base + "/api" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf, ...(adminToken ? { "x-admin-unlock": adminToken } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
  server = createApp(db, {
    origin: "http://127.0.0.1",
    mount() {},
    async authenticate() {
      return actor;
    },
    async signOut() {},
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await post("/admin/pin/set", { pin: "739204" })).status, 200);
  const unlocked = await post("/admin/pin/unlock", { pin: "739204" });
  assert.equal(unlocked.status, 200);
  adminToken = unlocked.body.token;
});
after(async () => {
  server.close();
  await db.close();
});
test("a past admission is closed and leaves the open encounter, current medicines, results and tasks intact", async () => {
  const id = await patient();
  const active = await tx((q) =>
    K.startAdmission(q, actor, id, {
      startedAt: nowIso(),
      location: "CCU",
      reasons: ["Other"],
    }),
  );
  await tx((q) =>
    K.startMedication(q, actor, id, {
      code: "atorvastatin",
      doseValue: 40,
      frequency: "OD",
      route: "PO",
      indication: "other",
      effectiveAt: nowIso(),
    }),
  );
  await tx((q) =>
    K.recordObservations(q, actor, id, {
      effectiveAt: nowIso(),
      items: [{ code: "potassium", value: 4.2 }],
    }),
  );
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "follow_up",
      title: "Current clinic review",
      dueDate: today(),
      completesOn: { type: "visit" },
    }),
  );
  const before = await loadState(db, id);
  const r = await post(
    `/patients/${id}/admissions/history`,
    history({
      location: "",
      events: ["IV diuretics"],
      note: "Historical discharge report",
      reportedLabs: "Potassium 3.1 in the old admission",
      reportedMedications: "Furosemide 80 mg BD at that discharge",
    }),
  );
  assert.equal(r.status, 200);
  const after = await loadState(db, id),
    old = after.contexts.find((c) => c.id === r.body.id)!;
  assert.equal(old.status, "closed");
  assert.equal(old.summary.historical, true);
  assert.equal(old.summary.dateOnly, true);
  assert.equal(old.location, null);
  assert.equal(after.contexts.find((c) => c.id === active.id)!.status, "open");
  assert.deepEqual(after.meds, before.meds);
  assert.deepEqual(after.observations, before.observations);
  assert.deepEqual(after.plan, before.plan);
  assert.equal(old.summary.los, 4);
  const oldEvents = (await journey(db, id)).events.filter(
    (e) => e.context_id === old.id,
  );
  assert.equal(oldEvents.length, 2);
  assert.ok(oldEvents.every((e) => e.dateOnly));
  assert.ok(oldEvents.every((e) => e.title.startsWith("Past admission")));
  assert.ok(
    oldEvents
      .find((e) => e.kind === "admission")
      ?.detail.includes("Source: Discharge summary"),
  );
  const note = await draftNote(db, id, old.id);
  assert.ok(
    note.text.includes("Historical discharge report") &&
      note.text.includes("Potassium 3.1") &&
      note.text.includes("Furosemide 80"),
  );
  assert.ok(
    !note.text.includes("Atorvastatin") &&
      !note.text.includes("4.2") &&
      !note.text.includes("Current clinic review"),
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM cf.clinical_event WHERE context_id=$1`,
        [old.id],
      )
    ).rows[0].n,
    2,
  );
});
test("out-of-order entry recalculates subsequent HF readmission relationships", async () => {
  const id = await patient();
  const later = await tx((q) =>
    recordPastAdmission(
      q,
      actor,
      id,
      history({ startedOn: "2025-03-20", endedOn: "2025-03-23" }),
    ),
  );
  const earlier = await tx((q) => recordPastAdmission(q, actor, id, history()));
  const s = await loadState(db, id),
    r: any = s.contexts.find((c) => c.id === later.id)!.summary.readmission;
  assert.equal(r.previousId, earlier.id);
  assert.equal(r.days, 15);
  assert.equal(r.hfReadmission, true);
});
test("future, reversed, impossible and pre-birth dates are rejected atomically", async () => {
  const id = await patient();
  for (const extra of [
    { startedOn: "2999-01-01", endedOn: "2999-01-02" },
    { startedOn: "2025-03-05", endedOn: "2025-03-01" },
    { startedOn: "2025-02-30" },
    { startedOn: "1959-01-01", endedOn: "1959-01-02" },
  ]) {
    const r = await post(`/patients/${id}/admissions/history`, history(extra));
    assert.equal(r.status, 400);
  }
  assert.equal((await loadState(db, id)).contexts.length, 0);
});
test("duplicate and overlapping admissions are refused while adjacent transfers are allowed", async () => {
  const id = await patient();
  await tx((q) => recordPastAdmission(q, actor, id, history()));
  await assert.rejects(
    tx((q) => recordPastAdmission(q, actor, id, history())),
    (e: any) => e.code === "admission_duplicate",
  );
  await assert.rejects(
    tx((q) => recordPastAdmission(q, actor, id, history({ location: "" }))),
    (e: any) => e.code === "admission_duplicate",
  );
  await assert.rejects(
    tx((q) =>
      recordPastAdmission(
        q,
        actor,
        id,
        history({ startedOn: "2025-03-03", endedOn: "2025-03-08" }),
      ),
    ),
    (e: any) => e.code === "admission_overlap",
  );
  await tx((q) =>
    recordPastAdmission(
      q,
      actor,
      id,
      history({
        startedOn: "2025-03-05",
        endedOn: "2025-03-07",
        location: "Hospital B",
      }),
    ),
  );
  assert.equal((await loadState(db, id)).contexts.length, 2);
});
test("older admissions can be added to deceased patients but cannot extend after recorded death", async () => {
  const id = await patient();
  await tx((q) =>
    K.recordStatus(q, actor, id, {
      kind: "vital",
      status: "died",
      effectiveOn: "2025-06-01",
      causeGroup: "unknown",
    }),
  );
  await tx((q) => recordPastAdmission(q, actor, id, history()));
  await assert.rejects(
    tx((q) =>
      recordPastAdmission(
        q,
        actor,
        id,
        history({ startedOn: "2025-07-01", endedOn: "2025-07-02" }),
      ),
    ),
    /after the recorded date of death/,
  );
  assert.equal((await loadState(db, id)).status.vital?.status, "died");
});
test("a large pasted discharge report restores and stale confirmation preserves the newer draft", async () => {
  const id = await patient(),
    answers = history({ note: "Synthetic historical report\n".repeat(1500) });
  const { draftVersion, ...form } = answers;
  assert.ok(form.note.length > 16000);
  const saved = await post(`/patients/${id}/entry-draft/past-admission`, {
    version: 0,
    answers: form,
  });
  assert.equal(saved.status, 200);
  const stale = await post(`/patients/${id}/admissions/history`, {
    ...form,
    draftVersion: 0,
  });
  assert.equal(stale.status, 409);
  const restored: any = await entryDraft(db, actor, id, "past-admission");
  assert.equal(restored.answers.note, form.note);
  assert.equal((await loadState(db, id)).contexts.length, 0);
  const confirm = await post(`/patients/${id}/admissions/history`, {
    ...form,
    draftVersion: restored.version,
  });
  assert.equal(confirm.status, 200);
  assert.equal((await entryDraft(db, actor, id, "past-admission")).version, 0);
});
test("historical reports can be corrected and removed without changing clinical facts", async () => {
  const id = await patient(),
    r = await tx((q) =>
      recordPastAdmission(
        q,
        actor,
        id,
        history({
          reportedLabs: "Old lab report",
          reportedMedications: "Old medicine report",
        }),
      ),
    );
  let c = (await loadState(db, id)).contexts[0];
  await tx((q) =>
    editContext(q, actor, id, r.id, {
      version: c.version,
      reason: "Corrected source transcription",
      startedAt: c.started_at,
      endedAt: c.ended_at,
      location: "",
      service: c.service!,
      reasons: c.reasons,
      symptoms: [],
      narrative: "",
      note: "Updated discharge",
      events: [],
      reportedLabs: "Corrected old labs",
      reportedMedications: "Corrected old medicines",
    }),
  );
  c = (await loadState(db, id)).contexts[0];
  assert.equal(c.location, "Hospital A");
  assert.equal(c.summary.reportedLabs, "Corrected old labs");
  assert.equal(c.summary.reportedMedications, "Corrected old medicines");
  assert.equal((await loadState(db, id)).observations.length, 0);
  await tx((q) =>
    removeContext(q, actor, id, r.id, {
      version: c.version,
      reason: "Duplicate source document",
    }),
  );
  assert.equal((await loadState(db, id)).contexts.length, 0);
});
test("history date corrections cannot create an overlap", async () => {
  const id = await patient();
  await tx((q) => recordPastAdmission(q, actor, id, history()));
  const r = await tx((q) =>
    recordPastAdmission(
      q,
      actor,
      id,
      history({ startedOn: "2025-04-01", endedOn: "2025-04-05" }),
    ),
  );
  const c = (await loadState(db, id)).contexts.find((c) => c.id === r.id)!;
  await assert.rejects(
    tx((q) =>
      editContext(q, actor, id, r.id, {
        version: c.version,
        reason: "Wrong dates",
        startedAt: "2025-03-03T00:00:00+03:00",
        endedAt: "2025-03-08T00:00:00+03:00",
        location: c.location!,
        service: c.service!,
        reasons: c.reasons,
        symptoms: [],
        narrative: "",
        note: "",
      }),
    ),
    (e: any) => e.code === "admission_overlap",
  );
  assert.equal(
    (await loadState(db, id)).contexts.find((c) => c.id === r.id)!.started_at,
    c.started_at,
  );
});
test("anaemia is an other comorbidity and stays out of the cardiovascular risk-factor row", async () => {
  const id = await patient();
  await tx((q) => K.addCondition(q, actor, id, { code: "anaemia" }));
  const s = await loadState(db, id),
    h = historyView(s),
    view = await summary(db, id, "sandbox");
  assert.equal(RISK_FACTOR_CODES.has("anaemia"), false);
  assert.ok(h.comorbidities.some((c: any) => c.code === "anaemia"));
  assert.ok(
    view.header.diagnoses.some(
      (c: any) => c.code === "anaemia" && !c.riskFactor,
    ),
  );
});
