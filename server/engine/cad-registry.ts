// CAD Registry projection (coronary module, slice 5): the CAD Registry case report form
// (github.com/SACC-CAD/Registry, index.html SECTIONS schema; one record per cath-lab admission)
// mapped to the CardioFlow record. Read-only, like the HF registry projection: CardioFlow fills
// what it already holds, in the registry's own field keys, option wording and units; everything
// else is listed as registry-only, to be entered in the registry. Nothing is written to the
// registry from here. The lesion-level form and the follow-up visits are registry-only for now.
//
// The index record is the latest PCI (or angiography, or ACS admission when neither was done) and
// the admission that contains it. "Home medications" are the medicines active the day before that
// admission; "discharge medications" those active on the day of discharge. Presentation vitals
// and baseline labs are the first values of the admission; nadir and peak are taken over the stay.
import { formatNumber } from "../../shared/catalog.js";
import { addDays, ageOn, fmtDay, localDay } from "../../shared/clinical.js";
import { obstructiveCad } from "../../shared/studies.js";
import { PCI_SETTINGS } from "../../shared/procedures.js";
import type { ContextRow, MedState, Obs, PatientState, ProcedureRow, StudyRow } from "../kernel/state.js";

type Val = { value: string; at?: string | null; note?: string } | null;
type Field = { key: string; label: string; get?: (x: Ctx) => Val };
type Section = { title: string; fields: Field[] };
type Ctx = {
  s: PatientState;
  at: string; // index day (local)
  pci: ProcedureRow | null;
  cath: StudyRow | null;
  adm: ContextRow | null;
  from: string; // window for presentation values and labs (local days, inclusive)
  to: string;
  discharged: boolean;
  dischargeDay: string | null;
};

const yn = (b: boolean): Val => ({ value: b ? "Yes" : "No" });
const has = (s: PatientState, ...codes: string[]) => s.conditions.some((c) => codes.includes(c.code));
const tag = (s: PatientState, t: string) => s.tags.has(t);
const day = (iso: string) => localDay(iso);
const series = (x: Ctx, code: string) =>
  x.s.observations
    .filter((o) => o.code === code && o.status !== "entered_in_error" && o.value_num != null && day(o.effective_at) >= x.from && day(o.effective_at) <= x.to)
    .sort((a, b) => a.effective_at.localeCompare(b.effective_at));
const num = (o: Obs | undefined, d: number): Val => (o ? { value: formatNumber(o.value_num!, d).replace(/,/g, ""), at: o.effective_at } : null);
const first = (code: string, d = 0): Field["get"] => (x) => num(series(x, code)[0], d);
const extreme = (code: string, d: number, which: "min" | "max"): Field["get"] => (x) => {
  if (!x.adm) return null;
  const v = series(x, code);
  if (v.length < 1) return null;
  const pick = v.reduce((a, b) => ((which === "min" ? b.value_num! < a.value_num! : b.value_num! > a.value_num!) ? b : a));
  return num(pick, d);
};

// medicines active at a moment, replaying the medication events
function activeAt(m: MedState, at: string): { on: boolean; dose: number | null } {
  let on = false, dose: number | null = null;
  for (const e of m.events) {
    if (e.effective_at > at) break;
    if (e.kind === "start" || e.kind === "restart" || e.kind === "resume" || e.kind === "increase" || e.kind === "decrease" || e.kind === "hold") on = true;
    if (e.kind === "stop") on = false;
    if (e.dose_value != null && e.kind !== "planned") dose = e.dose_value;
  }
  return { on, dose };
}
const medsAt = (s: PatientState, at: string) =>
  s.meds.map((m) => ({ m, ...activeAt(m, at) })).filter((x) => x.on);
const intensity = (code: string, dose: number | null) =>
  dose == null ? null : code.startsWith("atorvastatin") ? (dose >= 40 ? "High intensity" : dose >= 10 ? "Moderate intensity" : "Low intensity")
  : code.startsWith("rosuvastatin") ? (dose >= 20 ? "High intensity" : "Moderate intensity")
  : code === "simvastatin" ? (dose >= 20 ? "Moderate intensity" : "Low intensity")
  : code === "pravastatin" ? (dose >= 40 ? "Moderate intensity" : "Low intensity") : null;

