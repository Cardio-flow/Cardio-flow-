// EP Registry projection (rhythm & devices module, slice 5): the MKH EPS Registry case report form
// (github.com/MKH-Cardiology/EPS-registry-MKH, index.html — build 2026-08-03, Draft 17; one record
// per EP-lab admission) mapped to the CardioFlow record. Read-only, like the HF and CAD registry
// projections: CardioFlow fills what it already holds, under the registry's own Excel/SPSS variable
// names (MODEL_EXPORT) and stored option wording; each categorical value also carries the
// registry's SPSS code (VALUE_CODES), Yes/No as 1/0. Everything else is listed as registry-only.
// Nothing is written to the registry from here.
//
// The index record is the latest device procedure (implant, upgrade, generator change, lead revision
// or extraction; loop recorders are not captured by the registry) or catheter ablation, with the
// admission that contains it. Home medicines are those active the day before admission, discharge
// medicines those active on the day of discharge. Where CardioFlow's vocabulary is coarser than the
// registry's (ICD chamber, His vs left bundle pacing, atypical flutter vs atrial tachycardia), the
// field is left empty with a note rather than guessed.
import { formatNumber } from "../../shared/catalog.js";
import { addDays, ageOn, fmtDay, localDay } from "../../shared/clinical.js";
import { CIED_TYPE } from "../../shared/procedures.js";
import type { ContextRow, Obs, PatientState, ProcedureRow, StudyRow } from "../kernel/state.js";
import { NAT, medsAt } from "./cad-registry.js";
import { cha2ds2va } from "./guidelines.js";

type Val = { value: string; at?: string | null; note?: string; na?: boolean } | null;
// a field whose parent answer does not apply (the registry hides it): not shown, not counted
const NA: Val = { value: "", na: true };
type Field = { key: string; label: string; get?: (x: Ctx) => Val };
type Section = { title: string; fields: Field[] };
type Reason = "CRT/AICD" | "Pacemaker" | "EPS/Ablation" | "CIED Extraction";
type Ctx = {
  s: PatientState;
  at: string; // procedure day (local)
  proc: ProcedureRow;
  reason: Reason;
  adm: ContextRow | null;
  from: string;
  to: string;
  discharged: boolean;
  dischargeDay: string | null;
};

// the registry's SPSS codes (VALUE_CODES) for the categorical fields mapped here
const CODES: Record<string, Record<string, number>> = {
  Gender: { Male: 1, Female: 2 },
  Reason_EPlab: { "CRT/AICD": 1, Pacemaker: 2, "EPS/Ablation": 3, LAAO: 4, "CIED Extraction": 5 },
  PacemakerType: { "Temporary pacemaker": 1, "Permanent pacemaker": 2, "Temporary followed by permanent same hospitalization": 3 },
  PatientOrigin: { "Outpatient (Home/Cardiology clinic)": 1, "Transferred from another hospital": 2, "Same hospital, inpatient, but another department": 3 },
  Hx_AFibClass: { "Persistent (>7 days)": 1, "Paroxysmal (terminating spontaneously within 7 days)": 2, "Long standing persistent (>1 year)": 3, Permanent: 4 },
  Hx_AFib_CHA2DS2: { "0": 0, "1": 1, "2": 2, "3": 3, ">3": 4 },
  Hx_Cardiomyopathy_TimeFrame: { "< 3 months": 1, "≥ 3 months": 2 },
  Hx_HFtype: { HFrEF: 1, HFpEF: 2, HFmrEF: 3 },
  Hx_AVPtype: { TAVR: 1, SAVR: 2 },
  Hx_MVPtype: { PMVR: 1, "Mechanical mitral valve": 2, "Bioprosthetic mitral valve": 3, "Mitral clipping": 4 },
  Hx_CIEDdevice_Type: {
    "Single chamber transvenous PPM": 1, "Dual chamber transvenous PPM": 2, "CRT-P": 3, "Leadless single chamber PPM": 4, "Leadless dual chamber PPM": 5, "His bundle PPM": 6,
    "Left bundle area PPM": 7, "ICD single chamber": 8, "ICD dual chamber": 9, "CRT-D": 10, "Extravascular ICD": 11, "S-ICD (Sub Q)": 12, Unknown: 13,
  },
  Invest_ECG_AtrialRhytm: {
    Sinus: 1, "Atrial fibrillation": 2, "Atrial flutter": 3, SVT: 4, "Atrial tachycardia": 5, "Atrial paced": 6, "Sinus arrest": 7, "Sinus pause": 8, "1st degree AV block": 9,
    "2nd degree AV block, Mobitz I": 10, "2nd degree AV block, Mobitz II": 11, "3rd degree AV block": 12, "Unknown rhythm": 13,
  },
  Invest_ECG_VentriRhytm: { Normal: 1, VT: 2, VF: 3, LBBB: 4, RBBB: 5, "Alternating LBBB/RBBB": 6, "IVCD delay": 7, "Frequent PVCs": 8 },
  Invest_Holtr_AtrialRhytm: { Sinus: 1, "Atrial fibrillation": 2, "Atrial flutter": 3, SVT: 4, "Atrial tachycardia": 5, "Atrial paced": 6, "Sinus arrest": 7, "Sinus pause": 8, "1st degree AV block": 9, "2nd degree AV block": 10, "3rd degree AV block": 11, "Unknown rhythm": 12 },
  Invest_Holtr_VentriRhytm: { Normal: 1, "Non-sustained VT": 2, "Sustained VT": 3, "Frequent PVCs": 4, "PVCs burden >10%": 5 },
  Proc_CRT_DevImplant_Type: { "CRT-D": 1, "ICD-Dual chamber": 2, "ICD-single chamber": 3, "Extra vascular ICD": 4, "Sub cutaneous ICD": 5, CRT: 6 },
  Proc_CRT_Lead_ExistingStatus: { Extracted: 1, Abandoned: 2, Reused: 3 },
  Proc_PPM_DevImpl_Type: { "Single chamber transvenous PPM": 1, "Dual chamber transvenous PPM": 2, "Leadless single chamber PPM": 3, "Leadless dual chamber PPM": 4, "His-bundle PPM": 5, "Leadless LVEP": 6, CCM: 7, "LBBB PPM": 8 },
  Proc_PPMIndications: { "2:1 AV block": 1, "2° AV block, Mobitz II": 2, "A-V node ablation": 3, ">40% RV pacing": 4, "Chronotropic incompetence": 5, CHB: 6, SSS: 7, "Significant pause": 8 },
  Proc_PPM_Lead_ExistingStatus: { Extracted: 1, Abandoned: 2, Reused: 3 },
  Proc_EPS_Reason: { SVT: 1, "Atrial flutter": 2, "Atrial fibrillation": 3, VT: 4, PVCs: 5, "Atypical atrial flutter": 6, "Atrial Tachycardia": 7, "AV node ablation": 8 },
  Proc_CIEDX_Device: { "Single chamber pacemaker": 1, "Dual chamber pacemaker": 2, "CRT-P": 3, "Single chamber ICD": 4, "Dual chamber ICD": 5, "CRT-D": 6, "S-ICD": 7, "Leadless pacemaker": 8, Other: 9 },
  Outcom_PostProcECGRhythm: { Sinus: 1, "Paced rhythm": 2, "Atrial fibrillation": 3, "Atrial flutter": 4, Other: 5 },
  Discharge_Status: { Dead: 1, Alive: 2 },
  Discharge_Type: { Home: 1, "Left against Medical Advice (LAMA)": 2, "Transfer to cardiac surgery department": 3, "Transfer to another Medical/general surgery department": 4 },
};
// numbers, dates and text keep their value; Yes/No is 1/0; other categories use the code table
export function spssCode(key: string, value: string | null): string {
  if (value == null) return "";
  if (CODES[key]) return CODES[key][value] != null ? String(CODES[key][value]) : "";
  if (value === "Yes") return "1";
  if (value === "No") return "0";
  return value;
}

