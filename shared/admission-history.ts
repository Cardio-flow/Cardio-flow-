export const ADMISSION_HISTORY_SOURCES = [
  "Discharge summary",
  "Previous hospital record",
  "Patient-reported history",
  "Other",
] as const;
export type PastAdmissionAnswers = {
  startedOn: string;
  endedOn: string;
  location: string;
  reasons: string[];
  source: string;
  narrative: string;
  note: string;
  events: string[];
  dischargeStatus: string;
  destination: string;
  reportedLabs: string;
  reportedMedications: string;
};
export const emptyPastAdmission = (): PastAdmissionAnswers => ({
  startedOn: "",
  endedOn: "",
  location: "",
  reasons: [],
  source: "",
  narrative: "",
  note: "",
  events: [],
  dischargeStatus: "",
  destination: "",
  reportedLabs: "",
  reportedMedications: "",
});
