// Compact attribution for cards; the full source stays available in the opened pathway.
export function shortSource(w: { source?: string; sourceShort?: string }) {
  if (w.sourceShort) return w.sourceShort;
  const refs = [
    ...(w.source ?? "").matchAll(
      /\b(ESC(?:\/EACTS)?|ACC(?:\/[A-Z]+)*|EHRA(?:\/[A-Z]+)*|SCAI(?:\/HRS)?|HRS(?:\/EHRA)?|ADA(?:\/EASD)?|IDF-DAR|NICE|KDIGO|ERS|ASE)[^;\n]*?\b(20\d{2})/g,
    ),
  ].map(
    (m) =>
      `${m[1].startsWith("EHRA") ? "EHRA" : m[1].startsWith("ACC") ? "ACC/AHA" : m[1]} ${m[2]}`,
  );
  return (
    [...new Set(refs)].slice(0, 2).join(" · ") ||
    (w.source ?? "").split(/[;(]/)[0].trim()
  );
}
