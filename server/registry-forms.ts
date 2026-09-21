import { dateSchema } from "./domain.js";
import { randomUUID } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import packages from "./catalog/registry-packages.json" with { type: "json" };
import { type DB, audit, hash } from "./db.js";
import { patient, encounter, CareError } from "./care.js";
import { cleanRegistry, type RegistryPackage } from "../src/registry-forms.js";
const catalog = packages as RegistryPackage[];
export async function initializeRegistryPackages(db: DB) {
  for (const p of catalog) {
    const digest = hash(JSON.stringify(p));
    await db.query(
      "INSERT INTO registry.form_package(registry_key,version,definition,checksum) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [p.key, p.version, JSON.stringify(p), digest],
    );
    const old = (
      await db.query<{ checksum: string }>(
        "SELECT checksum FROM registry.form_package WHERE registry_key=$1 AND version=$2",
        [p.key, p.version],
      )
    ).rows[0];
    if (old.checksum !== digest)
      throw new Error("Registry package changed; publish a new version");
  }
}
const requestSchema = z
  .object({
    registry_key: z.enum(["HF", "CAD", "EP"]),
    package_version: z.number().int().positive(),
    context: z.string(),
    encounter_id: z.string().uuid().nullable(),
    answers: z.record(
      z.string(),
      z.union([
        z.string().max(2000),
        z.number().finite(),
        z.array(z.string()).max(100),
      ]),
    ),
    version: z.number().int().positive().optional(),
  })
  .strict();
export function mountRegistryForms(
  app: Express,
  db: DB,
  read: RequestHandler,
  write: RequestHandler,
) {
  app.get("/api/registry-forms", read, async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT definition FROM registry.form_package ORDER BY registry_key,version DESC",
        )
      ).rows.map((r: any) => r.definition),
    ),
  );
  app.get("/api/patients/:id/registry-forms", read, async (req, res) => {
    const p = await patient(db, String(req.params.id));
    res.json(
      (
        await db.query(
          "SELECT * FROM registry.assessment WHERE patient_id=$1 ORDER BY updated_at DESC",
          [p.id],
        )
      ).rows,
    );
  });
  app.get(
    "/api/patients/:id/registry-forms/:assessmentId/history",
    read,
    async (req, res) => {
      const p = await patient(db, String(req.params.id));
      const old = (
        await db.query(
          "SELECT id FROM registry.assessment WHERE id=$1 AND patient_id=$2",
          [z.string().uuid().parse(req.params.assessmentId), p.id],
        )
      ).rows[0];
      if (!old) throw new CareError(404, "Assessment not found");
      res.json(
        (
          await db.query(
            "SELECT version,payload,actor,created_at FROM registry.assessment_revision WHERE assessment_id=$1 ORDER BY version DESC",
            [req.params.assessmentId],
          )
        ).rows,
      );
    },
  );
  const save: RequestHandler = async (req, res) => {
    const v = requestSchema.parse(req.body),
      id = req.params.assessmentId
        ? z.string().uuid().parse(req.params.assessmentId)
        : null;
    const row = await db.transaction(async (tx) => {
      const p = await patient(tx, String(req.params.id));
      if (v.encounter_id) await encounter(tx, v.encounter_id, p.id);
      const pkg = (
        await tx.query<{ definition: RegistryPackage }>(
          "SELECT definition FROM registry.form_package WHERE registry_key=$1 AND version=$2",
          [v.registry_key, v.package_version],
        )
      ).rows[0]?.definition;
      if (!pkg || !pkg.fields.some((f) => f.context === v.context))
        throw new CareError(422, "Unknown registry form or context");
      for (const [key, value] of Object.entries(v.answers)) {
        const f = pkg.fields.find(
          (f) => f.key === key && f.context === v.context,
        );
        if (!f || f.blocked)
          throw new CareError(422, "Unknown or inactive registry field");
        if (value === "") continue;
        if (f.type === "number" && typeof value !== "number")
          throw new CareError(422, `Check ${f.label}`);
        if (
          f.type === "choice" &&
          (typeof value !== "string" || !f.options.includes(value))
        )
          throw new CareError(422, `Invalid choice: ${f.label}`);
        if (
          f.type === "multi" &&
          (!Array.isArray(value) ||
            value.some((x) => !f.options.includes(x)) ||
            new Set(value).size !== value.length)
        )
          throw new CareError(422, `Invalid selection: ${f.label}`);
        if (
          !["number", "choice", "multi"].includes(f.type) &&
          typeof value !== "string"
        )
          throw new CareError(422, `Check ${f.label}`);
        if (f.type === "date" && !dateSchema.safeParse(value).success)
          throw new CareError(422, `Check date: ${f.label}`);
      }
      const answers = cleanRegistry(pkg, v.answers, v.context);
      let row: any;
      if (id) {
        const old = (
          await tx.query<any>(
            "SELECT * FROM registry.assessment WHERE id=$1 AND patient_id=$2",
            [id, p.id],
          )
        ).rows[0];
        if (!old) throw new CareError(404, "Assessment not found");
        if (old.version !== v.version)
          throw new CareError(409, "Assessment changed. Reload before saving.");
        if (
          old.registry_key !== v.registry_key ||
          old.package_version !== v.package_version ||
          old.context !== v.context ||
          old.encounter_id !== v.encounter_id
        )
          throw new CareError(
            422,
            "Assessment origin is retained; create a new assessment for another context",
          );
        row = (
          await tx.query(
            "UPDATE registry.assessment SET answers=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3 AND version=$4 RETURNING *",
            [JSON.stringify(answers), res.locals.session.actor, id, v.version],
          )
        ).rows[0];
        if (!row)
          throw new CareError(409, "Assessment changed. Reload before saving.");
      } else
        row = (
          await tx.query(
            "INSERT INTO registry.assessment(id,patient_id,registry_key,package_version,context,encounter_id,answers,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
            [
              randomUUID(),
              p.id,
              v.registry_key,
              v.package_version,
              v.context,
              v.encounter_id,
              JSON.stringify(answers),
              res.locals.session.actor,
            ],
          )
        ).rows[0];
      await tx.query(
        "INSERT INTO registry.assessment_revision(id,assessment_id,version,payload,actor) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          row.id,
          row.version,
          JSON.stringify(row),
          res.locals.session.actor,
        ],
      );
      await audit(
        tx,
        res.locals.session.actor,
        "Source registry draft saved",
        "registry_assessment",
        row.id,
        p.id,
        {
          registry: v.registry_key,
          package_version: v.package_version,
          version: row.version,
        },
      );
      return row;
    });
    res.status(id ? 200 : 201).json(row);
  };
  app.post("/api/patients/:id/registry-forms", write, save);
  app.put("/api/patients/:id/registry-forms/:assessmentId", write, save);
}
