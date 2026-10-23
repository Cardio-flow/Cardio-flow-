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
  "cardiorenal.ckd-stage",     // problem-list entry for CKD
  "cardiorenal.stage-review",  // recorded CKD stage vs latest eGFR
  "studies.problem-list",      // study findings not on the problem list
  "valve.echo-lesion-unlisted",// valve lesion not on the problem list
  "valve.echo-surveillance",   // scheduled echo surveillance
  "cmp.follow-up",             // ECG and echo every 1–2 years
  "rhythm.remote-monitoring",  // remote monitoring enrolment
  "lab.vitamin-d",             // vitamin D result
  "med.monitoring",            // routine medicine blood tests
]);
export const isRoutine = (a: { rule_id: string; severity: string }) => ROUTINE_RULES.has(a.rule_id) && a.severity !== "red";
