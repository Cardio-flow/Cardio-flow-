export const echoStudyTypes = [
  ["COMPLETE_TTE", "Complete TTE"],
  ["LIMITED_TTE", "Limited TTE"],
  ["TEE", "Transoesophageal Echo"],
  ["STRESS_ECHO", "Stress Echo"],
  ["CONTRAST_ECHO", "Contrast Echo"],
  ["THREE_D_ECHO", "3D Echo"],
  ["BEDSIDE_FOCUSED", "Bedside focused Echo"],
  ["INTERVENTIONAL_ECHO", "Interventional Echo"],
  ["OTHER", "Other Echo study"],
] as const;

export const echoIndications = [
  "Heart failure",
  "Murmur",
  "Known valve disease",
  "Post-valve intervention",
  "Prosthetic valve surveillance",
  "New symptoms",
  "Atrial fibrillation",
  "Pulmonary hypertension assessment",
  "Cardiomyopathy",
  "Aortic disease",
  "Preoperative assessment",
  "Endocarditis concern",
  "Other",
] as const;

export const measurementCatalog = [
  ["lvef", "LVEF", "LV", "%"],
  ["lv_edd", "LV end-diastolic diameter", "LV", "mm"],
  ["lv_esd", "LV end-systolic diameter", "LV", "mm"],
  ["lv_edv", "LV end-diastolic volume", "LV", "mL"],
  ["lv_esv", "LV end-systolic volume", "LV", "mL"],
  ["lv_edvi", "Indexed LV end-diastolic volume", "LV", "mL/m²"],
  ["lv_esvi", "Indexed LV end-systolic volume", "LV", "mL/m²"],
  ["lv_gls", "LV global longitudinal strain", "LV", "%"],
  ["lv_mass_index", "LV mass index", "LV", "g/m²"],
  ["rv_basal_diameter", "RV basal diameter", "RV", "mm"],
  ["rv_fac", "RV fractional area change", "RV", "%"],
  ["tapse", "TAPSE", "RV", "mm"],
  ["rv_s_prime", "RV S′", "RV", "cm/s"],
  ["rv_gls", "RV longitudinal strain", "RV", "%"],
  ["la_volume_index", "LA volume index", "ATRIA", "mL/m²"],
  ["ra_area", "RA area", "ATRIA", "cm²"],
  ["mitral_e_velocity", "Mitral E velocity", "DIASTOLIC", "cm/s"],
  ["mitral_a_velocity", "Mitral A velocity", "DIASTOLIC", "cm/s"],
  ["e_prime_septal", "Septal e′", "DIASTOLIC", "cm/s"],
  ["e_prime_lateral", "Lateral e′", "DIASTOLIC", "cm/s"],
  ["e_e_prime_average", "Average E/e′", "DIASTOLIC", "ratio"],
  ["tr_velocity", "Peak TR velocity", "PULMONARY", "m/s"],
  ["estimated_ra_pressure", "Estimated RA pressure", "PULMONARY", "mmHg"],
  ["rvsp", "Estimated RVSP", "PULMONARY", "mmHg"],
  ["pasp", "Estimated PASP", "PULMONARY", "mmHg"],
  ["aortic_root", "Aortic root diameter", "AORTA", "mm"],
  ["ascending_aorta", "Ascending aorta diameter", "AORTA", "mm"],
  ["av_vmax", "Aortic valve Vmax", "AORTIC_VALVE", "m/s"],
  ["av_mean_gradient", "Aortic valve mean gradient", "AORTIC_VALVE", "mmHg"],
  ["ava", "Aortic valve area", "AORTIC_VALVE", "cm²"],
  ["ava_indexed", "Indexed aortic valve area", "AORTIC_VALVE", "cm²/m²"],
  ["av_dvi", "Aortic valve DVI", "AORTIC_VALVE", "ratio"],
  ["stroke_volume_index", "Stroke volume index", "HEMODYNAMICS", "mL/m²"],
  ["mr_vena_contracta", "MR vena contracta", "MITRAL_VALVE", "mm"],
  ["mr_eroa", "MR effective regurgitant orifice area", "MITRAL_VALVE", "cm²"],
  ["mr_regurgitant_volume", "MR regurgitant volume", "MITRAL_VALVE", "mL"],
  ["mr_regurgitant_fraction", "MR regurgitant fraction", "MITRAL_VALVE", "%"],
  ["mitral_mean_gradient", "Mitral mean gradient", "MITRAL_VALVE", "mmHg"],
  ["mitral_valve_area", "Mitral valve area", "MITRAL_VALVE", "cm²"],
  ["tr_vena_contracta", "TR vena contracta", "TRICUSPID_VALVE", "mm"],
  ["prosthetic_peak_velocity", "Prosthetic peak velocity", "PROSTHESIS", "m/s"],
  [
    "prosthetic_mean_gradient",
    "Prosthetic mean gradient",
    "PROSTHESIS",
    "mmHg",
  ],
  ["prosthetic_dvi", "Prosthetic DVI", "PROSTHESIS", "ratio"],
] as const;

