// The three registries as a whole (10 Nov 2026, phase 4): who is eligible and who is enrolled, the codebook of
// every registry variable, the data in the registry's wording and in its SPSS codes, an SPSS syntax file that
// reads the coded data with variable and value labels, and descriptive statistics (baseline table by group,
// Kaplan–Meier outcomes with log-rank). Every clinical value is read from the record through the existing
// projections (hf-registry.ts, cad-registry.ts, eps-registry.ts); the only stored fact is the enrolment itself
// (cf.registry_event). Variable types and codes come from the registries' own sources (registry-schema.ts,
// CODES in eps-registry.ts). Nothing is sent to a registry.
import type { Q } from "../db/db.js";
import { daysBetween, localDay } from "../../shared/clinical.js";
import { isHfAdmission } from "../../shared/encounters.js";
import { compareCounts, kaplanMeier, logRank, mean, median, quantile, sd, survivalAt, welchAnova, type SurvivalCase, type TestResult } from "../../shared/stats.js";
import { loadState, type PatientState } from "../kernel/state.js";
import { ApiError, audit, patientInSite, today, uuid, type Actor } from "../kernel/base.js";
import { HF_REGISTRY, hfRegistryProjection } from "./hf-registry.js";
import { CAD_REGISTRY, cadIndex, cadRegistryProjection } from "./cad-registry.js";
import { CODES as EPS_CODES, EPS_REGISTRY, epsIndex, epsRegistryProjection } from "./eps-registry.js";
import { CAD_VARS, EPS_DATE, EPS_NUMERIC, EPS_TIME, HF_VARS, type VarType } from "./registry-schema.js";

export type RegId = "hf" | "cad" | "eps";
export const REG_IDS: RegId[] = ["hf", "cad", "eps"];

type ProjField = { key: string; label: string; mapped: boolean; value: string | null };
type Projection = { sections: { title: string; fields: ProjField[] }[]; counts: { mapped: number; filled: number } ; index?: string };
type Outcome = { key: string; label: string; event(s: PatientState, index: string): string | null };

const day = (iso: string) => localDay(iso);
const died = (s: PatientState) => (s.status.vital?.status === "died" ? s.status.vital.effective_on.slice(0, 10) : null);
const firstAdmissionAfter = (s: PatientState, after: string, hf: boolean) =>
  s.contexts.filter((c) => c.kind === "admission" && day(c.started_at) > after && (!hf || isHfAdmission(c as any))).map((c) => day(c.started_at)).sort()[0] ?? null;
const earliest = (...d: (string | null)[]) => d.filter((x): x is string => !!x).sort()[0] ?? null;
// the HF index date: the earliest evidence of heart failure in the record — a dated diagnosis (onset, else the onset
// year), the first HF admission or the first LVEF; the day the diagnosis was entered only when nothing else is dated
const hfIndex = (s: PatientState) => {
  const c = s.conditions.filter((c) => ["hfref", "hfmref", "hfpef", "hfimpef"].includes(c.code) && c.status !== "entered_in_error");
  if (!c.length) return null;
  const dated = earliest(
    ...c.map((x) => (x.onset ? day(x.onset) : x.attributes?.onsetYear ? `${x.attributes.onsetYear}-01-01` : null)),
    ...s.contexts.filter((x) => x.kind === "admission" && isHfAdmission(x as any)).map((x) => day(x.started_at)),
    ...s.resolved("lvef").history.filter((o) => o.status !== "entered_in_error").map((o) => day(o.effective_at)),
  );
  return dated ?? earliest(...c.map((x) => day(x.recorded_at)));
};
const afterIndexStay = (s: PatientState, x: { at: string; dischargeDay: string | null } | null) => (x ? x.dischargeDay ?? x.at : null);

