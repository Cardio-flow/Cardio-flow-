import {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, type QueryDB, audit } from "./db.js";
import { historicalDate, dateSchema } from "./domain.js";
import {
  careKinds,
  families,
  finished,
  needsReview,
  type CareEntry,
} from "../src/care-model.js";

export class CareError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const uuid = z.string().uuid();
const note = z.string().trim().max(6000);
const required = z.string().trim().min(2).max(300);
const entrySchema = z
  .object({
    kind: z.enum([
      "problem",
      "decision",
      "investigation",
      "medication",
      "procedure",
      "complication",
    ]),
    encounter_id: uuid.nullable(),
    family: z.enum(families),
    title: required,
    status: z.string(),
    occurred_on: historicalDate,
    owner: required,
    due_date: dateSchema.nullable(),
    assessment: note,
    action: note,
    response: note,
    details: z.record(z.string(), note),
    version: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const definition = careKinds[v.kind];
    if (!(definition.states as readonly string[]).includes(v.status))
      ctx.addIssue({
        code: "custom",
        message: "Invalid status for this record",
        path: ["status"],
      });
    for (const key of Object.keys(v.details))
      if (!(key in definition.fields))
        ctx.addIssue({
          code: "custom",
          message: "Unknown detail field",
          path: ["details", key],
        });
    if (needsReview(v) && !v.due_date)
      ctx.addIssue({
        code: "custom",
        message: "An outstanding action needs a review date",
        path: ["due_date"],
      });
    if (
      v.kind === "medication" &&
      v.status === "held" &&
      (!v.due_date || !v.details.reason)
    )
      ctx.addIssue({
        code: "custom",
        message: "A held medication needs a reason and review date",
      });
    if (
      ["deferred", "cancelled", "excluded", "discontinued"].includes(
        v.status,
      ) &&
      !v.action
    )
      ctx.addIssue({
        code: "custom",
        message: "Document the decision and reason",
        path: ["action"],
      });
    if (
      ["completed", "resolved", "reviewed"].includes(v.status) &&
      (!v.action || !v.response)
    )
      ctx.addIssue({
        code: "custom",
        message: "Document the action and response before closing the loop",
      });
    if (
      v.kind === "investigation" &&
      ["resulted", "reviewed"].includes(v.status) &&
      !v.details.value
    )
      ctx.addIssue({
        code: "custom",
        message: "Enter the investigation result",
      });
    if (
      v.kind === "investigation" &&
      v.status === "reviewed" &&
      !v.details.interpretation
    )
      ctx.addIssue({
        code: "custom",
        message: "Document the clinical interpretation",
      });
  });
const one = async (db: QueryDB, sql: string, params: unknown[]) =>
  (await db.query<any>(sql, params)).rows[0];
