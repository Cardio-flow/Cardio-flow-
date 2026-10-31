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
import { defaultUln } from "../../shared/lab-review.js";
import { DIAGNOSIS } from "../../shared/catalog.js";
import { RISK_FACTOR_CODES, attributesText } from "../../shared/history.js";

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
  void traj; // the LVEF course is in the chronology
  // the turning point is in the chronology; "since" counts from it
  const completed = [...s.contexts].filter(c=>c.status==='closed' && c.ended_at && c.ended_at.slice(0,10)<=s.today && ['admission','clinic_visit'].includes(c.kind)).sort((a,b)=>b.ended_at!.localeCompare(a.ended_at!));
  const reference = completed.find(c=>!c.summary?.historical) ?? completed.find(c=>c.kind==='admission');
  const anchor = reference?.ended_at ?? new Date(Date.parse(s.today) - 182 * 864e5).toISOString();
  const up: string[] = [], down: string[] = [];
  const WORSE: Record<string, "up" | "down" | "range"> = { creatinine: "up", "nt-probnp": "up", "ldl-c": "up", hba1c: "up", haemoglobin: "down", potassium: "range", sodium: "range", magnesium: "range" };
  const NAME: Record<string, string> = { creatinine: "creatinine", potassium: "potassium", sodium: "sodium", haemoglobin: "Hb", "nt-probnp": "NT-proBNP", magnesium: "magnesium", "ldl-c": "LDL-C", hba1c: "HbA1c" };
  for (const code of Object.keys(NAME)) {
    const all = finals(s, code);
    const now = s.resolved(code).current;
    if (!now || now.status !== "final" || now.value_num == null || now.effective_at <= anchor) continue;
    const before = [...all].reverse().find((o) => o.effective_at <= anchor);
    if (!before) continue;
    const p = pct(before.value_num!, now.value_num!);
    const flag = flagFor(now.value_num!, refOf(s, code));
    if (p == null || p === 0 || (!flag && Math.abs(p) < 20)) continue;
    // only a move in the harmful direction is news (28 Oct 2026, Ahmed: a falling creatinine is not a problem):
    // creatinine, NT-proBNP, LDL-C and HbA1c when they rise, Hb when it falls; electrolytes when now out of range
    const ref=refOf(s,code);
    const distance=(v:number)=>Math.max(ref?.low != null ? ref.low-v : 0, ref?.high != null ? v-ref.high : 0, 0);
    const harmful = WORSE[code] === "up" ? p > 0 : WORSE[code] === "down" ? p < 0 : !!flag && (flag !== flagFor(before.value_num!, ref) || distance(now.value_num!) > distance(before.value_num!));
    if (!harmful) continue;
    (p > 0 ? up : down).push(NAME[code]);
  }
  const list = (x: string[]) => (x.length > 1 ? `${x.slice(0, -1).join(", ")} and ${x[x.length - 1]}` : x[0]);
  if (up.length || down.length)
    lines.push({ key: "since", label: reference?.kind === "admission" ? "Since discharge" : reference ? "Since the last visit" : "Recently", tone: "warn",
      text: [up.length ? `${list(up)} rose` : null, down.length ? `${list(down)} fell` : null].filter(Boolean).join("; ") });
  return lines;
}