const DEFS: Record<RegId, {
  name: string;
  sections: { title: string; fields: { key: string; label: string; get?: unknown }[] }[];
  project(s: PatientState): Projection | null;
  groupKey: string;
  groupLabel: string;
  group(v: Record<string, string | null>): string;
  indexDate(s: PatientState): string | null;
  indexLabel: string;
  outcomes: Outcome[];
  eligibleSql: string;
}> = {
  hf: {
    name: "Heart Failure Registry",
    sections: HF_REGISTRY,
    project: (s) => hfRegistryProjection(s),
    groupKey: "HF_Type",
    groupLabel: "HF type",
    group: (v) => (v.HF_Type === "Others" ? "HF improved LVEF" : v.HF_Type ?? "Not recorded"),
    indexDate: hfIndex,
    indexLabel: "HF diagnosis",
    outcomes: [
      { key: "death", label: "All-cause death", event: (s) => died(s) },
      { key: "hfh_death", label: "HF hospitalisation or death", event: (s, i) => earliest(firstAdmissionAfter(s, i, true), died(s)) },
    ],
    eligibleSql: `SELECT DISTINCT p.id FROM cf.patient p JOIN cf.condition c ON c.patient_id=p.id WHERE p.site_id=$1 AND p.removed_at IS NULL AND p.synthetic=$2 AND c.code = ANY(ARRAY['hfref','hfmref','hfpef','hfimpef'])`,
  },
  cad: {
    name: "CAD Registry",
    sections: CAD_REGISTRY,
    project: (s) => cadRegistryProjection(s),
    groupKey: "Presentation_Type",
    groupLabel: "Presentation",
    group: (v) => v.Presentation_Type ?? "Not recorded",
    indexDate: (s) => cadIndex(s)?.at ?? null,
    indexLabel: "index PCI, angiography or ACS admission",
    outcomes: [
      { key: "death", label: "All-cause death", event: (s) => died(s) },
      { key: "readm_death", label: "Readmission or death", event: (s, i) => earliest(firstAdmissionAfter(s, afterIndexStay(s, cadIndex(s)) ?? i, false), died(s)) },
    ],
    eligibleSql: `SELECT p.id FROM cf.patient p WHERE p.site_id=$1 AND p.removed_at IS NULL AND p.synthetic=$2 AND (
      EXISTS (SELECT 1 FROM cf.procedure x WHERE x.patient_id=p.id AND x.kind='pci')
      OR EXISTS (SELECT 1 FROM cf.study x WHERE x.patient_id=p.id AND x.kind='cath')
      OR EXISTS (SELECT 1 FROM cf.care_context x WHERE x.patient_id=p.id AND x.kind='admission' AND array_to_string(x.reasons, ' ') ~* '(STEMI|NSTE)'))`,
  },
  eps: {
    name: "EP Registry",
    sections: EPS_REGISTRY,
    project: (s) => epsRegistryProjection(s),
    groupKey: "Reason_EPlab",
    groupLabel: "Reason for EP lab",
    group: (v) => v.Reason_EPlab ?? "Not recorded",
    indexDate: (s) => epsIndex(s)?.at ?? null,
    indexLabel: "index device procedure or ablation",
    outcomes: [
      { key: "death", label: "All-cause death", event: (s) => died(s) },
      { key: "readm_death", label: "Readmission or death", event: (s, i) => earliest(firstAdmissionAfter(s, afterIndexStay(s, epsIndex(s)) ?? i, false), died(s)) },
    ],
    eligibleSql: `SELECT p.id FROM cf.patient p WHERE p.site_id=$1 AND p.removed_at IS NULL AND p.synthetic=$2 AND EXISTS (SELECT 1 FROM cf.procedure x WHERE x.patient_id=p.id AND (x.kind='ablation' OR (x.kind='device' AND coalesce(x.attributes->>'type','') <> 'Implantable loop recorder')))`,
  },
};
export const registryName = (reg: RegId) => DEFS[reg].name;

// ---------- enrolment ----------
export type Enrolment = { status: "enrolled" | "withdrawn"; on: string; reason: string; by: string; at: string };
export const WITHDRAW_REASONS = ["Consent withdrawn", "Not eligible", "Entered in error", "Transferred care", "Other"] as const;

async function currentEnrolment(q: Q, ids: string[], reg: RegId): Promise<Map<string, Enrolment>> {
  if (!ids.length) return new Map();
  const rows = (await q.query<{ patient_id: string; action: string; effective_on: string; reason: string; recorded_by: string; recorded_at: string }>(
    `SELECT DISTINCT ON (patient_id) patient_id, action, effective_on::text, reason, recorded_by, recorded_at::text FROM cf.registry_event
     WHERE registry=$1 AND patient_id = ANY($2::uuid[]) ORDER BY patient_id, recorded_at DESC, id`,
    [reg, ids],
  )).rows;
  return new Map(rows.map((r) => [r.patient_id, { status: r.action === "enrol" ? "enrolled" : "withdrawn", on: r.effective_on.slice(0, 10), reason: r.reason, by: r.recorded_by, at: r.recorded_at }]));
}

