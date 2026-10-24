import { resistantMraEligible } from "./hypertension.js";
import { addDays } from "./clinical.js";
import { WIZARDS, buildOutcome, doseChoices, visibleQuestions, type Answers, type WizardContext } from "./wizards.js";

// Shared by both previews and the write boundary. Reminder text cannot substitute
// for a decision-changing fact, and manually changed dates cannot defer emergency care.
export function decisionBlocker(id: string, a: Answers, c: WizardContext, dates: Record<string,string> = {}): string | null {
  for(const q of WIZARDS[id].steps.flatMap(st=>visibleQuestions(st,a)).filter(q=>q.type === "dose")) {
    if(a[q.id] == null || a[q.id] === "") continue;
    if(!doseChoices(c,q).options.some(o=>Number(o.value) === Number(a[q.id])))
      return `${q.label}: choose a supported dose for the current active regimen`;
  }
  const out = buildOutcome(id,a,c,dates);
  for (const o of out) {
    if(o.kind !== "medication" || !["increase","decrease"].includes(o.event)) continue;
    const m = c.meds.find(m=>m.id === o.medicationId);
    if(!m || m.status && m.status !== "active" || m.doseValue == null || !m.frequency)
      return "Confirm the active medicine, current dose and frequency before changing its dose";
  }
  if(id === "htn-resistance" && a.treatment === "mra" && !resistantMraEligible(a,c)) return "Confirm resistant hypertension, current eGFR ≥30 and K ≤4.5, adherence and maximally tolerated doses before adding spironolactone";
  if(id !== "hyperkalaemia") return null;
  const k = c.values?.potassium?.value;
  if(k == null) return "Record potassium before confirming this decision";
  const acts = (a.actions as string[] | undefined) ?? [];
  const urgent = k >= 6.5 || a.ecg === "present" || k >= 6 && (a.symptoms as string[] | undefined)?.some(v=>v!=="none");
  if(urgent && !acts.includes("urgent")) return "This potassium/ECG/symptom combination requires same-day urgent assessment";
  if(urgent && out.some(o=>o.kind === "start" && ["patiromer","sodium-zirconium-cyclosilicate"].includes(o.code)))
    return "Confirm urgent hospital treatment first; a maintenance binder must not replace emergency treatment";
  if(acts.includes("binder") && acts.includes("binder-szc")) return "Choose one potassium binder";
  if(acts.includes("continue") && acts.some(v=>/^(reduce|hold)-(mra|raas)$/.test(v))) return "Choose either unchanged therapy or the specific dose changes";
  const maxDays = a.result === "repeat" || a.haemolysis === "yes" || urgent ? 0 : k >= 6 ? 1 : k >= 5.5 ? 3 : null;
  const rechecks = out.filter(o=>o.kind === "plan" && o.completesOn.type === "lab" && (o.completesOn.codes as string[]|undefined)?.includes("potassium"));
  if(maxDays != null && !rechecks.some(o=>o.kind === "plan" && o.dueDate >= c.today && o.dueDate <= addDays(c.today,maxDays)))
    return `Book potassium reassessment by ${addDays(c.today,maxDays)} (UKKA hyperkalaemia guidance)`;
  if(urgent && out.some(o=>o.kind === "plan" && o.title === "Same-day urgent assessment" && o.dueDate !== c.today))
    return "Urgent hyperkalaemia assessment must be today";
  return null;
}