// One medication block, used for home and discharge medicines (the registry uses one aligned set)
const MED_FIELDS: [string, string, (code: string, tags: string[]) => boolean][] = [
  ["Aspirin", "Aspirin", (c) => c === "aspirin"],
  ["Clopidogrel", "Clopidogrel", (c) => c === "clopidogrel"],
  ["Prasugrel", "Prasugrel", (c) => c === "prasugrel"],
  ["Ticagrelor", "Ticagrelor", (c) => c === "ticagrelor"],
  ["Warfarin", "Warfarin", (c) => c === "warfarin"],
  ["Dabigatran", "Dabigatran", (c) => c === "dabigatran"],
  ["Apixaban", "Apixaban", (c) => c === "apixaban"],
  ["Rivaroxaban", "Rivaroxaban", (c) => c === "rivaroxaban"],
  ["Edoxaban", "Edoxaban", (c) => c === "edoxaban"],
  ["LMWH", "LMWH", (c) => c === "enoxaparin"],
  ["Ezetimibe", "Ezetimibe", (_c, t) => t.includes("ezetimibe")],
  ["PCSK9i", "PCSK9 inhibitor", (_c, t) => t.includes("pcsk9")],
  ["Fibrates", "Fibrates", (c) => c === "fenofibrate"],
  ["Beta_Blockers", "Beta-blocker", (_c, t) => t.includes("bb") || (t.includes("bb-other") && !t.includes("bp-lowering-only"))],
  ["ACE_I", "ACE inhibitor", (_c, t) => t.includes("acei")],
  ["ARB", "ARB", (_c, t) => t.includes("arb")],
  ["ARNI", "ARNI", (_c, t) => t.includes("arni")],
  ["MRA", "MRA", (_c, t) => t.includes("mra")],
  ["SGLT_Inhibitor", "SGLT2 inhibitor", (_c, t) => t.includes("sglt2")],
  ["Ivabradine", "Ivabradine", (c) => c === "ivabradine"],
  ["Digoxin", "Digoxin", (c) => c === "digoxin"],
  ["Loop_Diuretics", "Loop diuretic", (_c, t) => t.includes("loop")],
  ["Hydralazine_Nitrate", "Hydralazine / nitrates", (c, t) => c === "hydralazine" || (t.includes("nitrate") && c !== "gtn")],
  ["Verapamil", "Verapamil", (c) => c === "verapamil"],
  ["Diltiazem", "Diltiazem", (c) => c === "diltiazem"],
  ["Amiodarone", "Amiodarone", (c) => c === "amiodarone"],
  ["Flecainide", "Flecainide", (c) => c === "flecainide"],
  ["Sotalol", "Sotalol", (c) => c === "sotalol"],
  ["Insulin", "Insulin", (_c, t) => t.includes("insulin")],
  ["Oral_Hypoglycemic", "Oral hypoglycaemic", (c, t) => t.includes("metformin") || t.includes("sulfonylurea") || t.includes("dpp4") || t.includes("tzd") || c === "semaglutide-oral"],
  ["GLP1_RA", "GLP-1 RA", (_c, t) => t.includes("glp1")],
  ["Ranolazine", "Ranolazine", (c) => c === "ranolazine"],
  ["Trimetazidine", "Trimetazidine", (c) => c === "trimetazidine"],
  ["Nicorandil", "Nicorandil", (c) => c === "nicorandil"],
  ["Colchicine", "Colchicine", (c) => c === "colchicine"],
  ["PPI", "PPI", (_c, t) => t.includes("ppi")],
];
const medSection = (title: string, when: (x: Ctx) => string | null, prefix: string): Section => ({
  title,
  fields: [
    ...MED_FIELDS.slice(0, 10).map(([k, label, test]) => medField(prefix, k, label, test, when)),
    { key: `${prefix}Statin`, label: "Statin intensity", get: (x) => {
      const at = when(x);
      if (!at) return null;
      const st = medsAt(x.s, at).filter((y) => y.m.tags.includes("statin"));
      if (!st.length) return { value: "None" };
      const i = intensity(st[0].m.code, st[0].dose);
      return i ? { value: i, note: `${st[0].m.name}${st[0].dose != null ? ` ${st[0].dose} mg` : ""}` } : { value: "Moderate intensity", note: `${st[0].m.name}: intensity by drug and dose` };
    } },
    ...MED_FIELDS.slice(10).map(([k, label, test]) => medField(prefix, k, label, test, when)),
    { key: `${prefix}Icosapent_Ethyl_Omega3`, label: "Icosapent ethyl (omega-3)" },
    { key: `${prefix}Procainamide`, label: "Procainamide" },
  ],
});
function medField(prefix: string, key: string, label: string, test: (code: string, tags: string[]) => boolean, when: (x: Ctx) => string | null): Field {
  return { key: `${prefix}${key}`, label, get: (x) => { const at = when(x); return at ? yn(medsAt(x.s, at).some((y) => test(y.m.code, y.m.tags))) : null; } };
}
const before = (x: Ctx) => `${addDays(x.adm ? day(x.adm.started_at) : x.at, -1)}T23:59:59Z`;
const atDischarge = (x: Ctx) => (x.discharged ? `${x.dischargeDay}T23:59:59Z` : null);

// conditions dated before the index admission (the index PCI adds "past PCI" on its own day)
const priorTo = (x: Ctx, codes: string[]) => x.s.conditions.filter((c) => codes.includes(c.code) && ((c.onset && day(c.onset) < x.from) || (!c.onset && c.attributes?.onsetYear && `${c.attributes.onsetYear}-12-31` < x.from)));
const priorProc = (x: Ctx, kind: string) => x.s.procedures.filter((p) => p.kind === kind && day(p.performed_at) < x.from);
const within6m = (iso: string, x: Ctx) => day(iso) >= addDays(x.from, -182);
const events = (x: Ctx) => (((x.adm?.summary as any)?.events as string[] | undefined) ?? []);
const inHosp = (key: string, label: string, re: RegExp): Field => ({ key, label, get: (x) => (x.discharged ? yn(events(x).some((e) => re.test(e))) : null) });
const initial = (n: string | undefined) => (n ? n[0].toUpperCase() : null);
const NAT: Record<string, string> = { Kuwait: "Kuwaiti", Kuwaiti: "Kuwaiti", Bedoon: "Bedoon", Egypt: "Egyptian", Egyptian: "Egyptian", India: "Indian", Indian: "Indian", "Saudi Arabia": "Saudi Arabian", Saudi: "Saudi Arabian" };

