import { test, expect } from "@playwright/test";

test("clinician records one shared Echo and reviews it across Summary, Record and Timeline", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Patient display name").fill("Echo Valve Sample");
  await page.getByLabel("Synthetic MRN").fill("SYN-ECHO-VALVE");
  await page.getByLabel("Birth date", { exact: true }).fill("1955-01-01");
  await page.getByLabel("Sex", { exact: true }).selectOption("Male");
  await page.getByRole("button", { name: "Create patient" }).click();

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: /^Echo study/ }).click();
  const editor = page.getByRole("dialog", {
    name: "Add structured Echo study",
  });
  await editor.getByLabel("Status").selectOption("FINAL");
  await editor.getByRole("button", { name: "Known valve disease" }).click();
  await editor.locator('input[type="number"]').first().fill("32");
  await editor.getByLabel("Lesion").selectOption("STENOSIS");
  await editor.getByLabel("Clinician severity").selectOption("SEVERE");
  await editor.getByLabel("Mechanism").fill("Calcific morphology");
  await editor.getByRole("button", { name: "LVEF" }).click();
  await editor
    .getByLabel("Clinician conclusion")
    .fill(
      "Reduced LV systolic function with clinician-confirmed severe aortic stenosis.",
    );
  await editor.getByRole("button", { name: "Finalize Echo" }).click();

  await page.getByRole("tab", { name: "Current Visit" }).click();
  await page.getByRole("button", { name: "Echo & valve", exact: true }).click();
  await expect(page.getByText("Current preferred study")).toBeVisible();
  await expect(page.getByText("32%", { exact: true })).toBeVisible();
  await expect(page.getByText("Severe", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Valve assessment" }).click();
  const pathway = page.getByRole("dialog", {
    name: "Valve intervention assessment",
  });
  await pathway
    .getByLabel("What we know")
    .fill("Severe AS confirmed\nLVEF 32%");
  await pathway.getByLabel("What is missing").fill("Structured symptom status");
  await pathway
    .getByLabel("Why it matters")
    .fill("Clinical context changes intervention timing.");
  await pathway
    .getByLabel("Next decision")
    .fill("Complete symptom review and discuss with Heart Team.");
  await pathway.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("tab", { name: "Journey", exact: true }).click();
  await page.getByRole("button", { name: "View full clinical record" }).click();
  await expect(
    page.getByRole("heading", { name: "Echo & valve record" }),
  ).toBeVisible();
  await expect(page.getByText("Severe As", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Journey", exact: true }).click();
  await page.getByText("Specialty event details").click();
  await expect(
    page.getByRole("heading", { name: "Echo & valve journey" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Reduced LV systolic function with clinician-confirmed severe aortic stenosis.",
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
