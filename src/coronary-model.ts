export const coronaryStates = [
  "NO_ESTABLISHED_CAD",
  "SUSPECTED_CAD",
  "CCS",
  "PREVIOUS_MI",
  "PREVIOUS_PCI",
  "PREVIOUS_CABG",
  "CURRENT_ACS",
  "POST_ACS",
  "ANOCA",
  "INOCA",
  "RECURRENT_ANGINA",
  "OTHER",
] as const;

export const acsDiagnoses = [
  "POSSIBLE_ACS",
  "STEMI",
  "NSTEMI",
  "NSTE_ACS",
  "UNSTABLE_ANGINA",
  "ALTERNATIVE_DIAGNOSIS",
  "UNCERTAIN",
] as const;

export const coronaryVessels = [
  "LM",
  "LAD",
  "D1",
  "D2",
  "LCX",
  "OM1",
  "OM2",
  "RCA",
  "PDA",
  "PL",
  "RIMA_GRAFT",
  "LIMA_GRAFT",
  "SVG",
  "OTHER",
] as const;

export const coronaryPlanCategories = [
  "ANTITHROMBOTIC",
  "CCS",
  "ANOCA_INOCA",
  "REVASCULARIZATION",
  "PREVENTION",
  "REHABILITATION",
  "COMPLICATION",
  "DISCHARGE",
  "FOLLOW_UP",
  "RISK_ASSESSMENT",
] as const;

export const coronaryComplications = [
  "RECURRENT_CHEST_PAIN",
  "RECURRENT_ISCHEMIA",
  "REINFARCTION_CONCERN",
  "STENT_THROMBOSIS_CONCERN",
  "NO_REFLOW",
  "ACCESS_BLEEDING",
  "HEMATOMA",
  "RETROPERITONEAL_BLEEDING_CONCERN",
  "CONTRAST_RENAL_DETERIORATION",
  "ACUTE_HF",
  "CARDIOGENIC_SHOCK",
  "VENTRICULAR_ARRHYTHMIA",
  "BRADYARRHYTHMIA_AV_BLOCK",
  "MECHANICAL_MI_COMPLICATION",
  "POST_MI_PERICARDITIS",
  "MAJOR_BLEEDING",
  "OTHER",
] as const;

export const coronaryEvidence = [
  {
    key: "esc-acs",
    version: "2023",
    title: "ESC Guidelines for the management of acute coronary syndromes",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/acute-coronary-syndromes/",
  },
  {
    key: "esc-ccs",
    version: "2024",
    title: "ESC Guidelines for the management of chronic coronary syndromes",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/chronic-coronary-syndromes/",
  },
  {
    key: "esc-eas-lipids",
    version: "2025",
    title: "ESC/EAS focused update on dyslipidaemias",
    url: "https://www.escardio.org/news/news-room/congress-news/2025-focused-update-dyslipidaemias/",
  },
  {
    key: "esc-rehabilitation",
    version: "2026",
    title: "ESC Guidelines on cardiac rehabilitation",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/cardiac-rehabilitation/",
  },
] as const;

export type CoronaryRecord = {
  states: Record<string, any>[];
  currentState: Record<string, any> | null;
  ecgs: Record<string, any>[];
  acsEvents: Record<string, any>[];
  angiograms: Record<string, any>[];
  pcis: Record<string, any>[];
  plans: Record<string, any>[];
  currentPlans: Record<string, any>[];
  troponins: Record<string, any>[];
  lipids: Record<string, any>[];
  medications: Record<string, any>[];
  latestEcho: Record<string, any> | null;
  hfProfile: Record<string, any> | null;
  valveStates: Record<string, any>[];
  rehabilitation: Record<string, any> | null;
  tasks: Record<string, any>[];
  registryProjection: Record<
    string,
    { value: unknown; source: string; observed_at: string }
  >;
  registrySections: Record<string, boolean>;
  reviewItems: string[];
  legacyCadEpisodes: Record<string, any>[];
  evidence: typeof coronaryEvidence;
};

export const prettyCoronary = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