const yn = (b: boolean, note?: string): Val => ({ value: b ? "Yes" : "No", note });
const has = (s: PatientState, ...codes: string[]) => s.conditions.some((c) => codes.includes(c.code) && c.status !== "entered_in_error");
const day = (iso: string) => localDay(iso);
const series = (x: Ctx, code: string) =>
  x.s.observations
    .filter((o) => o.code === code && o.status !== "entered_in_error" && o.value_num != null && day(o.effective_at) >= x.from && day(o.effective_at) <= x.to)
    .sort((a, b) => a.effective_at.localeCompare(b.effective_at));
const num = (o: Obs | undefined, d: number, k = 1): Val => (o ? { value: formatNumber(o.value_num! * k, d).replace(/,/g, ""), at: o.effective_at } : null);
const first = (code: string, d = 0, k = 1): Field["get"] => (x) => num(series(x, code)[0], d, k);
const extreme = (code: string, d: number, which: "min" | "max"): Field["get"] => (x) => {
  const v = series(x, code);
  if (v.length < 2) return null;
  return num(v.reduce((a, b) => ((which === "min" ? b.value_num! < a.value_num! : b.value_num! > a.value_num!) ? b : a)), d);
};
const before = (x: Ctx) => `${addDays(x.adm ? day(x.adm.started_at) : x.at, -1)}T23:59:59Z`;
const atDischarge = (x: Ctx) => (x.discharged ? `${x.dischargeDay}T23:59:59Z` : null);
const priorProcs = (x: Ctx, kind: string) => x.s.procedures.filter((p) => p.kind === kind && p.id !== x.proc.id && day(p.performed_at) < x.at);
const onsetBefore = (x: Ctx, codes: string[]) =>
  x.s.conditions.filter((c) => codes.includes(c.code) && ((c.onset && day(c.onset) <= x.at) || (!c.onset && (!c.attributes?.onsetYear || `${c.attributes.onsetYear}-01-01` <= x.at))));
const events = (x: Ctx) => (((x.adm?.summary as any)?.events as string[] | undefined) ?? []);
const inHosp = (key: string, label: string, re: RegExp): Field => ({ key, label, get: (x) => (x.discharged ? yn(events(x).some((e) => re.test(e))) : null) });
const initial = (n: string | undefined) => (n ? n.replace(/^Al-/i, "")[0]?.toUpperCase() ?? null : null);
const studyIn = (x: Ctx, kind: string, back = 30) =>
  x.s.studies.filter((st) => st.kind === kind && day(st.performed_at) >= addDays(x.from, -back) && day(st.performed_at) <= x.at).sort((a, b) => b.performed_at.localeCompare(a.performed_at))[0] ?? null;
const isDevice = (x: Ctx) => x.reason === "CRT/AICD" || x.reason === "Pacemaker";
const A = (x: Ctx) => x.proc.attributes as Record<string, any>;

// registry device type for a CardioFlow device record (null when CardioFlow cannot tell)
const PRIOR_TYPE: Record<string, string> = {
  "Pacemaker (single chamber)": "Single chamber transvenous PPM", "Pacemaker (dual chamber)": "Dual chamber transvenous PPM", "Leadless pacemaker": "Leadless single chamber PPM",
  "Subcutaneous ICD": "S-ICD (Sub Q)", "CRT-P": "CRT-P", "CRT-D": "CRT-D",
};
const EXTRACT_TYPE: Record<string, string> = {
  "Pacemaker (single chamber)": "Single chamber pacemaker", "Pacemaker (dual chamber)": "Dual chamber pacemaker", "Leadless pacemaker": "Leadless pacemaker",
  "Subcutaneous ICD": "S-ICD", "CRT-P": "CRT-P", "CRT-D": "CRT-D",
};
// what the leads were in this procedure, from the device action
const leads = (x: Ctx) => {
  const act = A(x).action as string;
  return {
    newLead: act === "New implant" || act === "Upgrade" || act === "Lead revision",
    existing: act !== "New implant",
    status: act === "Generator change" || act === "Upgrade" ? "Reused" : null,
    additional: act === "Upgrade",
    act,
  };
};
const leadFields = (p: "CRT" | "PPM", reason: Reason): Field[] => [
  { key: `Proc_${p}_LeadAssess_New`, label: "New lead", get: (x) => (x.reason === reason ? yn(leads(x).newLead, leads(x).act) : NA) },
  { key: `Proc_${p}_LeadAssess_Existing`, label: "Existing lead", get: (x) => (x.reason === reason ? yn(leads(x).existing, leads(x).act) : NA) },
  { key: `Proc_${p}_Lead_ExistingStatus`, label: "Existing lead status", get: (x) => (x.reason !== reason || !leads(x).existing ? NA : leads(x).status ? { value: leads(x).status!, note: leads(x).act } : { value: null as any, note: `${leads(x).act}: extracted, abandoned or reused` }) },
  { key: `Proc_${p}_Lead_Additional`, label: "Additional lead to the existing leads", get: (x) => (x.reason === reason ? yn(leads(x).additional, leads(x).act) : NA) },
];