export const CAD_REGISTRY: Section[] = [
  {
    title: "Identification",
    fields: [
      { key: "Name_First", label: "Name initial (first)", get: (x) => { const i = initial(x.s.patient.name.split(/\s+/)[0]); return i ? { value: i } : null; } },
      { key: "Name_Middle", label: "Name initial (middle)", get: (x) => { const p = x.s.patient.name.split(/\s+/); return p.length >= 3 ? { value: initial(p[1])! } : null; } },
      { key: "Name_Last", label: "Name initial (last)", get: (x) => { const p = x.s.patient.name.split(/\s+/); return p.length >= 2 ? { value: initial(p[p.length - 1].replace(/^Al-/i, ""))!, note: p[p.length - 1] } : null; } },
      { key: "Civil_ID_Optional", label: "Civil ID", get: (x) => (x.s.patient.civil_id ? { value: x.s.patient.civil_id } : null) },
      { key: "CRF_Number", label: "CRF number" },
      { key: "Sex", label: "Gender", get: (x) => ({ value: x.s.patient.sex }) },
      { key: "Nationality", label: "Nationality", get: (x) => { const n = x.s.patient.nationality; return n ? { value: NAT[n] ?? n, note: NAT[n] ? undefined : "check against the registry list" } : null; } },
      { key: "Year_of_Birth", label: "Year of birth", get: (x) => ({ value: x.s.patient.birth_date.slice(0, 4) }) },
      { key: "Age", label: "Age at admission", get: (x) => ({ value: String(ageOn(x.s.patient.birth_date, x.adm ? day(x.adm.started_at) : x.at)) }) },
      { key: "Index_Admission_Date", label: "Hospital admission date", get: (x) => ({ value: x.adm ? day(x.adm.started_at) : x.at, note: x.adm ? undefined : "no admission recorded: procedure date" }) },
      { key: "Patient_Contact", label: "Patient contact", get: (x) => (x.s.patient.mobile ? { value: x.s.patient.mobile } : null) },
      { key: "Relative_Contact", label: "Relative contact" },
    ],
  },
  {
    title: "Reason for angiography & admission",
    fields: [
      { key: "CA_Reason", label: "Reason for coronary angiography", get: (x) => {
        const st = x.pci?.attributes.setting;
        if (st) return { value: { stemi: "Primary PCI (STEMI)", "nste-acs": "Urgent / early invasive (NSTEMI / high-risk ACS)", elective: "Elective / staged PCI", staged: "Elective / staged PCI" }[st as string] ?? "Other", note: PCI_SETTINGS.find((p) => p.value === st)?.label };
        return x.cath && !x.pci ? { value: "Elective diagnostic angiography", note: "angiography without PCI recorded" } : null;
      } },
      { key: "Patient_Origin", label: "Patient origin", get: (x) => {
        const r = (x.adm?.summary as any)?.route as string | undefined;
        if (!r) return null;
        if (/transfer/i.test(r)) return { value: "Transferred from other hospital" };
        if (/clinic/i.test(r)) return { value: "Clinic (primary care / private / outpatient)" };
        return { value: "Home", note: `CardioFlow: ${r}` };
      } },
    ],
  },
  {
    title: "Presentation",
    fields: [
      { key: "Presentation_Type", label: "Clinical presentation", get: (x) => {
        const r = (x.adm?.reasons ?? []).join(" ");
        if (/NSTE|NSTEMI/i.test(r)) return { value: /unstable/i.test(r) ? "Unstable Angina" : "NSTEMI", note: x.adm!.reasons.join(", ") };
        if (/STEMI/i.test(r)) return { value: "STEMI", note: x.adm!.reasons.join(", ") };
        const st = x.pci?.attributes.setting;
        if (st === "stemi") return { value: "STEMI" };
        if (st === "nste-acs") return { value: "NSTEMI", note: "NSTE-ACS PCI: NSTEMI or unstable angina — confirm" };
        if (st === "elective") return { value: "Stable Angina", note: "elective PCI (chronic coronary syndrome); silent ischaemia is chosen in the registry" };
        return null;
      } },
      { key: "Killip_Class", label: "Killip class" },
      { key: "Chest_Pain_CCS_Class", label: "Chest pain (CCS class)" },
      { key: "Dyspnea_NYHA_Class", label: "Dyspnoea (NYHA class)", get: (x) => { const o = x.s.observations.filter((o) => o.code === "nyha" && o.value_text && day(o.effective_at) <= x.to).sort((a, b) => b.effective_at.localeCompare(a.effective_at))[0]; return o ? { value: `NYHA ${o.value_text}`, at: o.effective_at } : null; } },
      { key: "Cardiogenic_Shock_SCAI", label: "Cardiogenic shock (SCAI stage)" },
      { key: "Presenting_Symptom_Syncope", label: "Syncope at presentation", get: (x) => (x.adm ? yn(((x.adm.summary as any)?.symptoms ?? []).some((v: string) => /syncope/i.test(v))) : null) },
      { key: "Cardiac_Arrest", label: "Cardiac arrest at presentation" },
      { key: "Systolic_BP", label: "Systolic BP (mmHg)", get: first("sbp") },
      { key: "Diastolic_BP", label: "Diastolic BP (mmHg)", get: first("dbp") },
      { key: "Presenting_HR", label: "Presenting HR (/min)", get: first("hr") },
      { key: "Weight_kg", label: "Weight (kg)", get: first("weight", 1) },
      { key: "Height_cm", label: "Height (cm)", get: (x) => { const o = x.s.resolved("height").current; return o?.value_num != null ? { value: formatNumber(o.value_num, 0), at: o.effective_at } : null; } },
      { key: "BMI", label: "BMI", get: (x) => {
        const w = series(x, "weight")[0]?.value_num ?? x.s.resolved("weight").current?.value_num, h = x.s.resolved("height").current?.value_num;
        return w && h ? { value: formatNumber(w / (h / 100) ** 2, 1) } : null;
      } },
    ],
  },
  {
    title: "Risk factors & history (before this admission)",
    fields: [
      { key: "Smoking_Status", label: "Smoking", get: (x) => {
        const v = x.s.resolved("hx.smoking").current?.value_text;
        if (v === "current" || has(x.s, "smoker")) return { value: "Current" };
        return v === "ex" ? { value: "Former" } : v === "never" ? { value: "Never" } : null;
      } },
      { key: "Diabetes", label: "Diabetes", get: (x) => yn(tag(x.s, "dm")) },
      { key: "Hypertension", label: "Hypertension", get: (x) => yn(tag(x.s, "htn")) },
      { key: "Dyslipidemia", label: "Dyslipidaemia", get: (x) => yn(tag(x.s, "lipids") || has(x.s, "dyslipidaemia", "fh")) },
      { key: "Family_History_CAD", label: "Family history of premature CAD", get: (x) => { const v = x.s.resolved("hx.fhx-cad").current?.value_text; return v === "yes" ? { value: "Yes" } : v === "no" ? { value: "No" } : null; } },
      { key: "Chronic_Kidney_Disease", label: "Chronic kidney disease", get: (x) => yn(tag(x.s, "ckd")) },
      { key: "Dialysis_Dependent", label: "Dialysis dependent", get: (x) => yn(has(x.s, "dialysis")) },
      { key: "Coronary_Artery_Disease", label: "Known coronary disease", get: (x) => yn(priorTo(x, ["cad-ccs", "prior-mi", "prior-pci", "prior-cabg", "acs-stemi", "acs-nstemi"]).length > 0 || priorProc(x, "pci").length > 0 || priorProc(x, "cabg").length > 0) },
      { key: "Myocardial_Infarction", label: "Previous MI", get: (x) => yn(priorTo(x, ["prior-mi", "acs-stemi", "acs-nstemi"]).length > 0) },
      { key: "Prior_PCI", label: "Prior PCI", get: (x) => yn(priorProc(x, "pci").length > 0 || priorTo(x, ["prior-pci"]).length > 0) },
      { key: "PCI_Within_6_Months", label: "PCI within 6 months", get: (x) => yn(priorProc(x, "pci").some((p) => within6m(p.performed_at, x))) },
      { key: "Prior_CABG", label: "Prior CABG", get: (x) => yn(priorProc(x, "cabg").length > 0 || priorTo(x, ["prior-cabg"]).length > 0) },
      { key: "CABG_Within_6_Months", label: "CABG within 6 months", get: (x) => yn(priorProc(x, "cabg").some((p) => within6m(p.performed_at, x))) },
      { key: "Prior_Coronary_Angiography", label: "Prior coronary angiography", get: (x) => yn(x.s.studies.some((st) => st.kind === "cath" && day(st.performed_at) < x.from)) },
      { key: "CA_Within_6_Months", label: "Angiography within 6 months", get: (x) => yn(x.s.studies.some((st) => st.kind === "cath" && day(st.performed_at) < x.from && within6m(st.performed_at, x))) },
      { key: "CA_After_Cardiac_Arrest", label: "Angiography after cardiac arrest" },
      { key: "Ischemic_Cardiomyopathy", label: "Ischaemic cardiomyopathy", get: (x) => { const c = x.s.conditions.find((c) => ["hfref", "hfmref", "hfpef", "hfimpef"].includes(c.code)); const a = c?.attributes?.aetiology; return yn(!!(Array.isArray(a) ? a : a ? [a] : []).includes("Ischaemic")); } },
      { key: "Cardiomyopathy_Timeframe", label: "Cardiomyopathy timeframe" },
      { key: "GDMT_Max_Dose", label: "GDMT dose" },
      { key: "Heart_Failure", label: "Heart failure", get: (x) => yn(tag(x.s, "hf")) },
      { key: "HF_Type", label: "HF phenotype", get: (x) => { const c = x.s.conditions.find((c) => ["hfref", "hfmref", "hfpef"].includes(c.code)); return c ? { value: { hfref: "HFrEF", hfmref: "HFmrEF", hfpef: "HFpEF" }[c.code as "hfref"] } : null; } },
      { key: "Valvular_Heart_Disease", label: "Valvular heart disease", get: (x) => yn(has(x.s, "as", "ar", "mr-primary", "mr-secondary", "ms", "tr", "prosthetic-valve")) },
      { key: "Cerebrovascular_Disease", label: "Cerebrovascular disease", get: (x) => yn(has(x.s, "stroke-tia")) },
      { key: "Chronic_Lung_Disease", label: "Chronic lung disease / COPD", get: (x) => yn(has(x.s, "copd")) },
      { key: "Peripheral_Artery_Disease", label: "Peripheral artery disease", get: (x) => yn(has(x.s, "pad")) },
      { key: "Prior_Stroke_TIA", label: "Prior stroke / TIA", get: (x) => yn(has(x.s, "stroke-tia")) },
      { key: "Prior_Major_Bleeding", label: "Prior major bleeding" },
      { key: "Contrast_Allergy", label: "Contrast allergy", get: (x) => (/contrast|iodin/i.test(x.s.patient.allergies ?? "") ? { value: "Yes", note: x.s.patient.allergies } : x.s.patient.allergies ? { value: "No", note: `allergies: ${x.s.patient.allergies}` } : null) },
      { key: "Familial_Syndrome", label: "Familial syndrome" },
      { key: "Frailty", label: "Frailty (CFS)" },
      { key: "Atrial_Fibrillation", label: "Atrial fibrillation", get: (x) => yn(tag(x.s, "af")) },
      { key: "Prior_Cardiac_Arrest", label: "Prior cardiac arrest" },
      { key: "Paroxysmal_SVT", label: "Paroxysmal SVT", get: (x) => yn(has(x.s, "svt")) },
      { key: "Ventricular_Fibrillation", label: "Ventricular fibrillation" },
      { key: "Ventricular_Tachycardia", label: "Ventricular tachycardia", get: (x) => yn(has(x.s, "vt")) },
      { key: "Syndromes_Of_Sudden_Death", label: "Syndromes of sudden death" },
      { key: "Structural_Abnormalities", label: "Structural abnormalities" },
      { key: "Syncope", label: "Syncope (history)" },
      { key: "Prior_CIED", label: "Prior CIED", get: (x) => yn(has(x.s, "cied")) },
      { key: "Aortic_Valve_Procedure", label: "Aortic valve procedure" },
      { key: "Mitral_Valve_Procedure", label: "Mitral valve procedure" },
    ],
  },
  medSection("Home medications (the day before admission)", before, "Home_"),
  {
    title: "Investigations (this admission)",
    fields: [
      { key: "ECG_Performed", label: "ECG performed", get: (x) => yn(!!ecgOf(x)) },
      { key: "ECG_Time", label: "ECG date & time", get: (x) => { const e = ecgOf(x); return e ? { value: e.performed_at.slice(0, 16).replace("T", " "), note: "UTC: set the local time in the registry" } : null; } },
      { key: "ECG_Rhythm", label: "ECG rhythm", get: (x) => {
        const r = ecgOf(x)?.attributes?.rhythm as string | undefined;
        if (!r) return null;
        return { value: /sinus/i.test(r) ? "Sinus" : /fibrillation/i.test(r) ? "Atrial Fibrillation" : /flutter/i.test(r) ? "Atrial Flutter" : /paced/i.test(r) ? "Paced" : "Other", note: r };
      } },
      { key: "ST_Elevation", label: "ST elevation" },
      { key: "STEMI_Territory", label: "STEMI territory", get: (x) => { const c = x.s.conditions.find((c) => c.code === "acs-stemi"); const t = c?.attributes?.territory; return t && t !== "Unknown" ? { value: t } : null; } },
      { key: "Echo_Performed", label: "Echo performed", get: (x) => yn(!!echoOf(x)) },
      { key: "Echo_Date", label: "Echo date", get: (x) => { const e = echoOf(x); return e ? { value: day(e.performed_at) } : null; } },
      { key: "LVEF", label: "LVEF (%)", get: (x) => num(series(x, "lvef")[0], 0) },
      { key: "Regional_Wall_Motion_Abnormality", label: "Regional wall motion abnormality" },
      { key: "Stress_Test_Performed", label: "Stress / functional test", get: (x) => yn(x.s.studies.some((st) => st.kind === "stress" && day(st.performed_at) <= x.to && day(st.performed_at) >= addDays(x.from, -365))) },
      { key: "CTCA_Performed", label: "CT coronary angiography", get: (x) => yn(x.s.studies.some((st) => st.kind === "ccta" && day(st.performed_at) <= x.to && day(st.performed_at) >= addDays(x.from, -365))) },
      { key: "Sample_Date", label: "Lab sample date", get: (x) => { const o = ["haemoglobin", "creatinine", "hs-troponin", "ldl-c"].map((c) => series(x, c)[0]).filter(Boolean).sort((a, b) => a!.effective_at.localeCompare(b!.effective_at))[0]; return o ? { value: day(o.effective_at) } : null; } },
      { key: "Hemoglobin", label: "Baseline haemoglobin (g/dL)", get: first("haemoglobin", 1) },
      { key: "Hemoglobin_Nadir", label: "Nadir haemoglobin (g/dL)", get: extreme("haemoglobin", 1, "min") },
      { key: "WBC", label: "WBC (×10⁹/L)", get: first("wbc", 1) },
      { key: "Platelets", label: "Platelets (×10⁹/L)", get: first("platelets") },
      { key: "Creatinine", label: "Baseline creatinine (µmol/L)", get: first("creatinine") },
      { key: "Creatinine_Peak", label: "Peak creatinine (µmol/L)", get: extreme("creatinine", 0, "max") },
      { key: "eGFR", label: "Baseline eGFR", get: first("egfr") },
      { key: "Sodium", label: "Sodium (mmol/L)", get: first("sodium") },
      { key: "Potassium", label: "Potassium (mmol/L)", get: first("potassium", 1) },
      { key: "Glucose", label: "Glucose (mmol/L)", get: first("glucose", 1) },
      { key: "HbA1c", label: "HbA1c (%)", get: first("hba1c", 1) },
      { key: "Total_Cholesterol", label: "Total cholesterol (mmol/L)", get: first("total-cholesterol", 1) },
      { key: "LDL", label: "LDL (mmol/L)", get: first("ldl-c", 2) },
      { key: "HDL", label: "HDL (mmol/L)", get: first("hdl-c", 2) },
      { key: "Triglycerides", label: "Triglycerides (mmol/L)", get: first("triglycerides", 1) },
      { key: "Troponin", label: "Baseline hs-troponin (ng/L)", get: first("hs-troponin") },
      { key: "Troponin_Peak", label: "Peak hs-troponin (ng/L)", get: extreme("hs-troponin", 0, "max") },
      { key: "BNP", label: "BNP (pg/mL)" },
      { key: "NT_proBNP", label: "NT-proBNP (pg/mL)", get: first("nt-probnp") },
      { key: "CRP", label: "CRP (mg/L)", get: first("crp", 1) },
    ],
  },
  {
    title: "Procedure",
    fields: [
      { key: "Angio_Date", label: "Angiography date", get: (x) => (x.cath ? { value: day(x.cath.performed_at) } : x.pci ? { value: day(x.pci.performed_at), note: "PCI date" } : null) },
      { key: "Access_Site", label: "Access site", get: (x) => { const a = (x.pci?.attributes.access ?? x.cath?.attributes?.access) as string | undefined; return a ? { value: a, note: "side not recorded: choose right or left in the registry" } : null; } },
      { key: "Coronary_Dominance", label: "Coronary dominance" },
      { key: "Procedure_Urgency", label: "Procedure urgency", get: (x) => { const st = x.pci?.attributes.setting; return st ? { value: st === "stemi" ? "Emergent / salvage" : st === "nste-acs" ? "Urgent" : "Elective" } : null; } },
      ...(["Left_Main:lm:Left main", "LAD:lad:LAD", "LCX:lcx:LCx", "RCA:rca:RCA"].map((v) => {
        const [k, f, label] = v.split(":");
        return { key: `${k}_Disease`, label: `${label} disease`, get: (x: Ctx) => { const s = x.cath?.attributes?.[f] as string | undefined; return s ? yn(f === "lm" ? ["50–69%", "70–99%", "Occluded"].includes(s) : ["70–99%", "Occluded"].includes(s)) : null; } } as Field;
      })),
      { key: "Number_Diseased_Vessels", label: "Number of diseased vessels", get: (x) => { if (!x.cath) return null; const o = obstructiveCad("cath", x.cath.attributes ?? {}); const n = ["lad", "lcx", "rca"].filter((f) => ["70–99%", "Occluded"].includes(x.cath!.attributes?.[f])).length; return { value: String(n), note: o ?? "no obstructive disease" }; } },
      { key: "Door_to_Balloon_Min", label: "Door-to-balloon (min)" },
      { key: "Management_Decision", label: "Result of angiography", get: (x) => {
        if (x.pci) return { value: "PCI" };
        const o = x.cath?.attributes?.outcome as string | undefined;
        return o ? { value: o === "Referred for CABG" ? "CABG" : o === "Medical therapy" ? "Medical therapy only" : o === "PCI performed" ? "PCI" : "Deferred / no intervention", note: o } : null;
      } },
      { key: "PCI_Date", label: "PCI date", get: (x) => (x.pci ? { value: day(x.pci.performed_at) } : null) },
      { key: "P2Y12_Loading_Location", label: "P2Y12 loading location" },
      { key: "Culprit_Vessel", label: "Culprit vessel", get: (x) => { const v = (x.pci?.attributes.vessels ?? []) as string[]; return x.pci && v.length === 1 && x.pci.attributes.setting !== "elective" ? { value: v[0], note: "the only vessel treated" } : null; } },
      { key: "Procedure_Success", label: "Procedure success" },
      { key: "Complete_Revascularization", label: "Complete revascularisation" },
      { key: "Staged_PCI_Planned", label: "Staged PCI planned", get: (x) => (x.pci ? yn(x.s.plan.some((p) => /staged PCI/i.test(p.title) && p.status !== "cancelled")) : null) },
      { key: "Staged_PCI_Date", label: "Staged PCI date", get: (x) => { const p = x.s.plan.find((p) => /staged PCI/i.test(p.title) && p.status === "planned"); return p?.due_date ? { value: p.due_date, note: "planned by this date" } : null; } },
      { key: "Vessel_Treated", label: "Vessel(s) treated", get: (x) => (x.pci ? { value: ((x.pci.attributes.vessels ?? []) as string[]).join(", ") } : null) },
      { key: "Total_Stents", label: "Total stents", get: (x) => (x.pci?.attributes.stents != null ? { value: String(x.pci.attributes.stents) } : x.pci && x.pci.attributes.device !== "Drug-eluting stent" ? { value: "0", note: x.pci.attributes.device } : null) },
    ],
  },
  {
    title: "In-hospital complications",
    fields: [
      inHosp("Cardiogenic_Shock_InHospital", "Cardiogenic shock", /shock/i),
      inHosp("Cardiac_Arrest_InHospital", "Cardiac arrest", /cardiac arrest/i),
      inHosp("Mechanical_Ventilation", "Mechanical ventilation", /ventilation/i),
      inHosp("Sustained_VT_VF", "Sustained VT / VF", /VT|VF/),
      inHosp("New_Atrial_Fibrillation", "New atrial fibrillation", /new AF/i),
      inHosp("Major_Bleeding", "Major bleeding", /bleeding/i),
      inHosp("Stroke_TIA_InHospital", "Stroke / TIA", /stroke|TIA/i),
      inHosp("Infection_Sepsis", "Infection / sepsis", /infection|sepsis/i),
      { key: "Death_In_Hospital", label: "Death in hospital", get: (x) => (x.discharged ? yn((x.adm?.summary as any)?.outcome === "died") : null) },
      { key: "Recurrent_Ischemia_Angina", label: "Recurrent ischaemia / angina" },
      { key: "Reinfarction", label: "Reinfarction" },
      { key: "Acute_Heart_Failure", label: "Acute heart failure" },
      { key: "Subacute_Stent_Thrombosis", label: "Subacute stent thrombosis" },
      { key: "BARC_Bleeding_Grade", label: "BARC bleeding grade" },
      { key: "Blood_Transfusion", label: "Blood transfusion" },
      { key: "Procedural_Complications", label: "Cath-lab complications (access, dissection, no-reflow…)" },
    ],
  },
  {
    title: "Discharge",
    fields: [
      { key: "In_Hospital_Outcome", label: "Discharge status", get: (x) => (x.discharged ? { value: (x.adm?.summary as any)?.outcome === "died" ? "In-hospital death" : "Survived to discharge" } : x.adm ? { value: "In hospital", note: "not discharged yet" } : null) },
      { key: "Discharge_Date", label: "Date of discharge / death", get: (x) => (x.dischargeDay ? { value: x.dischargeDay } : null) },
      { key: "Discharge_Type", label: "Discharge type", get: (x) => {
        const d = (x.adm?.summary as any)?.destination as string | undefined;
        if (!x.discharged || !d) return null;
        return /against/i.test(d) ? { value: "LAMA" } : /^Home/i.test(d) ? { value: "Home", note: d } : { value: "Transfer to other dept", note: `CardioFlow: ${d} — check the registry option` };
      } },
      { key: "DAPT_Not_Prescribed_Reason", label: "Reason DAPT not prescribed", get: (x) => {
        const at = atDischarge(x);
        if (!at || !x.pci) return null;
        const m = medsAt(x.s, at);
        const dapt = m.some((y) => y.m.code === "aspirin") && m.some((y) => y.m.tags.includes("p2y12"));
        if (dapt) return null;
        if (m.some((y) => y.m.tags.includes("oac"))) return { value: "Oral anticoagulation strategy", note: "anticoagulant at discharge" };
        if (x.pci.attributes.device !== "Drug-eluting stent") return { value: "No stents implanted" };
        return null;
      } },
    ],
  },
  medSection("Discharge medications", atDischarge, "Discharge_"),
  {
    title: "Lesions & follow-up",
    fields: [
      { key: "Lesion_PCI_Details", label: "Lesion-level PCI form (target vessel, segment, TIMI flow, devices…)" },
      { key: "FollowUp_Comprehensive", label: "Follow-up visits (MACE, reintervention, staged PCI)" },
    ],
  },
];

