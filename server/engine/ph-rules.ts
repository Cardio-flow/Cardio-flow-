// Pulmonary hypertension rules (PH module). 2022 ESC/ERS PH guidelines: the echo probability of PH from
// the peak TR velocity (threshold >2.8 m/s, I C) and the additional signs; referral to a PH centre for an
// intermediate or high probability with risk factors for PAH or a history of pulmonary embolism (I C).
import { fmtDay } from "../../shared/clinical.js";
import { PROBABILITY_LABEL, STRATA_LABEL, fourStrata } from "../../shared/ph.js";
import { daysBetween, localDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
import { latestPhEcho } from "./ph-profile.js";

const SRC = "ESC/ERS pulmonary hypertension 2022";
const planned = (s: PatientState, re: RegExp) => s.plan.some((p) => p.status === "planned" && re.test(p.title));

export const PH_RULES: RuleDef[] = [
  {
    id: "ph.echo-probability",
    kind: "clinical",
    title: "Intermediate or high echo probability of pulmonary hypertension",
    inputs: ["trv", "studies", "conditions", "plan"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines: echocardiographic probability from the peak TR velocity (>2.8 m/s, I C) and signs in three categories (ventricles, pulmonary artery, IVC/RA): intermediate = TRV ≤2.8 m/s with signs from ≥2 categories or 2.9–3.4 m/s without; high = 2.9–3.4 m/s with signs from ≥2 categories or >3.4 m/s. Referral to a PH centre for intermediate/high probability with risk factors for PAH or a history of pulmonary embolism (I C). Quiet once PH has been characterised by right heart catheterisation or a referral is planned.",
    evaluate(s) {
      const e = latestPhEcho(s);
      if (!e || e.probability === "low") return [];
      const ph = s.conditions.find((c) => c.code === "ph" && c.status === "active");
      if ((ph?.attributes?.haemo && ph.attributes.haemo !== "Not catheterised") || planned(s, /right heart cath|PH centre/i)) return [];
      const high = e.probability === "high";
      return [{
        key: `ph-${e.probability}`, signature: e.id, severity: high ? "orange" : "yellow",
        title: `${PROBABILITY_LABEL[e.probability]} echo probability of pulmonary hypertension${e.trv != null ? ` (TRV ${e.trv} m/s)` : ""}`,
        detail: `${high ? "Pulmonary hypertension is likely" : "Pulmonary hypertension is possible"}: look for left heart and lung disease, and refer to a PH centre for right heart catheterisation with risk factors for PAH or a history of pulmonary embolism (I C).`,
        facts: [
          { label: "Echo", value: fmtDay(e.at, { year: true }) },
          { label: "TR velocity", value: e.trv != null ? `${e.trv} m/s` : "Not measured" },
          { label: "Other signs", value: e.categories.length ? `${e.signs.length} sign${e.signs.length > 1 ? "s" : ""} in ${e.categories.length} categor${e.categories.length > 1 ? "ies" : "y"}` : "None recorded" },
          { label: "Guideline", value: `${SRC} · I C` },
        ],
        missing: [], action: { type: "add-plan", template: "ph-referral" },
      } as Finding];
    },
  },
  {
    id: "ph.pah-risk",
    kind: "clinical",
    title: "PAH: four-strata risk assessment every 3–6 months",
    inputs: ["conditions", "nyha", "6mwd", "nt-probnp", "pathways", "plan"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines: at follow-up, PAH risk by the four-strata model (functional class, 6-minute walk distance, BNP/NT-proBNP); treatment goal low risk; reassessment every 3–6 months. Due when PAH is listed and no PAH risk pathway in the last 6 months (the outer limit); orange when the record-based category is intermediate-high or high.",
    evaluate(s) {
      const ph = s.conditions.find((c) => c.code === "ph" && c.status === "active" && c.attributes?.group === "Group 1 · PAH");
      if (!ph) return [];
      const done = s.pathwaysDone["pah-followup"];
      if ((done && daysBetween(localDay(done), s.today) <= 182) || planned(s, /PAH: risk/i)) return [];
      const r = fourStrata({ fc: s.resolved("nyha").current?.value_text ?? null, sixmwd: s.resolved("6mwd").current?.value_num ?? null, ntprobnp: s.resolved("nt-probnp").current?.value_num ?? null });
      const bad = r.category === "intermediate-high" || r.category === "high";
      return [{
        key: "pah-risk", signature: `${done ?? "never"}:${r.category ?? "-"}`, severity: bad ? "orange" : "yellow",
        title: r.category ? `PAH: ${STRATA_LABEL[r.category].toLowerCase()} risk on the latest values — review therapy (goal: low risk)` : "PAH: four-strata risk assessment due",
        detail: r.category ? `Four-strata mean ${r.mean} (${r.items.map((i) => `${i.label === "NT-proBNP" ? i.label : i.label.toLowerCase()} ${i.value}`).join(", ")}). Reassess every 3–6 months; escalate therapy until low risk.` : "Functional class, 6-minute walk and NT-proBNP every 3–6 months; goal low risk.",
        facts: [{ label: "Last assessment", value: done ? fmtDay(done, { year: true }) : "None" }, { label: "Guideline", value: SRC }],
        missing: r.missing, action: { type: "wizard", wizard: "pah-followup" },
      } as Finding];
    },
  },
];
