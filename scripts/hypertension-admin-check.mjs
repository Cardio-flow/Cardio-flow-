import {openPatientView,openPhoneTools} from "./patient-navigation.mjs";
import {continueAfterEntry} from "./continue-after-entry.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const out = process.argv[2] || "/tmp/cardio-hypertension-admin";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
      const data = await r.json();
      if (!r.ok) throw Error(path + ": " + JSON.stringify(data));
      return data;
    },
    { path, body, csrf },
  );
const radio = (label, name) =>
  page
    .getByRole("radiogroup", { name: label, exact: true })
    .getByRole("radio", {
      name: new RegExp(
        "^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: GUIDELINE)?$",
      ),
    })
    .click();
const date = (label, value) =>
  page
    .getByRole("textbox", { name: label, exact: true })
    .fill(`${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`);
const next = () =>
  page.getByRole("button", { name: /^Continue( to|$)/ }).click();
const noOverflow = async () =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Phone overflow",
  );
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  assert.equal(
    await page.evaluate(
      async () => (await fetch("/api/admin/patients")).status,
    ),
    403,
    "Admin list must deny clinician",
  );
  const T = (await api("/health")).today;
  const fixtureName = "Synthetic HTN " + Date.now();
  const editedName = fixtureName + " edited";
  const previous = new Date(Date.now() - 86400000).toISOString();
  const pat = await api("/patients", {
    name: fixtureName,
    mrn: "HTN-UI-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["htn"],
    sample: false,
  });
  for (const [code, doseValue] of [
    ["amlodipine-valsartan", 10],
    ["indapamide", 1.5],
  ])
    await api(`/patients/${pat.id}/medications`, {
      code,
      doseValue,
      frequency: "OD",
      route: "PO",
      indication: "Hypertension",
      effectiveAt: previous,
      reason: "Synthetic current regimen",
    });
  await api(`/patients/${pat.id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: [
      { code: "sbp", value: 155 },
      { code: "dbp", value: 95 },
      { code: "creatinine", value: 90 },
      { code: "potassium", value: 4.2 },
      { code: "sodium", value: 140 },
    ],
  });
  await api(`/patients/${pat.id}/studies`, {
    kind: "abpm",
    date: new Date().toISOString(),
    findings: {
      duration: "24 h",
      onTreatment: "On treatment",
      sbp24: 145,
      dbp24: 90,
      valid: 80,
      conclusion: "Uncontrolled on treatment",
    },
  });
  await api(`/patients/${pat.id}/wizards/htn-resistance/complete`, {
    answers: {
      basis: "resistant",
      technique: "yes",
      adherence: "yes",
      doses: "yes",
      lifestyle: "yes",
      decision: "specialist",
      when: T,
      reviewDate: T,
    },
  });
  await page.goto(`${base}/patients/${pat.id}`);
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  // lower-priority items sit in the overview's folds (Consult, 25 Oct 2026)
  await page.locator("details.cx-fold").evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
  await page.locator("#att").getByRole("button", { name: "Assess RDN", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Verify resistance", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Review hypertension", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: out + "/00-rdn-pending-workup-phone.png",
    animations: "disabled",
  });
  for (const findings of [
    {
      purpose: "Primary aldosteronism screen",
      aldosterone: 5,
      aldosteroneUnit: "ng/dL",
      assay: "Immunoassay",
      renin: 2,
      reninUnit: "PRA ng/mL/h",
      samplePotassium: 4.2,
      interpretation:
        "Interpretable after assay, potassium and medication review",
      screenResult: "Negative",
    },
    {
      purpose: "Secondary hypertension review",
      tests: [
        "Primary aldosteronism",
        "Renal parenchymal disease",
        "Renovascular disease / FMD",
        "Obstructive sleep apnoea",
        "Drugs / substances",
      ],
      secondaryResult: "No secondary cause identified",
    },
    {
      purpose: "RDN anatomical assessment",
      modality: "CT angiography",
      device: "Symplicity Spyral — current regional IFU",
      anatomy: "Suitable under the selected device IFU",
      contraindications: "Excluded by specialist",
      reviewed: "Yes",
    },
  ])
    await api(`/patients/${pat.id}/studies`, {
      kind: "hypertension_workup",
      date: new Date().toISOString(),
      findings,
    });

  await page.goto(`${base}/patients/${pat.id}`);
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  // lower-priority items sit in the overview's folds (Consult, 25 Oct 2026)
  await page.locator("details.cx-fold").evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
  await page.locator("#att").getByRole("button", { name: "Assess RDN", exact: true }).click();
  await radio("Elective RDN setting", "Stable adult; pregnancy excluded");
  for (const label of [
    "Multidisciplinary hypertension / RDN approval",
    "Patient preference after shared risk-benefit discussion",
    "Medium-to-high-volume experienced RDN centre",
    "Exact device IFU, contrast / renal, medication and peri-procedure protocol reviewed",
  ])
    await radio(label, "Confirmed");
  await next();
  await radio("RDN decision", "All criteria met: schedule RDN");
  await date("Assessment / action date", T);
  await next();
  await noOverflow();
  await page.screenshot({
    path: out + "/01-rdn-confirmation-phone.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await continueAfterEntry(page);
  let record = await api(`/patients/${pat.id}/record`);
  assert(
    record.plan.some(
      (p) => p.title === "Renal denervation (RDN)" && p.status === "planned",
    ),
  );
  await openPatientView(page, "Investigations");
  await page.getByRole("button", { name: "Add procedure", exact: true }).click();
  await page.getByRole("button", { name: /^Renal denervation/ }).click();
  await date("Procedure date", T);
  await radio("RDN device", "Symplicity Spyral");
  await radio("RDN result", "Completed");
  await radio("Treated arteries", "Bilateral");
  await page
    .getByRole("dialog", { name: "Record renal denervation", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .getByRole("dialog", {
      name: "RDN follow-up",
      exact: true,
    })
    .waitFor();
  await radio(
    "Recovery status",
    "Stable; no unresolved access, renal or vascular complication",
  );
  await radio(
    "Medication reconciliation and ongoing BP therapy reviewed",
    "Confirmed",
  );
  await radio(
    "Home BP technique, access care and red flags explained",
    "Confirmed",
  );
  await date("Renal function / electrolyte check date", T);
  await date("ABPM / HBPM response assessment date", T);
  await radio("BP follow-up method", "HBPM");
  await date("Specialist follow-up date", T);
  await next();
  await noOverflow();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await continueAfterEntry(page);
  record = await api(`/patients/${pat.id}/record`);
  assert(
    record.plan.some(
      (p) => p.title === "Renal denervation (RDN)" && p.status === "completed",
    ),
  );
  assert.equal(record.meds.filter((m) => m.status === "active").length, 2);
  const v = await api(`/patients/${pat.id}/visits`, {
    service: "Cardiology clinic",
    reasons: ["Routine cardiology"],
  });
  await api(`/patients/${pat.id}/visits/${v.id}/close`, {
    note: "Synthetic visit",
  });
  await openPatientView(page, "Admissions & visits");
  const edit = page.getByRole("button", { name: "Edit visit", exact: true });
  await edit.waitFor();
  const rect = await edit.boundingBox();
  assert(rect.width < 85 && rect.height >= 44);
  assert.equal(
    await page
      .getByRole("button", { name: "Delete visit", exact: true })
      .count(),
    0,
  );
  await noOverflow();
  await page.screenshot({
    path: out + "/02-compact-visit-phone.png",
    animations: "disabled",
  });
  await edit.click();
  await page
    .getByRole("button", { name: "Delete this visit…", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete visit", exact: true })
    .waitFor();
  await radio("Reason for removal", "Duplicate entry");
  await page.getByRole("button", { name: "Delete visit", exact: true }).click();
  await continueAfterEntry(page);
  assert.equal(await page.locator('.phone-nav').getByRole('link',{name:'Patient administration',exact:true}).count(),0);
  await page.goto(base+'/administration');
  await page.getByRole("heading", { name: "Administrator access required" }).waitFor();
  await page.getByText("Your account is signed in as clinician.", { exact: false }).waitFor();
  await noOverflow();
  await openPhoneTools(page);
  await page
    .locator(".phone-nav")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await page.getByText("Rule Administrator", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  csrf = (await api("/session")).csrf;
  await openPhoneTools(page);
  await page.locator('.phone-nav').getByRole('link',{name:'Patient administration',exact:true}).click();
  await page.getByRole("heading", { name: /^(Set administration PIN|Unlock administration)$/ }).waitFor();
  if (await page.getByRole("heading", { name: "Set administration PIN" }).isVisible()) {
    await page.getByLabel("PIN", { exact: true }).fill("739204");
    await page.getByLabel("Confirm PIN", { exact: true }).fill("739204");
    await page.getByRole("button", { name: "Set PIN", exact: true }).click();
  }
  await page.getByRole("heading", { name: "Unlock administration" }).waitFor();
  await page.getByLabel("PIN", { exact: true }).fill("739204");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("group", { name: "Patient group" }).getByRole("button", { name: "Real" }).click();
  await page
    .getByRole("textbox", { name: "Find patient to manage" })
    .fill(fixtureName);
  await page
    .getByRole("button", { name: "Edit " + fixtureName, exact: true })
    .click();
  await page.getByLabel("Full name", { exact: true }).fill(editedName);
  await page
    .getByRole("dialog", { name: "Patient details", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await continueAfterEntry(page);
  await page
    .getByRole("textbox", { name: "Find patient to manage" })
    .fill(editedName);
  await page
    .getByRole("button", { name: "Delete " + editedName, exact: true })
    .waitFor();
  await noOverflow();
  await page.screenshot({
    path: out + "/03-patient-admin-phone.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Delete " + editedName, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete patient", exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Full name", { exact: true }).count(), 0);
  await radio("Why remove it", "Test or practice record");
  await page
    .getByRole("button", { name: "Remove " + editedName, exact: true })
    .click();
  await continueAfterEntry(page);
  await page.getByText("No matching patients.", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      async (id) => (await fetch(`/api/patients/${id}/record`)).status,
      pat.id,
    ),
    404,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: role-protected patient administration, compact visit controls, criteria-triggered RDN -> dated procedure -> actual result -> aftercare, phone layout and unchanged medicines.",
  );
} catch (e) {
  await page.screenshot({ path: out + "/failure.png" });
  throw e;
} finally {
  await browser.close();
}
