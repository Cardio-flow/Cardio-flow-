import { bookingsAtStart, type MonContext } from "./drug-monitoring.js";
import { MEDICATION } from "./catalog.js";
import { addDays, cockcroftGault } from "./clinical.js";
import type { OutcomeItem, WizardContext } from "./wizards.js";

// The same label/guideline schedules used by the medication drawer belong in
// the pathway preview too, and are saved in its existing atomic transaction.
export function withMedicationMonitoring(
  items: OutcomeItem[],
  ctx: WizardContext,
): OutcomeItem[] {
  const out = [...items];
  const value = (code: string) => ctx.values?.[code]?.value ?? null;
  const age = ctx.profile?.age ?? 0,
    weight = value("weight"),
    cr = value("creatinine");
  const context: MonContext = {
    age,
    crcl:
      age && weight && cr && ctx.profile?.sex
        ? cockcroftGault(cr, age, weight, ctx.profile.sex)
        : null,
    egfr: value("egfr"),
    lvef: value("lvef"),
    hf: (ctx.dx ?? []).some((d) =>
      ["hf", "hfref", "hfmref", "hfpef", "hfimpef"].includes(d),
    ),
    acs: !!ctx.coronary?.acs,
    daysOnDrug: 0,
    daysSinceChange: 0,
  };
  for (const item of items) {
    const start = item.kind === "start";
    const med =
      item.kind === "medication"
        ? ctx.meds.find((m) => m.id === item.medicationId)
        : null;
    if (
      !start &&
      !(item.kind === "medication" && item.event === "increase" && med)
    )
      continue;
    const code = start ? item.code : med!.code,
      def = MEDICATION[code];
    if (
      !def ||
      (start &&
        ctx.meds.some(
          (m) =>
            m.code === code &&
            (!m.status || ["active", "held"].includes(m.status)),
        ))
    )
      continue;
    for (const { check, days } of bookingsAtStart(code, def.tags, context)) {
      if (!start && check.on !== "change") continue;
      const dueDate = addDays(ctx.today, days);
      const completesOn =
        "lab" in check.target
          ? { type: "lab", codes: check.target.lab }
          : { type: "study", kind: check.target.study };
      // A same-day, sufficiently complete check in this proposal covers the need.
      // A one-week test must never replace a later one-month checkpoint.
      const covered = out.find(
        (i) =>
          i.kind === "plan" &&
          i.dueDate === dueDate &&
          i.completesOn.type === completesOn.type &&
          (completesOn.type === "lab"
            ? completesOn.codes!.every((c) =>
                (i.completesOn.codes as string[] | undefined)?.includes(c),
              )
            : i.completesOn.kind === completesOn.kind),
      );
      if (covered) continue;
      out.push({
        kind: "plan",
        category: "monitoring",
        title: `${def.name}: ${check.what} (day ${days})`,
        dueDate,
        completesOn,
        medicationRef: `code:${code}`,
        label: "",
      });
    }
  }
  return out;
}
