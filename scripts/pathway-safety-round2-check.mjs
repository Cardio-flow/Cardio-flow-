import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))
  throw Error("Synthetic localhost required");
const out = process.argv[2] || "/tmp/pathway-safety-round2";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
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
      if (!r.ok) throw Error(path + ": " + JSON.stringify(j));
      return j;
    },
    { path, body, csrf },
  );
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  const pt = await api("/patients", {
    name: "Synthetic AF regimen correction",
    mrn: "AF-SAFE-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["af"],
    sample: true,
  });
  const path = `/patients/${pt.id}`;
  const now = new Date().toISOString();
  await api(path + "/observations", {
    effectiveAt: now,
    items: [
      { code: "creatinine", value: 80 },
      { code: "weight", value: 80 },
    ],
  });
  const drug = await api(path + "/medications", {
    code: "apixaban",
    doseValue: 5,
    frequency: "OD",
    route: "PO",
    indication: "af",
    effectiveAt: now,
    alreadyTaking: true,
  });
  await page.goto(base + path);
  const card = page
    .locator(".cx-dec")
    .filter({ hasText: /Apixaban/ })
    .first();
  await expect(card).toContainText("5 mg OD → 5 mg BID");
  await card.getByRole("button", { name: "Review plan", exact: true }).click();
  const panel = card.locator(".decision");
  await panel
    .getByRole("radiogroup", { name: "Decision: AF pattern", exact: true })
    .getByRole("radio", { name: "Permanent", exact: true })
    .click();
  await panel
    .getByRole("radiogroup", {
      name: "Decision: Symptoms (EHRA class)",
      exact: true,
    })
    .getByRole("radio", { name: "EHRA 1: none", exact: true })
    .click();
  const checks = [
    ["Risk factors to treat", "None to address"],
    ["Modifiable bleeding risk factors", "None"],
    ["Rate control", "No change"],
    ["Rhythm control", "Not now"],
  ];
  for (const [group, label] of checks) {
    const input = panel
      .getByRole("group", { name: `Decision: ${group}`, exact: true })
      .getByRole("checkbox", { name: `Decision: ${label}`, exact: true });
    if ((await input.count()) && !(await input.isChecked()))
      await input.check();
  }
  await expect(panel).toContainText("5 mg OD → 5 mg BID");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `${out}/af-regimen-${width}.png` });
  }
  const confirm = panel.getByRole("button", { name: /^(Apply|Confirm)/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.locator(".cx-dec").filter({ hasText: /5 mg OD → 5 mg BID/ }),
  ).toHaveCount(0);
  const summary = await api(path + "/summary");
  const recorded = summary.medications.groups
    .flatMap((g) => g.meds)
    .find((m) => m.id === drug.medicationId);
  assert.equal(recorded.frequency, "BID");
  assert.equal(recorded.doseValue, 5);
  assert.ok(!summary.attention.some((a) => a.rule_id === "af.doac-dose"));
  const hf = await api("/patients", {
    name: "Synthetic selected HF monitoring",
    mrn: "HF-SAFE-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["hfref"],
    sample: true,
  });
  const hp = `/patients/${hf.id}`;
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString();
  const baseline = await api(hp + "/observations", {
    effectiveAt: day(-40),
    items: [
      { code: "lvef", value: 30 },
      { code: "creatinine", value: 90 },
      { code: "potassium", value: 4.2 },
      { code: "sbp", value: 120 },
      { code: "hr", value: 70 },
    ],
  });
  await api(hp + "/medications", {
    code: "spironolactone",
    doseValue: 25,
    frequency: "OD",
    route: "PO",
    indication: "hf",
    effectiveAt: day(-30),
  });
  await api(hp + "/observations", {
    effectiveAt: day(-1),
    items: [
      { code: "creatinine", value: 92 },
      { code: "potassium", value: 4.3 },
    ],
  });
  let hs = await api(hp + "/summary");
  assert.ok(
    hs.attention.some(
      (a) => a.rule_id === "hf.titration" && /Spironolactone/.test(a.title),
    ),
  );
  await api(hp + "/preferences", {
    code: "creatinine",
    observationId: baseline.ids[1],
    reason: "Synthetic chosen pre-change result",
  });
  hs = await api(hp + "/summary");
  assert.ok(
    !hs.attention.some(
      (a) => a.rule_id === "hf.titration" && /Spironolactone/.test(a.title),
    ),
  );
  const preview = await api(hp + "/decisions/hf-medicines/preview", {
    answers: {},
  });
  assert.ok(
    !preview.plan.some(
      (p) => p.kind === "medication" && /Spironolactone/.test(p.label),
    ),
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/results.json`,
    JSON.stringify(
      {
        afRegimenShownBeforeConfirmation: true,
        correctedFrequencySaved: true,
        alertResolved: true,
        selectedPreChangeLabBlocksTitration: true,
        widths: [390, 1440],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS AF frequency preview -> clinician confirmation -> stored frequency -> alert resolution; selected pre-change result removes HF titration; phone/desktop layouts",
  );
} finally {
  await browser.close();
}
