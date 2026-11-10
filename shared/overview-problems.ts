// The problems a patient's overview is organised by (heart failure, kidney, lipids…): status against the
// guideline goal, current therapy and the results still needed. Built on the server with the summary so the
// screen only renders it (constitution: no clinical logic in UI components). Moved here from
// src/screens/Today.tsx on 10 Nov 2026, unchanged.
import { problemOfRule as PROBLEM_OF } from "./overview.js";
import { formatNumber, MEASURES } from "./catalog.js";
import { fmtDay } from "./clinical.js";
import { pregnancyHaemoglobinCutoff } from "./pregnancy.js";

export const RESULT_PROBLEM: Record<string, string> = {
  egfr: "kidney", creatinine: "kidney", urea: "kidney", potassium: "kidney", sodium: "kidney", magnesium: "kidney", uacr: "kidney", bicarbonate: "kidney", chloride: "kidney", phosphate: "kidney", "calcium-total": "kidney", calcium: "kidney", urate: "kidney",
  alt: "lipids", ast: "lipids", ck: "lipids", alp: "lipids", ggt: "lipids", bilirubin: "lipids",
  haemoglobin: "anaemia", ferritin: "anaemia", tsat: "anaemia", iron: "anaemia", transferrin: "anaemia", mcv: "anaemia", b12: "anaemia", folate: "anaemia", platelets: "anaemia", wbc: "anaemia",
  "nt-probnp": "hf", bnp: "hf",
  "ldl-c": "lipids", "total-cholesterol": "lipids", "hdl-c": "lipids", triglycerides: "lipids", lpa: "lipids",
  hba1c: "diabetes", glucose: "diabetes", ketones: "diabetes",
  inr: "af",
};
export type Stat = { label: string; value: string; tone?: "ok" | "warn" | "bad" };
export type Problem = { key: string; label: string; sub?: string; history?: string[]; stats: Stat[]; goal?: string; therapy?: string; need: { code: string; label: string }[]; assessment?: "met" | "above" | "incomplete" | "review" };
export const TITLES: Record<string, string> = { infection: "Infection", results: "Other results", pregnancy:"Pregnancy & heart disease", pericardial:"Pericardial disease", medication:"Medication review", aorta:"Thoracic aorta", syncope: "Syncope & unexplained falls", hf: "Heart failure", kidney: "Kidney & potassium", anaemia: "Blood count & iron", bp: "Blood pressure", lipids: "Lipids", diabetes: "Diabetes", af: "Atrial fibrillation", cad: "Coronary disease", valve: "Valve / structural", cmp: "Cardiomyopathy", ph: "Pulmonary hypertension", other: "Other alerts" };
const NEED_LABEL: Record<string, string> = { sbp: "BP", dbp: "BP", hr: "Heart rate", weight: "Weight", creatinine: "Creatinine", potassium: "Potassium", "ldl-c": "LDL-C", hba1c: "HbA1c", uacr: "UACR", haemoglobin: "Hb", ferritin: "Ferritin", tsat: "TSAT", inr: "INR", "nt-probnp": "NT-proBNP" };
const labelOf = (c: string) => NEED_LABEL[c] ?? MEASURES[c]?.short ?? MEASURES[c]?.display ?? c;

