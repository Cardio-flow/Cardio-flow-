import { createHash } from "node:crypto";
import type { Q } from "./db/db.js";
import { audit } from "./kernel/base.js";

// One-time operational grant requested by the site owner on 20 Oct 2026.
// Match the verified member without storing the sign-in address in source.
const OWNER_EMAIL_SHA256 = "e2b3373de6155a11ba7dec3a75ac1da00a4f957b289636d2312c0fdf1d4d5a71";
const GRANT_MARKER = "ownerAdminGrant20261020";

export async function grantRequestedOwnerAdmin(tx: Q, siteId: string, targetDigest = OWNER_EMAIL_SHA256): Promise<"granted" | "already-applied" | "already-admin" | "not-ready"> {
  const site = (await tx.query<{ settings: Record<string, unknown> | string }>(
    "SELECT settings FROM cf.site WHERE id=$1 FOR UPDATE", [siteId],
  )).rows[0];
  if (!site) return "not-ready";
  const settings = typeof site.settings === "string" ? JSON.parse(site.settings) : site.settings;
  if (settings[GRANT_MARKER]) return "already-applied";

  const members = (await tx.query<{ email: string; role: string }>(
    "SELECT email, role FROM cf.member WHERE site_id=$1 AND active=true AND user_id IS NOT NULL", [siteId],
  )).rows;
  const owner = members.find(({ email }) =>
    createHash("sha256").update(email.trim().toLowerCase()).digest("hex") === targetDigest,
  );
  if (!owner) return "not-ready";
  if (owner.role === "admin") return "already-admin";
  if (owner.role !== "clinician") return "not-ready";

  const changed = await tx.query(
    "UPDATE cf.member SET role='admin' WHERE email=$1 AND site_id=$2 AND active=true AND user_id IS NOT NULL AND role='clinician' RETURNING email",
    [owner.email, siteId],
  );
  if (changed.rows.length !== 1) throw new Error("Owner admin grant lost its target member");
  await audit(tx, { id: "operator:owner-admin-grant", name: "Owner admin grant", role: "admin", siteId },
    "grant-admin", "member", owner.email, null, { from: "clinician", to: "admin", requestedOn: "2026-10-20" });
  await tx.query("UPDATE cf.site SET settings=settings||$2::jsonb WHERE id=$1", [siteId, JSON.stringify({ [GRANT_MARKER]: true })]);
  return "granted";
}
