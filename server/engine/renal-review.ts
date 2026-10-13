// Shared cardiorenal finding; the advanced-HF rule reuses it to avoid duplicate renal prompts.
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { creatinineTrend, RENAL_DEFAULTS } from "./renal-trend.js";
import { fmtDay } from "../../shared/clinical.js";
import { series, type PatientState } from "../kernel/state.js";
import type { Fact, Finding } from "./rules.js";
export const RENAL_REVIEW_PARAMS = RENAL_DEFAULTS;
const v = (code: string, value: number | null | undefined) =>
  value == null
    ? "—"
    : `${formatNumber(value, MEASURES[code]?.decimals ?? 0)} ${MEASURES[code]?.unit ?? ""}`;
const day = fmtDay;
export function renalReview(
  s: PatientState,
  p: Record<string, any> = RENAL_REVIEW_PARAMS,
): Finding[] {
  const trend = creatinineTrend(s, p);
  if (!trend || !trend.onTherapy || !trend.review) return [];
  const { cur, baseline, change, rel, stop } = trend;
  const egfr = s.resolved("egfr");
  const wt = series(s, "weight");
  const facts: Fact[] = [
    {
      label: change
        ? "Creatinine before the last RAAS/MRA change"
        : "Previous creatinine",
      value: v("creatinine", baseline.value_num),
      date: baseline.effective_at,
    },
    {
      label: "Creatinine now",
      value: v("creatinine", cur.value_num),
      date: cur.effective_at,
      tone: stop ? "red" : "orange",
    },
  ];
  if (egfr.current)
    facts.push({
      label: "eGFR",
      value: v("egfr", egfr.current.value_num),
      date: egfr.current.effective_at,
    });
  if (wt.length > 1)
    facts.push({
      label: "Weight",
      value: `${formatNumber(wt[wt.length - 1].value_num!, 1)} → ${formatNumber(wt[0].value_num!, 1)} kg`,
    });
  for (const m of s.meds.filter(
    (m) =>
      m.status === "active" &&
      (m.tags.includes("raas") ||
        m.tags.includes("mra") ||
        m.tags.includes("sglt2") ||
        m.tags.includes("loop")),
  ))
    facts.push({
      label: "Therapy",
      value: `${m.name}${m.lastChange ? " · " + m.lastChange.kind + " " + day(m.lastChange.effective_at) : ""}`,
    });
  facts.push({
    label: "Guideline",
    value: `ESC HF practical guidance · acceptable rise ≤50% or ≤${trend.reviewCr} µmol/L${trend.mra ? " (MRA)" : ""}`,
  });
  return [
    {
      key: "cr",
      signature: [cur.id, baseline.id, change ?? "no-documented-change"].join(
        ":",
      ),
      severity: stop ? "red" : "orange",
      title: `Creatinine up ${Math.round(rel * 100)}% from baseline: ${stop ? "urgent " : ""}cardiorenal review`,
      detail:
        `${formatNumber(baseline.value_num!, 0)} → ${formatNumber(cur.value_num!, 0)} µmol/L` +
        (egfr.current
          ? ` · eGFR ${formatNumber(egfr.current.value_num!, 0)}`
          : "") +
        " · Review baseline dates, volume status, illness, nephrotoxins and treatment timing before deciding on medicines or repeat-test urgency. A rise alone does not establish drug causation or acute kidney injury.",
      facts,
      missing: [
        "Current volume status and symptoms",
        "Clinical review of renal trajectory",
      ],
      action: { type: "wizard", wizard: "renal-function" },
    },
  ];
}
