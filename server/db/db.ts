import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface Q {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  // run a multi-statement script (migrations)
  exec(sql: string): Promise<void>;
}
export interface DB extends Q {
  transaction<T>(fn: (tx: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const hash = (v: string) => createHash("sha256").update(v).digest("hex");

export async function createLocalDb(dataDir?: string): Promise<DB> {
  const db = new PGlite({ dataDir, parsers: { 1082: (v: string) => v } });
  await db.waitReady;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    query: (sql, params) => db.query(sql, params as any[]) as any,
    exec: async (sql) => void (await db.exec(sql)),
    transaction<T>(fn: (tx: Q) => Promise<T>) {
      // PGlite is single-connection: serialise transactions.
      const run = chain.then(() =>
        db.transaction((tx) =>
          fn({ query: (sql, params) => tx.query(sql, params as any[]) as any, exec: async (sql) => void (await tx.exec(sql)) }),
        ),
      );
      chain = run.catch(() => undefined);
      return run as Promise<T>;
    },
    close: () => db.close(),
  };
}

pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(20, Number);

export function connectPostgres(connectionString: string): DB {
  const url = new URL(connectionString);
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "verify-full");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
  return {
    query: async (sql, params) => ({ rows: (await pool.query(sql, params as any[])).rows }),
    exec: async (sql) => void (await pool.query(sql)),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async (sql, params) => ({ rows: (await client.query(sql, params as any[])).rows }),
          exec: async (sql) => void (await client.query(sql)),
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function migrate(db: DB) {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(431001)");
    await tx.query("CREATE SCHEMA IF NOT EXISTS cf");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS cf.migration (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = (await tx.query<{ checksum: string }>("SELECT checksum FROM cf.migration WHERE name='v2-001-kernel'")).rows[0];
    if (applied && applied.checksum !== hash(schema))
      throw new Error("The v2 kernel schema changed after it was applied. Add a new migration instead of editing it.");
    if (!applied) {
      await tx.exec(schema);
      await tx.query("INSERT INTO cf.migration(name,checksum) VALUES('v2-001-kernel',$1)", [hash(schema)]);
    }
  });
}
