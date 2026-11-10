// 10 Nov 2026 — phase 4: registry enrolment, codebook, coded export, SPSS syntax and statistics.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { enrol, patientEnrolment, registryView, withdraw, REG_IDS } from "../server/engine/registries.js";
import { CAD_VARS, HF_VARS } from "../server/engine/registry-schema.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const view = (reg: "hf" | "cad" | "eps", cohort?: string) => db.transaction((q) => registryView(q, SITE_ID, reg, true, cohort)) as Promise<any>;
// RFC 4180 rows (quoted cells may hold commas)
const parse = (csv: string) => csv.split("\r\n").map((line) => {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
});
const idOf = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});

test("before anyone is enrolled the view shows every eligible patient; enrolling switches the default cohort", async () => {
  const v0 = await view("hf");
  assert.equal(v0.cohort, "eligible");
  assert.equal(v0.counts.enrolled, 0);
  assert.equal(v0.counts.inCohort, v0.counts.eligible);
  const saad = await idOf("Saad Al-Otaibi"), huda = await idOf("Huda Al-Sabah");
  const r = await db.transaction((q) => enrol(q, doc, "hf", [saad, huda], addDays(T, -30), true));
  assert.equal(r.enrolled, 2);
  const v1 = await view("hf");
  assert.equal(v1.cohort, "enrolled");
  assert.equal(v1.counts.enrolled, 2);
  assert.equal(v1.counts.inCohort, 2);
  assert.equal(v1.csv.split("\r\n").length, 3, "header + the two enrolled patients");
  assert.equal((await view("hf", "eligible")).counts.inCohort, v0.counts.eligible);
  const p = v1.patients.find((x: any) => x.id === saad);
  assert.deepEqual([p.enrolment.status, p.enrolment.on], ["enrolled", addDays(T, -30)]);
  // enrolling again is refused for one patient and skipped in a batch
  await assert.rejects(db.transaction((q) => enrol(q, doc, "hf", [saad], T)), /already enrolled/);
  assert.equal((await db.transaction((q) => enrol(q, doc, "hf", [saad, huda], T, true))).enrolled, 0);
});

test("enrolment is refused for an ineligible patient, a future date or the wrong group", async () => {
  const mariam = await idOf("Mariam Hussain"); // no heart failure
  await assert.rejects(db.transaction((q) => enrol(q, doc, "hf", [mariam], T)), /not eligible/);
  const fatma = await idOf("Fatma Al-Ajmi");
  await assert.rejects(db.transaction((q) => enrol(q, doc, "cad", [fatma], addDays(T, 1))), /future/);
  await assert.rejects(db.transaction((q) => enrol(q, doc, "cad", [fatma], T, false)), /separately/);
});

test("withdrawal keeps the history (append-only) and leaves the patient listed as withdrawn", async () => {
  const huda = await idOf("Huda Al-Sabah");
  await assert.rejects(db.transaction((q) => withdraw(q, doc, "hf", huda, addDays(T, -60), "Consent withdrawn")), /before the enrolment/);
  await db.transaction((q) => withdraw(q, doc, "hf", huda, T, "Consent withdrawn", "asked at clinic"));
  const e = await db.transaction((q) => patientEnrolment(q, huda));
  assert.equal(e.hf!.status, "withdrawn");
  assert.equal(e.hf!.reason, "Consent withdrawn: asked at clinic");
  assert.equal(e.cad, null);
  const v = await view("hf");
  assert.equal(v.counts.enrolled, 1);
  assert.equal(v.patients.find((x: any) => x.id === huda).enrolment.status, "withdrawn");
  await assert.rejects(db.query(`DELETE FROM cf.registry_event WHERE patient_id=$1`, [huda]), /append-only|not allowed|forbid/i);
  await assert.rejects(db.transaction((q) => withdraw(q, doc, "hf", huda, T, "Other")), /Not enrolled/);
  // re-enrolment after a withdrawal is allowed
  await db.transaction((q) => enrol(q, doc, "hf", [huda], T));
  assert.equal((await db.transaction((q) => patientEnrolment(q, huda))).hf!.status, "enrolled");
});

