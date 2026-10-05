// Mavacamten starting dose from the CYP2C19 result (EU/UK SmPC Camzyos, section 4.2), at Ahmed's request
// (5 Oct 19:56: "add starting dose according to lab result for cyp in case of mavacamten"):
//  - "Patients should be genotyped for CYP2C19 in order to determine appropriate mavacamten dose."
//  - poor metabolisers: starting dose 2.5 mg once daily, maximum 5 mg;
//  - intermediate, normal, rapid and ultra-rapid metabolisers: starting dose 5 mg once daily, maximum 15 mg;
//  - "If treatment initiation occurs prior to determination of CYP2C19 phenotype, patients should follow
//    dosing instructions for poor metabolisers until CYP2C19 phenotype is determined."
//  - "If LVEF is < 55%, treatment should not be initiated."
// Dose steps 2.5, 5, 10, 15 mg. Titration (Valsalva LVOT gradient at 4 and 8 weeks; up-titration with LVEF ≥55%
// and gradient ≥30 mmHg) stays with the specialist.
export const CYP2C19_PHENOTYPES = ["Not tested", "Poor metaboliser", "Intermediate metaboliser", "Normal metaboliser", "Rapid metaboliser", "Ultrarapid metaboliser"];
export const poorOrUnknown = (p: string | null | undefined) => !p || p === "Not tested" || p === "Poor metaboliser";

export function mavacamtenStart(phenotype: string | null | undefined) {
  const known = !!phenotype && phenotype !== "Not tested";
  if (!known) return { dose: 2.5, max: 5, known, basis: "CYP2C19 not yet determined: poor-metaboliser dosing until it is known — genotype the patient", why: "CYP2C19 phenotype not yet determined: poor-metaboliser dosing (start 2.5 mg once daily, maximum 5 mg) until it is known — genotype the patient (SmPC 4.2)" };
  if (phenotype === "Poor metaboliser") return { dose: 2.5, max: 5, known, basis: "CYP2C19 poor metaboliser", why: "CYP2C19 poor metaboliser: start 2.5 mg once daily, maximum 5 mg (SmPC 4.2)" };
  return { dose: 5, max: 15, known, basis: `CYP2C19 ${phenotype!.toLowerCase()}`, why: `CYP2C19 ${phenotype!.toLowerCase()}: start 5 mg once daily, maximum 15 mg (SmPC 4.2)` };
}
