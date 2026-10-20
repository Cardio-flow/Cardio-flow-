// Synthetic-only lab and medication overview walkthrough, phone + desktop.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const out = process.argv[2] || "/tmp/cardio-overview-snapshots";
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
const phoneShot = async (locator, name) => {
  await locator.evaluate((e) => {
    const top =
      document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 110;
    window.scrollTo(0, e.getBoundingClientRect().top + scrollY - top - 12);
  });
  await page.screenshot({ path: `${out}/${name}.png` });
};
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  const today = (await api("/health")).today;
  const at = (n) =>
    n === 0 ? new Date().toISOString() : new Date(Date.parse(today + "T00:00:00Z") + n * 86400000).toISOString();
  const p = await api("/patients", {
    name: "Synthetic overview trends",
    mrn: "SNAP-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["hfref"],
    sample: true,
  });
  const id = p.id;
  const old = {
    creatinine: 100,
    potassium: 4,
    sodium: 140,
    haemoglobin: 14,
    "nt-probnp": 2000,
    "ldl-c": 2,
    inr: 2,
    glucose: 5,
    crp: 0,
  };
  const now = {
    creatinine: 125,
    potassium: 4.4,
    sodium: 140,
    haemoglobin: 13,
    "nt-probnp": 1200,
    "ldl-c": 1.5,
    inr: 2.5,
    glucose: 7,
    crp: 5,
    tsh: 2.5,
  };
  await api(`/patients/${id}/observations`, {
    effectiveAt: at(-10),
    items: Object.entries(old).map(([code, value]) => ({ code, value })),
  });
  await api(`/patients/${id}/observations`, {
    effectiveAt: at(-1),
    items: Object.entries(now).map(([code, value]) => ({ code, value })),
  });
  const start = async (code, doseValue, frequency = "OD") =>
    (
      await api(`/patients/${id}/medications`, {
        code,
        doseValue,
        frequency,
        route: "PO",
        indication: "hf",
        effectiveAt: at(-20),
      })
    ).medicationId;
  const raas = await start("valsartan", 160);
  const bb = await start("bisoprolol", 2.5);
  const mra = await start("spironolactone", 25);
  const sglt2 = await start("dapagliflozin", 10);
  await api(`/patients/${id}/medications/${raas}/events`, {
    kind: "continue",
    frequency: "BID",
    reason: "Frequency changed to BID",
    effectiveAt: at(-3),
  });
  await api(`/patients/${id}/medications/${mra}/events`, {
    kind: "hold",
    reason: "Temporary hold for review",
    effectiveAt: at(-2),
  });
  await api(`/patients/${id}/medications/${bb}/events`, {
    kind: "increase",
    doseValue: 5,
    reason: "Dose increased after clinician review",
    effectiveAt: at(-1),
  });
  await page
    .getByRole("button", { name: "Sample patients", exact: true })
    .click();
  await page.evaluate((id) => {
    history.pushState({}, "", `/patients/${id}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, id);
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  // phones: the overview shows one section at a time (Decide / Abnormal / Medicines / Plan); since 20 Oct 2026
  // abnormal results are listed once with their trend, and the full list opens from "All results"
  const section = async (name) => { const t = page.getByRole("tab", { name: new RegExp(`^${name}`) }); if (await t.count()) await t.click(); };
  const labs = page.getByRole("region", { name: "Latest lab results" });
  const allResults = async () => { await section("Abnormal"); if (!(await labs.count())) await page.getByRole("region", { name: "Abnormal results" }).getByRole("button", { name: "All results" }).click(); };
  await section("Abnormal");
  const abnCr = page.getByRole("region", { name: "Abnormal results" }).locator("li").filter({ hasText: "Cr " });
  await expect(abnCr).toContainText("+25%");
  await expect(abnCr).toContainText("before 100");
  await allResults();
  await expect(labs.locator('[data-lab-code="nt-probnp"]')).toContainText(
    "-40.0%",
  );
  await expect(labs.locator('[data-lab-code="creatinine"]')).toContainText(
    "+25.0%",
  );
  await expect(labs.locator('[data-lab-code="sodium"]')).toContainText("0.0%");
  await labs.getByRole("button", { name: /All results/ }).click();
  await expect(labs.locator('[data-lab-code="tsh"]')).toContainText(
    "First comparable result",
  );
  const zero = labs.locator('[data-lab-code="crp"]');
  await expect(zero).not.toContainText("%");
  await zero.locator("summary").click();
  await expect(zero).toContainText("Previous result was zero");
  const cr = labs.locator('[data-lab-code="creatinine"]');
  await cr.scrollIntoViewIfNeeded();
  await phoneShot(labs, "02-phone-lab-trends");
  await section("Medicines");
  const meds = page.getByRole("region", { name: "Current medications" });
  const valsartan = meds.getByRole("button", { name: /^Valsartan/ });
  await expect(valsartan).toContainText("100%");
  await expect(valsartan).toContainText("Reference 160 mg BID");
  const bisoprolol = meds.getByRole("button", { name: /^Bisoprolol/ });
  await expect(bisoprolol).toContainText("50%");
  const spiro = meds.getByRole("button", { name: /^Spironolactone/ });
  await expect(spiro).toContainText("Held");
  await expect(spiro.locator(".dose-progress")).toHaveClass(/paused/);
  await phoneShot(meds, "03-phone-dose-progress");
  const hist = meds.getByRole("region", { name: "Medication history" });
  await hist.locator("summary").filter({ hasText: "Bisoprolol" }).click();
  await expect(hist).toContainText("2.5 mg OD PO → 5 mg OD PO");
  await hist.getByRole("button", { name: /All changes/ }).click();
  await expect(hist.locator("li")).toHaveCount(7);
  await phoneShot(hist, "04-phone-medication-history");
  await noOverflow();
  await page.getByRole("link", { name: "Medications", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Medication history" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("meter", {
        name: "Prescribed dose compared with HF reference target",
      })
      .first(),
  ).toBeVisible();
  await noOverflow();
  await api(`/patients/${id}/medications/${sglt2}/events`, {
    kind: "stop",
    reason: "Synthetic history check",
    effectiveAt: at(0),
  });
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Medication history" }),
  ).toContainText("Stopped");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  await section("Medicines");
  await expect(
    page
      .getByRole("region", { name: "Current medications" })
      .getByRole("button", { name: /^Dapagliflozin/ }),
  ).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await allResults();
  assert.equal(
    await labs.evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await noOverflow();
  await page.screenshot({
    path: `${out}/05-desktop-overview.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Investigations", exact: true }).click();
  const creatinineRow = page.locator("table.data tr").filter({ has: page.getByRole("cell", { name: "Creatinine", exact: true }) });
  await expect(creatinineRow).toContainText("+25.0%");
  await expect(creatinineRow).toContainText("100");
  assert.deepEqual(errors, []);
  console.log(
    "Overview snapshots passed: latest + trends, zero/first result, HF daily-dose reference, held/stopped history, phone/desktop widths, reduced motion.",
  );
} finally {
  await browser.close();
}
