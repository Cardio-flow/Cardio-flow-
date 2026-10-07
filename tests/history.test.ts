// General-clinic core, slice 1: migration 002, registration details, structured history,
// and the rules that now read structured valve/device history.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { historyView, header } from "../server/kernel/views.js";
import { reassess } from "../server/engine/engine.js";
import { nowIso, today, uuid, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const iso = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
async function newPatient(conditions: string[] = [], extra: Record<string, string> = {}) {
  return tx((q) => K.createPatient(q, doc, { name: "Hx " + rnd(), mrn: "H" + rnd() + Date.now(), sex: "Male", birthDate: "1960-05-01", conditions, ...extra }));
}
const view = async (pid: string) => historyView(await loadState(db, pid));
const item = async (pid: string, key: string) => (await view(pid)).items.find((i) => i.key === key)!;
const active = async (pid: string) =>
  (await db.query(`SELECT rule_id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("migration 002 is applied once, recorded, and the status history is append-only", async () => {
  const names = (await db.query(`SELECT name FROM cf.migration ORDER BY name`)).rows.map((r: any) => r.name);
  assert.deepEqual(names, ["v2-001-kernel", "v2-002-general-core", "v2-003-medication-exceptions", "v2-004-episodes", "v2-005-procedures", "v2-006-sample-patients", "v2-007-patient-removal"]);
  const pid = await newPatient();
  const id = uuid();
  await db.query(`INSERT INTO cf.status_event(id,patient_id,kind,status,effective_on,recorded_by) VALUES($1,$2,'vital','alive',$3,'t')`, [id, pid, T]);
  await assert.rejects(db.query(`UPDATE cf.status_event SET status='died' WHERE id=$1`, [id]), /append-only/);
  await assert.rejects(db.query(`INSERT INTO cf.status_event(id,patient_id,kind,status,effective_on,recorded_by) VALUES($1,$2,'vital','lost',$3,'t')`, [uuid(), pid, T]));
  await assert.rejects(db.query(`INSERT INTO cf.study(id,patient_id,kind,performed_at,quality,recorded_by) VALUES($1,$2,'xray',now(),'formal','t')`, [uuid(), pid]));
  await db.query(`INSERT INTO cf.study(id,patient_id,kind,performed_at,quality,recorded_by,attributes) VALUES($1,$2,'holter',now(),'formal','t','{"af_burden":"none"}')`, [uuid(), pid]);
});

test("registration: civil ID is unique per site and identity changes are audited", async () => {
  const civil = "2" + String(Date.now()).slice(-11);
  const pid = await newPatient([], { civilId: civil, nationality: "Kuwaiti", mobile: "+965 5000 0000" });
  await assert.rejects(newPatient([], { civilId: civil }), /already registered/);
  await tx((q) => K.updateIdentity(q, doc, pid, { mobile: "+965 6000 0000", allergies: "Penicillin (rash)" }));
  const s = await loadState(db, pid);
  assert.equal(s.patient.civil_id, civil);
  assert.equal(s.patient.mobile, "+965 6000 0000");
  assert.equal(s.patient.allergies, "Penicillin (rash)");
  const a = (await db.query(`SELECT detail FROM cf.audit WHERE entity_id=$1 AND action='update-identity'`, [pid])).rows[0] as any;
  const detail = typeof a.detail === "string" ? JSON.parse(a.detail) : a.detail;
  assert.deepEqual(detail.fields.sort(), ["allergies", "mobile"]);
  assert.equal(detail.before.mobile, "+965 5000 0000");
});

test("history: nothing recorded is shown as not recorded, never as no", async () => {
  const pid = await newPatient();
  const v = await view(pid);
  assert.ok(v.items.every((i) => i.status === "not-recorded"));
  assert.ok(v.missing.includes("Smoking"));
  const h = header(await loadState(db, pid));
  assert.equal(h.riskFactors.present.length, 0);
  assert.ok(h.riskFactors.notRecorded.includes("Smoker"));
});

test("history: dated statuses, explicit no/unknown, and diagnoses with structured detail", async () => {
  const pid = await newPatient(["htn"]);
  await tx((q) =>
    K.recordHistory(q, doc, pid, {
      effectiveAt: iso(addDays(T, -1)),
      answers: [
        { item: "smoking", answer: "ex", packYears: 20, quitYear: 2015 },
        { item: "diabetes", answer: "no" },
        { item: "fhx-cad", answer: "unknown" },
      ],
      add: [
        { code: "prior-mi", onsetYear: 2019, attributes: { type: "STEMI" } },
        { code: "prior-pci", onset: "2019-03-02", attributes: { vessels: ["LAD", "RCA"] } },
      ],
    }),
  );
  assert.equal((await item(pid, "smoking")).text, "Ex-smoker · 20 pack-years · stopped 2015");
  assert.equal((await item(pid, "smoking")).status, "present");
  assert.equal((await item(pid, "diabetes")).status, "absent");
  assert.equal((await item(pid, "fhx-cad")).status, "unknown");
  assert.equal((await item(pid, "hypertension")).status, "present");
  const cor = await item(pid, "coronary");
  assert.equal(cor.status, "present");
  assert.match(cor.text, /Previous MI · STEMI/);
  assert.match(cor.text, /LAD, RCA/);
  assert.equal(cor.conditions.find((c) => c.code === "prior-mi")!.onsetYear, 2019);
  // a later status supersedes, history kept
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), answers: [{ item: "smoking", answer: "current", packYears: 22 }] }));
  assert.match((await item(pid, "smoking")).text, /^Current smoker/);
  const rows = (await db.query(`SELECT count(*)::int n FROM cf.observation WHERE patient_id=$1 AND code='hx.smoking'`, [pid])).rows[0] as any;
  assert.equal(rows.n, 2);
  const rf = header(await loadState(db, pid)).riskFactors;
  assert.deepEqual(rf.present.map((p) => p.label).sort(), ["Current smoker", "Hypertension"]);
  assert.ok(rf.present.every((p) => p.major));
});

test("history: 'no' cannot silently contradict an active diagnosis", async () => {
  const pid = await newPatient(["t2dm"]);
  await assert.rejects(tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), answers: [{ item: "diabetes", answer: "no" }] })), /on the diagnosis list/);
  await assert.rejects(tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), answers: [{ item: "diabetes", answer: "unknown", resolveAs: "resolved" }] })), /on the diagnosis list/);
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), answers: [{ item: "diabetes", answer: "no", resolveAs: "entered_in_error" }] }));
  const s = await loadState(db, pid);
  assert.equal(s.conditions.some((c) => c.code === "t2dm"), false);
  assert.equal((await item(pid, "diabetes")).status, "absent");
  const versions = (await db.query(`SELECT status FROM cf.condition WHERE patient_id=$1 ORDER BY version`, [pid])).rows.map((r: any) => r.status);
  assert.deepEqual(versions, ["active", "entered_in_error"]);
});

test("history: detail must come from the catalogue; a legacy smoker diagnosis is reconciled", async () => {
  const pid = await newPatient(["smoker"]);
  assert.match((await item(pid, "smoking")).conflict ?? "", /confirm the smoking status/);
  await assert.rejects(
    tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prior-mi", attributes: { type: "Big one" } }] })),
    /choose from the list/,
  );
  await assert.rejects(tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prior-mi", onset: addDays(T, 5) }] })), /future/);
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), answers: [{ item: "smoking", answer: "never" }] }));
  const sm = await item(pid, "smoking");
  assert.equal(sm.status, "absent");
  assert.equal(sm.conflict, null);
  assert.equal((await loadState(db, pid)).conditions.some((c) => c.code === "smoker"), false);
});

test("history: updating a diagnosis' detail adds a version; two prostheses can coexist", async () => {
  const pid = await newPatient();
  await tx((q) =>
    K.recordHistory(q, doc, pid, {
      effectiveAt: nowIso(),
      add: [
        { code: "prosthetic-valve", onsetYear: 2012, attributes: { position: "Mitral", type: "Mechanical" } },
        { code: "prosthetic-valve", onsetYear: 2021, attributes: { position: "Aortic", type: "TAVI" } },
      ],
    }),
  );
  const v = await item(pid, "valve");
  assert.equal(v.conditions.length, 2);
  assert.match(v.text, /Mitral mechanical valve/);
  assert.match(v.text, /Aortic TAVI/);
  const tavi = v.conditions.find((c) => c.attributes.type === "TAVI")!;
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), update: [{ logicalId: tavi.id, onset: "2021-06-10", attributes: { position: "Aortic", type: "TAVI" } }] }));
  const again = (await item(pid, "valve")).conditions.find((c) => c.id === tavi.id)!;
  assert.equal(again.onset, "2021-06-10");
  assert.equal(again.onsetYear, null);
});

test("rules read structured history: mechanical valve blocks DOACs; an existing ICD silences the device prompt", async () => {
  // AF + mechanical valve on apixaban → red safety alert (rule in clinical review, sandbox)
  const pid = await newPatient(["af", "htn"]);
  await tx(async (q) => {
    await K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prosthetic-valve", attributes: { position: "Mitral", type: "Mechanical" } }] });
    await K.startMedication(q, doc, pid, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: nowIso() });
    await reassess(q, pid, "sandbox");
  });
  const recs = await active(pid);
  const doac = recs.find((r) => r.rule_id === "valve.doac-contraindicated");
  assert.ok(doac, "DOAC contraindication raised");
  assert.equal(doac.severity, "red");
  assert.match(doac.title, /mechanical valve/);

  // same history without an anticoagulant → the AF rule proposes warfarin, not a DOAC
  const p2 = await newPatient(["af", "htn"]);
  await tx(async (q) => {
    await K.recordHistory(q, doc, p2, { effectiveAt: nowIso(), add: [{ code: "prosthetic-valve", attributes: { position: "Aortic", type: "Mechanical" } }] });
    await reassess(q, p2, "sandbox");
  });
  const af = (await active(p2)).find((r) => r.rule_id === "af.anticoagulation");
  const action = typeof af.action === "string" ? JSON.parse(af.action) : af.action;
  assert.equal(action.code, "warfarin");

  // HF with LVEF ≤35%: device prompt, gone once an ICD is recorded in the history
  const p3 = await newPatient(["hfref"]);
  await tx(async (q) => {
    await K.recordEcho(q, doc, p3, { date: nowIso(), quality: "formal", lvef: 28, findings: [] });
    await reassess(q, p3, "sandbox");
  });
  assert.ok((await active(p3)).some((r) => r.rule_id === "hf.device-assessment"));
  await tx(async (q) => {
    await K.recordHistory(q, doc, p3, { effectiveAt: nowIso(), add: [{ code: "cied", onsetYear: 2023, attributes: { type: "ICD" } }] });
    await reassess(q, p3, "sandbox", ["conditions"]);
  });
  assert.equal((await active(p3)).some((r) => r.rule_id === "hf.device-assessment"), false);
});

test("API: history and identity routes validate, save and return the view", async () => {
  const app = createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const login = await fetch(base + "/demo-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const { csrf } = await login.json();
    const h = { cookie, "content-type": "application/json", "x-csrf-token": csrf };
    const pid = await newPatient();
    const post = (path: string, body: unknown) => fetch(`${base}/patients/${pid}/${path}`, { method: "POST", headers: h, body: JSON.stringify(body) });
    assert.equal((await post("history", {})).status, 400);
    assert.equal((await post("identity", { civilId: "12345" })).status, 400);
    assert.equal((await post("identity", { civilId: "289010100123", nationality: "Kuwaiti" })).status, 200);
    const ok = await post("history", { answers: [{ item: "alcohol", answer: "never" }, { item: "hypertension", answer: "no" }], add: [{ code: "cied", attributes: { type: "Pacemaker" }, onsetYear: 2020 }] });
    assert.equal(ok.status, 200);
    const got = await (await fetch(`${base}/patients/${pid}/history`, { headers: { cookie } })).json();
    assert.equal(got.identity.civilId, "289010100123");
    assert.equal(got.items.find((i: any) => i.key === "alcohol").status, "absent");
    assert.equal(got.items.find((i: any) => i.key === "device").text, "Pacemaker");
    const search = await (await fetch(`${base}/patients?q=289010100123`, { headers: { cookie } })).json();
    assert.equal(search[0].id, pid);
  } finally {
    server.close();
  }
});
