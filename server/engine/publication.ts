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
export const NEEDS_REVIEW: Record<string, string> = {};

// Local numbers the clinical owner approved: published, with the approval as the publisher and note.
export const OWNER_APPROVED: Record<string, { by: string; note: string }> = {
  "rhythm.device-wound-check": {
    by: "clinical-owner:ahmed",
    note: "Approved by the clinical owner (Ahmed) on 5 Oct 2026: clinic wound check 7–10 days after a device procedure (local practice, not a guideline number).",
  },
};
export const publisherFor = (id: string) => OWNER_APPROVED[id]?.by ?? POLICY_PUBLISHER;
export const noteFor = (id: string) => OWNER_APPROVED[id]?.note ?? POLICY_NOTE;

export const publishedByPolicy = (rule: { id: string; kind: string }) => rule.kind === "clinical" && !(rule.id in NEEDS_REVIEW);
