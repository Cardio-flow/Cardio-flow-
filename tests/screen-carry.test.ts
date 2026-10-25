// 25 Oct 2026 — safety screens are never assumed (Codex 23 Oct), but one the clinician already answered is not
// asked blind again: today's answer fills the question with its source; an older one is only offered.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { carriedScreens } from "../shared/decision-assume.js";
import { nowIso, today, uuid, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

const d = (wizard: string, answers: Record<string, unknown>, day: string) => ({ wizard, answers, at: `${day}T07:00:00.000Z`, day });

test("carry-forward rule: same pathway any day, related 'stable today' only the same day, invalid values skipped", () => {
  const today = "2026-10-25";
  let c = carriedScreens("hyperkalaemia", [d("hyperkalaemia", { ecg: "none", symptoms: ["none"] }, "2026-10-20")], today);
  assert.equal(c.ecg.value, "none");
  assert.equal(c.ecg.today, false, "an older answer is offered, not filled");
  c = carriedScreens("tavi-plan", [d("after-af-ablation", { safety: "stable" }, today)], today);
  assert.deepEqual([c.safety.value, c.safety.today, c.safety.wizard], ["stable", true, "after-af-ablation"]);
  c = carriedScreens("tavi-plan", [d("after-af-ablation", { safety: "stable" }, "2026-10-24")], today);
  assert.equal(c.safety, undefined, "another pathway's stability from yesterday is not carried");
  // rdn-plan has stable / concern: an "urgent" from elsewhere is not one of its answers
  c = carriedScreens("rdn-plan", [d("tavi-plan", { safety: "urgent" }, today)], today);
  assert.equal(c.safety, undefined);
  // newest first: today's answer wins over an older one
  c = carriedScreens("congestion", [d("congestion", { redflags: ["hypoxia"] }, today), d("congestion", { redflags: ["none"] }, "2026-10-01")], today);
  assert.deepEqual(c.redflags.value, ["hypoxia"]);
  // other pathways' red flags mean different things: never carried
  c = carriedScreens("congestion", [d("sick-day", { redflags: ["none"] }, today)], today);
  assert.equal(c.redflags, undefined);
});

async function hyperkalaemic() {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Scr " + rnd(), mrn: "S" + rnd() + Date.now(), sex: "Male", birthDate: "1958-01-01", conditions: ["hfref"] }));
  await tx((q) => K.startMedication(q, doc, pid, { code: "spironolactone", doseValue: 25, frequency: "OD", route: "PO", indication: "hf", effectiveAt: nowIso(), alreadyTaking: true } as any));
  await tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 5.8 }, { code: "creatinine", value: 110 }] }); await reassess(q, pid, "production"); });
  return pid;
}
const decide = (pid: string, wizard: string, answers: Record<string, unknown>, at: string, outcome = "acted") =>
  db.query(`INSERT INTO cf.decision(id,patient_id,wizard,outcome,answers,decided_by,decided_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [uuid(), pid, wizard, outcome, JSON.stringify(answers), doc.id, at]);

test("hyperkalaemia: the ECG answered earlier today is filled with its source; nothing else changes", async () => {
  const pid = await hyperkalaemic();
  const before = await tx((q) => previewDecision(q, pid, "hyperkalaemia", {}));
  assert.equal(before.answers.ecg, undefined, "never assumed");
  await decide(pid, "hyperkalaemia", { ecg: "none", symptoms: ["none"] }, new Date().toISOString());
  const p = await tx((q) => previewDecision(q, pid, "hyperkalaemia", {}));
  assert.equal(p.answers.ecg, "none");
  assert.deepEqual(p.answers.symptoms, ["none"]);
  const r = p.reasons.find((x) => x.question.startsWith("ECG"));
  assert.match(r?.why ?? "", /^Recorded today \d\d:\d\d in Hyperkal/);
  assert.equal(r?.source, "record");
  assert.ok(!p.needed.some((q) => q.id === "ecg"));
});

test("hyperkalaemia: an ECG answer from an earlier day is offered as 'same as', not filled; declined runs are ignored", async () => {
  const pid = await hyperkalaemic();
  await decide(pid, "hyperkalaemia", { ecg: "present" }, new Date(`${addDays(T, -1)}T09:00:00+03:00`).toISOString(), "declined");
  await decide(pid, "hyperkalaemia", { ecg: "none" }, new Date(`${addDays(T, -6)}T09:00:00+03:00`).toISOString());
  const p = await tx((q) => previewDecision(q, pid, "hyperkalaemia", {}));
  assert.equal(p.answers.ecg, undefined);
  const q = p.needed.find((x) => x.id === "ecg");
  if (q) assert.equal(q.last?.value, "none", "the needed question carries the earlier answer");
  // whether or not the ECG is a required answer here, the earlier answer is what the context offers
  const ctxScreens = (await tx((x) => import("../server/engine/wizard.js").then((m) => m.getWizard(x, pid, "hyperkalaemia")))).context.screens!;
  assert.equal(ctxScreens.ecg.value, "none");
  assert.equal(ctxScreens.ecg.today, false);
  assert.equal(ctxScreens.ecg.at.slice(0, 10) <= addDays(T, -6), true);
});