const ecgOf = (x: Ctx) => x.s.studies.filter((st) => st.kind === "ecg" && day(st.performed_at) >= x.from && day(st.performed_at) <= x.to).sort((a, b) => a.performed_at.localeCompare(b.performed_at))[0] ?? null;
const echoOf = (x: Ctx) => x.s.studies.filter((st) => st.kind === "echo" && day(st.performed_at) >= x.from && day(st.performed_at) <= x.to).sort((a, b) => a.performed_at.localeCompare(b.performed_at))[0] ?? null;

// The index record: the latest PCI, else the latest angiography, else the latest ACS admission.
export function cadIndex(s: PatientState): Ctx | null {
  const pci = [...s.procedures].reverse().find((p) => p.kind === "pci") ?? null;
  const cath = [...s.studies].reverse().find((st) => st.kind === "cath") ?? null;
  const acsAdm = [...s.contexts].reverse().find((c) => c.kind === "admission" && c.reasons.some((r) => /STEMI|NSTE/i.test(r))) ?? null;
  const at = pci ? day(pci.performed_at) : cath ? day(cath.performed_at) : acsAdm ? day(acsAdm.started_at) : null;
  if (!at) return null;
  // the admission that contains the index day
  const adm = [...s.contexts].reverse().find((c) => c.kind === "admission" && day(c.started_at) <= at && (!c.ended_at || day(c.ended_at) >= at)) ?? null;
  // the angiography of the same admission (or the same day) goes with a PCI
  const cathHere = pci ? (s.studies.filter((st) => st.kind === "cath" && Math.abs(Date.parse(day(st.performed_at)) - Date.parse(at)) <= 3 * 86400000).pop() ?? null) : cath;
  const discharged = !!adm?.ended_at;
  const dischargeDay = adm?.ended_at ? day(adm.ended_at) : null;
  const from = adm ? addDays(day(adm.started_at), -1) : addDays(at, -30);
  const to = adm ? (dischargeDay ?? s.today) : addDays(at, 1);
  return { s, at, pci, cath: cathHere, adm, from, to, discharged, dischargeDay };
}

