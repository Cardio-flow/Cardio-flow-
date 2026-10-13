// Arithmetic for an existing prescription, not a treatment recommendation.
export const DAILY_FREQUENCY: Record<string, number> = {
  OD: 1,
  Nightly: 1,
  Mornings: 1,
  BID: 2,
  TID: 3,
  QID: 4,
  "Alternate days": 0.5,
};
export function exposureChange(
  dose: number | null,
  frequency: string | null,
  nextDose: number | null,
  nextFrequency: string | null,
) {
  if (dose === nextDose && frequency === nextFrequency) return "same";
  const before = DAILY_FREQUENCY[frequency ?? ""],
    after = DAILY_FREQUENCY[nextFrequency ?? ""];
  if (dose == null || nextDose == null || !before || !after) return "unknown";
  return nextDose * after > dose * before ? "increase" : "reduction";
}
