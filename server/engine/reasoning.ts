// Problem solving on the overview (20 Oct 2026, stage 2 — Ahmed: "smart intelligent problem solving";
// "finish all … then deploy"). Three read-only views built from the record:
//  - reasoning per problem card: causes checked in the record (yes / no / to ask), what it changes for other
//    decisions, and the next step — facts and the cited guideline or label wording only, no new thresholds;
//  - since the last visit: what was planned then, and whether it happened (on time, late, not yet);
//  - ask and examine today: the questions and examination this visit needs, each with the reason from the record.
import type { PatientState } from "../kernel/state.js";
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, flagFor, fmtDay, localDay } from "../../shared/clinical.js";
import { creatinineTrend } from "./renal-trend.js";

type Mark = "yes" | "no" | "ask";
export type Reasoning = { checked: { mark: Mark; text: string }[]; changes: string[]; next: string[] };

const finals = (s: PatientState, code: string) =>
  s.observations.filter((o) => o.code === code && o.status === "final" && o.value_num != null).sort((a, b) => a.effective_at.localeCompare(b.effective_at));
const latest = (s: PatientState, code: string) => { const f = finals(s, code); return f[f.length - 1] ?? null; };
const live = (s: PatientState, tags: string[]) => s.meds.filter((m) => m.status === "active" && m.tags.some((t) => tags.includes(t)));
const liveCode = (s: PatientState, codes: string[]) => s.meds.filter((m) => m.status === "active" && codes.includes(m.code));
const names = (ms: { name: string }[]) => ms.map((m) => m.name).join(", ");
const MON = (at: string) => fmtDay(at, { year: true }).replace(/^\d+ /, "");
const has = (s: PatientState, ...codes: string[]) => s.conditions.some((c) => codes.includes(c.code) && c.status === "active");
const flag = (s: PatientState, code: string) => { const o = latest(s, code); return o ? flagFor(o.value_num!, MEASURES[code]?.ref) : null; };
function admission(s: PatientState, reasons: string[], events: string[] = []) {
  return [...s.contexts].filter((c) => c.kind === "admission" && daysBetween(c.started_at, s.today) <= 365 &&
    (c.reasons.some((r) => reasons.includes(r)) || ((c.summary as any)?.events ?? []).some((e: string) => events.includes(e))))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
}
const recentlyMeasured = (s: PatientState, code: string, days: number) => { const o = latest(s, code); return !!o && daysBetween(o.effective_at, s.today) <= days; };

