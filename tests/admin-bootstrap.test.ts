import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { grantRequestedOwnerAdmin } from "../server/admin-bootstrap.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createLocalDb } from "../server/db/db.js";

test("one verified synthetic member receives an audited, one-time admin grant", async () => {
  const db = await createLocalDb();
  try {
    await boot(db, { seed: false });
    const email = "owner@example.test";
    const digest = createHash("sha256").update(email).digest("hex");
    await db.query("INSERT INTO cf.member(email,site_id,display_name,role) VALUES($1,$2,'Synthetic owner','clinician')", [email, SITE_ID]);

    assert.equal(await db.transaction(tx => grantRequestedOwnerAdmin(tx, SITE_ID, digest)), "not-ready");
    await db.query("UPDATE cf.member SET user_id='verified-synthetic-user' WHERE email=$1", [email]);
    const otherDigest = createHash("sha256").update("different@example.test").digest("hex");
    assert.equal(await db.transaction(tx => grantRequestedOwnerAdmin(tx, SITE_ID, otherDigest)), "not-ready");
    assert.equal(await db.transaction(tx => grantRequestedOwnerAdmin(tx, SITE_ID, digest)), "granted");
    assert.equal(await db.transaction(tx => grantRequestedOwnerAdmin(tx, SITE_ID, digest)), "already-applied");

    const member = (await db.query<{ role: string }>("SELECT role FROM cf.member WHERE email=$1", [email])).rows[0];
    const audits = (await db.query("SELECT action FROM cf.audit WHERE entity='member' AND entity_id=$1", [email])).rows;
    const site = (await db.query<{ settings: Record<string, boolean> }>("SELECT settings FROM cf.site WHERE id=$1", [SITE_ID])).rows[0];
    assert.equal(member.role, "admin");
    assert.deepEqual(audits.map((a: any) => a.action), ["grant-admin"]);
    assert.equal(site.settings.ownerAdminGrant20261020, true);
  } finally {
    await db.close();
  }
});
