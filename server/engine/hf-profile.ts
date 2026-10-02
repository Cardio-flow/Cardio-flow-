// The HF profile (blueprint P2.1): one view model for the HF panel, the notes and the documents.
// Descriptive only — it reads the record and computes no new thresholds. HF type follows the
// 2026 ESC HF classification (HFrEF = LVEF <50%, HFpEF = LVEF ≥50%); an LVEF that has risen to
// ≥50% after a documented value <50% is shown as "improved" and keeps HFrEF therapy.
import { MEDICATION, doseLabel } from "../../shared/catalog.js";
import { attributesText } from "../../shared/history.js";
import { daysBetween } from "../../shared/clinical.js";
import { isHfAdmission } from "../../shared/encounters.js";
import type { Obs, PatientState } from "../kernel/state.js";
import { fmtStatus, hfImprovedEf, hfPhenotype } from "./guidelines.js";
import { optimalFmt } from "./hf-rules.js";

type Point = { value: number; at: string };
type TextPoint = { value: string; at: string };

const finals = (s: PatientState, code: string) => s.resolved(code).history.filter((o) => o.status === "final");
const num = (o: Obs | null | undefined): Point | null => (o && o.value_num != null ? { value: o.value_num, at: o.effective_at } : null);
const txt = (o: Obs | null | undefined): TextPoint | null => (o && o.value_text ? { value: o.value_text, at: o.effective_at } : null);
// latest and the one before it (newest first in history)
const pair = (s: PatientState, code: string) => {
  const h = finals(s, code).filter((o) => o.value_num != null);
  return { now: num(h[0]), before: num(h[1]) };
};

const FOUNDATIONAL = ["raas", "bb", "mra", "sglt2"];

export function hfProfile(s: PatientState) {
  const phen = hfPhenotype(s);
  if (!phen) return null;
  const improved = hfImprovedEf(s);
  const hfCond = s.conditions.filter((c) => ["hfref", "hfmref", "hfpef", "hfimpef"].includes(c.code));
  const aetiology = hfCond.map((c) => attributesText(c.code, c.attributes)).filter(Boolean).join(" · ") || null;
  const onset = hfCond.map((c) => c.onset).filter(Boolean).sort()[0] ?? null;

  // LVEF history, oldest first, with the HF type each value implies
  const lvef = finals(s, "lvef")
    .filter((o) => o.value_num != null)
    .map((o) => ({ value: o.value_num!, at: o.effective_at, quality: o.quality, source: o.source, type: o.value_num! < 50 ? "reduced" : "preserved" }))
    .reverse();
  const current = lvef[lvef.length - 1] ?? null;
  // the current type holds since the first value of the latest unbroken run in the same category
  let since: string | null = null;
  for (let i = lvef.length - 1; i >= 0 && lvef[i].type === current?.type; i--) since = lvef[i].at;
  const lowest = lvef.length ? lvef.reduce((a, b) => (b.value < a.value ? b : a)) : null;

  // dry weight: the clinician's recorded value, else the last discharge weight
  const dryRec = num(finals(s, "dry-weight")[0]);
  const discharge = finals(s, "weight").find((o) => o.source === "discharge weight");
  const dry = dryRec ? { ...dryRec, source: "recorded" as const } : discharge ? { value: discharge.value_num!, at: discharge.effective_at, source: "discharge weight" as const } : null;
  const weight = pair(s, "weight");

  const yearAgo = (iso: string) => daysBetween(iso, s.today) <= 365;
  const hfAdmissions = s.contexts.filter((c) => c.kind === "admission" && isHfAdmission(c as any));
  const lastHf = hfAdmissions[hfAdmissions.length - 1] ?? null;

  // foundational therapy per drug: when started, last change, % of target, at target since
  const fmt = fmtStatus(s);
  const therapy = s.meds
    .filter((m) => m.status !== "stopped" && m.status !== "planned" && m.tags.some((t) => FOUNDATIONAL.includes(t)))
    .map((m) => {
      const def = MEDICATION[m.code];
      const pct = def?.target && m.doseValue != null ? Math.round((m.doseValue / def.target) * 100) : null;
      const doseEvents = m.events.filter((e) => ["start", "restart", "increase", "decrease"].includes(e.kind));
      const lastDose = doseEvents[doseEvents.length - 1] ?? null;
      return {
        id: m.id,
        name: m.name,
        dose: def ? `${doseLabel(def, m.doseValue, m.doseUnit)} ${m.frequency ?? ""}`.trim() : "",
        status: m.status,
        started: m.startedAt,
        lastChange: m.lastChange ? { kind: m.lastChange.kind, at: m.lastChange.effective_at } : null,
        percentOfTarget: pct,
        target: def?.target ? doseLabel(def, def.target, m.doseUnit) : null,
        sameDoseSince: lastDose?.effective_at ?? m.startedAt,
        atTargetSince: pct != null && pct >= 100 ? lastDose?.effective_at ?? m.startedAt : null,
      };
    });

  return {
    type: phen,
    improved,
    typeLabel: improved ? `HF with improved LVEF (was ${Math.round(improved.lowest)}%)` : phen === "HFrEF" ? "HFrEF (LVEF <50%)" : "HFpEF (LVEF ≥50%)",
    typeSince: since,
    onset,
    aetiology,
    lvef: lvef.slice(-6),
    lvefCount: lvef.length,
    lowestLvef: lowest ? { value: lowest.value, at: lowest.at } : null,
    nyha: { now: txt(finals(s, "nyha")[0]), before: txt(finals(s, "nyha")[1]) },
    congestion: txt(finals(s, "congestion")[0]),
    weight: { ...weight, dry, aboveDry: weight.now && dry ? Math.round((weight.now.value - dry.value) * 10) / 10 : null },
    ntprobnp: pair(s, "nt-probnp"),
    kccq: pair(s, "kccq"),
    walk: pair(s, "6mwd"),
    admissions: {
      last12m: hfAdmissions.filter((c) => yearAgo(c.started_at)).length,
      total: hfAdmissions.length,
      last: lastHf ? { at: lastHf.started_at, discharged: lastHf.ended_at, open: lastHf.status === "open" } : null,
    },
    pillars: fmt?.pillars ?? [],
    optimal: optimalFmt(s),
    therapy,
  };
}
export type HfProfile = NonNullable<ReturnType<typeof hfProfile>>;
