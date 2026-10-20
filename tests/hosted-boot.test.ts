import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { advanceRulesetRefresh, boot, SITE_ID } from "../server/boot.js";
import { RULESET } from "../server/engine/rules.js";

let db: DB;
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("hosted startup defers rule seeding and site refresh in durable batches", async () => {
  await db.query("UPDATE cf.site SET settings=settings || $2::jsonb WHERE id=$1", [SITE_ID, JSON.stringify({ ruleset: "previous-build" })]);
  await boot(db, { seed: false, deferReassessment: true });
  const settings = async () => (await db.query<{ settings: { ruleset: string; ruleSeedVersion?: string; ruleSeedProgress?: { offset: number }; rulesetProgress?: { cursor: string } } }>(
    "SELECT settings FROM cf.site WHERE id=$1", [SITE_ID],
  )).rows[0].settings;
  assert.equal((await settings()).ruleset, "previous-build");
  const first = await advanceRulesetRefresh(db, 1);
  assert.equal(first.pending, true);
  assert.ok((await settings()).ruleSeedProgress?.offset);
  let seedCalls = 0;
  while ((await settings()).ruleSeedVersion !== RULESET && seedCalls < 100) {
    await advanceRulesetRefresh(db, 1);
    seedCalls++;
  }
  assert.ok(seedCalls > 1);
  assert.equal((await settings()).ruleSeedVersion, RULESET);
  assert.equal((await settings()).ruleSeedProgress, undefined);
  assert.equal((await settings()).ruleset, undefined);
  let calls = 1;
  while ((await settings()).ruleset !== RULESET && calls < 40) {
    await advanceRulesetRefresh(db, 3);
    calls++;
  }
  assert.ok(calls > 1);
  assert.equal((await settings()).ruleset, RULESET);
  assert.equal((await settings()).rulesetProgress, undefined);
  assert.deepEqual(await advanceRulesetRefresh(db), { pending: false, advanced: 0 });
});
