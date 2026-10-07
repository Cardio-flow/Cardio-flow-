// The latest non-invasive coronary test and the decision it calls for (7 Oct 2026). Risk classes are the
// guideline's own (ESC CCS 2024, Rec. Table 14; shared/ccs-tests.ts).
import { localDay } from "../../shared/clinical.js";
import { ccsTestRisk, CCS_TEST_KINDS } from "../../shared/ccs-tests.js";
import { STUDY_LABEL, studySummary } from "../../shared/studies.js";
import type { PatientState } from "../kernel/state.js";
import type { RuleDef } from "./rules.js";

export function latestCcsTest(s: PatientState) {
  const st = [...s.studies].reverse().find((x) => (CCS_TEST_KINDS as readonly string[]).includes(x.kind) && ccsTestRisk(x.kind, x.attributes ?? {}));
  if (!st) return null;
  const r = ccsTestRisk(st.kind, st.attributes ?? {})!;
  return { id: st.id, kind: st.kind, label: STUDY_LABEL[st.kind] ?? st.kind, at: localDay(st.performed_at), summary: studySummary(st.kind, st.attributes ?? {}), risk: r.risk, why: r.why, ccta: st.kind === "ccta" };
}

export const CAD_TEST_RULES: RuleDef[] = [
  {
    id: "cad.test-result",
    kind: "clinical",
    title: "Non-invasive coronary test result needs a decision",
    inputs: ["studies", "procedures", "pathways", "plan"],
    defaultParams: {},
    evidence:
      "2024 ESC CCS: high event risk on non-invasive testing (Rec. Table 14, I B) → revascularisation recommended (Rec. Table 22, I B) after ICA with functional assessment; uncertain non-invasive result → ICA with invasive functional assessment (Rec. Table 11, I B); positive, not high risk → medical therapy, revascularisation if angina persists. Shown for a test in the last 12 months until the pathway is completed, an angiography or revascularisation follows, or an angiography is planned.",
    evaluate(s) {
      const t = latestCcsTest(s);
      if (!t || t.risk === "negative") return [];
      const daysOld = (Date.parse(s.today) - Date.parse(t.at)) / 864e5;
      if (daysOld > 365) return [];
      const after = (d: string) => localDay(d) >= t.at;
      if (s.studies.some((x) => x.kind === "cath" && after(x.performed_at))) return [];
      if (s.procedures.some((p) => (p.kind === "pci" || p.kind === "cabg") && after(p.performed_at))) return [];
      if (s.pathwaysDone["ccs-test-result"] && localDay(s.pathwaysDone["ccs-test-result"]) >= t.at) return [];
      if (s.plan.some((p) => p.status === "planned" && /coronary angiography/i.test(p.title))) return [];
      const title =
        t.risk === "high" ? `${t.label}: high-risk result — invasive angiography with a view to revascularisation`
        : t.risk === "uncertain" ? `${t.label}: uncertain result — decide the next test`
        : `${t.label}: ischaemia / obstructive disease — plan management`;
      return [{
        key: "test", signature: t.id, severity: t.risk === "high" ? "orange" : "yellow",
        title,
        detail: t.why,
        facts: [{ label: "Test", value: `${t.label}${t.summary ? ` · ${t.summary}` : ""}`, date: t.at }, { label: "Guideline", value: "ESC CCS 2024" }],
        missing: [], action: { type: "wizard", wizard: "ccs-test-result" },
      }];
    },
  },
];
