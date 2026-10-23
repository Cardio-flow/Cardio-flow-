import { selectLabGroup } from "./select-lab-group.mjs";
// Synthetic clinical entry, compact record, correction and procedure browser regression.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310",
  out = process.argv[2] || "/tmp/cardio-lab-record";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  ),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
// pathways open on the decision (23 Oct 2026); this walkthrough drives the step-by-step questions
await page.addLocatorHandler(page.getByRole("button", { name: "Change details", exact: true }), (b) => b.click());
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
      if (!r.ok) throw Error(path + JSON.stringify(j));
      return j;
    },
    { path, body, csrf },
  );
const noOverflow = async () =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
const radio = async (label, value) =>
  await page
    .getByRole("radiogroup", { name: label, exact: true })
    .getByRole("radio", { name: value, exact: true })
    .click();
// red-flag "None" is pre-ticked as assumed since 23 Oct 2026: tick it only if it is not already
const ensureNone = async (scope) => {
  const b = scope.getByRole("button", { name: "None", exact: true });
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
};
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  const p = await api("/patients", {
    name: "Synthetic compact lab review",
    mrn: "LAB-UI-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    sample: true,
    conditions: ["hfref", "af", "htn", "dyslipidaemia"],
  });
  await api(`/patients/${p.id}/echo`, {
    date: new Date().toISOString(),
    quality: "formal",
    lvef: 20,
    findings: [],
  });
  await api(`/patients/${p.id}/medications`, {
    code: "atorvastatin",
    doseValue: 40,
    frequency: "OD",
    route: "PO",
    indication: "cad",
    effectiveAt: new Date().toISOString(),
  });
  await api(`/patients/${p.id}/studies`, {
    kind: "ecg",
    date: new Date().toISOString(),
    findings: {
      rhythm: "Sinus rhythm",
      rate: 70,
      qrs: 90,
      qrsMorphology: "Normal",
    },
  });
  await page
    .getByRole("button", { name: "Sample patients", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Sample patients", exact: true })
    .waitFor();
  await page.evaluate((path) => {
    history.pushState({}, "", path);
    window.dispatchEvent(new Event("cf:navigate"));
  }, `/patients/${p.id}/investigations`);
  await page
    .getByRole("heading", { name: "Synthetic compact lab review", exact: true })
    .waitFor();
  await expect(page.locator(".diagnosis-line")).toContainText("HFrEF EF 20%");
  for (const selector of [".diagnosis-line", ".risk-line"])
    assert.ok((await page.locator(selector).boundingBox()).height <= 48);
  assert.equal(
    await page
      .locator(".patient-lines")
      .getByText(/not recorded/i)
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Edit diagnoses", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Diagnoses", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await noOverflow();
  await page.screenshot({
    path: out + "/01-phone-record.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Add study", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Search study types", exact: true })
    .fill("abpm");
  await expect(
    page.getByRole("button", { name: /Ambulatory BP monitoring/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Add procedure", exact: true })
    .click();
  await page.getByRole("button", { name: /^Renal denervation/ }).click();
  await page
    .getByRole("dialog", { name: "Record renal denervation", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  const before = await api(`/patients/${p.id}/record`),
    ecg = before.studies.find((s) => s.kind === "ecg");
  await page
    .locator("tr")
    .filter({ has: page.getByText("ECG", { exact: true }) })
    .getByRole("button", { name: "Remove entry", exact: true })
    .click();
  await radio("Why is it wrong", "Wrong entry");
  await page
    .getByRole("button", { name: "Remove from the record", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await expect(
    page.locator("tr").filter({ has: page.getByText("ECG", { exact: true }) }),
  ).toHaveCount(0);
  assert.ok(
    !(await api(`/patients/${p.id}/record`)).studies.some(
      (s) => s.id === ecg.id,
    ),
  );
  assert.equal(
    await page.getByText("Entered in error", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Add labs", exact: true })
    .first()
    .click();
  await selectLabGroup(page, "Statin safety");
  await page.getByLabel("Creatine kinase (CK)", { exact: true }).fill("2400");
  await page
    .getByLabel("Creatine kinase (CK) upper reference limit", { exact: true })
    .fill("200");
  await page.getByLabel("ALT", { exact: true }).fill("180");
  await page
    .getByLabel("ALT upper reference limit", { exact: true })
    .fill("40");
  await page.getByLabel("Creatinine", { exact: true }).fill("90");
  for (const [term, label, value] of [
    ["haemoglobin", "Haemoglobin", "10"],
    ["vitamin", "25-OH Vitamin D", "15"],
  ]) {
    await page.getByRole("button", { name: "+ Any test", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Search tests", exact: true })
      .fill(term);
    await page
      .getByRole("button", { name: new RegExp(label.replace(/[()]/g, "\\$&")) })
      .click();
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await noOverflow();
  await page.screenshot({
    path: out + "/02-lab-entry-phone.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Save 5 results", exact: true })
    .click();
  const next = page.getByRole("dialog", {
    name: "Results → next steps",
    exact: true,
  });
  await next.waitFor();
  await next.getByRole("heading", { name: /CK 12.0× ULN/ }).waitFor();
  await noOverflow();
  await page.screenshot({
    path: out + "/03-auto-pathways-phone.png",
    animations: "disabled",
  });
  const card = next
    .locator(".next-step-card")
    .filter({ has: page.getByRole("heading", { name: /CK 12.0× ULN/ }) });
  await card.getByText("Why?", { exact: true }).click();
  await expect(card).toContainText("PUBLISHED");
  await card
    .getByRole("button", { name: "Review statin CK", exact: true })
    .click();
  await ensureNone(page.getByRole("dialog"));
  await radio("Muscle symptoms", "No muscle symptoms");
  await page
    .getByRole("button", {
      name: "Continue to suggested statin action & follow-up",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^Stop statin; assess renal function and rhabdomyolysis/,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("CK / renal review exact date", { exact: true }),
  ).toBeVisible();
  await noOverflow();
  await page.screenshot({
    path: out + "/04-ck-suggestions-phone.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await api(`/patients/${p.id}/record`)).meds.find(
      (m) => m.code === "atorvastatin",
    ).status,
    "stopped",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await noOverflow();
  await page.screenshot({
    path: out + "/05-desktop-record.png",
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Compact headers, searchable studies, audited removal, RDN procedure, automatic lab pathways, report limits and confirmed statin care passed.",
  );
} catch (error) {
  await page.screenshot({ path: out + "/failure.png" });
  console.log(
    "Dialog diagnostics",
    await page.getByRole("dialog").allTextContents(),
    "Page errors",
    errors,
  );
  throw error;
} finally {
  await browser.close();
}