const MEDS: [string, string, (code: string, tags: string[]) => boolean][] = [
  ["Amiodarone", "Amiodarone", (c) => c === "amiodarone"], ["Disopyramide", "Disopyramide", (c) => c === "disopyramide"], ["Flecainide", "Flecainide", (c) => c === "flecainide"],
  ["Procainamide", "Procainamide", (c) => c === "procainamide"], ["Propafenone", "Propafenone", (c) => c === "propafenone"], ["Sotalol", "Sotalol", (c) => c === "sotalol"],
  ["Dofetilide", "Dofetilide", (c) => c === "dofetilide"], ["Dronaderone", "Dronedarone", (c) => c === "dronedarone"], ["Verapamil", "Verapamil", (c) => c === "verapamil"],
  ["Diltiazem", "Diltiazem", (c) => c === "diltiazem"], ["Warfarin", "Warfarin", (c) => c === "warfarin"], ["Dabigatran", "Dabigatran", (c) => c === "dabigatran"],
  ["Apixaban", "Apixaban", (c) => c === "apixaban"], ["Rivaroxaban", "Rivaroxaban", (c) => c === "rivaroxaban"], ["Edoxaban", "Edoxaban", (c) => c === "edoxaban"],
  ["LMWH", "Low MW heparin", (c) => c === "enoxaparin"], ["Aspirin", "Aspirin", (c) => c === "aspirin"], ["Prasugrel", "Prasugrel", (c) => c === "prasugrel"],
  ["Clopidogrel", "Clopidogrel", (c) => c === "clopidogrel"], ["Ticagrelor", "Ticagrelor", (c) => c === "ticagrelor"], ["ACEi", "ACE-I", (_c, t) => t.includes("acei")],
  ["ARB", "ARB", (_c, t) => t.includes("arb")], ["ARNI", "ARNI", (_c, t) => t.includes("arni")], ["SGLT2i", "SGLT2-inhibitor", (_c, t) => t.includes("sglt2")],
  ["BetaBlock", "Beta Blockers", (_c, t) => t.includes("bb") || t.includes("bb-other")], ["MRA", "MRA", (_c, t) => t.includes("mra")], ["Digoxin", "Digoxin", (c) => c === "digoxin"],
  ["LoopDiuretics", "Loop diuretics", (_c, t) => t.includes("loop")], ["Ivabradine", "Ivabradine", (c) => c === "ivabradine"],
];
const medSection = (title: string, prefix: string, when: (x: Ctx) => string | null): Section => ({
  title,
  fields: MEDS.map(([k, label, test]) => ({ key: `${prefix}${k}`, label, get: (x: Ctx) => { const at = when(x); return at ? yn(medsAt(x.s, at).some((y) => test(y.m.code, y.m.tags))) : null; } })),
});

