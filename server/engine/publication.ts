// Publication policy (Ahmed, 1 Oct 2026): a clinical rule whose trigger logic and thresholds
// come straight from a current guideline, drug label or standard definition (cited in its
// `evidence`) is PUBLISHED at build and applies to every patient, without a separate review.
// A rule whose trigger depends on a number CardioFlow chose locally stays in CLINICAL_REVIEW
// (sandbox only) until a clinician approves it in Governance. Listed here, with the reason.
// Data-freshness windows (how recent a result must be) are workflow, not clinical thresholds.
export const POLICY_PUBLISHER = "policy:guideline-basis";
export const POLICY_NOTE =
  "Published under the clinical owner's decision of 1 Oct 2026: trigger and thresholds are taken from the cited guideline; no separate review required.";

// Empty since 1 Oct 2026 (evening): the last four rules were rebuilt on guideline values
// (ESC HF creatinine limits, 1–2 week post-discharge review, ESC/EACTS 2025 INR targets,
// ESC HF digoxin target 0.5–0.9 ng/mL). A future rule with a local number is listed here.
export const NEEDS_REVIEW: Record<string, string> = {
  "valve.echo-surveillance": "Echo surveillance intervals (6/12/36 months by severity, baseline 30–90 days after intervention, then yearly) from summaries of the ESC/EACTS guidelines: confirm against the 2025 text.",
  "valve.intervention-trigger": "Class I valve intervention triggers (LVEF and LVESD limits) taken from summaries of the ESC/EACTS guidelines: confirm against the 2025 guideline text before publishing.",
  "rhythm.device-wound-check": "Wound check 7–10 days after a device implant is local practice (Ahmed, 5 Oct 2026), not a guideline number.",
};

export const publishedByPolicy = (rule: { id: string; kind: string }) => rule.kind === "clinical" && !(rule.id in NEEDS_REVIEW);
