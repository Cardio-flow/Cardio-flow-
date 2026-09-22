import { initializeRegistryPackages } from "./registry-forms.js";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { cadDefinition, addMonths, addDays, today } from "./domain.js";
import { seedCare } from "./seed-care.js";
import {
  initializeClinicalFoundation,
  synchronizeCareFacts,
} from "./clinical-foundation.js";
import { initializeClinicalGovernance } from "./clinical-governance.js";
export interface QueryDB {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface DB extends QueryDB {
  transaction<T>(callback: (tx: QueryDB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function createDb(path?: string, seed = true) {
  const db = new PGlite({
    dataDir: path,
    parsers: { 1082: (value: string) => value },
  });
  await db.waitReady;
  await db.exec(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(new URL("./care-schema.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(new URL("./guided-schema.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(
      new URL("./clinical-foundation-schema.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("./clinical-governance-schema.sql", import.meta.url),
      "utf8",
    ),
  );
  await initializeData(db, seed);
  return db;
}
export async function initializeData(db: DB, seed = true) {
  await initializeRegistryPackages(db);
  await initializeClinicalFoundation(db);
  await initializeClinicalGovernance(db);
  await db.query(
    "INSERT INTO registry.definition VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    [
      "CAD",
      1,
      cadDefinition.name,
      JSON.stringify(cadDefinition),
      hash(JSON.stringify(cadDefinition)),
    ],
  );
  if (
    seed &&
    !(await db.query("SELECT id FROM core.patient LIMIT 1")).rows.length
  )
    await seedDemo(db);
  if (seed) await seedCare(db);
  await synchronizeCareFacts(db);
}
export async function audit(
  db: Pick<DB, "query">,
  actor: string,
  action: string,
  entity: string,
  id: string,
  patient: string | null = null,
  detail: unknown = {},
) {
  await db.query(
    "INSERT INTO governance.audit_event(id,actor,action,entity_type,entity_id,patient_id,detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), actor, action, entity, id, patient, JSON.stringify(detail)],
  );
}
async function seedDemo(db: DB) {
  const names = [
    "Amal Sample",
    "Omar Sample",
    "Layla Sample",
    "Yousef Sample",
    "Noura Sample",
    "Khalid Sample",
    "Sara Sample",
    "Faisal Sample",
  ];
  await db.transaction(async (tx) => {
    for (let i = 0; i < names.length; i++) {
      const patient = randomUUID(),
        enrollment = randomUUID(),
        episode = randomUUID();
      const admission = addDays(today(), -[39, 7, 99, 3, 188, 29, 12, 65][i]);
      const state = i % 3 === 0 ? "draft" : i % 3 === 1 ? "final" : "reviewed";
      await tx.query(
        "INSERT INTO core.patient(id,name,mrn,sex,birth_date,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          patient,
          names[i],
          `SYN-${String(i + 1).padStart(4, "0")}`,
          i % 2 === 0 ? "Female" : "Male",
          `${1958 + i * 3}-04-12`,
          "demo:seed",
        ],
      );
      await tx.query(
        "INSERT INTO registry.enrollment(id,patient_id,registry_key,definition_version) VALUES($1,$2,$3,$4)",
        [enrollment, patient, "CAD", 1],
      );
      await tx.query(
        "INSERT INTO clinical.episode(id,enrollment_id,admission_date,discharge_date,presentation,access_site,management,discharge_status,state,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",
        [
          episode,
          enrollment,
          admission,
          state === "draft" ? null : addDays(admission, 2),
          ["NSTEMI", "STEMI", "Chronic coronary syndrome", "Unstable angina"][
            i % 4
          ],
          state === "draft" ? null : "Radial",
          state === "draft" ? null : "PCI",
          state === "draft" ? null : "Alive",
          state,
          "demo:seed",
        ],
      );
      if (state !== "draft") {
        const lesion = randomUUID();
        await tx.query("INSERT INTO cad.lesion VALUES($1,$2,$3,$4,$5,$6)", [
          lesion,
          episode,
          "LAD",
          "Proximal",
          80,
          "PCI",
        ]);
        await tx.query("INSERT INTO cad.stent VALUES($1,$2,$3,$4,$5)", [
          randomUUID(),
          lesion,
          3,
          24,
          "DES",
        ]);
        for (const month of [1, 3, 6, 12]) {
          const due = addMonths(admission, month);
          await tx.query(
            "INSERT INTO workflow.followup_task(id,episode_id,milestone,protocol_version,anchor_date,due_date,window_start,window_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              randomUUID(),
              episode,
              month,
              "cad.demo.1",
              admission,
              due,
              addDays(due, -7),
              addDays(due, 14),
            ],
          );
        }
        const payload = await tx.query<Record<string, unknown>>(
          "SELECT * FROM clinical.episode WHERE id=$1",
          [episode],
        );
        const lesions = await tx.query(
          "SELECT l.*, (SELECT json_agg(s) FROM cad.stent s WHERE s.lesion_id=l.id) AS stents FROM cad.lesion l WHERE episode_id=$1",
          [episode],
        );
        await tx.query(
          "INSERT INTO governance.record_snapshot(id,episode_id,version,payload) VALUES($1,$2,$3,$4)",
          [
            randomUUID(),
            episode,
            1,
            JSON.stringify({ ...payload.rows[0], lesions: lesions.rows }),
          ],
        );
      }
      await audit(
        tx,
        "demo:seed",
        "Synthetic case initialized",
        "episode",
        episode,
        patient,
        { synthetic: true },
      );
    }
  });
}
