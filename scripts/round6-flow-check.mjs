import {openAdmissionDetails} from "./patient-navigation.mjs";
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const root = process.argv[2] ?? "screenshots/round6-flow",
  out = root + "/screens";
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(process.env.CHROMIUM ? {executablePath:process.env.CHROMIUM} : {}),
  p = await b.newPage({ viewport: { width: 390, height: 1100 } });
p.setDefaultTimeout(8000);
const results = [],
  dialogs = [];
let seq = 0,
  shotNum = 0;
p.on("dialog", async (d) => {
  dialogs.push({ type: d.type(), message: d.message() });
  await d.accept();
});
const api = async (path, body) =>
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
      return { status: r.status, body: await r.json() };
    },
    { path, body },
  );
const good = async (...args) => {
  const r = await api(...args);
  if (r.status < 200 || r.status >= 300)
    throw Error(args[0] + ": " + JSON.stringify(r));
  return r.body;
};
const create = async (label, conditions = []) => {
  const name = "Synthetic R6 " + label;
  return {
    ...(await good("/patients", {
      name,
      mrn: "R6-" + Date.now() + "-" + ++seq,
      sex: "Male",
      birthDate: "1960-01-01",
      sample: true,
      conditions,
    })),
    name,
  };
};
const visit = (x, narrative) =>
  good(`/patients/${x.id}/visits`, {
    service: "Clinic",
    reasons: ["Routine cardiology"],
    ...(narrative ? { narrative } : {}),
  });
const labs = (x, items) =>
  good(`/patients/${x.id}/observations`, {
    effectiveAt: new Date().toISOString(),
    items,
  });
const go = async (x, tab = "") => {
  await p.goto("http://127.0.0.1:4310/patients/" + x.id + tab);
  await p.getByRole("heading", { name: x.name, exact: true }).waitFor();
};
const shot = async (name) => {
  const file = String(++shotNum).padStart(2, "0") + "-" + name + ".png";
  await p.screenshot({ path: out + "/" + file, animations: "disabled" });
  return file;
};
const openVisit = async (x) => {
  await go(x);
  await p
    .getByRole("button", { name: "Continue visit", exact: true })
    .first()
    .click();
  await expect(
    p.getByRole("button", { name: "Save and continue", exact: true }),
  ).toBeEnabled();
};
const close = () =>
  p.getByRole("button", { name: "Close", exact: true }).click();
const note = async (x) => {
  await openVisit(x);
  await p
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Continue to note", exact: true })
    .click();
  await expect(p.getByLabel("Clinic note", { exact: true })).toBeEnabled();
};
const run = async (name, fn) => {
  if (process.env.AUDIT_FILTER && !name.includes(process.env.AUDIT_FILTER))
    return;
  try {
    const r = await fn();
    results.push({ name, ...r });
    console.log(r.defect ? "DEFECT" : "PASS", name);
  } catch (e) {
    const screen = await shot("harness-error").catch(() => null);
    results.push({
      name,
      harnessError: e.message,
      screens: screen ? [screen] : [],
    });
    console.log("HARNESS ERROR", name, e.message.slice(0, 220));
  } finally {
    await p.unrouteAll({ behavior: "ignoreErrors" });
    fs.writeFileSync(
      root + "/browser-results.json",
      JSON.stringify(
        { sourceBranch: "fix/round4-simulation-defects", results, dialogs },
        null,
        2,
      ),
    );
  }
};
const waitPost = (suffix, predicate = () => true) => {
  const task = p.waitForResponse(
    (r) =>
      r.url().endsWith(suffix) &&
      r.request().method() === "POST" &&
      predicate(r),
  );
  task.catch(() => {});
  return task;
};
const radio = (group, name) =>
  p
    .getByRole("radiogroup", { name: group, exact: true })
    .getByRole("radio", { name, exact: true })
    .click();
