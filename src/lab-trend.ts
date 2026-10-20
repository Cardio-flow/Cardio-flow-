import { formatNumber } from "../shared/catalog";

export function trendPercent(percent: number | null | undefined): string | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  if (percent !== 0 && Math.abs(percent) < 0.1) return `${percent > 0 ? "+" : "−"}<0.1%`;
  return `${percent > 0 ? "+" : ""}${formatNumber(percent, 1)}%`;
}
