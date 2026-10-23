import {continueAfterEntry} from "./continue-after-entry.mjs";
// Synthetic-only phone regression: date typing/picking, manual follow-up and compact history.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const out = process.argv[2] || "/tmp/cardio-date-journey";
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
    name: "Synthetic dates and compact journey",
    mrn: "DATE-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["htn"],
    sample: true,
  });
  await api(`/patients/${p.id}/wizards/htn-secondary/complete`, {
    answers: {
      clues: ["resistant", "renal", "osa"],
      paAction: "screen",
      tests: [
        "renal",
        "renovascular",
        "osa",
        "adrenergic",
        "cushing",
        "thyroid",
        "calcium",
        "coarctation",
        "drugs",
      ],
      disposition: "workup",
      when: today,
    },
  });
  await page.getByRole("button",{name:"Sample patients",exact:true}).click();
  await page.goto(`${base}/patients/${p.id}/journey`);
  await page.locator(".jr-event").first().waitFor();
  const row = page
    .locator(".jr")
    .filter({ has: page.locator(".node.complication") })
    .first();
  assert(
    (await row.boundingBox()).height < 130,
    "Closed decision must stay compact",
  );
  assert.equal(
    await row.locator(".dt").innerText(),
    "Decision recorded · View details",
  );
  await row.evaluate(e=>e.scrollIntoView({block:"center",behavior:"instant"}));
  await page.screenshot({
    animations: "disabled",
    path: out + "/01-compact-journey-phone.png",
  });
  await row.locator(".jr-event").click();
  const detail = page.getByRole("dialog");
  await detail.waitFor();
  assert(
    (await detail.innerText()).includes(
      "Secondary hypertension",
    ),
  );
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await noOverflow();
  await page.getByRole("button", { name: "Pathways", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search pathways" })
    .fill("Secondary hypertension");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Secondary hypertension: screening/ })
    .click();
  // pathways open on the decision (23 Oct 2026): the step-by-step questions are behind "Change details"
  await page.getByRole("button", { name: "Change details", exact: true }).last().click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  const field = page.getByRole("textbox", {
    name: "Assessment / action date",
    exact: true,
  });
  await field.fill("");
  await field.pressSequentially("18112030");
  assert.equal(await field.inputValue(), "18/11/2030");
  await field.press("Backspace");
  assert.equal(await field.inputValue(), "18/11/203");
  assert(await page.getByRole("button", { name: /^Continue/ }).isDisabled());
  await field.pressSequentially("1");
  assert.equal(await field.inputValue(), "18/11/2031");
  await field.fill("29/02/2027");
  assert.equal(await field.getAttribute("aria-invalid"), "true");
  assert(await page.getByRole("button", { name: /^Continue/ }).isDisabled());
  await field.fill("18112030");
  assert.equal(await field.inputValue(), "18/11/2030");
  await page.getByRole("button", { name: "Choose from calendar" }).click();
  const picker = page.getByRole("group", { name: "Calendar", exact: true });
  await picker.waitFor();
  const box = await picker.boundingBox();
  assert(
    box.y >= 0 &&
      box.y + box.height <= 844 &&
      box.x >= 0 &&
      box.x + box.width <= 390,
    "Calendar is visible inside phone viewport",
  );
  await page.screenshot({
    animations: "disabled",
    path: out + "/02-calendar-phone.png",
  });
  await page
    .getByRole("button", { name: "20 November 2030", exact: true })
    .click();
  assert.equal(await field.inputValue(), "20/11/2030");
  await page.getByRole("button", { name: "Choose from calendar" }).click();
  await picker.press("Escape");
  assert(await page.getByRole("dialog").isVisible());
  assert.equal(await picker.count(), 0);
  await noOverflow();
  await page.screenshot({
    animations: "disabled",
    path: out + "/03-secondary-date-phone.png",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Pathways", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search pathways" })
    .fill("severe hypertension");
  await page.getByRole("button", { name: /^Severe hypertension/ }).click();
  await page.getByRole("button", { name: "Change details", exact: true }).last().click();
  // Legacy intervals also provide a manual date; verify this independently of new date questions.
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  const oral = page.getByRole("button", { name: /^Adjust oral therapy/ });
  if ((await oral.getAttribute("aria-pressed")) !== "true") await oral.click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page
    .getByRole("radiogroup", { name: "Renal function and K", exact: true })
    .getByRole("radio", { name: /^In 1 week(?: GUIDELINE)?$/ })
    .click();
  await page
    .getByRole("radiogroup", { name: "BP review", exact: true })
    .getByRole("radio", { name: /^Clinic · 1 week(?: GUIDELINE)?$/ })
    .click();
  const manual = page.getByRole("textbox", { name: /exact date/ }).first();
  await manual.waitFor();
  await manual.fill("21/11/2030");
  const renalGroup=page.locator(".q").filter({has:page.getByRole("radiogroup",{name:"Renal function and K",exact:true})});
  await expect(renalGroup.getByRole("button",{name:"Apply",exact:true})).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Renal function and K", exact: true })
    .getByRole("radio", { name: /^Tomorrow(?: GUIDELINE)?$/ })
    .click();
  const tomorrow = new Date(today + "T12:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const expected = tomorrow.toISOString().slice(0, 10);
  await expect(manual).toHaveValue(
    `${expected.slice(8)}/${expected.slice(5, 7)}/${expected.slice(0, 4)}`,
  );
  await manual.fill("21/11/2030");
  const clinic = page.getByRole("textbox", {
    name: "BP review exact date",
    exact: true,
  });
  await clinic.fill("22/11/2030");
  await page.screenshot({
    animations: "disabled",
    path: out + "/04-manual-followup-phone.png",
  });
  await page.getByRole("button", { name: /^Continue/ }).click();
  assert.equal(
    await page
      .getByRole("textbox", {
        name: "Renal function and potassium due date",
        exact: true,
      })
      .inputValue(),
    "21/11/2030",
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "Clinic review due date", exact: true })
      .inputValue(),
    "22/11/2030",
  );
  const due = page.getByRole("textbox", {
    name: "Clinic review due date",
    exact: true,
  });
  await due.fill("22/11/203");
  assert(
    await page
      .getByRole("button", { name: "Confirm plan", exact: true })
      .isDisabled(),
  );
  await due.fill("22/11/2030");
  await page.getByText("Draft saved",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Close",exact:true}).click();
  await page.getByRole("button",{name:"Pathways",exact:true}).click();
  await page.getByRole("textbox",{name:"Search pathways"}).fill("severe hypertension");
  await page.getByRole("dialog").getByRole("button",{name:/^Severe hypertension/}).click();
  await expect(page.getByRole("textbox",{name:"Clinic review due date",exact:true})).toHaveValue("22/11/2030");
  await expect(page.getByRole("textbox",{name:"Renal function and potassium due date",exact:true})).toHaveValue("21/11/2030");
  // a reopened draft lands on the decision with the dates kept (23 Oct 2026)
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await continueAfterEntry(page);
  const rec = await api(`/patients/${p.id}/record`);
  assert(
    rec.plan.some(
      (x) => x.title === "Clinic review" && x.dueDate === "2030-11-22",
    ),
  );
  assert(
    rec.plan.some(
      (x) =>
        x.title === "Renal function and potassium" &&
        x.dueDate === "2030-11-21",
    ),
  );
  await noOverflow();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: sequential/pasted dates, invalid-date blocking, visible keyboard-accessible calendar, compact Journey, manual follow-up",
  );
} finally {
  await browser.close();
}
