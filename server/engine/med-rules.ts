// Medicine safety rules (medication coverage, slice 1). Two rules read the shared table in
// ./med-safety.ts (combinations of two medicines; a medicine with a condition in the record), so every
// module's medicines are checked in one place. A third rule carries the ESC AF 2024 class III B rows on
// antiplatelet therapy added to oral anticoagulation.
import { addDays, fmtDay, localDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
import { facts, safetyHits, type SafetyRow } from "./med-safety.js";
import { daptIndication } from "./valve-rules.js";
import { medicationOverlaps } from "../../shared/medication-identity.js";
import { DIAGNOSIS, MEDICATION } from "../../shared/catalog.js";
import { cockcroftGault, daysBetween } from "../../shared/clinical.js";
import { monitoringFor, targetCodes, type MonCheck, type MonContext } from "../../shared/drug-monitoring.js";
import { loadState, type MedState } from "../kernel/state.js";
import { bookingsAtStart } from "../../shared/drug-monitoring.js";
import { addPlanAction } from "../kernel/clinical.js";
import { ApiError, today, type Actor } from "../kernel/base.js";
import type { Q } from "../db/db.js";

// booked when a medicine is started from the drawer: every check point in the first 3 months, or the first
// periodic check(s); later points are chased by med.monitoring
function startBookings(s: PatientState, m: MedState) {
  const all = bookingsAtStart(m.code, m.tags, monContext(s, m));
  const chosen = all.filter(b => b.days <= 91);
  return chosen.length ? chosen : all.filter(x => x.days === all[0].days);
}
export function monitoringPreview(s: PatientState, code: string) {
  const d = MEDICATION[code];
  const m = { code, name: d.name, tags: d.tags, events: [], startedAt: s.today } as unknown as MedState;
  return startBookings(s, m).map(b => ({ key: `${b.check.id}:${b.days}`, title: `${b.check.what} (${m.name} monitoring)`, dueDate: addDays(s.today,b.days) }));
}
export async function bookMonitoringAtStart(tx: Q, actor: Actor, patientId: string, medicationId: string, contextId: string | null, dates: Record<string, string> = {}) {
  const s = await loadState(tx, patientId);
  const m = s.meds.find(x => x.id === medicationId);
  if (!m) return 0;
  const items = startBookings(s, m);
  const keys = new Set(items.map(b => `${b.check.id}:${b.days}`));
  if (Object.keys(dates).some(k => !keys.has(k))) throw new ApiError(400,"The monitoring schedule changed. Review its dates again.");
  for (const b of items)
    await addPlanAction(tx, actor, patientId, {
      category: "monitoring", title: `${b.check.what} (${m.name} monitoring)`, reason: `${m.name}: ${b.check.schedule} (${b.check.source})`,
      dueDate: dates[`${b.check.id}:${b.days}`] ?? addDays(today(), b.days), completesOn: "study" in b.check.target ? { type: "study", kind: b.check.target.study } : { type: "lab", codes: b.check.target.lab },
      contextId, medicationId,
    });
  return items.length;
}

// ---------- medicine monitoring (slice 2) ----------
const LAB_LABEL: Record<string, string> = { alt: "ALT", tsh: "TSH", haemoglobin: "haemoglobin", creatinine: "creatinine", potassium: "potassium", "ldl-c": "LDL-C" };
const TEMPLATE = (k: MonCheck) => {
  if ("study" in k.target) return k.target.study;
  const c = k.target.lab.join(",");
  return c === "haemoglobin,creatinine,alt" ? "mon-doac" : c.includes("potassium") ? "renal-k" : c === "ldl-c" ? "lipids" : c === "alt" ? "mon-lft" : c === "tsh" ? "mon-tsh" : c === "haemoglobin" ? "mon-hb" : "mon-renal";
};
export function monContext(s: PatientState, m: MedState): MonContext {
  const recent = (code: string, days: number) => {
    const o = s.resolved(code).current;
    return o?.status === "final" && o.value_num != null && daysBetween(localDay(o.effective_at), s.today) <= days ? o.value_num : null;
  };
  const cr = recent("creatinine", 180), wt = recent("weight", 365);
  const conds = s.conditions.filter((c) => c.status === "active");
  const since = addDays(s.today, -365);
  const start = [...m.events].reverse().find((e) => e.kind === "start" || e.kind === "restart")?.effective_at ?? m.startedAt ?? s.today;
  const change = [...m.events].reverse().find((e) => e.kind === "start" || e.kind === "restart" || e.kind === "increase")?.effective_at ?? start;
  return {
    age: s.patient.age, crcl: cr != null && wt != null ? cockcroftGault(cr, s.patient.age, wt, s.patient.sex) : null,
    egfr: recent("egfr", 365), lvef: recent("lvef", 3650),
    hf: conds.some((c) => DIAGNOSIS[c.code]?.tags.includes("hf")),
    acs: conds.some((c) => (c.code === "acs-stemi" || c.code === "acs-nstemi") && (!c.onset || localDay(c.onset) >= since)) || /acs/i.test(m.indication),
    daysOnDrug: daysBetween(localDay(start), s.today), daysSinceChange: daysBetween(localDay(change), s.today),
  };
}
// the latest result time for each code (labs) or the latest study of the kind
const latestOf = (s: PatientState, k: MonCheck): Record<string, string | null> =>
  "study" in k.target
    ? { [k.target.study]: s.studies.filter((x) => x.kind === (k.target as { study: string }).study).map((x) => x.performed_at).sort().pop() ?? null }
    : Object.fromEntries(k.target.lab.map((c) => [c, s.observations.filter((o) => o.code === c && o.status === "final" && localDay(o.effective_at) <= s.today).map((o) => o.effective_at).sort().pop() ?? null]));
const plannedFor = (s: PatientState, k: MonCheck) =>
  s.plan.some((p) => p.status === "planned" && ("study" in k.target ? p.completes_on?.type === "study" && p.completes_on.kind === k.target.study : p.completes_on?.type === "lab" && targetCodes(k.target).every((c) => (p.completes_on.codes ?? []).includes(c))));
const plusDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86400000).toISOString();

