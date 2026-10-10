import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp, type Session } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { draftNote } from "../server/kernel/notes.js";
let db: DB, server: Server, base: string;
let active = true;
const session: Session = { id: "encounter@example.test", email: "encounter@example.test", name: "Dr Encounter", role: "clinician", siteId: SITE_ID, csrf: "encounter-test", expires: Date.now() + 3600000 };
before(async () => {
  db = await createLocalDb(); await boot(db, { seed: false });
  server = createApp(db, { origin: "http://127.0.0.1", mount() {}, async authenticate() { return active ? session : null; }, async signOut() {} }).listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { await new Promise<void>(r => server.close(() => r())); await db.close(); });
const patient = (mrn: string) => db.transaction(q => K.createPatient(q, session, { name: "Synthetic encounter", mrn, sex: "Male", birthDate: "1960-01-01" }));
const post = (path: string, body: unknown, csrf = session.csrf) => fetch(base + "/api" + path, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });

test("confirmed admission narrative and vitals share a context; rejected readings roll back admission", async () => {
  const id = await patient("ENCOUNTER-ADMIT");
  const body = { startedAt: new Date().toISOString(), location: "CCU", reasons: ["Other"], narrative: "Reviewed admission history, no chest pain.", vitals: [{ code: "hr", value: 88 }] };
  const response = await post(`/patients/${id}/admissions`, body);
  assert.equal(response.status, 200);
  const result = await response.json();
  const observation = (await db.query("SELECT context_id, value_num FROM cf.observation WHERE patient_id=$1 AND code='hr'", [id])).rows[0];
  assert.equal(observation.context_id, result.id); assert.equal(Number(observation.value_num), 88);
  assert.ok((await db.transaction(q => draftNote(q, id, result.id))).text.includes(body.narrative));
  const rejected = await patient("ENCOUNTER-ROLLBACK");
  assert.equal((await post(`/patients/${rejected}/admissions`, { ...body, vitals: [{ code: "hr", value: -1 }] })).status, 400);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM cf.care_context WHERE patient_id=$1", [rejected])).rows[0].n, 0);
});
test("visit narrative survives draft and final note confirmation", async () => {
  const id = await patient("ENCOUNTER-VISIT");
  const response = await post(`/patients/${id}/visits`, { reasons: ["Routine cardiology"], service: "Cardiology clinic", narrative: "No chest pain. Review symptoms." });
  assert.equal(response.status, 200); const result = await response.json();
  assert.ok((await db.transaction(q => draftNote(q, id, result.id))).text.includes("No chest pain"));
  assert.equal((await post(`/patients/${id}/visits/${result.id}/close`, { note: "Reviewed final note", narrative: "Corrected narrative" })).status, 200);
  const row = (await db.query("SELECT summary FROM cf.care_context WHERE id=$1", [result.id])).rows[0];
  assert.equal(row.summary.narrative, "Corrected narrative"); assert.equal(row.summary.note, "Reviewed final note");
});

test("removed speech preview endpoint cannot extract or write fields", async () => {
  const id = await patient("ENCOUNTER-NO-SPEECH");
  assert.equal((await post(`/patients/${id}/dictation/preview`, { text: "Heart rate 88 bpm", mode: "visit" })).status, 404);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM cf.observation WHERE patient_id=$1", [id])).rows[0].n, 0);
});
