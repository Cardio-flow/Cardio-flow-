// Prints every active recommendation for the synthetic patients (fresh in-memory DB).
import { createLocalDb } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
const db = await createLocalDb();
await boot(db, { seed: true });
const rows = (await db.query(`SELECT p.name, r.rule_id, r.severity, r.title, r.detail, r.action FROM cf.recommendation r JOIN cf.patient p ON p.id=r.patient_id WHERE r.status='active' AND p.site_id=$1 ORDER BY p.name, r.severity`, [SITE_ID])).rows as any[];
let last = "";
for (const r of rows) {
  if (r.name !== last) console.log("\n## " + (last = r.name));
  const a = typeof r.action === "string" ? JSON.parse(r.action) : r.action;
  console.log(`  [${r.severity}] ${r.title}\n      ${r.detail}  → ${a.type}${a.label ? ": " + a.label : ""}  (${r.rule_id})`);
}
await db.close();
