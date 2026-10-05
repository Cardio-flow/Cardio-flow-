// Rhythm rules (rhythm & devices module, slice 2): AF found on an ECG or Holter but not on the problem
// list, a first-diagnosed AF without an AF-CARE plan, and AF with a fast ventricular rate.
// Source: 2024 ESC/EACTS AF guidelines — AF-CARE for every patient with AF; lenient rate control with
// a resting heart rate <110 bpm as the initial target (class to confirm against the full text).
import { addDays, daysBetween, fmtDay, localDay } from "../../shared/clinical.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import { cha2ds2va } from "./guidelines.js";
import type { RuleDef } from "./rules.js";

const AF_RHYTHM = /fibrillation|flutter|paroxysmal AF/i;
const hasAf = (s: PatientState) => s.conditions.some((c) => (c.code === "af" || c.code === "flutter") && c.status === "active");

export const RHYTHM_RULES: RuleDef[] = [
  {
    id: "rhythm.ecg-af-undiagnosed",
    kind: "clinical",
    title: "AF on ECG or Holter, not on the problem list",
    inputs: ["studies", "conditions"],
    defaultParams: {},
    evidence: "2024 ESC AF: AF confirmed on a 12-lead ECG or on ≥30 s of a single-lead tracing is AF; every patient then follows AF-CARE (stroke risk, rate/rhythm, comorbidities, evaluation).",
    evaluate(s) {
      if (hasAf(s)) return [];
      const st = [latestStudy(s, "ecg"), latestStudy(s, "holter")].filter((x) => x && AF_RHYTHM.test(String(x.attributes.rhythm ?? ""))).sort((a, b) => b!.performed_at.localeCompare(a!.performed_at))[0];
      if (!st) return [];
      const sc = cha2ds2va(s);
      return [{
        key: "ecg-af", signature: st.id, severity: "orange",
        title: `${st.kind === "ecg" ? "ECG" : "Holter"} ${fmtDay(st.performed_at)}: ${String(st.attributes.rhythm).toLowerCase()} — not on the problem list`,
        detail: `CHA₂DS₂-VA ${sc.score}${sc.score >= 2 ? ": anticoagulation recommended" : sc.score === 1 ? ": anticoagulation should be considered" : ""}. Start AF-CARE.`,
        facts: [{ label: st.kind === "ecg" ? "ECG" : "Holter", value: `${st.attributes.rhythm}${st.attributes.rate ? ` · ${st.attributes.rate} bpm` : ""}`, date: st.performed_at }, { label: "CHA₂DS₂-VA", value: String(sc.score) }, { label: "Guideline", value: "ESC AF 2024" }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
  {
    id: "rhythm.af-first-plan",
    kind: "clinical",
    title: "First-diagnosed AF without an AF-CARE plan",
    inputs: ["conditions", "pathways"],
    defaultParams: {},
    evidence: "2024 ESC AF: at diagnosis — stroke risk and anticoagulation, rate or rhythm control, comorbidity and risk-factor management, echocardiography and blood tests (AF-CARE).",
    evaluate(s) {
      const c = s.conditions.find((x) => (x.code === "af" || x.code === "flutter") && x.status === "active" && x.attributes?.pattern === "First diagnosed");
      if (!c) return [];
      const done = s.pathwaysDone["af-care"];
      if (done && localDay(done) >= localDay(c.recorded_at)) return [];
      return [{
        key: "af-first", signature: c.id, severity: "orange",
        title: "First-diagnosed AF: AF-CARE plan not made",
        detail: "Stroke prevention, rate or rhythm control, risk factors and evaluation.",
        facts: [{ label: "AF", value: "First diagnosed", date: c.onset ?? c.recorded_at }, { label: "Guideline", value: "ESC AF 2024" }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
  {
    id: "rhythm.af-fast-rate",
    kind: "clinical",
    title: "AF with a fast ventricular rate",
    inputs: ["studies", "conditions", "meds"],
    defaultParams: {},
    evidence: "2024 ESC AF: lenient rate control — resting heart rate <110 bpm as the initial target; beta-blocker, digoxin, diltiazem or verapamil (LVEF >40%), beta-blocker and/or digoxin (LVEF ≤40%).",
    evaluate(s) {
      const ecg = latestStudy(s, "ecg");
      if (!ecg || !/fibrillation|flutter/i.test(String(ecg.attributes.rhythm ?? "")) || !(Number(ecg.attributes.rate) >= 110)) return [];
      if (!hasAf(s)) return []; // the undiagnosed-AF finding covers it
      const rate = s.meds.filter((m) => (m.status === "active" || m.status === "held") && (m.tags.includes("bb") || m.tags.includes("ndhp-ccb") || m.tags.includes("digoxin") || (m.tags.includes("bb-other") && m.tags.includes("rate-slowing"))));
      return [{
        key: "fast", signature: ecg.id, severity: "yellow",
        title: `AF at ${ecg.attributes.rate} bpm on ECG ${fmtDay(ecg.performed_at)}: above the lenient target <110`,
        detail: rate.length ? `On ${rate.map((m) => m.name.toLowerCase()).join(" + ")}: adjust rate control.` : "No rate-control drug: start one.",
        facts: [{ label: "ECG", value: `${ecg.attributes.rhythm} · ${ecg.attributes.rate} bpm`, date: ecg.performed_at }, { label: "Guideline", value: "ESC AF 2024" }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
  {
    id: "rhythm.post-cardioversion-oac",
    kind: "clinical",
    title: "No anticoagulation in the 4 weeks after cardioversion",
    inputs: ["procedures", "meds"],
    defaultParams: {},
    evidence: "2024 ESC AF: anticoagulation for at least 4 weeks after cardioversion (as recalled; to confirm against the full text), then long term by CHA₂DS₂-VA regardless of the rhythm achieved.",
    evaluate(s) {
      const cv = [...s.procedures].reverse().find((p) => p.kind === "cardioversion");
      if (!cv) return [];
      const days = daysBetween(localDay(cv.performed_at), s.today);
      if (days > 28 || s.meds.some((m) => m.status === "active" && m.tags.includes("oac"))) return [];
      return [{
        key: "post-cv", signature: cv.id, severity: "orange",
        title: `Cardioversion ${days === 0 ? "today" : `${days} days ago`} with no anticoagulant`,
        detail: "Anticoagulate for at least 4 weeks after cardioversion, then by CHA₂DS₂-VA.",
        facts: [{ label: "Cardioversion", value: cv.summary, date: cv.performed_at }, { label: "Until", value: fmtDay(addDays(localDay(cv.performed_at), 28), { year: true }) }, { label: "Guideline", value: "ESC AF 2024" }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
  {
    id: "rhythm.post-ablation-oac",
    kind: "clinical",
    title: "No anticoagulation in the 2 months after AF ablation",
    inputs: ["procedures", "meds"],
    defaultParams: {},
    evidence: "2024 ESC AF: anticoagulation continued for at least 2 months after AF ablation (as recalled; to confirm against the full text), then by CHA₂DS₂-VA rather than by the ablation result.",
    evaluate(s) {
      const ab = [...s.procedures].reverse().find((p) => p.kind === "ablation" && (p.attributes.targets ?? []).some((t: string) => /^AF/.test(t)));
      if (!ab) return [];
      const days = daysBetween(localDay(ab.performed_at), s.today);
      if (days > 60 || s.meds.some((m) => m.status === "active" && m.tags.includes("oac"))) return [];
      return [{
        key: "post-abl", signature: ab.id, severity: "orange",
        title: `AF ablation ${days === 0 ? "today" : `${days} days ago`} with no anticoagulant`,
        detail: "Continue anticoagulation for at least 2 months after ablation, then by CHA₂DS₂-VA.",
        facts: [{ label: "Ablation", value: ab.summary, date: ab.performed_at }, { label: "Until", value: fmtDay(addDays(localDay(ab.performed_at), 60), { year: true }) }, { label: "Guideline", value: "ESC AF 2024" }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
  {
    id: "rhythm.cardioversion-before-3w",
    kind: "clinical",
    title: "Cardioversion planned before 3 weeks of anticoagulation",
    inputs: ["plan", "meds"],
    defaultParams: {},
    evidence: "2024 ESC AF: unless AF onset is known to be <24 h, cardioversion needs ≥3 weeks of effective anticoagulation or thrombus exclusion by TOE.",
    evaluate(s) {
      const cv = s.plan.find((p) => p.status === "planned" && /^Cardioversion/.test(p.title) && p.due_date && !/TOE|<24 h/.test(p.title));
      if (!cv || s.plan.some((p) => p.status === "planned" && /^TOE/.test(p.title))) return [];
      const oac = s.meds.find((m) => m.status === "active" && m.tags.includes("oac"));
      const from = oac?.startedAt ? localDay(oac.startedAt) : null;
      if (from && addDays(from, 21) <= cv.due_date!) return [];
      return [{
        key: "cv-3w", signature: `${cv.id}:${from ?? "none"}`, severity: "yellow",
        title: `Cardioversion planned ${fmtDay(cv.due_date!)}: ${oac ? `${oac.name} started ${fmtDay(from!)}, less than 3 weeks before` : "no anticoagulant"}`,
        detail: "Move the date to ≥3 weeks of effective anticoagulation, or plan a TOE-guided cardioversion.",
        facts: [{ label: "Planned", value: cv.title, date: cv.due_date! }, { label: "Earliest after 3 weeks", value: from ? fmtDay(addDays(from, 21), { year: true }) : "start anticoagulation first" }, { label: "Guideline", value: "ESC AF 2024" }],
        missing: [], action: { type: "wizard", wizard: "peri-af-procedure" },
      }];
    },
  },
];
