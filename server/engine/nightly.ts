// Nightly re-run: every living patient's rules are evaluated in full (all inputs), so findings
// that depend on the date alone stay current. One transaction per patient; failures are counted
// and do not stop the run.
import type { DB } from "../db/db.js";
import { SITE_ID } from "../boot.js";
import { reassess } from "./engine.js";

export async function nightlyReassess(db: DB, opts: { minHours?: number } = {}) {
  const site = (await db.query(`SELECT mode, settings FROM cf.site WHERE id=$1`, [SITE_ID])).rows[0] as any;
  if (!site) return { ran: false, reason: "no site" };
  const settings = typeof site.settings === "string" ? JSON.parse(site.settings) : site.settings ?? {};
  const last = settings.nightly?.at ? Date.parse(settings.nightly.at) : 0;
  if (opts.minHours && Date.now() - last < opts.minHours * 3600_000) return { ran: false, reason: "ran recently", lastRun: settings.nightly?.at ?? null };
  const started = Date.now();
  const ids = (await db.query(`SELECT id FROM cf.patient WHERE site_id=$1 AND removed_at IS NULL`, [SITE_ID])).rows as { id: string }[];
  let created = 0, resolved = 0, failed = 0;
  for (const { id } of ids) {
    try {
      const r = await db.transaction((tx) => reassess(tx, id, site.mode ?? "production"));
      created += r.created.length;
      resolved += r.resolved;
    } catch {
      failed++;
    }
  }
  const summary = { at: new Date().toISOString(), patients: ids.length, created, resolved, failed, ms: Date.now() - started };
  await db.query(`UPDATE cf.site SET settings = coalesce(settings,'{}'::jsonb) || $2::jsonb WHERE id=$1`, [SITE_ID, JSON.stringify({ nightly: summary })]);
  return { ran: true, ...summary };
}
