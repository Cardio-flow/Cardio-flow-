// Patient Overview: five questions, merged duplicate suggestions, "Not now" with a reason,
// copy-ready documents (English and Arabic), and the nightly re-run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { summary } from "../server/kernel/views.js";
import { documents } from "../server/kernel/documents.js";
import { nightlyReassess } from "../server/engine/nightly.js";
import { reassess } from "../server/engine/engine.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("duplicate drug suggestions are shown once, with the others carried as 'also'", async () => {
  // Khalid (synthetic): HFpEF + T2DM + CKD → SGLT2i from HF and diabetes rules, finerenone from HF and cardiorenal rules
  const pid = await byName("Khalid Al-Rashidi");
  const s = await tx((q) => summary(q, pid, "sandbox"));
  const starts = s.attention.filter((a: any) => a.action?.type === "start-med");
  const classes = starts.map((a: any) => a.action.code);
  assert.equal(new Set(classes).size, classes.length, "no drug suggested twice");
  const mra = starts.find((a: any) => a.action.code === "finerenone");
  assert.ok(mra.also.length >= 1, "finerenone card carries the second rule");
  const glp = starts.find((a: any) => a.action.code === "semaglutide");
  assert.ok(glp.also.some((x: any) => x.rule_id === "metabolic.obesity" || x.rule_id === "metabolic.diabetes-cv-protection"));
  // worklist counts the merged card once
  const { worklist } = await import("../server/kernel/views.js");
  const row = (await tx((q) => worklist(q, SITE_ID, true))).find((r: any) => r.id === pid)!;
  const total = (Object.values(row.alertCounts) as number[]).reduce((a, b) => a + b, 0);
  assert.equal(total, s.attention.length);
});

test("overview answers the five questions from the record", async () => {
  const pid = await byName("Faisal Al-Mutairi");
  const s = await tx((q) => summary(q, pid, "sandbox"));
  assert.match(s.overview.why.text, /^Admitted .* · day \d+$/);
  assert.equal(s.overview.why.sub, "Acute decompensated HF");
  assert.ok(s.overview.attention.red + s.overview.attention.orange + s.overview.attention.yellow + s.overview.attention.blue === s.attention.length);
  const k = await byName("Khaled Al-Mansour");
  const o = (await tx((q) => summary(q, k, "sandbox"))).overview;
  assert.ok(o.unfinished.overdue >= 1, "Khaled has an overdue renal/K check");
  assert.ok(Array.isArray(o.next));
});

test("'Not now' closes a merged suggestion together with the ones it carries, with the reason", async () => {
  const pid = await byName("Khalid Al-Rashidi");
  const card = (await tx((q) => summary(q, pid, "sandbox"))).attention.find((a: any) => a.action?.code === "finerenone");
  const app = createApp(db);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const login = await fetch(base + "/demo-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const csrf = (await login.json()).csrf;
    const r = await fetch(`${base}/patients/${pid}/recommendations/${card.id}/decline`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ outcome: "deferred", reason: "Await potassium recheck", also: card.also.map((x: any) => x.id) }),
    });
    assert.equal(r.status, 200);
  } finally {
    server.close();
  }
  const ids = [card.id, ...card.also.map((x: any) => x.id)];
  const rows = (await db.query(`SELECT r.status, d.reason FROM cf.recommendation r JOIN cf.decision d ON d.recommendation_id=r.id WHERE r.id = ANY($1)`, [ids])).rows as any[];
  assert.equal(rows.length, ids.length);
  assert.ok(rows.every((x) => x.reason === "Await potassium recheck"));
  const after = (await tx((q) => summary(q, pid, "sandbox"))).attention;
  assert.ok(!after.some((a: any) => a.action?.code === "finerenone"));
});

test("documents: clinical summary, medication list with changes, patient plan in English and Arabic", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Docs Patient", mrn: "DOC" + Date.now(), sex: "Male", birthDate: "1960-05-01", conditions: ["hfref", "af", "t2dm"] }));
  await tx(async (q) => {
    await K.startMedication(q, doc, pid, { code: "empagliflozin", doseValue: 10, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(addDays(T, -2)) });
    await K.startMedication(q, doc, pid, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(addDays(T, -200)) });
    await K.startMedication(q, doc, pid, { code: "gliclazide", doseValue: 60, frequency: "OD", route: "PO", indication: "dm", effectiveAt: at(addDays(T, -200)) });
    await K.addPlanAction(q, doc, pid, { category: "monitoring", title: "Renal function and potassium check", dueDate: addDays(T, 7), completesOn: { type: "lab", codes: ["potassium", "creatinine"] } });
    await K.addPlanAction(q, doc, pid, { category: "follow_up", title: "HF clinic review", dueDate: addDays(T, 14), completesOn: { type: "visit" } });
    await K.addPlanAction(q, doc, pid, { category: "medication", title: "Consider finerenone", dueDate: addDays(T, 14), completesOn: { type: "manual" } });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "creatinine", value: 98 }, { code: "potassium", value: 4.4 }] });
    await reassess(q, pid, "sandbox");
  });
  const docs = await tx((q) => documents(q, pid));
  const get = (id: string) => docs.find((d) => d.id === id)!.text;
  assert.match(get("summary"), /^Cardiology summary — Docs Patient/);
  assert.match(get("summary"), /Empagliflozin \(Jardiance\) 10 mg OD/);
  assert.match(get("meds"), /Empagliflozin \(Jardiance\) 10 mg OD {2}\[NEW\]/);
  const en = get("plan-en");
  assert.match(en, /Blood test: potassium, kidney function — /);
  assert.match(en, /Clinic appointment — /);
  assert.doesNotMatch(en, /Consider finerenone/, "clinician tasks stay out of the patient plan");
  assert.match(en, /pause Empagliflozin, Gliclazide MR/);
  assert.match(en, /blood thinner \(Apixaban\)/);
  assert.match(en, /below 70 mg\/dL/);
  const ar = docs.find((d) => d.id === "plan-ar")!;
  assert.equal(ar.dir, "rtl");
  assert.match(ar.text, /^خطة العلاج — Docs Patient/);
  assert.match(ar.text, /Empagliflozin \(Jardiance\) 10 mg، مرة واحدة يومياً — لعلاج ضعف عضلة القلب \[دواء جديد\]/);
  assert.match(ar.text, /تحليل دم: البوتاسيوم، وظائف الكلى — /);
  assert.match(ar.text, /موعد مراجعة في العيادة/);
  assert.match(ar.text, /اتصل بالإسعاف على 112/);
  assert.doesNotMatch(ar.text, /Consider finerenone/);
});

test("nightly re-run evaluates every patient and is throttled without a secret", async () => {
  const first = await nightlyReassess(db, { minHours: 6 });
  assert.equal(first.ran, true);
  assert.ok((first as any).patients >= 10);
  assert.equal((first as any).failed, 0);
  const second = await nightlyReassess(db, { minHours: 6 });
  assert.equal(second.ran, false);
  assert.equal((second as any).reason, "ran recently");
});
