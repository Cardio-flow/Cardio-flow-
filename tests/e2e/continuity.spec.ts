import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("Care-only admission, discharge, linked OPD review, history and report persist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Patient display name").fill("Care Journey Sample");
  await page.getByLabel("Synthetic MRN").fill("SYN-CARE-JOURNEY");
  await page.getByLabel("Birth date", { exact: true }).fill("1970-01-01");
  await page.getByLabel("Sex", { exact: true }).selectOption("Female");
  await page.getByRole("button", { name: "Create patient" }).click();
  await expect(
    page.getByRole("heading", { name: "Care Journey Sample" }),
  ).toBeVisible();
  await expect(
    page.getByText("Care record · registry enrollment optional"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start encounter" }).click();
  await page.getByLabel("Care setting").selectOption("Admission");
  await page.getByLabel("Start date").fill("2025-02-01");
  await page.getByLabel("Reason for encounter").fill("Synthetic ACS admission");
  await page.getByLabel("Responsible clinician / team").fill("Ward team");
  await page.getByRole("button", { name: "Open encounter" }).click();
  await page
    .getByRole("button", { name: "Decision / next action", exact: true })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Review residual disease");
  await page.getByLabel("Clinical family").selectOption("CAD");
  await page.getByLabel("Event date").fill("2025-02-02");
  await page.getByLabel("Origin encounter").selectOption({
    label: "Admission · 1 Feb 2025 · Synthetic ACS admission",
  });
  await page.getByLabel("Responsible clinician / team").fill("OPD team");
  await page.getByLabel("Review date").fill("2025-02-10");
  await page
    .getByLabel("Decision / action and reason")
    .fill("Review findings at follow-up");
  await page.getByRole("button", { name: "Save care record" }).click();
  await expect(
    page.getByRole("button", { name: /Review residual disease/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discharge / handover" }).click();
  await expect(
    page.getByText("1 outstanding patient reviews will remain active"),
  ).toBeVisible();
  await page.getByLabel("Closure date").fill("2025-02-03");
  await page
    .getByLabel("Handover summary")
    .fill(
      "OPD team to review residual disease and document the selected strategy.",
    );
  await page
    .getByRole("button", { name: "Close encounter; retain care plan" })
    .click();
  await expect(
    page.getByText(
      "OPD team to review residual disease and document the selected strategy.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start encounter" }).click();
  await page.getByLabel("Care setting").selectOption("OPD");
  await page.getByLabel("Start date").fill("2025-02-10");
  await page
    .getByLabel("Reason for encounter")
    .fill("Post-discharge reassessment");
  await page.getByLabel("Responsible clinician / team").fill("OPD team");
  await page.getByLabel("Connect to previous encounter").selectOption({
    label: "Admission · 1 Feb 2025 · Synthetic ACS admission",
  });
  await page.getByRole("button", { name: "Open encounter" }).click();
  await expect(
    page.getByText("Connected to Admission on 1 Feb 2025"),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Care Journey Sample", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Review residual disease/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Care plan", exact: true }).click();
  await page.getByRole("button", { name: "Review / update" }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("completed");
  await page
    .getByLabel("Response / next plan")
    .fill("Synthetic reassessment completed and plan agreed.");
  await page.getByRole("button", { name: "Save care record" }).click();
  await expect(
    page.getByText("Synthetic reassessment completed and plan agreed."),
  ).toBeVisible();
  await expect(
    page.getByText("Recorded review date · 10 Feb 2025"),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("Version 2 · completed")).toBeVisible();
  await expect(page.getByText("Version 1 · pending")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("tab", { name: "Registries & reports" }).click();
  await expect(
    page.getByText("No registry selected for this patient."),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download patient report" }).click();
  const file = await downloaded;
  const report = await readFile((await file.path())!, "utf8");
  expect(report).toContain("Synthetic reassessment completed and plan agreed.");
  expect(report).toContain("Post-discharge reassessment");
  await page
    .getByRole("button", { name: "Enroll in CAD registry", exact: true })
    .click();
  await expect(page.getByText("CAD · enrolled", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "test-results/continuous-care-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/continuous-care-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
