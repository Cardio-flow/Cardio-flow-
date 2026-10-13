import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const out = process.argv[2] ?? "screenshots/cardiorenal-reconciliation";
fs.mkdirSync(out, { recursive: true });
const base = process.env.CARDIO_TEST_URL ?? "http://127.0.0.1:4311";
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(10000);
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
const create = async (label, conditions = []) =>
  (
    await api("/patients", {
      name: "Synthetic reconciliation " + label,
      mrn: "REC-" + label + "-" + Date.now(),
      sex: "Female",
      birthDate: "1956-01-01",
      sample: true,
      conditions,
    })
  ).id;
const meds = async (id) => {
  await page.goto(base + `/patients/${id}/medications`);
  await page
    .getByRole("heading", { name: "Medications", exact: true })
    .waitFor();
};
const state = async (id) => {
  const s = await api(`/patients/${id}/summary`);
  return { summary: s, meds: s.medications.groups.flatMap((g) => g.meds) };
};
const shot = async (name) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: out + "/" + name + ".png" });
};
const finishEntry = async () => {
  await page
    .getByRole("dialog", {
      name: /^(Record Metformin|Start Metformin|Add medicines)$/,
    })
    .waitFor({ state: "hidden" });
  const next = page.getByRole("button", {
    name: "Continue data entry",
    exact: true,
  });
  if (await next.isVisible()) await next.click();
};
const run = async (name, fn) => {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    await page.screenshot({ path: out + "/failure.png" });
    throw e;
  } finally {
    fs.writeFileSync(
      out + "/browser-results.json",
      JSON.stringify({ results, errors }, null, 2),
    );
  }
};
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  await run(
    "Single existing medicine has no invented start or new-treatment label",
    async () => {
      const id = await create("single");
      await meds(id);
      await page
        .getByRole("button", { name: "Add medication", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Search medications" })
        .fill("metformin");
      await page.getByRole("button", { name: /^Metformin Biguanide/ }).click();
      await page
        .getByRole("radio", { name: "Already taking", exact: true })
        .click();
      await expect(page.getByLabel("Start date", { exact: true })).toHaveCount(
        0,
      );
      await page
        .getByRole("radio", { name: "Other indication", exact: true })
        .click();
      await shot("01-single-existing");
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await finishEntry();
      const s = await state(id);
      expect(s.meds[0].startedAt).toBeNull();
      expect(s.meds[0].status).toBe("active");
      await expect(
        page.getByText("Already taking · recorded", { exact: true }),
      ).toBeVisible();
      await shot("02-history");
    },
  );
  await run(
    "Existing batch preserves unknown starts and hides initiation schedules",
    async () => {
      const id = await create("batch", ["hfpef"]);
      await api(`/patients/${id}/observations`, {
        effectiveAt: new Date().toISOString(),
        items: [
          { code: "creatinine", value: 110 },
          { code: "potassium", value: 4.3 },
        ],
      });
      await meds(id);
      await page
        .getByRole("button", { name: "Add several", exact: true })
        .click();
      await page
        .getByRole("radio", { name: "Already taking", exact: true })
        .click();
      const search = page
        .getByPlaceholder(/Search.*generic|Search.*trade|Search.*medicine/i)
        .first();
      await search.fill("spironolactone");
      await page
        .getByRole("button", { name: /Spironolactone/ })
        .first()
        .click();
      await search.fill("bisoprolol");
      await page
        .getByRole("button", { name: /Bisoprolol/ })
        .first()
        .click();
      await expect(
        page.getByText("Book its monitoring schedule", { exact: true }),
      ).toHaveCount(0);
      await shot("03-batch-existing");
      await page.getByRole("button", { name: "Record 2", exact: true }).click();
      await finishEntry();
      const s = await state(id);
      expect(s.meds).toHaveLength(2);
      expect(
        s.meds.every((m) => m.startedAt === null && m.status === "active"),
      ).toBe(true);
      expect(
        s.summary.attention.some(
          (r) => r.rule_id === "ops.monitoring-after-change",
        ),
      ).toBe(false);
    },
  );
  await run(
    "Switching back to new treatment retains start date and monitoring choices",
    async () => {
      const id = await create("new");
      await meds(id);
      await page
        .getByRole("button", { name: "Add medication", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Search medications" })
        .fill("metformin");
      await page.getByRole("button", { name: /^Metformin Biguanide/ }).click();
      await page
        .getByRole("radio", { name: "Already taking", exact: true })
        .click();
      await page.getByRole("radio", { name: "Start new", exact: true }).click();
      await expect(
        page.getByLabel("Start date", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Monitoring schedule", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("radio", { name: "Other indication", exact: true })
        .click();
      await page.getByRole("radio", { name: "Not now", exact: true }).click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await finishEntry();
      expect((await state(id)).meds[0].startedAt).not.toBeNull();
    },
  );
  await run(
    "Overview shows cardiorenal, stage and incomplete DOAC checks without a fabricated start alert",
    async () => {
      const id = await create("decisions", ["hfpef", "ckd-1-2", "af"]);
      const past = new Date(Date.now() - 60 * 86400000).toISOString();
      await api(`/patients/${id}/observations`, {
        effectiveAt: past,
        items: [{ code: "creatinine", value: 90 }],
      });
      await api(`/patients/${id}/observations`, {
        effectiveAt: new Date().toISOString(),
        items: [
          { code: "creatinine", value: 155 },
          { code: "potassium", value: 4.4 },
        ],
      });
      await api(`/patients/${id}/medications/batch`, {
        items: [
          {
            code: "spironolactone",
            doseValue: 25,
            frequency: "OD",
            route: "PO",
            indication: "hf",
            alreadyTaking: true,
          },
          {
            code: "apixaban",
            doseValue: 5,
            frequency: "BID",
            route: "PO",
            indication: "af",
            alreadyTaking: true,
          },
        ],
      });
      await page.goto(base + `/patients/${id}`);
      await expect(
        page.getByText(/Creatinine up .*cardiorenal review/).first(),
      ).toBeVisible();
      const s = await state(id);
      expect(
        s.summary.attention.some(
          (r) => r.rule_id === "cardiorenal.stage-review",
        ),
      ).toBe(true);
      expect(
        s.summary.attention.some((r) =>
          r.title.includes("dose check incomplete"),
        ),
      ).toBe(true);
      expect(
        s.summary.attention.some(
          (r) => r.rule_id === "ops.monitoring-after-change",
        ),
      ).toBe(false);
      await shot("04-overview");
    },
  );
  expect(errors).toEqual([]);
  console.log("All browser journeys passed");
} finally {
  await browser.close();
}
