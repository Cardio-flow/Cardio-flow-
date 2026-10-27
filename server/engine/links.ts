// Linked decisions (20 Oct 2026, Ahmed: "no interlinks … the sections appear as isolated islands"; stage 2).
// Each rule decides alone; this layer reads the whole record once more and, for the alerts it knows,
//  - adds the facts from elsewhere in the record that bear on the decision ("links"), and
//  - folds an alert that only matters if another decision goes one way under that decision ("children").
// Facts only, from the record; no new thresholds. Reference limits are the catalogue's; guideline statements
// are cited where they are the reason a fact is named.
import type { PatientState } from "../kernel/state.js";
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, flagFor, fmtDay } from "../../shared/clinical.js";
import { creatinineTrend } from "./renal-trend.js";

// Links must use the same clinician-selected / verified value as treatment decisions.
const latest = (s: PatientState, code: string) => s.resolved(code).current;
const finals = (s: PatientState, code: string) => {
  const current=latest(s,code);
  return current ? s.resolved(code).history.filter(o=>o.status==='final' && o.value_num!=null && o.effective_at<=current.effective_at)
    .sort((a,b)=>a.effective_at.localeCompare(b.effective_at)) : [];
};
const live = (s: PatientState, tags: string[]) => s.meds.filter((m) => m.status === "active" && m.tags.some((t) => tags.includes(t)));
const names = (ms: { name: string }[]) => ms.map((m) => m.name).join(", ");
const MON = (at: string) => fmtDay(at, { year: true }).replace(/^\d+ /, "");
const hbLow = (s: PatientState) => (s.patient.sex === "Female" ? 12 : 13); // WHO 2024, as the anaemia rule

function recentAdmission(s: PatientState, reasons: string[], events: string[] = []) {
  return [...s.contexts].filter((c) => c.kind === "admission" && daysBetween(c.started_at, s.today) <= 365 &&
    (c.reasons.some((r) => reasons.includes(r)) || ((c.summary as any)?.events ?? []).some((e: string) => events.includes(e))))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
}

function hbTrend(s: PatientState) {
  const h = finals(s, "haemoglobin");
  if (h.length < 2) return null;
  const a = h[h.length - 2], b = h[h.length - 1];
  return b.value_num! < a.value_num! ? `Hb falling: ${formatNumber(a.value_num!, 1)} → ${formatNumber(b.value_num!, 1)} (${fmtDay(b.effective_at)})` : null;
}

function lowCells(s: PatientState) {
  const out: string[] = [];
  for (const code of ["wbc", "platelets"]) {
    const o = latest(s, code);
    if (o && flagFor(o.value_num!, MEASURES[code]?.ref) === "low") out.push(`${MEASURES[code].short} ${formatNumber(o.value_num!, MEASURES[code].decimals ?? 0)}`);
  }
  return out;
}

type Item = { id: string; rule_id: string; title: string; links?: string[]; children?: Item[]; [k: string]: any };

export function linkAttention(s: PatientState, items: Item[]): Item[] {
  const has = (rule: string) => items.find((a) => a.rule_id === rule);
  const at = live(s, ["antiplatelet", "oac"]);
  const aki = recentAdmission(s, ["Acute kidney injury"], ["Acute kidney injury"]);
  const hypo = recentAdmission(s, ["Hypotension / shock"], ["Cardiogenic shock", "Inotropes / vasopressors"]);
  const gi = recentAdmission(s, ["Vomiting / diarrhoea / GI illness"]);
  const trend = creatinineTrend(s);
  const dapt = has("cad.dapt-beyond-default");
  const folded = new Set<string>();

  for (const a of items) {
    const links: string[] = [];
    const r = a.rule_id;
    if (["lab.anaemia", "lab.iron-deficiency", "hf.iron-deficiency"].includes(r)) {
      if (at.length) links.push(`On ${names(at)}: consider a GI blood-loss source`);
      if (dapt) links.push("Dual antiplatelets beyond the default duration: see the antiplatelet decision");
      // the values themselves are the card's result rows: named here without repeating them
      const cells = lowCells(s).map((c) => c.split(" ")[0]);
      if (cells.length) links.push(`${cells.join(" and ")} also low: not explained by iron deficiency alone — blood film`);
    }
    if (r === "cad.dapt-beyond-default") {
      const hb = latest(s, "haemoglobin");
      const h = hbTrend(s);
      if (h) links.push(`For stopping one: ${h}`);
      else if (hb && hb.value_num! < hbLow(s)) links.push(`For stopping one: Hb ${formatNumber(hb.value_num!, 1)}`);
      if (s.conditions.some((c) => c.code === "prior-bleeding" && c.status === "active")) links.push("For stopping one: previous major bleeding");
      const plt = latest(s, "platelets");
      if (plt && flagFor(plt.value_num!, MEASURES.platelets?.ref) === "low") links.push(`For stopping one: platelets ${formatNumber(plt.value_num!, 0)}`);
      // the PPI question only stands if dual therapy continues (ESC: PPI with combined antithrombotic therapy)
      const ppi = has("cad.ppi-combined-antithrombotic");
      if (ppi) { a.children = [{ ...ppi, links: ["Only if dual antiplatelet therapy continues"] }]; folded.add(ppi.id); }
    }
    if (r === "hf.hyperkalaemia-review" || /hyperkal|high-potassium/.test(r)) {
      const kRaise = live(s, ["raas", "arni", "mra", "potassium-sparing"]).concat(s.meds.filter((m) => m.status === "active" && m.code === "potassium-chloride"));
      links.push(kRaise.length ? `Potassium-raising: ${names(kRaise)}` : "No potassium-raising medicine on the list");
      if (aki) links.push(`AKI during the ${MON(aki.started_at)} admission`);
      if (trend && trend.rel > 0) links.push(`Creatinine ${formatNumber(trend.baseline.value_num!, 0)} → ${formatNumber(trend.cur.value_num!, 0)} (+${Math.round(trend.rel * 100)}%)`);
    }
    if (r === "safety.low-potassium" || r === "safety.hypomagnesaemia") {
      const ppi = live(s, ["ppi"]);
      if (ppi.length) links.push(`On ${names(ppi)}: hypomagnesaemia with long-term PPI use (SmPC)`);
      const diur = live(s, ["loop", "thiazide"]);
      if (diur.length) links.push(`On ${names(diur)}`);
      if (gi) links.push(`GI losses: ${MON(gi.started_at)} admission`);
    }
    if (r === "lab.liver-enzymes") {
      const st = live(s, ["statin"]);
      if (st.length) links.push(`On ${names(st)}`);
      const am = live(s, ["amiodarone"]);
      if (am.length) links.push(`On ${names(am)}`);
    }
    if (r === "cardiorenal.stage-review" && aki) links.push(`AKI during the ${MON(aki.started_at)} admission: eGFR may not be at steady state yet`);
    if (r === "hf.foundational-therapy" || r === "hf.titration") {
      if (aki || hypo) links.push(`${[aki && "AKI", hypo && "hypotension"].filter(Boolean).join(" and ")} in ${MON((aki ?? hypo)!.started_at)}: start low, recheck potassium and creatinine in 1–2 weeks (ESC HF)`);
    }
    if (r === "metabolic.diabetes-cv-protection" && /GLP-1/.test(a.title) && gi) links.push(`Admitted ${MON(gi.started_at)} with vomiting / diarrhoea: GLP-1 RA gastrointestinal effects`);
    if (links.length) a.links = [...(a.links ?? []), ...links];
  }
  return items.filter((a) => !folded.has(a.id));
}
