import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.CARDIO_BASE_URL ?? "http://127.0.0.1:4310";
const out = process.argv[2] ?? "/tmp/cardio-medication-review";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [];
page.setDefaultTimeout(15000);
// pathways open on the decision (23 Oct 2026); this walkthrough drives the step-by-step questions
await page.addLocatorHandler(page.getByRole("button", { name: "Change details", exact: true }), (b) => b.click());
page.on("pageerror", (e) => errors.push(e.message));
const api = (path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const session = await (await fetch("/api/session")).json();
      const r = await fetch(
        "/api" + path,
        body
          ? {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": session.csrf,
              },
              body: JSON.stringify(body),
            }
          : {},
      );
      const data = await r.json();
      if (!r.ok) throw Error(path + ": " + JSON.stringify(data));
      return data;
    },
    { path, body },
  );
const shot = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: out + "/" + name + ".png" });
};
const closeEntry = async () => {
  const next = page.getByRole("button", {
    name: "Continue data entry",
    exact: true,
  });
  if (await next.isVisible()) await next.click();
};
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const id = (
    await api("/patients", {
      name: "Synthetic medication review phone",
      mrn: "MED-UI-" + Date.now(),
      sex: "Female",
      birthDate: "1955-01-01",
      sample: true,
      conditions: ["af"],
    })
  ).id;
  await api(`/patients/${id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: [
      { code: "creatinine", value: 85 },
      { code: "weight", value: 70 },
    ],
  });
  for (const [code, doseValue, frequency] of [
    ["apixaban", 5, "BID"],
    ["amiodarone", 200, "OD"],
    ["ibuprofen", 400, "TID"],
    ["bisoprolol", null, "OD"],
  ])
    await api(`/patients/${id}/medications`, {
      code,
      doseValue,
      frequency,
      route: "PO",
      indication: code === "apixaban" ? "af" : "other",
      alreadyTaking: true,
    });
  await page.goto(base + `/patients/${id}/medications`);
  const review = page.getByRole("region", {
    name: "Medication review",
    exact: true,
  });
  await review.waitFor();
  await expect(
    review.getByText("Ibuprofen with Apixaban: increased bleeding risk", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    review.getByText(/Bisoprolol: complete the recorded regimen/),
  ).toBeVisible();
  await review.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot("01-phone-review");
  await review.getByRole("button", { name: /Safety & doses/ }).click();
  await expect(
    review.getByText("Ibuprofen with Apixaban: increased bleeding risk", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(review.getByText(/Bisoprolol: complete/)).toHaveCount(0);
  await review.getByRole("button", { name: /Medication list/ }).click();
  await review
    .getByRole("button", { name: "Complete regimen", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Correct Bisoprolol" }),
  ).toBeVisible();
  await dialog.getByLabel("Dose", { exact: true }).selectOption("5");
  await dialog
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await closeEntry();
  await page.reload();
  await review.waitFor();
  const record = await api(`/patients/${id}/record`),
    bb = record.meds.find((m) => m.code === "bisoprolol");
  expect(bb.doseValue).toBe(5);
  expect(bb.startedAt).toBeNull();
  await expect(review.getByText(/Bisoprolol: complete/)).toHaveCount(0);
  await expect(
    review.getByRole("button", { name: "Plan due checks", exact: true }),
  ).toBeVisible();
  await review
    .getByRole("article")
    .filter({ hasText: "Medication monitoring is due" })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("heading", {
      name: "Plan medication checks",
      exact: true,
    })
    .waitFor();
  const day = record.today,
    manual = day.slice(8, 10) + day.slice(5, 7) + day.slice(0, 4);
  const date = dialog.getByRole("textbox", { name: "Test date", exact: true });
  await date.fill("");
  await date.pressSequentially(manual);
  await shot("02-phone-monitoring-date");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    dialog.getByText(/Medication monitoring blood tests/).first(),
  ).toBeVisible();
  await dialog.getByRole("button", { name: /Confirm|Record decision/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await closeEntry();
  const after = await api(`/patients/${id}/record`);
  const checks = after.plan.filter(
    (p) => p.title === "Medication monitoring blood tests",
  );
  expect(checks).toHaveLength(1);
  expect(checks[0].dueDate).toBe(day);
  expect(
    after.medicationReview.issues.some((r) =>
      /increased bleeding risk/.test(r.title),
    ),
  ).toBe(true);
  const codes = (await api(`/patients/${id}/record`)).plan.find(
    (p) => p.title === "Medication monitoring blood tests",
  );
  // Complete with one actual collection, then verify the existing results-to-review projection.
  const values = { haemoglobin: 12.5, creatinine: 85, alt: 20, tsh: 2 };
  await api(`/patients/${id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: Object.entries(values).map(([code, value]) => ({ code, value })),
  });
  const completed = await api(`/patients/${id}/record`);
  expect(
    completed.plan.find((p) => p.title === codes.title).awaitingReview,
  ).toBe(true);
  await page.reload();
  await review.waitFor();
  await review.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot("03-phone-after-results");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await review.evaluate(el=>el.scrollIntoView({block:"start"}));
  await shot("04-desktop-review");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await review
      .locator(".med-review-row")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    out + "/results.json",
    JSON.stringify(
      {
        passed: true,
        scenarios: [
          "phone prioritization and filters",
          "missing-dose correction retains unknown start",
          "manual monitoring date and joint panel",
          "safety remains open",
          "matching results await review",
          "desktop layout",
          "reduced motion",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS medication review: phone/desktop, corrections, one dated panel, retained safety, results review, reduced motion",
  );
} catch (e) {
  await page.screenshot({ path: out + "/failure.png" });
  fs.writeFileSync(
    out + "/results.json",
    JSON.stringify({ passed: false, error: e.message, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
