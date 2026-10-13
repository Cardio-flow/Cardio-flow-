// Creatinine against its baseline on RAAS / ARNI / MRA therapy — one calculation shared by the renal rule
// (hf.worsening-renal-function), the HF start/up-titration gate and the renal-function pathway, so the
// alert, the titration suggestion and the pathway never disagree.
//
// ESC HF practical guidance (2016 web addenda, retained 2021/2023): ACEi/ARB/ARNI — a rise up to 50% above
// baseline, or to 266 µmol/L (3.0 mg/dL) / eGFR 25, whichever is smaller, is acceptable; above that halve the
// dose; >100% or >310 µmol/L (3.5 mg/dL) / eGFR <20 stop. MRA — creatinine >221 µmol/L (2.5 mg/dL) or eGFR <30:
// halve; >310 µmol/L or eGFR <20: stop.
// Baseline = the last creatinine before the most recent start or dose increase of these drugs; without a
// result before that change, the oldest result since it (within a year), so a gradual rise is still caught.
import { daysBetween } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";

export const RENAL_DEFAULTS = { review_rise: 0.5, review_cr_umol: 266, review_egfr: 25, stop_rise: 1.0, stop_cr_umol: 310, stop_egfr: 20, mra_review_cr_umol: 221, mra_review_egfr: 30 };

const raasOrMra = (tags: string[]) => tags.some((t) => t === "raas" || t === "mra");

export function creatinineTrend(s: PatientState, params: Partial<typeof RENAL_DEFAULTS> = {}) {
  const p = { ...RENAL_DEFAULTS, ...params };
  const cr = s.resolved("creatinine");
  const cur = cr.current;
  if (!cur || cur.status !== "final" || cur.value_num == null || daysBetween(cur.effective_at, s.today) < 0) return null;
  const prior = cr.history.filter((o) => o.id !== cur.id && o.effective_at < cur.effective_at && o.status === "final" && o.value_num != null && o.value_num > 0);
  if (!prior.length) return null;
  const change = s.meds
    .filter((m) => raasOrMra(m.tags))
    .flatMap((m) => m.events.filter((e) => e.kind === "start" || e.kind === "restart" || e.kind === "increase").map((e) => e.effective_at))
    .filter((at) => at < cur.effective_at)
    .sort()
    .pop() ?? null;
  // prior is newest first
  const sinceChange = prior.filter((o) => (!change || o.effective_at >= change) && daysBetween(o.effective_at, cur.effective_at) <= 365);
  const baseline = (change && prior.find((o) => o.effective_at <= change)) || sinceChange[sinceChange.length - 1] || prior[0];
  const b = baseline.value_num!, c = cur.value_num;
  const rel = (c - b) / b;
  const egfr = s.resolved("egfr");
  const eNow = egfr.current && egfr.current.effective_at === cur.effective_at ? egfr.current.value_num : null;
  const eBase = egfr.history.find((o) => o.effective_at === baseline.effective_at)?.value_num ?? null;
  // an eGFR limit counts only when it is crossed, not when the baseline was already below it
  const crossed = (limit: number) => eNow != null && eNow < limit && (eBase != null ? eBase >= limit : b < p.review_cr_umol);
  const mra = s.meds.some((m) => m.status === "active" && m.tags.includes("mra"));
  const reviewCr = mra ? Math.min(p.review_cr_umol, p.mra_review_cr_umol) : p.review_cr_umol;
  const reviewE = mra ? Math.max(p.review_egfr, p.mra_review_egfr) : p.review_egfr;
  const stop = c > b && (rel > p.stop_rise || (b < p.stop_cr_umol && c > p.stop_cr_umol) || crossed(p.stop_egfr));
  // a baseline already above the absolute limit: the 50% rise is the threshold (any small rise would otherwise count)
  const reviewAt = b >= reviewCr ? b * (1 + p.review_rise) : Math.min(b * (1 + p.review_rise), reviewCr);
  const review = c > b && (stop || c > reviewAt || crossed(reviewE));
  return { cur, baseline, change, rel, stop, review, mra, reviewCr, reviewE, onTherapy: s.meds.some((m) => m.status === "active" && raasOrMra(m.tags)) };
}
