import type { Finding, RuleDef } from "./rules.js";
import { hypertensionProfile, HTN_INPUTS } from "./hypertension-profile.js";
import { officeHigh, severeBp } from "../../shared/hypertension.js";
import { daysBetween } from "../../shared/clinical.js";
export const urgentBp = (s: import("../kernel/state.js").PatientState) =>
  ["sbp", "dbp"].some((code) => {
    const o = s.resolved(code).current;
    return (
      o?.status === "final" &&
      o.value_num != null &&
      daysBetween(o.effective_at, s.today) >= 0 &&
      daysBetween(o.effective_at, s.today) <= 2 &&
      o.value_num >= (code === "sbp" ? 180 : 110)
    );
  });
const evidence =
  "ESC hypertension 2024, doi:10.1093/eurheartj/ehae178, Table 5/10/13, sections 7.6,8.3,8.5,8.6,9.13; ESC CVD/CKD 2026 doi:10.1093/eurheartj/ehag098 (BP recommendations, official slide 24); Endocrine Society PA 2025 doi:10.1210/clinem/dgaf284, recommendations 1/3. RDN conditional on verified resistance / specialist alternative, eGFR ≥40, exclusion of secondary causes, shared decision and device assessment. 90-day freshness is a workflow limit.";
const finding = (
  key: string,
  signature: string,
  title: string,
  detail: string,
  wizard: string,
  severity: Finding["severity"] = "blue",
  missing: string[] = [],
): Finding => ({
  key,
  signature,
  title,
  detail,
  severity,
  missing,
  facts: [{ label: "Reference", value: "ESC 2024 · Endocrine Society 2025" }],
  action: { type: "wizard", wizard },
});
export const HYPERTENSION_RULES: RuleDef[] = [
  {
    id: "htn.management",
    kind: "clinical",
    title: "Hypertension assessment and treatment",
    inputs: HTN_INPUTS,
    defaultParams: {},
    evidence,
    evaluate(s) {
      if (
        s.patient.age < 18 ||
        s.contexts.some((c) => c.kind === "admission" && c.status === "open")
      )
        return [];
      const h = hypertensionProfile(s);
      if (
        urgentBp(s) ||
        (h.triple &&
          officeHigh(h.office) &&
          h.phenotype !== "White-coat phenotype")
      )
        return [];
      const known = s.tags.has("htn");
      const elevated =
        !!h.office && (h.office.sbp >= 130 || h.office.dbp >= 80);
      if (
        !known &&
        !officeHigh(h.office) &&
        !h.outside?.high &&
        !(elevated && h.highRisk)
      )
        return [];
      const review = s.procedureReviews?.["htn-review"]?.answers;
      if (review?._hypertensionKey === h.key && !severeBp(h.office)) return [];
      return [
        finding(
          "htn-management",
          h.key,
          severeBp(h.office)
            ? "Marked BP elevation: assess acute organ damage"
            : h.phenotype === "White-coat phenotype"
              ? "Office BP elevated: review white-coat effect"
              : h.phenotype === "Masked hypertension"
                ? "Out-of-office BP elevated: review masked hypertension"
                : "Review hypertension confirmation, target and treatment",
          h.office
            ? `Office ${h.office.sbp}/${h.office.dbp} · ${h.phenotype}. Review measurements, cardiovascular risk, tolerance and dated follow-up.`
            : "Hypertension is recorded; current paired BP measurements are missing. Record a standardized BP and confirm out-of-office readings.",
          "htn-review",
          severeBp(h.office)
            ? "red"
            : elevated || h.outside?.high
              ? "orange"
              : "blue",
          !h.office
            ? ["Current paired office BP"]
            : !h.outside?.valid
              ? ["Valid ABPM / HBPM on the current regimen"]
              : [],
        ),
      ];
    },
  },
  {
    id: "htn.resistance",
    kind: "clinical",
    title: "Apparent resistant hypertension",
    inputs: HTN_INPUTS,
    defaultParams: {},
    evidence,
    evaluate(s) {
      const h = hypertensionProfile(s);
      if (
        s.patient.age < 18 ||
        s.contexts.some((c) => c.kind === "admission" && c.status === "open") ||
        urgentBp(s) ||
        !officeHigh(h.office) ||
        !h.triple ||
        h.phenotype === "White-coat phenotype" ||
        h.resistance
      )
        return [];
      return [
        finding(
          "htn-resistance",
          h.key,
          "Possible resistant hypertension: verify before escalation",
          "Confirm technique, adherence, maximally tolerated doses, lifestyle and valid out-of-office BP. Count combination pills by class and investigate secondary causes.",
          "htn-resistance",
          "orange",
          !h.outside?.valid ? ["Valid ABPM / HBPM on current treatment"] : [],
        ),
      ];
    },
  },
  {
    id: "htn.secondary",
    kind: "clinical",
    title: "Secondary hypertension / aldosteronism screening",
    inputs: HTN_INPUTS,
    defaultParams: {},
    evidence,
    evaluate(s) {
      const h = hypertensionProfile(s);
      if (s.patient.age < 18 || !s.tags.has("htn")) return [];
      const review = s.procedureReviews?.["htn-secondary"]?.answers;
      if (review?._hypertensionKey === h.key) return [];
      const suspect = h.secondaryClues.length > 0;
      const paNeeds = !h.pa || !h.pa.reliable || h.pa.result !== "Negative";
      const secondaryNeeds =
        suspect &&
        (!h.secondary ||
          h.secondary.result !== "No secondary cause identified");
      if (!paNeeds && !secondaryNeeds) return [];
      return [
        finding(
          "htn-secondary",
          h.key,
          h.pa?.result === "Positive"
            ? "Positive aldosteronism screen: review and refer"
            : suspect
              ? "Secondary hypertension: targeted screening needed"
              : "Discuss primary aldosteronism screening",
          h.secondaryClues.length
            ? h.secondaryClues.join(" · ") +
                ". Review cause-specific tests and record interpretation."
            : "The 2025 Endocrine Society conditionally suggests screening all hypertensive adults; consider resources and shared decision. Normal potassium does not exclude aldosteronism.",
          "htn-secondary",
          suspect || h.pa?.result === "Positive" ? "orange" : "blue",
        ),
      ];
    },
  },
  {
    id: "htn.rdn",
    kind: "clinical",
    title: "Renal denervation evaluation",
    inputs: HTN_INPUTS,
    defaultParams: {},
    evidence,
    evaluate(s) {
      const h = hypertensionProfile(s);
      if (
        s.patient.age < 18 ||
        h.actual ||
        urgentBp(s) ||
        s.contexts.some((c) => c.kind === "admission" && c.status === "open")
      )
        return [];
      const verified =
        h.resistance &&
        ["technique", "adherence", "doses", "lifestyle"].every(
          (k) => h.resistance![k] === "yes",
        );
      const candidate =
        verified &&
        h.triple &&
        h.resistance?.basis === "resistant" &&
        officeHigh(h.office) &&
        h.outside?.valid &&
        h.outside.high &&
        (h.egfr == null || h.egfr >= 40) &&
        (!h.secondary ||
          h.secondary.result === "Work-up incomplete" ||
          h.secondary.result === "No secondary cause identified") &&
        (!h.pa || (h.pa.reliable && h.pa.result === "Negative"));
      if (!h.rdnEligible && !candidate) return [];
      if (s.procedureReviews?.["rdn-plan"]?.answers._hypertensionKey === h.key)
        return [];
      return [
        finding(
          "htn-rdn",
          h.key,
          h.rdnEligible
            ? "Consider specialist renal denervation assessment"
            : "Resistant hypertension: complete RDN eligibility assessment",
          h.rdnEligible
            ? "Clinical screening met. Review anatomy, device IFU and specialist / patient approval."
            : "Resistance verified. Complete the listed checks before RDN can be considered; scheduling remains blocked.",
          "rdn-plan",
          "blue",
          [
            ...h.rdnMissing,
            ...(!h.anatomy?.suitable
              ? ["Specialist-approved renal artery anatomy / IFU exclusions"]
              : []),
          ],
        ),
      ];
    },
  },
  {
    id: "htn.rdn-aftercare",
    kind: "clinical",
    title: "RDN recovery and response follow-up",
    inputs: HTN_INPUTS,
    defaultParams: {},
    evidence,
    evaluate(s) {
      const h = hypertensionProfile(s);
      if (!h.actual) return [];
      const a = s.procedureReviews?.["after-rdn"]?.answers;
      if (
        a?._procedureId === h.actual.id &&
        a.safety === "stable" &&
        a.meds === "yes" &&
        a.education === "yes"
      )
        return [];
      return [
        finding(
          "htn-rdn-care",
          h.actual.id,
          "RDN: review recovery, medicines and BP response",
          "Record recovery, renal / access complications, continued BP therapy and dated out-of-office BP and specialist follow-up.",
          "after-rdn",
        ),
      ];
    },
  },
];
