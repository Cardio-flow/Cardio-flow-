// Rhythm rules (rhythm & devices module, slice 2): AF found on an ECG or Holter but not on the problem
// list, a first-diagnosed AF without an AF-CARE plan, and AF with a fast ventricular rate.
// Source: 2024 ESC/EACTS AF guidelines — AF-CARE for every patient with AF; lenient rate control with
// a resting heart rate <110 bpm as the initial target (class to confirm against the full text).
import { addCalendarMonths } from "../../shared/af.js";
import { AF_AFTERCARE_RULES } from "./af-aftercare-rules.js";
import { addDays, daysBetween, fmtDay, localDay } from "../../shared/clinical.js";
import { CIED_TYPE } from "../../shared/procedures.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import { cha2ds2va } from "./guidelines.js";
import { deviceStatus } from "./rhythm-profile.js";
import type { RuleDef } from "./rules.js";

const AF_RHYTHM = /fibrillation|flutter|paroxysmal AF/i;
const plannedCheck = (s: PatientState) => s.plan.some((p) => p.status === "planned" && p.completes_on?.type === "study" && p.completes_on.kind === "device_check");
const DEVICE_FU = "2023 HRS/EHRA/APHRS/LAHRS remote device clinic consensus";
// the latest implant, upgrade, generator change or lead revision, with its local day
const IMPLANT_ACTIONS = ["New implant", "Upgrade", "Generator change", "Lead revision"];
const lastImplant = (s: PatientState) => {
  const p = s.procedures.filter((x) => x.kind === "device" && IMPLANT_ACTIONS.includes(x.attributes.action)).sort((a, b) => a.performed_at.localeCompare(b.performed_at)).pop();
  return p ? { p, day: localDay(p.performed_at), type: CIED_TYPE(p.attributes.type) } : null;
};
const checksSince = (s: PatientState, day: string) => s.studies.filter((x) => x.kind === "device_check" && localDay(x.performed_at) >= day);
const planFor = (s: PatientState, re: RegExp, from: string) => s.plan.some((p) => re.test(p.title) && (p.status === "planned" || (p.due_date ?? "") >= from));
const hasAf = (s: PatientState) => s.conditions.some((c) => (c.code === "af" || c.code === "flutter") && c.status === "active");

