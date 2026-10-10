// Synthetic clinician walkthrough: procedure -> aftercare -> imaging -> renewed decision.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const out = process.argv[2] || "/tmp/af-care-check";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
p.setDefaultTimeout(15000);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const shown = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const day = (d, n) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
const radio = (label, value) =>
  p
    .getByRole("radiogroup", { name: label, exact: true })
    .getByRole("radio", { name: value })
    .click();
const date = (label, value) =>
  p.getByRole("textbox", { name: label, exact: true }).fill(shown(value));
const next = () => p.getByRole("button", { name: /^Continue( to|$)/ }).click();
try {
  await p.goto(base);
  await p.getByText("Dr. Ahmed", { exact: true }).click();
  await p.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const session = await p.evaluate(async () =>
    (await fetch("/api/session")).json(),
  );
  const api = (path, body) =>
    p.evaluate(
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
        if (!r.ok) throw Error(`${path}: ${j.error}`);
        return j;
      },
      { path, body, csrf: session.csrf },
    );
  const T = (await api("/health")).today;
  const pat = await api("/patients", {
    name: "Synthetic AF device care",
    mrn: "AF-UI-" + Date.now(),
    sex: "Male",
    birthDate: "1950-01-01",
    conditions: ["af", "htn"],
    sample: true,
  });
  const admission = await api(`/patients/${pat.id}/admissions`, {
    startedAt: `${day(T, -2)}T08:00:00+03:00`,
    location: "CCU",
    reasons: ["Other"],
  });
  for (const [code, doseValue] of [
    ["aspirin", 100],
    ["clopidogrel", 75],
  ])
    await api(`/patients/${pat.id}/medications`, {
      code,
      doseValue,
      frequency: "OD",
      route: "PO",
      indication: "other",
    });
  const url = `${base}/patients/${pat.id}`;
  await p.goto(url);
  const procedureButton = p.getByRole("button", {
    name: "+ Rhythm procedure / LAA closure",
    exact: true,
  });
  if (!(await procedureButton.isVisible()))
    await p
      .getByRole("button", { name: /Rhythm & devices/ })
      .first()
      .click();
  await procedureButton.click();
  await radio("Procedure", "LAA closure");
  await date("Procedure date", day(T, -1));
  await radio("Closure method", "Transcatheter occlusion");
  await radio("Closure device", "WATCHMAN FLX Pro");
  await radio("Closure result", "Implanted / completed");
  await radio("Antithrombotic regimen", "DAPT");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p
    .getByRole("dialog", {
      name: "After LAA closure: imaging & antithrombotic care",
    })
    .waitFor();
  const afterClosure = async (
    imagePlan = "Arrange surveillance or repeat imaging",
  ) => {
    await radio("Safety today", "No urgent symptoms reported");
    await radio(
      "Intended antithrombotic regimen",
      "DAPT per implant-team / device protocol",
    );
    await date("Antithrombotic review / transition decision date", day(T, 30));
    await next();
    await radio("TEE / CT surveillance", imagePlan);
    await date("Imaging / findings review date", day(T, 45));
    await date("LAA closure team follow-up date", day(T, 45));
    await next();
    await p.screenshot({
      animations: "disabled",
      path: `${out}/01-closure-plan.png`,
    });
    await p.getByRole("button", { name: "Confirm plan", exact: true }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
  };
  await afterClosure();
  let record = await api(`/patients/${pat.id}/record`);
  assert.equal(record.procedures[0].attributes.device, "WATCHMAN FLX Pro");
  assert.equal(
    record.meds.filter((m) => m.status === "active").length,
    2,
    "Aftercare must not change medicines",
  );
  const imaging = async (thrombus, leak) => {
    await p
      .getByRole("button", { name: "Record TEE / CT", exact: true })
      .click();
    await radio("Modality", "Cardiac CT");
    await radio("LAA thrombus", "Absent");
    await radio("Device-related thrombus", thrombus);
    await radio("Peridevice leak / residual flow", leak);
    await p.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "Phone form overflow",
    );
    await p.screenshot({
      animations: "disabled",
      path: `${out}/02-phone-imaging-${thrombus}.png`,
    });
    await p
      .getByRole("button", { name: "Save LAA imaging", exact: true })
      .click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await p.setViewportSize({ width: 1440, height: 1000 });
  };
  await imaging("Present", "Present");
  await p
    .getByText("Device / LA-LAA thrombus after LAA closure")
    .first()
    .waitFor();
  await p
    .getByRole("button", { name: "Review LAA closure care", exact: true })
    .click();
  await afterClosure("Review the recorded post-closure imaging");
  record = await api(`/patients/${pat.id}/record`);
  assert.ok(
    JSON.stringify(record.plan).includes(
      "Repeat TEE / CT after LAA closure thrombus",
    ),
  );
  assert.equal(record.meds.filter((m) => m.status === "active").length, 2);
  await imaging("Absent", "Absent");
  await p.goto(url);
  assert.equal(
    await p.getByText("Device / LA-LAA thrombus after LAA closure").count(),
    0,
  );
  await procedureButton.click();
  await radio("Procedure", "Ablation");
  await date("Procedure date", day(T, -1));
  await p
    .getByRole("button", {
      name: "AF (pulmonary vein isolation)",
      exact: true,
    })
    .click();
  await radio("Energy", "Pulsed field");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p
    .getByRole("dialog", {
      name: "After AF ablation: anticoagulation & recovery",
    })
    .waitFor();
  await radio("Safety today", "No urgent symptoms reported");
  await radio(
    "Rhythm / symptoms since ablation",
    "AF / flutter / atrial tachycardia recurrence or palpitations",
  );
  await radio(
    "Antiarrhythmic therapy review",
    "Review short-term antiarrhythmic therapy with EP",
  );
  await next();
  await radio(
    "Post-ablation minimum anticoagulation reference",
    "ACC/AHA/HRS: at least 3 calendar months",
  );
  await radio("Anticoagulation decision", "Continue / arrange effective OAC");
  await next();
  await date("EP / clinic review date", day(T, 60));
  await date("12-lead ECG date", day(T, 60));
  await radio(
    "Additional rhythm monitoring",
    "Symptoms / recurrence: arrange ambulatory monitoring",
  );
  await next();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    animations: "disabled",
    path: `${out}/03-phone-ablation-plan.png`,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    "Phone plan overflow",
  );
  await p.getByRole("button", { name: "Confirm plan", exact: true }).click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  record = await api(`/patients/${pat.id}/record`);
  assert.ok(
    JSON.stringify(record.plan).includes(
      "Annual 12-lead ECG after AF ablation",
    ),
  );
  assert.ok(
    JSON.stringify(record.plan).includes("Ambulatory ECG for post-ablation"),
  );
  assert.equal(record.meds.filter((m) => m.status === "active").length, 2);
  const journey = await api(`/patients/${pat.id}/journey`);
  assert.ok(JSON.stringify(journey).includes("After AF ablation"));
  assert.ok(JSON.stringify(journey).includes("After LAA closure"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: AF ablation and LAA closure entry, linked aftercare, DRT/repeat imaging, active medicines unchanged, admission history and phone layouts",
    { patient: pat.id, admission: admission.id },
  );
} catch (e) {
  fs.writeFileSync(
    `${out}/overflow.json`,
    JSON.stringify(
      await p.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .map((el) => ({
            tag: el.tagName,
            cls: el.className,
            text: el.textContent?.slice(0, 120),
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
          }))
          .filter((el) => el.right > innerWidth + 1 || el.left < -1),
      ),
      null,
      2,
    ),
  );
  await p.screenshot({ path: `${out}/failure.png` });
  fs.writeFileSync(`${out}/failure.txt`, await p.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
}
