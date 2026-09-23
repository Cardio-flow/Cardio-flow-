import type { DB } from "./db/db.js";
import { migrate } from "./db/db.js";
import { seedRules } from "./engine/engine.js";
import { seedSynthetic } from "./seed.js";

export const SITE_ID = process.env.CARDIO_SITE_ID || "sacc";

// Idempotent: safe to run on every cold start.
export async function boot(db: DB, opts: { seed: boolean }) {
  await migrate(db);
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO cf.site(id,name,mode,settings) VALUES($1,$2,$3,'{}') ON CONFLICT (id) DO NOTHING`,
      [SITE_ID, process.env.CARDIO_SITE_NAME || "Sabah Al-Ahmad Cardiac Centre", process.env.CARDIO_SITE_MODE === "production" ? "production" : "sandbox"],
    );
    await seedRules(tx);
    // Carry approved users over from the v1 (Codex) membership table if it exists.
    const legacy = (await tx.query(`SELECT to_regclass('governance.membership') AS t`)).rows[0]?.t;
    if (legacy) {
      await tx.query(
        `INSERT INTO cf.member(email,user_id,site_id,display_name,role,active)
         SELECT lower(email), user_id, $1, split_part(email,'@',1),
                CASE role WHEN 'reviewer' THEN 'reviewer' WHEN 'designer' THEN 'admin' ELSE 'clinician' END, active
         FROM governance.membership ON CONFLICT (email) DO NOTHING`,
        [SITE_ID],
      );
    }
    for (const [email, name, role] of [
      ["dr.ahmed@cardioflow.local", "Dr. Ahmed", "clinician"],
      ["reviewer@cardioflow.local", "Dr. Clinical Reviewer", "reviewer"],
      ["admin@cardioflow.local", "Rule Administrator", "admin"],
    ])
      if (process.env.CARDIO_DEMO_USERS !== "0")
        await tx.query(`INSERT INTO cf.member(email,site_id,display_name,role) VALUES($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`, [email, SITE_ID, name, role]);
  });
  if (opts.seed) {
    const mode = (await db.query(`SELECT mode FROM cf.site WHERE id=$1`, [SITE_ID])).rows[0]?.mode;
    const any = (await db.query(`SELECT 1 FROM cf.patient WHERE site_id=$1 LIMIT 1`, [SITE_ID])).rows[0];
    if (mode === "sandbox" && !any) await seedSynthetic(db, SITE_ID);
  }
}
