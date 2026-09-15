export type Role = "clinician" | "reviewer" | "analyst" | "designer";
export type Session = {
  actor: string;
  role: Role;
  csrf: string;
  email?: string;
};
export type Patient = {
  id: string;
  name: string;
  mrn: string;
  sex: string;
  birth_date: string;
  crf: number;
  enrollment_id: string;
  episode_count: number;
  episodes?: Episode[];
};
export type Stent = { diameter: number; length: number; type: string };
export type Lesion = {
  vessel: string;
  segment: string;
  stenosis: number;
  treatment: string;
  stents: Stent[];
};
export type Episode = {
  id: string;
  enrollment_id: string;
  admission_date: string;
  discharge_date: string | null;
  presentation: string | null;
  access_site: string | null;
  management: string | null;
  discharge_status: string | null;
  state: string;
  version: number;
  form_version: number;
  lesions: Lesion[];
};
export type Task = {
  id: string;
  patient_id: string;
  name: string;
  mrn: string;
  episode_id: string;
  milestone: number;
  due_date: string;
  window_start: string;
  window_end: string;
  display_state: string;
  state: string;
  version: number;
  protocol_version: string;
};
export type Overview = {
  patients: number;
  drafts: number;
  awaiting_review: number;
  reviewed: number;
  episodes: number;
  open_tasks: number;
  overdue: number;
  due: number;
  presentations: { label: string; count: number }[];
  as_of: string;
};
export type Audit = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  created_at: string;
  entity_id: string;
  detail: Record<string, unknown>;
};