export function problemReasoning(s: PatientState) {
  const out: Record<string, Reasoning> = {};
  const aki = admission(s, ["Acute kidney injury"], ["Acute kidney injury"]);
  const gi = admission(s, ["Vomiting / diarrhoea / GI illness"]);
  const t = creatinineTrend(s);
  const kHigh = flag(s, "potassium") === "high", naLow = flag(s, "sodium") === "low", mgLow = flag(s, "magnesium") === "low";
  const crUp = !!t && t.rel >= 0.1;

  // kidney, potassium, sodium, magnesium
  if (kHigh || naLow || mgLow || crUp) {
    const r: Reasoning = { checked: [], changes: [], next: [] };
    if (crUp || kHigh) r.checked.push(aki ? { mark: "yes", text: `AKI in the ${MON(aki.started_at)} admission` } : { mark: "no", text: "No AKI admission recorded" });
    const raas = live(s, ["raas", "arni", "mra"]);
    r.checked.push(raas.length ? { mark: "yes", text: `On ${names(raas)}` } : { mark: "no", text: "No ACEi, ARB, ARNI or MRA" });
    const diur = live(s, ["loop", "thiazide"]);
    r.checked.push(diur.length ? { mark: "yes", text: `On ${names(diur)}` } : { mark: "no", text: "No diuretic" });
    if (kHigh) {
      const kp = live(s, ["potassium-sparing"]).filter((m) => !m.tags.includes("mra")).concat(liveCode(s, ["potassium-chloride"]));
      r.checked.push(kp.length ? { mark: "yes", text: `On ${names(kp)}` } : { mark: "no", text: "No potassium supplement or potassium-sparing diuretic" });
    }
    const nsaid = live(s, ["nsaid"]);
    r.checked.push(nsaid.length ? { mark: "yes", text: `On ${names(nsaid)}` } : { mark: "ask", text: "NSAIDs, herbal remedies, potassium-rich salt substitutes: ask" });
    if (naLow) {
      const thz = live(s, ["thiazide"]);
      if (thz.length) r.checked.push({ mark: "yes", text: `Thiazide (${names(thz)}): a common cause of low sodium` });
      if (gi) r.checked.push({ mark: "yes", text: `GI losses (${MON(gi.started_at)} admission)` });
      if (s.tags.has("hf")) r.checked.push({ mark: "ask", text: "Congestion or volume depletion: examine" });
    }
    if (mgLow) {
      const ppi = live(s, ["ppi"]);
      if (ppi.length) r.checked.push({ mark: "yes", text: `${names(ppi)}: hypomagnesaemia with long-term PPI use (SmPC)` });
    }
    // what it changes
    const egfr = latest(s, "egfr")?.value_num ?? null;
    const met = liveCode(s, ["metformin"]);
    if (met.length && egfr != null && egfr < 45)
      r.changes.push(egfr < 30 ? `Metformin: label stop below eGFR 30 (eGFR ${formatNumber(egfr, 0)})` : `Metformin: label maximum 1,000 mg/day at eGFR 30–44 (eGFR ${formatNumber(egfr, 0)})`);
    if (kHigh) r.changes.push("Holds starting or increasing an ACEi, ARB, ARNI or MRA (K > 5.0, ESC HF)");
    const doac = live(s, ["oac"]).filter((m) => m.code !== "warfarin");
    if (doac.length && crUp) r.changes.push(`${names(doac)}: recheck the renal dose (creatinine clearance)`);
    // next
    const stale = ["creatinine", "potassium"].some((c) => !recentlyMeasured(s, c, 14));
    if (stale) r.next.push(`Repeat creatinine, potassium${naLow ? ", sodium" : ""}${mgLow ? ", magnesium" : ""} (last ${fmtDay(latest(s, "creatinine")?.effective_at ?? s.today)})`);
    if (crUp && t && t.review) r.next.push("If not improving: renal ultrasound and nephrology review");
    out.kidney = r;
  }

  // blood count and iron
  const hb = latest(s, "haemoglobin");
  const hbLow = hb && hb.value_num! < (s.patient.sex === "Female" ? 12 : 13);
  if (hbLow) {
    const r: Reasoning = { checked: [], changes: [], next: [] };
    const iron = recentlyMeasured(s, "ferritin", 365) && recentlyMeasured(s, "tsat", 365);
    r.checked.push(iron ? { mark: "yes", text: "Iron studies in the last year" } : { mark: "no", text: "No iron studies in the last year" });
    const vit = recentlyMeasured(s, "b12", 365) && recentlyMeasured(s, "folate", 365);
    const mcv = latest(s, "mcv");
    r.checked.push(vit ? { mark: "yes", text: "B12 and folate in the last year" } : { mark: "no", text: `No B12 and folate in the last year${mcv && mcv.value_num! > 100 ? ` (MCV ${formatNumber(mcv.value_num!, 0)})` : ""}` });
    const at = live(s, ["antiplatelet", "oac"]);
    if (at.length) r.checked.push({ mark: "ask", text: `Melaena or other bleeding on ${names(at)}: ask` });
    if (has(s, "haem-malignancy")) r.checked.push({ mark: "yes", text: "Known haematological malignancy" });
    if (has(s, "ckd-3b", "ckd-4", "ckd-5", "dialysis")) r.checked.push({ mark: "yes", text: "CKD stage 3b or worse: renal anaemia possible" });
    if (at.length >= 2) r.changes.push("Weighs on the antiplatelet decision (stopping one)");
    if (s.tags.has("hf")) r.changes.push("HF with iron deficiency: IV iron improves symptoms (ESC HF)");
    if (!iron) r.next.push("Ferritin and TSAT");
    if (!vit) r.next.push("B12 and folate");
    if (["wbc", "platelets"].some((c) => flag(s, c) === "low")) r.next.push("Blood film; haematology if confirmed");
    out.anaemia = r;
  }

  // liver tests (shown in the lipids card)
  const alt = latest(s, "alt"), ast = latest(s, "ast");
  const uln = (o: any) => (o?.reference_high ? o.value_num / o.reference_high : null);
  const ratio = Math.max(uln(alt) ?? 0, uln(ast) ?? 0);
  if (ratio > 1) {
    const r: Reasoning = { checked: [], changes: [], next: [] };
    const st = live(s, ["statin"]);
    r.checked.push(st.length ? { mark: "yes", text: `On ${names(st)}` } : { mark: "no", text: "No statin" });
    const am = live(s, ["amiodarone"]);
    if (am.length) r.checked.push({ mark: "yes", text: `On ${names(am)}` });
    if (s.tags.has("hf") && (latest(s, "nt-probnp")?.value_num ?? 0) >= 125) r.checked.push({ mark: "ask", text: "Congestive hepatopathy: examine for congestion" });
    r.checked.push({ mark: "ask", text: "Alcohol and other liver medicines: ask" });
    if (st.length) r.changes.push(ratio >= 3 ? "Statin: pause and review at ≥3× ULN (ESC/EAS)" : "Statin continues below 3× ULN (ESC/EAS)");
    r.next.push("Repeat liver tests");
    out.lipids = r;
  }

  // thyroid (shown under Other results)
  const tsh = latest(s, "tsh");
  if (tsh && flagFor(tsh.value_num!, MEASURES.tsh?.ref)) {
    const r: Reasoning = { checked: [], changes: [], next: [] };
    const am = live(s, ["amiodarone"]);
    r.checked.push(am.length ? { mark: "yes", text: `On ${names(am)}` } : { mark: "no", text: "No amiodarone" });
    const ill = [...s.contexts].find((c) => c.kind === "admission" && c.ended_at && daysBetween(c.ended_at, localDay(tsh.effective_at)) <= 90 && daysBetween(c.ended_at, localDay(tsh.effective_at)) >= 0);
    if (ill) r.checked.push({ mark: "yes", text: `Measured within 3 months of an admission (${MON(ill.started_at)}): may be transient` });
    r.checked.push(recentlyMeasured(s, "ft4", 30) ? { mark: "yes", text: "FT4 measured" } : { mark: "no", text: "No FT4 with it" });
    r.next.push("Repeat TSH with FT4 before treating");
    out.results = r;
  }
  return out;
}

