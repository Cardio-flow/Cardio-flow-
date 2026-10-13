// Shared cardiorenal finding; the advanced-HF rule reuses it to avoid duplicate renal prompts.
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, fmtDay } from "../../shared/clinical.js";
import { series, type PatientState } from "../kernel/state.js";
import type { Fact, Finding } from "./rules.js";
export const RENAL_REVIEW_PARAMS = {
  review_rise: 0.5,
  review_cr_umol: 266,
  review_egfr: 25,
  stop_rise: 1.0,
  stop_cr_umol: 310,
  stop_egfr: 20,
};
const v = (code: string, value: number | null | undefined) =>
  value == null
    ? "—"
    : `${formatNumber(value, MEASURES[code]?.decimals ?? 0)} ${MEASURES[code]?.unit ?? ""}`;
const day = fmtDay;
export function renalReview(
  s: PatientState,
  p: Record<string, any> = RENAL_REVIEW_PARAMS,
): Finding[] {
  // the rule is about RAAS/ARNI/MRA dosing: only while one is taken
  if (
    !s.meds.some(
      (m) =>
        m.status === "active" &&
        m.tags.some((t) => t === "raas" || t === "mra"),
    )
  )
    return [];
  const cr = s.resolved("creatinine");
  const cur = cr.current;
  if (
    !cur ||
    cur.status !== "final" ||
    cur.value_num == null ||
    daysBetween(cur.effective_at, s.today) < 0
  )
    return [];
  const prior = cr.history.filter(
    (o) =>
      o.status === "final" &&
      o.value_num != null &&
      o.value_num > 0 &&
      o.id !== cur.id &&
      o.effective_at < cur.effective_at,
  );
  if (!prior.length) return [];
  // baseline: the result before the most recent RAAS/ARNI/MRA start or up-titration, else the previous one
  const change = s.meds
    .filter((m) => m.tags.some((t) => t === "raas" || t === "mra"))
    .flatMap((m) =>
      m.events
        .filter((e) => e.kind === "start" || e.kind === "increase")
        .map((e) => e.effective_at),
    )
    .filter((at) => at < cur.effective_at)
    .sort()
    .pop();
  const baseline =
    (change && prior.find((o) => o.effective_at <= change)) || prior[0];
  const rise = cur.value_num - baseline.value_num!;
  const rel = rise / baseline.value_num!;
  if (rise <= 0) return [];
  const egfr = s.resolved("egfr");
  const e =
    egfr.current && egfr.current.effective_at === cur.effective_at
      ? egfr.current.value_num
      : null;
  // absolute limits apply to a creatinine that crosses them, not to one that was already beyond them
  const stop =
    rel > Number(p.stop_rise) ||
    (baseline.value_num! < Number(p.stop_cr_umol) &&
      cur.value_num > Number(p.stop_cr_umol)) ||
    (baseline.value_num! < Number(p.review_cr_umol) &&
      e != null &&
      e < Number(p.stop_egfr));
  // a baseline already above 266 µmol/L: the 50% rise is the threshold (any small rise would otherwise count)
  const reviewAt =
    baseline.value_num! >= Number(p.review_cr_umol)
      ? baseline.value_num! * (1 + Number(p.review_rise))
      : Math.min(
          baseline.value_num! * (1 + Number(p.review_rise)),
          Number(p.review_cr_umol),
        );
  const eBase = baseline.value_num! >= Number(p.review_cr_umol);
  const review =
    stop ||
    cur.value_num > reviewAt ||
    (!eBase && e != null && e < Number(p.review_egfr));
  if (!review) return [];
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
    value: "ESC HF practical guidance · acceptable rise ≤50% or ≤266 µmol/L",
  });
  return [
    {
      key: "cr",
      signature: [cur.id, baseline.id, change ?? "no-documented-change"].join(
        ":",
      ),
      severity: stop ? "red" : "orange",
      title: `Creatinine up ${Math.round(rel * 100)}%: ${stop ? "urgent " : ""}cardiorenal review`,
      detail:
        `${formatNumber(baseline.value_num!, 0)} → ${formatNumber(cur.value_num, 0)} µmol/L` +
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
