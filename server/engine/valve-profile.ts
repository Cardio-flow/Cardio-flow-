// The valve profile (valve module, slice 1): one view model for the "Valve disease" panel, notes and
// documents. Descriptive only: each native lesion with its severity on the problem list and on the
// latest echo, each prosthesis or repair with its date and type (and the INR target for a mechanical
// valve), the latest echo measurements, antithrombotic therapy and the latest INR, and the valve
// interventions — each with its date.
import { DIAGNOSIS, MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { ECHO_VALVES } from "../../shared/studies.js";
import { addDays, daysBetween, localDay } from "../../shared/clinical.js";
import { PROSTHESIS_TYPE } from "../../shared/procedures.js";
import type { PatientState } from "../kernel/state.js";
import { mechanicalInrTarget } from "./acute-rules.js";

const LESIONS: { code: string; valve: string; label: string }[] = [
  { code: "as", valve: "as", label: "Aortic stenosis" },
  { code: "ar", valve: "ar", label: "Aortic regurgitation" },
  { code: "mr-primary", valve: "mr", label: "Primary mitral regurgitation" },
  { code: "mr-secondary", valve: "mr", label: "Secondary mitral regurgitation" },
  { code: "ms", valve: "ms", label: "Mitral stenosis" },
  { code: "tr", valve: "tr", label: "Tricuspid regurgitation" },
];
const RANK: Record<string, number> = { None: 0, Mild: 1, Moderate: 2, Severe: 3 };
export const ECHO_CODES = ["av-vmax", "av-mg", "ava", "mva", "lvesd", "lvedd", "spap", "lvef"];

// the latest echo that graded the valves, with its grades
export function latestValveEcho(s: PatientState) {
  const e = s.studies
    .filter((x) => x.kind === "echo" && x.attributes?.valves && Object.keys(x.attributes.valves).length)
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))[0];
  return e ? { id: e.id, at: e.performed_at, valves: e.attributes.valves as Record<string, string>, mrType: (e.attributes.mrType as string | undefined) ?? null } : null;
}

