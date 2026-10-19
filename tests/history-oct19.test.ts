// 19 Oct 2026 — past procedures and devices entered as history (Watchman, MitraClip, ICD, PCI by year),
// the structural line in the header, no early-aftercare prompts for them, and the report gaps closed:
// gout, ASD, LAVI, a mass on a device lead offering the endocarditis pathway.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { header } from "../server/kernel/views.js";
import { nowIso, type Actor } from "../server/kernel/base.js";
import { cleanProcedure } from "../shared/procedures.js";
import { attributesText, cleanAttributes } from "../shared/history.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const at = (y: number) => new Date(`${y}-07-01T09:00:00+03:00`).toISOString();
const rules = async (pid: string) =>
  ((await db.query(`SELECT rule_id, title FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[]);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());

test("a past procedure needs only the year; an unknown precision is rejected", () => {
  const r = cleanProcedure("laao", { device: "WATCHMAN (earlier generation)", historical: "year" }) as any;
  assert.equal(r.historical, "year");
  assert.equal(r.result, "Implanted / completed");
  assert.throws(() => cleanProcedure("laao", { historical: "decade" }), /Date precision/);
});

test("structural history: one header line, no LAAO/TEER aftercare, no anticoagulation prompt, device check worded as missing", async () => {
  const pid = await tx(async (q) => {
    const id = await K.createPatient(q, doc, { name: "Hist " + Date.now(), mrn: "H" + Date.now(), sex: "Female", birthDate: "1949-07-01", conditions: ["hfref", "htn", "prior-bleeding"] });
    await K.recordHistory(q, doc, id, { effectiveAt: nowIso(), add: [{ code: "af", attributes: { pattern: "Permanent" } }] } as any);
    await K.recordProcedure(q, doc, id, { kind: "device", date: at(2017), details: { type: "ICD (transvenous)", historical: "year" } } as any);
    await K.recordProcedure(q, doc, id, { kind: "laao", date: at(2019), details: { device: "WATCHMAN (earlier generation)", historical: "year" } } as any);
    await K.recordProcedure(q, doc, id, { kind: "valve", date: at(2021), details: { position: "Mitral", procedure: "Transcatheter edge-to-edge repair (TEER)", deviceModel: "MitraClip", historical: "year" } } as any);
    await K.recordObservations(q, doc, id, { effectiveAt: nowIso(), items: [{ code: "lvef", value: 38 }] });
    await reassess(q, id, "production");
    return id;
  });
  const h = header(await loadState(db, pid)) as any;
  assert.equal(h.structural.label, "Mitral TEER (MitraClip) 2021 · Watchman LAA occluder 2019 · ICD 2017");
  const r = await rules(pid);
  assert.ok(!r.some((x) => x.rule_id === "structural.aftercare"), "a TEER in the history has no early aftercare");
  assert.ok(!r.some((x) => /^af\.(laao|closure)/.test(x.rule_id)), JSON.stringify(r));
  assert.ok(!r.some((x) => /anticoag/i.test(x.title)), "the Watchman covers the stroke prevention question");
  const dev = r.find((x) => x.rule_id === "rhythm.device-check-due");
  assert.equal(dev?.title, "ICD: no device check recorded");
});

test("report gaps: gout and ASD as diagnoses, a lead mass on echo offers the endocarditis pathway", async () => {
  assert.equal(attributesText("asd", cleanAttributes("asd", { type: "Secundum ASD", shunt: "Left-to-right" })), "Secundum ASD · left-to-right shunt");
  const pid = await tx(async (q) => {
    const id = await K.createPatient(q, doc, { name: "Gap " + Date.now(), mrn: "G" + Date.now(), sex: "Female", birthDate: "1950-01-01", conditions: ["hfref", "gout", "asd", "cied"] });
    await K.recordEcho(q, doc, id, { date: nowIso(), quality: "formal", lvef: 38, findings: ["Mass on device lead", "ASD / interatrial shunt"] });
    await K.recordObservations(q, doc, id, { effectiveAt: nowIso(), items: [{ code: "lavi", value: 122 }] });
    await reassess(q, id, "production");
    return id;
  });
  const s = await loadState(db, pid);
  assert.equal(s.resolved("lavi").current?.value_num, 122);
  const r = await rules(pid);
  const ie = r.find((x) => x.rule_id === "event.endocarditis");
  assert.match(ie?.title ?? "", /Echo .*: Mass on device lead/);
});
