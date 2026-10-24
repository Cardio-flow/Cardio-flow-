import { isRoutinePlan } from "./routine.js";
import type { OutcomeItem } from "./wizards.js";

// The same prioritisation is used by every pathway and the overview preview.
// Acute management, prescriptions and follow-up stay visible; exact preventive
// templates remain confirmable inside one collapsed section.
export const routineDecisionItem = (item: OutcomeItem) => item.kind === "plan" && isRoutinePlan(item);
export function prioritiseDecision(items: OutcomeItem[]): OutcomeItem[] {
  const rank: Record<OutcomeItem["kind"],number> = { medication:0,start:0,condition:1,barrier:1,plan:2,note:3 };
  return [...items].sort((a,b) => Number(routineDecisionItem(a)) - Number(routineDecisionItem(b)) || (a.kind === "note" && a.decision ? 1 : rank[a.kind]) - (b.kind === "note" && b.decision ? 1 : rank[b.kind]));
}
