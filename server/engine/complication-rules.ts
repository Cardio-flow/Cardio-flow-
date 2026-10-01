// Rules that open the complication wizards (congestion, low blood pressure, bradycardia).
// Every number is a governed parameter; all start in CLINICAL_REVIEW (sandbox only).
//
// Sources: ESC HF 2021 practical guidance on ACEi/ARB/ARNI, beta-blockers and diuretics
// (symptomatic hypotension: review vasodilators, then diuretic if not congested, then RAAS;
// HR <50 bpm with symptoms: halve beta-blocker, review other rate-slowing drugs, ECG to exclude
// block); ESC HF self-care (weight gain >2 kg in 3 days); ESC 2021 pacing (high-grade AV block,
// pauses). Retained in the 2023 update and 2026 guideline; confirm the wording in review.
import { formatNumber } from "../../shared/catalog.js";
import { daysBetween, fmtDay } from "../../shared/clinical.js";
import { latestStudy, openContext, series, type PatientState } from "../kernel/state.js";
import type { Fact, RuleDef } from "./rules.js";

const on = (s: PatientState, ...tags: string[]) => s.meds.filter((m) => m.status === "active" && m.tags.some((t) => tags.includes(t)));
const recent = (s: PatientState, code: string, days: number) => {
  const c = s.resolved(code).current;
  return c && c.value_num != null && daysBetween(c.effective_at, s.today) <= days ? c : null;
};

