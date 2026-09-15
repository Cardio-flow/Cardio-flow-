import express, { type Request, type Response } from "express";
import { createHmac } from "node:crypto";
import {
  createAuthServer,
  handleAuthProxyRequest,
  extractNeonAuthCookies,
  serializeSetCookie,
} from "@neondatabase/auth/server";
import type { DB } from "./db.js";
import type { HostedOptions, Session } from "./app.js";
export function hostedAuth(
  db: DB,
  origin: string,
  baseUrl: string,
  cookieSecret: string,
): HostedOptions {
  if (new URL(origin).protocol !== "https:" || cookieSecret.length < 32)
    throw new Error("Hosted authentication requires HTTPS and a cookie secret");
  const config = { baseUrl, cookieSecret, sessionDataTtl: 60 };
  return {
    origin,
    mountAuth(app) {
      app.use("/api/auth", express.raw({ type: "*/*", limit: "20kb" }));
      app.all("/api/auth/*splat", async (req, res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (typeof value === "string") headers.set(key, value);
        const request = new globalThis.Request(origin + req.originalUrl, {
          method: req.method,
          headers,
          ...(!["GET", "HEAD"].includes(req.method) && req.body?.length
            ? { body: new Uint8Array(req.body) }
            : {}),
        });
        const response = await handleAuthProxyRequest({
          ...config,
          request,
          path: req.path.replace(/^\/api\/auth\//, ""),
        });
        res.status(response.status);
        for (const [key, value] of response.headers)
          if (key !== "set-cookie") res.setHeader(key, value);
        res.setHeader("set-cookie", response.headers.getSetCookie());
        res.send(Buffer.from(await response.arrayBuffer()));
      });
    },
    async authenticate(req: Request, res: Response): Promise<Session | null> {
      if (!extractNeonAuthCookies(req.headers.cookie ?? "")) return null;
      const auth = createAuthServer({
        ...config,
        context: () => ({
          getCookies: () => extractNeonAuthCookies(req.headers.cookie ?? ""),
          setCookie: (name, value, options) => {
            res.append(
              "Set-Cookie",
              serializeSetCookie({ name, value, ...options }),
            );
          },
          getHeader: (name) => req.get(name) ?? null,
          getOrigin: () => origin,
          getFramework: () => "express",
        }),
      });
      const { data, error } = await auth.getSession();
      if (error) {
        const failure = new Error("Sign-in service is unavailable. Try again.");
        Object.assign(failure, { status: 503 });
        res.status(503).json({ error: failure.message });
        return null;
      }
      if (!data?.user || !data.session) return null;
      if (!data.user.emailVerified) {
        res.status(403).json({
          error: "Verify your email address before entering the workspace.",
        });
        return null;
      }
      const email = data.user.email.toLowerCase();
      const member = (
        await db.query<{ role: Session["role"]; user_id: string | null }>(
          "SELECT role,user_id FROM governance.membership WHERE email=$1 AND active=true",
          [email],
        )
      ).rows[0];
      if (!member || (member.user_id && member.user_id !== data.user.id)) {
        res.status(403).json({
          error: "Your account is signed in and awaiting workspace approval.",
        });
        return null;
      }
      const linked = await db.query(
        "UPDATE governance.membership SET user_id=$1 WHERE email=$2 AND active=true AND (user_id IS NULL OR user_id=$1) RETURNING role",
        [data.user.id, email],
      );
      if (!linked.rows.length) return null;
      return {
        actor: data.user.id,
        role: member.role,
        email,
        expires: new Date(data.session.expiresAt).getTime(),
        csrf: createHmac("sha256", cookieSecret)
          .update(data.session.id)
          .digest("hex"),
      };
    },
  };
}
