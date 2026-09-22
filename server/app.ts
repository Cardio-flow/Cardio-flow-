import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { z, ZodError } from "zod";
import { type DB, audit, hash } from "./db.js";
import { mountCare, CareError } from "./care.js";
import {
  FoundationError,
  mountClinicalFoundation,
} from "./clinical-foundation.js";
import { mountClinicalGovernance } from "./clinical-governance.js";
import {
  patientSchema,
  episodeSchema,
  historicalDate,
  today,
  addMonths,
  addDays,
  taskState,
  cadDefinition,
  csv,
} from "./domain.js";
type Role = "clinician" | "reviewer" | "analyst" | "designer";
export type Session = {
  actor: string;
  role: Role;
  expires: number;
  csrf: string;
  email?: string;
};
export type HostedOptions = {
  origin: string;
  mountAuth(app: express.Express): void;
  authenticate(req: Request, res: Response): Promise<Session | null>;
};
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const uuid = z.string().uuid();
const requiredVersion = z
  .object({ version: z.number().int().positive() })
  .strict();
const one = async <T = Record<string, any>>(
  db: Pick<DB, "query">,
  sql: string,
  args: unknown[] = [],
) => (await db.query<T>(sql, args)).rows[0];
export function createApp(db: DB, hosted?: HostedOptions) {
  const app = express();
  app.disable("x-powered-by");
  const sessions = new Map<string, Session>();
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    const host = req.hostname;
    if (!hosted && !["localhost", "127.0.0.1", "[::1]"].includes(host))
      return res.status(403).json({
        error: "This synthetic workspace is restricted to localhost.",
      });
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.get("origin");
      if (origin && origin !== (hosted?.origin ?? `http://${req.get("host")}`))
        return res.status(403).json({ error: "Untrusted origin" });
    }
    next();
  });
  hosted?.mountAuth(app);
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/config", (_req, res) => res.json({ hosted: !!hosted }));
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", mode: "synthetic", date: today() }),
  );
  app.post("/api/demo-session", (req, res) => {
    if (hosted)
      return res.status(404).json({ error: "Demo login is disabled" });
    const { role } = z
      .object({
        role: z.enum(["clinician", "reviewer", "analyst", "designer"]),
      })
      .strict()
      .parse(req.body);
    for (const [key, value] of sessions)
      if (value.expires < Date.now()) sessions.delete(key);
    if (sessions.size > 500) throw new ApiError(429, "Too many sessions");
    const previous = req.headers.cookie
      ?.split("; ")
      .find((v) => v.startsWith("cf_session="))
      ?.split("=")[1];
    if (previous) sessions.delete(previous);
    const token = randomBytes(32).toString("hex");
    const session = {
      actor: `demo:${role}`,
      role,
      expires: Date.now() + 8 * 3600_000,
      csrf: randomBytes(24).toString("hex"),
    };
    sessions.set(token, session);
    res.cookie("cf_session", token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 3600_000,
    });
    res.json(session);
  });
  app.use("/api", async (req, res, next) => {
    const token = req.headers.cookie
      ?.split("; ")
      .find((v) => v.startsWith("cf_session="))
      ?.split("=")[1];
    const session = hosted
      ? await hosted.authenticate(req, res)
      : token
        ? sessions.get(token)
        : undefined;
    if (res.headersSent) return;
    if (!session || session.expires < Date.now())
      return res.status(401).json({
        error: hosted
          ? "Sign in to continue"
          : "Start a demo session to continue",
      });
    res.locals.session = session;
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("x-csrf-token") !== session.csrf
    )
      return res.status(403).json({ error: "Invalid request token" });
    next();
  });
  app.get("/api/session", (_req, res) => res.json(res.locals.session));
  app.post("/api/logout", (req, res) => {
    const token = req.headers.cookie
      ?.split("; ")
      .find((v) => v.startsWith("cf_session="))
      ?.split("=")[1];
    if (token) sessions.delete(token);
    res.clearCookie("cf_session");
    res.json({ ok: true });
  });
  const allow =
    (...roles: Role[]) =>
    (_req: Request, res: Response, next: NextFunction) => {
      if (!roles.includes(res.locals.session.role))
        return res
          .status(403)
          .json({ error: "Your role cannot perform this action" });
      next();
    };
  app.get("/api/definitions", (_req, res) => {
    res.json({
      definitions: [cadDefinition],
      checksum: hash(JSON.stringify(cadDefinition)),
    });
  });
  app.get("/api/patients", allow("clinician", "reviewer"), async (req, res) => {
    const q = z
      .string()
      .max(100)
      .parse(req.query.q ?? "");
    const patients = (
      await db.query(
        `SELECT p.*,
          CASE WHEN p.height_cm IS NOT NULL AND p.weight_kg IS NOT NULL THEN round((p.weight_kg/power(p.height_cm/100,2))::numeric,1) END bmi,
          CASE WHEN p.height_cm IS NOT NULL AND p.weight_kg IS NOT NULL THEN round(sqrt((p.height_cm*p.weight_kg)/3600)::numeric,2) END bsa,
          e.id enrollment_id,e.crf,e.registry_key,
          (SELECT count(*)::int FROM clinical.episode ep WHERE ep.enrollment_id=e.id) episode_count
         FROM core.patient p LEFT JOIN registry.enrollment e ON e.patient_id=p.id AND e.registry_key='CAD'
         WHERE p.site_id='demo-kuwait' AND (p.name ILIKE $1 OR p.mrn ILIKE $1 OR COALESCE(p.civil_id,'') ILIKE $1 OR COALESCE(p.phone,'') ILIKE $1)
         ORDER BY p.created_at DESC,p.name`,
        ["%" + q + "%"],
      )
    ).rows;
    res.json(patients);
  });
  app.post("/api/patients", allow("clinician"), async (req, res) => {
    const input = patientSchema.parse(req.body);
    const id = randomUUID(),
      enrollment = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO core.patient
         (id,name,mrn,sex,birth_date,created_by,civil_id,phone,height_cm,weight_kg,allergies,smoking_status,reproductive_status,primary_team,major_comorbidities)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          input.name,
          input.mrn,
          input.sex,
          input.birth_date,
          res.locals.session.actor,
          input.civil_id,
          input.phone,
          input.height_cm,
          input.weight_kg,
          JSON.stringify(input.allergies),
          input.smoking_status,
          input.reproductive_status,
          input.primary_team,
          JSON.stringify(input.major_comorbidities),
        ],
      );
      if (input.enroll_cad)
        await tx.query(
          "INSERT INTO registry.enrollment(id,patient_id,registry_key,definition_version) VALUES($1,$2,$3,$4)",
          [enrollment, id, "CAD", 1],
        );
      await audit(
        tx,
        res.locals.session.actor,
        input.enroll_cad
          ? "Patient registered & enrolled"
          : "Patient identity registered",
        "patient",
        id,
        id,
        {
          registry: input.enroll_cad ? "CAD" : null,
          definitionVersion: input.enroll_cad ? 1 : null,
        },
      );
    });
    res
      .status(201)
      .json({ id, enrollment_id: input.enroll_cad ? enrollment : null });
  });
  const patient = async (db: Pick<DB, "query">, id: string) => {
    const p = await one(
      db,
      `SELECT p.*,
        CASE WHEN p.height_cm IS NOT NULL AND p.weight_kg IS NOT NULL THEN round((p.weight_kg/power(p.height_cm/100,2))::numeric,1) END bmi,
        CASE WHEN p.height_cm IS NOT NULL AND p.weight_kg IS NOT NULL THEN round(sqrt((p.height_cm*p.weight_kg)/3600)::numeric,2) END bsa,
        e.id enrollment_id,e.crf,e.registry_key,e.status enrollment_status
       FROM core.patient p LEFT JOIN registry.enrollment e ON e.patient_id=p.id AND e.registry_key='CAD'
       WHERE p.id=$1 AND p.site_id='demo-kuwait'`,
      [uuid.parse(id)],
    );
    if (!p) throw new ApiError(404, "Patient not found");
    return p;
  };
  async function episode(
    db: Pick<DB, "query">,
    id: string,
  ): Promise<Record<string, any> & { lesions: any[] }> {
    const e = await one(
      db,
      "SELECT ep.*,en.patient_id,en.crf FROM clinical.episode ep JOIN registry.enrollment en ON en.id=ep.enrollment_id JOIN core.patient p ON p.id=en.patient_id WHERE ep.id=$1 AND p.site_id='demo-kuwait'",
      [uuid.parse(id)],
    );
    if (!e) throw new ApiError(404, "Episode not found");
    const lesions = (
      await db.query(
        "SELECT l.*, COALESCE((SELECT json_agg(s) FROM cad.stent s WHERE s.lesion_id=l.id),'[]') stents FROM cad.lesion l WHERE l.episode_id=$1 ORDER BY l.id",
        [id],
      )
    ).rows;
    return { ...e, lesions };
  }
  app.get(
    "/api/patients/:id",
    allow("clinician", "reviewer"),
    async (req, res) => {
      const p = await patient(db, String(req.params.id));
      const episodes = (
        await db.query(
          "SELECT * FROM clinical.episode WHERE enrollment_id=$1 ORDER BY admission_date DESC",
          [p.enrollment_id],
        )
      ).rows;
      res.json({ ...p, episodes });
    },
  );
  app.post(
    "/api/patients/:id/episodes",
    allow("clinician"),
    async (req, res) => {
      const { admission_date } = z
        .object({ admission_date: historicalDate })
        .strict()
        .parse(req.body);
      const p = await patient(db, String(req.params.id));
      if (p.enrollment_status !== "enrolled")
        throw new ApiError(409, "This enrollment is closed");
      if (admission_date < p.birth_date)
        throw new ApiError(422, "Admission cannot precede birth date");
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO clinical.episode(id,enrollment_id,admission_date,created_by,updated_by) VALUES($1,$2,$3,$4,$4)",
          [id, p.enrollment_id, admission_date, res.locals.session.actor],
        );
        await audit(
          tx,
          res.locals.session.actor,
          "CAD episode created",
          "episode",
          id,
          p.id,
        );
      });
      res.status(201).json(await episode(db, id));
    },
  );
  app.get(
    "/api/episodes/:id",
    allow("clinician", "reviewer"),
    async (req, res) => res.json(await episode(db, String(req.params.id))),
  );
  app.put("/api/episodes/:id", allow("clinician"), async (req, res) => {
    const input = episodeSchema.parse(req.body);
    const id = uuid.parse(req.params.id);
    await db.transaction(async (tx) => {
      const current = await episode(tx, id);
      if (current.version !== input.version)
        throw new ApiError(
          409,
          "This episode changed. Reload it before saving.",
        );
      if (current.state !== "draft")
        throw new ApiError(
          409,
          "Final records are locked. Amendments are not enabled in this release.",
        );
      const p = await patient(tx, current.patient_id);
      if (input.admission_date < p.birth_date)
        throw new ApiError(422, "Admission cannot precede birth date");
      const result = await tx.query(
        "UPDATE clinical.episode SET admission_date=$1,discharge_date=$2,presentation=$3,access_site=$4,management=$5,discharge_status=$6,version=version+1,updated_by=$7,updated_at=now() WHERE id=$8 AND version=$9 AND state='draft' RETURNING id",
        [
          input.admission_date,
          input.discharge_date,
          input.presentation,
          input.access_site,
          input.management,
          input.discharge_status,
          res.locals.session.actor,
          id,
          input.version,
        ],
      );
      if (!result.rows.length)
        throw new ApiError(409, "Concurrent edit detected");
      await tx.query("DELETE FROM cad.lesion WHERE episode_id=$1", [id]);
      for (const lesion of input.lesions) {
        const lid = randomUUID();
        await tx.query("INSERT INTO cad.lesion VALUES($1,$2,$3,$4,$5,$6)", [
          lid,
          id,
          lesion.vessel,
          lesion.segment,
          lesion.stenosis,
          lesion.treatment,
        ]);
        for (const stent of lesion.stents)
          await tx.query("INSERT INTO cad.stent VALUES($1,$2,$3,$4,$5)", [
            randomUUID(),
            lid,
            stent.diameter,
            stent.length,
            stent.type,
          ]);
      }
      await audit(
        tx,
        res.locals.session.actor,
        "Draft saved",
        "episode",
        id,
        current.patient_id,
        { before: current, after: await episode(tx, id) },
      );
    });
    res.json(await episode(db, id));
  });
  app.post(
    "/api/episodes/:id/finalize",
    allow("clinician"),
    async (req, res) => {
      const { version } = requiredVersion.parse(req.body);
      const id = uuid.parse(req.params.id);
      await db.transaction(async (tx) => {
        const e = await episode(tx, id);
        if (e.state !== "draft" || e.version !== version)
          throw new ApiError(
            409,
            "Record state or version changed. Reload to continue.",
          );
        const p = await patient(tx, e.patient_id);
        if (p.enrollment_status !== "enrolled")
          throw new ApiError(409, "This enrollment is closed");
        const missing = [
          "presentation",
          "access_site",
          "management",
          "discharge_date",
          "discharge_status",
        ].filter((k) => !e[k]);
        if (missing.length)
          throw new ApiError(
            422,
            "Complete required fields: " + missing.join(", "),
          );
        if (e.access_site === "Not performed" && e.lesions.length)
          throw new ApiError(
            422,
            "Angiography is marked not performed but lesions are recorded",
          );
        if (
          e.management === "PCI" &&
          (!e.lesions.length ||
            !e.lesions.some((l: any) => l.treatment === "PCI"))
        )
          throw new ApiError(
            422,
            "PCI management requires at least one PCI lesion",
          );
        if (
          e.management === "Medical therapy" &&
          e.lesions.some((l: any) => l.treatment === "PCI")
        )
          throw new ApiError(
            422,
            "PCI lesions conflict with medical-only management",
          );
        const update = await tx.query(
          "UPDATE clinical.episode SET state='final',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2 AND version=$3 AND state='draft' RETURNING id",
          [res.locals.session.actor, id, version],
        );
        if (!update.rows.length)
          throw new ApiError(409, "Concurrent edit detected");
        await tx.query(
          "INSERT INTO governance.record_snapshot(id,episode_id,version,payload) VALUES($1,$2,$3,$4)",
          [
            randomUUID(),
            id,
            version + 1,
            JSON.stringify(await episode(tx, id)),
          ],
        );
        if (e.discharge_status !== "Died in hospital")
          for (const months of cadDefinition.protocol.months) {
            const due = addMonths(e.admission_date, months);
            await tx.query(
              "INSERT INTO workflow.followup_task(id,episode_id,milestone,protocol_version,anchor_date,due_date,window_start,window_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                randomUUID(),
                id,
                months,
                cadDefinition.protocol.version,
                e.admission_date,
                due,
                addDays(due, -7),
                addDays(due, 14),
              ],
            );
          }
        await audit(
          tx,
          res.locals.session.actor,
          "Episode finalized",
          "episode",
          id,
          e.patient_id,
          {
            version: version + 1,
            formVersion: e.form_version,
            followupsGenerated: e.discharge_status !== "Died in hospital",
          },
        );
      });
      res.json(await episode(db, id));
    },
  );
  app.post("/api/episodes/:id/review", allow("reviewer"), async (req, res) => {
    const { version } = requiredVersion.parse(req.body);
    const id = uuid.parse(req.params.id);
    await db.transaction(async (tx) => {
      const e = await episode(tx, id);
      if (e.state !== "final" || e.version !== version)
        throw new ApiError(
          409,
          "Only the current final version can be reviewed",
        );
      if (e.updated_by === res.locals.session.actor)
        throw new ApiError(403, "A separate reviewer must approve this record");
      await tx.query(
        "UPDATE clinical.episode SET state='reviewed',version=version+1,updated_at=now(),updated_by=$1 WHERE id=$2",
        [res.locals.session.actor, id],
      );
      await audit(
        tx,
        res.locals.session.actor,
        "Record reviewed",
        "episode",
        id,
        e.patient_id,
        { reviewedVersion: version },
      );
    });
    res.json(await episode(db, id));
  });
  app.get("/api/tasks", allow("clinician", "reviewer"), async (_req, res) => {
    const tasks = (
      await db.query(
        `SELECT t.*,p.name,p.mrn,p.id patient_id FROM workflow.followup_task t JOIN clinical.episode ep ON ep.id=t.episode_id JOIN registry.enrollment en ON en.id=ep.enrollment_id JOIN core.patient p ON p.id=en.patient_id WHERE p.site_id='demo-kuwait' ORDER BY t.due_date`,
      )
    ).rows;
    res.json(tasks.map((t: any) => ({ ...t, display_state: taskState(t) })));
  });
  app.post("/api/tasks/:id/contact", allow("clinician"), async (req, res) => {
    const input = z
      .object({
        version: z.number().int().positive(),
        contact_date: historicalDate,
        contact_type: z.enum(["Clinic", "Telephone"]),
        vital_status: z.enum(["Alive", "Deceased", "Unknown"]),
        rehospitalized: z.enum(["Yes", "No", "Unknown"]),
        notes: z.string().trim().max(2000),
      })
      .strict()
      .parse(req.body);
    const id = uuid.parse(req.params.id);
    let satisfied = false;
    await db.transaction(async (tx) => {
      const task = await one(
        tx,
        "SELECT * FROM workflow.followup_task WHERE id=$1",
        [id],
      );
      if (!task) throw new ApiError(404, "Task not found");
      const e = await episode(tx, task.episode_id);
      if (task.version !== input.version || task.state !== "scheduled")
        throw new ApiError(409, "Task already changed. Reload to continue.");
      if (input.contact_date < task.anchor_date)
        throw new ApiError(422, "Contact cannot precede index admission");
      const encounter = randomUUID();
      await tx.query(
        "INSERT INTO clinical.encounter(id,episode_id,contact_date,contact_type,vital_status,rehospitalized,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          encounter,
          task.episode_id,
          input.contact_date,
          input.contact_type,
          input.vital_status,
          input.rehospitalized,
          input.notes,
          res.locals.session.actor,
        ],
      );
      satisfied =
        input.contact_date >= task.window_start &&
        input.contact_date <= task.window_end &&
        input.vital_status !== "Unknown" &&
        input.rehospitalized !== "Unknown";
      if (satisfied) {
        await tx.query(
          "UPDATE workflow.followup_task SET state='satisfied',version=version+1 WHERE id=$1",
          [id],
        );
        await tx.query(
          "INSERT INTO workflow.task_satisfaction(task_id,encounter_id) VALUES($1,$2)",
          [id, encounter],
        );
      }
      if (input.vital_status === "Deceased") {
        await tx.query(
          "UPDATE workflow.followup_task SET state='cancelled',version=version+1 WHERE state='scheduled' AND episode_id IN (SELECT ep.id FROM clinical.episode ep JOIN registry.enrollment en ON en.id=ep.enrollment_id WHERE en.patient_id=$1)",
          [e.patient_id],
        );
        await tx.query(
          "UPDATE registry.enrollment SET status='completed' WHERE patient_id=$1",
          [e.patient_id],
        );
      }
      await audit(
        tx,
        res.locals.session.actor,
        "Follow-up contact recorded",
        "encounter",
        encounter,
        e.patient_id,
        { taskId: id, satisfied, ...input },
      );
    });
    res.status(201).json({
      satisfied,
      message: satisfied
        ? "Contact recorded and milestone satisfied."
        : input.vital_status === "Deceased"
          ? "Contact recorded. Remaining tasks cancelled."
          : "Contact retained in history. The milestone remains open because the date is outside its window or outcomes are unknown.",
    });
  });
  app.get("/api/audit", allow("clinician", "reviewer"), async (req, res) => {
    const id = req.query.patient_id ? uuid.parse(req.query.patient_id) : null;
    const result = await db.query(
      `SELECT id,actor,action,entity_type,entity_id,patient_id,created_at,detail FROM governance.audit_event WHERE (patient_id IS NULL OR patient_id IN (SELECT id FROM core.patient WHERE site_id='demo-kuwait')) AND ($1::uuid IS NULL OR patient_id=$1) ORDER BY created_at DESC LIMIT 200`,
      [id],
    );
    res.json(result.rows);
  });
  app.get(
    "/api/overview",
    allow("clinician", "reviewer", "analyst"),
    async (_req, res) => {
      const counts = await one(
        db,
        `WITH scoped AS (SELECT ep.* FROM clinical.episode ep JOIN registry.enrollment en ON en.id=ep.enrollment_id JOIN core.patient p ON p.id=en.patient_id WHERE p.site_id='demo-kuwait') SELECT (SELECT count(*)::int FROM core.patient WHERE site_id='demo-kuwait') patients,(SELECT count(*)::int FROM scoped WHERE state='draft') drafts,(SELECT count(*)::int FROM scoped WHERE state='final') awaiting_review,(SELECT count(*)::int FROM scoped WHERE state='reviewed') reviewed,(SELECT count(*)::int FROM scoped) episodes`,
      );
      const tasks = (
        await db.query(
          "SELECT t.* FROM workflow.followup_task t JOIN clinical.episode ep ON ep.id=t.episode_id JOIN registry.enrollment en ON en.id=ep.enrollment_id JOIN core.patient p ON p.id=en.patient_id WHERE p.site_id='demo-kuwait'",
        )
      ).rows;
      const states = tasks.map((t: any) => taskState(t));
      const presentations = (
        await db.query(
          "SELECT COALESCE(presentation,'Not recorded') label,count(*)::int count FROM clinical.episode ep JOIN registry.enrollment en ON en.id=ep.enrollment_id JOIN core.patient p ON p.id=en.patient_id WHERE p.site_id='demo-kuwait' GROUP BY presentation ORDER BY count DESC",
        )
      ).rows;
      res.json({
        ...counts,
        open_tasks: states.filter(
          (s) => !["satisfied", "cancelled"].includes(s),
        ).length,
        overdue: states.filter((s) => s === "overdue").length,
        due: states.filter((s) => ["due", "due soon"].includes(s)).length,
        presentations,
        as_of: today(),
      });
    },
  );
  app.post("/api/exports", allow("analyst"), async (req, res) => {
    const { purpose } = z
      .object({
        purpose: z
          .string()
          .trim()
          .min(10, "Describe the purpose in at least 10 characters")
          .max(500),
      })
      .strict()
      .parse(req.body);
    let job: Record<string, unknown> = {};
    await db.transaction(async (tx) => {
      const rows = (
        await tx.query(
          `SELECT en.crf,ep.id,ep.presentation,ep.management,ep.discharge_status,ep.state,ep.form_version,(SELECT count(*) FROM cad.lesion l WHERE l.episode_id=ep.id) lesion_count FROM clinical.episode ep JOIN registry.enrollment en ON en.id=ep.enrollment_id JOIN core.patient p ON p.id=en.patient_id WHERE p.site_id='demo-kuwait' AND ep.state IN ('final','reviewed') ORDER BY en.crf,ep.id`,
        )
      ).rows as Record<string, unknown>[];
      const content = csv([
        [
          "registry_id",
          "episode_id",
          "presentation",
          "management",
          "discharge_status",
          "state",
          "form_version",
          "lesion_count",
        ],
        ...rows.map((r) => Object.values(r)),
      ]);
      const id = randomUUID();
      const checksum = hash(content);
      await tx.query(
        "INSERT INTO governance.export_job(id,actor,purpose,definition_version,row_count,checksum,content) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          res.locals.session.actor,
          purpose,
          "cad.episodes.demo.1",
          rows.length,
          checksum,
          content,
        ],
      );
      await audit(
        tx,
        res.locals.session.actor,
        "Research export generated",
        "export",
        id,
        null,
        {
          purpose,
          rowCount: rows.length,
          checksum,
          definitionVersion: "cad.episodes.demo.1",
        },
      );
      job = {
        id,
        content,
        checksum,
        row_count: rows.length,
        filename: "cardio-flow-cad-episodes.csv",
        codebook: csv([
          ["variable", "definition", "values / missingness"],
          [
            "registry_id",
            "Synthetic registry identifier",
            "Internal linkage identifier; not anonymous",
          ],
          ["episode_id", "Opaque episode UUID", "Internal linkage identifier"],
          [
            "presentation",
            "Recorded CAD presentation",
            "STEMI | NSTEMI | Unstable angina | Chronic coronary syndrome",
          ],
          [
            "management",
            "Recorded management strategy",
            "Medical therapy | PCI | CABG referral",
          ],
          [
            "discharge_status",
            "Recorded discharge disposition",
            "Alive | Died in hospital | Transferred",
          ],
          ["state", "Workflow state", "final | reviewed; drafts excluded"],
          [
            "form_version",
            "Frozen demo form version",
            "1; not clinically approved",
          ],
          [
            "lesion_count",
            "Number of recorded lesion child entities",
            "0 means none recorded",
          ],
        ]),
      };
    });
    res.status(201).json(job);
  });
  mountCare(app, db);
  mountClinicalFoundation(
    app,
    db,
    allow("clinician", "reviewer"),
    allow("clinician"),
  );
  mountClinicalGovernance(
    app,
    db,
    allow("clinician", "reviewer"),
    allow("clinician"),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError)
      return res.status(422).json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (err.code === "23505")
      return res.status(409).json({
        error:
          "This synthetic MRN, civil ID, or enrollment already exists. Search for the existing patient.",
      });
    if (
      err instanceof ApiError ||
      err instanceof CareError ||
      err instanceof FoundationError
    )
      return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON" });
    console.error(err);
    res
      .status(500)
      .json({ error: "Request failed. No partial changes were committed." });
  });
  return app;
}
