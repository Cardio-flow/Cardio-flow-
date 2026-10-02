// Heart failure module rules (Phase 2).
//
// hf.advanced-hf — markers of advanced HF → consult an advanced HF centre.
// Source: 2026 ESC HF guidelines, Recommendation Table 11 (Class I, A): early consultation with
// an advanced HF centre is recommended for patients with advanced HF or at risk of advanced HF
// who are motivated and have no absolute contraindication to heart transplantation or durable
// MCS. Markers: the I-NEED-HELP list as used by the HFA-ESC (Crespo-Leiro et al., Eur J Heart
// Fail 2018;20:1505, doi:10.1002/ejhf.1236) and the HELP-HF registry (≥1 marker = at risk).
// Numbers are the published ones: LVEF ≤25%, >1 HF hospitalisation in 12 months, SBP <90 mmHg
// (the lower end of the published "<90–100"). Markers with no number in the source (end-organ
// dysfunction, escalating diuretics, intolerance of prognostic drugs) are read from recorded
// events, not from a threshold. Confirm against 2026 Tables 14–15 when the full text is at hand.
//
// Ahmed (2 Oct 2026): shown under Needs attention (orange), not as a quiet card.
import { classLabel, formatNumber } from "../../shared/catalog.js";
import { daysBetween, fmtDay } from "../../shared/clinical.js";
import { isHfAdmission } from "../../shared/encounters.js";
import type { PatientState } from "../kernel/state.js";
import type { Fact, RuleDef } from "./rules.js";

// foundational ("prognostic") drug classes whose reduction or withdrawal is the P marker
const PROGNOSTIC = ["bb", "raas", "arni", "mra"];
const PATIENT_REPORTED = /^(Stopped by patient|Patient reports)/i;

export type Marker = { key: string; letter: string; label: string; short: string; value: string; date?: string };

export function advancedHfMarkers(s: PatientState, p: { lvef_max: number; sbp_below: number; hf_admissions: number; lookback_days: number }) {
  const within = (iso: string | null | undefined) => !!iso && daysBetween(iso, s.today) <= p.lookback_days;
  const out: Marker[] = [];
  const admissions = s.contexts.filter((c) => c.kind === "admission" && within(c.started_at));
  const events = admissions.flatMap((c) => ((c.summary as any)?.events as string[] | undefined)?.map((e) => ({ e, at: c.ended_at ?? c.started_at })) ?? []);
  const evt = (re: RegExp) => events.filter((x) => re.test(x.e)).pop();

  // I — inotropes or vasopressors (or cardiogenic shock) during an admission
  const ino = evt(/Inotropes|Cardiogenic shock/i);
  if (ino) out.push({ key: "inotropes", letter: "I", label: "Inotropes / shock", short: /shock/i.test(ino.e) ? "cardiogenic shock" : "inotropes", value: ino.e, date: ino.at });

  // N — NYHA III–IV
  const nyha = s.resolved("nyha").current;
  if (nyha && /^(III|IV)/.test(nyha.value_text ?? "") && within(nyha.effective_at))
    out.push({ key: "nyha", letter: "N", label: "NYHA class", short: `NYHA ${nyha.value_text}`, value: nyha.value_text!, date: nyha.effective_at });

  // E — very low ejection fraction
  const ef = s.resolved("lvef").current;
  if (ef?.value_num != null && ef.value_num <= p.lvef_max)
    out.push({ key: "ef", letter: "E", label: "LVEF", short: `LVEF ${formatNumber(ef.value_num, 0)}%`, value: `${formatNumber(ef.value_num, 0)}% (≤${p.lvef_max}%)`, date: ef.effective_at });

  // E — end-organ dysfunction: acute kidney injury recorded during an admission
  const aki = evt(/kidney injury/i);
  if (aki) out.push({ key: "end-organ", letter: "E", label: "End-organ dysfunction", short: "acute kidney injury", value: aki.e, date: aki.at });

  // D — defibrillator shocks / malignant arrhythmia during an admission
  const vt = evt(/VT \/ VF|Cardiac arrest/i);
  if (vt) out.push({ key: "arrhythmia", letter: "D", label: "Ventricular arrhythmia", short: /arrest/i.test(vt.e) ? "cardiac arrest" : "VT/VF", value: vt.e, date: vt.at });

  // H — more than one HF hospitalisation in 12 months
  const hf = admissions.filter((c) => isHfAdmission(c as any));
  if (hf.length >= p.hf_admissions)
    out.push({ key: "hosp", letter: "H", label: "HF hospitalisations", short: `${hf.length} HF admissions in 12 months`, value: `${hf.length} in the last 12 months`, date: hf[hf.length - 1].started_at });

  // E — oedema despite escalating diuretics: loop dose increased and still congested
  const loopUp = s.meds
    .filter((m) => m.tags.includes("loop"))
    .flatMap((m) => m.events.filter((e) => e.kind === "increase" && within(e.effective_at) && !PATIENT_REPORTED.test(e.reason)))
    .pop();
  const cong = s.resolved("congestion").current;
  const congested = cong && cong.value_text && !/^None/i.test(cong.value_text) && (!loopUp || cong.effective_at >= loopUp.effective_at);
  if (loopUp && congested)
    out.push({ key: "oedema", letter: "E", label: "Congestion despite more diuretic", short: "congested despite more diuretic", value: `${cong!.value_text} congestion after loop diuretic increase ${fmtDay(loopUp.effective_at)}`, date: cong!.effective_at });

  // L — low blood pressure
  const sbp = s.resolved("sbp").current;
  if (sbp?.value_num != null && sbp.value_num < p.sbp_below && within(sbp.effective_at))
    out.push({ key: "bp", letter: "L", label: "Low blood pressure", short: `SBP ${formatNumber(sbp.value_num, 0)}`, value: `SBP ${formatNumber(sbp.value_num, 0)} mmHg`, date: sbp.effective_at });

  // P — prognostic medication reduced, held or stopped by a clinician, or not tolerated
  const reduced = s.meds
    .filter((m) => m.tags.some((t) => PROGNOSTIC.includes(t)))
    .flatMap((m) => m.events.filter((e) => (e.kind === "decrease" || e.kind === "hold" || e.kind === "stop") && within(e.effective_at) && !PATIENT_REPORTED.test(e.reason)).map((e) => ({ m, e })))
    .pop();
  const intolerant = s.barriers.filter((b) => b.category === "intolerance" && PROGNOSTIC.includes(b.drug_class.replace(/^up:/, ""))).pop();
  if (reduced)
    out.push({ key: "prognostic", letter: "P", label: "Prognostic therapy reduced", short: `${reduced.m.name.toLowerCase()} ${reduced.e.kind === "decrease" ? "reduced" : reduced.e.kind === "hold" ? "held" : "stopped"}`, value: `${reduced.m.name} ${reduced.e.kind === "decrease" ? "reduced" : reduced.e.kind === "hold" ? "held" : "stopped"}${reduced.e.reason ? ": " + reduced.e.reason : ""}`, date: reduced.e.effective_at });
  else if (intolerant)
    out.push({ key: "prognostic", letter: "P", label: "Prognostic therapy not tolerated", short: `${classLabel(intolerant.drug_class).toLowerCase()} not tolerated`, value: intolerant.detail || "intolerance recorded", date: intolerant.effective_at });
  return out;
}

