// HF Clinic Registry projection: registry fields filled from the record in the registry's own
// vocabulary and units; registry-only fields listed, never guessed; CSV row of filled fields.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot } from "../server/boot.js";
import { createApp } from "../server/app.js";
import { loadState } from "../server/kernel/state.js";
import { hfRegistryProjection } from "../server/engine/hf-registry.js";

let db: DB;
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const project = async (name: string) => { const id = await byName(name); return db.transaction(async (q) => hfRegistryProjection(await loadState(q, id))); };
const field = (p: any, key: string) => p.sections.flatMap((x: any) => x.fields).find((f: any) => f.key === key);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("Saad: registry vocabulary — HF type, cause, IHD, device, valves, GDMT, units", async () => {
  const p: any = await project("Saad Al-Otaibi");
  assert.equal(field(p, "HF_Type").value, "HFrEF");
  assert.equal(field(p, "HF_Cause").value, "ICM");
  assert.equal(field(p, "EF_Diagnosis").value, "25");
  assert.equal(field(p, "Echo_EF").value, "27");
  assert.equal(field(p, "ECG_LBBB").value, "Yes");
  assert.equal(field(p, "ECG_QRS").value, "158");
  assert.equal(field(p, "Valvular_Disease").value, "Yes");
  assert.equal(field(p, "Valvular_Type").value, "MR (secondary) severe");
  assert.equal(field(p, "PCI_CABG").value, "No");
  assert.equal(field(p, "Quad_GDMT").value, "Yes");
  assert.equal(field(p, "Recovered_LV").value, "No");
  assert.equal(field(p, "Mortality").value, "Alive");
  assert.equal(field(p, "Lab_BNP").value, "1850");
  assert.equal(field(p, "KCCQ").value, "66");
  // registry-only fields are listed, never filled
  assert.equal(field(p, "Edema").mapped, false);
  assert.equal(field(p, "Edema").value, null);
  assert.ok(p.counts.registryOnly > 10);
  assert.ok(p.counts.filled > 30 && p.counts.filled <= p.counts.mapped);
  // CSV: header of filled keys, one row
  const [head, row] = p.csv.split("\n");
  assert.equal(head.split(",").length, p.counts.filled);
  assert.ok(head.startsWith("Patient_Name,"));
  assert.ok(row.startsWith("Saad Al-Otaibi,"));
});

test("Huda: improved LVEF → HF_Type Others with the reason, Recovered_LV Yes, Quad_GDMT No after the stop", async () => {
  const p: any = await project("Huda Al-Sabah");
  assert.equal(field(p, "HF_Type").value, "Others");
  assert.match(field(p, "HF_Type").note, /improved LVEF/);
  assert.equal(field(p, "Recovered_LV").value, "Yes");
  assert.equal(field(p, "Quad_GDMT").value, "No");
  assert.equal(field(p, "HF_Cause").value, "Others");
  assert.match(field(p, "HF_Cause").note, /Tachycardia-induced/);
});

test("non-HF patients have no HF registry projection; the API says so", async () => {
  assert.equal(await project("Mariam Hussain"), null);
  const app = createApp(db);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const login = await fetch(base + "/demo-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const r1 = await (await fetch(`${base}/patients/${await byName("Mariam Hussain")}/registries/hf`, { headers: { cookie } })).json();
    assert.deepEqual(r1, { applicable: false });
    const r2 = await (await fetch(`${base}/patients/${await byName("Faisal Al-Mutairi")}/registries/hf`, { headers: { cookie } })).json();
    assert.equal(r2.registry, "MKH HF Clinic Registry");
    assert.equal(field(r2, "Inotropes_Used").value != null || field(r2, "Admissions").value != null, true);
  } finally {
    server.close();
  }
});