test("codebook: every registry variable once, with its type, codes and source; coded values use the registry's codes", async () => {
  for (const reg of REG_IDS) {
    const v = await view(reg, "eligible");
    const names = v.codebook.map((c: any) => c.variable);
    assert.equal(new Set(names).size, names.length, `${reg}: no variable twice`);
    assert.ok(v.codebook.some((c: any) => c.source === "Registry only"), `${reg}: registry-only fields listed`);
    assert.ok(v.codebook.filter((c: any) => c.source === "CardioFlow").every((c: any) => c.variable.startsWith("CF_")));
    const header = parse(v.csv)[0];
    assert.deepEqual(parse(v.csvCoded)[0], header, `${reg}: both files share the header`);
    assert.ok(parse(v.csv).every((r) => r.length === header.length) && parse(v.csvCoded).every((r) => r.length === header.length), `${reg}: every row has every column`);
    for (const c of v.codebook) if (c.type === "binary") assert.equal(c.values, "1 = Yes; 0 = No");
    // a coded cell is a number for every binary / numeric / coded categorical column
    const types = Object.fromEntries(v.codebook.map((c: any) => [c.variable, c]));
    for (const cells of parse(v.csvCoded).slice(1)) {
      header.forEach((h: string, i: number) => {
        const t = types[h];
        if (!cells[i]) return;
        if (t.type === "binary") assert.match(cells[i], /^[01]$/, `${reg} ${h}`);
        if (t.type === "numeric" || (t.type === "categorical" && /^\d+ = /.test(t.values))) assert.match(cells[i], /^-?\d+(\.\d+)?$/, `${reg} ${h} = ${cells[i]}`);
      });
    }
  }
  // CAD: a category is coded by its place in the registry's option list (Presentation_Type: STEMI = 1)
  const cad = await view("cad", "eligible");
  const h = parse(cad.csv)[0].indexOf("Presentation_Type");
  const pairs = parse(cad.csv).slice(1).map((l, i) => [l[h], parse(cad.csvCoded)[i + 1][h]]);
  for (const [label, code] of pairs) if (label) assert.equal(code, String(CAD_VARS.Presentation_Type[1]!.indexOf(label) + 1));
  // HF keeps its categories as text, as the HF registry's own SPSS export does
  const hf = await view("hf", "eligible");
  const hh = parse(hf.csv)[0].indexOf("HF_Type");
  assert.equal(parse(hf.csv)[1][hh], parse(hf.csvCoded)[1][hh]);
  assert.equal(HF_VARS.HF_Type[0], "categorical");
});

test("values the registry cannot take are reported, not coded (e.g. access site without a side)", async () => {
  const cad = await view("cad", "eligible");
  const access = cad.codebook.find((c: any) => c.variable === "Access_Site");
  if (access.unmapped.length) {
    assert.ok(access.unmapped.every((x: string) => !CAD_VARS.Access_Site[1]!.includes(x)));
    const h = parse(cad.csv)[0].indexOf("Access_Site");
    for (const line of parse(cad.csvCoded).slice(1)) assert.equal(line[h], "", "an uncodable value is blank in the coded file");
  }
});

test("SPSS syntax reads every exported column with labels; binaries and coded categories get value labels", async () => {
  const v = await view("eps", "eligible");
  const header = parse(v.csv)[0];
  assert.match(v.sps, /^\* EP Registry: data exported from CardioFlow/);
  assert.match(v.sps, /GET DATA \/TYPE=TXT\r\n  \/FILE='ep-registry-spss-codes\.csv'/);
  for (const h of header) {
    assert.match(v.sps, new RegExp(`\\r\\n  ${h} (F\\d+\\.\\d|A\\d+|SDATE10|TIME5)\\r\\n`), `${h} read`);
    assert.match(v.sps, new RegExp(`(\\r\\n  | /)${h} '`), `${h} labelled`);
  }
  assert.match(v.sps, /Reason_EPlab 1 'CRT\/AICD' 2 'Pacemaker'/);
  assert.match(v.sps, /CF_Died 1 'Yes' 0 'No'/);
  assert.match(v.sps, /AdmissionDate SDATE10/);
  assert.match(v.sps, /EXECUTE\.\r\n$/);
  for (const l of v.sps.split("\r\n").filter((x: string) => !x.startsWith("*") && !x.includes("/DELIMITERS"))) assert.equal(l.replace(/''/g, "").split("'").length % 2, 1, `quotes balanced on: ${l}`);
});

test("statistics: baseline table by group with tests; survival from the index date with deaths as events", async () => {
  const id = await idOf("Faisal Al-Mutairi");
  await db.transaction((q) => K.recordStatus(q, doc, id, { kind: "vital", status: "died", effectiveOn: addDays(T, -3), place: "in_hospital", causeGroup: "hf" }));
  const v = await view("hf", "eligible");
  const s = v.stats;
  assert.equal(s.n, v.counts.inCohort);
  assert.ok(s.groups.length >= 2, "HF types compared");
  assert.equal(s.groups.reduce((a: number, g: any) => a + g.n, 0), s.n);
  const rows = s.table.flatMap((t: any) => t.rows);
  assert.ok(rows.every((r: any) => r.key !== "HF_Type"), "the grouping variable is not a row");
  assert.ok(rows.every((r: any) => !/Name|Civil|File_No|Mobile/.test(r.key)), "no identifiers");
  const age = rows.find((r: any) => r.key === "Age");
  assert.match(age.overall.text, /^\d+(\.\d)? ± \d+(\.\d)?$/);
  assert.ok(age.test && ["Welch t", "Welch ANOVA"].includes(age.test.test));
  const binary = rows.find((r: any) => r.kind === "binary" && r.test);
  assert.ok(["Chi-square", "Fisher"].includes(binary.test.test));
  const death = s.outcomes.find((o: any) => o.key === "death");
  assert.equal(death.overall.events, 1);
  assert.ok(death.overall.at[2].survival < 1);
  assert.equal(death.overall.n, s.n - s.noIndex);
  // the export carries the outcome for the statistician
  const [header, ...data] = parse(v.csvCoded);
  const line = data.find((l) => l.includes(v.patients.find((p: any) => p.id === id).mrn))!;
  assert.equal(line[header.indexOf("CF_Died")], "1");
  assert.equal(line[header.indexOf("CF_Death_Date")], addDays(T, -3));
  assert.equal(line[header.indexOf("CF_death_event")], "1");
  assert.ok(Number(line[header.indexOf("CF_death_days")]) >= 0);
});
