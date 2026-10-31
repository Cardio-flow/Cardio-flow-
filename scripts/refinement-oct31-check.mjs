import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))
  throw Error("Synthetic localhost required");
const out = process.argv[2] || "/tmp/refinement-oct31";
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
    name: "Synthetic selected lab and iron handoff",
    mrn: "AUD31-" + Date.now(),
    sex: "Female",
    birthDate: "1960-01-01",
    conditions: ["hfpef"],
    sample: true,
  });
  const path = `/patients/${pt.id}`;
  await api(path + "/observations", {
    effectiveAt: "2026-10-01T06:00:00Z",
    items: [{ code: "alt", value: 20 }],
  });
  const selected = await api(path + "/observations", {
    effectiveAt: "2026-10-15T06:00:00Z",
    items: [{ code: "alt", value: 80 }],
  });
  await api(path + "/observations", {
    effectiveAt: "2026-10-20T06:00:00Z",
    items: [
      { code: "alt", value: 40 },
      { code: "ferritin", value: 400 },
      { code: "tsat", value: 10 },
      { code: "haemoglobin", value: 14 },
    ],
  });
  await api(path + "/preferences", {
    code: "alt",
    observationId: selected.ids[0],
    reason: "Synthetic clinician selection",
  });
  await page.goto(base + path);
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  const alt = page
    .locator(".cx-abn")
    .filter({ has: page.locator("span", { hasText: /^ALT$/ }) });
  await expect(alt).toContainText("+300.0%");
  await expect(alt).toContainText("01 Oct 2026");
  const notice = page
    .locator(".cx-lab-notice")
    .filter({ hasText: "Latest ALT" });
  await expect(notice).toContainText("Latest ALT: 40");
  await expect(notice).toContainText("Used for decisions: 80");
  const tsat = page
    .locator(".cx-abn")
    .filter({ has: page.locator("span", { hasText: /^TSAT$/ }) });
  await expect(tsat).toContainText("review iron studies");
  await expect(tsat).not.toContainText("iron deficiency (ESC HF)");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `${out}/selected-labs-${width}.png`,
      fullPage: true,
    });
  }
  await api(path + "/observations", {
    effectiveAt: "2026-10-21T06:00:00Z",
    items: [{ code: "ferritin", value: 50 }],
  });
  await api(path + "/echo", {
    date: "2026-10-22T06:00:00Z",
    quality: "formal",
    lvef: 55,
    findings: [],
  });
  let s = await api(path + "/summary");
  assert.ok(
    s.attention.some(
      (a) => a.rule_id === "hf.iron-deficiency" && a.action.type === "add-labs",
    ),
  );
  const changed = await api(path + "/echo", {
    date: "2026-10-23T06:00:00Z",
    quality: "formal",
    lvef: 40,
    findings: [],
  });
  assert.ok(
    changed.engine.created.some(
      (a) =>
        a.rule_id === "hf.iron-deficiency" && a.action.wizard === "iv-iron",
    ),
  );
  s = await api(path + "/summary");
  assert.ok(
    s.attention.some(
      (a) =>
        a.rule_id === "hf.iron-deficiency" && a.action.wizard === "iv-iron",
    ),
  );
  // Removing an erroneous newer result reverts the decision to the retained formal EF.
  await api(path + `/studies/${changed.id}/void`, {
    reason: "Synthetic incorrect echo",
  });
  s = await api(path + "/summary");
  assert.ok(
    s.attention.some(
      (a) => a.rule_id === "hf.iron-deficiency" && a.action.type === "add-labs",
    ),
  );
  assert.ok(
    !s.attention.some(
      (a) =>
        a.rule_id === "hf.iron-deficiency" && a.action.wizard === "iv-iron",
    ),
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/results.json`,
    JSON.stringify(
      {
        selectedLabTrend: true,
        latestValueDisclosed: true,
        lowTsatWithoutUnsupportedDiagnosis: true,
        efChangesRefreshIron: true,
        withdrawnEchoRevertsDecision: true,
        widths: [320, 390, 1440],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS selected lab trend and latest disclosure; low TSAT; EF -> iron decision -> corrected echo; 320/390/1440 layouts",
  );
} finally {
  await browser.close();
}
