import fs from "node:fs";
import { chromium, expect } from "@playwright/test";

const root = process.argv[2] ?? "screenshots/past-admission";
fs.mkdirSync(root, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = (path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const session = await (await fetch("/api/session")).json();
      const r = await fetch(
        "/api" + path,
        body
          ? {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": session.csrf,
              },
              body: JSON.stringify(body),
            }
          : {},
      );
      const data = await r.json();
      if (!r.ok) throw Error(path + ": " + JSON.stringify(data));
      return data;
    },
    { path, body },
  );
let seq = 0;
const create = (label) =>
  api("/patients", {
    name: "Synthetic history " + label,
    mrn: "PAST-UI-" + Date.now() + "-" + ++seq,
    sex: "Male",
    birthDate: "1960-01-01",
    sample: true,
    conditions: [],
  });
const go = (id, tab = "visits") =>
  page.goto(`http://127.0.0.1:4310/patients/${id}/${tab}`);
const open = async () => {
  await page
    .getByRole("button", { name: "Past admission", exact: true })
    .click();
  await expect(
    page.getByLabel("Admission date", { exact: true }),
  ).toBeEnabled();
};
const fill = async () => {
  await page.getByLabel("Admission date", { exact: true }).fill("01/03/2025");
  await page.getByLabel("Discharge date", { exact: true }).fill("05/03/2025");
  await expect(page.getByLabel("Hospital / ward", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Source", { exact: true })
    .selectOption("Discharge summary");
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page
    .getByLabel("Discharge summary (optional)", { exact: true })
    .fill("Synthetic recovered admission report");
};
const shot = (name) =>
  page.screenshot({ path: `${root}/${name}.png`, animations: "disabled" });
const close = async () => {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
};
const waitPost = (suffix) => {
  const response = page.waitForResponse(
    (r) => r.url().endsWith(suffix) && r.request().method() === "POST",
  );
  response.catch(() => {});
  return response;
};
const run = async (name, fn) => {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    await shot("failure-" + results.length);
    throw e;
  } finally {
    fs.writeFileSync(
      `${root}/browser-results.json`,
      JSON.stringify({ results, errors }, null, 2),
    );
  }
};
try {
  await page.goto("http://127.0.0.1:4310");
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const patient = await create("with current visit");
  const live = await api(`/patients/${patient.id}/visits`, {
    service: "Clinic",
    reasons: ["Routine cardiology"],
  });
  let historical;
  await run(
    "Past admission draft survives closing and reloading beside an active visit",
    async () => {
      await go(patient.id);
      await open();
      await fill();
      await page
        .getByText("Historical labs & medicines", { exact: true })
        .click();
      await page
        .getByLabel("Labs during admission (reported)", { exact: true })
        .fill("Synthetic old potassium 3.1 mmol/L");
      await page
        .getByLabel("Medicines at discharge (historical)", { exact: true })
        .fill("Synthetic old furosemide 80 mg");
      await close();
      await page.reload();
      await open();
      await expect(
        page.getByLabel("Admission date", { exact: true }),
      ).toHaveValue("01/03/2025");
      await expect(
        page.getByLabel("Discharge date", { exact: true }),
      ).toHaveValue("05/03/2025");
      await expect(page.getByLabel("Source", { exact: true })).toHaveValue(
        "Discharge summary",
      );
      await expect(
        page.getByLabel("Discharge summary (optional)", { exact: true }),
      ).toHaveValue("Synthetic recovered admission report");
      await page
        .getByRole("button", { name: "Choose from calendar", exact: true })
        .first()
        .click();
      await expect(
        page
          .getByRole("button", { name: "Choose from calendar", exact: true })
          .first(),
      ).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await shot("01-restored-past-admission");
    },
  );
  await run(
    "Save creates a closed dated admission without activating its reported labs or medicines",
    async () => {
      await page
        .getByRole("button", { name: "Save past admission", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const journey = await api(`/patients/${patient.id}/journey`);
      historical = journey.contexts.find((c) => c.summary.historical);
      expect(historical.status).toBe("closed");
      expect(historical.location).toBeNull();
      expect(journey.contexts.find((c) => c.id === live.id).status).toBe(
        "open",
      );
      expect(historical.summary.reportedMedications).toContain("furosemide 80");
      const record = await api(`/patients/${patient.id}/record`);
      expect(record.todayValues.potassium).toBeUndefined();
      const card = page.locator(`[data-admission-id="${historical.id}"]`);
      await expect(card.getByText("Historical", { exact: true })).toBeVisible();
      await expect(card.locator(".meta")).toContainText("01 Mar 2025");
      await expect(card.locator(".meta")).toContainText("05 Mar 2025");
      await card
        .getByRole("button", { name: "Discharge summary", exact: true })
        .click();
      await expect(card.locator("pre")).toContainText("old potassium 3.1");
      await expect(card.locator("pre")).toContainText("old furosemide 80");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await shot("02-closed-history-and-summary");
    },
  );
  await run(
    "Journey identifies old admissions and preserves the source without an invented clock",
    async () => {
      await go(patient.id, "journey");
      await page
        .getByRole("checkbox", { name: "Show older history", exact: true })
        .check();
      const start = page.locator(".jr").filter({
        has: page.getByRole("button", { name: /^Past admission · Other/ }),
      });
      const end = page.locator(".jr").filter({
        has: page.getByRole("button", { name: /^Past admission ended/ }),
      });
      await expect(start).toContainText("Source: Discharge summary");
      await expect(start.locator(".date")).toContainText("2025");
      await expect(end.locator(".date")).toContainText("2025");
      const old = (await api(`/patients/${patient.id}/journey`)).events.filter(
        (e) => e.context_id === historical.id,
      );
      expect(old.every((e) => e.dateOnly)).toBe(true);
      await shot("07-historical-journey");
      const today = (await api("/health")).today;
      const currentYearDate = today.slice(0, 4) + "-01-01";
      if (currentYearDate < today) {
        const x = await create("date-only this year");
        await api(`/patients/${x.id}/admissions/history`, {
          draftVersion: 0,
          startedOn: currentYearDate,
          endedOn: currentYearDate,
          location: "Previous hospital",
          reasons: ["Other"],
          source: "Discharge summary",
          narrative: "",
          note: "Synthetic same-year historical admission",
          events: [],
          dischargeStatus: "",
          destination: "",
          reportedLabs: "",
          reportedMedications: "",
        });
        await go(x.id, "journey");
        await page
          .getByRole("checkbox", { name: "Show older history", exact: true })
          .check();
        const dates = page.locator(".jr .date").filter({ hasText: "01 Jan" });
        await expect(dates).toHaveCount(1);
        await expect(dates.locator("span")).toHaveText(today.slice(0, 4));
        await shot("08-same-year-history-without-clock");
      }
      await go(patient.id);
    },
  );
  await run(
    "Duplicate historical entry shows an actionable error and keeps the form",
    async () => {
      await open();
      await fill();
      const response = waitPost("/admissions/history");
      await page
        .getByRole("button", { name: "Save past admission", exact: true })
        .click();
      expect((await response).status()).toBe(409);
      await expect(page.getByRole("alert")).toContainText("already exists");
      await expect(
        page.getByLabel("Admission date", { exact: true }),
      ).toHaveValue("01/03/2025");
      expect(
        (await api(`/patients/${patient.id}/journey`)).contexts.length,
      ).toBe(2);
      await shot("03-duplicate-refused");
      await close();
    },
  );
  await run(
    "Historical reports and source can be corrected, then the admission removed",
    async () => {
      let card = page.locator(`[data-admission-id="${historical.id}"]`);
      await card
        .getByRole("button", { name: "Edit admission", exact: true })
        .click();
      await expect(
        page.getByLabel("Ward / location", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("Labs during admission (reported)", { exact: true }),
      ).toHaveValue("Synthetic old potassium 3.1 mmol/L");
      expect(await page.locator('input[type="time"]').count()).toBe(0);
      await page
        .getByLabel("Historical source", { exact: true })
        .selectOption("Previous hospital record");
      await page
        .getByLabel("Labs during admission (reported)", { exact: true })
        .fill("Synthetic corrected old lab report");
      await page
        .getByRole("radio", { name: "Wrong details", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const corrected = (
        await api(`/patients/${patient.id}/journey`)
      ).contexts.find((c) => c.id === historical.id);
      expect(corrected.summary.reportedLabs).toBe(
        "Synthetic corrected old lab report",
      );
      expect(corrected.summary.source).toBe("Previous hospital record");
      await card
        .getByRole("button", { name: "Edit admission", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete this admission…", exact: true })
        .click();
      await page
        .getByRole("radio", { name: "Wrong entry", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete admission", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await expect(card).toHaveCount(0);
      const remaining = (await api(`/patients/${patient.id}/journey`)).contexts;
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(live.id);
      await shot("04-history-removed-current-visit-retained");
    },
  );
  await run(
    "Past admission remains accessible during an active inpatient admission on mobile",
    async () => {
      const x = await create("current inpatient");
      await api(`/patients/${x.id}/admissions`, {
        startedAt: new Date().toISOString(),
        location: "CCU",
        reasons: ["Other"],
      });
      await go(x.id);
      await expect(
        page.getByRole("button", { name: "Past admission", exact: true }),
      ).toBeVisible();
      await open();
      await fill();
      await page
        .getByRole("button", { name: "Save past admission", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect(
        (await api(`/patients/${x.id}/journey`)).contexts.filter(
          (c) => c.status === "open",
        ).length,
      ).toBe(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await shot("05-current-inpatient-with-history");
    },
  );
  await run(
    "Both anemia spellings find the comorbidity and keep it outside risk factors",
    async () => {
      const x = await create("anemia search");
      await go(x.id, "history");
      const section = page.locator("section").filter({
        has: page.getByRole("heading", {
          name: "Other conditions",
          exact: true,
        }),
      });
      await section.getByRole("button", { name: "+ Add", exact: true }).click();
      for (const spelling of ["anemia", "anaemia"]) {
        await page
          .getByLabel("Search diagnoses", { exact: true })
          .fill(spelling);
        await expect(
          page.getByRole("button", { name: "Anaemia", exact: true }),
        ).toBeVisible();
      }
      await page.getByRole("button", { name: "Anaemia", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Add", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await expect(section).toContainText("Anaemia");
      // 14 Oct 2026 (Ahmed): non-cardiac conditions sit on the risk-factor line as "other", not as risk factors
      await expect(
        page.locator('[aria-label="Risk factors"] .line-text.other'),
      ).toContainText("Anaemia");
      await expect(
        page.locator('[aria-label="Risk factors"] .line-text:not(.other)'),
      ).not.toContainText(["Anaemia"]);
      await shot("06-anemia-comorbidity");
    },
  );
  expect(errors).toEqual([]);
} finally {
  fs.writeFileSync(
    `${root}/browser-results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
