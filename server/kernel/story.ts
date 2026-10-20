// The overview as a story (20 Oct 2026 — Ahmed: "the sections appear as isolated islands and not like a
// continuous story"; "I need the trends, creative display and smart problem solving").
// Three read-only views built from the record, no new data and no new thresholds:
//  - story: what the patient has, the turning point (latest admission), what changed since, treatment now;
//  - standing: one verdict per domain (heart function, kidney, NT-proBNP, HF medicines, bleeding);
//  - timeline: one time axis for LVEF, creatinine, potassium, Hb, NT-proBNP, admissions and medicines;
//  - abnormal: every abnormal latest result once, with its trend (replaces three repeated lab panels).
// Reference lines are the catalogue's own reference limits, the creatinine baseline the renal rule uses,
// and the LVEF 50% line CardioFlow uses for HFrEF.
import type { PatientState, MedState } from "./state.js";
import { MEASURES, formatNumber, formatRange } from "../../shared/catalog.js";
import { daysBetween, flagFor, fmtDay } from "../../shared/clinical.js";
import { creatinineTrend } from "../engine/renal-trend.js";
import { pregnancyHaemoglobinCutoff } from "../../shared/pregnancy.js";

type Tone = "good" | "bad" | "warn" | "neutral";
const MON = (at: string) => fmtDay(at, { year: true }).replace(/^\d+ /, "");
const finals = (s: PatientState, code: string) =>
  s.observations.filter((o) => o.code === code && o.status === "final" && o.value_num != null).sort((a, b) => a.effective_at.localeCompare(b.effective_at));
const valueText = (code: string, v: number, high?: number | null) => formatRange(v, high, MEASURES[code]?.decimals ?? 0);
const pct = (a: number, b: number) => (a ? Math.round(((b - a) / Math.abs(a)) * 100) : null);
// Hb: WHO 2024 non-pregnant adult cut-offs (as the anaemia rule): <12 g/dL women, <13 men
const refOf = (s: PatientState, code: string) => (code === "haemoglobin" ? { low: s.patient.sex === "Female" ? 12 : 13 } : MEASURES[code]?.ref ?? undefined);

function lastAdmission(s: PatientState) {
  return [...s.contexts].filter((c) => c.kind === "admission" && daysBetween(c.started_at, s.today) <= 365).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
}

// medicines stopped or held during an admission (or within 3 days of its end)
function changedIn(s: PatientState, from: string, to: string) {
  const end = new Date(Date.parse(to) + 3 * 864e5).toISOString();
  return s.meds.flatMap((m) => m.events.filter((e) => ["stop", "hold"].includes(e.kind) && e.effective_at >= from && e.effective_at <= end).map((e) => `${m.name} ${e.kind === "stop" ? "stopped" : "held"}`));
}

