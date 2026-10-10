import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { suggestDictation } from "../shared/dictation.js";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp, type Session } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { draftNote } from "../server/kernel/notes.js";

test("labelled clauses retain source text and units without interpreting medication instructions", () => {
  const text = "Reason: Heart failure. Symptoms: Dyspnoea, Leg swelling. Blood pressure 110 over 70 mmHg. Heart rate 88 bpm. Weight 80.5 kg. Stop bisoprolol 5 mg.";
  const result = suggestDictation(text, "visit");
  assert.deepEqual(result.suggestions.map(s => [s.code, s.value]), [["Heart failure", "Heart failure"], ["Dyspnoea", "Dyspnoea"], ["Leg swelling", "Leg swelling"], ["sbp", "110"], ["dbp", "70"], ["hr", "88"], ["weight", "80.5"]]);
  assert.ok(result.suggestions.every(s => text.includes(s.source)));
});
test("historical, negative, ambiguous, unitless and unsupported phrases are not structured values", () => {
  for (const text of ["No chest pain. No breathlessness.", "Yesterday. BP 110 over 70 mmHg.", "Heart rate eighty eight bpm.", "Blood pressure 110 over 70.", "Weight 150 pounds.", "Maybe. Weight 80 kg.", "Start ramipril fifteen mg.", "المريض يعاني من ضيق التنفس"]) {
    assert.deepEqual(suggestDictation(text, "visit").suggestions, [], text);
  }
});
test("conflicting readings and No symptoms with positive symptoms are withheld", () => {
  const result = suggestDictation("Heart rate 88 bpm. Heart rate 95 bpm. Symptoms: No symptoms, Dyspnoea.", "visit");
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.warnings.length, 2);
});
test("reasons respect encounter vocabulary and repeated readings are deduplicated", () => {
  assert.equal(suggestDictation("Reason: Acute decompensated HF.", "visit").suggestions.length, 0);
  assert.equal(suggestDictation("Reason: Acute decompensated HF.", "admission").suggestions[0].value, "Acute decompensated HF");
  assert.equal(suggestDictation("Heart rate 88 bpm. Heart rate 88 bpm.", "visit").suggestions.length, 1);
});
test("natural English cardiology phrasing maps only supported concepts with explicit units", () => {
  const result = suggestDictation("Here for heart failure follow-up. Patient has breathlessness and ankle swelling. BP is 110 over 70 mmHg. Heart rate is 88 bpm. Weight is 80 kg.", "visit");
  assert.deepEqual(result.suggestions.map(s => s.code), ["Heart failure", "Dyspnoea", "Leg swelling", "sbp", "dbp", "hr", "weight"]);
  assert.equal(suggestDictation("Admitted for acute decompensated heart failure.", "admission").suggestions[0].value, "Acute decompensated HF");
});
test("focused review flags negation, missing units, medication instructions and relative dates", () => {
  const result = suggestDictation("No chest pain. BP 110 over 70. Stop bisoprolol 5 mg. Repeat potassium tomorrow.", "visit");
  assert.deepEqual(result.suggestions, []);
  for (const group of ["Meaning", "Vitals", "Medicines", "Dates", "Labs"]) assert.ok(result.issues.some(i => i.group === group), group);
  assert.ok(result.sections.some(s => s.title === "Plan"));
  assert.ok(result.issues.every(i => i.source));
});
test("negation in a symptom list withholds the entire ambiguous list and headings invent no findings", () => {
  assert.deepEqual(suggestDictation("Symptoms: no breathlessness and chest pain.", "visit").suggestions, []);
  assert.deepEqual(suggestDictation("History:\nSymptoms:\nExamination:\nVitals:\nPlan:", "visit").suggestions, []);
  assert.equal(suggestDictation("History:\nHeart rate 88 bpm.", "visit").suggestions[0].value, "88");
});

