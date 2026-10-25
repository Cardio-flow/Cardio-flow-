import { continueAfterEntry } from "./continue-after-entry.mjs";
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.CARDIO_BASE_URL ?? "http://127.0.0.1:4310",
  out = process.argv[2] ?? "/tmp/cardio-aorta";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(),
  p = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.setDefaultTimeout(15000);
const api = (path, body) =>
  p.evaluate(
    async ({ path, body }) => {
      const s = await (await fetch("/api/session")).json(),
        r = await fetch(
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
  await p.screenshot({ path: out + "/" + name + ".png" });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
};
try {
  await p.goto(base);
  await p.getByText("Dr. Ahmed", { exact: true }).click();
  await p.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  const id = (
    await api("/patients", {
      name: "Synthetic aortic phone",
      mrn: "AORTA-UI-" + Date.now(),
      sex: "Female",
      birthDate: "1962-01-01",
      conditions: ["bav"],
      sample: true,
    })
  ).id;
  await api(`/patients/${id}/echo`, {
    date: new Date().toISOString(),
    quality: "formal",
    lvef: 55,
    findings: [],
    valves: { as: "None", ar: "None" },
  });
  await p.goto(base + "/patients/" + id + "/investigations");
  await p
    .getByRole("heading", { name: "Investigations", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Add study", exact: true }).click();
  await p.getByRole("button", { name: /Thoracic aorta imaging/ }).click();
  const dialog = p.getByRole("dialog");
  for (const value of [
    "Baseline assessment",
    "CT",
    "Bicuspid",
    "Entire thoracic aorta",
    "Root phenotype",
    "Excluded",
    "Thoracic aortic dilatation",
  ])
    await dialog.getByRole("radio", { name: value, exact: true }).click();
  for (const [label, value] of [
    ["Sinus of Valsalva diameter", "48"],
    ["Sinotubular junction diameter", "35"],
    ["Maximum ascending aorta diameter", "44"],
  ])
    await dialog.getByRole("textbox", { name: label, exact: true }).fill(value);
  await shot("01-aortic-entry-phone");
  await dialog
    .getByRole("button", { name: "Save Aortic imaging", exact: true })
    .click();
  await continueAfterEntry(p);
  await expect(dialog).toHaveCount(0);
  await p.goto(base + "/patients/" + id);
  await p.getByRole("heading", { name: "Today", exact: true }).waitFor();
  const card = p.locator('.problem[aria-label="Thoracic aorta"]');
  await expect(card).toContainText("assessment and surveillance");
  await card.getByRole("button", { name: "Review plan", exact: true }).click();
  const panel = p.locator(
    '[aria-label="Decision: Thoracic aorta: assessment and surveillance"]',
  );
  await panel.waitFor();
  await panel.getByRole("button", { name: "Edit answers", exact: true }).click();
  const radio = async (group, label) =>
    panel
      .getByRole("radiogroup", { name: "Decision: " + group, exact: true })
      .getByRole("radio", { name: label, exact: true })
      .click();
  await radio(
    "Current aortic safety assessment",
    "No acute aortic warning features after assessment",
  );
  await panel
    .getByRole("checkbox", {
      name: "Decision: None identified after review",
      exact: true,
    })
    .check();
  await radio("Aortic imaging to arrange", "Thoracic aortic CT");
  await radio(
    "Blood pressure and lifestyle review",
    "BP plan, exercise / lifting advice and smoking reviewed",
  );
  const day = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  await panel
    .getByRole("textbox", {
      name: "Decision: Assessment / imaging date",
      exact: true,
    })
    .fill(day.split("-").reverse().join("/"));
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await shot("02-aortic-decision-phone");
  await panel.getByRole("button", { name: "Apply plan", exact: true }).click();
  await expect(panel).toHaveCount(0);
  let s = await api(`/patients/${id}/summary`);
  expect(s.attention.some((a) => a.rule_id === "aorta.assessment")).toBe(false);
  expect(s.plan.some((a) => /CT surveillance/.test(a.title))).toBe(true);
  expect(s.plan.some((a) => /first-degree relative/.test(a.title))).toBe(true);
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.getByRole("button", { name: "Pathways", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Search pathways", exact: true })
    .fill("Thoracic aorta");
  await expect(p.getByRole("dialog")).toContainText("Aortic disease");
  await shot("03-aortic-pathway-desktop");
  await p.getByRole("button", { name: "Close", exact: true }).click();
  await api(`/patients/${id}/studies`, {
    kind: "aortic_imaging",
    date: new Date().toISOString(),
    findings: {
      purpose: "Acute assessment",
      modality: "CT",
      aorticMorphology: "Bicuspid",
      extent: "Entire thoracic aorta",
      sinusDiameter: 52,
      stjDiameter: 36,
      ascendingDiameter: 44,
      aorticPhenotype: "Root phenotype",
      coarctation: "Excluded",
      interpretation: "Suspected acute aortic syndrome",
    },
  });
  await p.goto(base + "/patients/" + id);
  await p.getByRole("heading", { name: "Today", exact: true }).waitFor();
  await expect(p.locator(".urgent-strip")).toContainText("urgent assessment");
  await shot("04-acute-aorta-desktop");
  await p.setViewportSize({ width: 390, height: 844 });
  await card.getByRole("button", { name: "Review plan", exact: true }).click();
  await panel.waitFor();
  const today = (await api("/health")).today;
  await panel
    .getByRole("textbox", {
      name: "Decision: Assessment / imaging date",
      exact: true,
    })
    .fill(today.split("-").reverse().join("/"));
  await expect(
    panel.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("radiogroup", {
      name: "Decision: Family / genetics plan",
      exact: true,
    }),
  ).toHaveCount(0);
  await shot("05-urgent-aortic-decision-phone");
  expect(errors).toEqual([]);
  console.log(
    "PASS phone aortic entry, automatic decision/family plan, dated surveillance, searchable desktop pathway and acute-risk reassessment",
  );
} finally {
  fs.writeFileSync(out + "/errors.json", JSON.stringify(errors));
  await browser.close();
}
