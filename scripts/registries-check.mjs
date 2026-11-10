// Browser walkthrough of the Registries page (10 Nov 2026, phase 4): enrol all eligible sample patients, withdraw
// one, open statistics, codebook and export on desktop and phone; no page errors and no sideways overflow.
// Usage: node scripts/registries-check.mjs [outDir] (dev server running on a fresh in-memory database)
import { chromium } from "@playwright/test";
import fs from "node:fs";
const out = process.argv[2] || "/tmp/registries-check";
fs.mkdirSync(out, { recursive: true });
const base = process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  for (const [name, vp] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp });
    p.setDefaultTimeout(20000);
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    await p.goto(base);
    await p.getByText("Dr. Ahmed").click();
    await p.getByRole("heading", { name: "Worklist" }).waitFor();
    await p.getByRole("button", { name: "Sample patients", exact: true }).click();
    if (name === "phone") await p.locator("summary", { hasText: "More" }).click();
    await p.getByRole("link", { name: /Registries/ }).filter({ visible: true }).first().click();
    await p.getByRole("heading", { name: "Registries" }).waitFor();
    for (const reg of ["CAD Registry", "EP Registry", "Heart Failure Registry"]) {
      await p.getByRole("radio", { name: reg }).click();
      await p.getByText(new RegExp(`^${reg} · filled`)).waitFor();
      await p.getByRole("radio", { name: "Patients" }).click();
      const all = p.getByRole("button", { name: /^Enrol (all \d+ eligible not enrolled|the eligible patient)$/ });
      if (name === "desktop") {
        await all.click();
        await p.getByRole("radio", { name: /^Enrolled · [1-9]/ }).waitFor();
        if (await all.count()) throw Error(`${reg}: enrol-all button still shown after enrolling`);
      }
      for (const v of ["Statistics", "Codebook", "Export"]) {
        await p.getByRole("radio", { name: v }).click();
        if (v === "Statistics") await p.getByRole("heading", { name: "Outcomes" }).waitFor();
        if (v === "Codebook") await p.getByRole("textbox", { name: "Find a variable" }).waitFor();
        if (v === "Export") await p.getByRole("button", { name: /SPSS syntax/ }).waitFor();
        const [sw, w] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        if (sw > w + 1) throw Error(`${name} ${reg} ${v}: page ${sw}px wider than the ${w}px screen`);
      }
      await p.screenshot({ path: `${out}/${name}-${reg.split(" ")[0].toLowerCase()}-export.png`, fullPage: true });
    }
    if (name === "desktop") {
      // the SPSS syntax downloads as a file
      const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /SPSS syntax/ }).click()]);
      if (!/\.sps$/.test(dl.suggestedFilename())) throw Error(`SPSS syntax file name ${dl.suggestedFilename()}`);
      // withdraw one patient with a reason
      await p.getByRole("radio", { name: "Patients" }).click();
      await p.getByRole("button", { name: "Withdraw", exact: true }).first().click();
      await p.getByRole("button", { name: "Consent withdrawn", exact: true }).click();
      await p.locator(".reg-withdraw").getByRole("button", { name: "Withdraw", exact: true }).click();
      await p.getByText(/^Withdrawn .* · Consent withdrawn$/).first().waitFor();
      await p.screenshot({ path: `${out}/desktop-hf-patients.png`, fullPage: true });
      await p.getByRole("radio", { name: "Statistics" }).click();
      await p.screenshot({ path: `${out}/desktop-hf-statistics.png`, fullPage: true });
    }
    await p.close();
  }
  if (errors.length) throw Error(errors.join("\n"));
  console.log("PASS registries: enrol all, withdraw with reason, statistics, codebook, export (.sps) on desktop and phone");
} finally {
  await b.close();
}
