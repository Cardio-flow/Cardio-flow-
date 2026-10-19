import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Q, DB } from "./db/db.js";
import { ApiError } from "./kernel/base.js";

type AdminSession = { id: string; siteId: string; role: string; csrf: string };
type PinState = { salt: string; hash: string; failures?: number; lockedUntil?: number };
const TTL = 15 * 60_000;
const LOCK = 15 * 60_000;
const pinPattern = /^\d{6,12}$/;

function admin(session: AdminSession) {
  if (session.role !== "admin") throw new ApiError(403, "Administrator access required");
}
async function readPin(q: Q, siteId: string, lock = false): Promise<PinState | null> {
  const row = (await q.query<{ pin: PinState | string | null }>(
    `SELECT settings->'adminPin' AS pin FROM cf.site WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [siteId],
  )).rows[0];
  if (!row) throw new ApiError(404, "Site not found");
  return typeof row.pin === "string" ? JSON.parse(row.pin) : row.pin;
}
async function savePin(q: Q, siteId: string, pin: PinState) {
  await q.query(`UPDATE cf.site SET settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{adminPin}',$2::jsonb,true) WHERE id=$1`, [siteId, JSON.stringify(pin)]);
}
function digest(pin: string, salt: string) {
  return scryptSync(pin, Buffer.from(salt, "hex"), 32).toString("hex");
}
function tokenFor(state: PinState, session: AdminSession, expires: number) {
  return createHmac("sha256", Buffer.from(state.hash, "hex"))
    .update(`${session.siteId}:${session.id}:${session.csrf}:${expires}`)
    .digest("hex");
}
export async function pinStatus(db: DB, session: AdminSession) {
  admin(session);
  return { configured: !!(await readPin(db, session.siteId)) };
}
export async function setAdminPin(db: DB, session: AdminSession, pin: string, unlock?: string) {
  admin(session);
  if (!pinPattern.test(pin)) throw new ApiError(400, "Use a 6–12 digit PIN");
  await db.transaction(async (tx) => {
    const current = await readPin(tx, session.siteId, true);
    if (current && !validUnlock(current, session, unlock)) throw new ApiError(403, "Unlock administration before changing its PIN");
    const salt = randomBytes(16).toString("hex");
    await savePin(tx, session.siteId, { salt, hash: digest(pin, salt), failures: 0 });
  });
  return { configured: true };
}
export async function unlockAdmin(db: DB, session: AdminSession, pin: string) {
  admin(session);
  if (!pinPattern.test(pin)) throw new ApiError(403, "Incorrect PIN");
  const state = await db.transaction(async (tx) => {
    const current = await readPin(tx, session.siteId, true);
    if (!current) throw new ApiError(409, "Set an administration PIN first");
    if ((current.lockedUntil ?? 0) > Date.now()) throw new ApiError(429, "Too many attempts. Try again in 15 minutes");
    const candidate = Buffer.from(digest(pin, current.salt), "hex");
    if (!timingSafeEqual(candidate, Buffer.from(current.hash, "hex"))) {
      current.failures = (current.failures ?? 0) + 1;
      if (current.failures >= 5) {
        current.lockedUntil = Date.now() + LOCK;
        current.failures = 0;
      }
      await savePin(tx, session.siteId, current);
      return null;
    }
    if (current.failures || current.lockedUntil) {
      current.failures = 0;
      current.lockedUntil = 0;
      await savePin(tx, session.siteId, current);
    }
    return current;
  });
  if (!state) throw new ApiError(403, "Incorrect PIN");
  const expires = Date.now() + TTL;
  return { token: `${expires}.${tokenFor(state, session, expires)}`, expires };
}
function validUnlock(state: PinState, session: AdminSession, token?: string) {
  if (!token) return false;
  const [until, signature] = token.split(".");
  const expires = Number(until);
  if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + TTL || !/^[0-9a-f]{64}$/.test(signature ?? "")) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(tokenFor(state, session, expires), "hex"));
}
export async function requireAdminUnlock(db: DB, session: AdminSession, token?: string) {
  admin(session);
  const state = await readPin(db, session.siteId);
  if (!state || !validUnlock(state, session, token)) throw new ApiError(403, "Unlock administration with your PIN");
}
