import { z } from "zod";
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid calendar date",
  );
export const historicalDate = dateSchema.refine(
  (v) => v <= today(),
  "Date cannot be in the future",
);
export const patientSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    mrn: z
      .string()
      .trim()
      .regex(/^SYN-[A-Z0-9-]{3,30}$/, "Use a synthetic MRN beginning SYN-"),
    sex: z.enum(["Female", "Male", "Unknown"]),
    birth_date: historicalDate.refine(
      (v) => v >= "1900-01-01",
      "Date must be 1900 or later",
    ),
  })
  .strict();
export const stentSchema = z
  .object({
    diameter: z.number().positive().max(20),
    length: z.number().positive().max(200),
    type: z.enum(["DES", "BMS", "Other"]),
  })
  .strict();
export const lesionSchema = z
  .object({
    vessel: z.enum(["LM", "LAD", "LCx", "RCA", "Graft"]),
    segment: z.enum(["Proximal", "Mid", "Distal", "Other"]),
    stenosis: z.number().min(0).max(100),
    treatment: z.enum(["Medical therapy", "PCI", "CABG referral"]),
    stents: z.array(stentSchema).max(20),
  })
  .strict()
  .refine(
    (v) => v.treatment === "PCI" || v.stents.length === 0,
    "Stents require PCI treatment",
  );
export const episodeSchema = z
  .object({
    version: z.number().int().positive(),
    admission_date: historicalDate,
    discharge_date: historicalDate.nullable(),
    presentation: z
      .enum(["STEMI", "NSTEMI", "Unstable angina", "Chronic coronary syndrome"])
      .nullable(),
    access_site: z
      .enum(["Radial", "Femoral", "Other", "Not performed"])
      .nullable(),
    management: z.enum(["Medical therapy", "PCI", "CABG referral"]).nullable(),
    discharge_status: z
      .enum(["Alive", "Died in hospital", "Transferred"])
      .nullable(),
    lesions: z.array(lesionSchema).max(50),
  })
  .strict()
  .refine(
    (v) => !v.discharge_date || v.discharge_date >= v.admission_date,
    "Discharge cannot precede admission",
  );
export function addMonths(anchor: string, months: number) {
  const d = new Date(anchor + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function addDays(anchor: string, days: number) {
  const d = new Date(anchor + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function taskState(
  task: { state: string; due_date: string; window_end: string },
  asOf = today(),
) {
  if (task.state !== "scheduled") return task.state;
  if (asOf > task.window_end) return "overdue";
  if (asOf >= task.due_date) return "due";
  if (asOf >= addDays(task.due_date, -7)) return "due soon";
  return "scheduled";
}
export const cadDefinition = {
  key: "CAD",
  version: 1,
  name: "Coronary artery disease",
  status: "Sandbox template",
  clinicalApproval: "Pending — synthetic demonstration only",
  layers: [
    "Locked cardiovascular core",
    "CAD module template",
    "Site extensions (planned)",
  ],
  sections: [
    {
      key: "presentation",
      name: "Presentation",
      fields: [
        {
          key: "presentation",
          label: "Presentation type",
          required: true,
          options: [
            "STEMI",
            "NSTEMI",
            "Unstable angina",
            "Chronic coronary syndrome",
          ],
        },
        { key: "admission_date", label: "Index admission", required: true },
      ],
    },
    {
      key: "angiography",
      name: "Angiography & intervention",
      fields: [
        {
          key: "access_site",
          label: "Access site",
          required: true,
          options: ["Radial", "Femoral", "Other", "Not performed"],
        },
        {
          key: "management",
          label: "Management strategy",
          required: true,
          options: ["Medical therapy", "PCI", "CABG referral"],
        },
      ],
    },
    {
      key: "discharge",
      name: "Discharge",
      fields: [
        { key: "discharge_date", label: "Discharge date", required: true },
        {
          key: "discharge_status",
          label: "Discharge status",
          required: true,
          options: ["Alive", "Died in hospital", "Transferred"],
        },
      ],
    },
  ],
  protocol: {
    version: "cad.demo.1",
    anchor: "Index admission",
    months: [1, 3, 6, 12],
    earlyDays: 7,
    lateDays: 14,
    contacts: ["Clinic", "Telephone"],
    required: ["vital_status", "rehospitalized"],
    approval: "Demo windows only; local clinical approval required",
  },
  references: ["Cardio Flow implementation blueprint v0.2, sections 8–9"],
};
export function csv(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let s = cell == null ? "" : String(cell);
          if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
