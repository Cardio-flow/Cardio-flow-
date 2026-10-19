import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot } from "../server/boot.js";
import { createApp } from "../server/app.js";

let db: DB;
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let base: string;
let adminCookie = "", adminCsrf = "", clinicianCookie = "", clinicianCsrf = "";

async function signIn(email: string) {
  const r = await fetch(`${base}/demo-session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  return { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: (await r.json()).csrf as string };
}
async function call(path: string, options: { method?: string; body?: unknown; token?: string; clinician?: boolean } = {}) {
  const r = await fetch(base + path, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", cookie: options.clinician ? clinicianCookie : adminCookie,
      "x-csrf-token": options.clinician ? clinicianCsrf : adminCsrf,
      ...(options.token ? { "x-admin-unlock": options.token } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  ({ cookie: adminCookie, csrf: adminCsrf } = await signIn("admin@cardioflow.local"));
  ({ cookie: clinicianCookie, csrf: clinicianCsrf } = await signIn("dr.ahmed@cardioflow.local"));
});
after(async () => { server.close(); await db.close(); });

test("admin PIN protects combined real and synthetic patient management", async () => {
  const real = await call("/patients", { method: "POST", body: { name: "Real Test", mrn: "A-1", sex: "Female", birthDate: "1960-01-01" } });
  const sample = await call("/patients", { method: "POST", body: { name: "Synthetic Test", mrn: "B-1", sex: "Male", birthDate: "1970-01-01", sample: true } });
  assert.equal(real.status, 201);
  assert.equal(sample.status, 201);
  assert.equal((await call("/admin/pin/status", { clinician: true })).status, 403);
  assert.equal((await call("/admin/patients")).status, 403);
  assert.equal((await call("/admin/pin/status")).body.configured, false);
  assert.equal((await call("/admin/pin/set", { method: "POST", body: { pin: "12345" } })).status, 400);
  assert.equal((await call("/admin/pin/set", { method: "POST", body: { pin: "739204" } })).status, 200);
  assert.equal((await call("/admin/pin/set", { method: "POST", body: { pin: "900123" } })).status, 403);
  assert.equal((await call("/admin/pin/unlock", { method: "POST", body: { pin: "000000" } })).status, 403);
  const unlock = await call("/admin/pin/unlock", { method: "POST", body: { pin: "739204" } });
  assert.equal(unlock.status, 200);
  const token = unlock.body.token as string;
  const rows = await call("/admin/patients", { token });
  assert.equal(rows.status, 200);
  assert.deepEqual(rows.body.rows.map((p: any) => p.sample), [false, true]);
  assert.equal((await call("/admin/patients?group=sample", { token })).body.rows.length, 1);
  assert.equal((await call("/admin/patients?group=real", { token })).body.rows.length, 1);
  assert.equal((await call("/admin/patients", { token: token + "0" })).status, 403);
  assert.equal((await call("/admin/patients", { token, clinician: true })).status, 403);
  assert.equal((await call(`/admin/patients/${real.body.id}/identity`, { method: "POST", body: { name: "Changed" } })).status, 403);
  assert.equal((await call(`/admin/patients/${real.body.id}/identity`, { method: "POST", body: { name: "Changed" }, token })).status, 200);
  assert.equal((await call(`/admin/patients/${sample.body.id}/remove`, { method: "POST", body: { reason: "Test or practice record" }, token })).status, 200);
  assert.deepEqual((await call("/admin/patients", { token })).body.rows.map((p: any) => p.name), ["Changed"]);
  assert.equal((await call("/admin/pin/set", { method: "POST", body: { pin: "684391" }, token })).status, 200);
  assert.equal((await call("/admin/patients", { token })).status, 403, "rotating the PIN revokes old unlocks");
  for (let i = 0; i < 5; i++) assert.equal((await call("/admin/pin/unlock", { method: "POST", body: { pin: "000000" } })).status, 403);
  assert.equal((await call("/admin/pin/unlock", { method: "POST", body: { pin: "684391" } })).status, 429, "a correct PIN cannot bypass the temporary lockout");
});
