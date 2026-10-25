// Synthetic-only review of the urgent task, episode grouping and shared pathway button.
// Run pregnancy-check.mjs first to create its urgent post-decision scenario.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const out = process.argv[2] || "/tmp/cardio-overview-followthrough";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
});
const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const api = (path) =>
  p.evaluate(async (path) => {
    const r = await fetch("/api" + path);
    if (!r.ok) throw Error(`${path}: ${r.status}`);
    return r.json();
  }, path);
const shot = async (name) => {
  await p.evaluate(() => document.fonts.ready);
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.screenshot({ path: `${out}/${name}.png` });
};
try {
  await p.goto(base);
  await p.getByText("Dr. Ahmed", { exact: true }).click();
  await p.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  await p.getByRole("button", { name: "Sample patients", exact: true }).click();
  const patients = await api("/patients?sample=1");
  const urgent = (await api("/patients?sample=1&q=Synthetic%20pregnancy%20urgent")).find((x) => x.name === "Synthetic pregnancy urgent");
  assert.ok(urgent, "Run pregnancy-check.mjs first");
  await p.goto(`${base}/patients/${urgent.id}`);
  const s = await api(`/patients/${urgent.id}/summary`);
  const task = s.plan.find(
    (x) => x.clinicalContext?.urgent && x.status === "planned",
  );
  assert.ok(task);
  assert.equal(
    s.attention.find((a) => a.action?.planId === task.id)?.severity,
    "red",
  );
  assert.equal(s.overview.next[0].id, task.id);
  await expect(p.locator(".urgent-strip")).toContainText(
    "urgent obstetric and cardiac assessment",
  );
  const pregnancy = p.locator(
    '.cx-dec[data-problem="Pregnancy & heart disease"]',
  );
  await expect(
    pregnancy.getByRole("button", { name: "Open task", exact: true }),
  ).toBeVisible();
  await pregnancy.scrollIntoViewIfNeeded();
  await shot("01-phone-urgent-followthrough");
  await p.locator(".urgent-strip").getByRole("button").click();
  await expect(p.getByRole("dialog")).toBeVisible();
  await expect(p.getByRole("dialog")).toContainText(
    "urgent obstetric and cardiac assessment",
  );
  await shot("02-phone-urgent-task");
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(`${base}/patients/${urgent.id}`);
  await pregnancy.waitFor();
  await shot("03-desktop-urgent-followthrough");

  const infection = patients.find((x) => x.name === "Faisal Al-Mutairi");
  assert.ok(infection);
  await p.goto(`${base}/patients/${infection.id}`);
  const infectionSummary = await api(`/patients/${infection.id}/summary`);
  const ep = p.locator(".ep").filter({ hasText: "Chest infection" }).first();
  await expect(ep.locator(".problem-tasks summary")).toBeVisible();
  await ep.locator(".problem-tasks summary").click();
  const linked = infectionSummary.plan.filter(
    (t) =>
      t.clinicalContext?.episodeId &&
      t.title !== "Influenza, pneumococcal and COVID-19 vaccination" &&
      (t.status === "planned" || t.awaitingReview),
  );
  assert.ok(linked.length > 0);
  await expect(ep.locator(".task-row")).toHaveCount(linked.length);
  for (const t of linked) {
    await expect(
      p.locator(".tb .task-row").filter({ hasText: t.title }),
    ).toHaveCount(0);
  }
  await expect(p.locator("#routine-due")).toContainText("Influenza, pneumococcal and COVID-19 vaccination");
  await expect(p.locator("#routine-due")).not.toHaveAttribute("open");
  await ep.scrollIntoViewIfNeeded();
  await shot("04-desktop-infection-tasks");
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(ep.locator(".problem-tasks summary")).toBeVisible();
  await ep.scrollIntoViewIfNeeded();
  await shot("05-phone-infection-tasks");

  const diabetes = patients.find((x) => x.name === "Khalid Al-Rashidi");
  assert.ok(diabetes);
  await p.goto(`${base}/patients/${diabetes.id}`);
  const card = p.locator('.cx-dec[data-problem="Diabetes"]');
  await expect(
    card.getByRole("button", { name: "Review diabetes care", exact: true }),
  ).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: "Diabetes plan", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Review plan", exact: true }),
  ).toHaveCount(0);
  await expect(card).toContainText("Pioglitazone");
  await card.scrollIntoViewIfNeeded();
  await shot("06-phone-diabetes-actions");
  await card
    .getByRole("button", { name: "Review diabetes care", exact: true })
    .click();
  await expect(card.locator(".decision[aria-label]")).toBeVisible();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/checks.json`,
    JSON.stringify(
      {
        checks: [
          "Urgency after decision and direct task access",
          "Today task precedes future appointments",
          "Episode task group without duplicate alerts",
          "One diabetes pathway button; drug safety retained",
          "Phone and desktop widths",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS urgent follow-through, episode task grouping, diabetes actions, phone/desktop",
  );
} finally {
  await browser.close();
}
