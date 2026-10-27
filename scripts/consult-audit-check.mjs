import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))
  throw Error("Synthetic localhost required");
const out = process.argv[2] || "/tmp/consult-audit";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
});
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
      const j = await r.json();
      if (!r.ok) throw Error(JSON.stringify(j));
      return j;
    },
    { path, body, csrf },
  );
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  // Own fresh synthetic case: other walkthroughs cannot change its expected regimen.
  const pt = await api("/patients", {
    name: "Synthetic Consult regression",
    mrn: "CONSULT-" + Date.now(),
    sex: "Male",
    birthDate: "1955-01-01",
    conditions: ["hfpef", "t2dm", "ckd-3b", "htn"],
    sample: true,
  });
  await api(`/patients/${pt.id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: [
      { code: "creatinine", value: 145 },
      { code: "potassium", value: 4.4 },
      { code: "hba1c", value: 8.4 },
      { code: "weight", value: 80 },
      { code: "uacr", value: 28 },
    ],
  });
  for (const [code, doseValue, frequency] of [
    ["metformin", 1000, "BID"],
    ["pioglitazone", 30, "OD"],
    ["saxagliptin", 5, "OD"],
    ["glibenclamide", 5, "BID"],
  ])
    await api(`/patients/${pt.id}/medications`, {
      code,
      doseValue,
      frequency,
      route: "PO",
      indication: "Synthetic audit",
      alreadyTaking: true,
    });
  await page.goto(base + "/patients/" + pt.id);
  const card = page.locator('.cx-dec[data-problem="Diabetes"]');
  await card.waitFor();
  await page.waitForFunction(() => !document.querySelector(".cx-loading"));
  await expect(card).toHaveClass(/sev-red/);
  const preview = await api(`/patients/${pt.id}/decisions/diabetes/preview`, {
    answers: {},
  });
  for (const item of preview.plan.filter((x) =>
    ["medication", "start"].includes(x.kind),
  ))
    await expect(
      card.getByRole("region", { name: "This will be recorded" }),
    ).toContainText(item.label);
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "overflow " + width,
    );
    if (width < 1180)
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector(".cx-key-results").getBoundingClientRect()
              .top <
            document.querySelector(".cx-main").getBoundingClientRect().top,
        ),
        "current results precede long decisions on phone",
      );
    await page.screenshot({ path: `${out}/overview-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [button, id] of [
    ["Results", "cx-results-record"],
    ["Medicines", "cx-medications-record"],
    ["Plan", "cx-plan-record"],
  ]) {
    await page
      .getByRole("navigation", { name: "Overview sections" })
      .getByRole("button", { name: button, exact: true })
      .click();
    await expect(page.locator("#" + id)).toBeVisible();
    await expect(page.locator("#cx-meds")).toHaveAttribute("open", "");
  }
  await card
    .getByRole("button", { name: "Review diabetes care", exact: true })
    .click();
  await expect(card.locator(".decision")).toBeVisible();
  await page.screenshot({ path: `${out}/full-decision-phone.png` });
  const empty = await api("/patients", {
    name: "Synthetic empty consult",
    mrn: "EMPTY-" + Date.now(),
    sex: "Female",
    birthDate: "1970-01-01",
    sample: true,
  });
  await page.goto(base + "/patients/" + empty.id);
  await page.locator(".cx-clear").waitFor();
  await expect(page.locator(".cx-clear")).not.toContainText("on track");
  assert.deepEqual(errors, []);
  console.log(
    "PASS full medication preview, red priority, phone results access, shortcuts, inline decision and incomplete-chart wording",
  );
} finally {
  await browser.close();
}
