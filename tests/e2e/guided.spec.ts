import { test, expect } from "@playwright/test";
import { medicationChecks } from "../../src/clinical-review";

test("Risk and dose previews require confirmation and retain their calculated evidence", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Hassan Sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Add / Update" }).click();
  await page.getByRole("button", { name: /^Procedure/ }).click();
  await page
    .getByRole("button", { name: /^Noncardiac surgery assessment/ })
    .click();
  await page.getByRole("button", { name: "Continue with 1 selection" }).click();
  await page.getByLabel("Review date").fill("2026-09-20");
  for (const [label, value] of [
    ["Urgency", "Elective"],
    ["Planned procedure scope", "Major noncardiac surgery"],
    ["Planned surgery category", "Intraperitoneal"],
    ["RCRI high-risk procedure criterion", "Yes"],
    ["History of ischaemic heart disease", "Yes"],
    ["History of heart failure", "Yes"],
    ["History of cerebrovascular disease", "No"],
    ["Preoperative insulin therapy", "No"],
    ["Creatinine unit", "mg/dL"],
    ["Expected postoperative stay", "At least 2 days"],
    ["Creatinine relevance", "Confirmed for this assessment"],
  ])
    await page
      .getByRole("combobox", { name: label, exact: true })
      .selectOption(value);
  await page.getByLabel("Preoperative serum creatinine").fill("2");
  await expect(page.getByText("3 / 6 points", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Inputs reviewed for this procedure")
    .selectOption("Confirmed");
  await expect(page.getByText("3 / 6 points", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save 1 guided record" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Clinical Record", exact: true }).click();
  await page.getByRole("button", { name: "Procedures", exact: true }).click();
  await page
    .getByText("Saved reference assessment · draft", { exact: true })
    .click();
  await expect(page.getByText("3 / 6 points", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add / Update" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Medication Record/ })
    .click();
  await page.getByRole("button", { name: /^Apixaban General/ }).click();
  await page.getByRole("button", { name: "Continue with 1 selection" }).click();
  await page.getByLabel("Documented indication").selectOption("Nonvalvular AF");
  await page.getByLabel("Measured body weight").fill("60");
  await page.getByLabel("Serum creatinine", { exact: true }).fill("1.5");
  await page.getByLabel("Creatinine unit").selectOption("mg/dL");
  await page
    .getByLabel("Creatinine relevance")
    .selectOption("Confirmed for this assessment");
  await page.getByLabel("Clinician-verified creatinine clearance").fill("50");
  for (const [, label] of medicationChecks)
    await page
      .getByRole("combobox", { name: label, exact: true })
      .selectOption("Reviewed — absent / not applicable");
  await page
    .getByLabel("Patient context and full label reviewed")
    .selectOption("Confirmed");
  await expect(
    page.getByText("2.5 mg orally twice daily", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Active pathological bleeding / severe apixaban allergy")
    .selectOption("Present — specialist review");
  await expect(
    page.getByText("2.5 mg orally twice daily", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Patient context and full label reviewed"),
  ).toHaveValue("Not yet confirmed");
  await page.getByRole("button", { name: "Save 1 guided record" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.locator(".care-card").filter({
    has: page.getByRole("heading", { name: "Apixaban", exact: true }),
  });
  await card.getByText("Saved reference assessment · draft").click();
  await expect(
    card.getByText("Incomplete — no result", { exact: true }),
  ).toBeVisible();
});

test("Multiple cardiac problems, branching complications, source registry drafts and mobile choices persist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Patient display name").fill("Guided Workflow Sample");
  await page.getByLabel("Synthetic MRN").fill("SYN-GUIDED-UI");
  await page.getByLabel("Birth date", { exact: true }).fill("1940-01-01");
  await page.getByLabel("Sex", { exact: true }).selectOption("Female");
  await page.getByRole("button", { name: "Create patient" }).click();
  await page.getByRole("button", { name: "Add / Update" }).click();
  await page.getByRole("button", { name: /^Problem \/ diagnosis/ }).click();
  await page.getByRole("button", { name: /^Heart failure HF/ }).click();
  await page
    .getByRole("button", { name: /^Atrial fibrillation \/ flutter/ })
    .click();
  await page.screenshot({
    path: "screenshots/guided-problem-picker.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Continue with 2 selections" })
    .click();
  const hf = page.locator(".guided-section").filter({
    has: page.getByRole("heading", { name: "Heart failure", exact: true }),
  });
  const af = page.locator(".guided-section").filter({
    has: page.getByRole("heading", {
      name: "Atrial fibrillation / flutter",
      exact: true,
    }),
  });
  await hf.getByLabel("Diagnostic certainty").selectOption("Confirmed");
  await hf.getByLabel("Heart failure status").selectOption("active");
  await hf.getByLabel("Recorded HF phenotype").selectOption("HFrEF");
  await hf.getByLabel("Measured LVEF").fill("35");
  await hf
    .getByRole("button", { name: "Peripheral oedema", exact: true })
    .click();
  await af.getByLabel("Rhythm diagnosis").selectOption("Atrial fibrillation");
  await af.getByLabel("AF pattern").selectOption("Paroxysmal");
  await af.getByLabel("Rhythm diagnosis").selectOption("Typical flutter");
  await expect(af.getByLabel("AF pattern")).toHaveCount(0);
  await page.getByRole("button", { name: "Save 2 guided records" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Heart failure HF/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add / Update" }).click();
  await page.getByRole("button", { name: /^Complication/ }).click();
  await page.getByRole("button", { name: /^Hyperkalaemia/ }).click();
  await page.getByRole("button", { name: "Continue with 1 selection" }).click();
  await page.getByLabel("Review date").fill("2025-01-01");
  await page.getByLabel("Hyperkalaemia status").selectOption("managing");
  await page.getByLabel("Recorded potassium").fill("5.6");
  await page
    .getByRole("button", { name: "Review renal function", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm potassium result", exact: true })
    .click();
  await page.getByLabel("Recorded response").selectOption("Improving");
  await page.screenshot({
    path: "screenshots/guided-complication.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Save 1 guided record" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .getByLabel("Needs attention")
      .getByRole("button", { name: "Hyperkalaemia Overdue 1 Jan 2025" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Guided Workflow Sample", exact: true })
    .click();
  await page.getByRole("tab", { name: "Clinical Record", exact: true }).click();
  await page.getByRole("button", { name: "Problems", exact: true }).click();
  const afCard = page.locator(".care-card").filter({
    has: page.getByRole("heading", {
      name: "Atrial fibrillation / flutter",
      exact: true,
    }),
  });
  await afCard.getByRole("button", { name: "Review / update" }).click();
  await expect(page.getByLabel("Rhythm diagnosis")).toHaveValue(
    "Typical flutter",
  );
  await expect(page.getByLabel("AF pattern")).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("tab", { name: "Registries" }).click();
  await page.getByRole("button", { name: "Start HF registry" }).click();
  await page
    .getByLabel("Assessment context")
    .selectOption("Extra_Admissions JSON array");
  await page
    .getByPlaceholder("Search symptoms, medications, procedures…")
    .fill("Holter");
  const done = page.locator("#registry-MAP-01215");
  // Source mapping IDs are stable across package versions and retained in exports.
  const holterLabel = page
    .locator(".registry-source-field")
    .filter({ hasText: "MAP-01215" });
  await expect(holterLabel).toBeVisible();
  await done.selectOption("Yes");
  await expect(page.locator("#MAP-01216")).toBeVisible();
  await page.locator("#MAP-01216").fill("2025-01-01");
  await page.getByRole("button", { name: "Save registry draft" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open draft", exact: true }).click();
  await page
    .getByPlaceholder("Search symptoms, medications, procedures…")
    .fill("Holter");
  await expect(page.locator("#MAP-01216")).toHaveValue("2025-01-01");
  await done.selectOption("No");
  await expect(page.locator("#MAP-01216")).toHaveCount(0);
  await page.getByRole("button", { name: "Save registry draft" }).click();
  await page
    .getByRole("button", { name: "Revision history", exact: true })
    .click();
  await expect(page.getByText(/Version 2 ·/)).toBeVisible();
  await expect(page.getByText(/Version 1 ·/)).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await page.getByRole("button", { name: "Add / Update" }).click();
  await page.getByRole("button", { name: /^Problem \/ diagnosis/ }).click();
  await page.getByLabel("Search guided forms").fill("valv");
  await page.getByRole("button", { name: /^Valvular heart disease/ }).click();
  await page.getByRole("button", { name: "Continue with 1 selection" }).click();
  await page.getByRole("button", { name: "Aortic", exact: true }).click();
  await page.getByRole("button", { name: "Mitral", exact: true }).click();
  await page.screenshot({
    path: "screenshots/guided-mobile.png",
    animations: "disabled",
  });
  expect(
    await page
      .locator("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
