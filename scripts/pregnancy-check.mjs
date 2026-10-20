import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
import { continueAfterEntry } from "./continue-after-entry.mjs";
const base = process.env.CARDIO_BASE_URL ?? "http://127.0.0.1:4310",
  out = process.argv[2] ?? "screenshots/pregnancy";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(),
  p = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [],
  checks = [];
p.setDefaultTimeout(15000);
p.on("pageerror", (e) => errors.push(e.message));
const api = (path, body) =>
  p.evaluate(
    async ({ path, body }) => {
      const s = await (await fetch("/api/session")).json();
      const r = await fetch(
        "/api" + path,
        body
          ? {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": s.csrf,
              },
              body: JSON.stringify(body),
            }
          : {},
      );
      const d = await r.json();
      if (!r.ok) throw Error(path + ":" + JSON.stringify(d));
      return d;
    },
    { path, body },
  );
const datePlus = (today, n) =>
  new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
const dateFill = async (locator, iso) => {
  await locator.fill("");
  await locator.pressSequentially(iso.split("-").reverse().join(""));
  await expect(locator).toHaveValue(iso.split("-").reverse().join("/"));
};
const shot = async (name) => {
  await p.evaluate(() => document.fonts.ready);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
  await p.screenshot({ path: out + "/" + name + ".png" });
};
const create = async (label, conditions = []) =>
  (
    await api("/patients", {
      name: "Synthetic pregnancy " + label,
      mrn: "PREG-UI-" + Date.now() + "-" + label,
      sex: "Female",
      birthDate: "1992-01-01",
      conditions,
      sample: true,
    })
  ).id;
const addMed = (id, code, doseValue) =>
  api(`/patients/${id}/medications`, {
    code,
    doseValue,
    frequency: "OD",
    route: "PO",
    indication: "hf",
    alreadyTaking: true,
  });
let dialog, panel;
const radio = (group, name) =>
  panel
    .getByRole("radiogroup", { name: "Decision: " + group, exact: true })
    .getByRole("radio", { name, exact: true })
    .click();
