import { expect, test } from "@playwright/test";

test("HF discharge review creates continuing tasks for the next OPD visit", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Patient display name").fill("HF Discharge Sample");
  await page.getByLabel("Synthetic MRN").fill("SYN-HF-DISCHARGE-55");
  await page.getByLabel("Birth date", { exact: true }).fill("1960-01-01");
  await page.getByLabel("Sex", { exact: true }).selectOption("Female");
  await page.getByRole("button", { name: "Create patient" }).click();
  await page.getByRole("button", { name: "New visit / admission" }).click();
  await page.getByLabel("Care setting").selectOption("Admission");
  await page.getByLabel("Reason for visit / admission").fill("HF admission");
  await page.getByLabel("Responsible clinician / team").fill("Cardiology team");
  await page.getByRole("button", { name: "Open care context" }).click();
  await page.getByRole("tab", { name: "Current Visit" }).click();
  await page
    .getByRole("button", { name: "Heart failure", exact: true })
    .click();
  await page.getByRole("button", { name: "Discharge plan" }).click();
  const wizard = page.getByRole("dialog", {
    name: "HF discharge and follow-up",
  });
  await expect(wizard.getByLabel("Admission / visit context")).toHaveValue(
    /.+/,
  );
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByRole("button", { name: "Clinically stable" }).click();
  await wizard.getByRole("button", { name: "Medicines reconciled" }).click();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByLabel("Renal and electrolyte review").fill("2026-09-30");
  await wizard.getByLabel("HF clinic").fill("2026-10-07");
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard
    .getByLabel("Additional context")
    .fill("Synthetic handover reviewed");
  await wizard.getByLabel("Close this admission").check();
  await wizard.getByRole("button", { name: "Save discharge plan" }).click();
  await page.getByRole("tab", { name: "Plan & Follow-up" }).click();
  await expect(
    page.getByRole("button", {
      name: /Post-discharge renal and electrolyte review/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Heart failure post-discharge clinical review/,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New visit / admission" }).click();
  await expect(
    page
      .getByLabel("Since last review")
      .getByText("Post-discharge renal and electrolyte review"),
  ).toBeVisible();
  await page
    .getByLabel("Reason for visit / admission")
    .fill("HF post-discharge review");
  await page.getByLabel("Responsible clinician / team").fill("HF clinic");
  await page.getByRole("button", { name: "Open care context" }).click();
  await page.getByRole("tab", { name: "Plan & Follow-up" }).click();
  await expect(
    page.getByRole("button", {
      name: /Heart failure post-discharge clinical review/,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