async function eligibleIds(q: Q, siteId: string, reg: RegId, sample: boolean) {
  return (await q.query<{ id: string }>(DEFS[reg].eligibleSql, [siteId, sample])).rows.map((r) => r.id);
}

/** enrol one patient (or several, from the Registries page); refused when the patient is not eligible or already enrolled */
export async function enrol(q: Q, actor: Actor, reg: RegId, patientIds: string[], effectiveOn: string, sample?: boolean) {
  if (effectiveOn > today()) throw new ApiError(400, "Enrolment date cannot be in the future");
  const out: string[] = [];
  for (const id of patientIds) {
    await patientInSite(q, actor, id);
    const p = (await q.query<{ synthetic: boolean; birth_date: string | null }>(`SELECT synthetic, birth_date::text FROM cf.patient WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (sample != null && p.synthetic !== sample) throw new ApiError(400, "Sample and real patients are enrolled separately");
    if (p.birth_date && effectiveOn < p.birth_date.slice(0, 10)) throw new ApiError(400, "Enrolment date is before the date of birth");
    const s = await loadState(q, id);
    if (!DEFS[reg].project(s)) throw new ApiError(409, `${s.patient.name} is not eligible for the ${DEFS[reg].name}`);
    const cur = (await currentEnrolment(q, [id], reg)).get(id);
    if (cur?.status === "enrolled") { if (patientIds.length === 1) throw new ApiError(409, `${s.patient.name} is already enrolled`); continue; }
    const eid = uuid();
    await q.query(`INSERT INTO cf.registry_event(id,patient_id,registry,action,effective_on,reason,recorded_by) VALUES($1,$2,$3,'enrol',$4,'',$5)`, [eid, id, reg, effectiveOn, actor.id]);
    await audit(q, actor, "registry.enrol", "registry_event", eid, id, { registry: reg, effectiveOn });
    out.push(id);
  }
  return { enrolled: out.length };
}

export async function withdraw(q: Q, actor: Actor, reg: RegId, patientId: string, effectiveOn: string, reason: string, detail = "") {
  await patientInSite(q, actor, patientId);
  if (effectiveOn > today()) throw new ApiError(400, "Withdrawal date cannot be in the future");
  await q.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [patientId]);
  const cur = (await currentEnrolment(q, [patientId], reg)).get(patientId);
  if (cur?.status !== "enrolled") throw new ApiError(409, "Not enrolled in this registry");
  if (effectiveOn < cur.on) throw new ApiError(400, "Withdrawal date is before the enrolment date");
  const text = detail.trim() ? `${reason}: ${detail.trim()}` : reason;
  const eid = uuid();
  await q.query(`INSERT INTO cf.registry_event(id,patient_id,registry,action,effective_on,reason,recorded_by) VALUES($1,$2,$3,'withdraw',$4,$5,$6)`, [eid, patientId, reg, effectiveOn, text, actor.id]);
  await audit(q, actor, "registry.withdraw", "registry_event", eid, patientId, { registry: reg, effectiveOn, reason: text });
  return { withdrawn: true };
}

/** a patient's enrolment in each registry (patient Registries tab) */
export async function patientEnrolment(q: Q, patientId: string) {
  const out: Record<string, Enrolment | null> = {};
  for (const reg of REG_IDS) out[reg] = (await currentEnrolment(q, [patientId], reg)).get(patientId) ?? null;
  return out;
}

// ---------- variables: type, codes, codebook ----------
export type Var = { key: string; label: string; section: string; mapped: boolean; type: VarType; options?: string[]; codes?: Record<string, number>; cf?: boolean; note?: string };
const isYesNo = (v: string[]) => v.length > 0 && v.every((x) => x === "Yes" || x === "No");
const isNumber = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim());

function varsOf(reg: RegId, seen: Map<string, string[]>): Var[] {
  return DEFS[reg].sections.flatMap((sec) =>
    sec.fields.map((f) => {
      const values = seen.get(f.key) ?? [];
      const base = { key: f.key, label: f.label, section: sec.title, mapped: !!f.get };
      if (reg === "eps") {
        if (EPS_CODES[f.key]) return { ...base, type: "categorical" as const, options: Object.keys(EPS_CODES[f.key]), codes: EPS_CODES[f.key] };
        if (EPS_NUMERIC.has(f.key)) return { ...base, type: "numeric" as const };
        if (EPS_DATE.has(f.key)) return { ...base, type: "date" as const };
        if (EPS_TIME.has(f.key)) return { ...base, type: "time" as const };
        // the EP registry types its Yes/No fields by their values, as its own codebook does
        return { ...base, type: isYesNo(values) ? ("binary" as const) : ("string" as const) };
      }
      const spec = (reg === "hf" ? HF_VARS : CAD_VARS)[f.key];
      if (spec) {
        const [type, options] = spec;
        // the CAD registry codes a category by its place in the option list; the HF registry exports the text
        return { ...base, type, options, codes: type === "categorical" && reg === "cad" && options ? Object.fromEntries(options.map((o, i) => [o, i + 1])) : undefined };
      }
      return { ...base, type: isYesNo(values) ? ("binary" as const) : ("string" as const), note: "not in the registry form source; typed from the values" };
    }),
  );
}

/** the value written to the coded export, and whether it could be coded */
function codeOf(v: Var, value: string | null): { code: string; ok: boolean } {
  if (value == null || value === "") return { code: "", ok: true };
  switch (v.type) {
    case "binary":
      return value === "Yes" ? { code: "1", ok: true } : value === "No" ? { code: "0", ok: true } : { code: "", ok: false };
    case "numeric": {
      const n = value.replace(/[^\d.\-]/g, "");
      return isNumber(n) ? { code: n, ok: true } : { code: "", ok: false };
    }
    case "categorical":
      if (v.codes) return v.codes[value] != null ? { code: String(v.codes[value]), ok: true } : { code: "", ok: false };
      return { code: value, ok: !v.options || v.options.includes(value) };
    default:
      return { code: value, ok: true };
  }
}

const valuesText = (v: Var) =>
  v.type === "binary" ? "1 = Yes; 0 = No"
  : v.type === "categorical" ? (v.codes ? Object.entries(v.codes).map(([k, c]) => `${c} = ${k}`).join("; ") : `Text: ${(v.options ?? []).join(" / ")}`)
  : v.type === "numeric" ? "Number"
  : v.type === "date" ? "Date (YYYY-MM-DD)"
  : v.type === "datetime" ? "Date and time (YYYY-MM-DDTHH:MM)"
  : v.type === "time" ? "Time (HH:MM)"
  : "Text";

// CardioFlow columns added after the registry's own (for enrolment and survival analysis); prefixed CF_
function cfVars(reg: RegId): Var[] {
  const S = "CardioFlow (not in the registry form)";
  const v = (key: string, label: string, type: VarType, options?: string[]): Var => ({ key, label, section: S, mapped: true, type, options, cf: true });
  return [
    v("CF_Enrolled", "Enrolled in the registry in CardioFlow", "binary"),
    v("CF_Enrolled_On", "Enrolment date", "date"),
    v("CF_Group", DEFS[reg].groupLabel, "string"),
    v("CF_Index_Date", `Index date (${DEFS[reg].indexLabel})`, "date"),
    v("CF_Last_Contact", "Last contact in the record (censoring date)", "date"),
    v("CF_Died", "Died", "binary"),
    v("CF_Death_Date", "Date of death", "date"),
    v("CF_Death_Cause", "Cause of death group", "categorical", ["Heart failure", "Sudden cardiac", "Other cardiovascular", "Non-cardiovascular", "Unknown"]),
    ...DEFS[reg].outcomes.flatMap((o) => [
      v(`CF_${o.key}_event`, `${o.label}: event`, "binary"),
      v(`CF_${o.key}_days`, `${o.label}: days from the index date to the event or last contact`, "numeric"),
    ]),
  ];
}
const CAUSE: Record<string, string> = { hf: "Heart failure", sudden_cardiac: "Sudden cardiac", other_cv: "Other cardiovascular", non_cv: "Non-cardiovascular", unknown: "Unknown" };

// ---------- follow-up ----------
function lastContact(s: PatientState): string {
  const d = [
    ...s.contexts.flatMap((c) => [c.started_at, c.ended_at]),
    ...s.observations.map((o) => o.effective_at),
    ...s.procedures.map((p) => p.performed_at),
    ...s.studies.map((x) => x.performed_at),
    s.status.vital?.effective_on ?? null,
    s.status.followUp?.effective_on ?? null,
  ].filter((x): x is string => !!x).map(day).filter((x) => x <= s.today).sort();
  return d.pop() ?? s.today;
}
function followUp(reg: RegId, s: PatientState) {
  const index = DEFS[reg].indexDate(s);
  const deathOn = died(s);
  const fu = s.status.followUp;
  // lost to follow-up or transferred: observation stops at that date
  const stop = fu && ["lost", "transferred"].includes(fu.status) ? fu.effective_on.slice(0, 10) : null;
  const last = earliest(lastContact(s), stop) ?? s.today;
  const outcomes = DEFS[reg].outcomes.map((o) => {
    if (!index) return { key: o.key, event: false, days: null as number | null };
    const e = o.event(s, index);
    const event = !!e && e >= index && e <= (deathOn ?? last);
    const end = event ? e! : deathOn ?? last;
    return { key: o.key, event, days: Math.max(0, daysBetween(index, end)) };
  });
  return { index, last: deathOn ?? last, deathOn, cause: deathOn ? CAUSE[s.status.vital?.cause_group ?? "unknown"] : null, outcomes };
}

// ---------- the registry view ----------
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const ID_KEYS = /(Name|Civil|File|Mobile|CRF|Contact|YOB|Year_of_Birth|Doctor|Referred)/;

export async function registryView(q: Q, siteId: string, reg: RegId, sample: boolean, cohortParam?: string) {
  const def = DEFS[reg];
  const eligible = new Set(await eligibleIds(q, siteId, reg, sample));
  // enrolled patients stay listed even when the record no longer makes them eligible
  const enrolledRows = (await q.query<{ patient_id: string }>(
    `SELECT DISTINCT e.patient_id FROM cf.registry_event e JOIN cf.patient p ON p.id=e.patient_id WHERE e.registry=$1 AND p.site_id=$2 AND p.synthetic=$3 AND p.removed_at IS NULL`,
    [reg, siteId, sample],
  )).rows.map((r) => r.patient_id);
  const ids = [...new Set([...eligible, ...enrolledRows])];
  const enrolment = await currentEnrolment(q, ids, reg);
  const people: { s: PatientState; p: Projection | null; e: Enrolment | null }[] = [];
  for (const id of ids) { const s = await loadState(q, id); people.push({ s, p: def.project(s), e: enrolment.get(id) ?? null }); }
  people.sort((a, b) => a.s.patient.name.localeCompare(b.s.patient.name));

  const nEnrolled = people.filter((x) => x.e?.status === "enrolled").length;
  const cohort: "enrolled" | "eligible" = cohortParam === "eligible" ? "eligible" : cohortParam === "enrolled" ? "enrolled" : nEnrolled ? "enrolled" : "eligible";
  const inCohort = people.filter((x) => x.p && (cohort === "eligible" || x.e?.status === "enrolled"));

  // values per patient, by variable
  const rows = inCohort.map((x) => {
    const fields = x.p!.sections.flatMap((sec) => sec.fields);
    const byKey: Record<string, string | null> = Object.fromEntries(fields.map((f) => [f.key, f.value]));
    return { ...x, byKey, present: new Set(fields.map((f) => f.key)), group: def.group(byKey), fu: followUp(reg, x.s) };
  });
  const seen = new Map<string, string[]>();
  for (const r of rows) for (const [k, v] of Object.entries(r.byKey)) if (v != null && v !== "") seen.set(k, [...(seen.get(k) ?? []), v]);
  const vars = varsOf(reg, seen);
  // export columns: every mapped variable that applies to at least one record, in registry order, then CF_ columns
  const exportVars = [...vars.filter((v) => v.mapped && rows.some((r) => r.present.has(v.key))), ...cfVars(reg)];
  const cfValue = (r: (typeof rows)[number], key: string): string | null => {
    const o = (k: string) => r.fu.outcomes.find((x) => key === `CF_${x.key}_${k}`);
    if (key === "CF_Enrolled") return r.e?.status === "enrolled" ? "Yes" : "No";
    if (key === "CF_Enrolled_On") return r.e?.status === "enrolled" ? r.e.on : null;
    if (key === "CF_Group") return r.group;
    if (key === "CF_Index_Date") return r.fu.index;
    if (key === "CF_Last_Contact") return r.fu.last;
    if (key === "CF_Died") return r.fu.deathOn ? "Yes" : "No";
    if (key === "CF_Death_Date") return r.fu.deathOn;
    if (key === "CF_Death_Cause") return r.fu.cause;
    if (o("event")) return o("event")!.days == null ? null : o("event")!.event ? "Yes" : "No";
    if (o("days")) return o("days")!.days == null ? null : String(o("days")!.days);
    return null;
  };
  const value = (r: (typeof rows)[number], v: Var) => (v.cf ? cfValue(r, v.key) : r.byKey[v.key] ?? null);
  const unmapped = new Map<string, Set<string>>();
  const sheet = (coded: boolean) =>
    [exportVars.map((v) => v.key).join(","), ...rows.map((r) => exportVars.map((v) => {
      const val = value(r, v);
      if (!coded) return val ? csvCell(val) : "";
      const c = v.cf && v.type === "categorical" ? { code: val ?? "", ok: true } : codeOf(v, val);
      if (!c.ok) unmapped.set(v.key, new Set([...(unmapped.get(v.key) ?? []), val!]));
      return c.code ? csvCell(c.code) : "";
    }).join(","))].join("\r\n");
  const csv = sheet(false), csvCoded = sheet(true);
  const file = def.name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

  const codebook = [...vars, ...cfVars(reg)].map((v) => ({
    variable: v.key, label: v.label, section: v.section, type: v.type, values: valuesText(v),
    source: v.cf ? "CardioFlow" : v.mapped ? "CardioFlow record" : "Registry only",
    filled: v.cf ? rows.length : (seen.get(v.key) ?? []).length,
    unmapped: [...(unmapped.get(v.key) ?? [])],
    note: v.note ?? null,
  }));

  return {
    registry: def.name,
    cohort,
    counts: {
      patients: people.filter((x) => x.p).length,
      eligible: people.filter((x) => x.p).length,
      enrolled: nEnrolled,
      inCohort: rows.length,
      byType: Object.fromEntries([...new Set(rows.map((r) => r.group))].map((g) => [g, rows.filter((r) => r.group === g).length])),
      filledPct: (() => { const f = rows.reduce((n, r) => n + r.p!.counts.filled, 0), m = rows.reduce((n, r) => n + r.p!.counts.mapped, 0); return m ? Math.round((f / m) * 100) : null; })(),
    },
    patients: people.map((x) => {
      const fields = x.p ? x.p.sections.flatMap((y) => y.fields).filter((f) => f.mapped) : [];
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
      return {
        id: x.s.patient.id, name: x.s.patient.name, mrn: x.s.patient.mrn,
        eligible: !!x.p,
        enrolment: x.e,
        type: x.p ? def.group(byKey) : "—",
        lvef: reg === "hf" ? x.s.resolved("lvef").current?.value_num ?? null : undefined,
        index: x.p?.index,
        filled: x.p?.counts.filled ?? 0, mapped: x.p?.counts.mapped ?? 0,
        missing: fields.filter((f) => f.value == null).map((f) => f.label.replace(/^[\d.a-z]+ /, "")),
      };
    }),
    codebook,
    csv, csvCoded,
    sps: spssSyntax(def.name, `${file}-spss-codes.csv`, exportVars, rows.map((r) => exportVars.map((v) => (v.cf && v.type === "categorical" ? value(r, v) ?? "" : codeOf(v, value(r, v)).code)))),
    files: { csv: `${file}.csv`, csvCoded: `${file}-spss-codes.csv`, sps: `${file}.sps`, codebook: `${file}-codebook.csv` },
    stats: statistics(reg, vars, rows.map((r) => ({ byKey: r.byKey, group: r.group, fu: r.fu }))),
  };
}

// ---------- SPSS syntax ----------
const spsText = (s: string) => `'${s.replace(/'/g, "''").replace(/[\r\n]+/g, " ")}'`;
function spssSyntax(name: string, file: string, vars: Var[], data: string[][]) {
  const width = (i: number) => Math.min(32767, Math.max(1, ...data.map((r) => Buffer.byteLength(r[i] ?? "", "utf8"))));
  const decimals = (i: number) => Math.max(0, ...data.map((r) => (r[i]?.split(".")[1] ?? "").length));
  const fmt = (v: Var, i: number) => {
    const stringCat = v.type === "categorical" && !v.codes;
    if (v.type === "numeric") { const d = Math.min(4, decimals(i)); return `F${Math.max(8, width(i) + 1)}.${d}`; }
    if (v.type === "binary" || (v.type === "categorical" && !stringCat)) return "F3.0";
    if (v.type === "date") return "SDATE10";
    if (v.type === "time") return "TIME5";
    return `A${width(i)}`;
  };
  const lines = [
    `* ${name}: data exported from CardioFlow on ${today()}.`,
    `* Put this file next to ${file} and run it (File > Open > Syntax, then Run > All).`,
    `* Codes follow the registry's own coding; columns starting CF_ are added by CardioFlow (see the codebook).`,
    "GET DATA /TYPE=TXT",
    `  /FILE=${spsText(file)}`,
    "  /ENCODING='UTF8' /DELCASE=LINE /DELIMITERS=\",\" /QUALIFIER='\"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2",
    "  /VARIABLES=",
    ...vars.map((v, i) => `  ${v.key} ${fmt(v, i)}`),
    ".",
    "VARIABLE LABELS",
    vars.map((v, i) => `${i ? " /" : "  "}${v.key} ${spsText(v.label)}`).join("\n"),
    ".",
  ];
  const labelled = vars.filter((v) => v.type === "binary" || (v.type === "categorical" && v.codes));
  if (labelled.length)
    lines.push("VALUE LABELS", labelled.map((v, i) => `${i ? " /" : "  "}${v.key} ${v.type === "binary" ? "1 'Yes' 0 'No'" : Object.entries(v.codes!).map(([k, c]) => `${c} ${spsText(k)}`).join(" ")}`).join("\n"), ".");
  const nominal = labelled.map((v) => v.key).concat(vars.filter((v) => v.type === "categorical" && !v.codes).map((v) => v.key));
  const scale = vars.filter((v) => v.type === "numeric").map((v) => v.key);
  if (nominal.length) lines.push(`VARIABLE LEVEL ${nominal.join(" ")} (NOMINAL).`);
  if (scale.length) lines.push(`VARIABLE LEVEL ${scale.join(" ")} (SCALE).`);
  lines.push("EXECUTE.", "");
  return lines.join("\r\n");
}

// ---------- statistics ----------
type Row = { byKey: Record<string, string | null>; group: string; fu: ReturnType<typeof followUp> };
const r1 = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)) : "—");
const pct = (n: number, d: number) => (d ? `${n} (${Math.round((n / d) * 100)}%)` : "—");

