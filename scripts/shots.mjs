// Screenshot walkthrough of the HF slice (local sandbox). Usage: node scripts/shots.mjs [outDir]
import { chromium } from "@playwright/test";
const out = process.argv[2] || "/tmp/shots";
const base = "http://127.0.0.1:4310";
import { existsSync } from "node:fs";
const exe = process.env.CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && !m.text().includes("401") && errors.push(m.text()));
const shot = async (name, full = false) => (await p.waitForTimeout(450), p.screenshot({ path: `${out}/${name}.png`, fullPage: full }));
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    errors.push(`${name}: ${e.message.split("\n")[0]}`);
    await p.screenshot({ path: `${out}/FAIL-${name}.png` });
    throw e;
  }
};
await step("login", async () => {
  await p.goto(base);
  await p.getByText("Dr. Ahmed").click();
  await p.getByRole("heading", { name: "Worklist" }).waitFor();
  await shot("01-worklist", true);
});
await step("summary", async () => {
  await p.getByText("Khaled Al-Mansour").first().click();
  await p.getByRole("heading", { name: "Needs attention" }).waitFor();
  await shot("02-summary", true);
});
await step("wizard", async () => {
  await p.getByRole("button", { name: "Manage hyperkalaemia" }).click();
  await p.getByText("Is this result reliable?").waitFor();
  await shot("04-wizard1");
  await p.getByRole("radio", { name: "Yes, act on it" }).click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await p.getByRole("radiogroup", { name: "ECG changes of hyperkalaemia?" }).getByRole("radio", { name: "None" }).click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await shot("05-wizard-contributors");
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await p.getByRole("button", { name: "Reduce MRA dose" }).click();
  await p.getByRole("radio", { name: "12.5 mg" }).click();
  await shot("06-wizard-management");
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await p.getByRole("radio", { name: "In 3 days" }).click();
  await p.getByRole("radio", { name: "Clinic · 1 week" }).click();
  await p.getByRole("button", { name: /^Continue( to|$)/ }).click();
  await shot("07-wizard-confirm");
  await p.getByRole("button", { name: "Confirm plan" }).click();
  await p.getByText("Hyperkalaemia review recorded").waitFor();
  await shot("08-after-wizard", true);
});
await step("labs", async () => {
  await p.getByRole("button", { name: "Add labs" }).first().click();
  await p.getByLabel("Creatinine", { exact: true }).fill("171");
  await p.getByLabel("Urea", { exact: true }).fill("10.1");
  await p.getByLabel("Sodium", { exact: true }).fill("137");
  await p.getByLabel("Potassium", { exact: true }).fill("5.2");
  await shot("09-quicklabs");
  await p.getByLabel("Potassium", { exact: true }).press("Enter");
  await p.getByText(/results? saved/).waitFor();
  await shot("10-after-labs", true);
});
await step("tabs", async () => {
  await p.getByRole("link", { name: "Journey" }).click();
  await p.getByRole("heading", { name: "Journey" }).waitFor();
  await shot("11-journey", true);
  await p.getByRole("link", { name: "Medications" }).click();
  await shot("12-medications", true);
  await p.getByRole("link", { name: "Investigations" }).click();
  await shot("13-investigations", true);
  await p.getByRole("link", { name: "Plan & follow-up" }).click();
  await shot("14-plan", true);
});
await step("visit", async () => {
  await p.getByRole("link", { name: /^Summary/ }).click();
  await p.getByRole("button", { name: "Start clinic visit" }).click();
  await shot("15-visit-start");
  await p.getByRole("button", { name: "Start visit" }).click();
  await p.getByText("Vital signs today").waitFor();
  await p.getByLabel("Systolic BP").fill("108");
  await p.getByLabel("Heart rate").fill("66");
  await p.getByLabel("Weight").fill("78.4");
  await p.getByRole("radiogroup", { name: "NYHA class" }).getByRole("radio", { name: "II", exact: true }).click();
  await p.getByRole("radiogroup", { name: "Congestion" }).getByRole("radio", { name: "None" }).click();
  await shot("16-visit-assessment");
  await p.getByRole("button", { name: "Save and continue" }).click();
  await p.getByText("Needs a decision").waitFor();
  await shot("17-visit-decisions");
  await p.getByRole("button", { name: "Continue to note" }).click();
  await p.waitForTimeout(800);
  await shot("18-visit-note");
  await p.getByRole("button", { name: "Finish visit" }).click();
  await p.getByText("Visit closed").waitFor();
});
await step("meds", async () => {
  await p.getByRole("link", { name: "Medications" }).click();
  await p.getByRole("button", { name: "Change" }).first().click();
  await shot("19-med-action");
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "Add medication" }).click();
  await shot("20-add-med");
  await p.getByRole("button", { name: /Ivabradine/ }).first().click();
  await shot("21-add-med-detail");
  await p.keyboard.press("Escape");
});
await step("governance", async () => {
  await p.getByRole("link", { name: "Rule governance" }).click();
  await p.getByRole("heading", { name: "Rule governance" }).waitFor();
  await shot("22-governance", true);
});
await step("responsive", async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(base + "/");
  await p.getByRole("heading", { name: "Worklist" }).waitFor();
  await shot("23-mobile-worklist", true);
  await p.setViewportSize({ width: 1180, height: 820 });
  await p.goto(base + "/");
  await p.getByText("Yousef Ibrahim").first().click();
  await p.getByRole("heading", { name: "Needs attention" }).waitFor();
  await shot("24-ipad-yousef", true);
});
console.log("errors", JSON.stringify(errors));
await b.close();
if (errors.length) process.exit(1);
