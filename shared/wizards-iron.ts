// IV iron in heart failure (14 Oct 2026, Ahmed: "when it decides IV iron with HF, Ferinject suggestion with
// the doses and suggested dates to apply and points to check before apply it").
//
// Indication: ESC HF 2023 focused update (retained 2026) — IV iron (ferric carboxymaltose or ferric
// derisomaltose) in symptomatic HFrEF/HFmrEF with iron deficiency (ferritin <100 ng/mL, or 100–299 with
// TSAT <20%), IIa; benefit in HFpEF not established.
// Dose: Ferinject SmPC 4.2 (emc, rev. 22 May 2025), Table 1 — total iron need by haemoglobin and weight:
//   Hb <10 g/dL: 35–<70 kg 1500 mg, ≥70 kg 2000 mg · Hb 10–<14: 1000 mg / 1500 mg · Hb ≥14: 500 mg / 500 mg
//   (below 35 kg the need is per kg: not calculated here). A single infusion ≤20 mg/kg and ≤1000 mg; at most
//   1000 mg a week, so further doses ≥7 days apart. Haemodialysis: 200 mg/day maximum (not calculated here).
// Checks: SmPC 4.3/4.4 — no hypersensitivity to IV iron, iron deficiency confirmed as the cause of anaemia,
//   caution with infection (stop with ongoing bacteraemia), staff and facilities for anaphylaxis, observe
//   ≥30 minutes after each dose, phosphate monitoring with repeated high doses or risk factors (symptomatic
//   hypophosphataemia), pregnancy: only if clearly necessary, not the first trimester.
// Reassessment: Hb no earlier than 4 weeks after the last dose (SmPC 4.2); in the HF trials iron status was
//   reassessed and the dose repeated if iron deficiency persisted (CONFIRM-HF at week 12; AFFIRM-AHF weeks 6/12).
import type { OutcomeItem, WizardContext, WizardDef } from "./wizards.js";
import { addDays, fmtDay } from "./clinical.js";

export const IRON_PRODUCT = "ferric-carboxymaltose";

// Ferinject SmPC Table 1 and the per-infusion limit; null when it cannot be calculated from the label table
export function ferinjectPlan(hb: number | null, weight: number | null): { total: number; doses: number[]; why: string } | null {
  if (hb == null || weight == null || weight < 35) return null;
  const heavy = weight >= 70;
  const total = hb < 10 ? (heavy ? 2000 : 1500) : hb < 14 ? (heavy ? 1500 : 1000) : 500;
  // ≤20 mg/kg and ≤1000 mg per infusion (rounded down to 50 mg), ≥7 days apart
  const per = Math.min(1000, Math.floor((20 * weight) / 50) * 50);
  const doses: number[] = [];
  for (let left = total; left > 0; left -= per) doses.push(Math.min(per, left));
  const why = `Hb ${hb} g/dL and weight ${weight} kg: total iron need ${total} mg (Ferinject SmPC Table 1); at most ${per} mg per infusion (≤20 mg/kg, ≤1000 mg) and doses ≥7 days apart`;
  return { total, doses, why };
}

export const IRON_CHECKS = [
  { value: "no-reaction", label: "No previous serious reaction to IV iron" },
  { value: "no-infection", label: "No active infection or bacteraemia" },
  { value: "cause", label: "Anaemia (if any) is from iron deficiency; source of iron loss considered" },
  { value: "not-pregnant", label: "Not pregnant (or past the first trimester with obstetric agreement)" },
  { value: "facility", label: "Given where anaphylaxis can be managed; observed ≥30 min after each dose" },
] as const;

export const IRON_WIZARDS: Record<string, WizardDef> = {
  "iv-iron": {
    group: "Heart failure",
    id: "iv-iron",
    title: "IV iron for iron deficiency in heart failure",
    shortTitle: "IV iron",
    tone: "orange",
    note: "The total dose comes from the latest haemoglobin and weight (Ferinject label table). Each infusion is recorded as a dated plan item; nothing is given automatically.",
    source: "ESC HF 2023 focused update (IV iron, IIa) · Ferinject (ferric carboxymaltose) SmPC 4.2–4.4",
    sourceShort: "ESC HF 2023 · Ferinject SmPC",
    steps: [
      {
        id: "decision",
        title: "Decision",
        questions: [
          {
            id: "decision", label: "IV iron", type: "single", required: true,
            options: [
              { value: "give", label: "Give IV iron (ferric carboxymaltose)" },
              { value: "defer", label: "Not now (a check is not met)" },
              { value: "oral", label: "Look for the cause first / not indicated" },
            ],
          },
          {
            id: "checks", label: "Before the first infusion", help: "Confirm each point (Ferinject SmPC 4.3/4.4)", type: "multi", required: true,
            showIf: { question: "decision", includes: "give" },
            options: IRON_CHECKS.map((c) => ({ ...c })),
          },
          {
            id: "start", label: "First infusion", type: "single", required: true,
            showIf: { question: "decision", includes: "give" },
            options: [
              { value: "0", label: "Today" },
              { value: "3", label: "In 3 days" },
              { value: "7", label: "In 1 week" },
              { value: "14", label: "In 2 weeks" },
            ],
          },
        ],
      },
    ],
    outcome: (a, ctx) => ironOutcome(a, ctx),
  },
};

export function ironInputs(ctx: WizardContext) {
  const hb = ctx.values?.haemoglobin ?? null, wt = ctx.values?.weight ?? null;
  const recent = (x: { at: string } | null, days: number) => !!x && (Date.parse(ctx.today) - Date.parse(x.at.slice(0, 10))) / 86400000 <= days;
  return { hb: recent(hb, 90) ? hb!.value : null, hbAt: hb?.at ?? null, weight: recent(wt, 365) ? wt!.value : null, weightAt: wt?.at ?? null };
}

export function ironOutcome(a: Record<string, unknown>, ctx: WizardContext): OutcomeItem[] {
  if (a.decision !== "give") return a.decision === "defer" ? [{ kind: "note", label: "IV iron deferred: a pre-infusion check was not met" }] : [];
  const { hb, weight } = ironInputs(ctx);
  const p = ferinjectPlan(hb, weight);
  if (!p) return [{ kind: "note", label: "Record a haemoglobin (last 3 months) and the weight to calculate the dose" }];
  const start = Number(a.start ?? 0);
  const out: OutcomeItem[] = p.doses.map((d, i) => ({
    kind: "plan", category: "medication", title: `Ferric carboxymaltose (Ferinject) ${d} mg IV infusion${p.doses.length > 1 ? ` — ${i + 1} of ${p.doses.length}` : ""}`,
    dueDate: addDays(ctx.today, start + 7 * i), completesOn: { type: "manual" }, label: "",
  }));
  const last = start + 7 * (p.doses.length - 1);
  out.push({
    kind: "plan", category: "monitoring", title: "Haemoglobin, ferritin, TSAT and phosphate after IV iron",
    dueDate: addDays(ctx.today, Math.max(last + 28, start + 84)), completesOn: { type: "lab", codes: ["haemoglobin", "ferritin", "tsat"] }, label: "",
  });
  out.push({ kind: "note", label: `${p.why}. Recheck Hb ≥4 weeks after the last dose (SmPC) and iron status at about 12 weeks (CONFIRM-HF); repeat if still iron deficient` });
  return out;
}

export const ironWhen = (d: string) => fmtDay(d, { weekday: true, year: true });