// One home for every fact (20 Oct 2026, Ahmed: "a perfect overview without repeated info"): the story tells
// what happened and in which direction; the numbers live once, in the problem they belong to. So the story
// carries no diagnosis list (the header has it), no values (the problem cards have them) and no medicine
// list (the medicine strip has it).
export function story(s: PatientState) {
  const lines: { key: string; label: string; text: string; tone?: Tone }[] = [];
  // the course of the heart: the LVEF trajectory, when there is one
  const ef = finals(s, "lvef");
  const traj: string[] = [];
  for (const o of ef.slice(-4)) {
    const t = `${valueText("lvef", o.value_num!, o.value_high)}% (${MON(o.effective_at)})`;
    if (traj[traj.length - 1]?.split(" (")[0] !== t.split(" (")[0]) traj.push(t);
  }
  if (traj.length >= 2) lines.push({ key: "heart", label: "LVEF", text: traj.join(" → ") });
  // the turning point: the latest admission in the last 12 months
  const adm = lastAdmission(s);
  if (adm) {
    const end = adm.ended_at;
    const los = end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(adm.started_at)) / 864e5)) : null;
    const events = ((adm.summary as any)?.events ?? []).filter((e: string) => e !== "None");
    const changed = changedIn(s, adm.started_at, end ?? s.today);
    lines.push({
      key: "admission", label: end ? `Admitted ${MON(adm.started_at)}` : "Admitted now", tone: "bad",
      text: [`${fmtDay(adm.started_at)}${end ? `–${fmtDay(end, { year: true })}` : ""}${los ? ` (${los} day${los === 1 ? "" : "s"})` : ""}: ${adm.reasons.join(", ")}`, events.length ? `in hospital: ${events.join(", ").toLowerCase()}` : null, changed.length ? changed.join(", ") : null].filter(Boolean).join(" · "),
    });
  }
  // since: the direction of what moved (the values are in the problem cards)
  const lastVisit = [...s.contexts].filter((c) => c.kind === "clinic_visit" && c.status === "closed" && c.ended_at).sort((a, b) => b.ended_at!.localeCompare(a.ended_at!))[0];
  const anchor = adm?.ended_at ?? lastVisit?.ended_at ?? new Date(Date.parse(s.today) - 182 * 864e5).toISOString();
  const up: string[] = [], down: string[] = [];
  const NAME: Record<string, string> = { creatinine: "creatinine", potassium: "potassium", sodium: "sodium", haemoglobin: "Hb", "nt-probnp": "NT-proBNP", magnesium: "magnesium", "ldl-c": "LDL-C", hba1c: "HbA1c" };
  for (const code of Object.keys(NAME)) {
    const all = finals(s, code);
    const now = all[all.length - 1];
    if (!now || now.effective_at <= anchor) continue;
    const before = [...all].reverse().find((o) => o.effective_at <= anchor);
    if (!before) continue;
    const p = pct(before.value_num!, now.value_num!);
    const flag = flagFor(now.value_num!, refOf(s, code));
    if (p == null || p === 0 || (!flag && Math.abs(p) < 20)) continue;
    (p > 0 ? up : down).push(NAME[code]);
  }
  const list = (x: string[]) => (x.length > 1 ? `${x.slice(0, -1).join(", ")} and ${x[x.length - 1]}` : x[0]);
  if (up.length || down.length)
    lines.push({ key: "since", label: adm ? "Since discharge" : lastVisit ? "Since the last visit" : "Recently", tone: "warn",
      text: [up.length ? `${list(up)} rose` : null, down.length ? `${list(down)} fell` : null].filter(Boolean).join("; ") });
  return lines;
}

// one verdict per domain, in words; the numbers are in the problem cards
export function standing(s: PatientState) {
  const out: { key: string; label: string; value: string; tone: Tone }[] = [];
  const ef = finals(s, "lvef");
  if (ef.length >= 2) {
    const a = ef[ef.length - 2].value_num!, b = ef[ef.length - 1].value_num!;
    // ESC HF 2021/2026: a ≥10-point LVEF change defines improvement or decline
    out.push({ key: "heart", label: "Heart function", value: b - a >= 10 ? "Improved" : a - b >= 10 ? "Worse" : "Stable", tone: b - a >= 10 ? "good" : a - b >= 10 ? "bad" : "neutral" });
  }
  const t = creatinineTrend(s);
  if (t) {
    // the renal rule's review limit decides "worse"
    const above = flagFor(t.cur.value_num!, MEASURES.creatinine?.ref) === "high";
    const r = Math.round(t.rel * 100);
    out.push({ key: "kidney", label: "Kidney", value: t.review ? "Worse" : r >= 10 ? "Creatinine rising" : r <= -10 ? "Improving" : "Stable", tone: t.review ? "bad" : r >= 10 && above ? "warn" : r <= -10 ? "good" : "neutral" });
  }
  const bnp = finals(s, "nt-probnp");
  if (bnp.length >= 2) {
    const p = pct(bnp[bnp.length - 2].value_num!, bnp[bnp.length - 1].value_num!)!;
    out.push({ key: "bnp", label: "NT-proBNP", value: p > 0 ? "Rising" : p < 0 ? "Falling" : "Unchanged", tone: p > 0 ? "warn" : p < 0 ? "good" : "neutral" });
  }
  const at = s.meds.filter((m) => m.status === "active" && m.tags.some((x) => ["antiplatelet", "oac"].includes(x)));
  const hb = finals(s, "haemoglobin");
  if (at.length >= 2) {
    const falling = hb.length >= 2 && hb[hb.length - 1].value_num! < hb[hb.length - 2].value_num!;
    out.push({ key: "bleeding", label: "Bleeding risk", value: `${at.length} antithrombotics${falling ? " with falling Hb" : ""}`, tone: falling ? "bad" : "warn" });
  }
  return out;
}

