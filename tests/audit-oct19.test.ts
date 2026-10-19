// 19 Oct 2026 audit fixes: notes read like the header, one decision per line, the metformin limit once,
// the admission plan named as such, IHD on the worklist, device models that may be unknown.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { diagnosisLines, planView, worklist } from "../server/kernel/views.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { cleanProcedure, historicalLabel } from "../shared/procedures.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const at = (y: number) => new Date(`${y}-07-01T09:00:00+03:00`).toISOString();
const patient = (conditions: string[]) => tx((q) => K.createPatient(q, doc, { name: "Audit " + Math.random().toString(36).slice(2, 7), mrn: "A" + Date.now() + Math.random().toString(36).slice(2, 5), sex: "Female", birthDate: "1950-01-01", conditions }));

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());

test("device models may be unknown; ablation reads without double brackets", () => {
  const w = cleanProcedure("laao", { device: "WATCHMAN (model not known)", historical: "year" }) as any;
  assert.equal(historicalLabel("laao", w), "Watchman LAA occluder");
  const p = cleanProcedure("device", { type: "Pacemaker (type not known)", historical: "year" }) as any;
  assert.equal(historicalLabel("device", p), "Pacemaker");
  const t = cleanProcedure("valve", { position: "Mitral", procedure: "Transcatheter edge-to-edge repair (TEER)", historical: "year" }) as any;
  assert.equal(historicalLabel("valve", t), "Mitral TEER (clip)");
  assert.equal(historicalLabel("ablation", { targets: ["Atrial flutter (CTI)"] }), "Atrial flutter (CTI) ablation");
});

test("notes list diagnoses as the header does: HF, IHD with years, devices, then risk factors and other conditions", async () => {
  const pid = await patient(["hfref", "htn", "t2dm", "gout"]);
  await tx(async (q) => {
    await K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prior-mi", onsetYear: 2017, attributes: { type: "STEMI", territory: "Inferior" } }] } as any);
    await K.recordProcedure(q, doc, pid, { kind: "pci", date: at(2015), details: { vessels: ["LAD"], historical: "year" } } as any);
    await K.recordProcedure(q, doc, pid, { kind: "laao", date: at(2019), details: { device: "WATCHMAN (model not known)", historical: "year" } } as any);
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "lvef", value: 35 }] });
  });
  const d = diagnosisLines(await loadState(db, pid));
  assert.deepEqual(d.diagnoses, ["HFrEF (LVEF 35%)", "IHD · PCI LAD 2015 · inferior STEMI 2017", "Watchman LAA occluder 2019"]);
  assert.deepEqual(d.riskFactors.sort(), ["Hypertension", "Type 2 diabetes"]);
  assert.deepEqual(d.other, ["Gout"]);
});

test("the metformin renal limit is raised once", async () => {
  const pid = await patient(["t2dm"]);
  await tx(async (q) => {
    await K.startMedication(q, doc, pid, { code: "metformin", doseValue: 1000, frequency: "BID", route: "PO", indication: "diabetes", effectiveAt: nowIso(), alreadyTaking: true } as any);
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "creatinine", value: 125 }] });
    await reassess(q, pid, "production");
  });
  const rows = (await db.query(`SELECT rule_id, title FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
  const met = rows.filter((r) => /metformin/i.test(r.title));
  assert.equal(met.length, 1, JSON.stringify(met));
});

test("plan items made during an open admission are the admission plan; the worklist reads IHD", async () => {
  const pid = await patient(["hfref", "prior-mi", "prior-pci"]);
  await tx(async (q) => {
    const ctx = await K.startAdmission(q, doc, pid, { startedAt: nowIso(), location: "CCU", reasons: ["Acute decompensated HF"] });
    await K.addPlanAction(q, doc, pid, { category: "monitoring", title: "Renal function check", dueDate: addDays(today(), 2), contextId: (ctx as any).id ?? (ctx as any).contextId ?? ctx } as any);
  });
  const item = planView(await loadState(db, pid)).find((p) => p.title === "Renal function check")!;
  assert.equal(item.source?.label, "Admission plan");
  const row = (await worklist(db as any, SITE_ID)).find((r: any) => r.id === pid)!;
  assert.equal(row.problem, "HFrEF · IHD");
});