// The record in date order (20 Oct 2026, Ahmed: "the story or the diagnosis does not come in chronological
// way"): diagnoses with a known onset, cardiac events and procedures, admissions, LVEF at diagnosis and each
// ≥10-point change, and cardiac medicines stopped or held — oldest first, each with its date. Undated
// diagnoses are listed once at the end as "date not recorded".
type CardiacEv = { at: string | null; when: string | null; title: string; detail: string; covers: string[]; kind: string };
const MONY = (at: string) => new Date(at).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Asia/Kuwait" });
export function chronology(s: PatientState, cardiac: CardiacEv[]) {
  const items: { at: string; when: string; text: string; tone?: Tone }[] = [];
  const covered = new Set(cardiac.flatMap((e) => e.covers));
  // diagnoses with a date (cardiac events come from the cardiac list; risk factors only when dated)
  const CARDIAC_EVENT_CODES = new Set(["acs-stemi", "acs-nstemi", "acs-ua", "prior-mi", "prior-pci", "prior-cabg", "prosthetic-valve", "cied"]);
  const undated: string[] = [];
  for (const c of s.conditions.filter((c) => c.status === "active" && !CARDIAC_EVENT_CODES.has(c.code) && !covered.has(c.code) && !c.code.startsWith("hx.") && c.code !== "smoker")) {
    const y = (c.attributes as any)?.onsetYear;
    const at = c.onset ?? (y ? `${y}-07-01` : null);
    const extra = attributesText(c.code, c.attributes);
    const text = `${DIAGNOSIS[c.code]?.display ?? c.display}${extra ? ` · ${extra}` : ""}`;
    if (at) items.push({ at, when: c.onset ? MONY(c.onset) : String(y), text });
    else if (!RISK_FACTOR_CODES.has(c.code)) undated.push(DIAGNOSIS[c.code]?.display ?? c.display);
  }
  for (const e of cardiac) if (e.at) items.push({ at: e.at, when: e.when ?? MONY(e.at), text: `${e.title}${e.detail ? ` · ${e.detail}` : ""}` });
  for (const e of cardiac) if (!e.at) undated.push(e.title);
  // LVEF: the first value and each change of ≥10 points (ESC HF definition of improvement)
  const ef = finals(s, "lvef");
  ef.forEach((o, i) => {
    const prev = i ? ef[i - 1] : null;
    if (!prev || Math.abs(o.value_num! - prev.value_num!) >= 10)
      items.push({ at: o.effective_at, when: MONY(o.effective_at), text: `LVEF ${valueText("lvef", o.value_num!, o.value_high)}%${prev ? (o.value_num! > prev.value_num! ? " (improved)" : " (fell)") : ""}`, tone: prev ? (o.value_num! > prev.value_num! ? "good" : "bad") : undefined });
  });
  // admissions
  for (const c of s.contexts.filter((c) => c.kind === "admission")) {
    // events already named in the reasons are not repeated ("Acute kidney injury" as reason and event)
    const said = c.reasons.join(" ").toLowerCase();
    const events = ((c.summary as any)?.events ?? []).filter((e: string) => e !== "None" && !said.includes(e.toLowerCase()) && !(e === "Infection" && /infection|sepsis/.test(said)));
    const changed = changedIn(s, c.started_at, c.ended_at ?? s.today);
    const nDays = c.ended_at ? Math.max(1, Math.round((Date.parse(c.ended_at) - Date.parse(c.started_at)) / 864e5)) : 0;
    const lama = (c.summary as any)?.destination === "Left against medical advice" ? " · left against medical advice" : "";
    items.push({ at: c.started_at, when: MONY(c.started_at), tone: "bad", text: `Admitted${c.ended_at ? ` ${nDays} day${nDays === 1 ? "" : "s"}` : " now"}: ${c.reasons.join(", ")}${events.length ? ` · ${events.join(", ").toLowerCase()}` : ""}${changed.length ? ` · ${changed.join(", ")}` : ""}${lama}` });
  }
  // cardiac medicines stopped or held outside an admission
  const inAdm = (at: string) => s.contexts.some((c) => c.kind === "admission" && at >= c.started_at && at <= new Date(Date.parse(c.ended_at ?? s.today) + 3 * 864e5).toISOString());
  for (const m of s.meds) for (const e of m.events)
    if (["stop", "hold"].includes(e.kind) && !inAdm(e.effective_at) && m.tags.some((t) => ["raas", "arni", "bb", "mra", "sglt2", "loop", "antiplatelet", "oac", "statin"].includes(t)))
      items.push({ at: e.effective_at, when: MONY(e.effective_at), text: `${m.name} ${e.kind === "stop" ? "stopped" : "held"}${e.reason ? ` · ${e.reason}` : ""}` });
  items.sort((a, b) => a.at.localeCompare(b.at));
  // long histories: the first two, then the latest ten
  const shown = items.length > 12 ? [...items.slice(0, 2), { at: "", when: "…", text: `${items.length - 12} more in History` }, ...items.slice(-10)] : items;
  return { items: shown, undated: [...new Set(undated)] };
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
    const resolved=s.resolved(code), selected=resolved.current;
    return {
      code, label: code === "lvef" ? "LVEF %" : MEASURES[code]?.display ?? code, unit: MEASURES[code]?.unit ?? "",
      ref: ref[code],
      current: selected?.value_num != null ? {id:selected.id,value:selected.value_num,text:valueText(code,selected.value_num,selected.value_high),at:selected.effective_at,quality:selected.quality,source:selected.source,reason:resolved.reason} : null,
      points: all.map((o) => ({ id: o.id, at: o.effective_at, value: o.value_num!, high: o.value_high ?? null, text: valueText(code, o.value_num!, o.value_high), source: o.source, quality:o.quality,
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
    if (r.current?.value == null || r.current.status !== "final") continue;
    const v = r.current.value as number;
    // in pregnancy Hb is read against the trimester cut-off (WHO 2024, as the anaemia rule), eGFR never
    const preg = s.conditions.find((c) => c.code === "pregnancy-care" && (c.attributes as any)?.phase === "Pregnant");
    const hbCut = preg && r.code === "haemoglobin" ? pregnancyHaemoglobinCutoff((preg.attributes as any)?.edd, String(r.current.at).slice(0, 10)) : null;
    let flag: "high" | "low" | null = preg && r.code === "haemoglobin" ? (hbCut != null && v < hbCut ? "low" : null) : flagFor(v, refOf(s, r.code));
    let note: string | null = null;
    const uln = (r.current.referenceHigh as number | null) ?? defaultUln(r.code, s.patient.sex);
    // a low creatinine or urea is not a problem to list (28 Oct 2026, Ahmed)
    if (flag === "low" && (r.code === "creatinine" || r.code === "urea")) flag = null;
    if (!flag && uln && v > uln) { flag = "high"; note = `${formatNumber(v / uln, 1)}× ULN`; }
    // ESC HF 2023 iron deficiency: ferritin <100 µg/L, or 100–299 with TSAT <20%
    if (!flag && isHf && r.code === "tsat" && v < 20) {
      const ferritin = byCode.ferritin?.current;
      flag = "low";
      note = ferritin?.status === "final" && ferritin.value != null && ferritin.value < 300 ? "iron deficiency (ESC HF)" : "low TSAT; review iron studies";
    }
    if (!flag && isHf && r.code === "ferritin" && v < 100) { flag = "low"; note = "iron deficiency (ESC HF)"; }
    // ESC HF: NT-proBNP ≥125 pg/mL is above the non-acute rule-out
    if (!flag && r.code === "nt-probnp" && v >= 125) { flag = "high"; note = "≥125 (ESC)"; }
    if (!flag && r.code === "ldl-c" && goals.ldl?.met === false) { flag = "high"; note = `goal <${goals.ldl.goal}`; }
    if (!flag && r.code === "hba1c" && goals.hba1c?.met === false) { flag = "high"; note = `target ${goals.hba1c.target}`; }
    // eGFR is not valid in pregnancy (as on the kidney card): never named then
    const pregnant = s.conditions.some((c) => c.code === "pregnancy-care" && (c.attributes as any)?.phase === "Pregnant");
    // eGFR is its own row in the kidney card (20 Oct 2026: impaired eGFR was not visible); never in pregnancy
    if (r.code === "egfr" && pregnant) continue;
    const text = `${formatRange(v, r.current.valueHigh, r.decimals)}`;
    if (!flag) { normal.push({ code: r.code, text: `${r.label} ${text}` }); continue; }
    flagged.push({
      code: r.code, label: r.label, display: r.display, value: v, text, unit: r.unit, at: r.current.at, flag, note,
      previous: r.currentTrend?.previous ? { value: r.currentTrend.previous.value, text: formatNumber(r.currentTrend.previous.value, r.decimals), at: r.currentTrend.previous.at } : null,
      percent: r.currentTrend?.percent ?? null,
      series: (r.currentSeries ?? []).map((p: any) => p.value),
    });
  }
  // the most recent first, then by the size of the change
  flagged.sort((a, b) => b.at.slice(0, 10).localeCompare(a.at.slice(0, 10)) || Math.abs(b.percent ?? 0) - Math.abs(a.percent ?? 0));
  return { items: flagged, normal };
}
