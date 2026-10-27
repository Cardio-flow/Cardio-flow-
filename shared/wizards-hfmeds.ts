// HF medicines: start and titrate (27 Oct 2026, Ahmed: "the drug dose engines and their needed information
// should be in the pathways"). One decision across the foundational pillars, read from the same engine the HF
// alerts use (server guidelines.ts gdmtPlan: starting doses from shared/start-doses.ts, targets and next dose
// steps from the catalogue, gates on K, eGFR, SBP, HR, creatinine trend, recent change and the labs after it).
// Every change is proposed with its dose and reason; the clinician ticks what is done today. The checks the
// product labels give after a start or increase are booked (shared/drug-monitoring.ts), with the next
// titration visit.
import { addDays } from "./clinical.js";
import { MEDICATION } from "./catalog.js";
import { bookingsAtStart } from "./drug-monitoring.js";
import type { OutcomeItem, WizardContext, WizardDef } from "./wizards.js";

export type HfMedsItem = {
  key: string; label: string;
  med: { id: string; code: string; name: string; dose: number | null; line: string; target: string | null; pct: number | null } | null;
  state: "start" | "increase" | "target" | "blocked" | "needs" | "wait" | "held" | "declined" | "no-step";
  change: { kind: "start"; code: string; dose: number; frequency: string; label: string } | { kind: "increase"; medicationId: string; from: number; to: number; label: string } | null;
  why: string; unlock: string | null; needs: string[];
};
export type HfMedsContext = { phenotype: "HFrEF" | "HFpEF"; congested: string | null; items: HfMedsItem[] };

export const hfChanges = (ctx: WizardContext) => (ctx.hfMeds?.items ?? []).filter((i) => i.change);
export const changeValue = (i: HfMedsItem) => `${i.change!.kind}-${i.key}`;

export const HFMEDS_WIZARDS: Record<string, WizardDef> = {
  "hf-medicines": {
    group: "Heart failure",
    id: "hf-medicines",
    title: "HF medicines: start and titrate",
    shortTitle: "HF medicines",
    tone: "orange",
    episode: false,
    note: "Each pillar is read from the record: what can be started or increased today with its dose, what stops it and which results are missing. Nothing changes until you confirm; the label's checks and the next titration visit are booked.",
    source: "ESC HF 2026 (foundational therapy, uptitration every 1–2 weeks, class I) · product labels (SmPC) for starting doses and monitoring",
    sourceShort: "ESC HF 2026 · SmPC",
    facts: ["potassium", "egfr", "sbp", "hr"],
    steps: [
      {
        id: "plan",
        title: "Medicines",
        questions: [
          // the superset of changes; optionsFor keeps those the engine allows today, with the drug and dose
          {
            id: "changes", label: "Changes today", type: "multi", required: true, optionsFrom: "hfChanges", exclusive: ["none"],
            options: [
              { value: "start-raas", label: "Start ARNI / ACE inhibitor / ARB" }, { value: "increase-raas", label: "Increase ARNI / ACE inhibitor / ARB" },
              { value: "start-bb", label: "Start beta-blocker" }, { value: "increase-bb", label: "Increase beta-blocker" },
              { value: "start-mra", label: "Start MRA" }, { value: "increase-mra", label: "Increase MRA" },
              { value: "start-sglt2", label: "Start SGLT2 inhibitor" },
              { value: "none", label: "No change today" },
            ],
          },
          {
            id: "next", label: "Next titration visit", type: "single", required: true,
            help: "ESC HF: uptitrate every 1–2 weeks to the target or maximally tolerated dose",
            options: [
              { value: "7", label: "In 1 week" },
              { value: "14", label: "In 2 weeks" },
              { value: "none", label: "No titration visit (at target or not increasing)" },
            ],
          },
        ],
      },
    ],
    checks: (a, ctx) => [
      ...(["raas", "mra"].every((k) => ((a.changes as string[] | undefined) ?? []).some((v) => v.endsWith(`-${k}`)))
        ? ["RAAS inhibitor and MRA changed together: both raise potassium — confirm both today or step one at a time"] : []),
      ...(ctx.hfMeds?.congested ? [`Congested (${ctx.hfMeds.congested}): increases wait until euvolaemic; the congestion pathway comes first`] : []),
      ...(ctx.hfMeds?.items ?? []).filter((i) => !i.change && ["blocked", "needs", "wait", "held", "no-step"].includes(i.state))
        .map((i) => `${i.label}${i.med ? ` (${i.med.line})` : ""}: ${i.why}${i.unlock ? ` — ${i.unlock}` : ""}`),
    ],
    outcome: (a, ctx) => hfMedsOutcome(a, ctx),
  },
};

export function hfMedsOutcome(a: Record<string, unknown>, ctx: WizardContext): OutcomeItem[] {
  const chosen = new Set(((a.changes as string[] | undefined) ?? []).filter((v) => v !== "none"));
  const out: OutcomeItem[] = [];
  const changed: { code: string; tags: string[] }[] = [];
  for (const i of hfChanges(ctx)) {
    if (!chosen.has(changeValue(i))) continue;
    const c = i.change!;
    if (c.kind === "start") {
      out.push({ kind: "start", code: c.code, doseValue: c.dose, frequency: c.frequency, indication: "hf", label: `${c.label} — ${i.why}` });
      changed.push({ code: c.code, tags: MEDICATION[c.code]?.tags ?? [] });
    } else {
      out.push({ kind: "medication", medicationId: c.medicationId, event: "increase", doseValue: c.to, label: `${c.label} — ${i.why}` });
      changed.push({ code: i.med!.code, tags: MEDICATION[i.med!.code]?.tags ?? [] });
    }
  }
  // the label checks after each start or increase, one plan item per test and day
  const egfr = ctx.values?.egfr?.value ?? null;
  const seen = new Set<string>();
  for (const m of changed)
    for (const b of bookingsAtStart(m.code, m.tags, { age: ctx.profile?.age ?? 0, crcl: null, egfr, lvef: ctx.values?.lvef?.value ?? null, hf: true, acs: false, daysOnDrug: 0, daysSinceChange: 0 })) {
      if (b.days > 31 || !("lab" in b.check.target)) continue; // the first checks; later ones follow the medicine's schedule
      const key = `${b.check.target.lab.join(",")}:${b.days}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // the interval is in the title: due dates are edited per title, so two checks never share one
      const when = b.days === 30 ? "1 month" : b.days % 7 === 0 ? `${b.days / 7} week${b.days === 7 ? "" : "s"}` : `${b.days} days`;
      out.push({ kind: "plan", category: "monitoring", title: `${b.check.what} ${when} after the HF medicine change`, dueDate: addDays(ctx.today, b.days), completesOn: { type: "lab", codes: b.check.target.lab }, label: `${b.check.what}: ${b.check.schedule} (${b.check.source})` });
    }
  // checks in date order
  const firstPlan = out.findIndex((o) => o.kind === "plan");
  if (firstPlan >= 0) out.splice(firstPlan, out.length - firstPlan, ...out.slice(firstPlan).sort((x, y) => (x.kind === "plan" && y.kind === "plan" ? x.dueDate.localeCompare(y.dueDate) : 0)));
  if (a.next === "7" || a.next === "14")
    out.push({ kind: "plan", category: "follow_up", title: "HF medicines titration visit", dueDate: addDays(ctx.today, Number(a.next)), completesOn: { type: "manual" }, label: "" });
  if (!chosen.size) out.push({ kind: "note", label: "No HF medicine change today", decision: true });
  return out;
}
