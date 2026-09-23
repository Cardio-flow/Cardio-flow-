import { test, expect } from "@playwright/test";

test("clinician documents coronary care once and reuses it across the patient workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Patient display name").fill("Coronary Journey Sample");
  await page.getByLabel("Synthetic MRN").fill("SYN-CORONARY-E2E");
  await page.getByLabel("Birth date", { exact: true }).fill("1960-01-01");
  await page.getByLabel("Sex", { exact: true }).selectOption("Male");
  await page.getByRole("button", { name: "Create patient" }).click();

  await page.getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("dialog", { name: "Add or update the patient record" })
    .getByRole("button", { name: /^Coronary care/ })
    .click();
  let editor = page.getByRole("dialog", { name: "Record coronary care" });
  await editor.getByLabel("Coronary state").selectOption("SUSPECTED_CAD");
  await editor
    .getByLabel("Clinical detail / historical context")
    .fill("Exertional chest discomfort under assessment");
  await editor.getByRole("button", { name: "Save to patient record" }).click();

  await page.getByRole("tab", { name: "Current Visit" }).click();
  await page
    .getByRole("button", { name: "Coronary care", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Coronary disease" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("tabpanel", { name: "Current Visit" })
      .getByText("SUSPECTED CAD", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("dialog", { name: "Add or update the patient record" })
    .getByRole("button", { name: /^Coronary care/ })
    .click();
  editor = page.getByRole("dialog", { name: "Record coronary care" });
  await editor.getByRole("button", { name: "ACS presentation" }).click();
  await editor.getByLabel("Working diagnosis").selectOption("NSTEMI");
  await editor.getByLabel("Diagnostic status").selectOption("CONFIRMED");
  await editor.getByLabel("Chest discomfort").selectOption("yes");
  await editor
    .getByLabel("Clinician assessment")
    .fill("Clinician-confirmed synthetic NSTEMI presentation");
  await editor.getByRole("button", { name: "Save to patient record" }).click();

  await expect(
    page
      .getByRole("tabpanel", { name: "Current Visit" })
      .getByText("CURRENT ACS", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".coronary-dashboard strong").filter({ hasText: /^NSTEMI$/ }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Journey", exact: true }).click();
  await page.getByRole("button", { name: "View full clinical record" }).click();
  await expect(
    page.getByRole("heading", { name: "Coronary clinical record" }),
  ).toBeVisible();
  await expect(
    page.getByText("Clinician-confirmed synthetic NSTEMI presentation"),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Journey", exact: true }).click();
  await page.getByText("Specialty event details").click();
  await expect(
    page.getByRole("heading", { name: "Coronary journey", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".coronary-timeline")
      .getByText("NSTEMI presentation", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Registries", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "CAD registry clinical data" }),
  ).toBeVisible();
  await expect(page.getByText("✓ Presentation")).toBeVisible();
  await page.getByRole("button", { name: "Start CAD registry" }).click();
  const registry = page.getByRole("dialog", {
    name: "CAD registry · source draft",
  });
  await registry.getByLabel("Find a registry field").fill("Presentation Type");
  await expect(registry.getByLabel("Presentation Type")).toHaveValue("NSTEMI");
  await expect(
    registry.getByText(/fields prefilled from the clinical record/),
  ).toBeVisible();
  await registry.getByRole("button", { name: "Close dialog" }).click();
  expect(errors).toEqual([]);
});
