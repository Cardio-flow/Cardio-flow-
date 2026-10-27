import { isRoutine, isRoutinePlan } from "./routine.js";
// Display ownership only; clinical urgency comes from the server.
export const problemOfRule = (ruleId: string): string => {
  if (
    [
      "hf.hyperkalaemia-review",
      "hf.worsening-renal-function",
      "safety.low-potassium",
      "safety.hyponatraemia",
      "ops.monitoring-after-change",
    ].includes(ruleId) ||
    ruleId.startsWith("cardiorenal.")
  )
    return "kidney";
  if (
    [
      "lab.anaemia",
      "lab.iron-deficiency",
      "hf.iron-deficiency",
      "safety.bleeding",
    ].includes(ruleId)
  )
    return "anaemia";
  if (ruleId.startsWith("med.") || ruleId === "meds.not-taking")
    return "medication";
  if (ruleId.startsWith("pregnancy.")) return "pregnancy";
  if (ruleId.startsWith("aorta.")) return "aorta";
  if (ruleId === "event.pericarditis") return "pericardial";
  if (ruleId === "event.syncope") return "syncope";
  // an event rule belongs where its pathway belongs (27 Oct 2026 audit: ICD shocks were filed under "Other alerts")
  if (ruleId.startsWith("event.") && problemOfWizard(ruleId.slice(6)) !== "other") return problemOfWizard(ruleId.slice(6));
  if (
    ["safety.inr", "safety.digoxin", "event.amiodarone-thyroid"].includes(
      ruleId,
    )
  )
    return "af";
  if (["lab.liver-enzymes", "lab.statin-ck"].includes(ruleId)) return "lipids";
  if (ruleId.startsWith("hf.")) return "hf";
  if (ruleId.startsWith("htn.")) return "bp";
  if (ruleId.startsWith("lipids.")) return "lipids";
  if (ruleId.startsWith("dm.") || ruleId.startsWith("metabolic."))
    return "diabetes";
  if (ruleId.startsWith("af.") || ruleId.startsWith("rhythm.")) return "af";
  if (ruleId.startsWith("cad.") || ruleId.startsWith("acs.")) return "cad";
  if (ruleId.startsWith("valve.") || ruleId.startsWith("structural."))
    return "valve";
  if (ruleId.startsWith("cmp.")) return "cmp";
  if (ruleId.startsWith("ph.")) return "ph";
  return "other";
};

export const problemOfWizard = (id: string): string => {
  const named: Record<string, string> = {
    "pregnancy-plan": "pregnancy",
    pericarditis: "pericardial",
    "aorta-plan": "aorta",
    syncope: "syncope",
    diabetes: "diabetes",
    "sick-day": "diabetes",
    ramadan: "diabetes",
    "chest-infection": "infection",
    infection: "infection",
    endocarditis: "infection",
    hyperkalaemia: "kidney",
    "renal-function": "kidney",
    "low-potassium": "kidney",
    hyponatraemia: "kidney",
    "anaemia-result": "anaemia",
    "iv-iron": "anaemia",
    bleeding: "anaemia",
    antithrombotic: "cad",
    congestion: "hf",
    hypotension: "hf",
    lipids: "lipids",
    "liver-result": "lipids",
    "statin-ck-result": "lipids",
    hyperglycaemia: "diabetes",
    hypoglycaemia: "diabetes",
    sepsis: "infection",
    bradycardia: "af",
    inr: "af",
    digoxin: "af",
    "amiodarone-thyroid": "af",
    "icd-shock": "af",
    "after-device": "af",
    "peri-af-procedure": "af",
    "severe-hypertension": "bp",
    "chest-pain-cad": "cad",
    "acs-discharge": "cad",
    "after-cabg": "cad",
    "ccs-test-result": "cad",
    "suspected-ihd": "cad",
    "prosthetic-valve": "valve",
    "hcm-scd": "cmp",
    "hcm-lvoto": "cmp",
    "cmp-family": "cmp",
    myocarditis: "cmp",
    "pah-followup": "ph",
    "post-pe": "ph",
    "ph-lhd-lung": "ph",
    "ph-suspected": "ph",
    "medication-monitoring": "medication",
    "hf-medicines": "hf",
  };
  if (named[id]) return named[id];
  if (/^(htn-|rdn-|after-rdn)/.test(id)) return "bp";
  if (/^(af-|after-af|laao|after-laao|rhythm|device)/.test(id)) return "af";
  if (/^(valve-|tavi-|teer-|other-structural|after-structural)/.test(id))
    return "valve";
  return "other";
};

// A pathway is one decision even when several findings lead to it. Dated work and
// evidence awaiting review are distinct from decisions and from tests not yet booked.
export function overviewCounts(attention: any[], plan: any[]) {
  const flatten = (items: any[]): any[] =>
    items.flatMap((a) => [a, ...flatten(a.children ?? [])]);
  const all = flatten(attention).filter(a=>!isRoutine(a));
  plan = plan.filter(p=>!isRoutinePlan(p));
  const decisions = new Set(
    all
      .filter((a) => a.action && !["plan", "add-labs"].includes(a.action.type))
      .map((a) =>
        a.action.type === "wizard" ? `wizard:${a.action.wizard}` : a.id,
      ),
  );
  return {
    urgent: all.filter((a) => a.severity === "red").length,
    decisions: decisions.size,
    tasks: plan.filter((p) => p.view === "due" || p.view === "overdue").length,
    review: plan.filter((p) => p.awaitingReview).length,
  };
}