try {
  await p.goto(base);
  await p.getByText("Dr. Ahmed", { exact: true }).click();
  await p.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const today = (await api("/health")).today,
    edd = datePlus(today, 140),
    next = datePlus(today, 14);
  const id = await create("antenatal", ["hfref", "htn"]);
  await addMed(id, "ramipril", 5);
  await addMed(id, "dapagliflozin", 10);
  await p.goto(base + `/patients/${id}/history`);
  await p
    .getByRole("button", { name: "Pregnancy context", exact: true })
    .click();
  dialog = p.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Pregnant", exact: true }).click();
  await dateFill(
    dialog.getByLabel("Estimated due date (confirmed obstetric dating)", {
      exact: true,
    }),
    edd,
  );
  await dialog.getByRole("radio", { name: "III", exact: true }).click();
  await shot("01-phone-dated-context");
  await dialog
    .getByRole("button", { name: "Save pregnancy context", exact: true })
    .click();
  await continueAfterEntry(p);
  await expect(dialog).toHaveCount(0);
  await p.goto(base + `/patients/${id}`);
  let card = p.locator('.problem[aria-label="Pregnancy & heart disease"]');
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Review pregnancy care", exact: true }).click();
  panel = p.locator(
    '[aria-label="Decision: Pregnancy & heart disease: care plan"]',
  );
  await panel.waitFor();
  await radio("Current safety assessment", "Stable after clinical assessment");
  await radio(
    "Anticoagulation strategy",
    "No anticoagulant indication after assessment",
  );
  await radio("Delivery plan", "Early pregnancy; review at next appointment");
  await panel
    .getByRole("button", { name: "Edit answers", exact: true })
    .click();
  await expect(
    panel.getByRole("checkbox", {
      name: "Decision: Maternal echo",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    panel.getByRole("checkbox", {
      name: "Decision: Pregnancy BP / medication bloods and urine protein",
      exact: true,
    }),
  ).toBeChecked();
  await dateFill(
    panel.getByRole("textbox", {
      name: "Decision: Assessment / action date",
      exact: true,
    }),
    today,
  );
  await dateFill(
    panel.getByRole("textbox", {
      name: "Decision: Next clinical review",
      exact: true,
    }),
    next,
  );
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "Fewer fields", exact: true })
    .click();
  await shot("02-phone-prefilled-care-plan");
  await panel.getByRole("button", { name: "Apply plan", exact: true }).click();
  await expect(panel).toHaveCount(0);
  let record = await api(`/patients/${id}/record`);
  expect(record.meds.every((m) => m.status === "active")).toBe(true);
  expect(record.meds.some((m) => m.code === "aspirin")).toBe(false);
  expect(
    record.plan.filter(
      (q) =>
        q.title === "Pregnancy Heart Team: integrated assessment and care plan",
    ),
  ).toHaveLength(1);
  expect(
    record.plan.filter(
      (q) => q.title === "Pregnancy: BP / medication bloods and urine protein",
    ),
  ).toHaveLength(1);
  checks.push(
    "Manual-date context triggers one integrated care plan; known HTN/HF prefill tests; no automatic medicine withdrawal",
  );
  await p.goto(base + `/patients/${id}/medications`);
  const review = p.getByRole("region", {
    name: "Medication review",
    exact: true,
  });
  await expect(review).toContainText("Pregnancy medication safety");
  await expect(review).toContainText("use creatinine");
  await review.scrollIntoViewIfNeeded();
  await shot("03-phone-medication-integration");
  const codes = [
      "haemoglobin",
      "platelets",
      "creatinine",
      "potassium",
      "alt",
      "ast",
      "uacr",
      "urate",
    ],
    values = [11.5, 220, 65, 4.2, 20, 20, 1, 250];
  await api(`/patients/${id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: codes.map((code, i) => ({ code, value: values[i] })),
  });
  record = await api(`/patients/${id}/record`);
  const blood = record.plan.find(
    (q) => q.title === "Pregnancy: BP / medication bloods and urine protein",
  );
  expect(blood.status).toBe("completed");
  expect(blood.progress).toBe("performed");
  await p.goto(base + `/patients/${id}/plan`);
  await expect(
    p.getByText("Awaiting review", { exact: false }).first(),
  ).toBeVisible();
  await p
    .locator(".plan-row")
    .filter({ hasText: "Pregnancy: BP / medication bloods and urine protein" })
    .scrollIntoViewIfNeeded();
  await p.getByText("Awaiting review", { exact: false }).first().scrollIntoViewIfNeeded();
  await p.mouse.wheel(0, 180);
  await shot("04-phone-result-review-loop");
  checks.push(
    "Matching actual results complete performance and remain awaiting clinical review",
  );
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(base + `/patients/${id}/history`);
  await p
    .getByRole("button", { name: "Pregnancy context", exact: true })
    .click();
  dialog = p.getByRole("dialog");
  await expect(
    dialog.getByLabel("Estimated due date (confirmed obstetric dating)", {
      exact: true,
    }),
  ).toHaveValue(edd.split("-").reverse().join("/"));
  await dialog.getByRole("radio", { name: "Postpartum", exact: true }).click();
  await dateFill(
    dialog.getByLabel("Delivery / pregnancy end date", { exact: true }),
    datePlus(today, -7),
  );
  await dialog
    .getByRole("radiogroup", { name: "Breastfeeding", exact: true })
    .getByRole("radio", { name: "No", exact: true })
    .click();
  await shot("05-desktop-stage-transition");
  await dialog
    .getByRole("button", { name: "Save pregnancy context", exact: true })
    .click();
  await continueAfterEntry(p);
  record = await api(`/patients/${id}/record`);
  const preg = record.conditions.find((c) => c.code === "pregnancy-care");
  expect(preg.attributes.phase).toBe("Postpartum");
  expect(preg.attributes.edd).toBeUndefined();
  checks.push(
    "Dated stage transition preserves earlier history and removes inapplicable fields from the current context",
  );
  const pp = await create("breastfeeding", ["hfref"]);
  for (const [code, dose] of [
    ["enalapril", 5],
    ["spironolactone", 25],
    ["dapagliflozin", 10],
  ])
    await addMed(pp, code, dose);
  await api(`/patients/${pp}/history`, {
    add: [
      {
        code: "pregnancy-care",
        attributes: {
          phase: "Postpartum",
          deliveredOn: datePlus(today, -7),
          breastfeeding: "Yes",
          mwho: "III",
        },
      },
    ],
  });
  await p.goto(base + `/patients/${pp}/medications`);
  await expect(review).toContainText("Postpartum: review cardiac care");
  const summary = await api(`/patients/${pp}/summary`),
    row = summary.medicationReview.issues.find(
      (r) => r.rule_id === "pregnancy.care",
    );
  expect(row.facts.some((f) => f.label === "Dapagliflozin")).toBe(true);
  expect(row.facts.some((f) => f.label === "Enalapril")).toBe(false);
  expect(row.facts.some((f) => f.label === "Spironolactone")).toBe(false);
  await review.scrollIntoViewIfNeeded();
  await shot("06-desktop-breastfeeding-safety");
  checks.push(
    "Breastfeeding keeps compatible HF medicines and flags SGLT2 use",
  );
  const urgent = await create("urgent", ["htn"]);
  await api(`/patients/${urgent}/history`, {
    add: [
      {
        code: "pregnancy-care",
        attributes: { phase: "Pregnant", edd, mwho: "II" },
      },
    ],
  });
  await api(`/patients/${urgent}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: [
      { code: "sbp", value: 160 },
      { code: "dbp", value: 95 },
    ],
  });
  await p.goto(base + `/patients/${urgent}`);
  card = p.locator('.problem[aria-label="Pregnancy & heart disease"]');
  await expect(card).toContainText("urgent assessment");
  await card.getByRole("button", { name: "Review pregnancy care", exact: true }).click();
  panel = p.locator(
    '[aria-label="Decision: Pregnancy & heart disease: care plan"]',
  );
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("radiogroup", {
      name: "Decision: Anticoagulation strategy",
      exact: true,
    }),
  ).toHaveCount(0);
  await shot("07-desktop-urgent-route");
  await panel.getByRole("button", { name: "Apply plan", exact: true }).click();
  await expect(panel).toHaveCount(0);
  record = await api(`/patients/${urgent}/record`);
  expect(
    record.plan.filter(
      (q) =>
        q.title ===
        "Pregnancy / postpartum: urgent obstetric and cardiac assessment",
    ),
  ).toHaveLength(1);
  expect(record.meds).toHaveLength(0);
  checks.push(
    "160 systolic alone triggers a short urgent route without outpatient dates or automatic drugs",
  );
  const closed = await create("completed-context");
  await api(`/patients/${closed}/history`, {
    add: [
      { code: "pregnancy-care", attributes: { phase: "Follow-up complete" } },
    ],
  });
  await p.goto(base + `/patients/${closed}`);
  await p.getByRole("button", { name: "Pathways", exact: true }).click();
  dialog = p.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Search pathways", exact: true })
    .fill("pregnancy");
  await dialog
    .getByRole("button", { name: /Pregnancy & heart disease: care plan/ })
    .click();
  await expect(
    p
      .getByRole("dialog")
      .getByRole("heading", { name: "Pregnancy context", exact: true }),
  ).toBeVisible();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  checks.push(
    "The pathway catalogue reopens context entry when an earlier pregnancy follow-up is complete",
  );
  expect(errors).toEqual([]);
  fs.writeFileSync(
    out + "/results.json",
    JSON.stringify({ passed: true, checks, errors }, null, 2),
  );
  console.log(
    "PASS pregnancy phone/desktop, context, care, medication safety, stage transition and results review",
  );
} catch (e) {
  await p.screenshot({ path: out + "/failure.png" });
  fs.writeFileSync(
    out + "/results.json",
    JSON.stringify(
      { passed: false, checks, errors, error: e.message },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
}
