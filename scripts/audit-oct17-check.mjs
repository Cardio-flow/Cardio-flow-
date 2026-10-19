import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.CARDIO_BASE_URL ?? "http://127.0.0.1:4310",
  out = process.argv[2] ?? "/tmp/cardio-audit-oct17";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(15000);
const api = (path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const s = await (await fetch("/api/session")).json();
      const r = await fetch(
        "/api" + path,
        body
          ? {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": s.csrf,
              },
              body: JSON.stringify(body),
            }
          : {},
      );
      return { status: r.status, data: await r.json() };
    },
    { path, body },
  );
const shot = async (name, locator) => {
  if (locator) await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out + "/" + name + ".png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
};
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const id = (
    await api("/patients", {
      name: "Synthetic audit confirmation",
      mrn: "AUD17-" + Date.now(),
      sex: "Male",
      birthDate: "1960-01-01",
      sample: true,
      conditions: ["hfref"],
    })
  ).data.id;
  const obs = async (items, days = 0) =>
    api(`/patients/${id}/observations`, {
      effectiveAt: new Date(Date.now() + days * 86400000).toISOString(),
      items,
    });
  await obs(
    [
      { code: "sbp", value: 160 },
      { code: "dbp", value: 96 },
    ],
    -30,
  );
  await obs(
    Object.entries({
      sbp: 126,
      lvef: 32,
      haemoglobin: 13.5,
      ferritin: 60,
      tsat: 15,
      weight: 60,
      creatinine: 100,
      potassium: 4.3,
    }).map(([code, value]) => ({ code, value })),
  );
  await page.goto(base + "/patients/" + id);
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  // the switch is hidden in the compact phone header (19 Oct 2026); its state still follows the patient
  await expect(
    page.locator(".sample-switch button", { hasText: "Sample patients" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  // the switch is hidden in the compact phone header (19 Oct 2026); its state still follows the patient
  await expect(
    page.locator(".sample-switch button", { hasText: "Sample patients" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pulse-vitals")).not.toContainText("126/96");
  await expect(page.locator(".pulse-vitals")).toContainText("SBP");
  await expect(page.locator(".decision")).toHaveCount(0);
  await shot("01-compact-overview");
  const item = page.locator(".item").filter({ hasText: "IV iron" }).first();
  await item.getByRole("button", { name: "Review plan", exact: true }).click();
  const panel = page.locator(
    '[aria-label="Decision: IV iron for iron deficiency in heart failure"]',
  );
  await panel.waitFor();
  await panel
    .getByRole("checkbox", {
      name: "Decision: No previous serious reaction to IV iron",
      exact: true,
    })
    .check();
  await expect(panel.getByRole("checkbox")).toHaveCount(5);
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeDisabled();
  for (const box of await panel.getByRole("checkbox").all()) await box.check();
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await shot("02-checks-still-editable", panel);
  const date = panel
    .getByRole("textbox", { name: /^Date: Ferric carboxymaltose/ })
    .first();
  const day = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await date.fill(day.split("-").reverse().join("/"));
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "Apply plan", exact: true }).click();
  await expect(panel).toHaveCount(0);
  const s = (await api(`/patients/${id}/summary`)).data;
  expect(
    s.plan.some((p) => p.dueDate === day && /Ferinject/.test(p.title)),
  ).toBe(true);
  expect(
    s.plan.find((p) => /phosphate after/.test(p.title)).completesOn.codes,
  ).toContain("phosphate");
  const p = (
    await api(`/patients/${id}/decisions/iv-iron/preview`, {
      answers: {
        checks: [
          "no-reaction",
          "no-infection",
          "cause",
          "not-pregnant",
          "facility",
        ],
      },
    })
  ).data;
  await obs([{ code: "weight", value: 80 }]);
  expect(
    (
      await api(`/patients/${id}/wizards/iv-iron/complete`, {
        answers: p.answers,
        evidenceKey: p.evidenceKey,
      })
    ).status,
  ).toBe(409);
  await shot("03-after-save");
  expect(errors).toEqual([]);
  console.log(
    "PASS compact decisions, five durable checks, manual dates, sample reload, separate BP readings, phosphate criteria and stale-preview refusal",
  );
} finally {
  fs.writeFileSync(out + "/errors.json", JSON.stringify(errors));
  await browser.close();
}