export const HF_RULES: RuleDef[] = [
  {
    id: "hf.advanced-hf",
    kind: "clinical",
    title: "Advanced HF markers: advanced HF centre consultation",
    inputs: ["contexts", "nyha", "lvef", "sbp", "congestion", "meds", "conditions", "plan"],
    defaultParams: { lvef_max: 25, sbp_below: 90, hf_admissions: 2, lookback_days: 365 },
    evidence:
      "2026 ESC HF, Rec. Table 11 (Class I, A): early consultation with an advanced HF centre for patients with advanced HF or at risk of it, who are motivated and have no absolute contraindication to transplant or durable MCS. Markers: I-NEED-HELP (HFA-ESC 2018 position statement; HELP-HF registry, ≥1 marker): inotropes, NYHA III–IV, LVEF ≤25%, end-organ dysfunction, defibrillator shocks / ventricular arrhythmia, >1 HF hospitalisation in 12 months, oedema despite escalating diuretics, SBP <90 mmHg, prognostic medication reduced or not tolerated.",
    evaluate(s, p) {
      if (!s.tags.has("hf")) return [];
      // a consultation already planned or done: the decision is owned
      if (s.plan.some((a) => a.status !== "cancelled" && /advanced HF/i.test(a.title))) return [];
      const params = { lvef_max: Number(p.lvef_max), sbp_below: Number(p.sbp_below), hf_admissions: Number(p.hf_admissions), lookback_days: Number(p.lookback_days) };
      const markers = advancedHfMarkers(s, params);
      if (!markers.length) return [];
      const ntp = s.resolved("nt-probnp").current;
      const facts: Fact[] = [
        ...markers.map((m) => ({ label: `${m.letter} · ${m.label}`, value: m.value, date: m.date, tone: "orange" as const })),
        ...(ntp?.value_num != null ? [{ label: "NT-proBNP", value: `${formatNumber(ntp.value_num, 0)} pg/mL`, date: ntp.effective_at }] : []),
        { label: "Guideline", value: "ESC HF 2026 · Rec. Table 11 (I, A) · I-NEED-HELP" },
      ];
      const missing: string[] = [];
      if (!s.resolved("nyha").current) missing.push("NYHA class");
      if (!s.resolved("lvef").current) missing.push("LVEF");
      if (s.tags.has("icd") || s.tags.has("crt")) missing.push("ICD shocks since the last device check (not recorded in CardioFlow yet)");
      return [{
        key: "advanced-hf",
        signature: markers.map((m) => m.key).sort().join("+"),
        severity: "orange",
        title: `Advanced HF marker${markers.length > 1 ? "s" : ""}: ${markers.map((m) => m.short).join(", ")} · consider advanced HF centre consultation`,
        detail:
          "Early consultation with an advanced HF centre is recommended (ESC 2026, I A) for patients with or at risk of advanced HF who are motivated and have no absolute contraindication to transplant or durable MCS. " +
          "If they are not candidates, plan symptom-focused care and discuss goals with the patient.",
        facts,
        missing,
        action: { type: "add-plan", template: "advanced-hf" },
      }];
    },
  },
];
