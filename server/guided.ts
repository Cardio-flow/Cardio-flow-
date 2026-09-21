import {
  rcriPreview,
  apixabanPreview,
  rcriSource,
  apixabanSource,
} from "../src/clinical-review.js";
import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB, QueryDB } from "./db.js";
import {
  CareError,
  entrySchema,
  patient,
  encounter,
  record,
  revision,
} from "./care.js";
import { historicalDate, dateSchema } from "./domain.js";
import {
  templateByKey,
  catalogVersion,
  cleanAnswers,
  answerSummary,
  type Answers,
  type Template,
} from "../src/guided.js";

const inputSchema = z
  .object({
    template_key: z.string(),
    answers: z.record(
      z.string(),
      z.union([
        z.string().max(2000),
        z.number().finite(),
        z.array(z.string()).max(40),
      ]),
    ),
    status: z.string(),
    encounter_id: z.string().uuid().nullable(),
    occurred_on: historicalDate,
    due_date: dateSchema.nullable(),
    owner: z.string().trim().min(2).max(300),
    note: z.string().trim().max(2000).default(""),
    version: z.number().int().positive().optional(),
    action_note: z.string().trim().max(2000).default(""),
    response_note: z.string().trim().max(2000).default(""),
  })
  .strict();
export function validateAnswers(t: Template, answers: Answers): Answers {
  for (const [key, value] of Object.entries(answers)) {
    const f = t.fields.find((f) => f.key === key);
    if (!f) throw new CareError(422, `Unknown field: ${key}`);
    if (value === "") continue;
    if (
      f.type === "number" &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < (f.min ?? -Infinity) ||
        value > (f.max ?? Infinity))
    )
      throw new CareError(422, `Check ${f.label}`);
    if (
      f.type === "choice" &&
      (typeof value !== "string" || !f.options?.includes(value))
    )
      throw new CareError(422, `Invalid choice for ${f.label}`);
    if (
      f.type === "multi" &&
      (!Array.isArray(value) ||
        value.some((v) => !f.options?.includes(v)) ||
        new Set(value).size !== value.length)
    )
      throw new CareError(422, `Invalid selections for ${f.label}`);
    if (f.type === "text" && typeof value !== "string")
      throw new CareError(422, `Invalid text for ${f.label}`);
    if (
      Array.isArray(value) &&
      value.length > 1 &&
      value.some(
        (v) =>
          v.startsWith("No symptoms") ||
          v === "None recorded" ||
          v === "No acute changes documented",
      )
    )
      throw new CareError(
        422,
        `${f.label}: absence cannot be selected with a finding`,
      );
  }
  const clean = cleanAnswers(t, answers);
  for (const [key, unitKey] of [
    ["creatinine", "creatinine_unit"],
    ["value", "unit"],
  ]) {
    if (
      typeof clean[key] === "number" &&
      t.fields.some((f) => f.key === unitKey) &&
      !clean[unitKey]
    )
      throw new CareError(422, "A numerical result needs its unit");
  }
  if (
    (clean.creatinine_unit === "mg/dL" && Number(clean.creatinine) > 35) ||
    (t.key === "investigation.creatinine" &&
      clean.unit === "mg/dL" &&
      Number(clean.value) > 35) ||
    (t.key === "investigation.haemoglobin" &&
      clean.unit === "g/dL" &&
      Number(clean.value) > 25)
  )
    throw new CareError(422, "Check the result and selected unit");
  return clean;
}
function prepare(raw: unknown) {
  const input = inputSchema.parse(raw),
    t = templateByKey.get(input.template_key);
  if (!t) throw new CareError(422, "Unknown guided form");
  const answers = validateAnswers(t, input.answers);
  if (
    t.kind === "problem" &&
    input.status === "active" &&
    answers.certainty !== "Confirmed"
  )
    throw new CareError(
      422,
      "An active diagnosis requires confirmed diagnostic certainty; use suspected while assessing",
    );
  const string = (key: string) =>
    Array.isArray(answers[key])
      ? (answers[key] as string[]).join("; ")
      : String(answers[key] ?? "");
  const details: Record<string, string> = {};
  if (t.kind === "medication")
    Object.assign(details, {
      dose: [string("dose"), string("frequency"), string("route")]
        .filter(Boolean)
        .join(" · "),
      indication: string("indication"),
      reason: string("decision_reason"),
      monitoring: string("monitoring"),
    });
  if (t.kind === "investigation")
    Object.assign(details, {
      value: answers.value !== undefined ? string("value") : string("rhythm"),
      unit: string("unit"),
      interpretation: string("interpretation"),
    });
  if (
    t.kind === "investigation" &&
    input.status === "reviewed" &&
    (!answers.interpretation || string("interpretation").startsWith("Not yet"))
  )
    throw new CareError(
      422,
      "Select the documented clinical interpretation before marking reviewed",
    );
  const action = [string("management"), input.action_note]
    .filter(Boolean)
    .join("\n");
  const response = [
    string("clinical_response"),
    string("next_steps"),
    input.response_note,
  ]
    .filter(Boolean)
    .join("\n");
  if (
    t.kind === "complication" &&
    input.status === "resolved" &&
    answers.clinical_response !== "Resolved"
  )
    throw new CareError(
      422,
      "Record a resolved response before closing the complication",
    );
  const value = entrySchema.parse({
    kind: t.kind,
    family: t.family,
    title: t.label,
    status: input.status,
    encounter_id: input.encounter_id,
    occurred_on: input.occurred_on,
    owner: input.owner,
    due_date: input.due_date,
    assessment: [answerSummary(t, answers), input.note]
      .filter(Boolean)
      .join("\n"),
    action,
    response,
    details,
  });
  return { input, t, answers, value };
}
async function checkOrigin(
  tx: QueryDB,
  p: any,
  input: ReturnType<typeof prepare>["input"],
) {
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
        "Record date must fall within the selected encounter",
      );
  }
}
function reviewSnapshot(t: Template, answers: Answers, p: any, on: string) {
  const result =
    t.key === "procedure.noncardiac_surgery"
      ? rcriPreview(answers, p.birth_date, on)
      : t.key === "medication.apixaban"
        ? apixabanPreview(answers, p.birth_date, on)
        : null;
  return result
    ? {
        _reference: JSON.stringify({
          status: "draft-synthetic-only",
          ruleVersion:
            t.key === "procedure.noncardiac_surgery"
              ? "rcri-1999.1"
              : "apixaban-nvaf-label-2025.1",
          source:
            t.key === "procedure.noncardiac_surgery"
              ? rcriSource
              : apixabanSource,
          assessedOn: on,
          birthDate: p.birth_date,
          ...result,
        }),
      }
    : {};
}
export function mountGuided(
  app: Express,
  db: DB,
  read: RequestHandler,
  write: RequestHandler,
) {
  app.post("/api/patients/:id/care/guided", write, async (req, res) => {
    const request = z
      .object({ entries: z.array(z.unknown()).min(1).max(20) })
      .strict()
      .parse(req.body);
    const prepared = request.entries.map(prepare);
    if (new Set(prepared.map((p) => p.t.key)).size !== prepared.length)
      throw new CareError(422, "Select each form only once per save");
    const rows = await db.transaction(async (tx) => {
      const p = await patient(tx, String(req.params.id)),
        result = [];
      for (const { input, t, answers, value: v } of prepared) {
        await checkOrigin(tx, p, input);
        const row = (
          await tx.query<any>(
            "INSERT INTO care.entry(id,patient_id,encounter_id,kind,family,title,status,occurred_on,owner,due_date,assessment,action,response,details,updated_by,template_key,template_version,structured) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *",
            [
              randomUUID(),
              p.id,
              v.encounter_id,
              v.kind,
              v.family,
              v.title,
              v.status,
              v.occurred_on,
              v.owner,
              v.due_date,
              v.assessment,
              v.action,
              v.response,
              JSON.stringify(v.details),
              res.locals.session.actor,
              t.key,
              catalogVersion,
              JSON.stringify({
                ...answers,
                _note: input.note,
                _action: input.action_note,
                _response: input.response_note,
                ...reviewSnapshot(t, answers, p, input.occurred_on),
              }),
            ],
          )
        ).rows[0];
        await revision(tx, row, res.locals.session.actor);
        result.push(row);
      }
      return result;
    });
    res.status(201).json(rows);
  });
  app.put("/api/care/guided/:id", write, async (req, res) => {
    const { input, t, answers, value: v } = prepare(req.body);
    if (!input.version) throw new CareError(422, "Record version required");
    const row = await db.transaction(async (tx) => {
      const old = await record(tx, String(req.params.id));
      const p = await patient(tx, old.patient_id);
      if (old.template_version !== catalogVersion)
        throw new CareError(
          422,
          "This form uses an older catalog. A reviewed migration is required.",
        );
      if (old.version !== input.version)
        throw new CareError(409, "This record changed. Reload before saving.");
      if (
        old.template_key !== t.key ||
        old.encounter_id !== input.encounter_id ||
        old.occurred_on !== input.occurred_on
      )
        throw new CareError(
          422,
          "Form and origin are retained; add a new event for a different context",
        );
      const row = (
        await tx.query<any>(
          "UPDATE care.entry SET status=$1,owner=$2,due_date=$3,assessment=$4,action=$5,response=$6,details=$7,structured=$8,version=version+1,updated_by=$9,updated_at=now() WHERE id=$10 AND version=$11 RETURNING *",
          [
            v.status,
            v.owner,
            v.due_date,
            v.assessment,
            v.action,
            v.response,
            JSON.stringify(v.details),
            JSON.stringify({
              ...answers,
              _note: input.note,
              _action: input.action_note,
              _response: input.response_note,
              ...reviewSnapshot(t, answers, p, input.occurred_on),
            }),
            res.locals.session.actor,
            old.id,
            input.version,
          ],
        )
      ).rows[0];
      if (!row)
        throw new CareError(409, "This record changed. Reload before saving.");
      await revision(tx, row, res.locals.session.actor);
      return row;
    });
    res.json(row);
  });
}
