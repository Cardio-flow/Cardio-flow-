// Pulmonary hypertension rules (PH module). 2022 ESC/ERS PH guidelines: the echo probability of PH from
// the peak TR velocity (threshold >2.8 m/s, I C) and the additional signs; referral to a PH centre for an
// intermediate or high probability with risk factors for PAH or a history of pulmonary embolism (I C).
import { fmtDay } from "../../shared/clinical.js";
import { PROBABILITY_LABEL } from "../../shared/ph.js";
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
];
