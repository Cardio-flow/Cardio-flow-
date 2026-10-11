// A reading projection of the recorded event, never a fresh clinical assessment.
// Older decisions stored their assessment and outcomes as one middle-dot-delimited text.
// Keep that original intact; extract only its leading summary for the small overview.
export function journeySummary(
  detail: string,
  actionTitles: string[] = [],
  medNames: string[] = [],
) {
  const pieces = detail
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  const facts: { label: string; value: string }[] = [];
  const notes: string[] = [];
  let narrative = false;
  for (const piece of pieces) {
    if (
      piece.startsWith("Guideline suggestions not taken:") ||
      actionTitles.some((t) => piece === t || piece.startsWith(t + " · ")) ||
      medNames.some(
        (n) => piece.startsWith(n + " ") || piece.startsWith(n + ":"),
      )
    )
      break;
    const field = piece.match(/^([^:]{1,40}):\s+(.+)$/s);
    if (field && !narrative && !/[.!?]$/.test(field[2]))
      facts.push({ label: field[1], value: field[2] });
    else {
      narrative = true;
      notes.push(piece);
    }
  }
  return { facts: facts.slice(0, 6), notes: notes.slice(0, 2) };
}