export const valveNames = [
  "AORTIC",
  "MITRAL",
  "TRICUSPID",
  "PULMONARY",
  "MULTIPLE",
] as const;
export const valveLesions = [
  "NONE",
  "STENOSIS",
  "REGURGITATION",
  "MIXED",
  "PROSTHETIC",
  "POST_REPAIR",
] as const;
export const valveSeverities = [
  "NONE",
  "MILD",
  "MODERATE",
  "SEVERE",
  "INDETERMINATE",
  "DISCORDANT_REQUIRES_CONFIRMATION",
  "POST_INTERVENTION",
] as const;

export type EchoMeasurement = {
  id?: string;
  section: string;
  parameter_code: string;
  label: string;
  value_number: number | null;
  value_text: string | null;
  unit: string;
  method: string;
  context: string;
  sequence?: number;
  fact_id?: string | null;
};
export type EchoValveFinding = {
  id?: string;
  valve_name: (typeof valveNames)[number];
  lesion_type: (typeof valveLesions)[number];
  mechanism: string;
  clinician_severity: (typeof valveSeverities)[number];
  calculated_assessment?: string | null;
  discordant: boolean;
  supporting_parameters: string[];
  morphology: string;
  narrative: string;
  override_reason: string;
};
export type EchoStudy = {
  study_id: string;
  revision_id: string;
  version: number;
  patient_id: string;
  encounter_id: string | null;
  study_type: string;
  formality: "FORMAL" | "BEDSIDE_LIMITED";
  performed_at: string;
  location: string;
  comparison_study_id: string | null;
  status: string;
  indication: string[];
  priority: string;
  study_quality: string;
  quality_reasons: string[];
  rhythm_context: string;
  heart_rate: number | null;
  blood_pressure: string;
  contrast_used: boolean;
  structured_findings: Record<string, unknown>;
  interpretation: string;
  comparison_summary: string;
  conclusion: string;
  clinician_override_reason: string;
  reporting_cardiologist: string;
  amendment_reason: string;
  source_label: string;
  measurements: EchoMeasurement[];
  valve_findings: EchoValveFinding[];
  quality_checks: { severity: string; code: string; message: string }[];
};

const qualityRank: Record<string, number> = {
  VERY_LIMITED: 0,
  TECHNICALLY_LIMITED: 1,
  ADEQUATE: 2,
  GOOD: 3,
};

export function echoPreferenceScore(
  study: Pick<
    EchoStudy,
    "status" | "study_quality" | "formality" | "performed_at"
  >,
) {
  return (
    (["FINAL", "AMENDED"].includes(study.status) ? 1_000_000_000_000 : 0) +
    (study.formality === "FORMAL" ? 100_000_000_000 : 0) +
    (qualityRank[study.study_quality] ?? 0) * 10_000_000_000 +
    new Date(study.performed_at).getTime() / 1000
  );
}

export function preferredEchoStudy(studies: EchoStudy[]) {
  return (
    [...studies]
      .filter((study) => ["FINAL", "AMENDED"].includes(study.status))
      .sort((a, b) => echoPreferenceScore(b) - echoPreferenceScore(a))[0] ??
    null
  );
}

export function compareEchoStudies(
  current: EchoStudy,
  previous: EchoStudy | null,
) {
  if (!previous) return [];
  const prior = new Map(
    previous.measurements.map((item) => [item.parameter_code, item]),
  );
  const changes = current.measurements.flatMap((item) => {
    const before = prior.get(item.parameter_code);
    if (
      !before ||
      before.value_number === null ||
      item.value_number === null ||
      before.value_number === item.value_number
    )
      return [];
    return [
      {
        code: item.parameter_code,
        label: item.label,
        previous: before.value_number,
        current: item.value_number,
        unit: item.unit,
        intervalDays: Math.round(
          (new Date(current.performed_at).getTime() -
            new Date(previous.performed_at).getTime()) /
            86_400_000,
        ),
        source: current.source_label,
        quality: current.study_quality,
      },
    ];
  });
  const previousValves = new Map(
    previous.valve_findings.map((item) => [
      `${item.valve_name}|${item.lesion_type}`,
      item,
    ]),
  );
  for (const item of current.valve_findings) {
    const before = previousValves.get(`${item.valve_name}|${item.lesion_type}`);
    if (before && before.clinician_severity !== item.clinician_severity)
      changes.push({
        code: `valve.${item.valve_name}.${item.lesion_type}`,
        label: `${item.valve_name} ${item.lesion_type}`,
        previous: before.clinician_severity as any,
        current: item.clinician_severity as any,
        unit: "",
        intervalDays: Math.round(
          (new Date(current.performed_at).getTime() -
            new Date(previous.performed_at).getTime()) /
            86_400_000,
        ),
        source: current.source_label,
        quality: current.study_quality,
      });
  }
  return changes;
}

export function displayEchoCode(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
