import { SignJWT } from "jose";
import {
  NEON_AUTH_SESSION_COOKIE_NAME,
  NEON_AUTH_SESSION_DATA_COOKIE_NAME,
} from "@neondatabase/auth/server";
import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import { createDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { hostedAuth } from "../server/auth.js";

test("hosted mode disables demo access, rejects forged sessions and cross-origin auth", async () => {
  const db = await createDb(undefined, false);
  const upstream = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end("null");
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => upstream.once("listening", r));
  const auth = hostedAuth(
    db,
    "https://cardio.example",
    `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/auth`,
    "test-only-cookie-secret-32-characters-long",
  );
  const server = createApp(db, auth).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal(
      (
        await fetch(base + "/api/demo-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "clinician" }),
        })
      ).status,
      404,
    );
    assert.equal((await fetch(base + "/api/patients")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/patients", {
          headers: {
            Cookie:
              "cf_session=forged; __Secure-neon-auth.session_token=forged",
          },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    await db.query(
      "CREATE TABLE IF NOT EXISTS governance.membership(email text PRIMARY KEY,user_id text UNIQUE,role text NOT NULL,active boolean DEFAULT true)",
    );
    const makeCookie = async (verified: boolean, id = "test-user") => {
      const now = new Date().toISOString();
      const token = await new SignJWT({
        user: {
          id,
          email: "owner@example.com",
          emailVerified: verified,
          name: "Owner",
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: "session-1",
          userId: id,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          createdAt: now,
          updatedAt: now,
        },
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1m")
        .sign(
          new TextEncoder().encode(
            "test-only-cookie-secret-32-characters-long",
          ),
        );
      return `${NEON_AUTH_SESSION_COOKIE_NAME}=synthetic-session; ${NEON_AUTH_SESSION_DATA_COOKIE_NAME}=${token}`;
    };
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { Cookie: await makeCookie(true) },
        })
      ).status,
      403,
    );
    await db.query(
      "INSERT INTO governance.membership(email,role) VALUES('owner@example.com','clinician')",
    );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { Cookie: await makeCookie(false) },
        })
      ).status,
      403,
    );
    const approvedCookie = await makeCookie(true);
    const approved = await fetch(base + "/api/session", {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).role, "clinician");
    assert.equal(
      (
        await fetch(base + "/api/patients", {
          headers: { Cookie: approvedCookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { Cookie: await makeCookie(true, "different-user") },
        })
      ).status,
      403,
    );
    await db.query("UPDATE governance.membership SET active=false");
    assert.equal(
      (
        await fetch(base + "/api/patients", {
          headers: { Cookie: approvedCookie },
        })
      ).status,
      403,
    );
    assert.deepEqual(await (await fetch(base + "/api/config")).json(), {
      hosted: true,
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => upstream.close(() => r()));
    await db.close();
  }
});
