// Adult result review. Thresholds are guideline parameters, not catalogue ranges.
export const LAB_LIMITS = {
  vitaminD: 25,
  hbMale: 13,
  hbFemale: 12,
  severeHb: 8,
  ferritin: 30,
  liverStop: 3,
  ckReview: 4,
  ckStop: 10,
};
export type LabResult = {
  id: string;
  value: number;
  at: string;
  referenceHigh: number | null;
};
export type LabReview = Record<string, LabResult>;
export const ratio = (r?: LabResult) =>
  r && r.referenceHigh != null && r.referenceHigh > 0
    ? r.value / r.referenceHigh
    : null;
export const LAB_SOURCES = {
  vitamin:
    "NICE PH56 (UK low status <25 nmol/L); Endocrine Society 2024 prevention (no universal sufficiency target); NHS colecalciferol dosing; NHS SPS vitamin D safety",
  anaemia:
    "WHO haemoglobin cutoffs 2024; BSG adult iron deficiency anaemia 2021 (reviewed 2026); ESC HF focused update 2023",
  liver:
    "ESC/EAS dyslipidaemias 2019 Table 13 (complements focused update 2025); NHS SPS liver blood tests",
  ck: "ESC/EAS dyslipidaemias 2019 Table 13 (complements focused update 2025)",
};
export const LAB_URLS = {
  vitamin: "https://www.nice.org.uk/guidance/ph56/chapter/glossary",
  vitaminDose:
    "https://www.nhs.uk/medicines/colecalciferol/how-and-when-to-take-colecalciferol/",
  vitaminSafety:
    "https://sps.nhs.uk/articles/safety-considerations-when-using-vitamin-d/",
  prevention:
    "https://www.endocrine.org/clinical-practice-guidelines/vitamin-d-for-prevention-of-disease",
  anaemia:
    "https://www.bsg.org.uk/clinical-resource/guidelines-iron-deficiency-anaemia-in-adults/",
  haemoglobin: "https://www.who.int/publications/i/item/9789240088542",
  statin:
    "https://eas-society.org/wp-content/uploads/2022/05/2019_EAS-ESC_Guidelines_dyslipidaemia_ATH.pdf",
  liver:
    "https://sps.nhs.uk/articles/assessing-liver-function-and-interpreting-liver-blood-tests/",
};
