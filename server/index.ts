import { createServer as createHttpServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createDb } from "./db.js";
import { createApp } from "./app.js";
if (process.env.NODE_ENV === "production")
  throw new Error(
    "This release is a synthetic localhost workspace. Production identity and infrastructure gates are not complete.",
  );
const dir = process.env.CARDIO_DATA_DIR || path.resolve(".data/cardio");
await mkdir(dir, { recursive: true });
const db = await createDb(dir, process.env.CARDIO_SEED !== "0");
const app = createApp(db);
const server = createHttpServer(app);
if (process.env.APP_BUILD === "1") {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, ws: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
server.listen(Number(process.env.PORT || 4310), "127.0.0.1", () =>
  console.log(
    `Cardio Flow synthetic workspace: http://127.0.0.1:${process.env.PORT || 4310}`,
  ),
);
async function close() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
