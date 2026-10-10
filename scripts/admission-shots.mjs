// Synthetic admission → pathway → decision → plan → discharge walkthrough.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const out = process.argv[2] || "/tmp/admission-shots";
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.setDefaultTimeout(15000);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto("http://127.0.0.1:4310");
  await p.getByText("Dr. Ahmed", { exact: true }).click();
  await p.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const session = await p.evaluate(
    async () => await (await fetch("/api/session")).json(),
  );
  const post = (path, body) =>
    p.evaluate(
      async ({ path, body, csrf }) => {
        const r = await fetch("/api" + path, {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) throw Error(j.error);
        return j;
      },
      { path, body, csrf: session.csrf },
    );
  const pat = await post("/patients", {
    name: "Synthetic admission flow",
    mrn: "ADMISSION-" + Date.now(),
    sex: "Male",
    birthDate: "1960-01-01",
    conditions: ["hfref"],
    sample: true,
  });
  await post(`/patients/${pat.id}/medications`, {
    code: "spironolactone",
    doseValue: 25,
    frequency: "OD",
    route: "PO",
    indication: "hf",
  });
  await post(`/patients/${pat.id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: [{ code: "potassium", value: 5.8 }],
  });
  await p.goto(`http://127.0.0.1:4310/patients/${pat.id}`);
  await p
    .getByRole("link", { name: "Admissions & visits", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "Admissions & visits", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "New admission", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Start admission" })
    .getByRole("button", { name: "Acute decompensated HF", exact: true })
    .click();
  await p.screenshot({ animations: "disabled", path: `${out}/01-start-admission.png` });
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "Admit", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Review pathways", exact: true })
    .waitFor();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ animations: "disabled", path: `${out}/02-phone-admission.png` });
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw Error("Admissions page overflows");
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.getByRole("button", { name: "Review pathways", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Clinical pathways" })
    .getByRole("button", { name: /Hyperkalaemia review/ })
    .first()
    .click();
  await p.getByText("Is this result reliable?").waitFor();
  await p.getByRole("radio", { name: "Yes, act on it", exact: true }).click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await p
    .getByRole("radiogroup", { name: "ECG changes of hyperkalaemia?" })
    .getByRole("radio", { name: "None", exact: true })
    .click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  const reduce = p.getByRole("button", { name: "Reduce MRA dose" });
  if ((await reduce.getAttribute("aria-pressed")) !== "true")
    await reduce.click();
  await p.getByRole("radio", { name: "12.5 mg" }).click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await p.getByRole("radio", { name: "In 3 days" }).click();
  await p.getByRole("radio", { name: "Clinic · 1 week" }).click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await p.screenshot({ animations: "disabled", path: `${out}/03-pathway-confirm.png` });
  const request = p.waitForRequest((r) =>
    r.url().endsWith("/wizards/hyperkalaemia/complete"),
  );
  await p.getByRole("button", { name: "Confirm plan", exact: true }).click();
  const payload = (await request).postDataJSON();
  if (!payload.contextId || !payload.recommendationId)
    throw Error("Catalog pathway lost admission or alert link");
  await p.getByText("Hyperkalaemia review recorded").waitFor();
  await p
    .getByRole("heading", { name: "Admissions & visits", exact: true })
    .waitFor();
  await p
    .getByText("Medication changes during admission", { exact: true })
    .waitFor();
  await p.locator(".toast").waitFor({ state: "hidden" });
  await p.screenshot({ animations: "disabled", path: `${out}/04-admission-plan.png` });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ animations: "disabled", path: `${out}/04b-phone-plan.png` });
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Phone plan overflows");
  for (const name of ["Add labs", "Add medicines"]) {
    const box = await p.getByRole("button", { name, exact: true }).boundingBox();
    if (!box || box.y < 0 || box.y + box.height > 789) throw Error(`${name} is not visible above the phone navigation`);
  }
  await p.setViewportSize({ width: 1440, height: 1024 });
  await p.locator("[data-admission-id]").getByRole("button", { name: "Add labs", exact: true }).click();
  const entry = p.getByRole("dialog", { name: "Add results", exact: true });
  await entry.getByRole("region", { name: "Admission context" }).getByText("Medication changes during admission", { exact: true }).waitFor();
  if (!(await entry.locator(".drawer-context").isVisible())) throw Error("Desktop entry lost admission context");
  await p.screenshot({ animations: "disabled", path: `${out}/04c-desktop-workspace.png` });
  const startedEntry = performance.now();
  await p.getByLabel("Creatinine", { exact: true }).fill("100");
  await p.getByLabel("Sodium", { exact: true }).fill("140");
  await p.getByLabel("Potassium", { exact: true }).fill("5.8");
  for (let i = 0; i < 35; i++) {
    await p.keyboard.press("Tab");
    if (!(await p.evaluate(() => !!document.activeElement.closest('[role="dialog"]')))) throw Error("Workspace focus escaped");
  }
  await entry.getByRole("button", { name: "Save 3 results", exact: true }).click();
  await entry.waitFor({ state: "hidden" });
  console.log("Automated entry duration (includes keyboard-trap check; not clinician time):", Math.round(performance.now() - startedEntry), "ms");
  await p
    .getByRole("heading", { name: "Admission", exact: true })
    .locator("..")
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Discharge", exact: true })
    .click();
  await p.getByRole("dialog", { name: "Discharge", exact: true }).waitFor();
  await p.getByRole("radio", { name: "Improved", exact: true }).click();
  await p.getByText(/Already booked · Clinic review/).waitFor();
  if (
    !(await p
      .getByLabel("Reuse the existing clinic booking", { exact: false })
      .isChecked())
  )
    throw Error("Existing clinic booking was not reused");
  await p
    .getByRole("textbox", { name: /Handover \/ outstanding issues/ })
    .fill("Repeat renal profile with HF clinic team");
  await p.screenshot({ animations: "disabled", path: `${out}/05-discharge.png` });
  await p
    .getByRole("button", { name: "Confirm discharge", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Discharge summary", exact: true })
    .click();
  await p.locator("pre").waitFor();
  await p.screenshot({ animations: "disabled", path: `${out}/06-discharge-summary.png` });
  const note = await p.locator("pre").textContent();
  if (!note.includes("Hyperkalaemia review") || !note.includes("12.5 mg"))
    throw Error("Discharge summary lost pathway changes");
  if (
    !note.includes("Decisions:") ||
    !note.includes("Repeat renal profile with HF clinic team")
  )
    throw Error("Discharge summary lost recorded decisions or handover");
  const current = await p.evaluate(
    async (id) => await (await fetch(`/api/patients/${id}/summary`)).json(),
    pat.id,
  );
  if (
    current.plan.filter(
      (t) => /^(HF )?clinic review$/i.test(t.title) && t.status === "planned",
    ).length !== 1
  )
    throw Error("Discharge duplicated clinic follow-up");
  await p.getByRole("link", { name: "Investigations", exact: true }).click();
  const potassiumRow = p.getByRole("row").filter({ has: p.getByText("Potassium", { exact: true }) });
  await potassiumRow.getByRole("button", { name: "Correct", exact: true }).click();
  await p.getByRole("radio", { name: "The value was wrong", exact: true }).click();
  await p.getByLabel("Right value", { exact: false }).fill("4.8");
  await p.getByRole("button", { name: "Save correction", exact: true }).click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  await potassiumRow.getByText("4.8", { exact: true }).waitFor();
  await p.screenshot({ animations: "disabled", path: `${out}/07-corrected-result.png` });
  if (errors.length) throw Error(errors.join(";"));
  console.log(
    "Admission/catalog pathway/alert/decision/plan/discharge integration passed",
    JSON.stringify({
      contextId: payload.contextId,
      recommendationId: payload.recommendationId,
    }),
  );
} catch (e) {
  await p.screenshot({ animations: "disabled", path: `${out}/FAIL.png` }).catch(() => {});
  throw e;
} finally {
  await b.close();
}
