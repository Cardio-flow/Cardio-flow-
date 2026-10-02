// HF Clinic Registry projection (blueprint P2.10, first part): the MKH HF Clinic Registry form
// (github.com/MKH-Cardiology/HF-clinic-registry, baseline card fields) mapped to the CardioFlow
// record. Read-only: CardioFlow fills what it already holds, in the registry's own vocabulary
// and units; everything else is listed as registry-only, to be asked in the registry. Nothing is
// written to the registry from here. Labs are the latest value (the registry's "Adm" fields are
// admission values: shown with their date so the registry user can judge).
import { formatNumber } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import { isHfAdmission } from "../../shared/encounters.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import { fmtStatus, hfImprovedEf, hfPhenotype, patientBmi } from "./guidelines.js";

type Val = { value: string; at?: string | null; note?: string } | null;
type Field = { key: string; label: string; get?: (s: PatientState) => Val };
type Section = { title: string; fields: Field[] };

const yn = (b: boolean): Val => ({ value: b ? "Yes" : "No" });
const has = (s: PatientState, ...codes: string[]) => s.conditions.some((c) => codes.includes(c.code));
const tag = (s: PatientState, t: string) => s.tags.has(t);
const obs = (code: string, d = 0, factor = 1): Field["get"] => (s) => {
  const o = s.resolved(code).current;
  return o?.value_num != null ? { value: formatNumber(o.value_num * factor, d).replace(/,/g, ""), at: o.effective_at } : null;
};
const hx = (s: PatientState, key: string) => s.resolved(`hx.${key}`).current?.value_text ?? null;
const hfCond = (s: PatientState) => s.conditions.find((c) => ["hfref", "hfmref", "hfpef", "hfimpef"].includes(c.code));
const aetiology = (s: PatientState): string[] => {
  const a = hfCond(s)?.attributes?.aetiology;
  return Array.isArray(a) ? a : a ? [a] : [];
};
const CAUSE: Record<string, string> = {
  Ischaemic: "ICM", "Dilated (non-ischaemic)": "DCM", Hypertrophic: "HCM", "Myocarditis / inflammatory": "Myocarditis",
  "Cardiac amyloidosis": "Infiltrative heart disease", "Infiltrative / storage (other)": "Infiltrative heart disease",
};
const VALVES: Record<string, string> = { as: "AS", ar: "AR", "mr-primary": "MR (primary)", "mr-secondary": "MR (secondary)", ms: "MS", tr: "TR", "prosthetic-valve": "Prosthetic valve" };
const lastAdmission = (s: PatientState) => [...s.contexts].reverse().find((c) => c.kind === "admission") ?? null;
const ecg = (s: PatientState) => latestStudy(s, "ecg");