// the due item for one medicine and one check, or null
export function monitoringDue(s: PatientState, m: MedState, k: MonCheck) {
  const c = monContext(s, m);
  if (k.when && !k.when(c)) return null;
  const startEv = [...m.events].reverse().find((e) => e.kind === "start" || e.kind === "restart");
  const changeEv = [...m.events].reverse().find((e) => e.kind === "start" || e.kind === "restart" || e.kind === "increase");
  if (!startEv && !changeEv && m.events.some(e => e.kind === "continue" && /^Medication reconciliation:/.test(e.reason))) {
    const every = k.every?.(c);
    if (!every) return null; // a schedule after initiation needs an actual initiation date
    const latest = latestOf(s, k);
    const missing = Object.keys(latest).filter(code => !latest[code] || daysBetween(latest[code]!, s.today) > every);
    return missing.length ? { missing, dueDay: s.today, why: "routine monitoring; historical start date unknown", last: latest[missing[0]] } : null;
  }
  const anchor = (k.on === "start" ? startEv : changeEv ?? startEv)?.effective_at ?? m.startedAt;
  if (!anchor) return null;
  const latest = latestOf(s, k);
  const codes = Object.keys(latest);
  // post-change checks: the latest point that has come due needs a result after the previous point
  const passed = (k.after ?? []).filter((d) => localDay(plusDays(anchor, d)) <= s.today);
  if (k.after?.length && passed.length < k.after.length && !passed.length) return null; // first check not yet due
  if (passed.length) {
    const i = passed.length - 1, prev = i > 0 ? passed[i - 1] : 0;
    const boundary = prev ? plusDays(anchor, prev) : anchor;
    const missing = codes.filter((x) => !latest[x] || latest[x]! <= boundary);
    if (missing.length) return { missing, dueDay: localDay(plusDays(anchor, passed[i])), why: `${passed[i] < 14 ? `${passed[i]} days` : passed[i] < 60 ? `${Math.round(passed[i] / 7)} weeks` : `${Math.round(passed[i] / 30)} months`} after ${k.on === "start" ? "starting" : "the last start or dose increase"}`, last: null as string | null };
    if (passed.length < k.after!.length) return null;
  }
  // periodic checks: a result within the interval (the start counts as the baseline)
  const every = k.every?.(c);
  if (!every) return null;
  const startAt = startEv?.effective_at ?? m.startedAt ?? anchor;
  const due = codes.filter((x) => daysBetween(localDay(latest[x] && latest[x]! > startAt ? latest[x]! : startAt), s.today) > every);
  if (!due.length) return null;
  const ref = due.map((x) => (latest[x] && latest[x]! > startAt ? latest[x]! : startAt)).sort()[0];
  return { missing: due, dueDay: localDay(plusDays(ref, every)), why: `every ${every >= 360 ? "year" : every % 30 === 0 || every < 40 ? `${Math.round(every / 30)} month${every >= 60 ? "s" : ""}` : `${Math.round(every / 30.4)} months`}`, last: latest[due[0]] && latest[due[0]]! > startAt ? latest[due[0]] : null };
}

