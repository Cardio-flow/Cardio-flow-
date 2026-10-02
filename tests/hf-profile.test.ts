// HF profile (Phase 2, slice 2): HF type with dates (ESC HF 2026: <50% reduced, ≥50% preserved),
// LVEF history, improved LVEF keeps HFrEF therapy, HF assessment measures (KCCQ-12, 6MWD, dry
// weight), and the profile in the visit note and the clinical summary.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { summary } from "../server/kernel/views.js";
import { documents } from "../server/kernel/documents.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays, daysBetween } from "../shared/clinical.js";

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

test("synthetic Hamad: HFrEF since the first reduced LVEF, history, aetiology, KCCQ/6MWD trend, dry weight", async () => {
  const pid = await byName("Hamad Al-Shammari");
  const hf: any = (await tx((q) => summary(q, pid, "sandbox"))).hf;
  assert.equal(hf.type, "HFrEF");
  assert.equal(hf.typeLabel, "HFrEF (LVEF <50%)");
  assert.ok(Math.abs(daysBetween(hf.typeSince, T) - 420) <= 1, "HFrEF since the first reduced LVEF");
  assert.deepEqual(hf.lvef.map((x: any) => x.value), [22, 28]);
  assert.equal(hf.lowestLvef.value, 22);
  assert.equal(hf.aetiology, "Dilated (non-ischaemic)");
  assert.equal(hf.kccq.now.value, 63);
  assert.equal(hf.kccq.before.value, 54);
  assert.equal(hf.walk.now.value, 360);
  assert.equal(hf.weight.dry.value, 80);
  assert.equal(hf.weight.dry.source, "recorded");
  assert.equal(hf.weight.aboveDry, Math.round((hf.weight.now.value - 80) * 10) / 10);
  assert.equal(hf.pillars.length, 4);
  const bb = hf.therapy.find((t: any) => t.name === "Bisoprolol");
  assert.ok(bb.started && bb.sameDoseSince && bb.atTargetSince == null);
  // HF assessment values are not labs: no "Labs ·" journey entry
  const labsEvents = (await db.query(`SELECT title FROM cf.clinical_event WHERE patient_id=$1 AND title LIKE 'Labs ·%KCCQ%'`, [pid])).rows;
  assert.equal(labsEvents.length, 0);
});

test("LVEF improved to ≥50%: panel keeps the four HFrEF pillars; new starts follow LVEF ≥50% (SGLT2i, MRA only)", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Improved EF", mrn: "IMP" + Date.now(), sex: "Female", birthDate: "1970-03-01", conditions: ["hfref"] }));
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -300)), quality: "formal", lvef: 30, findings: [] });
    await K.startMedication(q, doc, pid, { code: "sacubitril-valsartan", doseValue: 97, frequency: "BID", route: "PO", indication: "hf", effectiveAt: at(addDays(T, -280)) });
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -3)), quality: "formal", lvef: 56, findings: [] });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "creatinine", value: 80 }, { code: "potassium", value: 4.2 }, { code: "sbp", value: 118 }, { code: "hr", value: 70 }] });
    await reassess(q, pid, "production");
  });
  const s: any = await tx((q) => summary(q, pid, "production"));
  assert.equal(s.hf.improved.lowest, 30);
  assert.equal(s.hf.typeLabel, "HF with improved LVEF (was 30%)");
  assert.deepEqual(s.hf.pillars.map((p: any) => p.key), ["raas", "bb", "mra", "sglt2"]);
  const starts = s.attention.filter((a: any) => a.rule_id === "hf.foundational-therapy").map((a: any) => a.action?.code);
  assert.ok(starts.includes("dapagliflozin") || starts.some((c: string) => /gliflozin/.test(c)), "SGLT2i suggested");
  assert.ok(!starts.includes("bisoprolol"), "no new beta-blocker start for improved LVEF");
});

test("KCCQ-12 above 100 is refused; the visit note and clinical summary carry the HF assessment", async () => {
  const pid = await byName("Hamad Al-Shammari");
  await assert.rejects(tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "kccq", value: 120 }] })), /above the maximum 100/);
  const v = await tx((q) => K.startVisit(q, doc, pid, { reasons: ["Heart failure"], symptoms: [], service: "HF clinic", startedAt: nowIso() } as any));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), contextId: v.id, items: [{ code: "kccq", value: 68 }, { code: "6mwd", value: 380 }] }));
  const { draftNote } = await import("../server/kernel/notes.js");
  const note: any = await tx((q) => draftNote(q, pid, v.id));
  const text = typeof note === "string" ? note : note.text;
  assert.match(text, /KCCQ 68 \/100/);
  assert.match(text, /6MWD 380 m/);
  const docs = await tx((q) => documents(q, pid));
  const sum = docs.find((d) => d.id === "summary")!.text;
  assert.match(sum, /Heart failure:\n- HFrEF \(LVEF <50%\) since .*; aetiology Dilated \(non-ischaemic\)/);
  assert.match(sum, /LVEF history: 22% .* → 28%/);
  assert.match(sum, /KCCQ-12 68\/100/);
});

test("treatment timeline: dose segments with % of target, not-taking and stopped lanes, admissions and LVEF on one axis", async () => {
  const [yid, hid, fid] = [await byName("Yousef Ibrahim"), await byName("Huda Al-Sabah"), await byName("Faisal Al-Mutairi")];
  const y: any = (await tx((q) => summary(q, yid, "sandbox"))).hf;
  const spiro = y.timeline.lanes.find((l: any) => l.name === "Spironolactone");
  assert.equal(spiro.segments[spiro.segments.length - 1].state, "not_taking");
  assert.equal(spiro.segments[0].pct, 50);
  assert.deepEqual(y.timeline.lanes.slice(0, 2).map((l: any) => l.pillar), ["raas", "bb"]);
  const h: any = (await tx((q) => summary(q, hid, "sandbox"))).hf;
  const bb = h.timeline.lanes.find((l: any) => l.name === "Bisoprolol");
  assert.equal(bb.current, false);
  assert.ok(bb.stopped);
  assert.ok(bb.segments.every((g: any) => g.to <= bb.stopped));
  assert.deepEqual(h.timeline.lvef.map((p: any) => p.value), [30, 56]);
  const f: any = (await tx((q) => summary(q, fid, "sandbox"))).hf;
  assert.ok(f.timeline.admissions.filter((a: any) => a.hf).length >= 2);
  assert.ok(f.timeline.from <= f.timeline.admissions[0].from);
});
