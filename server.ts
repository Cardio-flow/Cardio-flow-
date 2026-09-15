import express from "express";
import path from "node:path";
import { connectPostgres } from "./server/postgres.js";
import { createApp } from "./server/app.js";
import { hostedAuth } from "./server/auth.js";
const { DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET } =
  process.env;
const origin =
  process.env.CARDIO_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "");
if (!DATABASE_URL || !NEON_AUTH_BASE_URL || !NEON_AUTH_COOKIE_SECRET || !origin)
  throw new Error(
    "Hosted database, identity, and origin configuration are required",
  );
const db = connectPostgres(DATABASE_URL);
const app: express.Express = createApp(
  db,
  hostedAuth(db, origin, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET),
);
app.get("/{*path}", (req, res) => {
  if (path.extname(req.path) && req.path !== "/index.html") {
    res.status(404).type("text/plain").send("File not found");
    return;
  }
  res.set("Cache-Control", "no-store");
  res.sendFile(path.resolve("public/index.html"), {
    cacheControl: false,
    lastModified: false,
  });
});
export default app;
