import { selectLabGroup } from "./select-lab-group.mjs";
import fs from "node:fs";
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
import { chromium, expect } from "@playwright/test";

const out = process.argv[2] ?? "screenshots/labs-hypertension";
fs.mkdirSync(out, { recursive: true });
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
      const response = await fetch(
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
      const data = await response.json();
      if (!response.ok) throw Error(path + ": " + JSON.stringify(data));
      return data;
    },
    { path, body },
  );
let seq = 0;
const create = (label, status) =>
  api("/patients", {
    name: "Synthetic labs BP " + label,
    mrn: "LABS-BP-" + Date.now() + "-" + ++seq,
    sex: "Male",
    birthDate: "1960-01-01",
    sample: true,
    conditions: status ? ["htn"] : [],
    ...(status ? { hypertensionStatus: status } : {}),
  });
const go = (id, tab = "") =>
  page.goto(`${base}/patients/${id}${tab ? "/" + tab : ""}`);
const bp = (id, sbp = 148, dbp = 88) =>
  api(`/patients/${id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items: [
      { code: "sbp", value: sbp },
      { code: "dbp", value: dbp },
      { code: "creatinine", value: 90 },
      { code: "potassium", value: 4.2 },
    ],
  });
const alerts = async (id) =>
  (await api(`/patients/${id}/summary`)).attention
    .flatMap((r) => [r, ...(r.also ?? [])])
    .filter((r) => r.rule_id.startsWith("htn."));
const ids = async (id) => (await alerts(id)).map((r) => r.rule_id).sort();
const shot = (name) =>
  page.screenshot({ path: `${out}/${name}.png`, animations: "disabled" });
const overflow = async () =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
const openLabs = async (id, panel) => {
  await go(id, "investigations");
  await page
    .getByRole("button", { name: "Add labs", exact: true })
    .first()
    .click();
  await selectLabGroup(page, { tft: "TFT", "bone-profile": "Bone profile", renal: "Renal profile" }[panel]);
};
const saveLabs = async (n) => {
  await page
    .getByRole("button", { name: `Save ${n} results`, exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
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
      `${out}/browser-results.json`,
      JSON.stringify({ results, errors }, null, 2),
    );
  }
};
try {
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const labPatient = await create("lab profiles");
  await run("TFT records TSH, FT4 and FT3 with their units", async () => {
    await openLabs(labPatient.id, "tft");
    await page.getByLabel("TSH", { exact: true }).fill("1.3");
    await page.getByLabel("Free T4 (FT4)", { exact: true }).fill("14");
    await page.getByLabel("Free T3 (FT3)", { exact: true }).fill("4.5");
    await overflow();
    await shot("01-tft-entry");
    await saveLabs(3);
    const record = await api(`/patients/${labPatient.id}/record`);
    for (const [code, value, unit] of [
      ["tsh", 1.3, "mIU/L"],
      ["ft4", 14, "pmol/L"],
      ["ft3", 4.5, "pmol/L"],
    ]) {
      const result = record.results.find((r) => r.code === code);
      expect(result.current.value).toBe(value);
      expect(result.unit).toBe(unit);
    }
  });
  await run(
    "Bone profile records reported calcium, albumin, phosphorus and ALP",
    async () => {
      await openLabs(labPatient.id, "bone-profile");
      for (const [label, value] of [
        ["Total calcium", "2.3"],
        ["Adjusted calcium", "2.35"],
        ["Albumin", "40"],
        ["Phosphate (phosphorus)", "1.1"],
        ["Alkaline phosphatase", "85"],
      ]) {
        await page.getByLabel(label, { exact: true }).fill(value);
      }
      await overflow();
      await shot("02-bone-profile-entry");
      await saveLabs(5);
      const record = await api(`/patients/${labPatient.id}/record`);
      expect(
        record.results.find((r) => r.code === "phosphate").current.value,
      ).toBe(1.1);
      expect(
        record.results.find((r) => r.code === "albumin").current.value,
      ).toBe(40);
    },
  );
  await run(
    "Uric acid and phosphorus are searchable without duplicate analytes",
    async () => {
      await openLabs(labPatient.id, "renal");
      await page
        .getByRole("button", { name: "+ Any test", exact: true })
        .click();
      await page.getByLabel("Search tests", { exact: true }).fill("uric acid");
      await page.getByRole("button", { name: /Urate \(uric acid\)/ }).click();
      await page.getByLabel("Urate (uric acid)", { exact: true }).fill("320");
      await page
        .getByRole("button", { name: "+ Any test", exact: true })
        .click();
      await page.getByLabel("Search tests", { exact: true }).fill("phosphorus");
      await expect(
        page.getByRole("button", { name: /Phosphate \(phosphorus\)/ }),
      ).toHaveCount(1);
      await page
        .getByRole("button", { name: /Phosphate \(phosphorus\)/ })
        .click();
      await page
        .getByLabel("Phosphate (phosphorus)", { exact: true })
        .fill("1.2");
      await page
        .getByRole("button", { name: "Save 2 results", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const record = await api(`/patients/${labPatient.id}/record`);
      expect(record.results.find((r) => r.code === "urate").current.value).toBe(
        320,
      );
      expect(
        record.results.find((r) => r.code === "phosphate").series.length,
      ).toBe(2);
      await overflow();
      await shot("03-new-lab-results");
    },
  );
  await run(
    "Established hypertension activates only the BP target",
    async () => {
      const x = await create("established", "Established");
      await bp(x.id);
      await go(x.id);
      expect(await ids(x.id)).toEqual(["htn.bp-target"]);
      await expect(
        page.getByText(/BP 148\/88 above target 120–129\/70–79/).first(),
      ).toBeVisible();
      await overflow();
      await shot("04-established-bp-target");
    },
  );
  await run(
    "New hypertension activates assessment and screening; the compact status editor resolves them",
    async () => {
      const x = await create("new diagnosis", "Newly diagnosed");
      await bp(x.id);
      await go(x.id);
      expect(await ids(x.id)).toEqual(["htn.management", "htn.secondary"]);
      await page
        .getByRole("button", { name: "Edit risk factors", exact: true })
        .click();
      const status = page.getByRole("radiogroup", {
        name: "Hypertension status",
        exact: true,
      });
      await expect(status).toBeVisible();
      await overflow();
      await shot("05-hypertension-status");
      await status
        .getByRole("radio", { name: "Established", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save history", exact: true })
        .click();
      const continueButton = page.getByRole("button", {
        name: "Continue data entry",
        exact: true,
      });
      await Promise.race([
        continueButton.waitFor(),
        page.getByRole("dialog").waitFor({ state: "hidden" }),
      ]);
      if (await continueButton.isVisible()) await continueButton.click();
      expect(await ids(x.id)).toEqual(["htn.bp-target"]);
      await go(x.id);
      await shot("06-status-changed-to-established");
    },
  );
  await run(
    "Resistance on three treatment classes activates screening; validated white-coat BP quiets it",
    async () => {
      const x = await create("resistant", "Established");
      const date = new Date(Date.now() - 86400000).toISOString();
      for (const [code, doseValue] of [
        ["amlodipine-valsartan", 10],
        ["indapamide", 1.5],
      ]) {
        await api(`/patients/${x.id}/medications`, {
          code,
          doseValue,
          frequency: "OD",
          route: "PO",
          indication: "htn",
          effectiveAt: date,
        });
      }
      await bp(x.id, 155, 95);
      await go(x.id);
      expect(await ids(x.id)).toEqual(["htn.resistance", "htn.secondary"]);
      await shot("07-resistance-and-screening");
      await api(`/patients/${x.id}/studies`, {
        kind: "abpm",
        date: new Date().toISOString(),
        findings: {
          duration: "24 h",
          onTreatment: "On treatment",
          sbp24: 120,
          dbp24: 70,
          valid: 80,
          conclusion: "White-coat hypertension",
        },
      });
      await go(x.id);
      expect(await ids(x.id)).toEqual(["htn.bp-target"]);
      await expect(
        page
          .getByText("Office BP above target: review white-coat effect", {
            exact: true,
          })
          .first(),
      ).toBeHidden();
      // lower-priority items sit in the overview's folds (Consult, 25 Oct 2026)
      await page.locator("details.cx-fold").evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
      await expect(
        page
          .getByText("Office BP above target: review white-coat effect", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await shot("08-white-coat-target-review");
    },
  );
  await run(
    "Registration records new hypertension status explicitly and atomically",
    async () => {
      await page.goto(base + "/patients");
      await page
        .getByRole("button", { name: "New patient", exact: true })
        .click();
      const name = "Synthetic new BP registration " + Date.now();
      await page.getByLabel("Full name", { exact: true }).fill(name);
      await page
        .getByLabel("File number (MRN)", { exact: true })
        .fill("LABS-BP-REGISTER-" + Date.now());
      await page.getByRole("radio", { name: "Male", exact: true }).click();
      await page
        .getByLabel("Date (day/month/year)", { exact: true })
        .fill("01/01/1960");
      await page.getByText("Risk factors · optional", { exact: true }).click();
      await page
        .getByRole("button", { name: "Hypertension", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Create patient", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("radiogroup", { name: "Hypertension status", exact: true })
        .getByRole("radio", { name: "Newly diagnosed", exact: true })
        .click();
      await page
        .getByRole("checkbox", { name: /Sample patient for practice/ })
        .check();
      await overflow();
      await shot("09-new-registration-status");
      await page
        .getByRole("button", { name: "Create sample patient", exact: true })
        .click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      const id = page.url().split("/patients/")[1].split("/")[0];
      expect(await ids(id)).toEqual(["htn.management", "htn.secondary"]);
    },
  );
  await run(
    "Routine targets cover isolated diastolic BP and display individualized goals",
    async () => {
      const x = await create("diastolic goal", "Established");
      await bp(x.id, 125, 95);
      await go(x.id);
      expect(await ids(x.id)).toEqual(["htn.bp-target"]);
      await expect(
        page
          .getByText("BP 125/95 above target 120–129/70–79", { exact: true })
          .first(),
      ).toBeVisible();
            await expect(
        page.getByRole("region", { name: "Blood pressure" }).getByText(/Goal 120–129\/70–79 if tolerated/),
      ).toBeVisible();
      expect((await api(`/patients/${x.id}/summary`)).targets.bp.met).toBe(
        false,
      );
      await page.getByRole("region", { name: "Blood pressure" })
        .getByText(/Goal 120–129\/70–79 if tolerated/)
        .scrollIntoViewIfNeeded();
      await overflow();
      await shot("10-diastolic-bp-target");
      const elderly = await api("/patients", {
        name: "Synthetic individualized BP goal",
        mrn: "LABS-BP-ELDERLY-" + Date.now(),
        sex: "Male",
        birthDate: "1935-01-01",
        sample: true,
        conditions: ["htn"],
        hypertensionStatus: "Established",
      });
      await bp(elderly.id);
      await go(elderly.id);
      expect(await ids(elderly.id)).toEqual(["htn.bp-target"]);
            await expect(page.getByRole("region", { name: "Blood pressure" }).getByText(/Individualized target/)).toBeVisible();
      expect(
        (await api(`/patients/${elderly.id}/summary`)).targets.bp.met,
      ).toBeNull();
      await page.getByRole("region", { name: "Blood pressure" }).getByText(/Individualized target/).scrollIntoViewIfNeeded();
      await overflow();
      await shot("11-individualized-bp-target");
    },
  );
  expect(errors).toEqual([]);
} finally {
  fs.writeFileSync(
    `${out}/browser-results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
