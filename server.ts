// Hosted entry (Vercel): Neon Postgres + Neon Auth.
import path from "node:path";
import type express from "express";
import { connectPostgres } from "./server/db/db.js";
import { createApp } from "./server/app.js";
import { hostedAuth } from "./server/auth.js";
import { mountFrontend } from "./server/frontend.js";
import { boot } from "./server/boot.js";

// synthetic demo users are for the local sandbox only
process.env.CARDIO_DEMO_USERS ??= "0";
const { DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET } = process.env;
// production uses the project domain; a Vercel preview uses its own branch URL automatically
const origin =
  process.env.CARDIO_ORIGIN ||
  (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL
    ? `https://${process.env.VERCEL_BRANCH_URL}`
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
if (!DATABASE_URL || !NEON_AUTH_BASE_URL || !NEON_AUTH_COOKIE_SECRET || !origin)
  throw new Error("Hosted database, identity and origin configuration are required");
const db = connectPostgres(DATABASE_URL);
// no top-level await: the first request waits for migration/boot instead
const ready = boot(db, { seed: process.env.CARDIO_SEED !== "0" });
const app: express.Express = createApp(db, hostedAuth(db, origin, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET), ready);
mountFrontend(app, path.resolve("public"));
export default app;