export const RHYTHM_RULES: RuleDef[] = [
  ...AF_AFTERCARE_RULES,
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
    evidence: "2024 ESC AF: anticoagulation for at least 4 weeks after cardioversion, then long term by CHA₂DS₂-VA regardless of the rhythm achieved.",
    evaluate(s) {
      const cv = [...s.procedures].reverse().find((p) => p.kind === "cardioversion");
      if (!cv) return [];
      const days = daysBetween(localDay(cv.performed_at), s.today);
      if (days < 0 || days >= 28 || s.meds.some((m) => m.status === "active" && m.tags.includes("oac"))) return [];
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
    title: "No anticoagulation during the post-AF-ablation minimum period",
    inputs: ["procedures", "meds", "pathways"],
    defaultParams: {},
    evidence: "2024 ESC AF: anticoagulation continued for at least 2 months after AF ablation, then by CHA₂DS₂-VA rather than by the ablation result. ACC/AHA/ACCP/HRS AF 2023 (10.1016/j.jacc.2023.08.017): at least 3 months if that reference is selected.",
    evaluate(s) {
      const ab = [...s.procedures].reverse().find((p) => p.kind === "ablation" && (p.attributes.targets ?? []).some((t: string) => /^AF/.test(t)));
      if (!ab) return [];
      const review = s.afReviews?.["after-af-ablation"];
      const months = review?.answers._procedureId === ab.id && review.answers.basis === "acc" ? 3 : 2;
      const days = daysBetween(localDay(ab.performed_at), s.today);
      if (days < 0 || s.today >= addCalendarMonths(localDay(ab.performed_at), months) || s.meds.some((m) => m.status === "active" && m.tags.includes("oac"))) return [];
      return [{
        key: "post-abl", signature: `${ab.id}:${months}`, severity: "orange",
        title: `AF ablation ${days === 0 ? "today" : `${days} days ago`} with no anticoagulant`,
        detail: `Continue anticoagulation for at least ${months} months after ablation, then by stroke risk. This minimum is not an automatic stop date.`,
        facts: [{ label: "Ablation", value: ab.summary, date: ab.performed_at }, { label: "Until", value: fmtDay(addCalendarMonths(localDay(ab.performed_at), months), { year: true }) }, { label: "Guideline", value: months === 3 ? "ACC/AHA/HRS AF 2023" : "ESC AF 2024" }],
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
  // ---- slice 4: device follow-up ----
  {
    id: "rhythm.device-check-due",
    kind: "clinical",
    title: "Device check overdue",
    inputs: ["studies", "procedures", "conditions", "plan"],
    defaultParams: {},
    evidence: `${DEVICE_FU} (I, C-EO): remote transmissions at least every 3–12 months for pacemakers and every 3–6 months for ICDs (CRT-P as a pacemaker, CRT-D as an ICD); every 1–3 months as the device approaches elective replacement. Due at the outer limit of the range; loop recorders are followed by alerts.`,
    evaluate(s) {
      const d = deviceStatus(s);
      if (!d?.dueAt || d.dueAt >= s.today || plannedCheck(s)) return [];
      const last = d.check ? `last check ${fmtDay(d.check.at, { year: true })}` : `no check since ${d.implantAt === d.since ? "the implant" : "it was recorded"} ${fmtDay(d.since!, { year: true })}`;
      return [{
        key: "device-check", signature: `${d.check?.id ?? d.since}:${d.intervalMonths}`, severity: "yellow",
        title: `${d.type}: device check overdue since ${fmtDay(d.dueAt, { year: true })}`,
        detail: `${last[0].toUpperCase()}${last.slice(1)}. ${d.batteryLow ? "Battery near replacement: check every 1–3 months." : `${d.type === "ICD" || d.type === "CRT-D" ? "ICD / CRT-D: at least every 3–6 months" : "Pacemaker / CRT-P: at least every 3–12 months"} (remote or in clinic).`}`,
        facts: [{ label: "Device", value: d.type ?? "Cardiac device", date: d.implantAt ?? undefined }, { label: "Last check", value: d.check ? d.check.summary : "None recorded", date: d.check?.at }, { label: "Source", value: "HRS/EHRA 2023" }],
        missing: [], action: { type: "add-plan", template: "device-check" },
      }];
    },
  },
  {
    id: "rhythm.device-battery",
    kind: "clinical",
    title: "Device battery at elective replacement or end of service",
    inputs: ["studies", "procedures", "plan"],
    defaultParams: {},
    evidence: "The device's own battery indicator (ERI / EOS) as recorded at interrogation; generator replacement is planned at ERI. 2023 HRS/EHRA/APHRS/LAHRS consensus: checks every 1–3 months as the device approaches elective replacement.",
    evaluate(s) {
      const d = deviceStatus(s);
      if (!d?.check || !d.batteryLow || s.plan.some((p) => p.status === "planned" && /generator change/i.test(p.title))) return [];
      const eos = /EOS/.test(d.check.a.battery);
      return [{
        key: "battery", signature: d.check.id, severity: eos ? "red" : "orange",
        title: `${d.type} battery ${eos ? "at end of service" : "at elective replacement"} (${fmtDay(d.check.at)})`,
        detail: eos ? "The device may stop delivering therapy: generator change now." : "Plan the generator change; check every 1–3 months until it is done.",
        facts: [{ label: "Device check", value: d.check.summary, date: d.check.at, tone: eos ? "red" : "orange" }, { label: "Implanted", value: d.implantAt ? fmtDay(d.implantAt, { year: true }) : "Date not recorded" }],
        missing: [], action: { type: "add-plan", template: "generator-change" },
      }];
    },
  },
  {
    id: "rhythm.device-lead",
    kind: "clinical",
    title: "Lead problem on device check",
    inputs: ["studies", "procedures", "plan"],
    defaultParams: {},
    evidence: "Lead malfunction as reported at interrogation (the clinician's own entry; no threshold set here): review by the device team, reprogramming or lead revision.",
    evaluate(s) {
      const d = deviceStatus(s);
      if (!d?.check || d.check.a.leads !== "Abnormal") return [];
      const after = d.procs.some((p) => localDay(p.performed_at) >= localDay(d.check!.at) && ["Lead revision", "Extraction", "New implant", "Upgrade"].includes(p.attributes.action));
      if (after || s.plan.some((p) => p.status === "planned" && /lead review|lead revision/i.test(p.title))) return [];
      return [{
        key: "lead", signature: d.check.id, severity: "orange",
        title: `${d.type}: lead problem on the check of ${fmtDay(d.check.at)}`,
        detail: `${(d.check.a.leadIssue ?? []).join(", ") || "Abnormal lead function"}: device team review (reprogramming or lead revision).`,
        facts: [{ label: "Device check", value: d.check.summary, date: d.check.at, tone: "orange" }],
        missing: [], action: { type: "add-plan", template: "lead-review" },
      }];
    },
  },
  {
    id: "rhythm.device-af",
    kind: "clinical",
    title: "Device-detected atrial high-rate episodes",
    inputs: ["studies", "conditions", "meds"],
    defaultParams: {},
    evidence: "2024 ESC AF (task force summary, Europace 2024;26:euae298): a DOAC may be considered in device-detected subclinical AF with high stroke risk and low bleeding risk; progression to clinical AF is 6–9% a year; no duration threshold is established.",
    evaluate(s) {
      const d = deviceStatus(s);
      if (!d?.check || d.check.a.ahre !== "Yes" || hasAf(s) || s.meds.some((m) => m.status === "active" && m.tags.includes("oac"))) return [];
      const sc = cha2ds2va(s);
      return [{
        key: "device-af", signature: d.check.id, severity: "yellow",
        title: `Device-detected atrial episodes${d.check.a.ahreLongest ? ` (longest ${d.check.a.ahreLongest})` : ""}: no AF on the problem list`,
        detail: `CHA₂DS₂-VA ${sc.score}. Subclinical AF: a DOAC may be considered with high stroke risk and low bleeding risk. If AF is confirmed on an ECG, start AF-CARE.`,
        facts: [{ label: "Device check", value: d.check.summary, date: d.check.at }, { label: "CHA₂DS₂-VA", value: String(sc.score) }, { label: "Guideline", value: "ESC AF 2024" }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
  {
    id: "rhythm.device-first-check",
    kind: "clinical",
    title: "First device check after implant",
    inputs: ["procedures", "studies", "plan"],
    defaultParams: {},
    evidence: "2015 HRS remote monitoring consensus (Slotwiner et al., Heart Rhythm 2015;12:e69): all CIEDs are checked through direct patient contact 2–12 weeks after implantation (I, E).",
    evaluate(s) {
      const im = lastImplant(s);
      if (!im) return [];
      if (daysBetween(im.day, s.today) > 365) return []; // older implants follow the routine interval
      if (checksSince(s, im.day).some((x) => x.attributes.setting === "In clinic") || planFor(s, /^First device check|^Device check/, im.day)) return [];
      const from = addDays(im.day, 14), to = addDays(im.day, 84);
      const late = s.today > to;
      return [{
        key: "first-check", signature: im.p.id, severity: late ? "orange" : "yellow",
        title: `${im.type} ${String(im.p.attributes.action).toLowerCase()} ${fmtDay(im.day)}: first in-person device check ${late ? "overdue" : `due ${fmtDay(from)} – ${fmtDay(to)}`}`,
        detail: "Every device is checked in person 2–12 weeks after implantation (HRS 2015, I).",
        facts: [{ label: "Procedure", value: im.p.summary, date: im.p.performed_at }, { label: "Window", value: `${fmtDay(from, { year: true })} – ${fmtDay(to, { year: true })}` }, { label: "Source", value: "HRS 2015" }],
        missing: [], action: { type: "add-plan", template: "device-first-check" },
      }];
    },
  },
  {
    id: "rhythm.device-wound-check",
    kind: "clinical",
    title: "Clinic wound check after a device procedure",
    inputs: ["procedures", "studies", "plan", "contexts"],
    defaultParams: { fromDay: 7, toDay: 10 },
    evidence: "Local practice approved by the clinical owner (Ahmed, 5 Oct 2026): a clinic visit for the wound check 7–10 days after a device implant, upgrade, generator change or lead revision. Not for loop recorders or leadless pacemakers (no pocket).",
    evaluate(s, params) {
      const im = lastImplant(s);
      if (!im || im.type === "Loop recorder" || /Leadless/.test(im.p.attributes.type)) return [];
      const fromDay = Number(params?.fromDay ?? 7), toDay = Number(params?.toDay ?? 10);
      const days = daysBetween(im.day, s.today);
      if (days > 30) return [];
      const seen = addDays(im.day, fromDay);
      // done: a clinic visit (or an in-clinic device check) from day 7; or the clinic wound check is booked
      if (planFor(s, /wound check/i, im.day) || s.contexts.some((c) => c.kind === "clinic_visit" && localDay(c.started_at) >= seen)
        || checksSince(s, seen).some((x) => x.attributes.setting === "In clinic")) return [];
      const from = addDays(im.day, fromDay), to = addDays(im.day, toDay);
      return [{
        key: "wound", signature: im.p.id, severity: "yellow",
        title: `${im.type} ${String(im.p.attributes.action).toLowerCase()} ${fmtDay(im.day)}: clinic wound check ${s.today > to ? "overdue" : `${fmtDay(from)} – ${fmtDay(to)}`}`,
        detail: `Clinic visit for the wound check ${fromDay}–${toDay} days after the procedure.`,
        facts: [{ label: "Procedure", value: im.p.summary, date: im.p.performed_at }, { label: "Window", value: `${fmtDay(from, { year: true })} – ${fmtDay(to, { year: true })}` }, { label: "Source", value: "Local practice · approved 5 Oct 2026" }],
        missing: [], action: { type: "add-plan", template: "wound-check" },
      }];
    },
  },
  {
    id: "rhythm.remote-monitoring",
    kind: "clinical",
    title: "Remote monitoring not started after implant",
    inputs: ["procedures", "studies", "plan"],
    defaultParams: {},
    evidence: "2023 HRS/EHRA/APHRS/LAHRS consensus: it can be beneficial to start remote monitoring before discharge or within 2 weeks of CIED implantation (IIa, B-NR); for an implantable loop recorder, enrolment before discharge is recommended (I, C-EO). 2015 HRS: all patients with CIEDs should be offered remote monitoring (I, A).",
    evaluate(s) {
      const im = lastImplant(s);
      if (!im || im.p.attributes.remote !== "Not enrolled") return [];
      if (checksSince(s, im.day).some((x) => x.attributes.setting === "Remote") || planFor(s, /remote (device )?monitoring/i, im.day)) return [];
      const ilr = im.type === "Loop recorder";
      return [{
        key: "remote", signature: im.p.id, severity: "yellow",
        title: `${im.type} ${fmtDay(im.day)}: remote monitoring not started`,
        detail: ilr ? "Loop recorder: enrol in remote monitoring before discharge (I)." : "Start remote monitoring before discharge or within 2 weeks of implant (IIa); offer it to every patient with a device (I).",
        facts: [{ label: "Procedure", value: im.p.summary, date: im.p.performed_at }, { label: "Source", value: "HRS/EHRA 2023 · HRS 2015" }],
        missing: [], action: { type: "add-plan", template: "remote-monitoring" },
      }];
    },
  },
];
