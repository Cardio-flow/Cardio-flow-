// Rules that read investigation results (ECG, Holter, CT, cath, CMR).
// Logic is code; every number is a governed parameter, and all of these start in
// CLINICAL_REVIEW (sandbox only) until a cardiologist signs them off.
//
// Sources (checked 30 Sep 2026):
//  - 2026 ESC HF guidelines (Eur Heart J, ehag100): CRT class by QRS width/morphology (Rec. Table 7);
//    CRT planning alongside foundational therapy with LBBB ≥150 ms and LVEF ≤35% (IIb, new);
//    CRT rather than RV pacing in HFrEF needing ventricular pacing for high-degree AV block (IIa).
//  - 2021 ESC pacing & CRT guidelines: QRS/morphology classes; LVEF <40% threshold for CRT instead of RV pacing.
//  - Ivabradine label: sinus rhythm required (not effective in AF; stop if AF persists).
//  - 2022 ESC ventricular arrhythmias: drug-induced QT prolongation (QTc ≥500 ms, or a rise ≥60 ms,
//    is the usual review point for QT-prolonging drugs; correct K and Mg).
import { MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { DIAGNOSIS } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import { obstructiveCad, STUDY_LABEL } from "../../shared/studies.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import type { Fact, Finding, RuleDef } from "./rules.js";

const live = (s: PatientState) => s.meds.filter((m) => m.status === "active");
const studyFact = (st: { kind: string; performed_at: string; findings: string[] }): Fact => ({ label: STUDY_LABEL[st.kind] ?? st.kind, value: st.findings[0] ?? "recorded", date: st.performed_at });
const HIGH_AV = ["Mobitz II", "Complete"];

// Rhythm on the newest ECG (or Holter) within `days`.
export function recentRhythm(s: PatientState, days: number) {
  const ecg = latestStudy(s, "ecg", days);
  return ecg ? { rhythm: String(ecg.attributes.rhythm ?? ""), study: ecg } : null;
}

// ESC CRT class from QRS width and morphology (thresholds are parameters).
export function crtClass(qrs: number, morph: string, p: { qrs_long: number; qrs_min: number }) {
  if (morph === "Paced") return { cls: "upgrade", text: "Paced QRS: assess CRT upgrade" };
  const lbbb = morph === "LBBB";
  if (qrs >= p.qrs_long) return lbbb ? { cls: "I", text: `LBBB, QRS ≥${p.qrs_long} ms: CRT class I` } : { cls: "IIa", text: `non-LBBB, QRS ≥${p.qrs_long} ms: CRT class IIa` };
  if (qrs >= p.qrs_min) return lbbb ? { cls: "IIa", text: `LBBB, QRS ${p.qrs_min}–${p.qrs_long - 1} ms: CRT class IIa` } : { cls: "IIb", text: `non-LBBB, QRS ${p.qrs_min}–${p.qrs_long - 1} ms: CRT class IIb` };
  return { cls: "none", text: `QRS <${p.qrs_min} ms: CRT not indicated` };
}

export const STUDY_RULES: RuleDef[] = [
  {
    id: "rhythm.ivabradine-sinus",
    kind: "clinical",
    title: "Ivabradine needs sinus rhythm",
    inputs: ["meds", "studies", "conditions"],
    defaultParams: { ecg_days: 90 },
    evidence: "Ivabradine is indicated in sinus rhythm only (label; ESC HF 2026). It has no effect on ventricular rate in AF and should be stopped if AF persists.",
    evaluate(s, p) {
      const iva = live(s).find((m) => m.code === "ivabradine");
      if (!iva) return [];
      const r = recentRhythm(s, Number(p.ecg_days));
      const permanent = s.conditions.find((c) => c.code === "af" && c.attributes?.pattern === "Permanent");
      const inAf = r && /fibrillation|flutter|Paced/i.test(r.rhythm);
      if (!inAf && !permanent) return [];
      return [{
        key: "iva-" + iva.id,
        signature: `${iva.id}:${r?.study.id ?? "perm"}`,
        severity: "orange",
        title: `Ivabradine with ${inAf ? r!.rhythm.toLowerCase() : "permanent AF"}: stop`,
        detail: inAf && /Paced/i.test(r!.rhythm) ? "Ivabradine works only on the sinus node: in a paced rhythm it has no effect. Stop it." : "Ivabradine works only in sinus rhythm. Control rate with a beta-blocker (± digoxin) instead.",
        facts: [{ label: "Current", value: `${iva.name} ${doseLabel(MEDICATION[iva.code], iva.doseValue, iva.doseUnit)} ${iva.frequency ?? ""}` }, ...(r ? [studyFact(r.study)] : []), ...(permanent ? [{ label: "History", value: "Permanent AF" }] : []), { label: "Guideline", value: "Ivabradine label · ESC HF 2026" }],
        missing: [],
        action: { type: "med-action", medicationId: iva.id, action: "stop", label: "Stop ivabradine" },
      }];
    },
  },
  {
    id: "rhythm.qtc-drug",
    kind: "clinical",
    title: "QTc prolongation",
    inputs: ["qtc", "meds", "potassium", "magnesium"],
    defaultParams: { qtc_ms: 500, rise_ms: 60, ecg_days: 90 },
    evidence: "2022 ESC ventricular arrhythmias: in drug-induced QT prolongation stop or avoid QT-prolonging drugs and correct potassium and magnesium; QTc ≥500 ms or a rise ≥60 ms from baseline is the usual review point.",
    evaluate(s, p) {
      const q = s.resolved("qtc");
      const cur = q.current;
      if (!cur?.value_num || (Date.parse(s.today) - Date.parse(cur.effective_at)) / 86400000 > Number(p.ecg_days)) return [];
      const prev = q.history.find((o) => o.id !== cur.id && o.effective_at < cur.effective_at && o.value_num != null);
      const rise = prev ? cur.value_num - prev.value_num! : null;
      const long = cur.value_num >= Number(p.qtc_ms);
      const rising = rise != null && rise >= Number(p.rise_ms);
      if (!long && !rising) return [];
      const qtDrugs = live(s).filter((m) => m.tags.includes("qt"));
      const k = s.resolved("potassium").current, mg = s.resolved("magnesium").current;
      const facts: Fact[] = [
        { label: "QTc", value: `${formatNumber(cur.value_num, 0)} ms`, date: cur.effective_at, tone: long ? "red" : "orange" },
        ...(prev ? [{ label: "Previous QTc", value: `${formatNumber(prev.value_num!, 0)} ms`, date: prev.effective_at }] : []),
        ...qtDrugs.map((m) => ({ label: "QT-prolonging drug", value: m.name })),
        ...(k?.value_num != null ? [{ label: "Potassium", value: `${formatNumber(k.value_num, 1)} mmol/L`, date: k.effective_at }] : []),
        ...(mg?.value_num != null ? [{ label: "Magnesium", value: `${formatNumber(mg.value_num, 2)} mmol/L`, date: mg.effective_at }] : []),
        { label: "Guideline", value: "ESC ventricular arrhythmias 2022 · drug-induced QT prolongation" },
      ];
      const missing = [k?.value_num == null && "Potassium", mg?.value_num == null && "Magnesium"].filter(Boolean) as string[];
      return [{
        key: "qtc",
        signature: `${cur.id}:${qtDrugs.map((m) => m.id).join(",")}`,
        severity: long && qtDrugs.length ? "red" : "orange",
        title: `QTc ${formatNumber(cur.value_num, 0)} ms${rising ? ` (+${formatNumber(rise!, 0)} ms)` : ""}${qtDrugs.length ? ` on ${qtDrugs.map((m) => m.name.toLowerCase()).join(" and ")}` : ""}`,
        detail: qtDrugs.length ? "Review the QT-prolonging drug; correct potassium and magnesium; repeat the ECG." : "Look for QT-prolonging drugs and electrolyte causes; repeat the ECG.",
        facts,
        missing,
        action: qtDrugs.length ? { type: "med-action", medicationId: qtDrugs[0].id, action: "hold", label: `Review ${qtDrugs[0].name.toLowerCase()}` } : { type: "add-labs", codes: ["potassium", "magnesium"], label: "Check K and Mg" },
      }];
    },
  },
  {
    id: "device.pacing-mode",
    kind: "clinical",
    title: "High-degree AV block with reduced LVEF: CRT rather than RV pacing",
    inputs: ["studies", "conditions", "lvef"],
    defaultParams: { lvef_below: 40, days: 180 },
    evidence: "2021 ESC pacing and CRT: CRT rather than RV pacing is recommended for HFrEF (LVEF <40%) regardless of NYHA class with an indication for ventricular pacing and high-degree AV block, including AF (I A; upgraded from IIa B in 2013). Confirmed 7 Oct 2026 against the ACC summary of the guideline.",
    evaluate(s, p) {
      if (s.tags.has("crt")) return [];
      const ef = s.resolved("lvef").current;
      if (!ef?.value_num || ef.value_num >= Number(p.lvef_below)) return [];
      const fromStudy = [latestStudy(s, "ecg", Number(p.days)), latestStudy(s, "holter", Number(p.days))].find((st) => st && HIGH_AV.includes(st.attributes.avBlock));
      const fromHistory = s.conditions.find((c) => c.code === "av-block" && HIGH_AV.includes(c.attributes?.degree));
      if (!fromStudy && !fromHistory) return [];
      return [{
        key: "pacing-mode",
        signature: `${ef.id}:${fromStudy?.id ?? fromHistory?.logical_id}`,
        severity: "orange",
        title: `${fromStudy ? fromStudy.attributes.avBlock : fromHistory!.attributes.degree} AV block with LVEF ${formatNumber(ef.value_num, 0)}%: if pacing, CRT rather than RV pacing`,
        detail: "Plan the device with the EP team; the pacing indication itself is the clinician's decision.",
        facts: [{ label: "LVEF", value: `${formatNumber(ef.value_num, 0)}%`, date: ef.effective_at }, fromStudy ? studyFact(fromStudy) : { label: "History", value: `${fromHistory!.attributes.degree} AV block` }, { label: "Guideline", value: "ESC pacing 2021 · I A" }],
        missing: [],
        action: { type: "add-plan", template: "device" },
      }];
    },
  },
  {
    id: "studies.problem-list",
    kind: "clinical",
    title: "Study findings not on the problem list",
    inputs: ["studies", "conditions"],
    defaultParams: { days: 365 },
    evidence: "A diagnosis shown by a study (obstructive coronary disease, high-degree AV block; AF/flutter goes through the AF-CARE pathway) drives prevention, anticoagulation and device rules only once it is on the problem list.",
    evaluate(s, p) {
      const out: Finding[] = [];
      const recent = s.studies.filter((st) => (Date.parse(s.today) - Date.parse(st.performed_at)) / 86400000 <= Number(p.days));
      const newest = (pred: (st: (typeof recent)[number]) => boolean) => [...recent].sort((a, b) => (a.performed_at < b.performed_at ? 1 : -1)).find(pred);
      const cad = newest((st) => !!obstructiveCad(st.kind, st.attributes));
      if (cad && !s.tags.has("cad"))
        out.push({
          key: "cad", signature: cad.id, severity: "blue",
          title: `${obstructiveCad(cad.kind, cad.attributes)} on ${STUDY_LABEL[cad.kind]} ${fmtDay(cad.performed_at)}: add coronary disease to the problem list`,
          detail: "Once listed, lipid goals, antiplatelet therapy and rehabilitation follow automatically.",
          facts: [studyFact(cad)], missing: [], action: { type: "history", focus: "cardiac", label: "Update history" },
        });
      // AF/flutter on an ECG or Holter is offered as the AF-CARE pathway (rhythm.ecg-af-undiagnosed), which also lists it
      const av = newest((st) => HIGH_AV.includes(st.attributes.avBlock));
      if (av && !s.conditions.some((c) => c.code === "av-block"))
        out.push({
          key: "av", signature: av.id, severity: "orange",
          title: `${av.attributes.avBlock} AV block on ${STUDY_LABEL[av.kind]} ${fmtDay(av.performed_at)}`,
          detail: `Not on the problem list. Review rate-slowing drugs; ${DIAGNOSIS["av-block"].display} can be added with its degree.`,
          facts: [studyFact(av)], missing: [], action: { type: "history", focus: "cardiac", label: "Update history" },
        });
      return out;
    },
  },
];
