import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
import { continueAfterEntry } from "./continue-after-entry.mjs";
const base = process.env.CARDIO_BASE_URL ?? "http://127.0.0.1:4310",
  out = process.argv[2] ?? "/tmp/cardio-pericardial";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(),
  p = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [];
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
const shot = async (name) => {
  await p.evaluate(() => document.fonts.ready);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
  await p.screenshot({ path: out + "/" + name + ".png" });
};
const dateFill = async (locator, date) =>
  locator.fill(date.split("-").reverse().join("/"));
const report = (extra = {}) => ({
  purpose: "Initial assessment",
  modality: "TTE",
  effusion: "Circumferential",
  size: 25,
  haemodynamics: "No tamponade features after assessment",
  inflammation: "Absent",
  constriction: "Absent",
  ...extra,
});
try {
  await p.goto(base);
  await p.getByText("Dr. Ahmed", { exact: true }).click();
  await p.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const today = (await api("/health")).today,
    next = new Date(Date.parse(today) + 7 * 86400000)
      .toISOString()
      .slice(0, 10);
  const id = (
    await api("/patients", {
      name: "Synthetic pericardial phone",
      mrn: "PERI-UI-" + Date.now(),
      sex: "Female",
      birthDate: "1962-01-01",
      conditions: [],
      sample: true,
    })
  ).id;
  await p.goto(base + "/patients/" + id + "/investigations");
  await p
    .getByRole("heading", { name: "Investigations", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Add study", exact: true }).click();
  await p.getByRole("button", { name: /^Pericardial imaging/ }).click();
  let dialog = p.getByRole("dialog");
  for (const name of [
    "Initial assessment",
    "TTE",
    "Circumferential",
    "No tamponade features after assessment",
    "Absent",
  ]) {
    if (name === "Absent") continue;
    await dialog.getByRole("radio", { name, exact: true }).click();
  }
  await dialog
    .getByRole("radiogroup", {
      name: "Pericardial inflammation on imaging",
      exact: true,
    })
    .getByRole("radio", { name: "Absent", exact: true })
    .click();
  await dialog
    .getByRole("radiogroup", { name: "Constrictive physiology", exact: true })
    .getByRole("radio", { name: "Absent", exact: true })
    .click();
  await dialog
    .getByRole("textbox", {
      name: "Maximum end-diastolic echo-free space",
      exact: true,
    })
    .fill("25");
  await shot("01-phone-report-entry");
  await dialog
    .getByRole("button", { name: "Save Pericardial imaging", exact: true })
    .click();
  await continueAfterEntry(p);
  await expect(dialog).toHaveCount(0);
  await p.goto(base + "/patients/" + id);
  await p.getByRole("heading", { name: "Today", exact: true }).waitFor();
  let card = p.locator('.cx-dec[data-problem="Pericardial disease"]');
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Review plan", exact: true }).click();
  let panel = p.locator(
    '[aria-label="Decision: Pericardial disease: assessment and care"]',
  );
  await panel.waitFor();
  await panel.getByRole("button", { name: "Edit answers", exact: true }).click();
  const radio = async (group, name) =>
    panel
      .getByRole("radiogroup", { name: "Decision: " + group, exact: true })
      .getByRole("radio", { name, exact: true })
      .click();
  for (const [group, name] of [
    ["Current haemodynamic safety", "Stable after assessment"],
    ["Current symptoms", "No current symptoms"],
    ["Management route", "Assessed effusion: conservative surveillance"],
    ["Cause assessment", "Reviewed / cause-specific care documented"],
    ["Inflammation status", "No evidence after assessment"],
    [
      "Activity and safety advice",
      "Activity restriction and return precautions reviewed",
    ],
  ])
    await radio(group, name);
  await panel
    .getByRole("checkbox", {
      name: "Decision: No additional tests before team review",
      exact: true,
    })
    .check();
  await dateFill(
    panel.getByRole("textbox", {
      name: "Decision: Assessment / action date",
      exact: true,
    }),
    today,
  );
  await dateFill(
    panel.getByRole("textbox", {
      name: "Decision: Clinical / results review date",
      exact: true,
    }),
    next,
  );
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await shot("02-phone-conservative-plan");
  await panel.getByRole("button", { name: "Apply plan", exact: true }).click();
  await expect(panel).toHaveCount(0);
  let s = await api(`/patients/${id}/record`);
  expect(s.meds).toHaveLength(0);
  expect(s.procedures).toHaveLength(0);
  await api(`/patients/${id}/studies`, {
    kind: "pericardial_imaging",
    date: new Date().toISOString(),
    findings: report({ haemodynamics: "Clinical tamponade" }),
  });
  await p.goto(base + "/patients/" + id);
  await expect(p.locator(".urgent-strip")).toContainText("urgent assessment");
  await card.getByRole("button", { name: "Review plan", exact: true }).click();
  await panel.waitFor();
  await expect(
    panel.getByRole("radiogroup", {
      name: "Decision: Assessment focus",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await shot("03-phone-urgent-route");
  await p.setViewportSize({ width: 1440, height: 1000 });
  // The desktop overview mounts a new decision board. Wait for that layout,
  // rather than inspecting the phone panel during the resize transition.
  await expect(p.locator(".overview-page .cx-grid")).toBeVisible();
  // the Consult overview (25 Oct 2026) keeps one layout across widths: an open decision stays open
  if (!(await panel.count())) await card.getByRole("button", { name: "Review plan", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await shot("04-desktop-urgent-route");
  await panel.getByRole("button", { name: "Apply plan", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(base + "/patients/" + id + "/investigations");
  await p.getByRole("button", { name: "Add procedure", exact: true }).click();
  await p.getByRole("button", { name: /^Pericardial drainage/ }).click();
  dialog = p.getByRole("dialog");
  await expect(dialog).toContainText("Record pericardial drainage");
  for (const name of [
    "Image-guided pericardiocentesis",
    "Drainage performed",
    "Tamponade",
    "Left in situ",
  ])
    await dialog.getByRole("radio", { name, exact: true }).click();
  await dialog
    .getByRole("button", { name: "None identified", exact: true })
    .click();
  await dateFill(
    dialog.getByRole("textbox", { name: "Procedure date", exact: true }),
    today,
  );
  await dialog
    .getByRole("textbox", { name: "Drained volume mL", exact: true })
    .fill("400");
  await shot("05-phone-procedure");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(p.getByRole("dialog")).toContainText("Pericardial plan");
  await p.getByRole("button", { name: "Close", exact: true }).click();
  s = await api(`/patients/${id}/record`);
  const d = s.procedures.find((x) => x.kind === "pericardiocentesis");
  expect(d.attributes.result).toBe("Drainage performed");
  await api(`/patients/${id}/wizards/pericarditis/complete`, {
    answers: {
      safety: "stable",
      type: "aftercare",
      symptoms: "none",
      route: "specialist",
      cause: "reviewed",
      inflammation: "unknown",
      actionDate: today,
      tests: ["fluid"],
      followDate: next,
      activity: "reviewed",
    },
  });
  const addFluid = async (culture, cytology) => {
    await p.goto(base + "/patients/" + id + "/investigations");
    await p.getByRole("button", { name: "Add study", exact: true }).click();
    await p.getByRole("button", { name: /^Pericardial fluid results/ }).click();
    dialog = p.getByRole("dialog");
    await dialog
      .getByRole("radiogroup", { name: "Actual drainage", exact: true })
      .getByRole("radio")
      .first()
      .click();
    for (const [group, name] of [
      ["Bacterial culture", culture],
      ["Cytology", cytology],
      ["TB testing (when indicated)", "Not indicated"],
    ])
      await dialog
        .getByRole("radiogroup", { name: group, exact: true })
        .getByRole("radio", { name, exact: true })
        .click();
    await shot(
      culture === "Pending"
        ? "06-phone-linked-pending-fluid"
        : "07-phone-linked-final-fluid",
    );
    await dialog
      .getByRole("button", { name: "Save Pericardial fluid", exact: true })
      .click();
    await continueAfterEntry(p);
    await expect(dialog).toHaveCount(0);
  };
  await addFluid("Pending", "Pending");
  s = await api(`/patients/${id}/summary`);
  expect(
    s.plan.find((x) => x.completesOn.kind === "pericardial_fluid").status,
  ).toBe("planned");
  await addFluid("No growth", "Negative for malignancy");
  s = await api(`/patients/${id}/summary`);
  const fluidPlan = s.plan.find(
    (x) => x.completesOn.kind === "pericardial_fluid",
  );
  expect(fluidPlan.awaitingReview).toBe(true);
  expect(s.plan.filter((x) => x.category === "follow_up")).toHaveLength(1);
  expect(fluidPlan.completesOn.procedureId).toBe(d.id);
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.goto(base + "/patients/" + id);
  await p.getByRole("heading", { name: "Today", exact: true }).waitFor();
  const reviewCard = p.locator('.cx-dec[data-problem="Pericardial disease"]');
  if (await reviewCard.locator(".problem-fold").isVisible()) await reviewCard.locator(".problem-fold").click();
  await reviewCard.locator(".problem-tasks summary").filter({hasText:"awaiting review"}).click();
  await expect(reviewCard.getByRole("button", {name:"Review result",exact:true})).toBeVisible();
  await reviewCard.scrollIntoViewIfNeeded();
  await shot("08-phone-results-review");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    out + "/results.json",
    JSON.stringify(
      {
        passed: true,
        scenarios: [
          "phone report entry",
          "stable large effusion conservative plan",
          "new tamponade urgent route",
          "desktop urgent route",
          "actual procedure and aftercare",
          "linked pending and final fluid results",
          "explicit clinical review",
          "reduced motion",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS pericardial phone / desktop, conservative / urgent routes, actual drainage, sample links and result-review loop",
  );
} catch (e) {
  await p.screenshot({ path: out + "/failure.png" }).catch(() => {});
  fs.writeFileSync(
    out + "/failure.txt",
    await p
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  throw e;
} finally {
  await browser.close();
}
