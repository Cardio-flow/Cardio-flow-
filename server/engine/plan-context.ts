import type { PatientState, PlanRow } from "../kernel/state.js";
import { problemOfRule, problemOfWizard } from "../../shared/overview.js";

// Follow the recorded decision links, including reused bookings. Never infer
// clinical ownership or priority from free text, a red parent alert or today's vitals.
export function planContext(s: PatientState, p: PlanRow) {
  const sources = p.decision_sources ?? [];
  const source = sources.find((d) => d.id === p.decision_id) ?? sources[0];
  const episode = s.episodes.find(
    (e) =>
      e.status === "open" &&
      e.decisions.some(
        (d) => d.id === p.decision_id || (p.decision_refs ?? []).includes(d.id),
      ),
  );
  const wizard = source?.wizard ?? episode?.wizard;
  const fromRule = source?.ruleId ? problemOfRule(source.ruleId) : "other";
  const problem =
    fromRule !== "other" ? fromRule : problemOfWizard(wizard ?? "");
  // These existing urgent branches produce only the same-day assessment action.
  // Routine follow-up from a red finding must not inherit urgency.
  const urgent =
    p.completes_on?.purpose === "pregnancy-urgent" ||
    p.completes_on?.purpose === "hyperkalaemia-urgent" ||
    (p.title === "Same-day urgent assessment" && sources.some(d=>d.wizard === "hyperkalaemia" && Array.isArray(d.answers?.actions) && d.answers.actions.includes("urgent"))) ||
    sources.some(
      (d) =>
        (d.wizard === "pregnancy-plan" && d.answers?.safety === "urgent") ||
        (d.wizard === "syncope" && d.answers?.disposition === "urgent") ||
        (d.wizard === "aorta-plan" && d.answers?.strategy === "urgent") ||
        (d.wizard === "pericarditis" && d.answers?.route === "urgent") ||
        (d.wizard === "after-rdn" && d.answers?.safety === "urgent") ||
        (d.wizard === "htn-review" &&
          ["pregnancy", "urgent"].includes(String(d.answers?.safety))),
    );
  return {
    problem,
    wizard: wizard ?? null,
    episodeId: episode?.id ?? null,
    urgent,
  };
}