export function valveProfile(s: PatientState) {
  const echo = latestValveEcho(s);
  const listed = s.conditions.filter((c) => LESIONS.some((l) => l.code === c.code) && c.status === "active");
  const prostheses = s.conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active");
  const procs = s.procedures.filter((p) => p.kind === "valve").sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  const echoLesions = echo ? ECHO_VALVES.filter((v) => RANK[echo.valves[v.key]] >= 2) : [];
  if (!listed.length && !prostheses.length && !procs.length && !echoLesions.length) return null;

  const lesions = LESIONS.flatMap((l) => {
    const c = listed.find((x) => x.code === l.code);
    const grade = echo?.valves[l.valve];
    // the echo grade belongs to this lesion (MR: by mechanism when the echo gives it)
    const mine = grade && (l.valve !== "mr" || !echo!.mrType || (echo!.mrType === "Primary") === (l.code === "mr-primary"));
    const echoGrade = mine && RANK[grade] >= 1 ? grade : null;
    if (!c && !(echoGrade && RANK[echoGrade] >= 2)) return [];
    const listedSeverity = (c?.attributes?.severity as string | undefined) ?? null;
    // a prosthesis or repair in this position: the native lesion is history, shown as treated
    const pos = l.valve === "as" || l.valve === "ar" ? "Aortic" : l.valve === "tr" ? "Tricuspid" : "Mitral";
    const pros = prostheses.find((x) => x.attributes?.position === pos);
    const proc = procs.find((x) => x.attributes.position === pos);
    return [{
      code: l.code, title: DIAGNOSIS[l.code]?.display ?? l.label, listed: !!c,
      severity: listedSeverity && listedSeverity !== "Unknown" ? listedSeverity : null,
      echo: echoGrade ? { grade: echoGrade, at: echo!.at } : null,
      since: c?.onset ?? null,
      detail: c?.attributes?.aetiology ?? null,
      treated: pros ? (proc ? `${proc.summary} · ${proc.performed_at.slice(0, 10)}` : `${pros.attributes?.type ?? "prosthesis"} in the ${pos.toLowerCase()} position`) : null,
    }];
  });

  const inr = mechanicalInrTarget(s);
  const latestInr = s.resolved("inr").current;
  const value = (code: string) => {
    const o = s.resolved(code).current;
    return o?.value_num != null ? { code, label: MEASURES[code].short, value: formatNumber(o.value_num, MEASURES[code].decimals), unit: MEASURES[code].unit, at: o.effective_at } : null;
  };
  const live = s.meds.filter((m) => m.status === "active" || m.status === "held");
  const drug = (m: (typeof live)[number]) => ({ name: m.name, dose: MEDICATION[m.code] ? `${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} ${m.frequency ?? ""}`.trim() : "", since: m.startedAt, held: m.status === "held" });

  return {
    lesions,
    prostheses: prostheses.map((c) => {
      const p = procs.find((x) => x.attributes.position === c.attributes?.position);
      return {
        position: (c.attributes?.position as string | undefined) ?? null, type: (c.attributes?.type as string | undefined) ?? "Prosthesis",
        design: c.attributes?.type === "Mechanical" && c.attributes?.design && c.attributes.design !== "Unknown" ? (c.attributes.design as string) : null,
        since: p ? p.performed_at : c.onset ?? (c.attributes?.onsetYear ? String(c.attributes.onsetYear) : null),
        procedure: p ? p.summary : null,
        inrTarget: c.attributes?.type === "Mechanical" && inr ? `${formatNumber(inr.target, 1)} (${formatNumber(inr.low, 1)}–${formatNumber(inr.high, 1)}) · ${inr.source === "recorded" ? "recorded" : "suggested"}` : null,
      };
    }),
    // native-valve numbers measured before a prosthesis or repair in that position no longer apply
    echo: {
      at: echo?.at ?? null,
      values: (ECHO_CODES.map(value).filter(Boolean) as NonNullable<ReturnType<typeof value>>[]).filter((x) => {
        const pos = ["av-vmax", "av-mg", "ava"].includes(x.code) ? "Aortic" : x.code === "mva" ? "Mitral" : null;
        const p = pos ? procs.find((y) => y.attributes.position === pos) : null;
        return !p || x.at >= p.performed_at;
      }),
    },
    anticoagulant: live.filter((m) => m.tags.includes("oac")).map(drug),
    antiplatelet: live.filter((m) => m.tags.includes("antiplatelet")).map(drug),
    inr: latestInr?.value_num != null ? { value: formatNumber(latestInr.value_num, 1), at: latestInr.effective_at } : null,
    events: procs.map((p) => ({ at: p.performed_at, title: p.summary, kind: p.attributes.procedure as string })),
    surveillance: valveSurveillance(s).map((i) => ({ what: i.what, dueAt: i.dueAt, overdue: i.overdue, reason: i.reason, last: i.last })),
  };
}
export type ValveProfile = NonNullable<ReturnType<typeof valveProfile>>;