// medicine periods on the time axis: on, held/not taking, off
function periods(m: MedState, from: string, to: string) {
  const ev = [...m.events].sort((a, b) => a.effective_at.localeCompare(b.effective_at));
  const out: { from: string; to: string; state: "on" | "held" }[] = [];
  let cur: { from: string; state: "on" | "held" } | null = null;
  for (const e of ev) {
    const state = ["hold", "not_taking"].includes(e.kind) ? "held" : e.kind === "stop" ? "off" : e.kind === "planned" ? null : "on";
    if (state === null) continue;
    // already taking when first recorded: drawn from the start of the axis (start date not known)
    const at: string = (e.preexisting || (e.kind === "continue" && !cur)) && from < e.effective_at ? from : e.effective_at;
    if (cur && cur.state !== state) { out.push({ from: cur.from, to: e.effective_at, state: cur.state }); cur = null; }
    if (state !== "off" && !cur) cur = { from: at, state };
  }
  if (cur) out.push({ from: cur.from, to, state: cur.state });
  return out.map((p) => ({ ...p, from: p.from < from ? from : p.from })).filter((p) => p.to > from);
}

const LANES = ["lvef", "creatinine", "potassium", "haemoglobin", "nt-probnp"] as const;
export function timeline(s: PatientState) {
  const to = new Date(`${s.today}T12:00:00+03:00`).toISOString();
  const pts = LANES.flatMap((c) => finals(s, c));
  if (pts.length < 2) return null;
  const twoYears = new Date(Date.parse(to) - 730 * 864e5).toISOString();
  const first = pts.map((o) => o.effective_at).sort()[0];
  const from = first < twoYears ? twoYears : new Date(Date.parse(first) - 30 * 864e5).toISOString();
  const t = creatinineTrend(s);
  const ref: Record<string, { value: number; label: string } | null> = {
    lvef: { value: 50, label: "50" },
    creatinine: t ? { value: t.baseline.value_num!, label: `baseline ${formatNumber(t.baseline.value_num!, 0)}` } : null,
    potassium: MEASURES.potassium?.ref?.high != null ? { value: MEASURES.potassium.ref.high, label: formatNumber(MEASURES.potassium.ref.high, 1) } : null,
    haemoglobin: { value: refOf(s, "haemoglobin")!.low!, label: String(refOf(s, "haemoglobin")!.low) },
    "nt-probnp": null,
  };
  const lanes = LANES.map((code) => {
    const all = finals(s, code).filter((o) => o.effective_at >= from);
    return {
      code, label: code === "lvef" ? "LVEF %" : MEASURES[code]?.display ?? code, unit: MEASURES[code]?.unit ?? "",
      ref: ref[code],
      points: all.map((o) => ({ id: o.id, at: o.effective_at, value: o.value_num!, high: o.value_high ?? null, text: valueText(code, o.value_num!, o.value_high), source: o.source,
        flag: code === "lvef" ? (o.value_num! < 50 ? "low" : null) : flagFor(o.value_num!, refOf(s, code)) })),
    };
  }).filter((l) => l.points.length >= 2);
  if (!lanes.length) return null;
  const admissions = s.contexts.filter((c) => c.kind === "admission" && (c.ended_at ?? to) >= from)
    .map((c) => ({ id: c.id, from: c.started_at < from ? from : c.started_at, to: c.ended_at ?? to, label: c.reasons.join(", "), open: !c.ended_at, changed: changedIn(s, c.started_at, c.ended_at ?? to) }));
  const cardiac = (m: MedState) => m.tags.some((x) => ["raas", "arni", "acei", "arb", "bb", "mra", "sglt2", "loop", "thiazide", "antiplatelet", "oac", "statin", "lipid", "nitrate", "ivabradine", "digoxin", "glp1", "bp-raising"].includes(x));
  // a bar only for a medicine that started, stopped or was held in the period; the rest are one line
  const changedHere = (m: MedState) => m.events.some((e) => e.effective_at >= from && !e.preexisting && !(e.kind === "continue" && e === m.events[0]));
  const all = s.meds.filter(cardiac).map((m) => ({ id: m.id, name: m.name, status: m.status, periods: periods(m, from, to), changed: changedHere(m) })).filter((m) => m.periods.length);
  const meds = all.filter((m) => m.changed).slice(0, 8);
  const steady = all.filter((m) => !m.changed && m.status !== "stopped").map((m) => m.name);
  const events = [
    ...s.studies.filter((x) => x.kind === "echo" && x.performed_at >= from).map((x) => ({ at: x.performed_at, kind: "echo", label: "Echo" })),
    ...s.procedures.filter((p) => p.performed_at >= from).map((p) => ({ at: p.performed_at, kind: p.kind, label: p.summary || p.kind.toUpperCase() })),
  ];
  const before = s.procedures.filter((p) => p.performed_at < from).map((p) => `${(p.summary || p.kind.toUpperCase()).replace(/ \(past history\)$/, "")} ${new Date(p.performed_at).getFullYear()}`);
  return { from, to, lanes, admissions, meds, steady, events, before };
}

