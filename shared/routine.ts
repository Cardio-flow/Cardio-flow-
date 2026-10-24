// Routine checks (23 Oct 2026, Ahmed: "annual fundoscopy, vaccinations and one-lifetime Lp(a) … should be a
// recommendation at the end and collapsed, not part of the main overview. The overview should be directed to
// the big issues and management decisions"). These alerts are periodic screening, once-in-a-lifetime tests or
// record keeping: they are kept, with their actions, in a folded "Also due" list at the end of the overview.
// A red alert is never folded.
export const ROUTINE_RULES = new Set<string>([
  "dm.annual-checks",          // retinal screening and foot examination
  "dm.hba1c-due",              // HbA1c monitoring interval
  "lipids.lpa-once",           // Lp(a) once in adulthood
  "cardiorenal.screening",     // eGFR / UACR screening interval
  "valve.echo-surveillance",   // scheduled echo surveillance
  "cmp.follow-up",             // ECG and echo every 1–2 years
  "rhythm.remote-monitoring",  // remote monitoring enrolment
]);
export const isRoutine = (a: { rule_id: string; severity: string }) => ROUTINE_RULES.has(a.rule_id) && a.severity !== "red";

// Exact existing preventive plan templates only; do not classify free-text clinical
// work as routine merely because it says "annual" or "screening".
const PREVENTIVE_TITLES = new Set([
  "Diabetic retinal screening", "Diabetic foot examination", "Influenza vaccination",
  "Influenza, pneumococcal and COVID-19 vaccination",
]);
export function isRoutinePlan(p: {title?:string;clinicalContext?:{urgent?:boolean};completesOn?:{type?:string;codes?:unknown};completes_on?:{type?:string;codes?:unknown}}) {
  if(p.clinicalContext?.urgent) return false;
  const target=p.completesOn ?? p.completes_on;
  return PREVENTIVE_TITLES.has(p.title ?? "") || target?.type === "lab" && Array.isArray(target.codes) && target.codes.length === 1 && target.codes[0] === "lpa";
}
