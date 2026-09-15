import { connectPostgres, migrate } from "../server/postgres.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = connectPostgres(process.env.DATABASE_URL);
try {
  await migrate(db);
  if (process.env.CARDIO_OWNER_EMAIL) {
    await db.query(
      "INSERT INTO governance.membership(email,role) VALUES($1,'clinician') ON CONFLICT DO NOTHING",
      [process.env.CARDIO_OWNER_EMAIL.trim().toLowerCase()],
    );
  }
  console.log("Database migration complete");
} finally {
  await db.close();
}
