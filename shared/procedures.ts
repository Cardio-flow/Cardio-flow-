// Procedures (coronary module, 4 Oct 2026): PCI and CABG as their own dated records, so that
// antithrombotic durations can be counted from the exact day and the setting (ACS or elective).
// Descriptive vocabulary only. Complex PCI follows the ESC definition used for DAPT decisions
// (≥3 vessels treated, ≥3 stents, ≥3 lesions, bifurcation with 2 stents, total stent length
// >60 mm, chronic total occlusion).

export const PCI_SETTINGS = [
  { value: "stemi", label: "Primary PCI (STEMI)", acs: true },
  { value: "nste-acs", label: "NSTE-ACS", acs: true },
  { value: "elective", label: "Elective (chronic coronary syndrome)", acs: false },
  { value: "staged", label: "Staged after ACS", acs: true },
] as const;
export const PCI_VESSELS = ["Left main", "LAD", "LCx", "RCA", "Graft"] as const;
export const PCI_DEVICES = ["Drug-eluting stent", "Drug-coated balloon", "Balloon only"] as const;
export const COMPLEX_FEATURES = ["≥3 vessels treated", "≥3 stents", "≥3 lesions", "Bifurcation with 2 stents", "Total stent length >60 mm", "Chronic total occlusion"] as const;
export const CABG_GRAFTS = ["LIMA to LAD", "Other arterial graft", "Vein grafts"] as const;
export const ACCESS = ["Radial", "Femoral"] as const;

export type ProcedureKind = "pci" | "cabg";
export const PROCEDURE_LABEL: Record<ProcedureKind, string> = { pci: "PCI", cabg: "CABG" };

const oneOf = <T extends readonly string[]>(list: T, v: unknown, what: string) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !list.includes(v)) throw new Error(`${what}: unknown value`);
  return v;
};
const someOf = <T extends readonly string[]>(list: T, v: unknown, what: string) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !list.includes(x))) throw new Error(`${what}: unknown value`);
  return [...new Set(v as string[])];
};

// Validate and clean a procedure's details.
export function cleanProcedure(kind: ProcedureKind, a: Record<string, unknown>) {
  if (kind === "pci") {
    const setting = oneOf(PCI_SETTINGS.map((s) => s.value), a.setting, "Setting");
    if (!setting) throw new Error("Setting is required");
    const vessels = someOf(PCI_VESSELS, a.vessels, "Vessels");
    if (!vessels.length) throw new Error("Choose the vessel(s) treated");
    const device = oneOf(PCI_DEVICES, a.device, "Device") ?? "Drug-eluting stent";
    const stents = a.stents == null || a.stents === "" ? null : Number(a.stents);
    if (stents != null && (!Number.isInteger(stents) || stents < 0 || stents > 12)) throw new Error("Number of stents: 0–12");
    return {
      setting, vessels, device, stents,
      complex: someOf(COMPLEX_FEATURES, a.complex, "Complex PCI"),
      access: oneOf(ACCESS, a.access, "Access"),
    };
  }
  const grafts = someOf(CABG_GRAFTS, a.grafts, "Grafts");
  const count = a.count == null || a.count === "" ? null : Number(a.count);
  if (count != null && (!Number.isInteger(count) || count < 1 || count > 8)) throw new Error("Number of grafts: 1–8");
  const setting = oneOf(["acs", "elective"] as const, a.setting, "Setting") ?? "elective";
  return { grafts, count, setting };
}

export const isAcsProcedure = (p: { kind: string; attributes: Record<string, any> }) =>
  p.kind === "pci" ? PCI_SETTINGS.some((s) => s.value === p.attributes.setting && s.acs) : p.attributes.setting === "acs";
export const isComplexPci = (p: { kind: string; attributes: Record<string, any> }) => p.kind === "pci" && (p.attributes.complex?.length ?? 0) > 0;

// One line for lists, the journey and notes.
export function procedureSummary(kind: string, a: Record<string, any>) {
  if (kind === "pci") {
    const setting = PCI_SETTINGS.find((s) => s.value === a.setting)?.label ?? "";
    const dev = a.device === "Drug-eluting stent" ? (a.stents ? `DES ×${a.stents}` : "DES") : a.device === "Drug-coated balloon" ? "DCB" : a.device === "Balloon only" ? "balloon only" : "";
    return [`${(a.vessels ?? []).join(", ")}${dev ? ` ${dev}` : ""}`, setting, a.complex?.length ? "complex PCI" : null].filter(Boolean).join(" · ");
  }
  return [a.count ? `${a.count} graft${a.count === 1 ? "" : "s"}` : null, (a.grafts ?? []).join(", ") || null, a.setting === "acs" ? "during ACS" : null].filter(Boolean).join(" · ");
}