// since the last visit (or discharge): what was planned then, and whether it happened
export function sinceLastVisit(s: PatientState) {
  const ctx = [...s.contexts].filter((c) => c.status === "closed" && c.ended_at && !c.summary?.historical && (c.kind === "clinic_visit" || c.kind === "admission"))
    .sort((a, b) => b.ended_at!.localeCompare(a.ended_at!))[0];
  if (!ctx) return null;
  const items = s.plan.filter((p) => (p.source_context_id === ctx.id || p.context_refs?.includes(ctx.id)) && p.status !== "cancelled" && p.status !== "superseded").map((p) => {
    const awaitingReview = p.status === "completed" && p.progress === "performed";
    const done = p.status === "completed" && !awaitingReview;
    const late = done && p.due_date && p.completed_at ? daysBetween(p.due_date, localDay(p.completed_at)) : null;
    const overdue = !done && p.due_date && p.due_date < s.today ? daysBetween(p.due_date, s.today) : null;
    const state: "done" | "late" | "missed" | "pending" | "review" = awaitingReview ? "review" : done ? (late != null && late > 7 ? "late" : "done") : overdue != null ? "missed" : "pending";
    return {
      id: p.id, title: p.title, state,
      note: state === "review" ? "Result received · awaiting clinical review" : state === "late" ? `done ${fmtDay(p.completed_at!)}, ${Math.round(late! / 7)} week${Math.round(late! / 7) === 1 ? "" : "s"} late`
        : state === "done" ? `done${p.completed_at ? ` ${fmtDay(p.completed_at)}` : ""}`
        : state === "missed" ? `due ${fmtDay(p.due_date!)}: not done (${overdue! >= 14 ? `${Math.round(overdue! / 7)} weeks` : `${overdue} days`})`
        : p.due_date ? `due ${fmtDay(p.due_date)}` : "no date",
    };
  });
  if (!items.length) return null;
  const order = { review: 0, missed: 1, late: 2, pending: 3, done: 4 } as const;
  items.sort((a, b) => order[a.state] - order[b.state]);
  return { since: ctx.ended_at, label: ctx.kind === "admission" ? `Since discharge · ${fmtDay(ctx.ended_at!, { year: true })}` : `Since the last visit · ${fmtDay(ctx.ended_at!, { year: true })}`, items };
}

