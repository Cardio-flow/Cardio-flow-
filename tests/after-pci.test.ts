// After PCI next-steps sheet (redesign slice 3): defaults from the record, the timeline, and one write.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { pciContext } from "../server/engine/after-pci.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { defaultChoice, extras, phases } from "../shared/after-pci.js";
import { cleanProcedure, procedureSummary } from "../shared/procedures.js";

let db: DB, base = "", server: any, cookie = "", csrf = "";
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie, "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (r.status !== 200) throw new Error(`${r.status} ${j.error}`);
  return j;
};
const active = async (pid: string) => (await db.query(`SELECT rule_id FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows.map((r: any) => r.rule_id);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = await fetch(base + "/demo-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  csrf = (await login.json()).csrf;
});
after(async () => (server.close(), db.close()));

async function pciPatient(setting: string, extra: (q: any, pid: string) => Promise<void> = async () => {}, details: Record<string, unknown> = {}) {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Pci " + rnd(), mrn: "P" + rnd() + Date.now(), sex: "Male", birthDate: "1962-01-01", conditions: ["cad-ccs"] }));
  await tx(async (q) => {
    await extra(q, pid);
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "haemoglobin", value: 14 }, { code: "creatinine", value: 85 }, { code: "weight", value: 80 }] });
    await K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -1)), details: { setting, vessels: ["LAD"], devices: ["Drug-eluting stent"], stents: 1, access: "Radial", ...details } });
    await reassess(q, pid, "sandbox");
  });
  return pid;
}

test("PCI record: DES and DCB in one procedure, ≥3 stents makes it complex, complications in the summary", () => {
  const p = cleanProcedure("pci", { setting: "elective", vessels: ["LAD", "LCx"], devices: ["Drug-coated balloon", "Drug-eluting stent"], stents: 3, dcb: 1, complications: ["No-reflow / slow flow"] });
  assert.deepEqual(p.devices, ["Drug-eluting stent", "Drug-coated balloon"]);
  assert.equal((p as any).device, "Drug-eluting stent");
  assert.ok(((p as any).complex as string[]).includes("≥3 stents"));
  assert.equal(procedureSummary("pci", p as any), "LAD, LCx DES ×3 + DCB ×1 · Elective (chronic coronary syndrome) · complex PCI · complication: no-reflow / slow flow");
  assert.equal((cleanProcedure("pci", { setting: "elective", vessels: ["RCA"], device: "Balloon only" }) as any).devices[0], "Balloon only", "older single-device records still read");
});

test("ACS PCI with nothing started: ticagrelor + aspirin, 12-month DAPT, stop linked to ticagrelor; the stop-dates card closes", async () => {
  const pid = await pciPatient("nste-acs");
  const c = (await call("GET", `/patients/${pid}/after-pci`)).context;
  assert.equal(c.pci.acs, true);
  const ch = defaultChoice(c);
  assert.deepEqual([ch.regimen, ch.p2y12, ch.dapt], ["dapt", "ticagrelor", "12m"]);
  const ph = phases(c, ch);
  assert.equal(ph[0].to, addDays(addDays(T, -1), 365));
  assert.deepEqual(extras(c, ch).filter((e) => e.on).map((e) => e.id), ["statin", "rehab", "echo"]);
  await call("POST", `/patients/${pid}/after-pci`, { regimen: "dapt", p2y12: "ticagrelor", aspirinDose: 100, stops: ph.filter((p) => p.stop).map((p) => ({ target: p.stop!.target, title: p.stop!.title, dueDate: p.to })), extras: ["statin", "rehab"] });
  const s = await loadState(db, pid);
  const tic = s.meds.find((m) => m.code === "ticagrelor")!;
  assert.equal(tic.doseValue, 90);
  assert.ok(s.meds.some((m) => m.code === "aspirin" && m.doseValue === 100));
  assert.ok(s.meds.some((m) => m.code === "atorvastatin" && m.doseValue === 80));
  const stop = s.plan.find((p) => p.medication_id === tic.id)!;
  assert.equal(stop.due_date, addDays(addDays(T, -1), 365));
  assert.match(stop.title, /End of 12-month DAPT: stop ticagrelor, continue aspirin/);
  assert.ok(s.plan.some((p) => p.title === "Cardiac rehabilitation referral"));
  assert.ok(s.plan.some((p) => /LDL/i.test(p.title) || p.title.startsWith("LDL-C")), "LDL-C booked after the statin start");
  assert.ok(!(await active(pid)).includes("cad.antithrombotic-plan"));
});

test("PCI on apixaban with ticagrelor: clopidogrel only; ticagrelor switched; triple 1 week then dual to 6 months (HBR: long-term OAC)", async () => {
  const pid = await pciPatient("elective", async (q, p) => {
    await K.startMedication(q, doc, p, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(addDays(T, -200)) });
    await K.startMedication(q, doc, p, { code: "ticagrelor", doseValue: 90, frequency: "BID", route: "PO", indication: "cad", effectiveAt: at(addDays(T, -1)) });
  });
  const c = pciContext(await loadState(db, pid))!;
  const ch = defaultChoice(c);
  assert.deepEqual([ch.regimen, ch.p2y12, ch.tat, ch.dual], ["oac", "clopidogrel", "1w", "6m"]);
  await assert.rejects(call("POST", `/patients/${pid}/after-pci`, { regimen: "oac", p2y12: "ticagrelor", aspirinDose: 100, stops: [], extras: [] }), /409 With an anticoagulant, clopidogrel/);
  const ph = phases(c, ch, { triple: addDays(T, 10) });
  assert.equal(ph[1].from, addDays(T, 10), "a moved end date moves the next phase");
  await call("POST", `/patients/${pid}/after-pci`, { regimen: "oac", p2y12: "clopidogrel", aspirinDose: 100, stops: ph.filter((p) => p.stop).map((p) => ({ target: p.stop!.target, title: p.stop!.title, dueDate: p.to })), extras: ["ppi"] });
  const s = await loadState(db, pid);
  assert.equal(s.meds.find((m) => m.code === "ticagrelor")!.status, "stopped");
  const clop = s.meds.find((m) => m.code === "clopidogrel" && m.status === "active")!;
  const asp = s.meds.find((m) => m.code === "aspirin" && m.status === "active")!;
  assert.equal(s.plan.find((p) => p.medication_id === asp.id)!.due_date, addDays(T, 10));
  assert.equal(s.plan.find((p) => p.medication_id === clop.id)!.due_date, addDays(addDays(T, -1), 182));
  assert.ok(s.meds.some((m) => m.code === "pantoprazole"));
});

test("echo through the API: LVEF alone, or a few valves and measures, is accepted (only LVEF is required)", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Echo " + rnd(), mrn: "E" + rnd() + Date.now(), sex: "Female", birthDate: "1960-01-01", conditions: [] }));
  await call("POST", `/patients/${pid}/echo`, { date: nowIso(), quality: "formal", lvef: 55 });
  await call("POST", `/patients/${pid}/echo`, { date: nowIso(), quality: "formal", lvef: 50, valves: { as: "Severe" }, measures: { "av-vmax": 4.3 } });
  const s = await loadState(db, pid);
  assert.equal(s.studies.filter((x) => x.kind === "echo").length, 2);
});