export const EPS_REGISTRY: Section[] = [
  {
    title: "Identification",
    fields: [
      { key: "PatientFirstName", label: "1.1 Name initial (first)", get: (x) => { const i = initial(x.s.patient.name.split(/\s+/)[0]); return i ? { value: i } : null; } },
      { key: "PatientMiddleName", label: "1.1 Name initial (middle)", get: (x) => { const p = x.s.patient.name.split(/\s+/); return p.length >= 3 ? { value: initial(p[1])! } : null; } },
      { key: "PatientLastName", label: "1.1 Name initial (last)", get: (x) => { const p = x.s.patient.name.split(/\s+/); return p.length >= 2 ? { value: initial(p[p.length - 1])!, note: p[p.length - 1] } : null; } },
      { key: "Civil_ID", label: "1.2 Civil ID", get: (x) => (x.s.patient.civil_id ? { value: x.s.patient.civil_id } : null) },
      { key: "CRF_No", label: "1.3 CRF number" },
      { key: "Gender", label: "1.4 Gender", get: (x) => ({ value: x.s.patient.sex }) },
      { key: "Nationality", label: "1.5 Nationality", get: (x) => { const n = x.s.patient.nationality; return n ? { value: NAT[n] ?? n, note: NAT[n] ? undefined : "check against the registry list" } : null; } },
      { key: "YOB", label: "1.6 Year of birth", get: (x) => ({ value: x.s.patient.birth_date.slice(0, 4) }) },
      { key: "EstimatedAge", label: "1.6a Age", get: (x) => ({ value: String(ageOn(x.s.patient.birth_date, x.adm ? day(x.adm.started_at) : x.at)) }) },
      { key: "AdmissionDate", label: "1.7 Hospital admission date", get: (x) => ({ value: x.adm ? day(x.adm.started_at) : x.at, note: x.adm ? undefined : "no admission recorded: procedure date" }) },
      { key: "PatientContact", label: "1.8 Patient contact", get: (x) => (x.s.patient.mobile ? { value: x.s.patient.mobile } : null) },
      { key: "RelativeContact", label: "1.9 Relative contact" },
    ],
  },
  {
    title: "Reason for EP lab & admission",
    fields: [
      { key: "Reason_EPlab", label: "2. Coming to the EP lab because of", get: (x) => ({ value: x.reason, note: x.proc.summary }) },
      { key: "PacemakerType", label: "2.1 Pacemaker type", get: (x) => (x.reason === "Pacemaker" ? { value: "Permanent pacemaker" } : NA) },
      { key: "PatientOrigin", label: "3.1 Patient origin", get: (x) => {
        const r = (x.adm?.summary as any)?.route as string | undefined;
        if (!r) return null;
        if (/transfer/i.test(r)) return { value: "Transferred from another hospital" };
        return { value: "Outpatient (Home/Cardiology clinic)", note: /emergency/i.test(r) ? "CardioFlow: emergency department — check" : `CardioFlow: ${r}` };
      } },
    ],
  },
  {
    title: "History & risk factors",
    fields: [
      { key: "Hx_AFib", label: "4.1 Atrial fibrillation", get: (x) => yn(onsetBefore(x, ["af"]).length > 0) },
      { key: "Hx_AFibClass", label: "4.1a AF classification", get: (x) => {
        if (!onsetBefore(x, ["af"]).length) return NA;
        const p = onsetBefore(x, ["af"])[0]?.attributes?.pattern as string | undefined;
        if (!p) return null;
        const map: Record<string, string> = { Paroxysmal: "Paroxysmal (terminating spontaneously within 7 days)", Persistent: "Persistent (>7 days)", Permanent: "Permanent" };
        return map[p] ? { value: map[p] } : { value: null as any, note: `CardioFlow: ${p.toLowerCase()} — classify in the registry` };
      } },
      { key: "Hx_AFib_EHRAclass", label: "4.1b EHRA symptom class" },
      { key: "Hx_AFib_Cardioversion", label: "4.1c Plans for cardioversion", get: (x) => (onsetBefore(x, ["af"]).length ? yn(x.s.plan.some((p) => p.status === "planned" && /^Cardioversion/.test(p.title)), "a planned cardioversion in CardioFlow") : NA) },
      { key: "Hx_AFib_PriorAblation", label: "4.1f Prior ablation attempt", get: (x) => (onsetBefore(x, ["af"]).length ? yn(priorProcs(x, "ablation").some((p) => (p.attributes.targets ?? []).some((t: string) => /^AF/.test(t)))) : NA) },
      { key: "Hx_AFib_CHA2DS2", label: "4.1d CHA₂DS₂-VA score", get: (x) => { if (!onsetBefore(x, ["af"]).length) return NA; const sc = cha2ds2va(x.s).score; return { value: sc > 3 ? ">3" : String(sc), note: `score ${sc}, today's record` }; } },
      { key: "Hx_AFib_HASBLED", label: "4.1e HAS-BLED score" },
      { key: "Hx_AFib_OACcontraind", label: "4.1g Contraindication to long-term OAC" },
      { key: "Hx_AFib_PriorMajBleed", label: "4.1h Prior major bleeding" },
      { key: "Hx_CardiacArrest", label: "4.2 Cardiac arrest" },
      { key: "Hx_Cardiomyopathy", label: "4.3 Cardiomyopathy", get: (x) => (onsetBefore(x, ["hfref", "hfmref", "hfimpef"]).length ? { value: "Yes", note: "HF with reduced EF" } : null) },
      { key: "Hx_Cardiomyopathy_TimeFrame", label: "4.3a Timeframe", get: (x) => {
        const c = onsetBefore(x, ["hfref", "hfmref", "hfimpef"])[0];
        if (!c) return NA;
        const since = c.onset ? day(c.onset) : c.attributes?.onsetYear ? null : null;
        if (!since) return c.attributes?.onsetYear && Number(c.attributes.onsetYear) < Number(x.at.slice(0, 4)) ? { value: "≥ 3 months", note: `since ${c.attributes.onsetYear}` } : null;
        return { value: addDays(since, 91) <= x.at ? "≥ 3 months" : "< 3 months", note: `since ${fmtDay(since, { year: true })}` };
      } },
      { key: "Hx_Cardiomyopathy_GDMTDose", label: "4.3b GDMT at maximum dose" },
      { key: "Hx_HF", label: "4.4 Heart failure", get: (x) => yn(onsetBefore(x, ["hfref", "hfmref", "hfpef", "hfimpef"]).length > 0) },
      { key: "Hx_HFtype", label: "4.4a HF type", get: (x) => {
        const c = onsetBefore(x, ["hfref", "hfmref", "hfpef", "hfimpef"])[0];
        if (!c) return NA;
        return c.code === "hfref" ? { value: "HFrEF" } : c.code === "hfmref" ? { value: "HFmrEF" } : c.code === "hfpef" ? { value: "HFpEF" } : { value: null as any, note: "HF with improved EF — classify in the registry" };
      } },
      { key: "Hx_CoronaryAngio_CA", label: "4.5 Coronary angiography", get: (x) => yn(x.s.studies.some((st) => st.kind === "cath" && day(st.performed_at) <= x.at) || priorProcs(x, "pci").length > 0) },
      { key: "Hx_CA_6months", label: "4.5a Angiography within 6 months", get: (x) => {
        const d = [...x.s.studies.filter((st) => st.kind === "cath"), ...priorProcs(x, "pci")].map((y) => day(y.performed_at)).filter((d) => d <= x.at).sort().pop();
        return d ? yn(d >= addDays(x.at, -182), fmtDay(d, { year: true })) : NA;
      } },
      { key: "Hx_CAD", label: "4.6 Coronary artery disease", get: (x) => yn(x.s.tags.has("cad")) },
      { key: "Hx_MI", label: "4.7 Myocardial infarction", get: (x) => yn(has(x.s, "prior-mi", "acs-stemi", "acs-nstemi")) },
      { key: "Hx_PriorPCI", label: "4.8 Prior PCI", get: (x) => yn(has(x.s, "prior-pci") || priorProcs(x, "pci").length > 0) },
      { key: "Hx_PriorPCI_6months", label: "4.8a PCI within 6 months", get: (x) => { const d = priorProcs(x, "pci").map((p) => day(p.performed_at)).sort().pop(); return d ? yn(d >= addDays(x.at, -182), fmtDay(d, { year: true })) : has(x.s, "prior-pci") ? null : NA; } },
      { key: "Hx_PriorCABG", label: "4.9 Prior CABG", get: (x) => yn(has(x.s, "prior-cabg") || priorProcs(x, "cabg").length > 0) },
      { key: "Hx_PriorCABG_6months", label: "4.9a CABG within 6 months", get: (x) => { const d = priorProcs(x, "cabg").map((p) => day(p.performed_at)).sort().pop(); return d ? yn(d >= addDays(x.at, -182), fmtDay(d, { year: true })) : has(x.s, "prior-cabg") ? null : NA; } },
      { key: "Hx_ValvularHeartDisease", label: "4.10 Valvular heart disease", get: (x) => yn(has(x.s, "as", "ar", "mr-primary", "mr-secondary", "ms", "tr", "prosthetic-valve")) },
      { key: "Hx_CerebrovascularDisease", label: "4.11 Cerebrovascular disease", get: (x) => yn(has(x.s, "stroke-tia")) },
      { key: "Hx_ChronicLungDisease", label: "4.12 Chronic lung disease", get: (x) => yn(has(x.s, "copd")) },
      { key: "Hx_OnDialysis", label: "4.13 On dialysis", get: (x) => yn(has(x.s, "dialysis")) },
      { key: "Hx_DiabetesMellitus", label: "4.14 Diabetes mellitus", get: (x) => yn(has(x.s, "t2dm", "t1dm", "dm-other")) },
      { key: "Hx_Hypertension", label: "4.15 Hypertension", get: (x) => yn(has(x.s, "htn")) },
      { key: "Hx_FamilialSyndrome", label: "4.16 Familial syndrome" },
      { key: "Hx_SyndromSuddenDeath", label: "4.17 Syndromes of sudden death" },
      { key: "Hx_StructurAbnormaliti_StAb", label: "4.18 Structural abnormalities" },
      { key: "Hx_Syncope", label: "4.19 Syncope", get: (x) => (x.adm ? yn(((x.adm.summary as any)?.symptoms ?? []).some((v: string) => /syncope/i.test(v)) || x.adm.reasons.includes("Syncope"), "this admission") : null) },
      { key: "Hx_ParoxysmalSVT", label: "4.20 Paroxysmal SVT", get: (x) => yn(has(x.s, "svt")) },
      { key: "Hx_VF", label: "4.21 Ventricular fibrillation" },
      { key: "Hx_VT", label: "4.22 Ventricular tachycardia", get: (x) => yn(has(x.s, "vt")) },
      { key: "Hx_AVP", label: "4.23 Aortic valve procedure", get: (x) => yn(x.s.conditions.some((c) => c.code === "prosthetic-valve" && c.attributes?.position === "Aortic")) },
      { key: "Hx_AVPtype", label: "4.23a Type", get: (x) => {
        const c = x.s.conditions.find((y) => y.code === "prosthetic-valve" && y.attributes?.position === "Aortic");
        if (!c) return NA;
        return c.attributes.type === "TAVI" ? { value: "TAVR" } : /Mechanical|Bioprosthetic/.test(c.attributes.type ?? "") ? { value: "SAVR", note: c.attributes.type } : null;
      } },
      { key: "Hx_MVP", label: "4.24 Mitral valve procedure", get: (x) => yn(x.s.conditions.some((c) => c.code === "prosthetic-valve" && c.attributes?.position === "Mitral")) },
      { key: "Hx_MVPtype", label: "4.24a Type", get: (x) => {
        const c = x.s.conditions.find((y) => y.code === "prosthetic-valve" && y.attributes?.position === "Mitral");
        if (!c) return NA;
        return c.attributes.type === "Mechanical" ? { value: "Mechanical mitral valve" } : c.attributes.type === "Bioprosthetic (surgical)" ? { value: "Bioprosthetic mitral valve" } : { value: null as any, note: `CardioFlow: ${c.attributes.type ?? "type not recorded"}` };
      } },
      { key: "Hx_Prior_CIED", label: "4.25 Prior cardiac device", get: (x) => yn(priorProcs(x, "device").some((p) => p.attributes.type !== "Implantable loop recorder") || x.reason === "CIED Extraction" || ["Generator change", "Upgrade", "Lead revision"].includes(A(x).action)) },
      { key: "Hx_CIEDdevice_Type", label: "4.25a Prior device type", get: (x) => {
        const p = priorProcs(x, "device").filter((y) => y.attributes.type !== "Implantable loop recorder" && y.attributes.action !== "Extraction").pop();
        const t = p?.attributes.type ?? (["Generator change", "Lead revision", "Upgrade", "Extraction"].includes(A(x).action) ? A(x).type : null);
        if (!t) return A(x).action === "New implant" && !priorProcs(x, "device").length ? NA : null;
        return PRIOR_TYPE[t] ? { value: PRIOR_TYPE[t] } : { value: null as any, note: `CardioFlow: ${t} — single or dual chamber not recorded` };
      } },
      { key: "Exam_SysBPmmHg", label: "5.1 Systolic BP (mmHg)", get: first("sbp") },
      { key: "Exam_DiaBPmmHg", label: "5.2 Diastolic BP (mmHg)", get: first("dbp") },
      { key: "Exam_PresentingHR", label: "5.3 Presenting HR (/min)", get: first("hr") },
      { key: "Exam_WeightKg", label: "5.4 Weight (kg)", get: first("weight", 1) },
      { key: "Exam_HeightCm", label: "5.5 Height (cm)", get: (x) => { const o = x.s.resolved("height").current; return o?.value_num != null ? { value: formatNumber(o.value_num, 0), at: o.effective_at } : null; } },
    ],
  },
  medSection("Home medications", "HomMed_", (x) => before(x)),
  {
    title: "Investigations",
    fields: [
      { key: "Invest_ECG", label: "7.1 ECG", get: (x) => yn(!!studyIn(x, "ecg")) },
      { key: "Invest_ECG_AtrialRhytm", label: "7.1a Atrial rhythm", get: (x) => {
        const e = studyIn(x, "ecg");
        if (!e) return NA;
        const av = { "First-degree": "1st degree AV block", "Mobitz I": "2nd degree AV block, Mobitz I", "Mobitz II": "2nd degree AV block, Mobitz II", Complete: "3rd degree AV block" }[String(e.attributes.avBlock)];
        if (av) return { value: av, at: e.performed_at };
        const r = { "Sinus rhythm": "Sinus", "Atrial fibrillation": "Atrial fibrillation", "Atrial flutter": "Atrial flutter" }[String(e.attributes.rhythm)];
        return r ? { value: r, at: e.performed_at } : { value: null as any, note: `ECG: ${e.attributes.rhythm}` };
      } },
      { key: "Invest_ECG_VentriRhytm", label: "7.1c Ventricular rhythm", get: (x) => {
        const e = studyIn(x, "ecg");
        if (!e) return NA;
        const v = { Normal: "Normal", LBBB: "LBBB", RBBB: "RBBB", "Non-specific IVCD": "IVCD delay" }[String(e.attributes.qrsMorphology)];
        return v ? { value: v, at: e.performed_at } : null;
      } },
      { key: "Invest_VentriRytm_QRSDur", label: "7.1d QRS duration (msec)", get: (x) => { const e = studyIn(x, "ecg"); return !e ? NA : e.attributes.qrs != null ? { value: String(e.attributes.qrs), at: e.performed_at } : null; } },
      { key: "Invest_Holter", label: "7.2 Holter / event monitor", get: (x) => yn(!!studyIn(x, "holter", 180)) },
      { key: "Invest_Holtr_AtrialRhytm", label: "7.2a Holter atrial rhythm", get: (x) => {
        const h = studyIn(x, "holter", 180);
        if (!h) return NA;
        if (h.attributes.avBlock && h.attributes.avBlock !== "None") return { value: { "First-degree": "1st degree AV block", "Mobitz I": "2nd degree AV block", "Mobitz II": "2nd degree AV block", Complete: "3rd degree AV block" }[String(h.attributes.avBlock)] ?? "Unknown rhythm", at: h.performed_at };
        const r = { "Sinus rhythm": "Sinus", "AF throughout": "Atrial fibrillation", "Sinus with paroxysmal AF / flutter": "Atrial fibrillation" }[String(h.attributes.rhythm)];
        return r ? { value: r, at: h.performed_at, note: h.attributes.rhythm === "Sinus with paroxysmal AF / flutter" ? "paroxysmal AF / flutter on sinus" : undefined } : null;
      } },
      { key: "Invest_Holtr_VentriRhytm", label: "7.2b Holter ventricular rhythm", get: (x) => {
        const h = studyIn(x, "holter", 180);
        if (!h) return NA;
        return { value: Number(h.attributes.veBurden) > 10 ? "PVCs burden >10%" : h.attributes.nsvt === "Yes" ? "Non-sustained VT" : "Normal", at: h.performed_at };
      } },
      { key: "Invest_ThoracicEcho_TTE", label: "7.3 TTE", get: (x) => yn(!!lvefOf(x)) },
      { key: "Invest_TTE_LVEF", label: "7.3a LVEF (%)", get: (x) => { const o = lvefOf(x); return o ? { value: formatNumber(o.value_num!, 0), at: o.effective_at } : NA; } },
      { key: "Invest_TTE_LVESD", label: "7.3b LVESD (mm)" },
      { key: "Invest_TTE_LVEDD", label: "7.3c LVEDD (mm)" },
      { key: "Invest_TTE_RVSP", label: "7.3d RVSP (mmHg)" },
      { key: "Invest_TTE_SevereValvDis", label: "7.3e Severe valve disease", get: (x) => (lvefOf(x) ? yn(x.s.conditions.some((c) => ["as", "ar", "mr-primary", "mr-secondary", "tr"].includes(c.code) && c.attributes?.severity === "Severe")) : NA) },
      { key: "Invest_EsophagEcho_TEE", label: "7.4 TEE" },
      { key: "Invest_Tiltingtabletest", label: "7.5 Tilt table test" },
      { key: "Invest_ImplantLoopRecorder", label: "7.6 Implantable loop recorder", get: (x) => yn(x.s.procedures.some((p) => p.kind === "device" && p.attributes.type === "Implantable loop recorder" && day(p.performed_at) <= x.at)) },
      { key: "Invest_CardiacCT", label: "7.7 Cardiac CT angiography", get: (x) => yn(x.s.studies.some((st) => st.kind === "ccta" && day(st.performed_at) <= x.at)) },
      { key: "Invest_CardiacMRI", label: "7.8 Cardiac MRI", get: (x) => yn(x.s.studies.some((st) => st.kind === "cmr" && day(st.performed_at) <= x.at)) },
      { key: "Lab_CreatininInitial", label: "8.1 Creatinine initial (µmol/L)", get: first("creatinine") },
      { key: "Lab_CreatininPeak", label: "8.2 Creatinine peak (µmol/L)", get: extreme("creatinine", 0, "max") },
      { key: "Lab_HemoglobinInitial", label: "8.3 Haemoglobin initial (g/dL)", get: first("haemoglobin", 1) },
      { key: "Lab_HemoglobinLowest", label: "8.4 Haemoglobin lowest (g/dL)", get: extreme("haemoglobin", 1, "min") },
      { key: "Lab_Sodium", label: "8.5 Sodium (mEq/L)", get: first("sodium") },
      { key: "Lab_Potassium", label: "8.6 Potassium (mEq/L)", get: first("potassium", 1) },
      // CardioFlow records magnesium in mmol/L; the registry asks for mEq/L (×2)
      { key: "Lab_Magnesium_Initial", label: "8.7 Magnesium initial (mEq/L)", get: (x) => { const v = num(series(x, "magnesium")[0], 1, 2); return v ? { ...v, note: "mmol/L × 2" } : null; } },
      { key: "Lab_INR", label: "8.8 INR", get: first("inr", 1) },
    ],
  },
  {
    title: "Procedure",
    fields: [
      { key: "Procedure_StartDate", label: "9.1 Procedure date", get: (x) => ({ value: x.at }) },
      { key: "Procedure_StartTime", label: "9.2 Start time" },
      { key: "Procedure_FinishTime", label: "9.3 Finishing time" },
      { key: "Procedure_Operator", label: "9.4 Operator" },
    ],
  },
  {
    title: "9.5 CRT / AICD",
    fields: [
      { key: "Proc_CRTIndi_SurvivorCA", label: "Survivor of cardiac arrest with VT/VF", get: (x) => (x.reason === "CRT/AICD" ? yn(A(x).indication === "Secondary prevention ICD", A(x).indication === "Secondary prevention ICD" ? "secondary prevention: confirm arrest vs sustained VT" : undefined) : NA) },
      { key: "Proc_CRTIndi_InducibleVT", label: "Inducible VT by EPS" },
      { key: "Proc_CRTIndi_ICM", label: "Ischaemic cardiomyopathy with EF ≤35%", get: (x) => (x.reason !== "CRT/AICD" ? NA : lvefOf(x) ? yn(lowEf(x) && ischaemic(x), efNote(x)) : { value: null as any, note: efNote(x) }) },
      { key: "Proc_CRTIndi_nonICM", label: "Non-ischaemic cardiomyopathy with EF ≤35%", get: (x) => (x.reason !== "CRT/AICD" ? NA : lvefOf(x) ? yn(lowEf(x) && !ischaemic(x), efNote(x)) : { value: null as any, note: efNote(x) }) },
      { key: "Proc_CRTIndi_VTnotResponding", label: "VT not responding to ablation or medical therapy" },
      { key: "Proc_CRTIndi_InheritedHeartDis", label: "Inherited heart disease with SCD risk" },
      { key: "Proc_CRT_DevImplant_Type", label: "9.5.c.1 Device type", get: (x) => {
        if (x.reason !== "CRT/AICD") return NA;
        const t = A(x).type as string;
        return t === "CRT-D" ? { value: "CRT-D" } : t === "Subcutaneous ICD" ? { value: "Sub cutaneous ICD" } : t === "CRT-P" ? { value: "CRT", note: "CRT-P" } : { value: null as any, note: "ICD: single or dual chamber not recorded" };
      } },
      { key: "Proc_CRT_DevImpTyp_Pacemaker", label: "9.5.c.1.a Pacemaker in the same procedure" },
      ...leadFields("CRT", "CRT/AICD"),
    ],
  },
  {
    title: "9.7 Permanent pacemaker",
    fields: [
      { key: "Proc_PPM_DevImpl_Type", label: "9.7.b.1 Device type", get: (x) => {
        if (x.reason !== "Pacemaker") return NA;
        const t = A(x).type as string, csp = /Conduction system/.test(A(x).pacing ?? "");
        if (csp) return { value: null as any, note: "conduction system pacing: His-bundle PPM or LBBB PPM — choose in the registry" };
        return PRIOR_TYPE[t] ? { value: PRIOR_TYPE[t], note: t === "Leadless pacemaker" ? "leadless: single chamber assumed" : undefined } : null;
      } },
      { key: "Proc_PPMIndications", label: "9.7c Indication", get: (x) => {
        if (x.reason !== "Pacemaker") return NA;
        const ind = A(x).indication as string | undefined;
        if (ind === "Sinus node dysfunction") return { value: "SSS" };
        if (ind === "Pace and ablate") return { value: "A-V node ablation" };
        if (ind === "AV block") {
          const deg = x.s.conditions.find((c) => c.code === "av-block")?.attributes?.degree;
          return deg === "Complete" ? { value: "CHB" } : deg === "Mobitz II" ? { value: "2° AV block, Mobitz II" } : { value: null as any, note: `AV block${deg ? ` (${deg})` : ""}: degree for the registry` };
        }
        return ind ? { value: null as any, note: `CardioFlow: ${ind}` } : null;
      } },
      ...leadFields("PPM", "Pacemaker"),
    ],
  },
  {
    title: "9.8 EPS / ablation",
    fields: [
      { key: "Proc_EPS_Reason", label: "9.8a Reason for EPS / ablation", get: (x) => {
        if (x.reason !== "EPS/Ablation") return NA;
        const t: string[] = A(x).targets ?? [];
        const map: Record<string, string> = {
          "AF (pulmonary vein isolation)": "Atrial fibrillation", "Atrial flutter (CTI)": "Atrial flutter", AVNRT: "SVT", "Accessory pathway": "SVT", VT: "VT", PVCs: "PVCs", "AV node (pace and ablate)": "AV node ablation",
        };
        const v = map[t[0]];
        return v ? { value: v, note: t.length > 1 ? `also ${t.slice(1).join(", ")}` : t[0] === "Accessory pathway" || t[0] === "AVNRT" ? t[0] : undefined } : { value: null as any, note: `${t[0] ?? "target"}: atypical flutter or atrial tachycardia — choose in the registry` };
      } },
      { key: "Proc_EPS_Sedation", label: "9.8b Sedation" },
      { key: "Proc_EPS_TranseptalPuncture", label: "9.8c Transseptal puncture" },
      { key: "Proc_EPS_IntracardiacEcho", label: "9.8d Intracardiac echo" },
      { key: "Proc_EPS_FluoroscopyTime", label: "9.8e Fluoroscopy time (min)" },
      { key: "Proc_EPS_IntraprocAnticoag", label: "9.8f Intraprocedural anticoagulation" },
      { key: "Proc_EPS_Anticoag_Uninterrupt", label: "9.8.f.1 Uninterrupted anticoagulation", get: (x) => {
        if (x.reason !== "EPS/Ablation") return NA;
        const on = medsAt(x.s, `${x.at}T23:59:59Z`).filter((y) => y.m.tags.includes("oac"));
        return on.length ? { value: "Yes", note: `${on[0].m.name} active on the procedure day` } : null;
      } },
      { key: "Proc_EPS_CatheterManipulat", label: "9.8h Catheter manipulation" },
      { key: "Proc_EPS_PersisArrythmiaInd", label: "9.8i Arrhythmia still inducible after ablation", get: (x) => {
        if (x.reason !== "EPS/Ablation") return NA;
        const r = A(x).result as string;
        return r === "Acute success" ? { value: "No", note: "acute success" } : r === "Unsuccessful" ? { value: "Yes", note: "unsuccessful" } : { value: null as any, note: "partial result: answer in the registry" };
      } },
      { key: "Proc_EPS_MappingSystem", label: "9.8j Mapping system" },
    ],
  },
  {
    title: "9.10 CIED extraction",
    fields: [
      { key: "Proc_CIEDX_Device", label: "9.10b Device extracted", get: (x) => (x.reason === "CIED Extraction" ? (EXTRACT_TYPE[A(x).type] ? { value: EXTRACT_TYPE[A(x).type] } : { value: null as any, note: `${A(x).type}: chamber not recorded` }) : NA) },
      { key: "Proc_CIEDX_Indications", label: "9.10a Indication, leads, technique, reimplantation" },
    ],
  },
  {
    title: "Complications",
    fields: [
      inHosp("Compli_ProcedureCA", "10.1 Coronary angiography in hospital", /Coronary angiography/),
      inHosp("Compli_ProcedurePCI", "10.1 PCI in hospital", /^PCI$/),
      inHosp("Compli_ProcedureCABG", "10.1 CABG in hospital", /^CABG$/),
      inHosp("Compli_ResusCardiacArrest", "10.2.1 Resuscitated cardiac arrest", /cardiac arrest/i),
      inHosp("Compli_RenalFailure", "10.2.3 Renal impairment / failure", /kidney/i),
      inHosp("Compli_Stroke", "10.2.4 Stroke", /stroke/i),
      inHosp("Compli_CardiogenicShock", "10.2.9 Cardiogenic shock", /shock/i),
      inHosp("Compli_Ventilation", "10.2.10 Ventilation", /ventilation/i),
      inHosp("Compli_Inotropes", "10.2.11 Inotropes", /inotropes/i),
      inHosp("Compli_AnyBleeding", "10.2.13 Any bleeding", /bleeding/i),
      inHosp("Compli_Infection_Antibio", "10.2.23 Infection requiring antibiotics", /infection/i),
      { key: "Compli_Device_Specific", label: "Pocket, lead, effusion, pneumothorax and other procedural complications" },
    ],
  },
  {
    title: "Outcome & discharge",
    fields: [
      { key: "Outcom_ImmProcedSuccess", label: "11.1 Immediate procedure success", get: (x) => (x.reason === "EPS/Ablation" ? (A(x).result === "Acute success" ? { value: "Yes" } : A(x).result === "Unsuccessful" ? { value: "No" } : null) : null) },
      { key: "Outcom_PostProcECGRhythm", label: "11.2 ECG rhythm after the procedure", get: (x) => {
        const e = x.s.studies.filter((st) => st.kind === "ecg" && day(st.performed_at) >= x.at && day(st.performed_at) <= x.to).sort((a, b) => a.performed_at.localeCompare(b.performed_at))[0];
        if (!e) return null;
        const v = { "Sinus rhythm": "Sinus", Paced: "Paced rhythm", "Atrial fibrillation": "Atrial fibrillation", "Atrial flutter": "Atrial flutter" }[String(e.attributes.rhythm)] ?? "Other";
        return { value: v, at: e.performed_at };
      } },
      { key: "Outcom_ConductSystemPacing", label: "11.3 Conduction system pacing", get: (x) => (!isDevice(x) ? NA : A(x).pacing ? yn(/Conduction system/.test(A(x).pacing), A(x).pacing) : null) },
      { key: "Discharge_Date", label: "12.1 Date of discharge / death", get: (x) => (x.dischargeDay ? { value: x.dischargeDay } : null) },
      { key: "Discharge_Status", label: "12.3 Discharge status", get: (x) => (x.discharged ? { value: (x.adm?.summary as any)?.outcome === "died" ? "Dead" : "Alive" } : null) },
      { key: "Discharge_CauseofDeath", label: "12.3a Cause of death" },
      { key: "Discharge_Type", label: "12.3b Discharge type", get: (x) => {
        const d = (x.adm?.summary as any)?.destination as string | undefined;
        if ((x.adm?.summary as any)?.outcome === "died") return NA;
        if (!x.discharged || !d) return null;
        return /against/i.test(d) ? { value: "Left against Medical Advice (LAMA)" } : /^Home/i.test(d) ? { value: "Home", note: d } : { value: null as any, note: `CardioFlow: ${d} — choose the transfer type in the registry` };
      } },
    ],
  },
  medSection("Discharge medications", "DiscMed_", atDischarge),
  {
    title: "Follow-up",
    fields: [{ key: "FU_1_6_12_months", label: "Follow-up at 1, 6 and 12 months (registry form)" }],
  },
];