try {
  await p.goto("http://127.0.0.1:4310");
  await p.getByText("Dr. Ahmed", { exact: true }).click();
  await p.getByRole("heading", { name: "Worklist", exact: true }).waitFor();
  for (const changed of ["sbp", "dbp"])
    await run(
      "Changing only " + changed + " retains the complete office BP pair",
      async () => {
        const x = await create("BP pair " + changed, ["htn"]);
        const v = await visit(x);
        await labs(x, [
          { code: "sbp", value: 148 },
          { code: "dbp", value: 88 },
        ]);
        await openVisit(x);
        const before = await shot("paired-bp-before-" + changed);
        await p
          .getByRole("textbox", {
            name: changed === "sbp" ? /^Systolic BP/ : /^Diastolic BP/,
          })
          .fill(changed === "sbp" ? "158" : "98");
        await expect(
          p.getByRole("button", { name: "Save and continue", exact: true }),
        ).toBeDisabled();
        const pairReview=await shot("new-bp-pair-review-"+changed);
        await p
          .getByRole("checkbox", {
            name: "Both BP values checked",
            exact: true,
          })
          .check();
        await p
          .getByRole("button", { name: "Save and continue", exact: true })
          .click();
        await p.getByText("Needs a decision", { exact: true }).waitFor();
        await close();
        const w = await good(`/patients/${x.id}/wizards/htn-resistance`),
          r = await good(`/patients/${x.id}/record`);
        await p.getByRole("button", { name: "Pathways", exact: true }).click();
        await p
          .getByRole("button")
          .filter({ hasText: "Resistant hypertension: verify and optimize" })
          .click();
        await p
          .getByRole("heading", { name: "Resistant hypertension", exact: true })
          .waitFor();
        const after = await shot("hypertension-after-" + changed);
        return {
          defect:
            !w.context.hypertension.office ||
            w.context.hypertension.office.sbp !==
              (changed === "sbp" ? 158 : 148) ||
            w.context.hypertension.office.dbp !== (changed === "dbp" ? 98 : 88),
          priority: "high",
          patientId: x.id,
          contextId: v.id,
          evidence: {
            office: w.context.hypertension.office,
            todayValues: r.todayValues,
          },
          screens: [before, pairReview, after],
        };
      },
    );
  await run("Unchanged confirmed BP is not duplicated control", async () => {
    const x = await create("unchanged BP", ["htn"]);
    await visit(x);
    await labs(x, [
      { code: "sbp", value: 148 },
      { code: "dbp", value: 88 },
    ]);
    const old = await good(`/patients/${x.id}/record`);
    await openVisit(x);
    await p
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await p.getByText("Needs a decision", { exact: true }).waitFor();
    await close();
    const w = await good(`/patients/${x.id}/wizards/htn-resistance`),
      r = await good(`/patients/${x.id}/record`);
    return {
      defect:
        !w.context.hypertension.office ||
        r.todayValues.sbp.at !== old.todayValues.sbp.at,
      patientId: x.id,
      evidence: { office: w.context.hypertension.office },
      screens: [await shot("unchanged-bp-control")],
    };
  });
  await run(
    "An admission opened elsewhere produces an actionable error",
    async () => {
      const x = await create("admission opened elsewhere");
      await go(x);
      await p.getByRole("button", { name: "Admit", exact: true }).click();await openAdmissionDetails(p);
      await expect(
        p.getByLabel("Admission narrative", { exact: true }),
      ).toBeEnabled();
      await p
        .getByRole("button", {
          name: "Chest pain (ACS to exclude)",
          exact: true,
        })
        .click();
      const saved = waitPost(
        "/entry-draft/admission-entry",
        (r) =>
          r.status() === 200 &&
          r.request().postDataJSON()?.answers?.narrative ===
            "Synthetic pending admission",
      );
      await p
        .getByLabel("Admission narrative", { exact: true })
        .fill("Synthetic pending admission");
      await saved;
      await expect(
        p.getByRole("status").filter({ hasText: "Draft saved" }),
      ).toBeVisible();
      await good(`/patients/${x.id}/admissions`, {
        startedAt: new Date().toISOString(),
        location: "CCU",
        reasons: ["Chest pain"],
        draftVersion: (
          await good(`/patients/${x.id}/entry-draft/admission-entry`)
        ).version,
      });
      const failed = waitPost("/admissions");
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Admit", exact: true })
        .click();
      const response = await failed;
      await expect(
        p
          .getByRole("dialog")
          .getByRole("button", { name: "Admit", exact: true }),
      ).toBeDisabled();
      const text = await p.getByRole("dialog").innerText(),
        alerts = await p
          .getByRole("dialog")
          .getByRole("alert")
          .allTextContents();
      return {
        defect:
          response.status() !== 409 ||
          !text.includes("already has an open admission") ||
          (await p
            .getByRole("button", {
              name: "View existing admission",
              exact: true,
            })
            .count()) !== 1,
        priority: "medium",
        patientId: x.id,
        evidence: {
          status: response.status(),
          response: await response.json(),
          alerts,
        },
        screens: [await shot("admission-409-hidden")],
      };
    },
  );
  await run(
    "Admission confirmation rejects a draft changed after its flush",
    async () => {
      const x = await create("admission confirmation race");
      await go(x);
      await p.getByRole("button", { name: "Admit", exact: true }).click();await openAdmissionDetails(p);
      await expect(
        p.getByLabel("Admission narrative", { exact: true }),
      ).toBeEnabled();
      await p
        .getByRole("button", {
          name: "Chest pain (ACS to exclude)",
          exact: true,
        })
        .click();
      const saved = waitPost(
        "/entry-draft/admission-entry",
        (r) =>
          r.status() === 200 &&
          r.request().postDataJSON()?.answers?.narrative ===
            "Synthetic old admission history",
      );
      await p
        .getByLabel("Admission narrative", { exact: true })
        .fill("Synthetic old admission history");
      await saved;
      let release, seen;
      const gate = new Promise((r) => (release = r)),
        started = new Promise((r) => (seen = r));
      let posted;
      await p.route(`**/api/patients/${x.id}/admissions`, async (route) => {
        if (route.request().method() === "POST") {
          posted = route.request().postDataJSON();
          seen();
          await gate;
        }
        await route.continue();
      });
      const finish = waitPost("/admissions");
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Admit", exact: true })
        .click();
      await started;
      const d = await good(`/patients/${x.id}/entry-draft/admission-entry`);
      const changed = await good(
        `/patients/${x.id}/entry-draft/admission-entry`,
        {
          version: d.version,
          answers: {
            ...d.answers,
            narrative: "Synthetic newer clinician admission history",
          },
        },
      );
      let releaseMetadata, metadataSeen;
      const metadataGate = new Promise((r) => (releaseMetadata = r)),
        metadataStarted = new Promise((r) => (metadataSeen = r));
      let heldMetadata = false;
      await p.route(
        `**/api/patients/${x.id}/entry-draft/admission-entry`,
        async (route) => {
          if (route.request().method() === "GET" && !heldMetadata) {
            heldMetadata = true;
            const response = await route.fetch();
            metadataSeen();
            await metadataGate;
            await route.fulfill({ response });
          } else await route.continue();
        },
      );
      release();
      const response = await finish;
      await p.unroute(`**/api/patients/${x.id}/admissions`);
      expect(response.status()).toBe(409);
      expect((await good(`/patients/${x.id}/journey`)).contexts.length).toBe(0);
      await p
        .getByRole("button", { name: "Use saved draft", exact: true })
        .waitFor();
      await metadataStarted;
      await expect(
        p.getByRole("button", { name: "Use saved draft", exact: true }),
      ).toBeEnabled();
      const before = await shot("admission-race-requires-draft-review");
      await p
        .getByRole("button", { name: "Use saved draft", exact: true })
        .click();
      await expect(
        p.getByLabel("Admission narrative", { exact: true }),
      ).toHaveValue("Synthetic newer clinician admission history");
      const lateMetadata = p.waitForResponse(
        (r) =>
          r.url().endsWith(`/patients/${x.id}/entry-draft/admission-entry`) &&
          r.request().method() === "GET",
      );
      releaseMetadata();
      await lateMetadata;
      await expect(
        p.getByText("Draft changed in another window.", { exact: true }),
      ).toHaveCount(0);
      const retry = waitPost("/admissions");
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Admit", exact: true })
        .click();
      expect((await retry).status()).toBe(200);
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      const ctx = (await good(`/patients/${x.id}/journey`)).contexts.find(
        (c) => c.kind === "admission",
      );
      await go(x, "/visits");
      await p
        .getByRole("heading", { name: "Admission", exact: true })
        .waitFor();
      return {
        defect:
          ctx.summary.narrative !==
          "Synthetic newer clinician admission history",
        patientId: x.id,
        evidence: {
          rejectedStatus: response.status(),
          posted,
          reviewedDraftVersion: changed.version,
          recordedNarrative: ctx.summary.narrative,
        },
        screens: [before, await shot("reviewed-admission-recorded")],
      };
    },
  );
  await run(
    "Narrative edited during assessment survives closing before the note step",
    async () => {
      const x = await create("assessment narrative");
      const v = await visit(x, "Synthetic original visit narrative");
      await openVisit(x);
      await expect(
        p.getByLabel("Visit narrative", { exact: true }),
      ).toHaveValue("Synthetic original visit narrative");
      await p
        .getByLabel("Visit narrative", { exact: true })
        .fill("Synthetic updated narrative at assessment");
      const before = await shot("edited-assessment-narrative");
      await close();
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      await openVisit(x);
      const restored = await p
        .getByLabel("Visit narrative", { exact: true })
        .inputValue();
      return {
        defect: restored !== "Synthetic updated narrative at assessment",
        priority: "medium",
        patientId: x.id,
        contextId: v.id,
        evidence: {
          restored,
          draft: await good(`/patients/${x.id}/contexts/${v.id}/draft`),
        },
        screens: [before, await shot("assessment-narrative-lost")],
      };
    },
  );
  await run(
    "Clearing a narrative keeps its field available for re-entry",
    async () => {
      const x = await create("empty narrative editor");
      await visit(x, "Synthetic narrative to replace");
      await openVisit(x);
      await expect(
        p.getByLabel("Visit narrative", { exact: true }),
      ).toBeVisible();
      await p.getByLabel("Visit narrative", { exact: true }).fill("");
      const exists = await p
        .getByLabel("Visit narrative", { exact: true })
        .count();
      expect(exists).toBe(1);
      await p
        .getByLabel("Visit narrative", { exact: true })
        .fill("Synthetic replacement narrative");
      await close();
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      await openVisit(x);
      await expect(
        p.getByLabel("Visit narrative", { exact: true }),
      ).toHaveValue("Synthetic replacement narrative");
      return {
        defect: false,
        priority: "medium",
        patientId: x.id,
        evidence: { narrativeFieldCount: exists },
        screens: [await shot("empty-narrative-editor-disappeared")],
      };
    },
  );
  await run("A visit closed elsewhere offers correct recovery", async () => {
    const x = await create("visit closed elsewhere");
    const v = await visit(x);
    await openVisit(x);
    await p.getByRole("textbox", { name: /^Systolic BP/ }).fill("148");
    const saved = waitPost(
      `/entry-draft/assessment:${v.id}`,
      (r) => r.status() === 200,
    );
    await saved;
    const d = await good(`/patients/${x.id}/contexts/${v.id}/draft`),
      n = await good(`/patients/${x.id}/contexts/${v.id}/note`);
    await good(`/patients/${x.id}/visits/${v.id}/close`, {
      draftVersion: d.version,
      evidenceKey: n.evidenceKey,
      note: n.text ?? n.note ?? "Synthetic finalized visit",
    });
    const failed = waitPost(`/visits/${v.id}/assessment`);
    await p
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    const response = await failed;
    expect(response.status()).toBe(409);
    await p
      .getByRole("button", { name: "View saved visit", exact: true })
      .waitFor();
    const before = await shot("closed-visit-state-and-recovery");
    expect(
      await p
        .getByRole("button", { name: "Use latest readings", exact: true })
        .count(),
    ).toBe(0);
    expect(
      (await good(`/patients/${x.id}/record`)).todayValues.sbp,
    ).toBeUndefined();
    await p
      .getByRole("button", { name: "View saved visit", exact: true })
      .click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await expect(p.getByText("Closed", { exact: true })).toBeVisible();
    return {
      defect: false,
      patientId: x.id,
      contextId: v.id,
      evidence: { response: await response.json() },
      screens: [before, await shot("closed-visit-opened-for-review")],
    };
  });
  await run(
    "Note draft conflict at assessment exposes recovery and Close",
    async () => {
      const x = await create("note conflict assessment");
      const v = await visit(x, "Synthetic note narrative");
      await note(x);
      const saved = waitPost(
        `/contexts/${v.id}/draft`,
        (r) =>
          r.status() === 200 &&
          r.request().postDataJSON()?.note === "Synthetic local saved note",
      );
      await p
        .getByLabel("Clinic note", { exact: true })
        .fill("Synthetic local saved note");
      await saved;
      await p.getByRole("button", { name: "Back", exact: true }).click();
      await p.getByRole("button", { name: "Back", exact: true }).click();
      const d = await good(`/patients/${x.id}/contexts/${v.id}/draft`);
      await good(`/patients/${x.id}/contexts/${v.id}/draft`, {
        ...d,
        version: d.version,
        note: "Synthetic newer saved note",
      });
      const conflict = waitPost(
        `/contexts/${v.id}/draft`,
        (r) => r.status() === 409,
      );
      await p
        .getByLabel("Visit narrative", { exact: true })
        .fill("Synthetic local changes requiring recovery");
      await conflict;
      await p
        .getByText("Visit note changed in another window.", { exact: true })
        .waitFor();
      const before = await shot("note-conflict-recovery-at-assessment");
      await p
        .getByRole("button", { name: "Use newer saved note", exact: true })
        .click();
      await expect(
        p.getByLabel("Visit narrative", { exact: true }),
      ).toHaveValue("Synthetic note narrative");
      await close();
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      const restored = await good(`/patients/${x.id}/contexts/${v.id}/draft`);
      expect(restored.note).toBe("Synthetic newer saved note");
      return {
        defect: false,
        patientId: x.id,
        contextId: v.id,
        evidence: { savedNote: restored.note, narrative: restored.narrative },
        screens: [before, await shot("note-conflict-recovered-and-closed")],
      };
    },
  );
  await run(
    "A newer discharge draft can be loaded without closing the drawer",
    async () => {
      const x = await create("discharge conflict");
      const a = await good(`/patients/${x.id}/admissions`, {
        startedAt: new Date(Date.now() - 86400000).toISOString(),
        location: "CCU",
        reasons: ["Chest pain"],
      });
      await go(x);
      await p.getByRole("button", { name: "Discharge", exact: true }).click();
      const n = p.getByRole("textbox", {
        name: /Handover \/ outstanding issues/,
      });
      await expect(n).toBeEnabled();
      const saved = waitPost(
        `/admissions/${a.id}/draft`,
        (r) =>
          r.status() === 200 &&
          r.request().postDataJSON()?.handover === "Synthetic initial handover",
      );
      await n.fill("Synthetic initial handover");
      await saved;
      const d = await good(`/patients/${x.id}/admissions/${a.id}/draft`);
      await good(`/patients/${x.id}/admissions/${a.id}/draft`, {
        ...d,
        version: d.version,
        handover: "Synthetic newer handover",
      });
      const failed = waitPost(
        `/admissions/${a.id}/draft`,
        (r) => r.status() === 409,
      );
      await n.fill("Synthetic local conflicting handover");
      await failed;
      await p
        .getByRole("alert")
        .filter({ hasText: /Draft not saved/ })
        .waitFor()
        .catch(() => {});
      const text = await p.getByRole("dialog").innerText();
      const before = await shot("discharge-conflict-load-control");
      const recovery = p.getByRole("button", {
        name: "Load saved discharge draft",
        exact: true,
      });
      await recovery.click();
      await expect(n).toHaveValue("Synthetic newer handover");
      return {
        defect: false,
        patientId: x.id,
        contextId: a.id,
        evidence: {
          restoredHandover: await n.inputValue(),
          priorVisibleText: text,
        },
        screens: [before, await shot("discharge-conflict-recovered-control")],
      };
    },
  );
  await run(
    "Note conflicts support deliberately keeping local edits at Assessment",
    async () => {
      const x = await create("keep note edits"),
        v = await visit(x, "Synthetic original kept narrative");
      await note(x);
      const saved = waitPost(
        `/contexts/${v.id}/draft`,
        (r) =>
          r.status() === 200 &&
          r.request().postDataJSON()?.note === "Synthetic note to keep",
      );
      await p
        .getByLabel("Clinic note", { exact: true })
        .fill("Synthetic note to keep");
      await saved;
      await p.getByRole("button", { name: "Back", exact: true }).click();
      await p.getByRole("button", { name: "Back", exact: true }).click();
      const d = await good(`/patients/${x.id}/contexts/${v.id}/draft`);
      await good(`/patients/${x.id}/contexts/${v.id}/draft`, {
        ...d,
        note: "Synthetic other window note",
        version: d.version,
      });
      const conflict = waitPost(
        `/contexts/${v.id}/draft`,
        (r) => r.status() === 409,
      );
      await p
        .getByLabel("Visit narrative", { exact: true })
        .fill("Synthetic narrative deliberately retained");
      await conflict;
      await p
        .getByRole("button", { name: "Keep my edits", exact: true })
        .waitFor();
      const before = await shot("note-keep-edits-review");
      const kept = waitPost(
        `/contexts/${v.id}/draft`,
        (r) =>
          r.status() === 200 &&
          r.request().postDataJSON()?.narrative ===
            "Synthetic narrative deliberately retained",
      );
      await p
        .getByRole("button", { name: "Keep my edits", exact: true })
        .click();
      await kept;
      await close();
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      const current = await good(`/patients/${x.id}/contexts/${v.id}/draft`);
      expect(current.narrative).toBe(
        "Synthetic narrative deliberately retained",
      );
      expect(current.note).toContain("Synthetic note to keep");
      return {
        defect: false,
        patientId: x.id,
        contextId: v.id,
        evidence: { note: current.note, narrative: current.narrative },
        screens: [before, await shot("note-kept-with-explicit-review")],
      };
    },
  );
  await run(
    "Clearing visit narrative during an in-flight save and Close stays cleared",
    async () => {
      const x = await create("inflight visit narrative"),
        v = await visit(x, "Synthetic initial narrative");
      await openVisit(x);
      const n = p.getByLabel("Visit narrative", { exact: true });
      await expect(n).toBeEnabled();
      let release, seen;
      const gate = new Promise((r) => (release = r)),
        started = new Promise((r) => (seen = r));
      let held = false;
      let clears = 0;
      const watcher = (r) => {
        if (
          r.url().endsWith(`/contexts/${v.id}/draft`) &&
          r.request().method() === "POST" &&
          r.request().postDataJSON()?.narrative === ""
        )
          clears++;
      };
      p.on("response", watcher);
      await p.route(
        `**/api/patients/${x.id}/contexts/${v.id}/draft`,
        async (route) => {
          if (
            route.request().method() === "POST" &&
            !held &&
            route.request().postDataJSON()?.narrative ===
              "Synthetic obsolete queued narrative"
          ) {
            held = true;
            const response = await route.fetch();
            seen();
            await gate;
            await route.fulfill({ response });
          } else await route.continue();
        },
      );
      await n.fill("Synthetic obsolete queued narrative");
      await started;
      await n.fill("");
      await expect(n).toBeVisible();
      const before = await shot("visit-narrative-cleared-during-save");
      await close();
      release();
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      p.off("response", watcher);
      expect(clears).toBe(1);
      await openVisit(x);
      await p
        .getByRole("button", { name: "Add narrative", exact: true })
        .click();
      await expect(n).toHaveValue("");
      expect(
        (await good(`/patients/${x.id}/contexts/${v.id}/draft`)).narrative,
      ).toBe("");
      return {
        defect: false,
        patientId: x.id,
        contextId: v.id,
        evidence: { clearWrites: clears },
        screens: [before, await shot("cleared-visit-narrative-restored")],
      };
    },
  );
} finally {
  await b.close();
}
console.log(
  "Counts",
  JSON.stringify({
    total: results.length,
    defects: results.filter((x) => x.defect).length,
    passed: results.filter((x) => x.defect === false).length,
    errors: results.filter((x) => x.harnessError).length,
  }),
);
if (results.some((x) => x.harnessError || x.defect)) process.exitCode = 1;
