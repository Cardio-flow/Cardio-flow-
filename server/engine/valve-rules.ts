// Valve rules (valve module). Slice 1: a moderate or severe lesion graded on the latest echo that is
// not on the problem list, or is listed with a lower severity. Descriptive: the grade is the
// echocardiographer's; the valve rules read the problem list, so the lesion has to be listed.
import { DIAGNOSIS } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
import { SURVEILLANCE_DEFAULTS, latestValveEcho, valveSurveillance } from "./valve-profile.js";
import { localDay } from "../../shared/clinical.js";
import { formatNumber } from "../../shared/catalog.js";

const POS: Record<string, string> = { as: "Aortic", ar: "Aortic", "mr-primary": "Mitral", "mr-secondary": "Mitral", ms: "Mitral", tr: "Tricuspid" };
const LABEL: Record<string, string> = { as: "aortic stenosis", ar: "aortic regurgitation", "mr-primary": "primary mitral regurgitation", "mr-secondary": "secondary mitral regurgitation", ms: "mitral stenosis", tr: "tricuspid regurgitation" };
const INTERVENTION_PLANNED = /Heart Team|TAVI|valve replacement|valve repair|aortic regurgitation|TEER|commissurotomy|Tricuspid intervention/i;
// severe native lesions not yet treated (problem list or the latest echo), with where the grade comes from
export function severeUntreated(s: PatientState) {
  const treated = new Set(s.conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active").map((c) => c.attributes?.position));
  const e = latestValveEcho(s);
  const out: { code: string; from: string; at: string | null }[] = [];
  for (const c of s.conditions.filter((x) => POS[x.code] && x.status === "active" && x.attributes?.severity === "Severe"))
    if (!treated.has(POS[c.code])) out.push({ code: c.code, from: "problem list", at: c.onset ?? c.recorded_at });
  if (e) for (const [k, g] of Object.entries(e.valves)) {
    if (g !== "Severe") continue;
    const code = k === "mr" ? (e.mrType === "Secondary" ? "mr-secondary" : "mr-primary") : k;
    if (treated.has(POS[code])) continue;
    const have = out.find((o) => o.code === code);
    if (have) { have.from = "problem list and echo"; have.at = e.at; } else out.push({ code, from: "echo", at: e.at });
  }
  return out;
}
const echoFacts = (s: PatientState) => {
  const f = (code: string, label: string, unit: string, d = 0) => { const o = s.resolved(code).current; return o?.value_num != null ? { label, value: `${formatNumber(o.value_num, d)} ${unit}`, date: o.effective_at } : null; };
  const nyha = s.resolved("nyha").current;
  return [f("lvef", "LVEF", "%"), f("av-vmax", "AV Vmax", "m/s", 1), f("av-mg", "AV mean gradient", "mmHg"), f("ava", "AVA", "cm²", 2), f("lvesd", "LVESD", "mm"), f("spap", "SPAP", "mmHg"),
    nyha?.value_text ? { label: "NYHA", value: String(nyha.value_text), date: nyha.effective_at } : null, { label: "Age", value: String(s.patient.age) }].filter(Boolean) as Finding["facts"];
};

const RANK: Record<string, number> = { None: 0, Mild: 1, Moderate: 2, Severe: 3, Unknown: 0 };
const NAME: Record<string, string> = { as: "aortic stenosis", ar: "aortic regurgitation", mr: "mitral regurgitation", ms: "mitral stenosis", tr: "tricuspid regurgitation" };

export const VALVE_RULES: RuleDef[] = [
  {
    id: "valve.echo-lesion-unlisted",
    kind: "clinical",
    title: "Valve lesion on echo not on the problem list",
    inputs: ["studies", "conditions"],
    defaultParams: { days: 365 },
    evidence: "A moderate or severe valve lesion reported on echo drives the valve rules (intervention triggers, surveillance, antithrombotic therapy) only once it is on the problem list with its severity.",
    evaluate(s: PatientState, p) {
      const e = latestValveEcho(s);
      if (!e || (Date.parse(s.today) - Date.parse(e.at)) / 86400000 > Number(p.days)) return [];
      const out: Finding[] = [];
      for (const [valve, grade] of Object.entries(e.valves)) {
        if (RANK[grade] < 2) continue;
        const codes = valve === "mr" ? (e.mrType === "Primary" ? ["mr-primary"] : e.mrType === "Secondary" ? ["mr-secondary"] : ["mr-primary", "mr-secondary"]) : [valve];
        const c = s.conditions.find((x) => codes.includes(x.code) && x.status === "active");
        if (c && RANK[c.attributes?.severity ?? "Unknown"] >= RANK[grade]) continue;
        // a prosthesis in that position: the native-lesion grade is not a new diagnosis
        const pos = valve === "as" || valve === "ar" ? "Aortic" : valve === "tr" ? "Tricuspid" : "Mitral";
        if (s.conditions.some((x) => x.code === "prosthetic-valve" && x.status === "active" && x.attributes?.position === pos)) continue;
        const name = `${grade} ${valve === "mr" && e.mrType ? `${e.mrType.toLowerCase()} ` : ""}${NAME[valve]}`;
        out.push({
          key: `echo-${valve}`, signature: `${e.id}:${valve}`, severity: grade === "Severe" ? "orange" : "yellow",
          title: c
            ? `Echo ${fmtDay(e.at)}: ${name.toLowerCase()} — listed as ${String(c.attributes?.severity ?? "severity not recorded").toLowerCase()}`
            : `Echo ${fmtDay(e.at)}: ${name.toLowerCase()} — not on the problem list`,
          detail: `Update the problem list (${DIAGNOSIS[codes[0]]?.display ?? NAME[valve]}, severity ${grade.toLowerCase()}) so the valve rules can follow it.`,
          facts: [{ label: "Echo", value: `${grade} ${valve.toUpperCase()}`, date: e.at }, { label: "Problem list", value: c ? `${c.display} · ${c.attributes?.severity ?? "severity not recorded"}` : "Not listed" }],
          missing: [], action: { type: "history", focus: "cardiac", label: "Update history" },
        });
      }
      return out;
    },
  },
  {
    id: "valve.severe-heart-team",
    kind: "clinical",
    title: "Severe valve disease without a Heart Team decision",
    inputs: ["studies", "conditions", "pathways", "plan", "procedures"],
    defaultParams: {},
    evidence: "2025 ESC/EACTS valvular heart disease guidelines: the decision on intervention, its timing and mode is taken by the Heart Team, including lifetime management (I C); TR: Heart Team evaluation (I C).",
    evaluate(s) {
      const done = s.pathwaysDone["valve-heart-team"];
      const lastEcho = latestValveEcho(s)?.at ?? null;
      if (s.plan.some((p) => p.status === "planned" && INTERVENTION_PLANNED.test(p.title))) return [];
      return severeUntreated(s)
        .filter((l) => !done || localDay(done) < localDay(lastEcho && l.from !== "problem list" ? lastEcho : l.at ?? done))
        .map((l): Finding => ({
          key: `ht-${l.code}`, signature: `${l.code}:${lastEcho ?? l.at}`, severity: "orange",
          title: `Severe ${LABEL[l.code]}: Heart Team decision ${done ? "since the latest echo " : ""}not recorded`,
          detail: "Symptoms, LV function, age, surgical risk and anatomy: intervention and its route, or surveillance.",
          facts: [{ label: "Severe", value: `${LABEL[l.code]} (${l.from})`, date: l.at ?? undefined }, ...echoFacts(s), { label: "Guideline", value: "ESC/EACTS VHD 2025 · I C" }],
          missing: [], action: { type: "wizard", wizard: "valve-heart-team" },
        }));
    },
  },
  {
    id: "valve.intervention-trigger",
    kind: "clinical",
    title: "Severe valve disease with a class I intervention trigger",
    inputs: ["studies", "conditions", "lvef", "lvesd", "nyha", "height", "weight", "contexts", "plan", "procedures"],
    defaultParams: { asLvef: 50, arLvef: 50, arLvesd: 50, arLvesdi: 25, mrLvef: 60, mrLvesd: 40, mrLvesdi: 20 },
    evidence: "2025 ESC/EACTS valvular heart disease guidelines (class I): intervention in symptomatic severe AS and in asymptomatic severe AS with LVEF <50%; surgery in severe AR when symptomatic or with LVEF ≤50%, LVESD >50 mm or LVESDi >25 mm/m² (I B); surgery in severe primary MR when symptomatic or with LVESD ≥40 mm, LVESDi ≥20 mm/m² (new) or LVEF ≤60%. Read in the guideline summaries: Rev Esp Cardiol 2025 (AR), Eur Heart J Suppl 2026 (primary MR), EJPC 2026 comparison review (AS). Symptoms: NYHA ≥II, or dyspnoea, chest pain or syncope at the latest visit; LVESDi from LVESD and the Mosteller body-surface area.",
    evaluate(s, p) {
      if (s.plan.some((x) => x.status === "planned" && INTERVENTION_PLANNED.test(x.title))) return [];
      const ef = s.resolved("lvef").current?.value_num ?? null;
      const lvesd = s.resolved("lvesd").current?.value_num ?? null;
      const h = s.resolved("height").current?.value_num ?? null, w = s.resolved("weight").current?.value_num ?? null;
      const bsa = h && w ? Math.sqrt((h * w) / 3600) : null;
      const lvesdi = lvesd != null && bsa ? Math.round((lvesd / bsa) * 10) / 10 : null;
      const nyha = s.resolved("nyha").current?.value_text as string | undefined;
      const lastCtx = [...s.contexts].filter((c) => (c.summary as any)?.symptoms?.length).pop();
      const visitSym = (((lastCtx?.summary as any)?.symptoms as string[] | undefined) ?? []).filter((x) => /Dyspnoea|Orthopnoea|Chest pain|Syncope|exercise tolerance/i.test(x));
      const sym = nyha && nyha !== "I" ? `NYHA ${nyha}` : visitSym.length ? visitSym[0].toLowerCase() : null;
      const out: Finding[] = [];
      for (const l of severeUntreated(s)) {
        const why = l.code === "as" ? [sym, ef != null && ef < Number(p.asLvef) && `LVEF ${ef}%`]
          : l.code === "ar" ? [sym, ef != null && ef <= Number(p.arLvef) && `LVEF ${ef}%`, lvesd != null && lvesd > Number(p.arLvesd) && `LVESD ${lvesd} mm`, lvesdi != null && lvesdi > Number(p.arLvesdi) && `LVESDi ${lvesdi} mm/m²`]
          : l.code === "mr-primary" ? [sym, ef != null && ef <= Number(p.mrLvef) && `LVEF ${ef}%`, lvesd != null && lvesd >= Number(p.mrLvesd) && `LVESD ${lvesd} mm`, lvesdi != null && lvesdi >= Number(p.mrLvesdi) && `LVESDi ${lvesdi} mm/m²`]
          : [];
        const reasons = [...new Set(why.filter(Boolean) as string[])];
        if (!reasons.length) continue;
        out.push({
          key: `trig-${l.code}`, signature: `${l.code}:${reasons.join(",")}`, severity: "orange",
          title: `Severe ${LABEL[l.code]} with ${reasons.join(" and ")}: intervention indicated (class I)`,
          detail: "Heart Team: timing and route of intervention.",
          facts: [{ label: "Severe", value: `${LABEL[l.code]} (${l.from})` }, ...echoFacts(s), ...(lvesdi != null ? [{ label: "LVESDi", value: `${lvesdi} mm/m² (BSA ${bsa!.toFixed(2)} m²)` }] : []), { label: "Guideline", value: "ESC/EACTS VHD 2025 · class I" }],
          missing: [], action: { type: "wizard", wizard: "valve-heart-team" },
        });
      }
      return out;
    },
  },
  {
    id: "valve.echo-surveillance",
    kind: "clinical",
    title: "Valve echo surveillance due",
    inputs: ["studies", "conditions", "procedures", "plan"],
    defaultParams: SURVEILLANCE_DEFAULTS,
    evidence: "2025 ESC/EACTS: structured follow-up with regular echocardiography (no intervals stated in the text available); intervals from the 2020 ACC/AHA valvular heart disease guideline — Table 5: severe every 6–12 months, moderate every 1–2 years, mild every 3–5 years; Table 12: baseline TTE 1–3 months after intervention, transcatheter valve then yearly, surgical bioprosthesis at 5 and 10 years then yearly, mechanical valve baseline only. Due at the start of each range, overdue at its end.",
    evaluate(s, p) {
      if (s.plan.some((x) => x.status === "planned" && x.completes_on?.type === "study" && x.completes_on.kind === "echo")) return [];
      // severe lesion with an intervention already decided: the procedure, not surveillance
      const decided = s.plan.some((x) => x.status === "planned" && INTERVENTION_PLANNED.test(x.title) && !/Heart Team/.test(x.title));
      return valveSurveillance(s, p)
        .filter((i) => i.overdue || i.due)
        .filter((i) => !(decided && i.key === "native"))
        .map((i): Finding => ({
          key: i.key, signature: `${i.key}:${i.dueAt}`, severity: "yellow",
          title: `${i.what}: ${i.overdue ? `overdue since ${fmtDay(i.dueAt, { year: true })}` : `due by ${fmtDay(i.dueAt, { year: true })}`}`,
          detail: `${i.reason[0].toUpperCase()}${i.reason.slice(1)}${i.last ? `; last echo ${fmtDay(i.last, { year: true })}` : "; no echo recorded"}.`,
          facts: [{ label: "Last echo", value: i.last ? fmtDay(i.last, { year: true }) : "None" }, { label: "Interval", value: i.reason }],
          missing: [], action: { type: "add-plan", template: "valve-echo" },
        }));
    },
  },
];