export function cadRegistryProjection(s: PatientState) {
  const x = cadIndex(s);
  if (!x) return null;
  const sections = CAD_REGISTRY.map((sec) => ({
    title: sec.title,
    fields: sec.fields.map((f) => {
      const v = f.get ? f.get(x) : null;
      return { key: f.key, label: f.label, mapped: !!f.get, value: v?.value ?? null, at: v?.at ? fmtDay(v.at, { year: true }) : null, note: v?.note ?? null };
    }),
  }));
  const all = sections.flatMap((y) => y.fields);
  const mapped = all.filter((f) => f.mapped);
  const filled = mapped.filter((f) => f.value != null);
  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const index = x.pci
    ? `PCI ${fmtDay(x.pci.performed_at, { year: true })} · ${x.pci.summary}`
    : x.cath ? `Coronary angiography ${fmtDay(x.cath.performed_at, { year: true })}` : `ACS admission ${fmtDay(x.adm!.started_at, { year: true })}`;
  return {
    registry: "CAD Registry",
    index,
    admission: x.adm ? { from: day(x.adm.started_at), to: x.dischargeDay, open: !x.discharged } : null,
    sections,
    counts: { mapped: mapped.length, filled: filled.length, registryOnly: all.length - mapped.length },
    csv: filled.map((f) => f.key).join(",") + "\n" + filled.map((f) => csvCell(f.value!)).join(","),
  };
}