// what to ask and examine at this visit, each with the reason from the record
export function askToday(s: PatientState, attention: { rule_id: string }[]) {
  const out: { key: string; ask: string; why: string }[] = [];
  const at = live(s, ["antiplatelet", "oac"]);
  const hb = latest(s, "haemoglobin");
  const hbFalling = (() => { const h = finals(s, "haemoglobin"); return h.length >= 2 && h[h.length - 1].value_num! < h[h.length - 2].value_num!; })();
  const uro = admission(s, ["Sepsis / urinary infection"]);
  if (has(s, "recurrent-uti") || uro) out.push({ key: "urine", ask: "Urinary symptoms: dysuria, frequency, fever", why: uro ? `urosepsis ${MON(uro.started_at)}` : "recurrent UTI" });
  if (flag(s, "potassium") === "high" || (creatinineTrend(s)?.rel ?? 0) >= 0.1) out.push({ key: "nsaid", ask: "NSAIDs, herbal remedies, potassium-rich salt", why: [flag(s, "potassium") === "high" && "potassium high", (creatinineTrend(s)?.rel ?? 0) >= 0.1 && "creatinine rising"].filter(Boolean).join(", ") });
  if (at.length && (hbFalling || (hb && hb.value_num! < (s.patient.sex === "Female" ? 12 : 13)))) out.push({ key: "bleeding", ask: "Melaena or other bleeding", why: `${names(at)}${hbFalling ? ", Hb falling" : ", Hb low"}` });
  const hypo = admission(s, ["Hypotension / shock"]) ?? null;
  if (has(s, "hypotension") || hypo || live(s, ["bp-raising"]).length) out.push({ key: "postural", ask: "Dizziness; sitting and standing BP", why: hypo ? `hypotension ${MON(hypo.started_at)}` : "symptomatic hypotension recorded" });
  if (s.tags.has("hf")) {
    const bnp = finals(s, "nt-probnp");
    const rising = bnp.length >= 2 && bnp[bnp.length - 1].value_num! > bnp[bnp.length - 2].value_num!;
    out.push({ key: "congestion", ask: "Weight, oedema, JVP, breathlessness (NYHA)", why: rising ? "NT-proBNP rising" : "heart failure review" });
  }
  if (attention.some((a) => a.rule_id === "cad.dapt-beyond-default")) out.push({ key: "angina", ask: "Chest pain on effort", why: "before stopping an antiplatelet" });
  else if (has(s, "cad-suspected")) out.push({ key: "angina", ask: "Chest pain: character, trigger, frequency", why: "suspected IHD" });
  if (s.tags.has("af")) out.push({ key: "af", ask: "Palpitations; pulse rhythm and rate", why: "atrial fibrillation" });
  return out;
}
