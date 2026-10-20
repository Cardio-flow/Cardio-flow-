import { createLocalDb } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { reassess } from "../server/engine/engine.js";
import * as K from "../server/kernel/clinical.js";
import { nowIso, type Actor } from "../server/kernel/base.js";

const db = await createLocalDb();
const actor: Actor = { id: "journey-audit@cardioflow.local", name: "Synthetic journey audit", role: "clinician", siteId: SITE_ID };
const current = async (id: string) => (await db.query<{
  rule_id: string; fingerprint: string; title: string; detail: string; facts: unknown; missing: unknown; action: unknown;
}>(`SELECT rule_id,fingerprint,title,detail,facts,missing,action FROM cf.recommendation
    WHERE patient_id=$1 AND status='active' ORDER BY rule_id,fingerprint`, [id])).rows;
const asJson = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
const normalized = (rows: Awaited<ReturnType<typeof current>>) => rows.map((row) => ({
  ...row, facts: asJson(row.facts), missing: asJson(row.missing), action: asJson(row.action),
}));
const divergences: { patient: string; action: string; rules: string[]; incremental: unknown; full: unknown }[] = [];
const failures: { patient: string; action: string; error: string }[] = [];
const skips: { patient: string; action: string; reason: string }[] = [];
const expectations: { patient: string; action: string; expectedRule: string; present: boolean }[] = [];
let runs = 0;
try {
  await boot(db, { seed: true });
  const patients = (await db.query<{ id: string; name: string }>(
    "SELECT id,name FROM cf.patient WHERE synthetic=true AND removed_at IS NULL ORDER BY name",
  )).rows;
  for (const patient of patients) {
    let observationId = "";
    let medicationId = "";
    let admissionId = "";
    const operations: { name: string; act: () => Promise<string[]> }[] = [
      { name: "record-creatinine", act: () => db.transaction(async (tx) => {
        const result = await K.recordObservations(tx, actor, patient.id, { effectiveAt: nowIso(), items: [{ code: "creatinine", value: 110 }] });
        observationId = result.ids[0];
        return result.changed;
      }) },
      { name: "correct-creatinine", act: () => db.transaction((tx) => K.correctObservation(tx, actor, patient.id, observationId, { value: 160 })) },
      { name: "withdraw-creatinine", act: () => db.transaction((tx) => K.correctObservation(tx, actor, patient.id, observationId, { enteredInError: true })) },
      { name: "record-echo", act: () => db.transaction(async (tx) => {
        const result = await K.recordEcho(tx, actor, patient.id, { date: nowIso(), quality: "formal", lvef: 28, findings: [], valves: { mr: "Moderate" } });
        return result.changed;
      }) },
      { name: "record-abpm", act: () => db.transaction(async (tx) => {
        const result = await K.recordStudy(tx, actor, patient.id, { kind: "abpm", date: nowIso(), findings: {
          duration: "24 h", onTreatment: "On treatment", sbp24: 158, dbp24: 96, conclusion: "Uncontrolled on treatment",
        } });
        return result.changed;
      }) },
      { name: "record-pci", act: () => db.transaction(async (tx) => {
        const result = await K.recordProcedure(tx, actor, patient.id, { kind: "pci", date: nowIso(), details: {
          setting: "elective", vessels: ["LAD"], devices: ["Drug-eluting stent"], stents: 1, access: "Radial",
        } });
        return result.changed;
      }) },
      { name: "start-iron", act: () => db.transaction(async (tx) => {
        const result = await K.startMedication(tx, actor, patient.id, { code: "ferrous-sulfate", doseValue: 200, frequency: "OD", route: "PO", indication: "Synthetic audit", effectiveAt: nowIso() });
        medicationId = result.medicationId;
        return result.changed;
      }) },
      { name: "stop-iron", act: () => db.transaction((tx) => K.medicationEvent(tx, actor, patient.id, medicationId, { kind: "stop", reason: "Synthetic audit", effectiveAt: nowIso() })) },
      { name: "start-admission", act: () => db.transaction(async (tx) => {
        const result = await K.startAdmission(tx, actor, patient.id, { startedAt: nowIso(), reasons: ["Acute decompensated HF"], hfRelated: true });
        admissionId = result.id;
        return result.changed;
      }) },
      { name: "discharge-with-review", act: () => db.transaction((tx) => K.discharge(tx, actor, patient.id, admissionId, {
        endedAt: nowIso(), status: "Stable", destination: "Home", plan: [{
          category: "follow_up", title: "Synthetic audit review",
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), completesOn: { type: "visit" },
        }],
      })) },
    ];
    for (const operation of operations) {
      if (operation.name === "start-admission" && (await db.query(
        "SELECT 1 FROM cf.care_context WHERE patient_id=$1 AND kind='admission' AND status='open' AND removed_at IS NULL", [patient.id],
      )).rows.length) {
        skips.push({ patient: patient.name, action: operation.name, reason: "Existing open admission" });
        continue;
      }
      if (operation.name === "discharge-with-review" && !admissionId) {
        skips.push({ patient: patient.name, action: operation.name, reason: "No new audit admission" });
        continue;
      }
      try {
        const changed = await operation.act();
        await db.transaction((tx) => reassess(tx, patient.id, "production", changed));
        const incremental = normalized(await current(patient.id));
        await db.transaction((tx) => reassess(tx, patient.id, "production"));
        const full = normalized(await current(patient.id));
        runs++;
        if (JSON.stringify(incremental) !== JSON.stringify(full)) {
          const left = new Map(incremental.map((row) => [row.rule_id, JSON.stringify(row)]));
          const right = new Map(full.map((row) => [row.rule_id, JSON.stringify(row)]));
          const rules = [...new Set([...left.keys(), ...right.keys()])].filter((rule) => left.get(rule) !== right.get(rule));
          divergences.push({ patient: patient.name, action: operation.name, rules,
            incremental: incremental.filter((row) => rules.includes(row.rule_id)),
            full: full.filter((row) => rules.includes(row.rule_id)) });
        }
      } catch (error) {
        failures.push({ patient: patient.name, action: operation.name, error: String(error) });
      }
    }
  }
  const procedureCases = [
    { name: "TAVI", conditions: ["htn"], kind: "valve" as const, details: { position: "Aortic", procedure: "TAVI", access: "Transfemoral" }, rule: "valve.tavi-antithrombotic" },
    { name: "RDN", conditions: ["htn"], kind: "rdn" as const, details: { device: "Symplicity Spyral", result: "Completed", arteries: "Bilateral", complications: [] }, rule: "htn.rdn-aftercare" },
    { name: "AF ablation", conditions: ["af", "htn"], kind: "ablation" as const, details: { targets: ["AF (pulmonary vein isolation)"], energy: "Pulsed field", result: "Acute success" }, rule: "rhythm.ablation-followup" },
    { name: "LAAO", conditions: ["af", "htn"], kind: "laao" as const, details: { method: "Transcatheter occlusion", device: "WATCHMAN FLX", result: "Implanted / completed", regimen: "DAPT" }, rule: "rhythm.laao-aftercare" },
    { name: "Pericardial drainage", conditions: [], kind: "pericardiocentesis" as const, details: { method: "Image-guided pericardiocentesis", result: "Drainage performed", indication: "Tamponade", volume: 400, drain: "Left in situ", complications: ["None identified"] }, rule: "event.pericarditis" },
  ];
  for (const [index, scenario] of procedureCases.entries()) {
    const id = await db.transaction((tx) => K.createPatient(tx, actor, {
      name: `Synthetic ${scenario.name} audit`, mrn: `AUDIT-PROC-${index}`, sex: "Male", birthDate: "1950-01-01", synthetic: true, conditions: scenario.conditions,
    }));
    await db.transaction((tx) => reassess(tx, id, "production"));
    const changed = await db.transaction(async (tx) => {
      const result = await K.recordProcedure(tx, actor, id, { kind: scenario.kind, date: nowIso(), details: scenario.details });
      return result.changed;
    });
    await db.transaction((tx) => reassess(tx, id, "production", changed));
    const incremental = normalized(await current(id));
    await db.transaction((tx) => reassess(tx, id, "production"));
    const full = normalized(await current(id));
    runs++;
    if (JSON.stringify(incremental) !== JSON.stringify(full)) {
      const left = new Map(incremental.map((row) => [row.rule_id, JSON.stringify(row)]));
      const right = new Map(full.map((row) => [row.rule_id, JSON.stringify(row)]));
      const rules = [...new Set([...left.keys(), ...right.keys()])].filter((rule) => left.get(rule) !== right.get(rule));
      divergences.push({ patient: scenario.name, action: "record-procedure", rules,
        incremental: incremental.filter((row) => rules.includes(row.rule_id)), full: full.filter((row) => rules.includes(row.rule_id)) });
    }
    expectations.push({ patient: scenario.name, action: "record-procedure", expectedRule: scenario.rule, present: full.some((row) => row.rule_id === scenario.rule) });
  }
  console.log(JSON.stringify({ patients: patients.length, procedureCases: procedureCases.length, runs, divergenceCount: divergences.length, failureCount: failures.length, skippedCount: skips.length, divergences, failures, expectations, skips }, null, 2));
} finally {
  await db.close();
}
if (divergences.length || failures.length || expectations.some((item) => !item.present)) process.exitCode = 1;
