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
import { MEDICATION, classLabel, doseLabel, formatNumber } from "../../shared/catalog.js";
import { addDays, daysBetween, fmtDay } from "../../shared/clinical.js";
import { isHfAdmission } from "../../shared/encounters.js";
import { activeBarrier, latestStudy, type PatientState } from "../kernel/state.js";
import type { Fact, Finding, RuleDef } from "./rules.js";
import { crtClass } from "./study-rules.js";
import { fmtStatus, hfImprovedEf, hfPhenotype } from "./guidelines.js";

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

  // P — prognostic medication reduced, held or stopped by a clinician, or not tolerated.
  // Not when LVEF has recovered: a stop then is a withdrawal decision (hf.improved-ef-continue).
  const recovered = !!hfImprovedEf(s);
  const reduced = recovered ? undefined : s.meds
    .filter((m) => m.tags.some((t) => PROGNOSTIC.includes(t)))
    .flatMap((m) => m.events.filter((e) => (e.kind === "decrease" || e.kind === "hold" || e.kind === "stop") && within(e.effective_at) && !PATIENT_REPORTED.test(e.reason)).map((e) => ({ m, e })))
    .pop();
  const intolerant = recovered ? undefined : s.barriers.filter((b) => b.category === "intolerance" && PROGNOSTIC.includes(b.drug_class.replace(/^up:/, ""))).pop();
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

// ---------------------------------------------------------------------------------------------
// Optimal foundational medical therapy (FMT), as the device and valve recommendations use it:
// every HFrEF pillar is either taken, or not possible now (a recorded intolerance /
// contraindication, or a safety gate such as K >5.0). The date is the latest start or restart
// among the pillars taken. "At the highest tolerated dose" cannot be read from the record, so the
// panel shows % of target beside it and the clinician confirms.
export function optimalFmt(s: PatientState) {
  const fmt = fmtStatus(s);
  if (!fmt) return null;
  const gaps = fmt.pillars.filter((p) => p.state === "missing" || p.state === "held").map((p) => p.label);
  const starts = fmt.pillars
    .filter((p) => p.state === "on" || p.state === "target")
    .map((p) => {
      const m = s.meds.find((x) => x.status === "active" && x.tags.includes(p.key));
      const e = m ? [...m.events].reverse().find((x) => x.kind === "start" || x.kind === "restart") : null;
      return e?.effective_at ?? m?.startedAt ?? null;
    })
    .filter((x): x is string => !!x)
    .sort();
  const complete = gaps.length === 0 && starts.length > 0;
  const since = complete ? starts[starts.length - 1] : null;
  return { complete, since, gaps, reassessFrom: since ? addDays(since.slice(0, 10), 90) : null };
}

const ISCHAEMIC = (s: PatientState) => {
  const hf = s.conditions.find((c) => ["hfref", "hfmref", "hfpef", "hfimpef"].includes(c.code));
  const a: string[] = Array.isArray(hf?.attributes?.aetiology) ? hf!.attributes.aetiology : hf?.attributes?.aetiology ? [hf.attributes.aetiology] : [];
  if (a.includes("Ischaemic") || s.conditions.some((c) => ["prior-mi", "acs-stemi", "acs-nstemi", "prior-cabg", "prior-pci"].includes(c.code))) return "ischaemic" as const;
  if (a.length && !a.every((x) => x === "Unknown")) return "non-ischaemic" as const;
  return null;
};

