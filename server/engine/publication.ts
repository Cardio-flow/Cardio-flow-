// Publication policy (Ahmed, 1 Oct 2026): a clinical rule whose trigger logic and thresholds
// come straight from a current guideline, drug label or standard definition (cited in its
// `evidence`) is PUBLISHED at build and applies to every patient, without a separate review.
// A rule whose trigger depends on a number CardioFlow chose locally stays in CLINICAL_REVIEW
// (sandbox only) until a clinician approves it in Governance. Listed here, with the reason.
// Data-freshness windows (how recent a result must be) are workflow, not clinical thresholds.
export const POLICY_PUBLISHER = "policy:guideline-basis";
export const POLICY_NOTE =
  "Published under the clinical owner's decision of 1 Oct 2026: trigger and thresholds are taken from the cited guideline; no separate review required.";

export const NEEDS_REVIEW: Record<string, string> = {
  "hf.worsening-renal-function": "Baseline window (90 days) and the 25% relative rise are local choices; guideline definitions of worsening renal function vary.",
  "hf.post-discharge-review": "Review within 7 days when discharged still congested is a local choice (the guideline says 1–2 weeks for all).",
  "safety.inr": "One mechanical-valve range (2.5–3.5) simplifies the ESC/EACTS target, which depends on the prosthesis and patient risk factors.",
  "safety.digoxin": "Digoxin level >2.0 ng/mL as 'toxic' is a local choice; the guideline gives the therapeutic target (0.5–0.9 ng/mL) only.",
};

export const publishedByPolicy = (rule: { id: string; kind: string }) => rule.kind === "clinical" && !(rule.id in NEEDS_REVIEW);
