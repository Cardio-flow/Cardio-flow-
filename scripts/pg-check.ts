// Verifies the hosted path against a real PostgreSQL: DATABASE_URL=... npx tsx scripts/pg-check.ts
import { connectPostgres } from "../server/db/db.js";
import { boot } from "../server/boot.js";
import { worklist, summary } from "../server/kernel/views.js";
const url = process.env.DATABASE_URL!;
const a = connectPostgres(url), b = connectPostgres(url);
// two cold starts at once (two serverless instances) must not double-migrate or double-seed
await Promise.all([boot(a, { seed: true }), boot(b, { seed: true })]);
await boot(a, { seed: true });
const n = (await a.query("SELECT count(*)::int n FROM cf.patient")).rows[0].n;
const rows = await a.transaction((tx) => worklist(tx, "sacc"));
const s = await a.transaction((tx) => summary(tx, rows.find((r: any) => r.name.startsWith("Khaled"))!.id));
console.log(JSON.stringify({ patients: n, first: rows[0].name, alert: rows[0].alert?.title, attention: s.attention.map((x: any) => x.title), changed: s.changes.items.length }));
await a.close(); await b.close();
