import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))
  throw Error("Synthetic localhost required");
const out = process.argv[2] || "/tmp/refinement-oct29";
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
  const pt = await api("/patients", {
    name: "Synthetic incomplete angiography",
    mrn: "AUD29-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["cad-suspected"],
    sample: true,
  });
  const path = `/patients/${pt.id}`;
  await api(path + "/studies", {
    kind: "cath",
    date: "2026-10-20T09:00:00Z",
    findings: {
      lm: "Not assessed",
      lad: "None",
      lcx: "None",
      rca: "None",
      outcome: "Medical therapy",
    },
  });
  let s = await api(path + "/summary");
  assert.ok(
    s.attention.some(
      (a) =>
        a.rule_id === "cad.suspected-workup" &&
        /anatomy incomplete/.test(a.title),
    ),
  );
  assert.ok(
    !s.attention.some((a) =>
      /no obstructive disease on angiography/.test(a.title),
    ),
  );
  await page.goto(base + path);
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  await expect(page.locator(".cx-dec")).toContainText(["anatomy incomplete"]);
  await expect(page.locator(".cx-key-results")).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `${out}/incomplete-cath-${width}.png` });
  }
  await api(path + "/studies", {
    kind: "cath",
    date: "2026-10-21T09:00:00Z",
    findings: {
      lm: "None",
      lad: "<50%",
      lcx: "None",
      rca: "None",
      outcome: "Medical therapy",
    },
  });
  s = await api(path + "/summary");
  assert.ok(
    s.attention.some(
      (a) =>
        a.rule_id === "cad.suspected-workup" &&
        /no obstructive disease/.test(a.title),
    ),
  );
  assert.ok(!s.attention.some((a) => /anatomy incomplete/.test(a.title)));
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/results.json",
    JSON.stringify(
      {
        incompleteReportNeedsReview: true,
        completedNegativeReportRecognised: true,
        widths: [320, 390, 1440],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS incomplete cath -> report review -> explicit non-obstructive report -> diagnosis resolution; 320/390/1440 layouts",
  );
} finally {
  await browser.close();
}
