// Own in-memory synthetic database, including legacy duplicates that public writes now refuse.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createLocalDb } from "../server/db/db.ts";
import { boot, SITE_ID } from "../server/boot.ts";
import { createApp } from "../server/app.ts";
import * as K from "../server/kernel/clinical.ts";
import { reassess } from "../server/engine/engine.ts";
import { uuid } from "../server/kernel/base.ts";
import { DIAGNOSIS } from "../shared/catalog.ts";
import { continueAfterEntry } from "./continue-after-entry.mjs";
const out = process.argv[2] || "/tmp/diagnosis-integrity-browser";
fs.mkdirSync(out, { recursive: true });
const db = await createLocalDb();
let server, browser, page;
try {
  await boot(db, { seed: false });
  const actor = {
    id: "synthetic-diagnosis@example.test",
    name: "Synthetic audit",
    role: "clinician",
    siteId: SITE_ID,
  };
  const id = await db.transaction((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic diagnosis reconciliation",
      mrn: "SYN-DIAG-UI",
      sex: "Male",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions: ["hfref"],
    }),
  );
  for (const code of ["hfpef", "prior-mi", "prior-mi"]) {
    const k = uuid();
    await db.query(
      `INSERT INTO cf.condition(id,logical_id,version,patient_id,code,display,status,onset,detail,recorded_by,attributes) VALUES($1,$1,1,$2,$3,$4,'active',$5,'',$6,$7)`,
      [
        k,
        id,
        code,
        DIAGNOSIS[code].display,
        code === "prior-mi" ? "2020-01-01" : null,
        actor.id,
        JSON.stringify(code === "prior-mi" ? { type: "STEMI" } : {}),
      ],
    );
  }
  await db.transaction((q) => reassess(q, id, "production"));
  const app = createApp(db);
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  );
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByText("Dr. Ahmed", { exact: true }).click();
  await page.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  await page.goto(`${base}/patients/${id}`);
  const line = page.locator('[aria-label="Diagnoses"]');
  await expect(line).toContainText("STEMI 2020");
  assert.equal(((await line.innerText()).match(/STEMI/g) || []).length, 1);
  await expect(
    page.getByText("Reconcile conflicting diagnoses", { exact: true }).first(),
  ).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `${out}/diagnosis-conflict-${width}.png` });
  }
  await page
    .getByRole("button", { name: "Edit diagnoses", exact: true })
    .click();
  const drawer = page.getByRole("dialog");
  assert.equal(await drawer.locator(".study-kind").count(), 4);
  await drawer.locator(".study-kind").filter({ hasText: "HFpEF" }).click();
  await page
    .getByRole("radio", { name: "Resolve or remove", exact: true })
    .click();
  await page.getByRole("radio", { name: /Entered in error/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await continueAfterEntry(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Reconcile conflicting diagnoses", { exact: true }),
  ).toHaveCount(0);
  await expect(line).not.toContainText("HFpEF");
  await page
    .getByRole("button", { name: "Edit diagnoses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add diagnosis", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "HFpEF · change existing", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const conflict = await page.evaluate(async (id) => {
    const s = await (await fetch("/api/session")).json();
    const r = await fetch(`/api/patients/${id}/conditions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": s.csrf },
      body: JSON.stringify({ codes: ["hfpef"] }),
    });
    return { status: r.status, body: await r.json() };
  }, id);
  assert.equal(conflict.status, 409);
  assert.match(JSON.stringify(conflict.body), /already active/);
  const raw = (
    await db.query(
      `SELECT count(DISTINCT logical_id)::int AS n FROM cf.condition WHERE patient_id=$1`,
      [id],
    )
  ).rows[0].n;
  assert.equal(raw, 4);
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/results.json`,
    JSON.stringify(
      {
        legacyDuplicateShownOnce: true,
        allSourceDiagnosesEditable: true,
        conflictCorrectedThroughUi: true,
        siblingPickerDisabled: true,
        apiConflictStatus: 409,
        phoneAndDesktopNoOverflow: true,
        sourceHistoryPreserved: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS diagnosis display, legacy conflict correction, guarded picker/API, preserved source history and phone/desktop layouts",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${out}/failure.png` });
    console.error(await page.getByRole("dialog").allTextContents());
  }
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
