// Synthetic browser regression: encounter corrections, navigation and structural decisions.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const out = process.argv[2] || "/tmp/structural-context-check";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const radio = (label, name) =>
  page
    .getByRole("radiogroup", { name: label, exact: true })
    .getByRole("radio", { name, exact: true })
    .click();
const next = () =>
  page.getByRole("button", { name: /^Continue( to|$)/ }).click();
const dialog = (name) => page.getByRole("dialog", { name, exact: true });
const date = (label, value) =>
  page
    .getByRole("textbox", { name: label, exact: true })
    .fill(`${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`);
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const session = await page.evaluate(async () =>
    (await fetch("/api/session")).json(),
  );
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
      { path, body, csrf: session.csrf },
    );
  const T = (await api("/health")).today;
  const past = new Date(Date.now() - 60000).toISOString();
  const pat = await api("/patients", {
    name: "Synthetic structural browser",
    mrn: "STRUCT-UI-" + Date.now(),
    sex: "Male",
    birthDate: "1950-01-01",
    conditions: ["as"],
    sample: true,
  });
  const real = await api("/patients", {
    name: "Synthetic navigation fixture",
    mrn: "NAV-UI-" + Date.now(),
    sex: "Female",
    birthDate: "1960-01-01",
    conditions: [],
    sample: false,
  });
  const v = await api(`/patients/${pat.id}/visits`, {
    startedAt: past,
    service: "Cardiology",
    reasons: ["Routine cardiology"],
  });
  await page.goto(`${base}/patients/${pat.id}`);
  await page
    .getByRole("link", { name: "Admissions & visits", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit visit", exact: true }).click();
  await page
    .getByLabel("Clinic location", { exact: true })
    .fill("Synthetic corrected clinic");
  await date(
    "Start date",
    new Date(Date.parse(T + "T12:00:00Z") - 86400000)
      .toISOString()
      .slice(0, 10),
  );
  await radio("Reason for correction", "Wrong details");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await dialog("Edit visit").waitFor({ state: "hidden" });
  assert.equal(
    (await api(`/patients/${pat.id}/journey`)).contexts[0].location,
    "Synthetic corrected clinic",
  );
  await api(`/patients/${pat.id}/visits/${v.id}/close`, {
    note: "Original synthetic note",
  });
  await page.reload();
  await page
    .getByRole("link", { name: "Admissions & visits", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit visit", exact: true }).click();
  await page
    .getByLabel("Clinic note", { exact: true })
    .fill("Corrected synthetic clinic note");
  await radio("Reason for correction", "Wrong note");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await dialog("Edit visit").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Clinic note", exact: true }).click();
  await page
    .getByText("Corrected synthetic clinic note", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Delete visit", exact: true }).click();
  await radio("Reason for removal", "Duplicate entry");
  await dialog("Delete visit")
    .getByRole("button", { name: "Delete visit", exact: true })
    .click();
  await dialog("Delete visit").waitFor({ state: "hidden" });
  await page
    .getByText("No visits or admissions yet.", { exact: true })
    .waitFor();
  const a = await api(`/patients/${pat.id}/admissions`, {
    startedAt: past,
    location: "CCU",
    reasons: ["Other"],
  });
  await page.reload();
  await page
    .getByRole("link", { name: "Admissions & visits", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit admission", exact: true })
    .click();
  await page
    .getByLabel("Ward / location", { exact: true })
    .fill("Synthetic structural ward");
  await radio("Reason for correction", "Wrong details");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await dialog("Edit admission").waitFor({ state: "hidden" });
  assert.equal(
    (await api(`/patients/${pat.id}/journey`)).contexts[0].location,
    "Synthetic structural ward",
  );
  await api(`/patients/${pat.id}/admissions/${a.id}/discharge`, {
    endedAt: new Date().toISOString(),
    status: "Stable",
    plan: [],
  });
  await page.reload();
  await page
    .getByRole("link", { name: "Admissions & visits", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit admission", exact: true })
    .click();
  await page
    .getByLabel("Discharge summary", { exact: true })
    .fill("Corrected synthetic discharge summary");
  await radio("Reason for correction", "Wrong note");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await dialog("Edit admission").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Discharge summary", exact: true })
    .click();
  await page
    .getByText("Corrected synthetic discharge summary", { exact: true })
    .waitFor();
  await page.screenshot({ path: out + "/01-encounter-history.png" });
  console.log("Encounter edits passed");
  await page
    .getByRole("button", { name: "Delete admission", exact: true })
    .click();
  await radio("Reason for removal", "Wrong entry");
  await dialog("Delete admission")
    .getByRole("button", { name: "Delete admission", exact: true })
    .click();
  await dialog("Delete admission").waitFor({ state: "hidden" });
  await page
    .getByText("No visits or admissions yet.", { exact: true })
    .waitFor();
  // Switching groups unmounts the active patient and its drawer.
  await page.goto(`${base}/patients/${real.id}`);
  await page.getByRole("button", { name: "Pathways", exact: true }).click();
  await dialog("Clinical pathways").waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Sample patients", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Sample patients", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/patients");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page
      .getByRole("heading", {
        name: "Synthetic navigation fixture",
        exact: true,
      })
      .count(),
    0,
  );
  await page.goto(`${base}/patients/${pat.id}`);
  await page.getByRole("button", { name: "Pathways", exact: true }).click();
  await dialog("Clinical pathways").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const refs = await page.locator(".pathway-reference").evaluateAll((es) =>
    es.map((e) => ({
      height: e.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(e).lineHeight),
      nowrap: getComputedStyle(e).whiteSpace,
      text: e.textContent,
    })),
  );
  assert.ok(refs.length > 20);
  assert.ok(refs.every((r) => r.nowrap === "nowrap" && r.height <= r.line + 1));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: out + "/02-pathways-phone.png" });
  await page.getByLabel("Search pathways").fill("TAVI: indication");
  await page
    .getByRole("button", { name: /TAVI: indication & preparation/ })
    .click();
  await radio("Clinical stability", "Stable for elective evaluation");
  await radio(
    "Expected benefit and patient goals",
    "Meaningful benefit and goals agreed",
  );
  await radio(
    "Heart Team and patient decision",
    "Documented shared decision for this intervention",
  );
  await radio("Aortic lesion", "Severe high-gradient AS");
  await radio(
    "Intervention indication",
    "Symptoms attributable to severe valve disease",
  );
  await radio(
    "Integrated severity confirmation",
    "Echo and any required DSE / CT calcium review complete",
  );
  await radio("Surgical / procedural risk", "Increased / high surgical risk");
  await next();
  await radio(
    "Coronary assessment and treatment strategy",
    "Reviewed; coronary strategy agreed",
  );
  await radio(
    "Blood count, renal function and bleeding assessment",
    "Results and contrast / bleeding plan reviewed",
  );
  await radio(
    "Infection and endocarditis assessment",
    "No active infection; prevention plan reviewed",
  );
  await radio("Next step", "Team agreed: schedule intervention");
  await date("Work-up / procedure / review date", T);
  await next();
  await page
    .getByText(/Structural CT \/ 3D TOE report/)
    .first()
    .waitFor();
  await page.screenshot({ path: out + "/03-tavi-missing-workup.png" });
  await page.getByRole("button", { name: "Confirm plan", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const plans = (await api(`/patients/${pat.id}/record`)).plan;
  assert.ok(plans.some((p) => p.completesOn.kind === "structural_imaging"));
  assert.ok(
    !plans.some(
      (p) =>
        p.status === "planned" &&
        p.category === "procedure" &&
        p.title.startsWith("TAVI"),
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await api(`/patients/${pat.id}/echo`, {
    date: new Date().toISOString(),
    quality: "formal",
    lvef: 55,
    findings: [],
    valves: { as: "Severe" },
    measures: { ava: 0.8, "av-vmax": 4.3, "av-mg": 45 },
  });
  await page.reload();
  await page.getByRole("link", { name: "Investigations", exact: true }).click();
  await page.getByRole("button", { name: "Add study", exact: true }).click();
  await page
    .getByRole("button", { name: /Structural intervention imaging/ })
    .click();
  await radio("Planned intervention", "TAVI");
  await radio("Imaging modality", "Cardiac CT");
  await radio("Reported anatomical suitability", "Suitable");
  await radio("Structural team reviewed the complete report", "Yes");
  for (const [label, value] of [
    ["Annulus area", "450"],
    ["Left coronary height", "14"],
    ["Right coronary height", "16"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await radio("Sinus / STJ / ascending aorta review", "Complete");
  await radio("Valve / LVOT calcification review", "Complete");
  await radio("Vascular access assessment", "Transfemoral feasible");
  await page
    .getByRole("button", { name: "Save Structural imaging", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Pathways", exact: true }).click();
  await page.getByLabel("Search pathways").fill("TAVI: indication");
  await page
    .getByRole("button", { name: /TAVI: indication & preparation/ })
    .click();
  await radio("Clinical stability", "Stable for elective evaluation");
  await radio(
    "Expected benefit and patient goals",
    "Meaningful benefit and goals agreed",
  );
  await radio(
    "Heart Team and patient decision",
    "Documented shared decision for this intervention",
  );
  await radio("Aortic lesion", "Severe high-gradient AS");
  await radio(
    "Intervention indication",
    "Symptoms attributable to severe valve disease",
  );
  await radio(
    "Integrated severity confirmation",
    "Echo and any required DSE / CT calcium review complete",
  );
  await radio("Surgical / procedural risk", "Increased / high surgical risk");
  await next();
  await radio(
    "Coronary assessment and treatment strategy",
    "Reviewed; coronary strategy agreed",
  );
  await radio(
    "Blood count, renal function and bleeding assessment",
    "Results and contrast / bleeding plan reviewed",
  );
  await radio(
    "Infection and endocarditis assessment",
    "No active infection; prevention plan reviewed",
  );
  await radio("Next step", "Team agreed: schedule intervention");
  await date("Work-up / procedure / review date", T);
  await next();
  await page.getByRole("button", { name: "Confirm plan", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.ok(
    (await api(`/patients/${pat.id}/record`)).plan.some(
      (p) => p.category === "procedure" && p.title.startsWith("TAVI"),
    ),
  );
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Valve intervention", exact: true })
    .click();
  await date("Procedure date", T);
  await radio("Valve", "Aortic");
  await radio("Procedure", "TAVI");
  await radio("Access", "Transfemoral");
  await page
    .getByLabel("Device model", { exact: true })
    .fill("Synthetic TAVI device");
  await page
    .getByLabel("Number of implants / clips", { exact: true })
    .fill("1");
  await radio("Residual regurgitation / leak", "Mild");
  await page
    .getByLabel("Postprocedure mean valve gradient (mmHg)", { exact: true })
    .fill("9");
  await page
    .getByRole("dialog", { name: "Record valve intervention", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await dialog("After TAVI / TEER: recovery & follow-up").waitFor();
  await radio("Safety today", "No urgent symptoms");
  await radio(
    "Procedure report and residual valve result",
    "Result, residual leak / regurgitation and gradient reviewed",
  );
  await radio(
    "ECG / conduction and device review",
    "ECG / conduction / device plan reviewed",
  );
  await radio(
    "Antithrombotic and current device protocol",
    "Implant-team protocol, OAC / PCI indications and bleeding risk reviewed",
  );
  await date("Antithrombotic review date", T);
  await next();
  await date("Baseline / reassessment echocardiogram date", T);
  await date("Structural / valve clinic date", T);
  await radio(
    "Aftercare education",
    "Access care, warning signs, endocarditis prevention and contact provided",
  );
  await radio("Later imaging plan", "Plan annual valve imaging");
  await next();
  await page
    .getByRole("button", { name: /Continue to antithrombotic/ })
    .waitFor();
  await page.screenshot({ path: out + "/05-tavi-aftercare.png" });
  await page
    .getByRole("button", { name: "Confirm without it", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const actual = await api(`/patients/${pat.id}/record`);
  assert.ok(
    actual.procedures.some(
      (p) => p.attributes.deviceModel === "Synthetic TAVI device",
    ),
  );
  assert.ok(
    actual.plan.some(
      (p) =>
        p.title.includes("annual valve echocardiogram") && p.completesOn.after,
    ),
  );
  console.log(
    "PASS: TAVI work-up -> reviewed CT -> scheduling -> actual implant -> aftercare and antithrombotic hand-off.",
  );
  await page.getByRole("button", { name: "Pathways", exact: true }).click();
  await page.getByLabel("Search pathways").fill("TEER: mitral");
  await page
    .getByRole("button", { name: /TEER: mitral \/ tricuspid selection/ })
    .click();
  await radio("TEER valve", "Tricuspid");
  await page
    .getByRole("radiogroup", {
      name: "Tricuspid candidates: RHC / PVR",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("radiogroup", {
        name: "MR mechanism (mitral only)",
        exact: true,
      })
      .count(),
    0,
  );
  await page.screenshot({ path: out + "/04-tricuspid-requirements.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: audited visit/admission edits and removals, sample navigation, one-line phone references, TAVI missing-data gate and tricuspid RHC selection.",
  );
} catch (e) {
  await page.screenshot({ path: out + "/failure.png" });
  console.log(await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
}
