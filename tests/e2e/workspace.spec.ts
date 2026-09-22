import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
async function enter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "My Worklist", exact: true }),
  ).toBeVisible();
}
test("dashboard and registry navigation render without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await enter(page);
  await expect(
    page.getByLabel("Worklist summary").getByText(/inpatients/),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("textbox", { name: "Search patients" }).fill("Amal");
  await expect(
    page.getByRole("button", { name: "Open Amal Sample", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Omar Sample", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Registries & Analytics", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "CAD template specification" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("clinical governance is restricted and shows evidence without active disease rules", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enter(page);
  await expect(
    page.getByRole("button", { name: "Clinical governance", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Demo role").selectOption("reviewer");
  await page
    .getByRole("button", { name: "Clinical governance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence & rule publication" }),
  ).toBeVisible();
  await expect(page.getByText("9", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Rule publication" }).click();
  await expect(
    page.getByText("No clinical rules have been created"),
  ).toBeVisible();
  await expect(page.getByText("Maker-checker enforced")).toBeVisible();
  expect(errors).toEqual([]);
});
test("register, save CAD with two lesions and one stent, finalize, and independently review", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enter(page);
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Patient display name").fill("Browser Sample");
  await page.getByLabel("Synthetic MRN").fill("SYN-BROWSER");
  await page.getByLabel("Birth date", { exact: true }).fill("1978-06-12");
  await page.getByLabel("Sex", { exact: true }).selectOption("Female");
  await page.getByLabel("Enroll in CAD registry (optional)").check();
  await page.getByRole("button", { name: "Create patient" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser Sample" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Registries" }).click();
  await page.getByRole("button", { name: "Open CAD episode" }).click();
  await page.getByRole("button", { name: "New episode" }).click();
  await page.getByLabel("Index admission date").fill("2025-01-31");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByLabel("Presentation type").selectOption("NSTEMI");
  await page.getByRole("tab", { name: "Angiography & PCI" }).click();
  await page.getByLabel("Access site").selectOption("Radial");
  await page.getByLabel("Management strategy").selectOption("PCI");
  await page.getByRole("button", { name: "Add lesion", exact: true }).click();
  await page.getByLabel("Vessel", { exact: true }).selectOption("LAD");
  await page.getByLabel("Segment", { exact: true }).selectOption("Proximal");
  await page.getByLabel("Stenosis (%)").fill("90");
  await page.getByLabel("Treatment", { exact: true }).selectOption("PCI");
  await page.getByRole("button", { name: "Add stent", exact: true }).click();
  await page.getByLabel("Diameter (mm)").fill("3");
  await page.getByLabel("Length (mm)").fill("24");
  await page.getByLabel("Type", { exact: true }).selectOption("DES");
  await page.getByRole("button", { name: "Add lesion", exact: true }).click();
  await page.getByLabel("Vessel", { exact: true }).nth(1).selectOption("RCA");
  await page.getByLabel("Segment", { exact: true }).nth(1).selectOption("Mid");
  await page.getByLabel("Stenosis (%)").nth(1).fill("50");
  await page
    .getByLabel("Treatment", { exact: true })
    .nth(1)
    .selectOption("Medical therapy");
  await page.getByRole("tab", { name: "Discharge" }).click();
  await page.getByLabel("Discharge date", { exact: true }).fill("2025-02-02");
  await page.getByLabel("Discharge status").selectOption("Alive");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved to the server.")).toBeVisible();
  await page
    .getByRole("button", { name: "Finalize record", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finalize record", exact: true })
    .click();
  await expect(
    page.getByText("Awaiting independent review", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Demo role").selectOption("reviewer");
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Browser Sample", exact: true })
    .click();
  await page.getByRole("tab", { name: "Registries" }).click();
  await page.getByRole("button", { name: "Open CAD episode" }).click();
  await page.getByRole("button", { name: "Approve review" }).click();
  await expect(
    page.getByText("Independently reviewed", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("follow-up contact records an encounter and satisfies a qualifying milestone", async ({
  page,
}) => {
  await enter(page);
  await page.getByRole("button", { name: "Worklist", exact: true }).click();
  await page
    .getByRole("button", { name: "Registry follow-up", exact: true })
    .click();
  await page.getByRole("button", { name: /Browser Sample/ }).click();
  await page
    .getByLabel("Needs attention")
    .getByRole("button", { name: /1-month CAD follow-up/ })
    .click();
  await page.getByLabel("Contact date").fill("2025-02-28");
  await page.getByLabel("Contact type").selectOption("Telephone");
  await page.getByLabel("Vital status").selectOption("Alive");
  await page.getByLabel("Rehospitalized since index?").selectOption("No");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByText("Contact recorded and milestone satisfied."),
  ).toBeVisible();
});
test("analyst generates CSV and codebook; designer sees no patient navigation", async ({
  page,
}) => {
  await enter(page);
  await page.getByLabel("Demo role").selectOption("analyst");
  await page.getByRole("button", { name: "Research exports" }).click();
  await page
    .getByLabel("Purpose of export")
    .fill("Synthetic browser acceptance testing");
  await page.getByRole("button", { name: "Generate dataset" }).click();
  await expect(page.getByText("Export ready", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const exportedFile = await download;
  const exportedBytes = await readFile((await exportedFile.path())!);
  expect(createHash("sha256").update(exportedBytes).digest("hex")).toBe(
    await page.locator(".export-result code").textContent(),
  );
  expect(exportedFile.suggestedFilename()).toBe("cardio-flow-cad-episodes.csv");
  await page.getByLabel("Demo role").selectOption("designer");
  await expect(
    page.getByRole("heading", { name: "Registry overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Patients", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/patients")).status()).toBe(403);
});
test("mobile dashboard and navigation fit a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Patients", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/mobile.png",
    animations: "disabled",
    fullPage: true,
  });
});

test("global patient search opens a patient and the workspace fits tablet landscape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enter(page);
  await page.getByLabel("Search all patients").fill("SYN-CONTINUITY");
  await page
    .getByRole("button", { name: "Open Hassan Sample", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hassan Sample", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Summary" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1024);
});
