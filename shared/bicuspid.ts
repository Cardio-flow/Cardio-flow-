import type { StudyField } from "./studies.js";
import type { WizardContext } from "./wizards.js";

export const AORTIC_MORPHOLOGY = [
  "Tricuspid",
  "Bicuspid",
  "Other morphology",
  "Not assessed",
];
export const BAV_AORTIC_RISKS = [
  "None identified after review",
  "Family history of acute aortic syndrome",
  "Growth ≥3 mm/year",
  "Coarctation",
  "Resistant hypertension",
  "Heritable aortopathy / syndromic features",
  "Pregnancy planned",
  "Other risk modifier",
  "Not assessed",
];
const when = {
  field: "aorticMorphology",
  in: ["Bicuspid"],
  and: { field: "intervention", in: ["TAVI"] },
};
const choice = (key: string, label: string, options: string[]): StudyField => ({
  key,
  label,
  type: "choice",
  options,
  required: true,
  when,
});
const diameter = (key: string, label: string): StudyField => ({
  key,
  label,
  type: "number",
  unit: "mm",
  min: 1,
  max: 150,
  decimals: 1,
  when,
});
export const BICUSPID_FIELDS: StudyField[] = [
  {
    key: "aorticMorphology",
    label: "Aortic valve morphology",
    type: "choice",
    options: AORTIC_MORPHOLOGY,
    required: true,
    when: { field: "intervention", in: ["TAVI"] },
  },
  choice("bicuspidType", "Bicuspid phenotype", [
    "Fused",
    "Two-sinus",
    "Partial fusion",
    "Other characterized bicuspid phenotype",
    "Not assessed",
  ]),
  choice("raphe", "Raphe calcification", [
    "No raphe",
    "None / limited",
    "Heavy",
    "Not assessed",
  ]),
  choice("cuspCalcium", "Cusp calcification burden", [
    "Limited / moderate",
    "Heavy",
    "Not assessed",
  ]),
  choice(
    "bicuspidLanding",
    "Bicuspid landing zone / asymmetry and root-injury review",
    [
      "Suitable under selected device IFU",
      "Adverse anatomy / further review",
      "Not assessed",
    ],
  ),
  diameter("sinusDiameter", "Sinus of Valsalva diameter"),
  diameter("stjDiameter", "Sinotubular junction diameter"),
  diameter("ascendingDiameter", "Maximum ascending aorta diameter"),
  choice("thoracicAorta", "Entire thoracic aorta imaging review", [
    "CT reviewed",
    "CMR reviewed",
    "Incomplete / not assessed",
  ]),
  choice("aorticPhenotype", "Aortopathy phenotype", [
    "No dilatation",
    "Root phenotype",
    "Ascending phenotype",
    "Mixed / other",
    "Not assessed",
  ]),
  choice("coarctation", "Coarctation assessment", [
    "Excluded",
    "Present; specialist strategy recorded",
    "Not assessed",
  ]),
  {
    key: "aorticRisks",
    label: "Aortic risk modifiers",
    type: "multi",
    options: BAV_AORTIC_RISKS,
    when,
  },
  {
    key: "aorticGrowth",
    label: "Documented aortic growth (if comparable prior imaging)",
    type: "number",
    unit: "mm/year",
    min: 0,
    max: 30,
    decimals: 1,
    when,
  },
  choice("aorticStrategy", "Specialist aortic treatment strategy", [
    "No aortic surgery indication after review",
    "Aortic surgery indicated / preferred",
    "Aortic surgery deferred for prohibitive risk; rationale documented",
    "Review incomplete",
  ]),
];

