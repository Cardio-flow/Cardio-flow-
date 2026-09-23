// Local development: embedded Postgres (PGlite), synthetic data, Vite dev server.
import { createServer as createHttpServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createLocalDb } from "./db/db.js";
import { createApp } from "./app.js";
import { boot } from "./boot.js";

const dir = process.env.CARDIO_DATA_DIR || path.resolve(".data/cardioflow-v2");
if (process.env.CARDIO_DATA_DIR !== "memory") await mkdir(dir, { recursive: true });
const db = await createLocalDb(process.env.CARDIO_DATA_DIR === "memory" ? undefined : dir);
await boot(db, { seed: process.env.CARDIO_SEED !== "0" });
const app = createApp(db);
const server = createHttpServer(app);
if (process.env.APP_BUILD === "1") {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true, ws: { server } } as any, appType: "spa" });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4310);
server.listen(port, "127.0.0.1", () => console.log(`CardioFlow v2 (synthetic sandbox): http://127.0.0.1:${port}`));
const close = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