export const HF_REGISTRY: Section[] = [
  {
    title: "Demographics",
    fields: [
      { key: "Patient_Name", label: "Name", get: (s) => ({ value: s.patient.name }) },
      { key: "Civil_ID", label: "Civil ID", get: (s) => (s.patient.civil_id ? { value: s.patient.civil_id } : null) },
      { key: "File_No", label: "File number (MRN)", get: (s) => ({ value: s.patient.mrn }) },
      { key: "Age", label: "Age", get: (s) => ({ value: String(s.patient.age) }) },
      { key: "Gender", label: "Gender", get: (s) => ({ value: s.patient.sex }) },
      { key: "Nationality", label: "Nationality", get: (s) => (s.patient.nationality ? { value: s.patient.nationality } : null) },
      { key: "Mobile", label: "Mobile", get: (s) => (s.patient.mobile ? { value: s.patient.mobile } : null) },
      { key: "Doctor_Name", label: "Doctor" },
      { key: "Referred_From", label: "Referred from" },
    ],
  },
  {
    title: "HF diagnosis & admission",
    fields: [
      { key: "HF_Type", label: "Type of HF", get: (s) => {
        const c = hfCond(s);
        if (!c) return null;
        if (c.code === "hfimpef" || hfImprovedEf(s)) return { value: "Others", note: "HF with improved LVEF (HF_Type_Other)" };
        return { value: { hfref: "HFrEF", hfmref: "HFmrEF", hfpef: "HFpEF" }[c.code as "hfref"] ?? "Others", note: "from the HF diagnosis (registry categories)" };
      } },
      { key: "EF_Diagnosis", label: "EF at diagnosis (%)", get: (s) => {
        const h = s.resolved("lvef").history.filter((o) => o.status === "final" && o.value_num != null);
        const first = h[h.length - 1];
        return first ? { value: formatNumber(first.value_num!, 0), at: first.effective_at, note: "earliest LVEF in CardioFlow" } : null;
      } },
      { key: "Advanced_HF", label: "Advanced HF" },
      { key: "DeNovo_HF", label: "De novo HF" },
      { key: "HF_Cause", label: "Cause of HF", get: (s) => {
        const a = aetiology(s).filter((x) => x !== "Unknown");
        if (!a.length) return null;
        const mapped = a.map((x) => CAUSE[x] ?? "Others");
        return { value: mapped[0], note: mapped[0] === "Others" || a.length > 1 ? `CardioFlow: ${a.join(", ")}` : undefined };
      } },
      { key: "Valvular_Disease", label: "Valvular disease", get: (s) => yn(s.conditions.some((c) => c.code in VALVES)) },
      { key: "Valvular_Type", label: "Valvular type", get: (s) => {
        const v = s.conditions.filter((c) => c.code in VALVES).map((c) => `${VALVES[c.code]}${c.attributes?.severity ? ` ${String(c.attributes.severity).toLowerCase()}` : ""}`);
        return v.length ? { value: v.join(", ") } : null;
      } },
      { key: "Admissions", label: "HF admissions in the last year", get: (s) => ({ value: String(s.contexts.filter((c) => c.kind === "admission" && isHfAdmission(c as any) && Date.parse(c.started_at) >= Date.parse(s.today) - 365 * 86400000).length) }) },
      { key: "Last_Admission", label: "Last admission date", get: (s) => { const a = lastAdmission(s); return a ? { value: a.started_at.slice(0, 10) } : null; } },
      { key: "LOS", label: "Length of stay (days)", get: (s) => { const los = (lastAdmission(s)?.summary as any)?.los; return los != null ? { value: String(los) } : null; } },
      { key: "Admission_Date", label: "Admission date", get: (s) => { const a = lastAdmission(s); return a ? { value: a.started_at.slice(0, 10) } : null; } },
      { key: "Admission_Discharge_Date", label: "Discharge date", get: (s) => { const a = lastAdmission(s); return a?.ended_at ? { value: a.ended_at.slice(0, 10) } : null; } },
      { key: "Admission_Reason", label: "Admission reason", get: (s) => { const a = lastAdmission(s); return a?.reasons.length ? { value: a.reasons.join(", ") } : null; } },
    ],
  },
  {
    title: "Symptoms & signs (latest)",
    fields: [
      { key: "Height", label: "Height (cm)", get: obs("height") },
      { key: "Weight", label: "Weight (kg)", get: obs("weight", 1) },
      { key: "BMI", label: "BMI", get: (s) => { const b = patientBmi(s); return b ? { value: formatNumber(b, 1) } : null; } },
      { key: "Dry_Weight", label: "Dry weight (kg)", get: obs("dry-weight", 1) },
      { key: "KCCQ", label: "KCCQ-12 summary score", get: obs("kccq") },
      { key: "Pulse", label: "Pulse", get: obs("hr") },
      { key: "BP", label: "BP", get: (s) => {
        const sb = s.resolved("sbp").current, db = s.resolved("dbp").current;
        return sb?.value_num != null ? { value: db?.value_num != null ? `${sb.value_num}/${db.value_num}` : String(sb.value_num), at: sb.effective_at } : null;
      } },
      { key: "SpO2", label: "SpO₂ (%)", get: obs("spo2") },
      { key: "Fatigue", label: "Symptoms" },
      { key: "Edema", label: "Oedema" },
      { key: "JVP", label: "JVP" },
      { key: "Rales", label: "Rales" },
      { key: "S3", label: "S3" },
      { key: "Murmur", label: "Murmur" },
    ],
  },
  {
    title: "Investigations",
    fields: [
      { key: "ECG_LBBB", label: "LBBB", get: (s) => { const e = ecg(s); return e?.attributes.qrsMorphology ? { ...yn(e.attributes.qrsMorphology === "LBBB")!, at: e.performed_at } : null; } },
      { key: "ECG_QRS", label: "QRS duration (ms)", get: (s) => { const e = ecg(s); return e?.attributes.qrs != null ? { value: String(e.attributes.qrs), at: e.performed_at } : null; } },
      { key: "ECG_Arrhythmia", label: "Arrhythmia", get: (s) => { const e = ecg(s); const r = e?.attributes.rhythm; return r ? { value: /sinus/i.test(r) ? "None (sinus rhythm)" : r, at: e!.performed_at } : null; } },
      { key: "ECG_Pacing", label: "Pacing rhythm", get: (s) => { const e = ecg(s); return e ? { value: e.attributes.qrsMorphology === "Paced" || /paced/i.test(e.attributes.rhythm ?? "") ? "Paced" : "No", at: e.performed_at } : null; } },
      { key: "ECHO", label: "Echo details", get: (s) => { const e = latestStudy(s, "echo"); return e ? { value: e.conclusion || e.findings.join(", ") || "recorded", at: e.performed_at } : null; } },
      { key: "Echo_EF", label: "EF %", get: obs("lvef") },
      { key: "Walk_Completed", label: "6MWT completed", get: (s) => (s.resolved("6mwd").current ? { value: "Y", at: s.resolved("6mwd").current!.effective_at } : null) },
      { key: "Walk_Meters", label: "Metres walked", get: obs("6mwd") },
      { key: "Device_Type", label: "Device implanted", get: (s) => {
        const c = s.conditions.find((x) => x.code === "cied" && x.attributes?.type);
        if (!c) return null;
        const t = String(c.attributes.type);
        return { value: t === "Pacemaker" ? "Pacemaker (type to specify)" : t === "Loop recorder" ? "Loop recorder (not a registry device)" : t };
      } },
      { key: "Holter_Done", label: "Holter done", get: (s) => (latestStudy(s, "holter") ? { value: "Yes", at: latestStudy(s, "holter")!.performed_at } : null) },
      { key: "CAG_Done", label: "Coronary angiography done", get: (s) => (latestStudy(s, "cath") ? { value: "Yes", at: latestStudy(s, "cath")!.performed_at } : null) },
      { key: "CMR_LVEF", label: "CMR LVEF" },
      { key: "CPET_PeakVO2", label: "CPET peak VO₂" },
      { key: "RHC_Done", label: "Right heart catheterisation" },
    ],
  },
  {
    title: "Past history & comorbidities",
    fields: [
      { key: "DM", label: "Diabetes", get: (s) => yn(tag(s, "dm")) },
      { key: "HTN", label: "Hypertension", get: (s) => yn(tag(s, "htn")) },
      { key: "AF", label: "AF", get: (s) => yn(tag(s, "af")) },
      { key: "IHD", label: "IHD (MI type)", get: (s) => {
        const stemi = has(s, "acs-stemi") || s.conditions.some((c) => c.code === "prior-mi" && c.attributes?.type === "STEMI");
        const nstemi = has(s, "acs-nstemi") || s.conditions.some((c) => c.code === "prior-mi" && c.attributes?.type === "NSTEMI");
        return { value: stemi ? "STEMI" : nstemi ? "NSTEMI" : "No", note: !stemi && !nstemi && tag(s, "cad") ? "coronary disease without a recorded MI type" : undefined };
      } },
      { key: "PCI_CABG", label: "PCI / CABG", get: (s) => yn(has(s, "prior-pci", "prior-cabg")) },
      { key: "CKD", label: "CKD", get: (s) => yn(tag(s, "ckd")) },
      { key: "Dialysis", label: "Dialysis", get: (s) => yn(has(s, "dialysis")) },
      { key: "CVA", label: "Stroke / TIA", get: (s) => yn(tag(s, "stroke")) },
      { key: "PVD", label: "Peripheral vascular disease", get: (s) => yn(has(s, "pad")) },
      { key: "Smoker", label: "Smoker", get: (s) => { const v = hx(s, "smoking"); return v === "current" ? { value: "Current" } : v === "ex" ? { value: "Former" } : v === "never" ? { value: "Never" } : null; } },
      { key: "Alcohol", label: "Alcohol", get: (s) => { const v = hx(s, "alcohol"); return v === "current" ? { value: "Yes" } : v === "never" || v === "former" ? { value: "No" } : null; } },
      { key: "Obese", label: "Obese (BMI ≥30)", get: (s) => { const b = patientBmi(s); return has(s, "obesity") || b != null ? yn(has(s, "obesity") || (b ?? 0) >= 30) : null; } },
      { key: "OSA", label: "OSA", get: (s) => yn(has(s, "osa")) },
      { key: "Dyslipidemia", label: "Dyslipidaemia", get: (s) => yn(tag(s, "lipids")) },
      { key: "Lung_Dz", label: "Lung disease", get: (s) => yn(has(s, "copd")) },
      { key: "Liver_Dz", label: "Liver disease", get: (s) => yn(has(s, "liver-disease")) },
      { key: "Thyroid_Dz", label: "Thyroid disease", get: (s) => (has(s, "thyroid") ? { value: "Yes", note: "hyper/hypo not recorded in CardioFlow" } : { value: "No" }) },
      { key: "FH_Cardio", label: "Family history (cardiac)", get: (s) => { const v = hx(s, "fhx-scd"); return v === "yes" ? { value: "Yes" } : v === "no" ? { value: "No" } : null; } },
      { key: "Frail", label: "Frailty" },
      { key: "Valve_Surgery", label: "Valve surgery" },
      { key: "Genetics", label: "Genetic testing" },
    ],
  },
  {
    title: "Labs (latest)",
    fields: [
      { key: "Lab_HbA1c", label: "HbA1c (%)", get: obs("hba1c", 1) },
      { key: "Lab_Gluc", label: "Glucose (mmol/L)", get: obs("glucose", 1) },
      { key: "Lab_Urea", label: "Urea (mmol/L)", get: obs("urea", 1) },
      { key: "Lab_Creat", label: "Creatinine (µmol/L)", get: obs("creatinine") },
      { key: "Lab_eGFR", label: "eGFR", get: obs("egfr") },
      { key: "Lab_Na", label: "Na (mmol/L)", get: obs("sodium") },
      { key: "Lab_K", label: "K (mmol/L)", get: obs("potassium", 1) },
      { key: "Lab_BNP", label: "NT-proBNP (pg/mL)", get: obs("nt-probnp") },
      { key: "Lab_Hb", label: "Hb (g/dL)", get: obs("haemoglobin", 1) },
      { key: "Lab_WBC", label: "WBC", get: obs("wbc", 1) },
      { key: "Lab_Plt", label: "Platelets", get: obs("platelets") },
      { key: "Lab_Ferritin", label: "Ferritin (µg/L)", get: obs("ferritin") },
      { key: "Lab_TrSats", label: "TSAT (%)", get: obs("tsat") },
      { key: "Lab_TSH", label: "TSH", get: obs("tsh", 2) },
      { key: "Lab_TotalChol", label: "Total cholesterol (mmol/L)", get: obs("total-cholesterol", 1) },
      { key: "Lab_LDL", label: "LDL (mmol/L)", get: obs("ldl-c", 2) },
      { key: "Lab_HDL", label: "HDL (mmol/L)", get: obs("hdl-c", 2) },
      { key: "Lab_TG", label: "Triglycerides (mmol/L)", get: obs("triglycerides", 1) },
      // CardioFlow stores UACR in mg/mmol; the registry field is mg/g (×8.84)
      { key: "Lab_AlbCreat", label: "Albumin/creatinine ratio (mg/g)", get: obs("uacr", 0, 8.84) },
      { key: "Lab_BNP_only", label: "BNP (pg/mL)" },
      { key: "Lab_Iron", label: "Serum iron" },
    ],
  },
  {
    title: "In-hospital (last admission)",
    fields: [
      { key: "Inotropes_Used", label: "Inotropes used", get: (s) => { const a = lastAdmission(s); const ev = (a?.summary as any)?.events as string[] | undefined; return a?.status === "closed" ? yn(!!ev?.some((e) => /Inotropes/i.test(e))) : null; } },
      { key: "Complications", label: "In-hospital events", get: (s) => { const a = lastAdmission(s); const ev = ((a?.summary as any)?.events as string[] | undefined) ?? []; return a?.status === "closed" ? { value: ev.length ? ev.join(", ") : "None" } : null; } },
      { key: "Cardioversion", label: "Cardioversion" },
      { key: "Hemo_Support", label: "Haemodynamic support" },
      { key: "Bleeding_Transfusion", label: "Bleeding / transfusion" },
    ],
  },
  {
    title: "Outcomes & management",
    fields: [
      { key: "Quad_GDMT", label: "Quadruple GDMT", get: (s) => {
        if (hfPhenotype(s) !== "HFrEF" && !hfImprovedEf(s)) return { value: "N/A" };
        return yn((fmtStatus(s)?.pillars ?? []).every((p) => p.state === "on" || p.state === "target"));
      } },
      { key: "Recovered_LV", label: "Recovered LV", get: (s) => (hfPhenotype(s) === "HFpEF" && !hfImprovedEf(s) ? { value: "N/A" } : yn(!!hfImprovedEf(s))) },
      { key: "Mortality", label: "Vital status", get: (s) => {
        const v = s.status.vital;
        if (!v || v.status !== "died") return { value: "Alive" };
        if (v.place === "in_hospital") return { value: "Died in hospital", at: v.effective_on };
        if (v.place === "out_of_hospital") return { value: "Died out of hospital", at: v.effective_on };
        return { value: "Died (place not recorded)", at: v.effective_on, note: "choose in or out of hospital in the registry" };
      } },
      { key: "LostFU", label: "Lost to follow-up", get: (s) => yn(s.status.followUp?.status === "lost") },
      { key: "Next_Appt", label: "Next appointment", get: (s) => {
        const n = s.plan.filter((a) => a.status === "planned" && a.completes_on?.type === "visit" && a.due_date && a.due_date >= s.today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
        return n ? { value: n.due_date!, note: n.title } : null;
      } },
      { key: "Discharge_Status", label: "Status on discharge" },
      { key: "Strong_HF", label: "STRONG-HF protocol" },
      { key: "Adv_HF_Therapy", label: "Advanced HF therapy" },
      { key: "Referral", label: "Referral" },
    ],
  },
];

export function hfRegistryProjection(s: PatientState) {
  if (!s.tags.has("hf")) return null;
  const sections = HF_REGISTRY.map((sec) => ({
    title: sec.title,
    fields: sec.fields.map((f) => {
      const v = f.get ? f.get(s) : null;
      return { key: f.key, label: f.label, mapped: !!f.get, value: v?.value ?? null, at: v?.at ? fmtDay(v.at, { year: true }) : null, note: v?.note ?? null };
    }),
  }));
  const all = sections.flatMap((x) => x.fields);
  const mapped = all.filter((f) => f.mapped);
  const filled = mapped.filter((f) => f.value != null);
  const header = filled.map((f) => f.key);
  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return {
    registry: "MKH HF Clinic Registry",
    sections,
    counts: { mapped: mapped.length, filled: filled.length, registryOnly: all.length - mapped.length },
    csv: header.join(",") + "\n" + filled.map((f) => csvCell(f.value!)).join(","),
  };
}
