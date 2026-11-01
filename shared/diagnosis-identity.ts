// Diagnosis identity only: no inference of a patient's phenotype from a new result.
import { MULTIPLE_ALLOWED, ONE_OF } from "./history.js";

type ConditionIdentity = {
  code: string;
  onset?: string | Date | null;
  attributes?: Record<string, unknown> | null;
  detail?: string | null;
};
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value
        .map(canonical)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
export function conditionIdentity(c: ConditionIdentity): string | null {
  const onset =
    c.onset instanceof Date
      ? c.onset.toISOString().slice(0, 10)
      : (c.onset?.slice(0, 10) ?? null);
  // A shared year or missing date does not prove repeat MI/PCI/valve entries are the same event.
  if (MULTIPLE_ALLOWED.has(c.code) && !onset) return null;
  return JSON.stringify([
    c.code,
    onset,
    canonical(c.attributes ?? {}),
    (c.detail ?? "").trim(),
  ]);
}
export function distinctConditions<T extends ConditionIdentity>(
  conditions: T[],
): T[] {
  const seen = new Set<string>();
  return conditions.filter((c) => {
    const key = conditionIdentity(c);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function diagnosisConflicts<T extends { code: string }>(
  conditions: T[],
): T[][] {
  return ONE_OF.map((group) =>
    conditions.filter((c) => group.includes(c.code)),
  ).filter((group) => new Set(group.map((c) => c.code)).size > 1);
}