const lvefOf = (x: Ctx) =>
  x.s.observations.filter((o) => o.code === "lvef" && o.value_num != null && o.status !== "entered_in_error" && day(o.effective_at) <= x.to && day(o.effective_at) >= addDays(x.at, -182))
    .sort((a, b) => b.effective_at.localeCompare(a.effective_at))[0];
const lowEf = (x: Ctx) => { const o = lvefOf(x); return !!o && o.value_num! <= 35; };
const ischaemic = (x: Ctx) => x.s.tags.has("cad") || x.s.conditions.some((c) => ["hfref", "hfmref", "hfimpef"].includes(c.code) && (c.attributes?.aetiology ?? []).includes("Ischaemic"));
const efNote = (x: Ctx) => { const o = lvefOf(x); return o ? `LVEF ${formatNumber(o.value_num!, 0)}% (${fmtDay(o.effective_at, { year: true })})${ischaemic(x) ? ", ischaemic" : ""}` : "no LVEF within 6 months"; };

// The index record: the latest device procedure (not a loop recorder) or catheter ablation.
export function epsIndex(s: PatientState): Ctx | null {
  const proc = s.procedures
    .filter((p) => (p.kind === "device" && p.attributes.type !== "Implantable loop recorder") || p.kind === "ablation")
    .sort((a, b) => a.performed_at.localeCompare(b.performed_at))
    .pop();
  if (!proc) return null;
  const at = day(proc.performed_at);
  const reason: Reason = proc.kind === "ablation" ? "EPS/Ablation" : proc.attributes.action === "Extraction" ? "CIED Extraction" : /Pacemaker|Leadless/.test(proc.attributes.type) ? "Pacemaker" : "CRT/AICD";
  const adm = [...s.contexts].reverse().find((c) => c.kind === "admission" && day(c.started_at) <= at && (!c.ended_at || day(c.ended_at) >= at)) ?? null;
  const discharged = !!adm?.ended_at;
  const dischargeDay = adm?.ended_at ? day(adm.ended_at) : null;
  const from = adm ? addDays(day(adm.started_at), -1) : addDays(at, -30);
  const to = adm ? (dischargeDay ?? s.today) : addDays(at, 1);
  return { s, at, proc, reason, adm, from, to, discharged, dischargeDay };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function epsRegistryProjection(s: PatientState) {
  const x = epsIndex(s);
  if (!x) return null;
  const sections = EPS_REGISTRY.map((sec) => ({
    title: sec.title,
    fields: sec.fields.flatMap((f) => {
      const v = f.get ? f.get(x) : null;
      if (v?.na) return [];
      const value = v?.value ?? null;
      return [{ key: f.key, label: f.label, mapped: !!f.get, value, code: value != null ? spssCode(f.key, value) : null, at: v?.at ? fmtDay(v.at, { year: true }) : null, note: v?.note ?? null }];
    }),
  }))
    // procedure blocks that do not apply to this record are left out
    .filter((sec) => !/^9\.(5|7|8|10) /.test(sec.title) || sec.fields.some((f) => f.mapped));
  const all = sections.flatMap((y) => y.fields);
  const mapped = all.filter((f) => f.mapped);
  const filled = mapped.filter((f) => f.value != null);
  return {
    registry: "EP Registry",
    index: `${x.reason === "EPS/Ablation" ? "Ablation" : x.reason === "CIED Extraction" ? "Device extraction" : "Device"} ${fmtDay(x.proc.performed_at, { year: true })} · ${x.proc.summary}`,
    admission: x.adm ? { from: day(x.adm.started_at), to: x.dischargeDay, open: !x.discharged } : null,
    sections,
    counts: { mapped: mapped.length, filled: filled.length, registryOnly: all.length - mapped.length },
    csv: filled.map((f) => f.key).join(",") + "\n" + filled.map((f) => csvCell(f.value!)).join(","),
    csvCoded: filled.map((f) => f.key).join(",") + "\n" + filled.map((f) => csvCell(f.code ?? "")).join(","),
  };
}

// The EP registry as a whole: every patient with a device procedure or an ablation.
export function epsRegistryCohort(states: PatientState[]) {
  const rows = states
    .map((s) => ({ s, p: epsRegistryProjection(s) }))
    .filter((y): y is { s: PatientState; p: NonNullable<ReturnType<typeof epsRegistryProjection>> } => !!y.p)
    .map(({ s, p }) => {
      const fields = p.sections.flatMap((y) => y.fields).filter((f) => f.mapped);
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
      return {
        id: s.patient.id, name: s.patient.name, mrn: s.patient.mrn,
        type: (byKey.Reason_EPlab?.value as string) ?? "—", index: p.index,
        filled: p.counts.filled, mapped: p.counts.mapped,
        missing: fields.filter((f) => f.value == null).map((f) => f.label.replace(/^[\d.a-z]+ /, "")),
        byKey,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  // one column per mapped field that any record fills, in registry order
  const keys = EPS_REGISTRY.flatMap((sec) => sec.fields.filter((f) => f.get).map((f) => f.key)).filter((k) => rows.some((r) => r.byKey[k]?.value != null));
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  const filled = rows.reduce((n, r) => n + r.filled, 0), mapped = rows.reduce((n, r) => n + r.mapped, 0);
  const sheet = (coded: boolean) => [keys.join(","), ...rows.map((r) => keys.map((k) => { const f = r.byKey[k]; const v = f?.value == null ? "" : coded ? f.code ?? "" : f.value; return v ? csvCell(v) : ""; }).join(","))].join("\n");
  return {
    registry: "EP Registry",
    counts: { patients: rows.length, byType, filledPct: mapped ? Math.round((filled / mapped) * 100) : null },
    patients: rows.map(({ byKey, ...r }) => r),
    csv: sheet(false),
    csvCoded: sheet(true),
  };
}
