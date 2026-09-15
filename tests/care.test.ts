import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createDb } from "../server/db.js";
import { createApp } from "../server/app.js";

test("Continuous care survives discharge, is independent of enrollment, and retains scoped history", async () => {
  const db = await createDb(undefined, false);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = "",
    csrf = "";
  async function call(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0];
    if (data.csrf) csrf = data.csrf;
    return { status: response.status, data };
  }
  const draft = {
    kind: "decision",
    encounter_id: null as string | null,
    family: "CAD",
    title: "Residual disease review",
    status: "pending",
    occurred_on: "2025-02-02",
    owner: "Clinic team",
    due_date: "2025-02-10",
    assessment: "Requires review of documented findings",
    action: "Review at linked OPD",
    response: "",
    details: { evidence: "Procedure findings", barrier: "" },
  };
  try {
    assert.equal((await call("/care/board")).status, 401);
    await call("/demo-session", { role: "clinician" });
    const p = await call("/patients", {
      name: "Continuity Test",
      mrn: "SYN-CONTINUITY-TEST",
      sex: "Female",
      birth_date: "1970-01-01",
    });
    assert.equal(p.status, 201);
    assert.equal(p.data.enrollment_id, null);
    const id = p.data.id;
    assert.equal((await call(`/patients/${id}`)).status, 200);
    assert.equal(
      (await db.query("SELECT * FROM registry.enrollment")).rows.length,
      0,
    );
    const opd = await call(`/patients/${id}/care/encounters`, {
      kind: "OPD",
      started_on: "2025-01-28",
      reason: "Initial assessment",
      owner: "OPD team",
      linked_encounter_id: null,
    });
    assert.equal(opd.status, 201);
    const admission = await call(`/patients/${id}/care/encounters`, {
      kind: "Admission",
      started_on: "2025-02-01",
      reason: "ACS admission",
      owner: "Ward team",
      linked_encounter_id: opd.data.id,
    });
    assert.equal(admission.status, 201);
    draft.encounter_id = admission.data.id;
    const entry = await call(`/patients/${id}/care/entries`, draft);
    assert.equal(entry.status, 201, JSON.stringify(entry.data));
    const proc = await call(`/patients/${id}/care/entries`, {
      ...draft,
      kind: "procedure",
      title: "PCI documentation without enrollment",
      family: "CAD",
      status: "performed",
      details: { technique: "Synthetic approach", devices: "Synthetic device" },
    });
    assert.equal(proc.status, 201);
    assert.equal(
      (await db.query("SELECT * FROM registry.enrollment")).rows.length,
      0,
    );
    const close = await call(
      `/patients/${id}/care/encounters/${admission.data.id}/close`,
      {
        version: 1,
        closed_on: "2025-02-03",
        summary: "Residual disease review remains assigned to the clinic team.",
      },
    );
    assert.equal(close.status, 200);
    const followup = await call(`/patients/${id}/care/encounters`, {
      kind: "OPD",
      started_on: "2025-02-10",
      reason: "Linked post discharge review",
      owner: "Clinic team",
      linked_encounter_id: admission.data.id,
    });
    assert.equal(followup.status, 201);
    const workspace = await call(`/patients/${id}/care`);
    assert.equal(workspace.data.encounters.length, 3);
    assert.equal(
      workspace.data.entries.find((e: any) => e.id === entry.data.id).status,
      "pending",
    );
    assert.ok(
      (await call("/care/board")).data.entries.some(
        (e: any) => e.id === entry.data.id,
      ),
    );
    assert.equal(
      (
        await call(
          `/care/entries/${entry.data.id}`,
          { ...draft, version: 1, status: "completed" },
          "PUT",
        )
      ).status,
      422,
    );
    const complete = await call(
      `/care/entries/${entry.data.id}`,
      {
        ...draft,
        version: 1,
        status: "completed",
        response: "Assessment completed; chosen strategy documented at OPD.",
      },
      "PUT",
    );
    assert.equal(complete.status, 200);
    assert.equal(complete.data.version, 2);
    assert.equal(
      (
        await call(
          `/care/entries/${entry.data.id}`,
          { ...draft, version: 1 },
          "PUT",
        )
      ).status,
      409,
    );
    assert.ok(
      !(await call("/care/board")).data.entries.some(
        (e: any) => e.id === entry.data.id,
      ),
    );
    const history = (await call(`/care/entries/${entry.data.id}/history`)).data;
    assert.deepEqual(
      history.map((h: any) => h.payload.status),
      ["completed", "pending"],
    );
    await assert.rejects(
      db.query("DELETE FROM care.revision WHERE entry_id=$1", [entry.data.id]),
      /Append-only/,
    );
    const badLab = {
      ...draft,
      kind: "investigation",
      status: "reviewed",
      response: "Reviewed",
      details: { value: "", unit: "", interpretation: "" },
    };
    assert.equal(
      (await call(`/patients/${id}/care/entries`, badLab)).status,
      422,
    );
    assert.equal(
      (
        await call(`/patients/${id}/care/entries`, {
          ...badLab,
          details: {
            value: "Synthetic recorded result",
            unit: "",
            interpretation: "Clinician review recorded",
          },
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call(`/patients/${id}/care/entries`, {
          ...draft,
          kind: "medication",
          status: "held",
          due_date: null,
          details: { reason: "" },
        })
      ).status,
      422,
    );
    assert.equal(
      (await call(`/patients/${id}/enroll`, { registry: "CAD" })).status,
      201,
    );
    assert.equal(
      (await call(`/patients/${id}/enroll`, { registry: "CAD" })).status,
      409,
    );
    assert.equal((await call(`/patients/${id}/care`)).data.entries.length, 3);
    // A forged encounter link must not cross identities or sites.
    const other = randomUUID();
    await db.query(
      "INSERT INTO core.patient(id,name,mrn,sex,birth_date,site_id,created_by) VALUES($1,'Other site','SYN-OTHER-CARE','Unknown','1980-01-01','other-site','test')",
      [other],
    );
    assert.equal((await call(`/patients/${other}/care`)).status, 404);
    assert.equal(
      (await call(`/patients/${other}/care/entries`, draft)).status,
      404,
    );
    const own = await call("/patients", {
      name: "Another Test",
      mrn: "SYN-ANOTHER-TEST",
      sex: "Male",
      birth_date: "1970-01-01",
    });
    assert.equal(
      (await call(`/patients/${own.data.id}/care/entries`, draft)).status,
      404,
    );
    await call("/demo-session", { role: "reviewer" });
    assert.equal((await call(`/patients/${id}/care`)).status, 200);
    assert.equal(
      (await call(`/patients/${id}/care/entries`, draft)).status,
      403,
    );
    for (const role of ["designer", "analyst"]) {
      await call("/demo-session", { role });
      for (const path of [
        "/care/board",
        `/patients/${id}/care`,
        `/care/entries/${entry.data.id}/history`,
      ])
        assert.equal((await call(path)).status, 403);
      assert.equal(
        (await call(`/patients/${id}/enroll`, { registry: "CAD" })).status,
        403,
      );
    }
  } finally {
    server.close();
    await db.close();
  }
});
