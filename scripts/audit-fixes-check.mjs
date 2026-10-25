// Synthetic-only browser regression for the 19 October BP/pregnancy audit.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";

const base = process.env.CARDIO_BASE_URL ?? "http://127.0.0.1:4310";
const output = process.argv[2] ?? "/tmp/cardioflow-fixes-check";
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const api = (path, body) => page.evaluate(async ({ path, body }) => {
  const session = await (await fetch("/api/session")).json();
  const response = await fetch("/api" + path, body ? {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": session.csrf },
    body: JSON.stringify(body),
  } : {});
  const result = await response.json();
  if (!response.ok) throw Error(JSON.stringify(result));
  return result;
}, { path, body });
const create = async (name) => (await api("/patients", {
  name: `Synthetic audit ${name}`,
  mrn: `AUD-FIX-${Date.now()}-${name}`,
  sex: "Female",
  birthDate: "1992-01-01",
  sample: true,
  conditions: ["htn"],
})).id;

try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  const today = (await api("/health")).today;
  const bpId = await create("bp");
  await page.goto(`${base}/patients/${bpId}`);
  const bp = page.getByRole("region", { name: "Blood pressure" });
  await bp.getByRole("button", { name: "Record Blood pressure: BP" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Systolic BP", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Diastolic BP", { exact: true })).toBeVisible();
  await dialog.getByLabel("Systolic BP", { exact: true }).fill("125");
  await dialog.getByRole("button", { name: /Save 1 result/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.goto(`${base}/patients/${bpId}`);
  await expect(page.getByRole("region", { name: "Blood pressure" })).toContainText("Incomplete reading");
  await expect(page.getByRole("region", { name: "Blood pressure" })).not.toContainText("On track");
  await page.getByRole("region", { name: "Blood pressure" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/bp-phone.png`, animations: "disabled" });

  const pregnancyId = await create("pregnancy");
  const edd = new Date(Date.parse(today) + 196 * 86400000).toISOString().slice(0, 10);
  await api(`/patients/${pregnancyId}/history`, { add: [{ code: "pregnancy-care", attributes: { phase: "Pregnant", edd, mwho: "I" } }] });
  await api(`/patients/${pregnancyId}/observations`, { effectiveAt: new Date().toISOString(), items: [
    { code: "sbp", value: 148 }, { code: "dbp", value: 94 }, { code: "haemoglobin", value: 11.5 },
  ] });
  await page.goto(`${base}/patients/${pregnancyId}`);
  await expect(page.getByRole("region", { name: "Blood pressure" })).toContainText("Above pregnancy target");
  await expect(page.getByRole("region", { name: "Blood count & iron" })).toHaveCount(0);
  // the Consult overview (25 Oct 2026): a problem's decision is its card
  const care = page.locator('.cx-dec[data-problem="Pregnancy & heart disease"]');
  await expect(care.getByRole("button", { name: "Review pregnancy care" })).toHaveCount(1);
  const screening = (await api(`/patients/${pregnancyId}/summary`)).attention.find((a) => a.rule_id === "cardiorenal.screening");
  expect(screening.title).toContain("serum creatinine");
  expect(screening.detail).not.toContain("finerenone");
  await page.getByRole("region", { name: "Blood pressure" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/pregnancy-phone.png`, animations: "disabled" });

  await api(`/patients/${pregnancyId}/observations`, { effectiveAt: new Date().toISOString(), items: [
    { code: "creatinine", value: 65 }, { code: "uacr", value: 1 },
  ] });
  await page.goto(`${base}/patients/${pregnancyId}`);
  const kidney = page.getByRole("region", { name: "Kidney & potassium" });
  // since 20 Oct 2026 each result lives once, in its problem card (normal ones as one line); never eGFR in pregnancy
  await expect(kidney).toContainText("Cr 65");
  await expect(kidney).not.toContainText("eGFR");
  await expect(page.locator(".cx-rail")).not.toContainText("eGFR");
  await kidney.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/pregnancy-kidney-phone.png`, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${output}/pregnancy-desktop.png`, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  console.log("BP and pregnancy browser regression passed; screenshots in", output);
} finally {
  await browser.close();
}