export const COMPLICATION_RULES: RuleDef[] = [
  {
    id: "hf.congestion",
    kind: "clinical",
    title: "Congestion / worsening heart failure",
    inputs: ["weight", "congestion"],
    defaultParams: { weight_gain_kg: 2, weight_days: 3, exam_days: 14 },
    evidence: "ESC HF self-care: unexpected weight gain >2 kg in 3 days; clinical congestion prompts diuretic adjustment, precipitant search and early review (ESC HF 2021 practical guidance).",
    evaluate(s, p) {
      if (!s.tags.has("hf") || openContext(s)?.kind === "admission") return [];
      const facts: Fact[] = [];
      const wt = series(s, "weight").filter((o) => daysBetween(o.effective_at, s.today) <= Number(p.weight_days) + 30);
      const latest = wt[0];
      let gain: number | null = null;
      if (latest) {
        const before = wt.slice(1).filter((o) => daysBetween(o.effective_at, latest.effective_at) <= Number(p.weight_days));
        if (before.length) gain = latest.value_num! - Math.min(...before.map((o) => o.value_num!));
      }
      const exam = s.resolved("congestion").current;
      const congested = exam && ["Moderate", "Severe"].includes(exam.value_text ?? "") && daysBetween(exam.effective_at, s.today) <= Number(p.exam_days);
      const gained = gain != null && gain >= Number(p.weight_gain_kg) && daysBetween(latest!.effective_at, s.today) <= 7;
      if (!congested && !gained) return [];
      if (gained) facts.push({ label: "Weight", value: `+${formatNumber(gain!, 1)} kg in ≤${p.weight_days} days`, date: latest!.effective_at, tone: "orange" });
      if (exam) facts.push({ label: "Congestion on exam", value: exam.value_text ?? "", date: exam.effective_at, tone: congested ? "orange" : undefined });
      const loop = on(s, "loop")[0];
      facts.push({ label: "Loop diuretic", value: loop ? `${loop.name} ${loop.doseValue ?? ""} ${loop.doseUnit ?? ""} ${loop.frequency ?? ""}`.trim() : "None" });
      facts.push({ label: "Guideline", value: "ESC HF · congestion and self-care" });
      return [{
        key: "congestion",
        signature: `${exam?.id ?? ""}:${latest?.id ?? ""}`,
        severity: exam?.value_text === "Severe" ? "red" : "orange",
        title: gained && congested ? `Congested with +${formatNumber(gain!, 1)} kg weight gain` : gained ? `Weight up ${formatNumber(gain!, 1)} kg in ${p.weight_days} days` : `${exam!.value_text} congestion on ${fmtDay(exam!.effective_at)}`,
        detail: "Look for red flags and the precipitant; adjust the diuretic; recheck renal function, K and weight.",
        facts,
        missing: s.resolved("creatinine").current ? [] : ["Creatinine"],
        action: { type: "wizard", wizard: "congestion" },
      }];
    },
  },
  {
    id: "hf.symptomatic-hypotension",
    kind: "clinical",
    title: "Low blood pressure on HF therapy",
    inputs: ["sbp", "meds", "lactate"],
    defaultParams: { sbp_below: 90, days: 30 },
    evidence: "ESC HF 2021 practical guidance: asymptomatic hypotension needs no change; if symptomatic, reduce non-HF BP-lowering drugs first, then the diuretic if not congested, then RAAS/ARNI.",
    evaluate(s, p) {
      const sbp = recent(s, "sbp", Number(p.days));
      if (!sbp || sbp.value_num! >= Number(p.sbp_below)) return [];
      // with a raised lactate this is possible shock (acute.shock), not drug-related hypotension
      const lac = recent(s, "lactate", 2);
      if (lac && lac.value_num! >= 2) return [];
      const drugs = on(s, "raas", "bb", "loop", "mra", "sglt2", "vasodilator", "bp-lowering");
      if (!drugs.length) return [];
      return [{
        key: "hypotension",
        signature: sbp.id,
        severity: "orange",
        title: `SBP ${formatNumber(sbp.value_num!, 0)} mmHg on ${drugs.length} BP-lowering drug${drugs.length === 1 ? "" : "s"}: symptoms?`,
        detail: "If asymptomatic, usually no change. If symptomatic: non-HF BP-lowering drugs first, then the diuretic if not congested, then RAAS/ARNI.",
        facts: [{ label: "Systolic BP", value: `${formatNumber(sbp.value_num!, 0)} mmHg`, date: sbp.effective_at, tone: "orange" }, ...drugs.slice(0, 5).map((m) => ({ label: m.drugClass, value: m.name })), { label: "Guideline", value: "ESC HF 2021 practical guidance" }],
        missing: [],
        action: { type: "wizard", wizard: "hypotension" },
      }];
    },
  },
  {
    id: "rhythm.bradycardia",
    kind: "clinical",
    title: "Bradycardia / AV block",
    inputs: ["hr", "meds", "studies"],
    defaultParams: { hr_below: 50, hr_severe: 40, pause_s: 3, days: 30, study_days: 90 },
    evidence: "ESC HF 2021 practical guidance on beta-blockers (HR <50 bpm with symptoms: halve dose, review other rate-slowing drugs, ECG to exclude block); ESC 2021 pacing (Mobitz II / complete AV block, pauses).",
    evaluate(s, p) {
      const hr = recent(s, "hr", Number(p.days));
      const slowing = on(s, "bb", "rate-slowing");
      const ecg = latestStudy(s, "ecg", Number(p.study_days));
      const holter = latestStudy(s, "holter", Number(p.study_days));
      const block = [ecg, holter].find((st) => ["Mobitz II", "Complete"].includes(st?.attributes.avBlock));
      const pause = holter && Number(holter.attributes.longestPause ?? 0) >= Number(p.pause_s) ? holter : null;
      const slow = hr && hr.value_num! < Number(p.hr_below) && slowing.length > 0;
      if (!slow && !block && !pause) return [];
      const severe = !!block || !!pause || (hr != null && hr.value_num! < Number(p.hr_severe));
      const facts: Fact[] = [];
      if (hr) facts.push({ label: "Heart rate", value: `${formatNumber(hr.value_num!, 0)} bpm`, date: hr.effective_at, tone: slow ? "orange" : undefined });
      if (block) facts.push({ label: block.kind === "ecg" ? "ECG" : "Holter", value: `${block.attributes.avBlock} AV block`, date: block.performed_at, tone: "red" });
      if (pause) facts.push({ label: "Holter", value: `Pause ${pause.attributes.longestPause} s`, date: pause.performed_at, tone: "red" });
      for (const m of slowing.slice(0, 4)) facts.push({ label: "Rate-slowing drug", value: m.name });
      facts.push({ label: "Guideline", value: "ESC HF 2021 practical guidance · ESC pacing 2021" });
      return [{
        key: "brady",
        signature: `${hr?.id ?? ""}:${block?.id ?? ""}:${pause?.id ?? ""}`,
        severity: severe ? "red" : "orange",
        title: block ? `${block.attributes.avBlock} AV block` : pause ? `Pause of ${pause.attributes.longestPause} s on Holter` : `Heart rate ${formatNumber(hr!.value_num!, 0)} bpm on rate-slowing therapy`,
        detail: severe ? "Same-day assessment; stop rate-slowing drugs where possible; pacing assessment." : "Ask about symptoms; review every rate-slowing drug; ECG to exclude heart block.",
        facts,
        missing: ecg ? [] : ["Recent ECG"],
        action: { type: "wizard", wizard: "bradycardia" },
      }];
    },
  },
];
