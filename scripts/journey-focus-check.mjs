// Synthetic-only Journey detail: decision scope, full-width phone reading and keyboard return.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const out = process.argv[2] || "/tmp/cardio-journey-focus";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
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
      const data = await r.json();
      if (!r.ok) throw Error(path + ": " + JSON.stringify(data));
      return data;
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
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  const today = (await api("/health")).today;
  const p = await api("/patients", {
    name: "Synthetic Journey focus",
    mrn: "JR-" + Date.now(),
    sex: "Male",
    birthDate: "1955-01-01",
    conditions: ["af", "hfref", "htn"],
    sample: true,
  });
  const ctx = await api(`/patients/${p.id}/admissions`, {
    startedAt: today + "T08:00:00+03:00",
    location: "Ward 3B",
    reasons: ["Acute decompensated HF"],
  });
  await api(`/patients/${p.id}/medications`, {
    code: "spironolactone",
    doseValue: 25,
    frequency: "OD",
    route: "PO",
    indication: "hf",
    contextId: ctx.id,
  });
  await api(`/patients/${p.id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: [
      { code: "creatinine", value: 90 },
      { code: "weight", value: 80 },
    ],
    contextId: ctx.id,
  });
  await api(`/patients/${p.id}/wizards/htn-secondary/complete`, {
    contextId: ctx.id,
    answers: {
      clues: ["resistant"],
      paAction: "screen",
      tests: ["renal"],
      disposition: "workup",
      when: today,
    },
  });
  const done = await api(`/patients/${p.id}/wizards/af-care/complete`, {
    contextId: ctx.id,
    answers: {
      pattern: "permanent",
      comorb: ["hf"],
      oac: "apixaban",
      bleed: ["none"],
      symptoms: "2",
      rate: ["digoxin"],
      rhythm: ["ablation"],
      tests: ["none"],
      review: "clinic-28",
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
    window.scrollTo(0, 0);
  }, `/patients/${p.id}/journey`);
  const event = page.locator(".jr-event").filter({
    has: page.locator(".t", { hasText: /^Atrial fibrillation: AF-CARE$/ }),
  });
  await event.scrollIntoViewIfNeeded();
  await event.click();
  if (process.env.CARDIO_CAPTURE_BEFORE) {
    await page.locator(".jr-detail").waitFor();
    await page.screenshot({
      animations: "disabled",
      path: out + "/01-before-phone.png",
    });
    console.log("Captured original crowded Journey detail");
  } else {
    const dialog = page.getByRole("dialog", {
      name: "Atrial fibrillation: AF-CARE",
      exact: true,
    });
    await dialog.waitFor();
    assert(
      (await dialog.boundingBox()).width >= 380,
      "Phone detail must use the full screen width",
    );
    await expect(
      dialog.getByRole("button", { name: "Summary", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator(".journey-facts")).toContainText("Permanent");
    await expect(dialog.locator(".journey-facts")).toContainText(
      "Not recorded",
    );
    assert.equal(
      await dialog.locator(".journey-action").count(),
      0,
      "Summary must not repeat every action",
    );
    await page.screenshot({
      animations: "disabled",
      path: out + "/02-summary-phone.png",
    });
    await dialog.getByRole("button", { name: /^Actions/ }).click();
    await expect(dialog.locator(".journey-actions")).toContainText(
      "Rate control: add digoxin",
    );
    await expect(dialog.locator(".journey-actions")).toContainText("Apixaban");
    await expect(dialog.locator(".journey-medicine-list")).toContainText(
      "5 mg · BID · PO",
    );
    await expect(dialog.locator(".journey-actions")).not.toContainText(
      "Spironolactone",
    );
    await expect(dialog.locator(".journey-actions")).not.toContainText(
      "Secondary hypertension",
    );
    const data = await api(`/patients/${p.id}/journey`);
    const selected = data.events.find((e) => e.ref_id === done.decisionId);
    const secondary = data.events.find((e) =>
      e.title.startsWith("Secondary hypertension"),
    );
    assert(secondary.linked.actions.length > 0);
    assert(
      selected.linked.actions.every(
        (a) => !secondary.linked.actions.some((other) => other.id === a.id),
      ),
      "Separate decisions must not repeat each other's actions",
    );
    await page.screenshot({
      animations: "disabled",
      path: out + "/03-actions-phone.png",
    });
    await dialog.getByRole("button", { name: "Record", exact: true }).click();
    assert.equal(
      await dialog.locator(".journey-original").innerText(),
      selected.detail,
    );
    await page.screenshot({
      animations: "disabled",
      path: out + "/04-record-phone.png",
    });
    await noOverflow();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(event).toBeFocused();
    const y = await page.evaluate(() => scrollY);
    await event.click();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(
      await page.evaluate(() => scrollY),
      y,
      "Closing keeps the timeline position",
    );
    await page.setViewportSize({ width: 320, height: 740 });
    await event.click();
    await noOverflow();
    await dialog.getByRole("button", { name: /^Actions/ }).click();
    await noOverflow();
    assert.equal(
      await dialog.evaluate((e) => e.scrollWidth > e.clientWidth),
      false,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await dialog.evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    assert.equal(
      await dialog
        .locator(".journey-detail")
        .evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await event.click();
    await expect(page.locator(".journey-panel")).toContainText("Permanent");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.screenshot({
      animations: "disabled",
      path: out + "/05-desktop.png",
    });
    await noOverflow();
    assert.deepEqual(errors, []);
    console.log(
      "Journey focus: scoped decision actions/medicines, original record, 390/320px, keyboard return, reduced motion and desktop passed",
    );
  }
} finally {
  await browser.close();
}
