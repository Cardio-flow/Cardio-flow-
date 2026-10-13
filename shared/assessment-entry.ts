// Form mapping only. Verification and reconciliation of clinical facts live on the server.
export const ASSESSMENT_FIELDS = {
  sbp: ["vit", "sbp"],
  dbp: ["vit", "dbp"],
  hr: ["vit", "hr"],
  weight: ["vit", "weight"],
  kccq: ["hfa", "kccq"],
  "6mwd": ["hfa", "6mwd"],
  "dry-weight": ["hfa", "dry-weight"],
  nyha: ["nyha"],
  congestion: ["cong"],
} as const;
export type AssessmentCode = keyof typeof ASSESSMENT_FIELDS;
export const ASSESSMENT_CODES = Object.keys(
  ASSESSMENT_FIELDS,
) as AssessmentCode[];
export type AssessmentAnswers = {
  vit: Record<string, string>;
  hfa: Record<string, string>;
  nyha: string;
  cong: string;
  baselineValues?: Partial<Record<AssessmentCode, string>>;
  baseline?: Partial<Record<AssessmentCode, string | null>>;
};
export function assessmentValue(
  answers: AssessmentAnswers,
  code: AssessmentCode,
): string | undefined {
  const [group, field] = ASSESSMENT_FIELDS[code];
  return field
    ? (answers[group] as Record<string, string> | undefined)?.[field]
    : (answers[group] as string | undefined);
}
export function setAssessmentValue(
  answers: AssessmentAnswers,
  code: AssessmentCode,
  value: string,
) {
  const [group, field] = ASSESSMENT_FIELDS[code];
  if (field) (answers[group] as Record<string, string>)[field] = value;
  else (answers[group] as string) = value;
}
