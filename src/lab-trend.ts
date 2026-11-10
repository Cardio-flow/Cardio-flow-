import type { Sev } from "./ui";
import { pregnancyHaemoglobinCutoff } from "../shared/pregnancy";
import { formatNumber } from "../shared/catalog";

export function trendPercent(percent: number | null | undefined): string | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  if (percent !== 0 && Math.abs(percent) < 0.1) return `${percent > 0 ? "+" : "−"}<0.1%`;
  return `${percent > 0 ? "+" : ""}${formatNumber(percent, 1)}%`;
}

// colour of a result against its reference range (display only; the trimester haemoglobin cut-off in pregnancy)
export const toneOf = (r: any, s?: any): Sev => {
  const v = r.latest?.value ?? r.current?.value;
  if (v == null) return "gray";
  if (s?.pregnancy?.phase === "Pregnant" && r.code === "haemoglobin") {
    const at = r.latest?.at ?? r.current?.at;
    const cutoff = at ? pregnancyHaemoglobinCutoff(s.pregnancy.edd ?? undefined, String(at).slice(0, 10)) : null;
    return cutoff == null ? "gray" : v < cutoff ? "orange" : "blue";
  }
  if (r.ref?.high != null && v > r.ref.high) return r.code === "potassium" ? "red" : "orange";
  if (r.ref?.low != null && v < r.ref.low) return "orange";
  return "blue";
};