export function bicuspidReport(c: WizardContext) {
  const st = c.structural?.planning.find(
    (st) => st.findings.intervention === "TAVI",
  );
  const newer = c.aorta?.report;
  const a = newer?.attributes;
  const updated = st && newer && newer.at.slice(0,10) >= st.day && a?.purpose ? {
    ...st.findings,
    // A newer report can add concerns; missing measurements never clear the prior concern.
    ...Object.fromEntries(["sinusDiameter","stjDiameter","ascendingDiameter","aorticMorphology","aorticPhenotype","coarctation","aorticGrowth","aorticStrategy"].filter(k=>a[k] != null).map(k=>[k,a[k]])),
    ...(a.extent === "Entire thoracic aorta" && ["CT","CMR"].includes(a.modality) ? {thoracicAorta:a.modality+" reviewed"}:{}),
  } : st?.findings;
  return st
    ? ({ ...updated, aorticRationale: a?.aorticStrategy && newer && newer.at.slice(0,10) >= st.day ? newer.conclusion : st.conclusion ?? "" } as Record<
        string,
        any
      >)
    : undefined;
}
export function isBicuspid(c: WizardContext) {
  return (
    !!c.aorta?.bicuspid || !!c.valve?.bicuspid || bicuspidReport(c)?.aorticMorphology === "Bicuspid"
  );
}
export function aorticMaximum(a: Record<string, any>) {
  return Math.max(
    a.sinusDiameter ?? 0,
    a.stjDiameter ?? 0,
    a.ascendingDiameter ?? 0,
  );
}
// ESC PAD/aorta 2024 Table 68: surgical assessment, not device sizing.
export function aorticSurgeryRecommended(a: Record<string, any>) {
  return (
    aorticMaximum(a) >= 55 ||
    (a.aorticPhenotype === "Root phenotype" && aorticMaximum(a) >= 50)
  );
}
export function bicuspidMissing(c: WizardContext): string[] {
  if (!isBicuspid(c)) return [];
  const a = bicuspidReport(c);
  if (!a)
    return ["Bicuspid CT / CMR anatomy and entire thoracic aorta assessment"];
  const missing: string[] = [];
  if (a.aorticMorphology !== "Bicuspid")
    missing.push("Bicuspid morphology: reconcile echo and planning report");
  if (
    ![
      "Fused",
      "Two-sinus",
      "Partial fusion",
      "Other characterized bicuspid phenotype",
    ].includes(a.bicuspidType) ||
    !["No raphe", "None / limited", "Heavy"].includes(a.raphe) ||
    !["Limited / moderate", "Heavy"].includes(a.cuspCalcium)
  )
    missing.push("Bicuspid phenotype, raphe and cusp calcification");
  if (a.bicuspidLanding !== "Suitable under selected device IFU")
    missing.push("Bicuspid landing zone, asymmetry and root-injury review");
  if (
    ![a.sinusDiameter, a.stjDiameter, a.ascendingDiameter].every((n) => n > 0)
  )
    missing.push("Recorded sinus, STJ and ascending aorta diameters");
  if (!["CT reviewed", "CMR reviewed"].includes(a.thoracicAorta))
    missing.push("Entire thoracic aorta CT / CMR review");
  if (
    ![
      "No dilatation",
      "Root phenotype",
      "Ascending phenotype",
      "Mixed / other",
    ].includes(a.aorticPhenotype)
  )
    missing.push("Aortopathy phenotype");
  if (
    !["Excluded", "Present; specialist strategy recorded"].includes(
      a.coarctation,
    )
  )
    missing.push("Coarctation assessment / strategy");
  if (
    !a.aorticRisks?.length ||
    a.aorticRisks.includes("Not assessed") ||
    (a.aorticRisks.includes("None identified after review") &&
      a.aorticRisks.length > 1)
  )
    missing.push("Aortic growth, family / heritable and other risk modifiers");
  if (a.aorticGrowth >= 3 && !a.aorticRisks?.includes("Growth ≥3 mm/year"))
    missing.push("Rapid aortic growth: reconcile the recorded risk assessment");
  if (
    a.coarctation === "Present; specialist strategy recorded" &&
    !a.aorticRisks?.includes("Coarctation")
  )
    missing.push("Coarctation: reconcile the recorded risk assessment");
  if (
    ![
      "No aortic surgery indication after review",
      "Aortic surgery deferred for prohibitive risk; rationale documented",
    ].includes(a.aorticStrategy)
  )
    missing.push(
      "Specialist aortic treatment strategy; TAVI does not treat aortopathy",
    );
  if (
    aorticSurgeryRecommended(a) &&
    a.aorticStrategy !==
      "Aortic surgery deferred for prohibitive risk; rationale documented"
  )
    missing.push(
      "Guideline aortic surgery indication: surgical assessment or documented prohibitive-risk strategy",
    );
  if (
    a.aorticStrategy ===
      "Aortic surgery deferred for prohibitive risk; rationale documented" &&
    !a.aorticRationale?.trim()
  )
    missing.push(
      "Actual specialist prohibitive-risk rationale in the report conclusion",
    );
  return missing;
}
