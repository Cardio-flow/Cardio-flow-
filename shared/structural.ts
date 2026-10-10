// Reporting vocabulary. Measurements are reported values, not device eligibility cutoffs.
export const STRUCTURAL_TARGETS = [
  "TAVI",
  "Mitral TEER",
  "Tricuspid TEER",
  "Valve-in-valve / other transcatheter valve",
];
export const STRUCTURAL_RESULTS = ["Completed", "Aborted / no implant"];
export const STRUCTURAL_COMPLICATIONS = [
  "None",
  "Stroke / TIA",
  "Major bleeding",
  "Vascular injury",
  "Acute kidney injury",
  "Pericardial effusion / tamponade",
  "Coronary obstruction",
  "New AV block / pacemaker",
  "Significant residual leak",
  "Single-leaflet device attachment",
  "Other",
];
export const RESIDUAL_GRADES = [
  "None / trace",
  "Mild",
  "Moderate",
  "Severe",
  "Not assessed",
];
export const structuralTarget = (a: Record<string, any>) =>
  a.procedure === "TAVI"
    ? "TAVI"
    : a.procedure === "Transcatheter edge-to-edge repair (TEER)"
      ? `${a.position} TEER`
      : ["Valve-in-valve", "Transcatheter valve replacement"].includes(
            a.procedure,
          )
        ? "Valve-in-valve / other transcatheter valve"
        : null;
