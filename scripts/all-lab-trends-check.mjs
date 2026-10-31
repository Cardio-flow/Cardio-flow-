import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))
  throw Error("Synthetic localhost required");
const out = process.argv[2] || "/tmp/refinement-oct31";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let csrf = "";
const api = (path, body) =>
  page.evaluate(
    async ({ path, body, csrf }) => {
      const r = await fetch(
        "/api" + path,
        body
          ? {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": csrf,
              },
              body: JSON.stringify(body),
            }
          : {},
      );
      const j = await r.json();
      if (!r.ok) throw Error(path + ": " + JSON.stringify(j));
      return j;
    },
    { path, body, csrf },
  );
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  const pt = await api("/patients", {
    name: "Synthetic every lab trend",
    mrn: "ALL-LABS-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["cad-ccs"],
    sample: true,
  });
  const path = `/patients/${pt.id}`;
  const pairs = [
    ["urate", 407, 542],
    ["ldl-c", 2.99, 3.86],
    ["wbc", 16.6, 11.9],
    ["creatinine", 87, 86],
    ["potassium", 4.4, 4.2],
    ["tsh", 1.8, 2.1],
    ["phosphate", 1, 1.2],
    ["calcium-total", 2.2, 2.3],
    ["vitamin-d", 20, 30],
    ["hs-troponin", 0, 1],
  ];
  await api(path + "/observations", {
    effectiveAt: "2026-03-10T06:00:00Z",
    items: pairs.map(([code, value]) => ({ code, value })),
  });
  await api(path + "/observations", {
    effectiveAt: "2026-07-21T06:00:00Z",
    items: [
      ...pairs.map(([code, , value]) => ({ code, value })),
      { code: "ft4", value: 15 },
    ],
  });
  const summary = await api(path + "/summary");
  await page.goto(base + path);
  await page
    .getByRole("heading", { name: "Latest results", exact: true })
    .waitFor();
  const cards = page.locator(".cx-result-card");
  await expect(cards).toHaveCount(6);
  await page
    .getByRole("button", {
      name: `Show all ${summary.results.length} results`,
      exact: true,
    })
    .click();
  await expect(cards).toHaveCount(summary.results.length);
  for (const result of summary.results) {
    const card = page.locator(`[data-result-code="${result.code}"]`);
    await expect(card).toBeVisible();
    if (result.currentTrend.previous) {
      await expect(card.locator("svg polyline")).toHaveCount(1);
      if (result.currentTrend.percent != null)
        await expect(card.locator(".cx-result-change b")).toContainText("%");
    }
  }
  await expect(page.locator('[data-result-code="urate"]')).toContainText(
    "↑ +33.2%",
  );
  await expect(page.locator('[data-result-code="ldl-c"]')).toContainText(
    "↑ +29.1%",
  );
  await expect(page.locator('[data-result-code="wbc"]')).toContainText(
    "↓ -28.3%",
  );
  await expect(page.locator('[data-result-code="tsh"]')).toContainText(
    "↑ +16.7%",
  );
  await expect(page.locator('[data-result-code="ft4"]')).toContainText(
    "First comparable result",
  );
  await expect(
    page.locator('[data-result-code="ft4"] svg polyline'),
  ).toHaveCount(0);
  await expect(page.locator('[data-result-code="hs-troponin"]')).toContainText(
    "previous result was zero",
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await page
        .locator(".cx-result-grid")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await page
      .getByRole("heading", { name: "Latest results", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/all-lab-trends-${width}.png` });
  }
  await page
    .getByRole("button", { name: "Show fewer results", exact: true })
    .click();
  await expect(cards).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.locator(".cx-key-results").scrollIntoViewIfNeeded();
  await page
    .locator(".cx-key-results")
    .evaluate((el) =>
      window.scrollTo({
        top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - 150),
        behavior: "instant",
      }),
    );
  await page.screenshot({ path: `${out}/compact-lab-trends-390.png` });
  await page.getByRole("button", { name: "Add labs", exact: true }).first().click();
  await expect(page.getByLabel("Creatinine", { exact: true })).toHaveCount(1);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  // More than six abnormal results must remain visible without expansion.
  await api(path + "/observations", {
    effectiveAt: "2026-07-22T06:00:00Z",
    items: [
      { code: "potassium", value: 5.8 },
      { code: "sodium", value: 129 },
      { code: "magnesium", value: 0.5 },
      { code: "haemoglobin", value: 10 },
      { code: "alt", value: 160, referenceHigh: 40 },
    ],
  });
  const updated = await api(path + "/summary");
  assert.ok(updated.abnormal.items.length > 6);
  await page.reload();
  await page
    .getByRole("heading", { name: "Latest results", exact: true })
    .waitFor();
  for (const abnormal of updated.abnormal.items)
    await expect(
      page.locator(`[data-result-code="${abnormal.code}"]`),
    ).toBeVisible();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/results.json`,
    JSON.stringify(
      {
        allRecordedResults: summary.results.length,
        graphAndPercentForEveryComparableLab: true,
        firstAndZeroBaselinesLabelled: true,
        allAbnormalResultsVisibleWithoutExpansion: true,
        widths: [320, 390, 1440],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS all ${summary.results.length} recorded lab cards; graph and signed percentage for all comparable labs; zero/first results; 320/390/1440 layouts`,
  );
} finally {
  await browser.close();
}