async function patient(db: QueryDB, id: string) {
  const p = await one(
    db,
    "SELECT * FROM core.patient WHERE id=$1 AND site_id='demo-kuwait'",
    [uuid.parse(id)],
  );
  if (!p) throw new CareError(404, "Patient not found");
  return p;
}
async function encounter(db: QueryDB, id: string, patientId: string) {
  const row = await one(
    db,
    "SELECT * FROM care.encounter WHERE id=$1 AND patient_id=$2",
    [uuid.parse(id), patientId],
  );
  if (!row) throw new CareError(404, "Encounter not found for this patient");
  return row;
}
async function record(db: QueryDB, id: string) {
  const row = await one(
    db,
    "SELECT e.* FROM care.entry e JOIN core.patient p ON p.id=e.patient_id WHERE e.id=$1 AND p.site_id='demo-kuwait'",
    [uuid.parse(id)],
  );
  if (!row) throw new CareError(404, "Record not found");
  return row;
}
async function revision(db: QueryDB, row: CareEntry, actor: string) {
  await db.query(
    "INSERT INTO care.revision(id,entry_id,version,payload,actor) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), row.id, row.version, JSON.stringify(row), actor],
  );
  await audit(
    db,
    actor,
    "Care record saved",
    "care_entry",
    row.id,
    row.patient_id,
    { kind: row.kind, status: row.status, version: row.version },
  );
}
export function mountCare(app: Express, db: DB) {
  const read = (_req: Request, res: Response, next: NextFunction) => {
    if (!["clinician", "reviewer"].includes(res.locals.session.role))
      return res.status(403).json({ error: "Clinical access required" });
    next();
  };
  const write = (_req: Request, res: Response, next: NextFunction) => {
    if (res.locals.session.role !== "clinician")
      return res.status(403).json({ error: "Clinician access required" });
    next();
  };
  app.get("/api/care/board", read, async (_req, res) => {
    const [entries, encounters] = await Promise.all([
      db.query<CareEntry>(
        "SELECT e.*,p.name,p.mrn FROM care.entry e JOIN core.patient p ON p.id=e.patient_id WHERE p.site_id='demo-kuwait' ORDER BY e.due_date NULLS LAST,e.updated_at DESC",
      ),
      db.query(
        "SELECT e.*,p.name,p.mrn FROM care.encounter e JOIN core.patient p ON p.id=e.patient_id WHERE p.site_id='demo-kuwait' ORDER BY e.started_on DESC,e.created_at DESC",
      ),
    ]);
    res.json({
      entries: entries.rows.filter(needsReview),
      encounters: encounters.rows,
    });
  });
  app.get("/api/patients/:id/care", read, async (req, res) => {
    const p = await patient(db, String(req.params.id));
    const [entries, encounters] = await Promise.all([
      db.query(
        "SELECT * FROM care.entry WHERE patient_id=$1 ORDER BY occurred_on DESC,updated_at DESC",
        [p.id],
      ),
      db.query(
        "SELECT * FROM care.encounter WHERE patient_id=$1 ORDER BY started_on DESC,created_at DESC",
        [p.id],
      ),
    ]);
    res.json({
      patient: p,
      entries: entries.rows,
      encounters: encounters.rows,
    });
  });
  app.post("/api/patients/:id/care/encounters", write, async (req, res) => {
    const input = z
      .object({
        kind: z.enum(["Admission", "OPD"]),
        started_on: historicalDate,
        reason: required,
        owner: required,
        linked_encounter_id: uuid.nullable(),
      })
      .strict()
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const p = await patient(tx, String(req.params.id));
      if (input.started_on < p.birth_date)
        throw new CareError(422, "Encounter cannot precede birth date");
      if (input.linked_encounter_id) {
        const linked = await encounter(tx, input.linked_encounter_id, p.id);
        if (linked.started_on > input.started_on)
          throw new CareError(
            422,
            "A linked encounter cannot start after this encounter",
          );
      }
      const e = await one(
        tx,
        "INSERT INTO care.encounter(id,patient_id,kind,started_on,reason,owner,linked_encounter_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          randomUUID(),
          p.id,
          input.kind,
          input.started_on,
          input.reason,
          input.owner,
          input.linked_encounter_id,
          res.locals.session.actor,
        ],
      );
      await audit(
        tx,
        res.locals.session.actor,
        "Care encounter opened",
        "care_encounter",
        e.id,
        p.id,
        { kind: e.kind, linked_encounter_id: e.linked_encounter_id },
      );
      return e;
    });
    res.status(201).json(row);
  });
  app.post(
    "/api/patients/:id/care/encounters/:encounterId/close",
    write,
    async (req, res) => {
      const input = z
        .object({
          version: z.number().int().positive(),
          closed_on: historicalDate,
          summary: note.min(10),
        })
        .strict()
        .parse(req.body);
      const row = await db.transaction(async (tx) => {
        const p = await patient(tx, String(req.params.id));
        const e = await encounter(tx, String(req.params.encounterId), p.id);
        if (e.state !== "open" || e.version !== input.version)
          throw new CareError(
            409,
            "Encounter changed or already closed. Reload before continuing.",
          );
        if (input.closed_on < e.started_on)
          throw new CareError(422, "Closure cannot precede the encounter");
        const updated = await one(
          tx,
          "UPDATE care.encounter SET state='closed',closed_on=$1,summary=$2,version=version+1 WHERE id=$3 AND version=$4 AND state='open' RETURNING *",
          [input.closed_on, input.summary, e.id, input.version],
        );
        if (!updated)
          throw new CareError(
            409,
            "Encounter changed. Reload before continuing.",
          );
        // Closing the encounter deliberately does not close the patient's ongoing entries.
        await audit(
          tx,
          res.locals.session.actor,
          "Care encounter closed; continuing plan retained",
          "care_encounter",
          e.id,
          p.id,
          { ...input },
        );
        return updated;
      });
      res.json(row);
    },
  );
  app.post("/api/patients/:id/care/entries", write, async (req, res) => {
    const input = entrySchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const p = await patient(tx, String(req.params.id));
      if (input.occurred_on < p.birth_date)
        throw new CareError(422, "Record cannot precede birth date");
      if (input.encounter_id) {
        const e = await encounter(tx, input.encounter_id, p.id);
        if (
          input.occurred_on < e.started_on ||
          (e.closed_on && input.occurred_on > e.closed_on)
        )
          throw new CareError(
            422,
            "Record date must fall within the linked encounter; use the continuing plan for later events",
          );
      }
      const row = await one(
        tx,
        "INSERT INTO care.entry(id,patient_id,encounter_id,kind,family,title,status,occurred_on,owner,due_date,assessment,action,response,details,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
        [
          randomUUID(),
          p.id,
          input.encounter_id,
          input.kind,
          input.family,
          input.title,
          input.status,
          input.occurred_on,
          input.owner,
          input.due_date,
          input.assessment,
          input.action,
          input.response,
          JSON.stringify(input.details),
          res.locals.session.actor,
        ],
      );
      await revision(tx, row, res.locals.session.actor);
      return row;
    });
    res.status(201).json(row);
  });
  app.put("/api/care/entries/:id", write, async (req, res) => {
    const input = entrySchema.parse(req.body);
    if (!input.version) throw new CareError(422, "Record version required");
    const row = await db.transaction(async (tx) => {
      const previous = await record(tx, String(req.params.id));
      if (previous.version !== input.version)
        throw new CareError(409, "This record changed. Reload before saving.");
      if (
        previous.kind !== input.kind ||
        previous.encounter_id !== input.encounter_id ||
        previous.occurred_on !== input.occurred_on
      )
        throw new CareError(
          422,
          "Record type, origin encounter and event date are retained; add a new event for a different encounter",
        );
      const row = await one(
        tx,
        "UPDATE care.entry SET family=$1,title=$2,status=$3,owner=$4,due_date=$5,assessment=$6,action=$7,response=$8,details=$9,version=version+1,updated_by=$10,updated_at=now() WHERE id=$11 AND version=$12 RETURNING *",
        [
          input.family,
          input.title,
          input.status,
          input.owner,
          input.due_date,
          input.assessment,
          input.action,
          input.response,
          JSON.stringify(input.details),
          res.locals.session.actor,
          previous.id,
          input.version,
        ],
      );
      if (!row)
        throw new CareError(409, "This record changed. Reload before saving.");
      await revision(tx, row, res.locals.session.actor);
      return row;
    });
    res.json(row);
  });
  app.get("/api/care/entries/:id/history", read, async (req, res) => {
    const row = await record(db, String(req.params.id));
    res.json(
      (
        await db.query(
          "SELECT version,payload,actor,created_at FROM care.revision WHERE entry_id=$1 ORDER BY version DESC",
          [row.id],
        )
      ).rows,
    );
  });
  app.post("/api/patients/:id/enroll", write, async (req, res) => {
    z.object({ registry: z.literal("CAD") })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const p = await patient(tx, String(req.params.id));
      const row = await one(
        tx,
        "INSERT INTO registry.enrollment(id,patient_id,registry_key,definition_version) VALUES($1,$2,'CAD',1) RETURNING *",
        [randomUUID(), p.id],
      );
      await audit(
        tx,
        res.locals.session.actor,
        "Registry enrollment selected",
        "enrollment",
        row.id,
        p.id,
        { registry: "CAD", definitionVersion: 1 },
      );
      return row;
    });
    res.status(201).json(result);
  });
}
