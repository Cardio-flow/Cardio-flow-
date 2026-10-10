// Calendar months, clamped to the last day of the destination month. Clinical durations
// expressed in months must not be approximated by 30-day blocks.
export function addCalendarMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
export const LAA_METHODS = [
  "Transcatheter occlusion",
  "Surgical exclusion",
] as const;
export const LAA_DEVICES = [
  "WATCHMAN FLX",
  "WATCHMAN FLX Pro",
  "Amplatzer Amulet",
  "Other transcatheter device",
  "Surgical clip",
  "Surgical excision / suture",
] as const;
export const LAA_RESULTS = [
  "Implanted / completed",
  "Aborted / not implanted",
] as const;
export const LAA_REGIMENS = [
  "OAC",
  "DAPT",
  "SAPT",
  "No antithrombotic",
  "Not documented",
] as const;