// The CAD registry as a whole: every patient with a PCI, an angiography or an ACS admission.
export function cadRegistryCohort(states: PatientState[]) {
  const mappedKeys = CAD_REGISTRY.flatMap((sec) => sec.fields.filter((f) => f.get).map((f) => f.key));
  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = states
    .map((s) => ({ s, p: cadRegistryProjection(s) }))
    .filter((y): y is { s: PatientState; p: NonNullable<ReturnType<typeof cadRegistryProjection>> } => !!y.p)
    .map(({ s, p }) => {
      const fields = p.sections.flatMap((y) => y.fields).filter((f) => f.mapped);
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
      return {
        id: s.patient.id, name: s.patient.name, mrn: s.patient.mrn,
        type: byKey.Presentation_Type ?? "—", index: p.index,
        filled: p.counts.filled, mapped: p.counts.mapped,
        missing: fields.filter((f) => f.value == null).map((f) => f.label),
        cells: mappedKeys.map((k) => byKey[k] ?? ""),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  const filled = rows.reduce((n, r) => n + r.filled, 0), mapped = rows.reduce((n, r) => n + r.mapped, 0);
  return {
    registry: "CAD Registry",
    counts: { patients: rows.length, byType, filledPct: mapped ? Math.round((filled / mapped) * 100) : null },
    patients: rows.map(({ cells, ...r }) => r),
    csv: [mappedKeys.join(","), ...rows.map((r) => r.cells.map((c) => (c ? csvCell(c) : "")).join(","))].join("\n"),
  };
}
