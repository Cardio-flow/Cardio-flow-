// Rhythm rules (rhythm & devices module, slice 2): AF found on an ECG or Holter but not on the problem
// list, a first-diagnosed AF without an AF-CARE plan, and AF with a fast ventricular rate.
// Source: 2024 ESC/EACTS AF guidelines — AF-CARE for every patient with AF; lenient rate control with
// a resting heart rate <110 bpm as the initial target (IIa).
import { fmtDay, localDay } from "../../shared/clinical.js";
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
    evidence: "2024 ESC AF: lenient rate control — resting heart rate <110 bpm as the initial target (IIa); beta-blocker, digoxin, diltiazem or verapamil (LVEF >40%), beta-blocker and/or digoxin (LVEF ≤40%).",
    evaluate(s) {
      const ecg = latestStudy(s, "ecg");
      if (!ecg || !/fibrillation|flutter/i.test(String(ecg.attributes.rhythm ?? "")) || !(Number(ecg.attributes.rate) >= 110)) return [];
      if (!hasAf(s)) return []; // the undiagnosed-AF finding covers it
      const rate = s.meds.filter((m) => (m.status === "active" || m.status === "held") && (m.tags.includes("bb") || m.tags.includes("ndhp-ccb") || m.tags.includes("digoxin") || (m.tags.includes("bb-other") && m.tags.includes("rate-slowing"))));
      return [{
        key: "fast", signature: ecg.id, severity: "yellow",
        title: `AF at ${ecg.attributes.rate} bpm on ECG ${fmtDay(ecg.performed_at)}: above the lenient target <110`,
        detail: rate.length ? `On ${rate.map((m) => m.name.toLowerCase()).join(" + ")}: adjust rate control.` : "No rate-control drug: start one.",
        facts: [{ label: "ECG", value: `${ecg.attributes.rhythm} · ${ecg.attributes.rate} bpm`, date: ecg.performed_at }, { label: "Guideline", value: "ESC AF 2024 · IIa" }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
];
