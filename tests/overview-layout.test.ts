// 10 Nov 2026 — one "To do" list from the server: the header chip, the Overview tab badge and the overview card
// read the same list, so their numbers cannot disagree.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { summary } from "../server/kernel/views.js";
import { todoList } from "../shared/overview-layout.js";
import { buildProblems } from "../shared/overview-problems.js";
import { isRoutine } from "../shared/routine.js";
import { Consult } from "../src/screens/Consult.js";

let db: DB;
// the screen builds tab links from the browser address; a fixed one stands in here
(globalThis as any).location ??= { pathname: "/patients/fixture", search: "" };
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});

test("every seeded patient: the summary carries problems and one to-do list; the overview card shows that list", async () => {
  const ids = (await db.query<{ id: string }>(`SELECT id FROM cf.patient WHERE site_id=$1 AND removed_at IS NULL`, [SITE_ID])).rows.map((r) => r.id);
  assert.ok(ids.length >= 20);
  let withWork = 0;
  for (const id of ids) {
    const s = (await db.transaction((q) => summary(q, id, "sandbox"))) as any;
    assert.ok(Array.isArray(s.problems) && s.problems.some((p: any) => p.key === "other"));
    assert.deepEqual(s.todo, todoList(s), "the server list is the shared list");
    assert.equal(new Set(s.todo.map((t: any) => t.key)).size, s.todo.length, "no entry twice");
    // no routine check is counted as work to do
    const routine = new Set((s.attention as any[]).filter(isRoutine).map((a) => a.id));
    assert.ok(!s.todo.some((t: any) => routine.has(t.key)));
    const html = renderToStaticMarkup(createElement(Consult, { s, open() {}, done() {}, slots: {} }));
    if (s.todo.length) {
      withWork++;
      assert.ok(html.includes(`To do · ${s.todo.length}<`), `overview card shows ${s.todo.length}`);
    } else assert.ok(!html.includes("To do ·"));
    assert.ok(!html.includes("cx-priority-counts"), "no second set of counts");
  }
  assert.ok(withWork >= 10);
});

test("a non-urgent task of an open complication episode stays on the episode card; an urgent one is listed", () => {
  const task = (urgent: boolean) => ({ id: urgent ? "u" : "n", title: urgent ? "Same-day assessment" : "Episode blood panel", status: "completed", awaitingReview: true, clinicalContext: { episodeId: "e", problem: "infection", urgent } });
  const s: any = { attention: [], today: "2026-10-21", header: { id: "p" }, targets: {}, medications: { groups: [] }, episodes: [{ id: "e", status: "open", open: [] }], plan: [task(false), task(true)] };
  assert.deepEqual(todoList(s).map((t) => t.title), ["Same-day assessment"]);
  assert.equal(buildProblems(s).length, 1);
});

test("one button per pathway: a routine item whose pathway a decision already opens has no second button", () => {
  const attention = [
    { id: "a", title: "Review glycaemic control", rule_id: "dm.glycaemic-control", severity: "orange", rule_status: "PUBLISHED", action: { type: "wizard", wizard: "diabetes" } },
    { id: "b", title: "Annual checks due", rule_id: "dm.annual-checks", severity: "yellow", rule_status: "PUBLISHED", action: { type: "wizard", wizard: "diabetes" } },
  ];
  const s: any = { attention, today: "2026-10-21", header: { id: "p" }, plan: [], targets: {}, medications: { groups: [] } };
  const html = renderToStaticMarkup(createElement(Consult, { s: { ...s, problems: buildProblems(s), todo: todoList(s) }, open() {}, done() {}, slots: {} }));
  assert.equal(todoList(s).length, 1);
  assert.match(html, /Annual checks due/);
  assert.ok(!html.includes(">Diabetes plan</button>"));
});
