// Rules around admissions and discharges. Thresholds are governed parameters; all start in
// CLINICAL_REVIEW (sandbox only).
//
// Sources: ESC HF 2021 (Class I, C) and 2023 focused update (STRONG-HF, Class I, B): an early
// follow-up visit 1–2 weeks after an HF hospitalisation to check congestion and drug tolerance and
// to start/up-titrate therapy; residual congestion at discharge marks high risk. HF readmission
// within 30 days is the registry quality measure. (Confirm the 2026 wording in review.)
import { daysBetween, fmtDay } from "../../shared/clinical.js";
import { isHfAdmission } from "../../shared/encounters.js";
import type { PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";

const hfAdmissions = (s: PatientState) => s.contexts.filter((c) => c.kind === "admission" && isHfAdmission(c as any));

export const ENCOUNTER_RULES: RuleDef[] = [
  {
    id: "hf.post-discharge-review",
    kind: "clinical",
    title: "Early review after an HF admission",
    inputs: ["contexts", "plan"],
    defaultParams: { review_days: 14, congested_review_days: 7, lookback_days: 30 },
    evidence:
      "ESC HF 2021 (I, C) and 2023 focused update (STRONG-HF, I, B): early follow-up 1–2 weeks after HF hospitalisation to assess congestion and tolerance and to start/up-titrate therapy. Review within 7 days when congested at discharge is a sandbox value pending review.",
    evaluate(s, p) {
      const last = hfAdmissions(s).filter((c) => c.status === "closed" && c.ended_at && (c.summary as any)?.outcome !== "died").pop();
      if (!last?.ended_at) return [];
      const since = daysBetween(last.ended_at, s.today);
      if (since > Number(p.lookback_days)) return [];
      // readmitted since: the readmission rule takes over
      if (s.contexts.some((c) => c.kind === "admission" && c.started_at > last.ended_at!)) return [];
      const seen = s.contexts.some((c) => c.kind === "clinic_visit" && c.started_at > last.ended_at!);
      if (seen) return [];
      const congested = (last.summary as any)?.dischargeStatus === "Still congested";
      const window = Number(congested ? p.congested_review_days : p.review_days);
      const byDay = new Date(Date.parse(last.ended_at) + window * 86400000).toISOString().slice(0, 10);
      // a booked review inside the window is enough (if it is missed, the plan's own overdue alert fires)
      const visits = s.plan.filter((a) => a.status === "planned" && a.completes_on?.type === "visit" && a.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
      if (visits.some((a) => a.due_date! <= byDay)) return [];
      const booked = visits[0] ?? null;
      const overdue = since > window;
      return [{
        key: "post-discharge",
        signature: `${last.id}:${booked?.id ?? "none"}:${overdue}`,
        severity: overdue ? "orange" : "yellow",
        title: booked
          ? `Post-discharge review booked ${fmtDay(booked.due_date!)}: later than ${window} days after discharge`
          : `${overdue ? "No review since HF discharge" : "Book the early post-discharge review"} · discharged ${fmtDay(last.ended_at)} (day ${since})`,
        detail: `${congested ? "Discharged still congested: review within " + window + " days. " : ""}Check congestion, K/creatinine and tolerance; start or up-titrate therapy.`,
        facts: [
          { label: "Discharged", value: fmtDay(last.ended_at, { year: true }) },
          { label: "Condition at discharge", value: (last.summary as any)?.dischargeStatus ?? "not recorded", tone: congested ? "orange" : undefined },
          { label: "Review by", value: fmtDay(byDay, { weekday: true }) },
          { label: "Guideline", value: "ESC HF 2021/2023 · early follow-up 1–2 weeks (Class I)" },
        ],
        missing: (last.summary as any)?.dischargeStatus ? [] : ["Condition at discharge"],
        action: { type: "add-plan", template: "hf-clinic" },
      }];
    },
  },
  {
    id: "hf.readmission-30d",
    kind: "clinical",
    title: "HF readmission within 30 days",
    inputs: ["contexts"],
    defaultParams: { days: 30 },
    evidence: "30-day HF readmission is a quality measure (HF registry); it prompts review of discharge congestion, therapy and early follow-up.",
    evaluate(s, p) {
      const cur = [...s.contexts].reverse().find((c) => c.kind === "admission");
      const r = (cur?.summary as any)?.readmission;
      if (!cur || !r?.hfReadmission || r.days > Number(p.days)) return [];
      // shown during the readmission and for 30 days after it
      if (cur.ended_at && daysBetween(cur.ended_at, s.today) > Number(p.days)) return [];
      const prev = s.contexts.find((c) => c.id === r.previousId);
      const followed = prev?.ended_at ? s.contexts.some((c) => c.kind === "clinic_visit" && c.started_at > prev.ended_at! && c.started_at < cur.started_at) : false;
      const out: Finding = {
        key: "readmit",
        signature: cur.id,
        severity: "orange",
        title: `HF readmission ${r.days} day${r.days === 1 ? "" : "s"} after discharge`,
        detail: [
          (prev?.summary as any)?.dischargeStatus === "Still congested" ? "Previous discharge was still congested." : null,
          followed ? null : "No clinic review between the two admissions.",
          "Review decongestion, foundational therapy and the follow-up plan before this discharge.",
        ].filter(Boolean).join(" "),
        facts: [
          { label: "Previous discharge", value: fmtDay(r.previousDischarge, { year: true }) },
          { label: "Condition then", value: (prev?.summary as any)?.dischargeStatus ?? "not recorded" },
          { label: "Seen in clinic between", value: followed ? "Yes" : "No", tone: followed ? undefined : "orange" },
        ],
        missing: [],
        action: { type: "tab", tab: "journey" },
      };
      return [out];
    },
  },
];
