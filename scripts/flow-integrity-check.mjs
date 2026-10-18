// Regression scenarios from the synthetic clinic audits; never uses real patient records.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.argv[2] || "/tmp/cardio-flow-integrity";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
let csrf = "",
  seq = 0;
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
const create = async (label, conditions = []) => {
  const name = "Synthetic integrity " + label;
  return {
    ...(await api("/patients", {
      name,
      mrn: `INT-UI-${Date.now()}-${++seq}`,
      sex: "Male",
      birthDate: "1960-01-01",
      sample: true,
      conditions,
    })),
    name,
  };
};
const go = async (x, tab = "") => {
  await page.evaluate((url) => {
    history.pushState(null, "", url);
    window.dispatchEvent(new Event("cf:navigate"));
  }, `/patients/${x.id}${tab}`);
  await page.getByRole("heading", { name: x.name, exact: true }).waitFor();
  // overview problem cards fold lower-priority items under "n to consider": open them
  if (!tab) {
    await page.waitForTimeout(300);
    for (const b of await page.locator('.problem-consider button[aria-expanded="false"]').all()) await b.click();
  }
};
const shot = (name) =>
  page.screenshot({ path: `${out}/${name}.png`, animations: "disabled" });
const radio = (label, value) =>
  page
    .getByRole("radiogroup", { name: label, exact: true })
    .getByRole("radio", { name: value, exact: true })
    .click();
const close = () =>
  page.getByRole("button", { name: "Close", exact: true }).click();
