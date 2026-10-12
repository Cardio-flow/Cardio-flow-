export function needsExplicitReview(
  title: string,
  trigger: { type?: string; requiresReview?: boolean },
) {
  return (
    trigger.type === "visit" &&
    (trigger.requiresReview === true ||
      /specialist|\bEP\b|structural|valve clinic|RDN.*(?:review|recovery)|HF centre/i.test(
        title,
      ))
  );
}
export function studyBookingKey(trigger: Record<string, unknown>) {
  if (trigger.type !== "study") return null;
  // All clinical matching fields participate; source/indication metadata lives on the plan row.
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(trigger).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