// Echo surveillance (valve slice 3). Intervals are parameters of `valve.echo-surveillance`, which is in
// NEEDS_REVIEW: the 2025 guideline's follow-up intervals could not be read in full text, so these are
// the values from summaries of the ESC/EACTS guidance, held for the clinical owner's confirmation —
// severe asymptomatic native lesion every 6 months, moderate every 12, mild every 36; a baseline echo
// 30–90 days after a valve intervention; then a prosthesis or repair every 12 months.
export const SURVEILLANCE_DEFAULTS = { severeMonths: 6, moderateMonths: 12, mildMonths: 36, baselineFrom: 30, baselineBy: 90, prosthesisMonths: 12 };
const POSITION: Record<string, string> = { as: "Aortic", ar: "Aortic", mr: "Mitral", "mr-primary": "Mitral", "mr-secondary": "Mitral", ms: "Mitral", tr: "Tricuspid" };
const typeName = (t: string | null | undefined) => (!t ? "valve" : t === "TAVI" ? "TAVI" : t === "Mechanical" ? "mechanical valve" : t.toLowerCase());
const monthsLater = (day: string, m: number) => addDays(day, Math.round(m * 30.44));
export function valveSurveillance(s: PatientState, p: Record<string, any> = SURVEILLANCE_DEFAULTS) {
  const P = { ...SURVEILLANCE_DEFAULTS, ...p };
  const echoes = s.studies.filter((x) => x.kind === "echo").map((x) => localDay(x.performed_at)).sort();
  const lastEcho = echoes[echoes.length - 1] ?? null;
  const treated = new Set(s.conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active").map((c) => c.attributes?.position));
  const procs = s.procedures.filter((x) => x.kind === "valve").sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  const items: { key: string; what: string; dueAt: string; from?: string; months?: number; reason: string; last: string | null }[] = [];
  // post-intervention baseline: the latest intervention in each position without an echo since
  for (const pos of [...new Set(procs.map((x) => x.attributes.position as string))]) {
    const pr = procs.find((x) => x.attributes.position === pos)!;
    if (!PROSTHESIS_TYPE(pr.attributes) && pr.attributes.procedure !== "Balloon valvotomy") continue;
    const day = localDay(pr.performed_at);
    const after = echoes.filter((e) => e > day);
    const name = pr.summary.split(" · ")[0];
    // the baseline window applies to a recent intervention; an older one without an echo since is simply due
    if (!after.length && daysBetween(day, s.today) <= 365)
      items.push({ key: `baseline-${pos}`, what: `Baseline echo after ${name}`, from: addDays(day, P.baselineFrom), dueAt: addDays(day, P.baselineBy), reason: `${P.baselineFrom}–${P.baselineBy} days after the intervention`, last: null });
    else items.push({ key: `prosthesis-${pos}`, what: `Echo: ${pos.toLowerCase()} ${typeName(PROSTHESIS_TYPE(pr.attributes))} follow-up`, dueAt: after.length ? monthsLater(after[after.length - 1], P.prosthesisMonths) : s.today, months: P.prosthesisMonths, reason: `every ${P.prosthesisMonths} months`, last: after[after.length - 1] ?? null });
  }
  // listed prostheses without an intervention record
  for (const c of s.conditions.filter((x) => x.code === "prosthetic-valve" && x.status === "active" && !procs.some((y) => y.attributes.position === x.attributes?.position)))
    items.push({ key: `prosthesis-${c.attributes?.position}`, what: `Echo: ${String(c.attributes?.position ?? "").toLowerCase()} ${typeName(c.attributes?.type)} follow-up`, dueAt: lastEcho ? monthsLater(lastEcho, P.prosthesisMonths) : s.today, months: P.prosthesisMonths, reason: `every ${P.prosthesisMonths} months`, last: lastEcho });
  // the worst untreated native lesion (problem list or latest echo grade)
  const ve = latestValveEcho(s);
  const grades: { code: string; grade: string }[] = [
    ...s.conditions.filter((c) => POSITION[c.code] && c.status === "active" && RANK[c.attributes?.severity] >= 1).map((c) => ({ code: c.code, grade: c.attributes.severity as string })),
    ...(ve ? Object.entries(ve.valves).filter(([, g]) => RANK[g] >= 1).map(([k, g]) => ({ code: k, grade: g })) : []),
  ].filter((x) => !treated.has(POSITION[x.code]));
  const worst = grades.sort((a, b) => RANK[b.grade] - RANK[a.grade])[0];
  if (worst) {
    const m = worst.grade === "Severe" ? P.severeMonths : worst.grade === "Moderate" ? P.moderateMonths : P.mildMonths;
    items.push({ key: "native", what: `Echo: ${worst.grade.toLowerCase()} ${({ as: "AS", ar: "AR", mr: "MR", "mr-primary": "primary MR", "mr-secondary": "secondary MR", ms: "MS", tr: "TR" } as Record<string, string>)[worst.code]} surveillance`, dueAt: lastEcho ? monthsLater(lastEcho, m) : s.today, months: m, reason: `${worst.grade.toLowerCase()} lesion: every ${m} months`, last: lastEcho });
  }
  return items.map((i) => ({ ...i, overdue: i.dueAt < s.today, due: !!i.from && i.from <= s.today }));
}
