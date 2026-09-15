import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { randomUUID } from "node:crypto";
import { type AddressInfo } from "node:net";

test("CAD workflow, access boundaries, conflicts, snapshots, contacts, and exports", async (t) => {
  const db = await createDb(undefined, false);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = () => {
    let cookie = "",
      csrf = "";
    return {
      async request(
        path: string,
        body?: unknown,
        method = body === undefined ? "GET" : "POST",
        headers: Record<string, string> = {},
      ) {
        const r = await fetch(base + "/api" + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
            "X-CSRF-Token": csrf,
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await r.json();
        if (r.headers.get("set-cookie"))
          cookie = r.headers.get("set-cookie")!.split(";")[0];
        if (data.csrf) csrf = data.csrf;
        return { status: r.status, data };
      },
    };
  };
  const clinician = client(),
    reviewer = client(),
    designer = client(),
    analyst = client();
  let patientId = "",
    episodeId = "",
    version = 1;
  let task: any;
  const draft = {
    version: 1,
    admission_date: "2025-01-31",
    discharge_date: "2025-02-02",
    presentation: "NSTEMI",
    access_site: "Radial",
    management: "PCI",
    discharge_status: "Alive",
    lesions: [
      {
        vessel: "LAD",
        segment: "Proximal",
        stenosis: 90,
        treatment: "PCI",
        stents: [{ diameter: 3, length: 24, type: "DES" }],
      },
      {
        vessel: "RCA",
        segment: "Mid",
        stenosis: 50,
        treatment: "Medical therapy",
        stents: [],
      },
    ],
  };
  try {
    await t.test("Unauthenticated clinical requests are rejected", async () => {
      assert.equal((await clinician.request("/patients")).status, 401);
    });
    for (const [c, role] of [
      [clinician, "clinician"],
      [reviewer, "reviewer"],
      [designer, "designer"],
      [analyst, "analyst"],
    ] as const)
      assert.equal((await c.request("/demo-session", { role })).status, 200);
    await t.test("CSRF and external origins are rejected", async () => {
      assert.equal(
        (
          await clinician.request("/patients", {}, "POST", {
            "X-CSRF-Token": "wrong",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await clinician.request(
            "/demo-session",
            { role: "clinician" },
            "POST",
            { Origin: "https://evil.example" },
          )
        ).status,
        403,
      );
    });
    await t.test(
      "Designer has definitions but no patient, task, audit or metrics access",
      async () => {
        assert.equal((await designer.request("/definitions")).status, 200);
        for (const route of ["/patients", "/tasks", "/audit", "/overview"])
          assert.equal((await designer.request(route)).status, 403);
      },
    );
    await t.test(
      "Register and enroll one patient; duplicate MRNs are blocked atomically",
      async () => {
        const p = {
          name: "Integration Sample",
          enroll_cad: true,
          mrn: "SYN-INTEGRATION",
          sex: "Female",
          birth_date: "1970-04-12",
        };
        const response = await clinician.request("/patients", p);
        assert.equal(response.status, 201, JSON.stringify(response.data));
        patientId = response.data.id;
        assert.equal((await clinician.request("/patients", p)).status, 409);
        assert.equal(
          (await db.query("SELECT * FROM registry.enrollment")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "Reviewer cannot create clinical records and analyst cannot browse identity",
      async () => {
        assert.equal((await reviewer.request("/patients", {})).status, 403);
        assert.equal((await analyst.request("/patients")).status, 403);
        assert.equal(
          (await clinician.request("/exports", { purpose: "test purpose" }))
            .status,
          403,
        );
      },
    );
    await t.test(
      "Create episode and reject incomplete finalization without partial tasks",
      async () => {
        const r = await clinician.request(`/patients/${patientId}/episodes`, {
          admission_date: draft.admission_date,
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        episodeId = r.data.id;
        assert.equal(r.data.admission_date, "2025-01-31");
        const f = await clinician.request(`/episodes/${episodeId}/finalize`, {
          version: 1,
        });
        assert.equal(f.status, 422);
        assert.equal(
          (await db.query("SELECT * FROM workflow.followup_task")).rows.length,
          0,
        );
      },
    );
    await t.test(
      "Save normalized lesions and stents; stale writes cannot overwrite",
      async () => {
        const r = await clinician.request(
          "/episodes/" + episodeId,
          draft,
          "PUT",
        );
        assert.equal(r.status, 200, JSON.stringify(r.data));
        version = r.data.version;
        assert.equal(r.data.lesions.length, 2);
        assert.equal(
          (await db.query("SELECT * FROM cad.stent")).rows.length,
          1,
        );
        assert.equal(
          (
            await clinician.request(
              "/episodes/" + episodeId,
              { ...draft, presentation: "STEMI" },
              "PUT",
            )
          ).status,
          409,
        );
        assert.equal(
          (await clinician.request("/episodes/" + episodeId)).data.presentation,
          "NSTEMI",
        );
      },
    );
    await t.test(
      "Finalization creates one snapshot and four correctly anchored milestones",
      async () => {
        const r = await clinician.request(`/episodes/${episodeId}/finalize`, {
          version,
        });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        version = r.data.version;
        const tasks = (await clinician.request("/tasks")).data;
        assert.equal(tasks.length, 4);
        assert.equal(tasks[0].due_date, "2025-02-28");
        assert.equal(tasks[0].anchor_date, "2025-01-31");
        task = tasks[0];
        assert.equal(
          (await db.query("SELECT * FROM governance.record_snapshot")).rows
            .length,
          1,
        );
        assert.equal(
          (
            await clinician.request(`/episodes/${episodeId}/finalize`, {
              version,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await clinician.request(
              "/episodes/" + episodeId,
              { ...draft, version },
              "PUT",
            )
          ).status,
          409,
        );
      },
    );
    await t.test("Independent reviewer approves final record", async () => {
      assert.equal(
        (await clinician.request(`/episodes/${episodeId}/review`, { version }))
          .status,
        403,
      );
      const r = await reviewer.request(`/episodes/${episodeId}/review`, {
        version,
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.state, "reviewed");
    });
    await t.test(
      "Early contact is retained without satisfying milestone",
      async () => {
        const r = await clinician.request(`/tasks/${task.id}/contact`, {
          version: task.version,
          contact_date: "2025-02-10",
          contact_type: "Telephone",
          vital_status: "Alive",
          rehospitalized: "No",
          notes: "Early contact",
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        assert.equal(r.data.satisfied, false);
        assert.equal(
          (await db.query("SELECT * FROM clinical.encounter")).rows.length,
          1,
        );
        assert.equal(
          (await db.query("SELECT * FROM workflow.task_satisfaction")).rows
            .length,
          0,
        );
      },
    );
    await t.test(
      "Qualifying contact satisfies only once; repeats are rejected",
      async () => {
        const payload = {
          version: task.version,
          contact_date: "2025-02-28",
          contact_type: "Clinic",
          vital_status: "Alive",
          rehospitalized: "No",
          notes: "In-window contact",
        };
        const r = await clinician.request(`/tasks/${task.id}/contact`, payload);
        assert.equal(r.status, 201);
        assert.equal(r.data.satisfied, true);
        assert.equal(
          (await clinician.request(`/tasks/${task.id}/contact`, payload))
            .status,
          409,
        );
      },
    );
    await t.test(
      "Audit and final snapshots are protected by database triggers",
      async () => {
        await assert.rejects(
          db.query("UPDATE governance.audit_event SET actor='tampered'"),
          /Append-only/,
        );
        await assert.rejects(
          db.query("DELETE FROM governance.record_snapshot"),
          /Append-only/,
        );
        await assert.rejects(
          db.query("UPDATE registry.definition SET version=2"),
          /Append-only/,
        );
      },
    );
    await t.test(
      "Purpose-bound exports exclude direct identity and freeze content",
      async () => {
        assert.equal(
          (await analyst.request("/exports", { purpose: "no" })).status,
          422,
        );
        const r = await analyst.request("/exports", {
          purpose: "Synthetic workflow quality review",
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        assert.equal(r.data.row_count, 1);
        assert.ok(!r.data.content.includes("Integration Sample"));
        assert.ok(!r.data.content.includes("SYN-INTEGRATION"));
        assert.ok(r.data.codebook.includes("lesion_count"));
        assert.equal(r.data.checksum.length, 64);
        assert.equal(
          (await db.query("SELECT content FROM governance.export_job")).rows
            .length,
          1,
        );
      },
    );
    await t.test("Site-scoped reads reject another site patient", async () => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO core.patient(id,name,mrn,sex,birth_date,site_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          "Outside Sample",
          "SYN-OUTSIDE",
          "Unknown",
          "1980-01-01",
          "other-site",
          "test",
        ],
      );
      await db.query(
        "INSERT INTO registry.enrollment(id,patient_id,registry_key,definition_version) VALUES($1,$2,$3,$4)",
        [randomUUID(), id, "CAD", 1],
      );
      assert.equal((await clinician.request("/patients/" + id)).status, 404);
      assert.equal((await clinician.request("/patients")).data.length, 1);
    });
    await t.test(
      "Unknown outcomes retain contact but keep task open; death closes remaining tasks",
      async () => {
        const second = (await clinician.request("/tasks")).data.find(
          (v: any) => v.milestone === 3,
        );
        const input = {
          version: second.version,
          contact_date: "2025-04-30",
          contact_type: "Telephone",
          vital_status: "Unknown",
          rehospitalized: "Unknown",
          notes: "",
        };
        assert.equal(
          (await clinician.request(`/tasks/${second.id}/contact`, input)).data
            .satisfied,
          false,
        );
        assert.equal(
          (
            await clinician.request(`/tasks/${second.id}/contact`, {
              ...input,
              vital_status: "Deceased",
              rehospitalized: "No",
            })
          ).status,
          201,
        );
        const tasks = (await clinician.request("/tasks")).data;
        assert.equal(
          tasks.filter((v: any) => v.state === "scheduled").length,
          0,
        );
        assert.equal(
          tasks.filter((v: any) => v.state === "satisfied").length,
          2,
        );
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await db.close();
  }
});
