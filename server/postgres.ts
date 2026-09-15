import pg from "pg";
import { readFile } from "node:fs/promises";
import { type DB, type QueryDB, initializeData, hash } from "./db.js";
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1700, Number);
export function connectPostgres(connectionString: string): DB {
  const secureUrl = new URL(connectionString);
  secureUrl.searchParams.set("sslmode", "verify-full");
  const pool = new pg.Pool({
    connectionString: secureUrl.toString(),
    max: 4,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  });
  const query = async <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => {
    const result = await pool.query(sql, params);
    return { rows: result.rows as T[] };
  };
  return {
    query,
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize pilot writes across instances, including multi-record death updates.
        await client.query("SELECT pg_advisory_xact_lock(43104310)");
        const tx: QueryDB = {
          query: async <T>(sql: string, params?: unknown[]) => ({
            rows: (await client.query(sql, params)).rows as T[],
          }),
        };
        const result = await callback(tx);
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
  const careSchema = await readFile(
    new URL("./care-schema.sql", import.meta.url),
    "utf8",
  );
  const schema = await readFile(
    new URL("./schema.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.query("CREATE SCHEMA IF NOT EXISTS governance");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS governance.migration (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const old = (
      await tx.query<{ checksum: string }>(
        "SELECT checksum FROM governance.migration WHERE name='001-foundation'",
      )
    ).rows[0];
    if (old && old.checksum !== hash(schema))
      throw new Error(
        "Foundation migration changed; add a new migration instead",
      );
    if (!old) {
      await tx.query(schema);
      await tx.query(
        "INSERT INTO governance.migration(name,checksum) VALUES('001-foundation',$1)",
        [hash(schema)],
      );
    }
    await tx.query(`CREATE TABLE IF NOT EXISTS governance.membership (
      email text PRIMARY KEY, user_id text UNIQUE, role text NOT NULL CHECK(role IN ('clinician','reviewer','analyst','designer')),
      active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const careMigration = (
      await tx.query<{ checksum: string }>(
        "SELECT checksum FROM governance.migration WHERE name='002-continuous-care'",
      )
    ).rows[0];
    if (careMigration && careMigration.checksum !== hash(careSchema))
      throw new Error(
        "Continuous-care migration changed; add a new migration instead",
      );
    if (!careMigration) {
      await tx.query(careSchema);
      await tx.query(
        "INSERT INTO governance.migration(name,checksum) VALUES('002-continuous-care',$1)",
        [hash(careSchema)],
      );
    }
  });
  // Deployment runs this once before serving requests, never at cold start.
  await initializeData(db);
}