export function buildProblems(s: any): Problem[] {
  const t = s.targets ?? {};
  const n = (v: number | null | undefined, d = 0) => (v == null ? "—" : formatNumber(v, d));
  const R: Record<string, any> = Object.fromEntries((s.reviewContext?.results ?? []).map((r: any) => [r.code, r]));
  const days = (at: string | null) => (at ? Math.round((Date.parse(s.today) - Date.parse(String(at).slice(0, 10))) / 86400000) : null);
  const recent = (code: string, within: number) => R[code]?.value != null && (days(R[code].at) ?? 9999) <= within;
  const val = (code: string, d = 0) => (R[code]?.value != null ? `${n(R[code].value, d)}${R[code].at ? ` · ${fmtDay(R[code].at)}` : ""}` : "Not recorded");
  const meds = (s.medications?.groups ?? []).flatMap((g: any) => g.meds).filter((m: any) => m.status === "active" || m.status === "held");
  const line = (tags: string[]) => meds.filter((m: any) => m.tags?.some((x: string) => tags.includes(x))).map((m: any) => `${m.name} ${m.dose}${m.status === "held" ? " (held)" : ""}`).join(" · ");
  const dx = new Set<string>((s.header?.diagnoses ?? []).map((d: any) => d.code));
  const tagSet = new Set<string>(s.header?.tags ?? []);
  const has = (...codes: string[]) => codes.some((c) => dx.has(c) || tagSet.has(c));
  const need = (codes: string[], within: number) => codes.filter((c) => !recent(c, within)).map((c) => ({ code: c, label: labelOf(c) }));
  const pregnant = s.pregnancy?.phase === "Pregnant";
  const hb = R.haemoglobin;
  const hbCutoff = pregnant && hb?.at ? pregnancyHaemoglobinCutoff(s.pregnancy?.edd ?? undefined, String(hb.at).slice(0, 10)) : null;
  const lowHb = hb?.value != null && (pregnant ? hbCutoff != null && hb.value < hbCutoff : hb.value < (s.header?.sex === "Female" ? 12 : 13));
  const out: Problem[] = [];
  if (t.hf) {
    const on = t.hf.pillars.filter((x: any) => x.state === "on" || x.state === "target").length;
    out.push({
      key: "hf", label: `${TITLES.hf} · ${t.hf.improved ? "improved EF" : t.hf.phenotype}`,
      sub: s.hf?.admissions?.last12m ? `${s.hf.admissions.last12m} HF admission${s.hf.admissions.last12m === 1 ? "" : "s"} in 12 months` : undefined,
      // the pillars are listed once, in the HF medicines table of the card
      stats: [],
      goal: `${on} of ${t.hf.pillars.length} foundational medicines on · goal: all at target or maximum tolerated dose`,
      therapy: line(["loop", "thiazide"]) ? `Diuretic: ${line(["loop", "thiazide"])}` : undefined,
      need: need(["sbp", "hr", "weight"], 60),
    });
  }
  const k = t.kidney;
  // kidney and anaemia: the values are the card's result rows; the card adds therapy and what is missing
  if (k && (k.egfr != null || k.creatinineCurrent != null || k.k != null || has("ckd")))
    out.push({ key: "kidney", label: TITLES.kidney, stats: [], therapy: line(["raas", "mra", "sglt2", "k-binder"]) || undefined, need: has("ckd") || t.hf ? need(["creatinine", "potassium"], 90) : [] });
  if (has("anaemia") || lowHb || (s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === "anaemia"))
    out.push({ key: "anaemia", label: TITLES.anaemia, stats: [], therapy: line(["oac", "antiplatelet"]) ? `Antithrombotic: ${line(["oac", "antiplatelet"])}` : undefined, need: lowHb || has("anaemia") ? need(["ferritin", "tsat"], 365) : [] });
  if (t.af) {
    const hr = R.hr?.value;
    out.push({
      key: "af", label: TITLES.af, sub: undefined,
      stats: [
        { label: t.af.assessmentLabel?"Stroke prevention":"CHA₂DS₂-VA", value: t.af.assessmentLabel??String(t.af.score) },
        { label: "Anticoagulant", value: t.af.oac.length ? t.af.oac.join(" · ") : "None", tone: t.af.assessmentLabel?undefined:t.af.oac.length ? "ok" : t.af.score >= 2 ? "bad" : undefined },
        { label: "Heart rate", value: val("hr"), tone: hr == null ? undefined : hr >= 110 ? "warn" : "ok" },
      ],
      therapy: line(["bb", "bb-other", "ndhp-ccb", "digoxin", "rate-slowing"]) ? `Rate control: ${line(["bb", "bb-other", "ndhp-ccb", "digoxin"])}` : undefined,
      need: need(["hr"], 60).concat(t.af.oac.length ? need(["weight", "creatinine"], 365) : []),
    });
  }
  if (has("cad", "ascvd") || (s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === "cad"))
    out.push({ key: "cad", label: TITLES.cad, sub: s.header?.ihd?.label?.replace(/^IHD · /, ""), history: (s.header?.ihd?.events ?? []).map((e: any) => e.text), stats: [{ label: "Antithrombotic", value: line(["antiplatelet", "oac"]) || "None" }, ...(line(["nitrate", "nitrate-sl", "ranolazine", "ivabradine"]) ? [{ label: "Anti-anginal", value: line(["nitrate", "ranolazine", "ivabradine"]) }] : [])], need: [] });
  if (t.ldl) out.push({ key: "lipids", label: TITLES.lipids, stats: t.ldl.value == null ? [{ label: "LDL-C", value: "Not measured" }] : [], goal: `Goal <${t.ldl.goal} mmol/L · ${t.ldl.category} risk`, therapy: t.ldl.therapy.length ? t.ldl.therapy.join(" + ") : "No lipid-lowering therapy", need: need(["ldl-c"], 365), assessment: t.ldl.met === true ? "met" : t.ldl.met === false ? "above" : "review" });
  if (t.bp) out.push({ key: "bp", label: TITLES.bp, stats: [{ label: "Latest", value: t.bp.sbp != null ? `${n(t.bp.sbp)}${t.bp.dbp != null ? "/" + n(t.bp.dbp) : ""} mmHg${t.bp.at ? ` · ${fmtDay(t.bp.at)}` : ""}` : t.bp.dbp != null ? `DBP ${n(t.bp.dbp)} mmHg` : "Not measured", tone: t.bp.met === true ? "ok" : t.bp.met === false ? "warn" : undefined }], goal: t.bp.label ?? (t.bp.target === "Individualized" ? "Individualized target" : `Goal ${t.bp.target}/${t.bp.diastolicTarget} if tolerated (ESC 2024)`), need: t.bp.sbp == null || t.bp.dbp == null || !recent("sbp", 90) || !recent("dbp", 90) ? [{code:"sbp",label:"BP"},{code:"dbp",label:"BP"}] : [], assessment: t.bp.met === true ? "met" : t.bp.met === false ? "above" : t.bp.sbp == null || t.bp.dbp == null ? "incomplete" : "review" });
  if (t.diabetes) out.push({ key: "diabetes", label: TITLES.diabetes, stats: t.diabetes.hba1c == null ? [{ label: "HbA1c", value: "Not measured" }] : [], goal: `Target ${t.diabetes.target}`, therapy: t.diabetes.therapy.length ? t.diabetes.therapy.join(" · ") : "No glucose-lowering therapy", need: need(["hba1c"], 180), assessment: t.diabetes.met === true ? "met" : t.diabetes.met === false ? "above" : "review" });
  for (const key of ["valve", "cmp", "ph"]) if ((s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === key)) out.push({ key, label: TITLES[key], stats: [], need: [] });
  out.push({ key: "other", label: TITLES.other, stats: [], need: [] });
  return out;
}
