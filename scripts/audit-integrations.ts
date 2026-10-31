import { createLocalDb } from "../server/db/db.js";
import { boot } from "../server/boot.js";
import { RULES } from "../server/engine/rules.js";
import { reassess } from "../server/engine/engine.js";
import { wizardContext } from "../server/engine/wizard.js";
import { loadState } from "../server/kernel/state.js";
import * as K from "../server/kernel/clinical.js";
import { nowIso, type Actor } from "../server/kernel/base.js";
import { WIZARDS, optionsFor } from "../shared/wizards.js";

const problems: string[] = [];
const ruleIds = new Set<string>();
for (const rule of RULES) {
  if (ruleIds.has(rule.id)) problems.push(`Duplicate rule: ${rule.id}`);
  ruleIds.add(rule.id);
  if (!rule.inputs.length) problems.push(`Rule has no inputs: ${rule.id}`);
  const body = rule.evaluate.toString();
  const directMeasures = [...body.matchAll(/\.resolved\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  const helperMeasures = [...body.matchAll(/\b(?:within|series|recent|fact|cur)\(\s*s\s*,\s*["']([^"']+)["']/g)].map((match) => match[1]);
  if (/\bhfPhenotype\(\s*s\s*\)/.test(body)) helperMeasures.push("lvef");
  for (const measure of new Set([...directMeasures, ...helperMeasures]))
    if (!rule.inputs.includes(measure) && !rule.inputs.includes("observations"))
      problems.push(`Missing result trigger: ${rule.id} reads ${measure}`);
  for (const [property, trigger] of [[".meds", "meds"], [".studies", "studies"], [".procedures", "procedures"], [".plan", "plan"]] as const)
    if (body.includes(property) && !rule.inputs.includes(trigger))
      problems.push(`Missing direct-state trigger: ${rule.id} reads ${property}`);
  if (/\b(?:on|live|onTag|medsWithTag)\(\s*s\s*[,)]/.test(body) && !rule.inputs.includes("meds"))
    problems.push(`Missing medication trigger: ${rule.id}`);
}
for (const [key, wizard] of Object.entries(WIZARDS)) {
  if (key !== wizard.id) problems.push(`Wizard key mismatch: ${key} / ${wizard.id}`);
  const questions = wizard.steps.flatMap((step) => step.questions);
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) problems.push(`Duplicate question: ${key}.${question.id}`);
    ids.add(question.id);
  }
}
if (process.env.AUDIT_STATIC_ONLY === "1") {
  console.log(JSON.stringify({ rules: RULES.length, wizards: Object.keys(WIZARDS).length, problems }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

const db = await createLocalDb();
try {
  await boot(db, { seed: true });
  const patients = (await db.query<{ id: string; name: string }>(
    "SELECT id,name FROM cf.patient WHERE synthetic=true AND removed_at IS NULL ORDER BY name",
  )).rows;
  const report: { patient: string; active: number; clinical: number; wizardActions: number; actions: Record<string, number> }[] = [];
  for (const patient of patients) {
    await db.transaction((tx) => reassess(tx, patient.id, "production"));
    const state = await loadState(db, patient.id);
    for (const [key, wizard] of Object.entries(WIZARDS)) {
      try {
        const ctx = wizardContext(state, key);
        for (const step of wizard.steps) for (const question of step.questions)
          if (question.options) optionsFor(question, ctx);
      } catch (error) {
        problems.push(`Wizard context ${key} on ${patient.name}: ${String(error)}`);
      }
    }
    const active = (await db.query<{ rule_id: string; action: { type: string; wizard?: string; template?: string } }>(
      "SELECT rule_id,action FROM cf.recommendation WHERE patient_id=$1 AND status='active'", [patient.id],
    )).rows;
    const actions: Record<string, number> = {};
    for (const row of active) {
      const action = typeof row.action === "string" ? JSON.parse(row.action) : row.action;
      actions[action.type] = (actions[action.type] ?? 0) + 1;
      if (action.type === "wizard" && !WIZARDS[action.wizard!])
        problems.push(`Missing wizard ${row.rule_id} → ${action.wizard}`);
    }
    report.push({ patient: patient.name, active: active.length,
      clinical: active.filter((row) => !row.rule_id.startsWith("ops.")).length,
      wizardActions: actions.wizard ?? 0, actions });
  }
  const actor: Actor = { id: "audit@cardioflow.local", name: "Synthetic audit", role: "admin", siteId: "sacc" };
  const activeRule = async (id: string, ruleId: string) => (await db.query<{ title: string; detail: string; facts: unknown }>(
    "SELECT title,detail,facts FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2", [id, ruleId],
  )).rows;
  const titrationPatient = await (async () => {
    for (const patient of patients) if ((await activeRule(patient.id, "hf.titration")).length) return patient;
    return null;
  })();
  const scenarios: Record<string, unknown> = {};
  if (titrationPatient) {
    const before = await activeRule(titrationPatient.id, "hf.titration");
    await db.transaction(async (tx) => {
      const result = await K.recordObservations(tx, actor, titrationPatient.id, {
        effectiveAt: nowIso(), items: [{ code: "congestion", text: "Moderate" }],
      });
      await reassess(tx, titrationPatient.id, "production", result.changed);
    });
    const state = await loadState(db, titrationPatient.id);
    scenarios.titrationAfterCongestion = {
      patient: titrationPatient.name, before: before.length,
      expected: RULES.find((rule) => rule.id === "hf.titration")!.evaluate(state, { min_days_since_change: 14 }).length,
      active: (await activeRule(titrationPatient.id, "hf.titration")).length,
    };
    const outcome = scenarios.titrationAfterCongestion as { expected: number; active: number };
    if (outcome.expected !== outcome.active) problems.push("HF titration did not refresh after congestion");
  }
  const ironId = await db.transaction(async (tx) => {
    const id = await K.createPatient(tx, actor, {
      name: "Synthetic iron audit", mrn: "AUDIT-IRON-20261020", sex: "Female",
      birthDate: "1980-01-01", synthetic: true, conditions: [],
    });
    const result = await K.recordObservations(tx, actor, id, {
      effectiveAt: nowIso(), items: [{ code: "haemoglobin", value: 13 }, { code: "ferritin", value: 8 }],
    });
    await reassess(tx, id, "production", result.changed);
    return id;
  });
  const ironBefore = await activeRule(ironId, "lab.iron-deficiency");
  await db.transaction(async (tx) => {
    const result = await K.startMedication(tx, actor, ironId, {
      code: "ferrous-sulfate", doseValue: 200, frequency: "OD", route: "PO",
      indication: "Confirmed iron deficiency", effectiveAt: nowIso(),
    });
    await reassess(tx, ironId, "production", result.changed);
  });
  const ironState = await loadState(db, ironId);
  scenarios.ironAfterOralIron = {
    before: ironBefore.map((row) => row.title),
    expected: RULES.find((rule) => rule.id === "lab.iron-deficiency")!.evaluate(ironState, { ferritin_low: 15 }).map((row) => row.title),
    active: (await activeRule(ironId, "lab.iron-deficiency")).map((row) => row.title),
  };
  const ironOutcome = scenarios.ironAfterOralIron as { expected: string[]; active: string[] };
  if (JSON.stringify(ironOutcome.expected) !== JSON.stringify(ironOutcome.active))
    problems.push("Iron-deficiency advice did not refresh after oral iron start");
  console.log(JSON.stringify({ rules: RULES.length, wizards: Object.keys(WIZARDS).length, patients: report, problems }, null, 2));
  console.log(JSON.stringify({ scenarios }, null, 2));
} finally {
  await db.close();
}
if (problems.length) process.exitCode = 1;
