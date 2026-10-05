// The valve profile (valve module, slice 1): one view model for the "Valve disease" panel, notes and
// documents. Descriptive only: each native lesion with its severity on the problem list and on the
// latest echo, each prosthesis or repair with its date and type (and the INR target for a mechanical
// valve), the latest echo measurements, antithrombotic therapy and the latest INR, and the valve
// interventions — each with its date.
import { DIAGNOSIS, MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { ECHO_VALVES } from "../../shared/studies.js";
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
  };
}
export type ValveProfile = NonNullable<ReturnType<typeof valveProfile>>;
