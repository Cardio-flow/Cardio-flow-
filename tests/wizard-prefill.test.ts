// Pathways redesign (slice 6): a pathway opens filled in. Across every seed patient and every pathway the
// prefilled answers only use options that apply to the patient, and "none" never sits with other choices.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot } from "../server/boot.js";
import { getWizard } from "../server/engine/wizard.js";
import { WIZARDS, optionsFor } from "../shared/wizards.js";
import { NEXT, prefill } from "../shared/wizard-prefill.js";

let db: DB;
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("prefill across all seed patients and pathways: valid options only; 'none' alone; next links point to real pathways", async () => {
  const pids = (await db.query(`SELECT id FROM cf.patient`)).rows.map((r: any) => r.id as string);
  let filled = 0, combos = 0;
  for (const pid of pids)
    for (const id of Object.keys(WIZARDS)) {
      const w = await db.transaction((q) => getWizard(q, pid, id));
      const { answers, suggested } = prefill(id, w.context);
      combos++;
      filled += suggested.length;
      for (const q of WIZARDS[id].steps.flatMap((st) => st.questions).filter((q) => q.options)) {
        const v = answers[q.id];
        if (v == null) continue;
        const ok = new Set(optionsFor(q, w.context).map((o) => o.value));
        for (const x of Array.isArray(v) ? v : [String(v)]) assert.ok(ok.has(x), `${id}.${q.id}: ${x} not allowed`);
        if (Array.isArray(v) && v.includes("none")) assert.equal(v.length, 1, `${id}.${q.id}: none with others`);
      }
    }
  assert.ok(combos > 500 && filled > combos, `prefilled ${filled} answers in ${combos} pathway openings`);
  for (const [a, b] of Object.entries(NEXT)) assert.ok(WIZARDS[a] && WIZARDS[b], `${a} → ${b}`);
});
