import { expect, test } from "@playwright/test";

test("quick multi-lab entry, dated plan and next visit share one patient journey", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Patient display name").fill("Journey Flow Sample");
  await page.getByLabel("Synthetic MRN").fill("SYN-JOURNEY-55");
  await page.getByLabel("Birth date", { exact: true }).fill("1960-01-01");
  await page.getByLabel("Sex", { exact: true }).selectOption("Male");
  await page.getByText("Additional reusable patient details").click();
  await page.getByRole("button", { name: "Chronic kidney disease" }).click();
  await page.getByRole("button", { name: "Create patient" }).click();

  await expect(
    page.getByRole("heading", { name: "What Changed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add labs" }).click();
  await page.getByRole("button", { name: "Renal profile" }).click();
  await expect(page.getByLabel("Test 1")).toHaveValue("creatinine");
  await expect(page.getByLabel("Unit 1")).toHaveValue("µmol/L");
  for (const [index, value] of ["88", "140", "4.5", "6.2"].entries())
    await page
      .getByRole("spinbutton", { name: `Result ${index + 1}` })
      .fill(value);
  await page.getByRole("button", { name: "Save 4 results" }).click();
  await page.getByRole("tab", { name: "Investigations" }).click();
  await expect(page.getByText("88 µmol/L", { exact: true })).toBeVisible();
  await expect(page.getByText("4.5 mmol/L", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Plan & Follow-up" }).click();
  await page.getByRole("button", { name: "Plan next action" }).click();
  await page.getByLabel("Action type").selectOption("laboratory");
  await page.getByLabel("What needs to happen?").fill("Review renal profile");
  await page.getByRole("button", { name: "Add to plan" }).click();
  await expect(
    page.getByRole("button", { name: /Review renal profile/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Draft plan note" }).click();
  await expect(page.getByLabel("Editable plan note")).toHaveValue(
    /Review renal profile/,
  );
  await page
    .getByLabel("Editable plan note")
    .fill("Renal profile reviewed. Repeat renal monitoring is planned.");
  await page.getByRole("button", { name: "Save reviewed note" }).click();
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(page.getByText("Clinical plan note").first()).toBeVisible();

  await page.getByRole("button", { name: "New visit / admission" }).click();
  await expect(
    page.getByLabel("Since last review").getByText("Review renal profile"),
  ).toBeVisible();
  await page.getByLabel("Reason for visit / admission").fill("Renal review");
  await page.getByLabel("Responsible clinician / team").fill("Cardiology team");
  await page.getByRole("button", { name: "Open care context" }).click();
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(
    page
      .locator(".patient-timeline summary")
      .filter({ hasText: "Renal review" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Plan & Follow-up" }).click();
  await expect(
    page.getByRole("button", { name: /Review renal profile/ }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("button", { name: "Open Journey Flow Sample" }).click();
  await page.getByRole("tab", { name: "Plan & Follow-up" }).click();
  await page.getByRole("button", { name: /Review renal profile/ }).click();
  await page
    .getByLabel("Outcome / action taken")
    .fill("Renal profile reviewed at OPD follow-up");
  await page.getByRole("button", { name: "Complete action" }).click();
  await expect(
    page.getByRole("button", { name: /Review renal profile/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
