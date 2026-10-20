import { createLocalDb } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { reassess } from "../server/engine/engine.js";
import { recordObservations, type ObsInput } from "../server/kernel/clinical.js";
import { nowIso, type Actor } from "../server/kernel/base.js";

const db = await createLocalDb();
const actor: Actor = { id: "audit@cardioflow.local", name: "Synthetic audit", role: "clinician", siteId: SITE_ID };
const probes: { name: string; item: (index: number) => ObsInput }[] = [
  { name: "creatinine", item: (index) => ({ code: "creatinine", value: 100 + index }) },
  { name: "haemoglobin", item: (index) => ({ code: "haemoglobin", value: 10 + index / 100 }) },
  { name: "ferritin", item: (index) => ({ code: "ferritin", value: 8 + index / 100 }) },
  { name: "tsat", item: (index) => ({ code: "tsat", value: 14 + index / 100 }) },
  { name: "nt-probnp", item: (index) => ({ code: "nt-probnp", value: 2000 + index }) },
  { name: "alt", item: (index) => ({ code: "alt", value: 95 + index, referenceHigh: 40 }) },
  { name: "congestion", item: () => ({ code: "congestion", text: "Moderate" }) },
  { name: "potassium", item: (index) => ({ code: "potassium", value: 5.6 + index / 1000 }) },
  { name: "platelets", item: (index) => ({ code: "platelets", value: 80 + index }) },
  { name: "ldl-c", item: (index) => ({ code: "ldl-c", value: 2.6 + index / 100 }) },
  { name: "tsh", item: (index) => ({ code: "tsh", value: 8 + index / 100 }) },
  { name: "ck", item: (index) => ({ code: "ck", value: 700 + index, referenceHigh: 190 }) },
  { name: "vitamin-d", item: (index) => ({ code: "vitamin-d", value: 20 + index / 10 }) },
  { name: "inr", item: (index) => ({ code: "inr", value: 4.2 + index / 100 }) },
  { name: "magnesium", item: (index) => ({ code: "magnesium", value: 0.6 + index / 1000 }) },
  { name: "uacr", item: (index) => ({ code: "uacr", value: 100 + index }) },
  { name: "hba1c", item: (index) => ({ code: "hba1c", value: 8.5 + index / 100 }) },
];
const current = async (id: string) => (await db.query<{
  rule_id: string; fingerprint: string; title: string; detail: string; facts: unknown; missing: unknown; action: unknown;
}>(`SELECT rule_id,fingerprint,title,detail,facts,missing,action FROM cf.recommendation
   WHERE patient_id=$1 AND status='active' ORDER BY rule_id,fingerprint`, [id])).rows;
const normalized = (rows: Awaited<ReturnType<typeof current>>) => JSON.stringify(rows.map((row) => ({
  ...row,
  facts: typeof row.facts === "string" ? JSON.parse(row.facts) : row.facts,
  missing: typeof row.missing === "string" ? JSON.parse(row.missing) : row.missing,
  action: typeof row.action === "string" ? JSON.parse(row.action) : row.action,
})));
try {
  await boot(db, { seed: true });
  const patients = (await db.query<{ id: string; name: string }>(
    "SELECT id,name FROM cf.patient WHERE synthetic=true AND removed_at IS NULL ORDER BY name",
  )).rows;
  const divergences: { patient: string; probe: string; rules: string[] }[] = [];
  let runs = 0;
  for (const [index, patient] of patients.entries()) {
    for (const probe of probes) {
      const result = await db.transaction((tx) => recordObservations(tx, actor, patient.id, {
        effectiveAt: nowIso(), items: [probe.item(index)],
      }));
      await db.transaction((tx) => reassess(tx, patient.id, "production", result.changed));
      const incremental = await current(patient.id);
      await db.transaction((tx) => reassess(tx, patient.id, "production"));
      const exhaustive = await current(patient.id);
      runs++;
      if (normalized(incremental) !== normalized(exhaustive)) {
        const left = new Map(incremental.map((row) => [row.rule_id, JSON.stringify(row)]));
        const right = new Map(exhaustive.map((row) => [row.rule_id, JSON.stringify(row)]));
        const rules = [...new Set([...left.keys(), ...right.keys()])].filter((rule) => left.get(rule) !== right.get(rule));
        divergences.push({ patient: patient.name, probe: probe.name, rules });
      }
    }
  }
  console.log(JSON.stringify({ patients: patients.length, probes: probes.length, runs, divergences }, null, 2));
  if (divergences.length) process.exitCode = 1;
} finally {
  await db.close();
}