const tableRule = (id: string, kind: SafetyRow["kind"], title: string, evidence: string): RuleDef => ({
  id, kind: "clinical", title, inputs: ["meds", "conditions", "observations", "studies", "creatinine", "egfr", "weight", "lvef", "hr", "nyha"], defaultParams: {}, evidence,
  evaluate(s) {
    return safetyHits(s, kind).map(({ row, hit }) => ({
      key: `${row.id}:${hit.meds.map((m) => m.code).join("+")}`,
      signature: JSON.stringify([hit.meds.map(m=>[m.id,m.doseValue,m.frequency,m.route]).sort(),hit.reason]),
      severity: hit.severity ?? row.severity,
      title: row.title(hit),
      detail: hit.reason ? `${hit.reason}. ${row.detail}`.replace(/\.\. /, ". ") : row.detail,
      facts: [
        { label: "Medicines", value: hit.meds.map((m) => m.name).join(", ") },
        { label: "Source", value: row.source },
      ],
      // open the medicine to act on (the first named: the one the row's advice is about)
      missing: [], action: { type: "med-action", medicationId: hit.meds[0].id, label: `Review ${hit.meds[0].name}` },
    }) as Finding);
  },
});

export const MED_RULES: RuleDef[] = [
  {
    id:"med.renal-data",kind:"operational",title:"Renal safety check incomplete",inputs:["meds","creatinine","egfr","weight","conditions"],defaultParams:{},
    evidence:"Missing inputs for existing label renal checks: Cockcroft–Gault needs verified creatinine and weight; eGFR-based checks need verified renal function. Same freshness conventions as the safety table (creatinine 180 days, weight 365 days). AF DOAC input requests remain owned by af.doac-dose. No new dosing limit.",
    evaluate(s) {
      const f=facts(s);
      const afDoac=(m:MedState)=>m.tags.includes("doac") && (m.indication==="af" || ((!m.indication || m.indication==="unspecified") && s.tags.has("af")));
      const crclMeds=f.meds.filter(m=>["rosuvastatin","atenolol","sotalol","dronedarone","apixaban","rivaroxaban","edoxaban","dabigatran"].includes(m.code) && !afDoac(m));
      const egfrMeds=f.meds.filter(m=>["eplerenone","colchicine","metformin"].includes(m.code));
      const recent=(code:string,days:number)=>{const o=s.resolved(code).current;return o?.status==="final" && o.value_num!=null && daysBetween(localDay(o.effective_at),s.today)<=days;};
      const need=[(crclMeds.length && !recent("creatinine",180) || egfrMeds.length && f.egfr==null) && "creatinine",crclMeds.length && !recent("weight",365) && "weight"].filter(Boolean) as string[];
      if(!need.length)return [];
      const medicines=[...new Set([...crclMeds,...egfrMeds].map(m=>m.name))];
      return [{key:"renal-inputs",signature:JSON.stringify([[...crclMeds,...egfrMeds].map(m=>[m.id,m.doseValue,m.frequency]),need]),severity:"orange",title:"Renal dose checks need current inputs",detail:medicines.join(", ")+": record the missing verified inputs before judging dose suitability. eGFR does not replace Cockcroft–Gault for CrCl-based labels.",facts:[{label:"Medicines",value:medicines.join(", ")}],missing:need,action:{type:"add-labs",codes:need,label:"Add renal inputs"}}];
    },
  },
  {
    id:"med.regimen",kind:"operational",title:"Current medication details and ingredient overlap",
    inputs:["meds"],defaultParams:{},evidence:"Medication-list completeness and ingredient reconciliation (HFA/ESC polypharmacy consensus 2025, 10.1002/ejhf.3642). Missing regimen is not treatment failure; shared ingredients prompt review, not an automatic stop.",
    evaluate(s) {
      const live=s.meds.filter(m=>m.status==="active");
      const out:Finding[]=live.filter(m=>m.doseValue==null || !m.frequency || !m.route).map(m=>({
        key:`regimen:${m.id}`,signature:JSON.stringify([m.id,m.doseValue,m.frequency,m.route,m.lastChange?.id]),severity:"orange",
        title:`${m.name}: complete the recorded regimen`,detail:"Confirm the dose, frequency and route actually taken. Keep an unknown historical start date unknown.",
        facts:[{label:"Medicine",value:m.name}],missing:[m.doseValue==null && "Dose",!m.frequency && "Frequency",!m.route && "Route"].filter(Boolean) as string[],
        action:{type:"med-correct",medicationId:m.id,label:"Complete regimen"},
      }));
      for(const pair of medicationOverlaps(live)) out.push({
        key:`overlap:${[...pair.ids].sort().join(":")}`,signature:JSON.stringify(pair.ids.map(id=>{const m=live.find(m=>m.id===id)!;return [id,m.doseValue,m.frequency,m.lastChange?.id]})),severity:"orange",
        title:`${pair.names.join(" + ")}: review overlap`,detail:pair.detail+". Confirm intentional use or correct the recorded list; no automatic withdrawal.",facts:[{label:"Medicines",value:pair.names.join(" + ")}],missing:[],
        action:{type:"med-action",medicationId:pair.ids[0],label:"Review overlap"},
      });
      return out;
    },
  },
  tableRule("med.interaction", "interaction", "Medicine combination contraindicated or not recommended",
    "Ibuprofen with current anticoagulant/antiplatelet treatment increases bleeding risk (ibuprofen SmPC 4.4/4.5; apixaban SmPC 4.4/4.5), a caution rather than automatic anticoagulant withdrawal. Medicine safety table (server/engine/med-safety.ts), combinations of two current medicines, each row quoting its product label (EU/UK SmPC section) or guideline: PDE5 inhibitor + nitrate, riociguat + PDE5 inhibitor or nitrate, ivabradine + verapamil/diltiazem or a strong CYP3A4 inhibitor, ticagrelor / simvastatin / dronedarone / eplerenone / finerenone + a strong CYP3A4 inhibitor, dronedarone + dabigatran, sacubitril/valsartan + ACE inhibitor, two potassium-sparing medicines, eplerenone + ACEi + ARB, colchicine + P-gp/CYP3A4 inhibitor with renal or hepatic impairment, mavacamten + strong CYP3A4 inhibitor in a CYP2C19 poor or undetermined metaboliser (all section 4.3 contraindications: red); mavacamten + verapamil/diltiazem in a poor or undetermined metaboliser (reduce 5 → 2.5 mg or pause: orange), + omeprazole ≥40 mg/day (moderate CYP2C19 inhibitor: reduce one level: orange) or omeprazole 20 mg / esomeprazole / a strong CYP3A4 inhibitor in other phenotypes (monitor LVEF 4 weeks later: yellow) — Camzyos 4.5 Table 2; ACEi + ARB (4.4 not recommended) and DOAC + rifampicin (avoid: orange; caution: yellow); clopidogrel + omeprazole/esomeprazole (discouraged: yellow)."),
  tableRule("med.contraindication", "condition", "Medicine contraindicated or not recommended with a condition in the record",
    "Medicine safety table (server/engine/med-safety.ts), a current medicine with a condition or value in the record, each row quoting its product label section: dronedarone with heart failure / LV systolic dysfunction or permanent AF; dabigatran and dronedarone CrCl <30, sotalol CrCl <10; eplerenone and colchicine eGFR <30; flecainide with heart failure; propafenone with MI within 3 months or heart failure with LVEF <35%; diltiazem with heart rate <50 (all section 4.3: red); apixaban/rivaroxaban/edoxaban CrCl <15 or dialysis and DOACs with antiphospholipid syndrome (not recommended: orange); flecainide after MI or with severe valve disease, verapamil/diltiazem with LVEF ≤40%, ibuprofen with heart failure (orange; red at NYHA IV). On-treatment limits: mavacamten with LVEF <50% after the start (interrupt, red; Camzyos 4.2); ALT >3 × ULN on amiodarone (reduce or stop, orange), dronedarone (re-measure in 48–72 h, orange; confirmed on two results, withdraw, red) and bosentan (3–5 × confirm, orange; >5 × stop, >8 × do not reintroduce, red); dronedarone creatinine still rising after the first rise (yellow). ULN = the actual laboratory report upper reference limit recorded with each result; missing limits go to the liver result review. CrCl by Cockcroft–Gault from creatinine within 180 days and weight within 365 days."),
  {
    id: "med.oac-antiplatelet",
    kind: "clinical",
    title: "AF on anticoagulation with an antiplatelet and no PCI or ACS in the last 12 months",
    inputs: ["meds", "conditions", "procedures"],
    defaultParams: {},
    evidence: "2024 ESC AF guidelines: adding antiplatelet treatment to oral anticoagulation is not recommended in AF patients for the goal of preventing ischaemic stroke or thromboembolism (III B), nor to prevent recurrent embolic stroke (III B); antiplatelet therapy beyond 12 months is not recommended in stable patients with chronic coronary or vascular disease treated with oral anticoagulation (III B). Fires with AF or flutter listed, an oral anticoagulant and an antiplatelet, no PCI or ACS in the last 12 months (procedure record or dated diagnosis), no PCI/CABG diagnosis dated in the last 12 months, and no mechanical valve.",
    evaluate(s) {
      if (!s.tags.has("af") || s.tags.has("mechanical-valve")) return [];
      if (s.procedures.some(p => p.kind === "laao" && p.attributes.method === "Transcatheter occlusion" && p.attributes.result === "Implanted / completed")) return []; // LAAO-specific regimen review, never a generic antiplatelet stop.

      const meds = s.meds.filter((m) => m.status === "active");
      const oac = meds.filter((m) => m.tags.includes("oac"));
      const ap = meds.filter((m) => m.tags.includes("antiplatelet"));
      if (!oac.length || !ap.length || daptIndication(s)) return [];
      const since = addDays(s.today, -365);
      const recentRevasc = s.conditions.find((c) => (c.code === "prior-pci" || c.code === "prior-cabg") && c.status === "active" && c.onset && localDay(c.onset) >= since);
      if (recentRevasc) return [];
      const cabg = s.procedures.find((p) => p.kind === "cabg" && localDay(p.performed_at) >= since);
      if (cabg) return [];
      const cad = s.tags.has("cad") || s.tags.has("vascular") || s.tags.has("ascvd");
      return [{
        key: "oac-antiplatelet", signature: [...oac, ...ap].map((m) => m.id).sort().join(","), severity: "yellow",
        title: `AF on ${oac.map((m) => m.name).join(", ")} with ${ap.map((m) => m.name).join(", ")}: review the antiplatelet`,
        detail: cad
          ? "No PCI or ACS in the last 12 months: antiplatelet therapy beyond 12 months is not recommended in stable coronary or vascular disease treated with oral anticoagulation (III B). Anticoagulation alone, unless another indication is recorded."
          : "Adding an antiplatelet to oral anticoagulation is not recommended in AF to prevent stroke or thromboembolism (III B). Record the indication or review.",
        facts: [
          { label: "Anticoagulant", value: oac.map((m) => m.name).join(", ") },
          { label: "Antiplatelet", value: ap.map((m) => `${m.name}${m.startedAt ? ` since ${fmtDay(m.startedAt, { year: true })}` : ""}`).join(", ") },
          { label: "Guideline", value: "ESC AF 2024 · III B" },
        ],
        missing: [], action: { type: "med-action", medicationId: ap[0].id, label: `Review ${ap[0].name}` },
      } as Finding];
    },
  },
  {
    id: "med.monitoring",
    kind: "clinical",
    title: "Medicine monitoring due",
    inputs: ["meds", "observations", "studies", "plan", "conditions"],
    defaultParams: {},
    evidence: "Medicine monitoring schedules (shared/drug-monitoring.ts), each from the product label (UK/EU SmPC section) or a guideline / ESC practical guide: amiodarone transaminases and TSH every 6 months; dronedarone liver tests (1 week, 1 month, monthly to 6 months, months 9 and 12) and creatinine at 7 days; sotalol ECG/QTc 3 days after a start or dose change; DOAC haemoglobin, renal and liver function yearly, every 4 months at ≥75, every CrCl/10 months with CrCl ≤60 (EHRA 2021); metformin eGFR yearly, 6-monthly with eGFR <60 (label; KDIGO 2022); eplerenone potassium at 1 week and 1 month; spironolactone (HF) potassium and creatinine at 1 week, monthly for 3 months, quarterly for a year, then 6-monthly; finerenone potassium and eGFR at 4 weeks; ticagrelor renal function 1 month after starting in ACS; LDL-C 4–6 weeks after starting or intensifying lipid-lowering therapy (ESC/EAS 2025); bosentan transaminases monthly, haemoglobin monthly for 4 months then quarterly; macitentan and ambrisentan transaminases monthly, ambrisentan haemoglobin at 1 and 3 months; mavacamten echo at 4 and 8 weeks, then every 6 months (LVEF ≥55%) or 3 months (50–<55%). Due when the check point has passed with no result since the previous point and nothing booked. Quiet where another rule already covers it: the first potassium/creatinine check after a RAAS/MRA change within 30 days (ops.monitoring-after-change), amiodarone with no TSH ever (event.amiodarone-thyroid), LDL-C within 90 days of an ACS (ACS bundle).",
    evaluate(s) {
      const out: Finding[] = [];
      for (const m of s.meds.filter((x) => x.status === "active")) {
        for (const k of monitoringFor(m.code, m.tags)) {
          if (plannedFor(s, k)) continue;
          const change = [...m.events].reverse().find((e) => e.kind === "start" || e.kind === "restart" || e.kind === "increase");
          const labs = targetCodes(k.target);
          // left to ops.monitoring-after-change: the first K/Cr check within 30 days of a RAAS/MRA change
          if ((m.tags.includes("raas") || m.tags.includes("mra")) && labs.some((x) => x === "potassium" || x === "creatinine") && change && daysBetween(localDay(change.effective_at), s.today) <= 30
            && !["potassium", "creatinine"].every(code => s.observations.some((o) => o.code === code && o.effective_at > change.effective_at && o.status === "final" && localDay(o.effective_at) <= s.today))) continue;
          if (k.id === "amiodarone-tsh" && !s.resolved("tsh").current) continue;
          // LDL-C after a lipid-therapy change: the ACS bundle owns lipids for 90 days after an ACS, and with no LDL-C in
          // the last 12 months the lipid rule (lipids.ldl-goal) already asks for a lipid profile
          if (k.id === "lipids-after-change" && (s.conditions.some((c) => (c.code === "acs-stemi" || c.code === "acs-nstemi") && c.onset && daysBetween(localDay(c.onset), s.today) <= 90)
            || !s.observations.some((o) => o.code === "ldl-c" && o.status !== "entered_in_error" && daysBetween(localDay(o.effective_at), s.today) <= 365))) continue;
          const d = monitoringDue(s, m, k);
          if (!d) continue;
          const what = "study" in k.target ? k.what : d.missing.length === labs.length ? k.what : d.missing.map((x) => LAB_LABEL[x] ?? x).join(", ");
          out.push({
            key: `${k.id}:${m.id}`, signature: `${d.dueDay}:${d.missing.join(",")}`, severity: "yellow",
            title: `${what[0].toUpperCase()}${what.slice(1)} due on ${m.name}`,
            detail: `${d.why.includes("historical start date unknown") ? "Existing treatment; historical start date unknown. " : ""}${d.last ? `Last ${fmtDay(d.last, { year: true })}. ` : d.why.includes("historical start date unknown") ? "Required routine results are not recorded. " : "No result since the medicine was started or changed. "}Schedule: ${k.schedule} (${k.source}).`,
            facts: [
              { label: "Medicine", value: m.name },
              { label: "Due", value: `${fmtDay(d.dueDay, { year: true })} · ${d.why}` },
              { label: "Source", value: k.source },
            ],
            missing: [], action: { type: "add-plan", template: TEMPLATE(k), medicationId: m.id },
          } as Finding);
        }
      }
      return out;
    },
  },
];