const startVisit = async (x) => {
  await go(x);
  await page
    .getByRole("button", { name: "Start clinic visit", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Heart failure", exact: true })
    .click();
  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.getByLabel("Systolic BP").fill("118");
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page.getByText("Needs a decision", { exact: true }).waitFor();
};
const toNote = async () => {
  await page
    .getByRole("button", { name: "Continue to note", exact: true })
    .click();
  const note = page.getByLabel("Clinic note", { exact: true });
  await expect(note).toBeEnabled();
  return note;
};
const recordLabs = (id, items, at = new Date().toISOString()) =>
  api(`/patients/${id}/observations`, { effectiveAt: at, items });
const ckPatient = async (label) => {
  const x = await create(label, ["dyslipidaemia"]);
  await api(`/patients/${x.id}/medications`, {
    code: "atorvastatin",
    doseValue: 40,
    frequency: "OD",
    route: "PO",
    indication: "lipids",
  });
  await recordLabs(x.id, [
    { code: "ck", value: 2400, referenceHigh: 200 },
    { code: "creatinine", value: 90 },
  ]);
  return x;
};
try {
  await page.goto(process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310");
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  await page
    .getByRole("button", { name: "Sample patients", exact: true })
    .click();
  const stale = await ckPatient("stale evidence");
  await go(stale);
  await page
    .getByRole("button", { name: "Review statin CK", exact: true })
    .click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await radio("Muscle symptoms", "No muscle symptoms");
  await page
    .getByRole("button", {
      name: "Continue to suggested statin action & follow-up",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const ctx = await api(`/patients/${stale.id}/wizards/statin-ck-result`);
  await api(
    `/patients/${stale.id}/observations/${ctx.context.lab.ck.id}/correct`,
    { value: 100 },
  );
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/wizards/statin-ck-result/complete"),
  );
  await page.getByRole("button", { name: "Confirm plan", exact: true }).click();
  assert.equal((await response).status(), 409);
  await expect(page.getByRole("alert")).toContainText("record changed");
  assert.equal(
    (await api(`/patients/${stale.id}/record`)).meds[0].status,
    "active",
  );
  await shot("01-stale-decision-blocked");
  await close();
  const rapid = await ckPatient("rapid close");
  await go(rapid);
  await page
    .getByRole("button", { name: "Review statin CK", exact: true })
    .click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await close();
  await page
    .getByRole("button", { name: "Review statin CK", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "None", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await close();
  console.log("PASS immediate wizard close persists latest answer");
  const exclusive = await ckPatient("exclusive choices");
  await go(exclusive);
  await page
    .getByRole("button", { name: "Review statin CK", exact: true })
    .click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await radio("Muscle symptoms", "No muscle symptoms");
  await page
    .getByRole("button", {
      name: "Continue to suggested statin action & follow-up",
      exact: true,
    })
    .click();
  const actions = page;
  const continueButton = actions.getByRole("button", {
    name: /^Continue statin/,
  });
  const holdButton = actions.getByRole("button", { name: /^Pause statin/ });
  const stopButton = actions.getByRole("button", { name: /^Stop statin/ });
  await continueButton.click();
  await holdButton.click();
  await expect(continueButton).toHaveAttribute("aria-pressed", "false");
  await expect(holdButton).toHaveAttribute("aria-pressed", "true");
  await stopButton.click();
  await expect(holdButton).toHaveAttribute("aria-pressed", "false");
  await close();
  console.log("PASS mutually exclusive medicine actions");
  const visit = await create("fresh note", ["hfref"]);
  await recordLabs(visit.id, [
    { code: "potassium", value: 4.2 },
    { code: "creatinine", value: 90 },
  ]);
  await startVisit(visit);
  const note = await toNote();
  assert.match(await note.inputValue(), /K 4.2/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await recordLabs(visit.id, [{ code: "potassium", value: 6.8 }]);
  const fresh = await toNote();
  await expect(fresh).toHaveValue(/K 6.8/);
  await shot("02-refreshed-note");
  const marker = "Synthetic clinician assessment retained on refresh";
  await fresh.fill(marker);
  await expect(page.getByText("Draft saved", { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole("heading", { name: visit.name, exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Continue visit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  const restored = await toNote();
  await expect(restored).toHaveValue(marker);
  await shot("03-note-restored");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await recordLabs(visit.id, [{ code: "potassium", value: 4.8 }]);
  await toNote();
  await expect(
    page.getByText("Patient data changed. Review the note before finishing.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish visit", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Clinic note", { exact: true })).toHaveValue(
    marker,
  );
  await page
    .getByRole("button", { name: "I reviewed my edited note", exact: true })
    .click();
  await page.getByRole("button", { name: "Finish visit", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  console.log(
    "PASS generated note freshness, refresh recovery and preservation of clinician edits",
  );
  const batch = await create("batch warnings", ["hfref"]);
  await recordLabs(batch.id, [
    { code: "potassium", value: 4.2 },
    { code: "creatinine", value: 90 },
  ]);
  await startVisit(batch);
  await page
    .getByRole("button", { name: "Add medicines", exact: true })
    .click();
  for (const [term, name] of [
    ["spironolactone", "Spironolactone"],
    ["eplerenone", "Eplerenone"],
  ]) {
    await page
      .getByRole("textbox", { name: "Search medicines", exact: true })
      .fill(term);
    await page
      .locator(".mb-picks")
      .getByRole("button", { name: new RegExp("^" + name) })
      .click();
  }
  await expect(page.locator(".mb-hits").first()).toContainText(
    /potassium-sparing|Spironolactone.*Eplerenone/i,
  );
  await expect(
    page.getByRole("button", { name: "Start all 2", exact: true }),
  ).toBeDisabled();
  assert.ok(
    (await page
      .getByRole("dialog")
      .locator('input[placeholder="dd/mm/yyyy"]')
      .count()) > 0,
  );
  await shot("04-prospective-batch-warnings");
  await close();
  await close();
  console.log("PASS full batch precheck and manual monitoring dates");
  const overlap = await create("reconciliation");
  await api(`/patients/${overlap.id}/medications`, {
    code: "atorvastatin",
    doseValue: 40,
    frequency: "OD",
    route: "PO",
    indication: "lipids",
  });
  const dup = await api(
    `/patients/${overlap.id}/medication-check/rosuvastatin`,
  );
  assert.ok(dup.hits.some((h) => h.requiresReview));
  await api(`/patients/${overlap.id}/medications`, {
    code: "rosuvastatin",
    doseValue: 20,
    frequency: "OD",
    route: "PO",
    indication: "lipids",
    override: "Synthetic specialist reconciliation pending",
  });
  await go(overlap, "/medications");
  await expect(
    page.getByRole("region", {name:"Medication review"}).getByRole("article").filter({hasText:/review overlap/}),
  ).toBeVisible();
  await shot("05-reconciliation");
  const historic = await create("historic CK");
  await api(`/patients/${historic.id}/medications`, {
    code: "atorvastatin",
    doseValue: 40,
    frequency: "OD",
    route: "PO",
    indication: "lipids",
  });
  await recordLabs(
    historic.id,
    [{ code: "ck", value: 2400, referenceHigh: 200 }],
    "2024-10-12T09:00:00Z",
  );
  await go(historic);
  await page
    .getByRole("button", { name: "Review statin CK", exact: true })
    .click();
  await page.getByRole("button", { name: /^Values from the record/ }).click();
  await expect(page.locator(".wiz-side")).toContainText("2024");
  await expect(page.getByText(/This CK predates/)).toBeVisible();
  await shot("06-historical-year");
  await close();
  assert.deepEqual(errors, []);
  console.log("PASS clinic integrity browser regressions");
} finally {
  await browser.close();
}