// every abnormal latest result once, with its trend; normal ones as one line
export function abnormal(s: PatientState, results: any[], goals: { ldl?: { goal: number; met: boolean | null } | null; hba1c?: { target: string; met: boolean | null } | null }) {
  const isHf = s.tags.has("hf");
  const flagged: any[] = [], normal: { code: string; text: string }[] = [];
  const byCode = Object.fromEntries(results.map((r) => [r.code, r]));
  for (const r of results) {
    if (r.code === "egfr" || r.current?.value == null) continue;
    const v = r.current.value as number;
    // in pregnancy Hb is read against the trimester cut-off (WHO 2024, as the anaemia rule), eGFR never
    const preg = s.conditions.find((c) => c.code === "pregnancy-care" && (c.attributes as any)?.phase === "Pregnant");
    const hbCut = preg && r.code === "haemoglobin" ? pregnancyHaemoglobinCutoff((preg.attributes as any)?.edd, String(r.current.at).slice(0, 10)) : null;
    let flag: "high" | "low" | null = preg && r.code === "haemoglobin" ? (hbCut != null && v < hbCut ? "low" : null) : flagFor(v, refOf(s, r.code));
    let note: string | null = null;
    const uln = r.current.referenceHigh as number | null;
    if (!flag && uln && v > uln) { flag = "high"; note = `${formatNumber(v / uln, 1)}× ULN`; }
    // ESC HF 2023 iron deficiency: ferritin <100 µg/L, or 100–299 with TSAT <20%
    if (!flag && isHf && r.code === "tsat" && v < 20) { flag = "low"; note = "iron deficiency (ESC HF)"; }
    if (!flag && isHf && r.code === "ferritin" && v < 100) { flag = "low"; note = "iron deficiency (ESC HF)"; }
    // ESC HF: NT-proBNP ≥125 pg/mL is above the non-acute rule-out
    if (!flag && r.code === "nt-probnp" && v >= 125) { flag = "high"; note = "≥125 (ESC)"; }
    if (!flag && r.code === "ldl-c" && goals.ldl?.met === false) { flag = "high"; note = `goal <${goals.ldl.goal}`; }
    if (!flag && r.code === "hba1c" && goals.hba1c?.met === false) { flag = "high"; note = `target ${goals.hba1c.target}`; }
    // eGFR is not valid in pregnancy (as on the kidney card): never named then
    const pregnant = s.conditions.some((c) => c.code === "pregnancy-care" && (c.attributes as any)?.phase === "Pregnant");
    if (r.code === "creatinine" && !pregnant && byCode.egfr?.current?.value != null) note = [note, `eGFR ${formatNumber(byCode.egfr.current.value, 0)}`].filter(Boolean).join(" · ");
    const text = `${formatRange(v, r.current.valueHigh, r.decimals)}`;
    if (!flag) { normal.push({ code: r.code, text: `${r.label} ${text}` }); continue; }
    flagged.push({
      code: r.code, label: r.label, display: r.display, value: v, text, unit: r.unit, at: r.current.at, flag, note,
      previous: r.trend?.previous ? { value: r.trend.previous.value, text: formatNumber(r.trend.previous.value, r.decimals), at: r.trend.previous.at } : null,
      percent: r.trend?.percent != null ? Math.round(r.trend.percent) : null,
      series: (r.displaySeries ?? []).map((p: any) => p.value),
    });
  }
  // the most recent first, then by the size of the change
  flagged.sort((a, b) => b.at.slice(0, 10).localeCompare(a.at.slice(0, 10)) || Math.abs(b.percent ?? 0) - Math.abs(a.percent ?? 0));
  return { items: flagged, normal };
}
