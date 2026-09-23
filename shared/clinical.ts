// Pure clinical helpers shared by server and browser. No I/O here.

// Race-free 2021 CKD-EPI creatinine equation (NIDDK). Creatinine in µmol/L.
export function egfrCkdEpi2021(creatinineUmol: number, ageYears: number, sex: "Male" | "Female") {
  if (!(creatinineUmol > 0) || ageYears < 18) return null;
  const scr = creatinineUmol / 88.42;
  const female = sex === "Female";
  const kappa = female ? 0.7 : 0.9;
  const alpha = female ? -0.241 : -0.302;
  const ratio = scr / kappa;
  return 142 * Math.min(ratio, 1) ** alpha * Math.max(ratio, 1) ** -1.2 * 0.9938 ** ageYears * (female ? 1.012 : 1);
}

// Cockcroft-Gault (mL/min). Creatinine in µmol/L; the weight used must be stated by the caller.
export function cockcroftGault(creatinineUmol: number, ageYears: number, weightKg: number, sex: "Male" | "Female") {
  if (!(creatinineUmol > 0) || !(weightKg > 0) || ageYears < 18) return null;
  const scr = creatinineUmol / 88.42;
  return (((140 - ageYears) * weightKg) / (72 * scr)) * (sex === "Female" ? 0.85 : 1);
}

export const bmi = (weightKg: number, heightCm: number) => weightKg / (heightCm / 100) ** 2;
export const bsaMosteller = (weightKg: number, heightCm: number) => Math.sqrt((weightKg * heightCm) / 3600);

export function ageOn(birthDate: string, on: string) {
  const b = new Date(birthDate + "T00:00:00Z");
  const d = new Date(on.slice(0, 10) + "T00:00:00Z");
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

// Dates are handled as ISO calendar days in the site's time zone.
export const SITE_TZ = "Asia/Kuwait";
export function isoDay(date: Date = new Date(), tz = SITE_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function addDays(day: string, days: number) {
  const d = new Date(day.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const dayOf = (v: string) => (v.length > 10 ? isoDay(new Date(v)) : v);
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(dayOf(to) + "T12:00:00Z") - Date.parse(dayOf(from) + "T12:00:00Z")) / 86400000);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Calendar day in the site's time zone, e.g. "24 Sep", "Thu 24 Sep 2026"
export function fmtDay(value: string | null | undefined, opts: { weekday?: boolean; year?: boolean } = {}) {
  if (!value) return "—";
  const day = value.length > 10 ? isoDay(new Date(value)) : value;
  const d = new Date(day + "T12:00:00Z");
  return `${opts.weekday ? WEEKDAYS[d.getUTCDay()] + " " : ""}${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}${opts.year ? " " + d.getUTCFullYear() : ""}`;
}
export function fmtTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: SITE_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export type PlanStatusView = "done" | "overdue" | "due" | "planned" | "deferred" | "cancelled" | "superseded";
export function planStatusView(status: string, due: string | null, today: string): PlanStatusView {
  if (status === "completed") return "done";
  if (status !== "planned") return status as PlanStatusView;
  if (!due) return "planned";
  if (due < today) return "overdue";
  if (due === today) return "due";
  return "planned";
}

// ---------- current value resolution ----------
export type ObservationLike = {
  id: string;
  code: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  effective_at: string;
  status: "final" | "preliminary" | "entered_in_error";
  quality: "standard" | "formal" | "limited" | "bedside";
  source: string;
};

export type Resolved<T extends ObservationLike> = {
  current: T | null;
  latest: T | null;
  reason: "only" | "latest" | "clinician preference" | "higher-quality study preferred" | "verified preferred over preliminary" | "none";
  history: T[]; // newest first, excludes entered-in-error
};

// Not always the newest value: clinician preference wins; a limited/bedside study does not
// silently replace a recent formal one; verified beats preliminary.
export function resolveCurrent<T extends ObservationLike>(
  observations: T[],
  preferredId: string | null,
  opts: { formalWindowDays: number } = { formalWindowDays: 180 },
): Resolved<T> {
  const history = observations
    .filter((o) => o.status !== "entered_in_error")
    .sort((a, b) => (a.effective_at < b.effective_at ? 1 : -1));
  const latest = history[0] ?? null;
  if (!latest) return { current: null, latest: null, reason: "none", history };
  if (preferredId) {
    const p = history.find((o) => o.id === preferredId);
    if (p) return { current: p, latest, reason: "clinician preference", history };
  }
  if (latest.status === "preliminary") {
    const verified = history.find((o) => o.status === "final");
    if (verified) return { current: verified, latest, reason: "verified preferred over preliminary", history };
  }
  if (latest.quality === "limited" || latest.quality === "bedside") {
    const formal = history.find(
      (o) => o.quality === "formal" && o.status === "final" && daysBetween(o.effective_at, latest.effective_at) <= opts.formalWindowDays,
    );
    if (formal) return { current: formal, latest, reason: "higher-quality study preferred", history };
  }
  return { current: latest, latest, reason: history.length === 1 ? "only" : "latest", history };
}

export function flagFor(value: number, ref?: { low?: number; high?: number }) {
  if (!ref) return null;
  if (ref.high != null && value > ref.high) return "high" as const;
  if (ref.low != null && value < ref.low) return "low" as const;
  return null;
}