let db: DB, server: Server, base: string;
let active = true;
const session: Session = { id: "dictation@example.test", email: "dictation@example.test", name: "Dr Dictation", role: "clinician", siteId: SITE_ID, csrf: "dictation-test", expires: Date.now() + 3600000 };
before(async () => {
  db = await createLocalDb(); await boot(db, { seed: false });
  server = createApp(db, { origin: "http://127.0.0.1", mount() {}, async authenticate() { return active ? session : null; }, async signOut() {} }).listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { await new Promise<void>(r => server.close(() => r())); await db.close(); });
const patient = (mrn: string) => db.transaction(q => K.createPatient(q, session, { name: "Synthetic dictation", mrn, sex: "Male", birthDate: "1960-01-01" }));
const post = (path: string, body: unknown, csrf = session.csrf) => fetch(base + "/api" + path, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });

test("preview is site-scoped, authenticated, CSRF-protected, bounded and does not persist", async () => {
  const id = await patient("DICT-PREVIEW");
  const body = { mode: "visit", text: "Heart rate 88 bpm." };
  active = false;
  assert.equal((await post(`/patients/${id}/dictation/preview`, body)).status, 401);
  active = true;
  assert.equal((await post(`/patients/${id}/dictation/preview`, body, "wrong")).status, 403);
  assert.equal((await post(`/patients/${id}/dictation/preview`, { ...body, text: "x".repeat(4001) })).status, 400);
  await db.query("INSERT INTO cf.site(id,name,mode) VALUES('dictation-foreign','Synthetic foreign','sandbox')");
  const foreign = await db.transaction(q => K.createPatient(q, { ...session, siteId: "dictation-foreign" }, { name: "Synthetic foreign", mrn: "DICT-FOREIGN", sex: "Male", birthDate: "1960-01-01" }));
  assert.equal((await post(`/patients/${foreign}/dictation/preview`, body)).status, 404);
  const result = await post(`/patients/${id}/dictation/preview`, body);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).suggestions[0].value, "88");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM cf.observation WHERE patient_id=$1", [id])).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM cf.care_context WHERE patient_id=$1", [id])).rows[0].n, 0);
});
test("confirmed admission narrative and vitals share a context; rejected readings roll back admission", async () => {
  const id = await patient("DICT-ADMIT");
  const body = { startedAt: new Date().toISOString(), location: "CCU", reasons: ["Other"], narrative: "Reviewed admission history, no chest pain.", vitals: [{ code: "hr", value: 88 }] };
  const response = await post(`/patients/${id}/admissions`, body);
  assert.equal(response.status, 200);
  const result = await response.json();
  const observation = (await db.query("SELECT context_id, value_num FROM cf.observation WHERE patient_id=$1 AND code='hr'", [id])).rows[0];
  assert.equal(observation.context_id, result.id); assert.equal(Number(observation.value_num), 88);
  assert.ok((await db.transaction(q => draftNote(q, id, result.id))).text.includes(body.narrative));
  const rejected = await patient("DICT-ROLLBACK");
  assert.equal((await post(`/patients/${rejected}/admissions`, { ...body, vitals: [{ code: "hr", value: -1 }] })).status, 400);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM cf.care_context WHERE patient_id=$1", [rejected])).rows[0].n, 0);
});
test("visit narrative survives draft and final note confirmation", async () => {
  const id = await patient("DICT-VISIT");
  const response = await post(`/patients/${id}/visits`, { reasons: ["Routine cardiology"], service: "Cardiology clinic", narrative: "No chest pain. Review symptoms." });
  assert.equal(response.status, 200); const result = await response.json();
  assert.ok((await db.transaction(q => draftNote(q, id, result.id))).text.includes("No chest pain"));
  assert.equal((await post(`/patients/${id}/visits/${result.id}/close`, { note: "Reviewed final note", narrative: "Corrected narrative" })).status, 200);
  const row = (await db.query("SELECT summary FROM cf.care_context WHERE id=$1", [result.id])).rows[0];
  assert.equal(row.summary.narrative, "Corrected narrative"); assert.equal(row.summary.note, "Reviewed final note");
});
