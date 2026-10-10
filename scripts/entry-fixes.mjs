// Synthetic browser regression: visit continuity, keyboard entry, draft protection.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.argv[2] || "/tmp/entry-fixes";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:4310");
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const pat = await page.evaluate(async () => {
    const session = await (await fetch("/api/session")).json();
    const response = await fetch("/api/patients", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrf,
      },
      body: JSON.stringify({
        name: "Synthetic entry flow",
        mrn: "ENTRY-" + Date.now(),
        sex: "Male",
        birthDate: "1960-01-01",
        conditions: ["hfref"],
        sample: true,
      }),
    });
    if (!response.ok) throw Error(await response.text());
    return response.json();
  });
  await page.goto(`http://127.0.0.1:4310/patients/${pat.id}`);
  await page
    .getByRole("button", { name: "Start clinic visit", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Start clinic visit", exact: true })
    .getByRole("button", { name: "Heart failure", exact: true })
    .click();
  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.getByLabel("Systolic BP").fill("118");
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page.getByText("Needs a decision", { exact: true }).waitFor();
  const visit = page.getByRole("dialog", { name: "Clinic visit", exact: true });
  await visit
    .getByRole("button", { name: "Add labs", exact: true })
    .scrollIntoViewIfNeeded();
  const scrollBefore = await visit
    .locator(".drawer-body")
    .evaluate((e) => e.scrollTop);
  await visit.getByRole("button", { name: "Add labs", exact: true }).click();
  const labs = page.getByRole("dialog", { name: "Add results", exact: true });
  await labs.waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "lab-creatinine",
  );
  await page.getByLabel("Creatinine", { exact: true }).fill("100");
  await page.keyboard.press("Alt+u");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Creatinine unit");
  await page.getByLabel("Creatinine", { exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "lab-urea",
  );
  await page.getByLabel("Lab panel").selectOption("hf");
  assert.equal(
    await page.getByLabel("Creatinine", { exact: true }).inputValue(),
    "100",
  );
  const declineDiscard = (d) => d.dismiss();
  page.on("dialog", declineDiscard);
  await page.keyboard.press("Escape");
  assert.equal(await labs.count(), 1);
  assert.equal(
    await page.getByLabel("Creatinine", { exact: true }).inputValue(),
    "100",
  );
  page.off("dialog", declineDiscard);
  await page.screenshot({ path: `${out}/01-labs-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/02-labs-phone.png` });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  // Tab cannot reach the page behind the modal, including after keyboard shortcuts.
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement
          .closest('[role="dialog"]')
          ?.getAttribute("aria-label"),
      ),
      "Add results",
    );
  }
  await labs.getByRole("button", { name: /^Save 1 result$/ }).click();
  await visit.getByText("Needs a decision", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1);
  // Desktop position is kept independently of the phone layout used for entry.
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await visit.locator(".drawer-body").evaluate((e) => e.scrollTop),
    scrollBefore,
  );
  await page.screenshot({ path: `${out}/03-return-to-decisions.png` });
  await visit
    .getByRole("button", { name: "Add medicines", exact: true })
    .click();
  await page.getByRole("dialog", { name: /Add medicines/ }).waitFor();
  await page.keyboard.press("Escape");
  await visit.getByText("Needs a decision", { exact: true }).waitFor();
  await visit.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(await page.getByLabel("Systolic BP").inputValue(), "118");
  await visit
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await visit
    .getByRole("button", { name: "Continue to note", exact: true })
    .click();
  const note = page.getByLabel("Clinic note", { exact: true });
  await note.waitFor();
  await note.fill("Synthetic clinician draft to retain");
  page.on("dialog", declineDiscard);
  await page.keyboard.press("Escape");
  assert.equal(await note.inputValue(), "Synthetic clinician draft to retain");
  page.off("dialog", declineDiscard);
  await visit
    .getByRole("button", { name: "Finish visit", exact: true })
    .click();
  await page.getByText(/Visit closed/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: focus, Tab progression/trap, panel preservation, draft protection, action save/cancel return, assessment retention, phone overflow, note completion",
  );
} finally {
  await browser.close();
}