HF_RULES.push(
  {
    // Rebuilt 2 Oct 2026 from the HF Registry engine (replaces the "may become relevant" card).
    id: "hf.device-assessment",
    kind: "clinical",
    title: "ICD / CRT decision in HFrEF",
    inputs: ["lvef", "conditions", "studies", "qrs", "meds", "nyha", "potassium", "egfr", "sbp", "hr", "plan"],
    defaultParams: { lvef_threshold: 35, qrs_long: 150, qrs_min: 130, ecg_days: 365, omt_days: 90, post_mi_days: 40 },
    evidence:
      "ESC HF 2026 Rec. Tables 6–7: ICD in symptomatic HFrEF (NYHA II–III) with LVEF ≤35% despite ≥3 months of optimal FMT, expected to survive >1 year with good functional status (ESC 2021: ischaemic I A, non-ischaemic IIa A; not within 40 days of MI); CRT class by QRS width and morphology (LBBB ≥150 ms I; LBBB 130–149 IIa; non-LBBB ≥150 IIa; non-LBBB 130–149 IIb; <130 not indicated); CRT planning may start alongside FMT with LBBB ≥150 ms (IIb C). ESC pacing 2021: pacemaker or ICD with LVEF ≤35% despite OMT and a significant proportion of RV pacing → consider CRT upgrade (IIa B). Suggestions only; never an implant order.",
    evaluate(s, p) {
      if (hfPhenotype(s) !== "HFrEF" || hfImprovedEf(s)) return [];
      const ef = s.resolved("lvef").current;
      if (!ef || ef.value_num == null || ef.value_num > Number(p.lvef_threshold)) return [];
      if (s.tags.has("icd") && s.tags.has("crt")) return [];
      if (s.plan.some((a) => a.status === "planned" && /\b(ICD|CRT)\b|device implant/i.test(a.title) && !/reassessment/i.test(a.title))) return [];
      const efTxt = `LVEF ${formatNumber(ef.value_num, 0)}%`;
      const dev = ["icd", "crt", "pacemaker"].filter((t) => s.tags.has(t)).join("+") || "none";
      const ecg = latestStudy(s, "ecg", Number(p.ecg_days));
      const qrs = ecg?.attributes.qrs != null ? Number(ecg.attributes.qrs) : null;
      const morph = ecg?.attributes.qrsMorphology as string | undefined;
      const inAf = /fibrillation|flutter/i.test(ecg?.attributes.rhythm ?? "");
      const crt = qrs != null && morph ? crtClass(qrs, morph, { qrs_long: Number(p.qrs_long), qrs_min: Number(p.qrs_min) }) : null;
      // an ICD is in place: only CRT is left to decide, and only with QRS criteria
      if (s.tags.has("icd") && (!crt || crt.cls === "none" || crt.cls === "upgrade")) return [];
      const opt = optimalFmt(s)!;
      const nyha = s.resolved("nyha").current;
      const facts: Fact[] = [
        { label: "LVEF", value: `${formatNumber(ef.value_num, 0)}% (${ef.quality})`, date: ef.effective_at },
        ...(ecg ? [{ label: "ECG", value: [ecg.attributes.rhythm, qrs != null ? `QRS ${qrs} ms` : null, morph].filter(Boolean).join(" · ") || "recorded", date: ecg.performed_at }] : []),
        ...(nyha ? [{ label: "NYHA", value: nyha.value_text ?? "", date: nyha.effective_at }] : []),
        { label: "Optimal FMT", value: opt.complete ? `since ${fmtDay(opt.since!, { year: true })}` : `not yet: ${opt.gaps.join(", ")}`, tone: opt.complete ? undefined : ("orange" as const) },
      ];
      const missingEcg = ecg && qrs != null && morph ? [] : [`ECG within ${Math.round(Number(p.ecg_days) / 30)} months (QRS width and morphology)`];
      const guideline = { label: "Guideline", value: "ESC HF 2026 · Rec. Tables 6–7 · ESC pacing 2021" };

      // 1. conventional pacemaker (or ICD without CRT) with LVEF ≤35%: CRT upgrade
      if (s.tags.has("pacemaker") && !s.tags.has("crt"))
        return [{
          key: "device", signature: `upgrade${dev}:${ef.id}`, severity: "blue",
          title: `Pacemaker with ${efTxt}: consider upgrade to CRT`,
          detail: `With a significant proportion of RV pacing, upgrade to CRT should be considered (ESC pacing 2021, IIa B)${opt.complete ? "" : ", once foundational therapy is optimised"}. Check the RV pacing percentage at the next device check.`,
          facts: [...facts, guideline], missing: ["RV pacing % from the last device check (not recorded in CardioFlow yet)"],
          action: { type: "add-plan", template: "device" },
        }];

      // 2. foundational therapy not yet optimal, or optimal for <3 months: reassess later
      const ready = opt.complete && opt.reassessFrom! <= s.today;
      if (!ready) {
        const early = crt?.cls === "I" && !inAf;
        return [{
          key: "device", signature: `wait${dev}:${ef.id}:${ecg?.id ?? "no-ecg"}:${opt.since ?? "incomplete"}`, severity: "blue",
          title: opt.complete
            ? `${efTxt}: ICD/CRT decision after ≥3 months of optimal therapy · repeat Echo from ${fmtDay(opt.reassessFrom!, { year: true })}`
            : `${efTxt}: optimise foundational therapy first (${opt.gaps.join(", ")}), then reassess for ICD/CRT`,
          detail: [crt ? crt.text + "." : null, inAf ? "In AF, CRT needs near-100% biventricular pacing." : null,
            early ? "With LBBB ≥150 ms, CRT planning may start alongside foundational therapy (ESC 2026, IIb C)." : null,
            "Not an implant recommendation."].filter(Boolean).join(" "),
          facts: [...facts, guideline], missing: missingEcg,
          action: ecg ? { type: "add-plan", template: "echo" } : { type: "add-plan", template: "ecg" },
        }];
      }

      // 3. ≥3 months of optimal therapy, but the LVEF predates it: repeat the Echo now
      if (ef.effective_at.slice(0, 10) < opt.reassessFrom!)
        return [{
          key: "device", signature: `repeat${dev}:${ef.id}:${opt.since}`, severity: "blue",
          title: `≥3 months of optimal therapy since ${fmtDay(opt.since!, { year: true })}: repeat Echo to decide on ICD/CRT`,
          detail: `The last ${efTxt} (${fmtDay(ef.effective_at, { year: true })}) was measured before therapy had been optimal for 3 months.`,
          facts: [...facts, guideline], missing: missingEcg, action: { type: "add-plan", template: "echo" },
        }];

      // 4. LVEF ≤35% despite ≥3 months of optimal therapy: candidate
      const cls = nyha?.value_text ?? null;
      if (cls === "IV")
        return [{
          key: "device", signature: `nyha4${dev}:${ef.id}:${ecg?.id ?? "no-ecg"}`, severity: "blue",
          title: `${efTxt}, NYHA IV: ICD alone is not indicated`,
          detail: `${crt && crt.cls !== "none" ? crt.text + " — CRT may help symptoms. " : ""}Consider advanced HF therapies (advanced HF centre).`,
          facts: [...facts, guideline], missing: missingEcg, action: { type: "add-plan", template: "advanced-hf" },
        }];
      if (cls === "I")
        return [{
          key: "device", signature: `nyha1${dev}:${ef.id}`, severity: "blue",
          title: `${efTxt} on optimal therapy, NYHA I: ICD/CRT criteria need symptoms (NYHA II–III)`,
          detail: "Reassess if symptoms develop; keep foundational therapy.", facts: [...facts, guideline], missing: missingEcg, action: { type: "tab", tab: "plan" },
        }];
      const aet = ISCHAEMIC(s);
      // doses below target where an increase is still open: "optimal" means the highest tolerated dose
      const below = fmtStatus(s)!.pillars.filter((x) => x.percentOfTarget != null && x.percentOfTarget < 100).map((x) => `${(x.med ?? "").split(" ")[0]} ${x.percentOfTarget}%`);
      const recentMi = s.conditions.find((c) => ["acs-stemi", "acs-nstemi", "prior-mi"].includes(c.code) && c.onset && daysBetween(c.onset, s.today) < Number(p.post_mi_days));
      const wantIcd = !s.tags.has("icd");
      const wantCrt = !s.tags.has("crt") && crt && crt.cls !== "none" && crt.cls !== "upgrade";
      const what = wantIcd && wantCrt ? "CRT-D" : wantCrt ? (s.tags.has("icd") ? "upgrade to CRT-D" : "CRT") : "ICD";
      if (!wantIcd && !wantCrt) return [];
      return [{
        key: "device", signature: `candidate${dev}:${ef.id}:${ecg?.id ?? "no-ecg"}:${cls ?? "no-nyha"}:${aet ?? "unk"}`, severity: "orange",
        title: `${efTxt} despite ≥3 months of ${below.length ? "all four pillars (some below target)" : "optimal therapy"}${cls ? `, NYHA ${cls}` : ""}: ${what} candidate`,
        detail: [
          wantIcd ? `ICD for primary prevention: ${aet === "ischaemic" ? "ischaemic aetiology (ESC 2021: I A)" : aet === "non-ischaemic" ? "non-ischaemic aetiology (ESC 2021: IIa A)" : "record the aetiology (ischaemic I A, non-ischaemic IIa A)"}.` : null,
          recentMi ? `MI within ${p.post_mi_days} days: ICD not indicated yet.` : null,
          wantCrt ? crt!.text + "." : null,
          inAf && wantCrt ? "In AF, CRT needs near-100% biventricular pacing (AV-node ablation may be considered)." : null,
          below.length ? "Some doses are below target: the device decision follows therapy at the highest tolerated doses." : null,
          "Expected survival >1 year with good functional status; discuss with the patient and refer to EP. Not an implant order.",
        ].filter(Boolean).join(" "),
        facts: [...facts, { label: "Aetiology", value: aet ?? "not recorded", tone: aet ? undefined : ("orange" as const) },
          ...(below.length ? [{ label: "Below target dose", value: below.join(" · ") + " — confirm these are the highest tolerated", tone: "yellow" as const }] : []), guideline],
        missing: [...missingEcg, ...(cls ? [] : ["NYHA class"]), ...(aet ? [] : ["HF aetiology"])],
        action: { type: "add-plan", template: "device-referral" },
      }];
    },
  },
  {
    id: "hf.secondary-mr",
    kind: "clinical",
    title: "Severe secondary MR in HFrEF: heart-team review for TEER",
    inputs: ["conditions", "lvef", "meds", "studies", "plan"],
    defaultParams: {},
    evidence:
      "ESC HF 2026 Rec. Table 17 (I, B): mitral transcatheter edge-to-edge repair is recommended in haemodynamically stable, symptomatic patients with HFrEF and persistent severe secondary MR despite optimised FMT and CRT if indicated, who fulfil specific clinical and echocardiographic criteria. Secondary MR often improves with FMT and CRT: grade it again after optimisation.",
    evaluate(s) {
      if (hfPhenotype(s) !== "HFrEF" || hfImprovedEf(s)) return [];
      const mr = s.conditions.find((c) => c.code === "mr-secondary" && c.attributes?.severity === "Severe");
      if (!mr) return [];
      if (s.plan.some((a) => a.status !== "cancelled" && /heart.?team|TEER|mitral/i.test(a.title))) return [];
      const opt = optimalFmt(s)!;
      const ef = s.resolved("lvef").current;
      const crtPending = !s.tags.has("crt") && (() => {
        const ecg = latestStudy(s, "ecg", 365);
        const q = ecg?.attributes.qrs != null ? Number(ecg.attributes.qrs) : null;
        return q != null && ecg?.attributes.qrsMorphology ? !["none", "upgrade"].includes(crtClass(q, ecg.attributes.qrsMorphology, { qrs_long: 150, qrs_min: 130 }).cls) : false;
      })();
      const facts: Fact[] = [
        { label: "Secondary MR", value: "Severe" },
        ...(ef ? [{ label: "LVEF", value: `${formatNumber(ef.value_num!, 0)}%`, date: ef.effective_at }] : []),
        { label: "Optimal FMT", value: opt.complete ? `since ${fmtDay(opt.since!, { year: true })}` : `not yet: ${opt.gaps.join(", ")}` },
        ...(crtPending ? [{ label: "CRT", value: "QRS criteria met, no CRT yet", tone: "orange" as const }] : []),
        { label: "Guideline", value: "ESC HF 2026 · Rec. Table 17 (I, B)" },
      ];
      if (!opt.complete || crtPending)
        return [{
          key: "mr", signature: `mr-wait:${mr.id}:${opt.since ?? "incomplete"}:${crtPending}`, severity: "blue",
          title: `Severe secondary MR: ${!opt.complete && crtPending ? "optimise foundational therapy and decide on CRT" : crtPending ? "QRS meets CRT criteria — decide on CRT" : "optimise foundational therapy"} first, then re-grade on Echo`,
          detail: "Secondary MR often improves with foundational therapy and CRT. If it stays severe, heart-team review for mitral TEER.",
          facts, missing: [], action: { type: "add-plan", template: "echo" },
        }];
      return [{
        key: "mr", signature: `mr:${mr.id}:${ef?.id ?? "noef"}`, severity: "orange",
        title: "Severe secondary MR despite optimised therapy: heart-team review for mitral TEER",
        detail: "Recommended (I B) for haemodynamically stable, symptomatic patients who meet the clinical and echocardiographic criteria; the heart team decides.",
        facts, missing: [], action: { type: "add-plan", template: "heart-team" },
      }];
    },
  },
  {
    id: "hf.improved-ef-continue",
    kind: "clinical",
    title: "Improved LVEF: keep foundational therapy",
    inputs: ["meds", "lvef", "conditions"],
    defaultParams: {},
    evidence:
      "ESC HF 2026 Rec. Table 5: continuation of FMT at the highest tolerated doses is recommended in all patients with HF, including those who become asymptomatic or whose LVEF improves (I C). Gradual discontinuation under frequent surveillance may be considered only in highly selected asymptomatic patients with complete normalisation of LV function, volumes and natriuretic peptides after treatment of a reversible cause (IIb C).",
    evaluate(s) {
      const imp = hfImprovedEf(s);
      if (!imp) return [];
      const out: Finding[] = [];
      for (const tag of ["raas", "bb", "mra", "sglt2"]) {
        if (s.meds.some((m) => (m.status === "active" || m.status === "not_taking") && m.tags.includes(tag))) continue;
        if (activeBarrier(s, tag) || (tag === "raas" && activeBarrier(s, "arni"))) continue;
        const gone = s.meds
          .filter((m) => m.tags.includes(tag) && (m.status === "stopped" || m.status === "held"))
          .map((m) => ({ m, e: [...m.events].reverse().find((e) => e.kind === "stop" || e.kind === "hold")! }))
          .filter((x) => x.e && x.e.effective_at > imp.at)
          .pop();
        if (!gone) continue;
        const { m, e } = gone;
        const def = MEDICATION[m.code];
        const dose = m.doseValue ?? def?.doses?.[0];
        out.push({
          key: "continue-" + tag, signature: `${m.id}:${e.effective_at}`, severity: "orange",
          title: `LVEF improved: ${m.name} ${e.kind === "hold" ? "held" : "stopped"} ${fmtDay(e.effective_at)} — continuing foundational therapy is recommended`,
          detail: `${e.reason ? `Reason recorded: ${e.reason}. ` : ""}Stopping after LVEF recovery risks relapse. Withdrawal may be considered only in highly selected asymptomatic patients with full normalisation after a treated reversible cause, under close surveillance (IIb C).`,
          facts: [
            { label: "Lowest LVEF", value: `${formatNumber(imp.lowest, 0)}%`, date: imp.at },
            { label: "Current LVEF", value: `${formatNumber(s.resolved("lvef").current!.value_num!, 0)}%`, date: s.resolved("lvef").current!.effective_at },
            { label: e.kind === "hold" ? "Held" : "Stopped", value: `${m.name}${e.reason ? ` · ${e.reason}` : ""}`, date: e.effective_at, tone: "orange" },
            { label: "Guideline", value: "ESC HF 2026 · Rec. Table 5 (I, C)" },
          ],
          missing: [],
          action: dose != null ? { type: "start-med", code: m.code, dose, label: `Restart ${m.name}${def ? " " + doseLabel(def, dose) : ""}` } : { type: "tab", tab: "medications" },
        });
      }
      return out;
    },
  },
);