function statistics(reg: RegId, vars: Var[], rows: Row[]) {
  const def = DEFS[reg];
  // groups: up to five largest named groups with ≥2 patients; the rest together
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);
  const named = [...counts.entries()].filter(([g, n]) => g !== "Not recorded" && n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  const gOf = (r: Row) => (named.includes(r.group) ? r.group : "Other");
  const groups = named.length >= 2 ? [...named, ...(rows.some((r) => !named.includes(r.group)) ? ["Other"] : [])] : [];
  const inG = (g: string) => rows.filter((r) => gOf(r) === g);
  const test = (t: TestResult | null) => (t ? { test: t.test, p: t.p } : null);

  const table: { section: string; rows: any[] }[] = [];
  for (const v of vars) {
    if (!v.mapped || v.key === def.groupKey || ID_KEYS.test(v.key)) continue;
    const vals = rows.map((r) => r.byKey[v.key]).filter((x): x is string => x != null && x !== "");
    if (!vals.length) continue;
    const numericLike = v.type === "numeric" || (v.type === "string" && vals.every((x) => isNumber(x)));
    let sec = table.find((t) => t.section === v.section);
    if (!sec) table.push((sec = { section: v.section, rows: [] }));
    const missing = rows.length - vals.length;
    if (numericLike) {
      const nums = (rs: Row[]) => rs.map((r) => r.byKey[v.key]).filter((x): x is string => x != null && isNumber(x.replace(/[^\d.\-]/g, ""))).map((x) => Number(x.replace(/[^\d.\-]/g, "")));
      const cell = (x: number[]) => (x.length ? { text: `${r1(mean(x))} ± ${x.length > 1 ? r1(sd(x)) : "—"}`, sub: `median ${r1(median(x))} [${r1(quantile(x, 0.25))}–${r1(quantile(x, 0.75))}] · n ${x.length}` } : { text: "—" });
      sec.rows.push({ key: v.key, label: v.label, kind: "numeric", overall: cell(nums(rows)), groups: groups.map((g) => cell(nums(inG(g)))), missing, ...(groups.length ? { test: test(welchAnova(groups.map((g) => nums(inG(g))))) } : {}) });
    } else if (v.type === "binary") {
      const yes = (rs: Row[]) => rs.filter((r) => r.byKey[v.key] === "Yes").length, rec = (rs: Row[]) => rs.filter((r) => r.byKey[v.key] === "Yes" || r.byKey[v.key] === "No").length;
      sec.rows.push({ key: v.key, label: v.label, kind: "binary", overall: { text: pct(yes(rows), rec(rows)) }, groups: groups.map((g) => ({ text: pct(yes(inG(g)), rec(inG(g))) })), missing, ...(groups.length ? { test: test(compareCounts([groups.map((g) => yes(inG(g))), groups.map((g) => rec(inG(g)) - yes(inG(g)))])) } : {}) });
    } else if (v.type === "categorical" || (v.type === "string" && new Set(vals).size <= 8)) {
      const levels = [...(v.options ?? []).filter((o) => vals.includes(o)), ...[...new Set(vals)].filter((x) => !(v.options ?? []).includes(x))];
      const n = (rs: Row[], l: string) => rs.filter((r) => r.byKey[v.key] === l).length, rec = (rs: Row[]) => rs.filter((r) => r.byKey[v.key] != null && r.byKey[v.key] !== "").length;
      sec.rows.push({ key: v.key, label: v.label, kind: "categorical", overall: null, groups: [], missing, ...(groups.length ? { test: test(compareCounts(levels.map((l) => groups.map((g) => n(inG(g), l))))) } : {}),
        levels: levels.map((l) => ({ label: l, overall: { text: pct(n(rows, l), rec(rows)) }, groups: groups.map((g) => ({ text: pct(n(inG(g), l), rec(inG(g))) })) })) });
    }
  }

  const outcomes = def.outcomes.map((o) => {
    const cases = (rs: Row[]): SurvivalCase[] => rs.map((r) => r.fu.outcomes.find((x) => x.key === o.key)!).filter((x) => x.days != null).map((x) => ({ time: x.days!, event: x.event }));
    const curve = (c: SurvivalCase[]) => {
      const km = kaplanMeier(c);
      return {
        n: c.length, events: c.filter((x) => x.event).length,
        at: [30, 90, 365].map((d) => { const a = survivalAt(km, d, c.length); return { days: d, survival: a.survival, se: a.se, atRisk: a.atRisk }; }),
        steps: km.filter((k) => k.events > 0 || k === km[km.length - 1]).map((k) => ({ t: k.time, s: k.survival })),
      };
    };
    const all = cases(rows);
    return {
      key: o.key, label: o.label,
      overall: curve(all),
      groups: groups.map((g) => ({ group: g, ...curve(cases(inG(g))) })),
      test: groups.length ? test(logRank(groups.map((g) => cases(inG(g))))) : null,
      medianFollowUpDays: all.length ? median(all.map((c) => c.time)) : null,
    };
  });

  return {
    n: rows.length,
    groupLabel: def.groupLabel,
    groups: groups.map((g) => ({ label: g, n: inG(g).length })),
    origin: def.indexLabel,
    noIndex: rows.filter((r) => !r.fu.index).length,
    table,
    outcomes,
  };
}

