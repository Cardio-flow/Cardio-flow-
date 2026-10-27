import { consultationPriorities } from "../../shared/consultation.js";
import { isRoutinePlan } from "../../shared/routine.js";
import { planContext } from "../engine/plan-context.js";
import { overviewCounts } from "../../shared/overview.js";
import { pregnancyProfile } from "../engine/pregnancy-profile.js";
import { medicationReview } from "../engine/medication-review.js";
import { medicationOverlaps } from "../../shared/medication-identity.js";
import { needsExplicitReview } from "../../shared/plan-evidence.js";
import { correctedRefs } from "./corrections.js";
import { journeySummary } from "./journey-detail.js";
import { targets } from "../engine/guidelines.js";
import { hfProfile } from "../engine/hf-profile.js";
import { cadProfile } from "../engine/cad-profile.js";
import { rhythmProfile } from "../engine/rhythm-profile.js";
import { latestValveEcho, valveProfile } from "../engine/valve-profile.js";
import { cmpProfile } from "../engine/cmp-profile.js";
import { phProfile } from "../engine/ph-profile.js";
// Read models: Summary, What changed, Journey, Worklist. All are projections of the kernel.
import type { Q } from "../db/db.js";
import { BARRIER_LABEL, DIAGNOSIS, LABS, MEASURES, PURPOSE_ORDER, classLabel, doseLabel, drugClassOf, MEDICATION, formatNumber, formatRange } from "../../shared/catalog.js";
import { hfDoseProgress } from "../engine/medication-progress.js";
import { ageOn, bmi, daysBetween, fmtDay, localDay, planStatusView } from "../../shared/clinical.js";
import { historicalLabel } from "../../shared/procedures.js";
import { ANSWER_LABEL, HISTORY_ITEMS, RISK_FACTOR_CODES, attributesText, historyCode } from "../../shared/history.js";
import { activeBarrier, loadState, latestDischarge, openContext, series, type PatientState } from "./state.js";
import { WIZARDS } from "../../shared/wizards.js";
import { checklistForPlan } from "../../shared/procedures.js";
import { today as todayFn } from "./base.js";
import { linkAttention } from "../engine/links.js";
import { askToday, problemReasoning, sinceLastVisit } from "../engine/reasoning.js";
import { abnormal as abnormalView, chronology as chronologyView, standing as standingView, story as storyView, timeline as timelineView } from "./story.js";

const FAMILY_ORDER = ["Heart failure", "Cardiomyopathy", "Pulmonary hypertension", "Coronary", "Valve", "Congenital", "Arrhythmia", "Device", "Comorbidity"];
const SEVERITY_ORDER = { red: 0, orange: 1, yellow: 2, blue: 3 } as const;

// Suggestions that propose a drug of the same class (an SGLT2 inhibitor from the HF rule and from
// the diabetes rule, a GLP-1 RA from the diabetes and obesity rules, finerenone from the HF and
// cardiorenal rules) are shown once: the most urgent card carries the others as "also".
export function mergeKey(r: { action?: any }) {
  const a = typeof r.action === "string" ? JSON.parse(r.action) : r.action;
  // a start decided in a pathway (HF medicines, diabetes, AF-CARE, lipids) merges with the same drug class
  // suggested by another rule, as a direct start did (27 Oct 2026)
  if (a?.type === "wizard" && a.startCode) return `start:${drugClassOf(a.startCode)}`;
  if (a?.type !== "start-med") return null;
  return `start:${drugClassOf(a.code)}`;
}

// Alerts the clinician dismissed (not needed / not now) in the last 90 days, newest first, so a dismissal can
// be seen and undone. A dismissal ends when the data behind the alert change (the engine raises a new one).
export async function dismissed(tx: Q, patientId: string) {
  return (await tx.query(
    `SELECT r.id, r.rule_id, r.severity, r.title, r.closed_at, d.outcome, d.reason, d.decided_by
       FROM cf.recommendation r
       JOIN LATERAL (SELECT outcome, reason, decided_by FROM cf.decision WHERE recommendation_id=r.id ORDER BY decided_at DESC LIMIT 1) d ON true
      WHERE r.patient_id=$1 AND r.status='decided' AND d.outcome IN ('declined','deferred') AND r.closed_at > now() - interval '90 days'
        AND NOT EXISTS (SELECT 1 FROM cf.recommendation x WHERE x.patient_id=r.patient_id AND x.status='active' AND x.rule_id=r.rule_id AND x.fingerprint=r.fingerprint)
      ORDER BY r.closed_at DESC LIMIT 20`,
    [patientId],
  )).rows as any[];
}

export async function recommendations(tx: Q, patientId: string) {
  const rows = (
    await tx.query(
      `SELECT r.id,r.rule_id,r.rule_version,r.rule_status,r.rule_content_hash,r.severity,r.title,r.detail,r.facts,r.missing,r.action,r.created_at,v.evidence AS "ruleEvidence"
       FROM cf.recommendation r LEFT JOIN cf.rule_version v ON v.rule_id=r.rule_id AND v.version=r.rule_version
       WHERE r.patient_id=$1 AND r.status='active'`,
      [patientId],
    )
  ).rows as any[];
  rows.sort((a, b) => SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] - SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER] || String(a.created_at).localeCompare(String(b.created_at)));
  const out: any[] = [];
  const byKey = new Map<string, any>();
  for (const r of rows) {
    const key = mergeKey(r);
    const lead = key ? byKey.get(key) : null;
    if (lead) {
      lead.also.push({ id: r.id, rule_id: r.rule_id, rule_version: r.rule_version, rule_status: r.rule_status, ruleEvidence: r.ruleEvidence, title: r.title, detail: r.detail, facts: r.facts });
      continue;
    }
    const card = { ...r, also: [] as any[] };
    if (key) byKey.set(key, card);
    out.push(card);
  }
  return out;
}

export function header(s: PatientState) {
  const ef = s.resolved("lvef").current;
  const ctx = openContext(s);
  const dis = latestDischarge(s);
  let where = "Outpatient";
  if (s.deceased) where = `Deceased · ${fmtDay(s.status.vital!.effective_on, { year: true })}`;
  else if (ctx?.kind === "admission") where = `Inpatient${ctx.location ? ` · ${ctx.location}` : ""}`;
  else if (ctx?.kind === "clinic_visit") where = `In clinic · ${ctx.service ?? "OPD"}`;
  else if (dis && dis.ended_at && daysBetween(dis.ended_at, s.today) <= 30) where = `Post-discharge · day ${daysBetween(dis.ended_at, s.today)}`;
  return {
    id: s.patient.id,
    name: s.patient.name,
    mrn: s.patient.mrn,
    sample: s.patient.synthetic,
    birthDate: String(s.patient.birth_date).slice(0, 10),
    birthDateEstimated: s.patient.birth_date_estimated,
    sex: s.patient.sex,
    age: s.patient.age,
    allergies: s.patient.allergies,
    civilId: s.patient.civil_id,
    nationality: s.patient.nationality,
    mobile: s.patient.mobile,
    where,
    openContext: ctx,
    diagnoses: [...s.conditions].sort((a, b) => FAMILY_ORDER.indexOf(DIAGNOSIS[a.code]?.family ?? "") - FAMILY_ORDER.indexOf(DIAGNOSIS[b.code]?.family ?? "")).map((c) => ({
      id: c.logical_id,
      code: c.code,
      label: DIAGNOSIS[c.code]?.tags.includes("hf") && ef?.value_num != null ? `${c.display}${/\sEF$/.test(c.display) ? "" : " · EF"} ${formatRange(ef.value_num, ef.value_high, 0)}%` : conditionLabel(c),
      family: DIAGNOSIS[c.code]?.family ?? "Other",
      onset: c.onset,
      attributes: c.attributes ?? {},
      riskFactor: RISK_FACTOR_CODES.has(c.code),
    })),
    riskFactors: { ...riskRow(s), other: otherConditions(s) },
    // coronary disease as one line with its history (14 Oct 2026, Ahmed: "IHD post PCI" with numbers and dates)
    ihd: ihdSummary(s),
    // valve interventions, LAA closure, devices and ablations with their year (19 Oct 2026)
    structural: structuralSummary(s),
    // diagnosis tags (cad, ascvd, ckd, dm…): the overview groups its problems by them
    tags: [...s.tags],
    deceased: s.deceased,
    status: s.status,
    readmission: ctx?.kind === "admission" ? (ctx.summary as any)?.readmission ?? null : null,
  };
}

const MON = (d: string) => new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Asia/Kuwait" });
// a procedure's date as precise as it was recorded (past history may give only the year)
const WHEN = (p: { performed_at: string; attributes?: Record<string, any> }) => (p.attributes?.historical === "year" ? new Date(p.performed_at).toLocaleDateString("en-GB", { year: "numeric", timeZone: "Asia/Kuwait" }) : MON(p.performed_at));
const CORONARY = new Set(["cad-ccs", "prior-mi", "prior-pci", "prior-cabg", "acs-stemi", "acs-nstemi", "acs-ua", "ischaemic-cmp", "inoca"]);
// Cardiac history as dated events (19 Oct 2026, Ahmed: "in MI history and PCI, POBA where done it should
// show, and the diagnosis line should show the year of the MI and PCI"). One list feeds the diagnosis line,
// the coronary card and the History tab. Each event keeps the precision it was recorded with.
export type CardiacEvent = { at: string | null; when: string | null; group: "coronary" | "structural"; kind: string; title: string; short: string; detail: string; covers: string[]; ref: { type: "procedure" | "condition"; id: string } };
const condWhen = (c: { onset: string | null; attributes?: Record<string, any> }) => (c.onset ? MON(c.onset) : c.attributes?.onsetYear ? String(c.attributes.onsetYear) : null);
const condAt = (c: { onset: string | null; attributes?: Record<string, any> }) => c.onset ?? (c.attributes?.onsetYear ? `${c.attributes.onsetYear}-07-01` : null);
const YEAR = (when: string | null) => (when ? when.replace(/^[A-Z][a-z]{2} /, "") : null);
const PCI_DEV: Record<string, string> = { "Drug-eluting stent": "DES", "Drug-coated balloon": "DCB", "Balloon only": "POBA", "Bare-metal stent": "BMS" };
export function cardiacEvents(s: PatientState): CardiacEvent[] {
  const out: CardiacEvent[] = [];
  const conds = s.conditions.filter((c) => c.status === "active");
  for (const c of conds.filter((c) => ["acs-stemi", "acs-nstemi", "acs-ua", "prior-mi"].includes(c.code))) {
    const a = (c.attributes ?? {}) as Record<string, any>;
    const type = c.code === "prior-mi" ? (a.type && !["Unknown"].includes(a.type) ? a.type : "MI") : DIAGNOSIS[c.code].display;
    const terr = a.territory && a.territory !== "Unknown" ? `${a.territory} ` : "";
    const title = `${terr}${type}`;
    out.push({ at: condAt(c), when: condWhen(c), group: "coronary", kind: "mi", title, short: title, detail: (a.features ?? []).join(", "), covers: [], ref: { type: "condition", id: c.logical_id } });
  }
  const pcis = s.procedures.filter((p) => p.kind === "pci");
  for (const p of pcis) {
    const a = p.attributes ?? {};
    const devs: string[] = (a.devices ?? (a.device ? [a.device] : [])).map((d: string) => PCI_DEV[d] ?? d);
    const poba = devs.length > 0 && devs.every((d) => d === "POBA");
    const vessels = (a.vessels ?? []).join("/");
    const name = poba ? "POBA" : "PCI";
    const setting = a.setting === "stemi" ? "primary PCI" : a.setting === "nste-acs" ? "NSTE-ACS" : a.setting === "staged" ? "staged" : null;
    const stents = a.stents ? `${a.stents} ${devs.find((d) => d !== "POBA") ?? "stent"}${a.stents > 1 && !/^(DES|DCB|BMS)$/.test(devs[0] ?? "") ? "s" : ""}` : poba ? null : devs.join(" + ") || null;
    const detail = [stents, setting, a.reason ? `for ${String(a.reason).toLowerCase()}` : null, ...(a.complex ?? []).filter((x: string) => !/stents/.test(x)), ...(a.complications ?? [])].filter(Boolean).join(" · ");
    out.push({ at: p.performed_at, when: WHEN(p), group: "coronary", kind: "pci", title: `${name}${vessels ? ` ${vessels}` : ""}`, short: `${name}${vessels ? ` ${vessels}` : ""}`, detail, covers: [], ref: { type: "procedure", id: p.id } });
  }
  const priorPci = conds.find((c) => c.code === "prior-pci");
  if (priorPci && !pcis.length) {
    const v = ((priorPci.attributes as any)?.vessels ?? []).filter((x: string) => x !== "Unknown").join("/");
    out.push({ at: condAt(priorPci), when: condWhen(priorPci), group: "coronary", kind: "pci", title: `PCI${v ? ` ${v}` : ""}`, short: `PCI${v ? ` ${v}` : ""}`, detail: "", covers: [], ref: { type: "condition", id: priorPci.logical_id } });
  }
  const cabgs = s.procedures.filter((p) => p.kind === "cabg");
  for (const p of cabgs) out.push({ at: p.performed_at, when: WHEN(p), group: "coronary", kind: "cabg", title: "CABG", short: "CABG", detail: (p.attributes?.grafts ?? []).join(", "), covers: [], ref: { type: "procedure", id: p.id } });
  const priorCabg = conds.find((c) => c.code === "prior-cabg");
  if (priorCabg && !cabgs.length) out.push({ at: condAt(priorCabg), when: condWhen(priorCabg), group: "coronary", kind: "cabg", title: "CABG", short: "CABG", detail: ((priorCabg.attributes as any)?.grafts ?? []).join(", "), covers: [], ref: { type: "condition", id: priorCabg.logical_id } });
  // valve interventions, LAA closure, devices and ablations
  const procs = s.procedures.filter((p) => ["valve", "laao", "device", "ablation"].includes(p.kind) && p.attributes?.result !== "Aborted / not implanted" && p.attributes?.result !== "Aborted / no implant" && !(p.kind === "device" && ["Extraction", "Lead revision"].includes(p.attributes?.action)));
  for (const p of procs) {
    const label = historicalLabel(p.kind, p.attributes ?? {});
    const a = p.attributes ?? {};
    const detail = p.kind === "laao" ? (a.device && !/WATCHMAN|Amulet/i.test(label) ? a.device : /FLX/.test(String(a.device)) ? a.device : "") : p.kind === "device" && a.action && a.action !== "New implant" ? a.action : "";
    out.push({ at: p.performed_at, when: WHEN(p), group: "structural", kind: p.kind, title: label, short: label, detail, covers: p.kind === "valve" ? ["prosthetic-valve"] : p.kind === "device" ? ["cied"] : [], ref: { type: "procedure", id: p.id } });
  }
  // listed on the problem list without a recorded procedure
  if (!procs.some((p) => p.kind === "device")) for (const c of conds.filter((c) => c.code === "cied")) out.push({ at: condAt(c), when: condWhen(c), group: "structural", kind: "device", title: String((c.attributes as any)?.type ?? "Cardiac device"), short: String((c.attributes as any)?.type ?? "Cardiac device"), detail: "", covers: ["cied"], ref: { type: "condition", id: c.logical_id } });
  for (const c of conds.filter((c) => c.code === "prosthetic-valve" && !procs.some((p) => p.kind === "valve" && p.attributes?.position === (c.attributes as any)?.position)))
    out.push({ at: condAt(c), when: condWhen(c), group: "structural", kind: "valve", title: conditionLabel(c), short: conditionLabel(c), detail: "", covers: ["prosthetic-valve"], ref: { type: "condition", id: c.logical_id } });
  return out.sort((x, y) => (x.at ?? "").localeCompare(y.at ?? ""));
}

// coronary diagnoses that are not ischaemic heart disease: listed on their own (ectasia added 20 Oct 2026)
const NOT_IHD = new Set(["cad-suspected", "coronary-ectasia"]);
// "IHD · inferior STEMI 2017 · PCI LAD 2015 · POBA RCA 2017" and the dated events behind it
export function ihdSummary(s: PatientState) {
  const conds = s.conditions.filter((c) => c.status === "active" && (CORONARY.has(c.code) || (DIAGNOSIS[c.code]?.family === "Coronary" && !NOT_IHD.has(c.code))));
  const ev = cardiacEvents(s).filter((e) => e.group === "coronary");
  if (!conds.length && !ev.length) return null;
  const y = (e: CardiacEvent) => (YEAR(e.when) ? ` ${YEAR(e.when)}` : "");
  const mis = ev.filter((e) => e.kind === "mi"), pcis = ev.filter((e) => e.kind === "pci"), cabgs = ev.filter((e) => e.kind === "cabg");
  const lower = (t: string) => t.replace(/^(Anterior|Inferior|Lateral|Posterior) /, (m) => m.toLowerCase());
  const parts = [
    conds.some((c) => c.code === "cad-ccs") && !ev.length ? "chronic coronary syndrome" : null,
    // in date order: MIs, interventions by name and year (more than three PCIs as a count with the span), CABG
    ...(pcis.length > 3
      ? [...mis.map((e) => `${lower(e.short)}${y(e)}`), `PCI ×${pcis.length} (${YEAR(pcis[0].when) ?? "?"}–${YEAR(pcis[pcis.length - 1].when) ?? "?"})`, ...cabgs.map((e) => `CABG${y(e)}`)]
      : ev.map((e) => (e.kind === "mi" ? `${lower(e.short)}${y(e)}` : e.kind === "cabg" ? `CABG${y(e)}` : `${e.short}${y(e)}`))),
  ].filter(Boolean);
  return {
    label: `IHD${parts.length ? ` · ${parts.join(" · ")}` : ""}`,
    at: ev.find((e) => e.at)?.at ?? conds.map((c) => condAt(c)).filter(Boolean).sort()[0] ?? null,
    events: ev.map((e) => ({ at: e.at, text: `${e.title}${e.when ? ` ${e.when}` : ""}${e.detail ? ` · ${e.detail}` : ""}` })),
    codes: conds.map((c) => c.code), ids: conds.map((c) => c.logical_id),
  };
}

// structural interventions and devices as one line: "Mitral TEER (MitraClip) 2021 · Watchman LAA occluder 2019 · ICD 2017"
export function structuralSummary(s: PatientState) {
  // oldest first (20 Oct 2026: the diagnoses read in date order)
  const items = cardiacEvents(s).filter((e) => e.group === "structural");
  return items.length ? { label: items.map((i) => `${i.short}${YEAR(i.when) ? ` ${YEAR(i.when)}` : ""}`).join(" · "), items: items.map((i) => `${i.short}${YEAR(i.when) ? ` ${YEAR(i.when)}` : ""}`), at: items.map((i) => i.at), covers: [...new Set(items.flatMap((i) => i.covers))] } : null;
}

// The diagnosis list as the header shows it, for notes and summaries (19 Oct audit): heart failure /
// cardiomyopathy / PH first, IHD with its dated events, valve interventions and devices, the other cardiac
// diagnoses with their detail; then risk factors; then other conditions with a brief history.
export function diagnosisLines(s: PatientState) {
  const ihd = ihdSummary(s), st = structuralSummary(s);
  const ef = s.resolved("lvef").current;
  const covered = new Set([...(ihd?.codes ?? []), ...(st?.covers ?? [])]);
  // In date order (20 Oct 2026, Ahmed: "the diagnosis does not come in chronological way"): each cardiac
  // diagnosis with its year, oldest first; IHD dated by its first coronary event; undated ones after the dated.
  const cardiac = s.conditions
    .filter((c) => DIAGNOSIS[c.code] && DIAGNOSIS[c.code].family !== "Comorbidity" && !covered.has(c.code))
    .map((c) => {
      const at = condAt(c);
      const yr = at ? ` (since ${at.slice(0, 4)})` : "";
      return { at, text: DIAGNOSIS[c.code].tags.includes("hf") && ef?.value_num != null ? `${c.display} (LVEF ${formatRange(ef.value_num, ef.value_high, 0)}%)${yr}` : `${conditionLabel(c)}${yr}` };
    });
  const firstCoronary = ihd ? (cardiacEvents(s).find((e) => e.group === "coronary" && e.at)?.at ?? null) : null;
  const dated = [
    ...cardiac,
    ...(ihd ? [{ at: firstCoronary, text: ihd.label }] : []),
    ...(st?.items ?? []).map((text, i) => ({ at: st!.at[i], text })),
  ];
  const diagnoses = [...dated.filter((d) => d.at).sort((a, b) => a.at!.localeCompare(b.at!)), ...dated.filter((d) => !d.at)].map((d) => d.text);
  const yearOf = (c: any) => (c.onset ? ` (since ${new Date(c.onset).getFullYear()})` : c.attributes?.onsetYear ? ` (since ${c.attributes.onsetYear})` : "");
  const riskFactors = s.conditions.filter((c) => RISK_FACTOR_CODES.has(c.code) && !DIAGNOSIS[c.code]?.hidden)
    .sort((a, b) => (condAt(a) ?? "9999").localeCompare(condAt(b) ?? "9999")).map((c) => `${conditionLabel(c)}${yearOf(c)}`);
  const other = otherConditions(s).map((o) => `${o.label}${o.brief ? ` (${o.brief})` : ""}`);
  return { diagnoses, riskFactors, other };
}

// non-cardiac conditions with a brief history: onset, detail and the treatment for it
const TREATS: Record<string, string[]> = { thyroid: ["levothyroxine", "carbimazole", "propylthiouracil"], anaemia: ["oral-iron", "iv-iron"], copd: ["inhaler"], aps: ["vka"], gout: ["allopurinol", "febuxostat"] };
function otherConditions(s: PatientState) {
  return s.conditions
    .filter((c) => c.status === "active" && DIAGNOSIS[c.code]?.family === "Comorbidity" && !RISK_FACTOR_CODES.has(c.code) && !DIAGNOSIS[c.code]?.hidden)
    .sort((a, b) => (condAt(a) ?? "9999").localeCompare(condAt(b) ?? "9999"))
    .map((c) => {
      const label = conditionLabel(c);
      const since = c.onset ? `since ${MON(c.onset)}` : (c.attributes as any)?.onsetYear ? `since ${(c.attributes as any).onsetYear}` : "";
      // treated for it: a known treatment, or a medicine whose recorded indication names the condition
      const word = new RegExp(`\\b${DIAGNOSIS[c.code].display.split(/[ /(]/)[0]}`, "i");
      const on = s.meds.filter((m) => m.status === "active" && ((TREATS[c.code] ?? []).some((t) => m.code === t || m.tags.includes(t)) || word.test(m.indication ?? ""))).map((m) => `on ${m.name.toLowerCase().split(" (")[0]}`);
      return { id: c.logical_id, code: c.code, label, brief: [since, ...on].filter(Boolean).join(", ") };
    });
}

// "Prosthetic valve / repair · Aortic · Mechanical"
export function conditionLabel(c: { code: string; display: string; attributes?: Record<string, unknown> }) {
  const extra = attributesText(c.code, c.attributes);
  if (c.code === "cied" && c.attributes?.type) return String(c.attributes.type);
  if (c.code === "prosthetic-valve") {
    const pos = c.attributes?.position ? String(c.attributes.position) : "";
    const type = String(c.attributes?.type ?? "");
    const what = type === "Mechanical" ? "mechanical valve" : type.startsWith("Bioprosthetic") ? "bioprosthetic valve" : type === "TAVI" ? "TAVI" : type === "Repair / ring" ? "valve repair (ring)" : type === "Edge-to-edge repair (clip)" ? "TEER (clip)" : type === "Transcatheter valve" ? "transcatheter valve" : "valve prosthesis or repair";
    return `${pos} ${what}`.trim().replace(/^./, (x) => x.toUpperCase());
  }
  return extra ? `${c.display} · ${extra}` : c.display;
}

export function currentBmi(s: PatientState) {
  const w = s.resolved("weight").current, h = s.resolved("height").current;
  if (!w?.value_num || !h?.value_num || daysBetween(w.effective_at, s.today) > 365) return null;
  return { value: Math.round(bmi(w.value_num, h.value_num) * 10) / 10, at: w.effective_at };
}

type HxStatus = "present" | "absent" | "unknown" | "not-assessed" | "na" | "not-recorded";
// Structured history: every item says present / absent / unknown / not assessed / not recorded,
// with its date and where it came from. Nothing missing is shown as "no".
export function historyView(s: PatientState) {
  const b = currentBmi(s);
  const covered = new Set(HISTORY_ITEMS.flatMap((i) => i.conditions ?? []));
  const items = HISTORY_ITEMS.map((item) => {
    const stmt = s.resolved(historyCode(item.key)).current;
    const conds = item.conditions ? s.conditions.filter((c) => item.conditions!.includes(c.code)) : [];
    let status: HxStatus = "not-recorded";
    let text = "Not recorded";
    let at: string | null = null;
    let source: "diagnosis" | "history" | null = null;
    let conflict: string | null = null;
    const details: Record<string, number> = {};
    if (item.conditions) {
      if (conds.length) {
        status = "present";
        text = conds.map((c) => conditionLabel(c)).join(" · ");
        source = "diagnosis";
      } else if (stmt?.value_text) {
        status = stmt.value_text === "no" ? "absent" : (stmt.value_text as HxStatus);
        text = ANSWER_LABEL[stmt.value_text] ?? stmt.value_text;
        at = stmt.effective_at;
        source = "history";
      }
    } else {
      const legacy = item.key === "smoking" ? s.conditions.find((c) => c.code === "smoker") : undefined;
      if (stmt?.value_text) {
        const opt = item.options!.find((o) => o.value === stmt.value_text);
        status = opt?.present ? "present" : stmt.value_text === "unknown" || stmt.value_text === "not-assessed" ? (stmt.value_text as HxStatus) : "absent";
        const detail = (item.details ?? [])
          .map((d) => {
            const o = s.resolved(`${historyCode(item.key)}.${d.key}`).current;
            if (!o || o.effective_at !== stmt.effective_at || o.value_num == null || !d.when.includes(stmt.value_text!)) return null;
            details[d.key] = o.value_num;
            return d.key === "quitYear" ? `stopped ${o.value_num}` : `${formatNumber(o.value_num, 0)} ${d.label.toLowerCase()}`;
          })
          .filter(Boolean);
        text = [opt?.label ?? stmt.value_text, ...detail].join(" · ");
        at = stmt.effective_at;
        source = "history";
        if (legacy && stmt.value_text !== "current") conflict = `Diagnosis list still says "Current smoker" (added ${fmtDay(legacy.recorded_at, { year: true })})`;
      } else if (legacy) {
        status = "present";
        text = "Current smoker";
        source = "diagnosis";
        conflict = "Recorded only as a diagnosis: confirm the smoking status";
      }
    }
    if (item.key === "obesity" && b) text = `${text} · BMI ${formatNumber(b.value, 1)}`;
    return {
      key: item.key, section: item.section, label: item.label, short: item.short, major: !!item.major,
      status, text, at, source, conflict,
      answer: stmt?.value_text ?? null,
      details,
      conditions: conds.map((c) => ({ id: c.logical_id, code: c.code, display: c.display, label: conditionLabel(c), onset: c.onset, onsetYear: c.attributes?.onsetYear ?? null, attributes: c.attributes ?? {} })),
    };
  });
  const comorbidities = s.conditions
    .filter((c) => !covered.has(c.code) && c.code !== "smoker")
    .map((c) => ({ id: c.logical_id, code: c.code, label: conditionLabel(c), family: DIAGNOSIS[c.code]?.family ?? "Other", onset: c.onset, onsetYear: c.attributes?.onsetYear ?? null, attributes: c.attributes ?? {} }));
  return {
    items,
    bmi: b,
    comorbidities,
    // 19 Oct 2026: past cardiac events by date, the IHD line, and other conditions with a brief history
    timeline: cardiacEvents(s),
    ihd: ihdSummary(s),
    others: otherConditions(s),
    identity: { civilId: s.patient.civil_id, nationality: s.patient.nationality, mobile: s.patient.mobile, allergies: s.patient.allergies, sample: s.patient.synthetic, name: s.patient.name, mrn: s.patient.mrn, sex: s.patient.sex, birthDate: String(s.patient.birth_date).slice(0, 10), birthDateEstimated: s.patient.birth_date_estimated },
    missing: items.filter((i) => i.status === "not-recorded").map((i) => i.label),
  };
}

// Compact risk-factor row for the patient header.
function riskRow(s: PatientState) {
  const h = historyView(s);
  const risk = h.items.filter((i) => i.section === "risk");
  const present = risk
    .filter((i) => i.status === "present")
    .map((i) => ({
      key: i.key,
      label:
        i.key === "smoking" ? (i.text.startsWith("Ex") ? "Ex-smoker" : "Current smoker")
        : i.key === "ckd" ? i.conditions.map((c) => c.display.replace(" (with albuminuria)", "")).join(", ")
        : i.key === "diabetes" ? i.conditions.map((c) => (c.code === "t1dm" ? "Type 1 diabetes" : c.code === "t2dm" ? "Type 2 diabetes" : c.display)).join(", ")
        : i.key === "obesity" && h.bmi ? `Obesity · BMI ${formatNumber(h.bmi.value, 1)}`
        : i.short,
      major: i.major && !(i.key === "smoking" && i.text.startsWith("Ex")),
      conflict: !!i.conflict,
    }));
  if (h.bmi && !present.some((p) => p.key === "obesity")) present.push({ key: "bmi", label: `BMI ${formatNumber(h.bmi.value, 1)}`, major: false, conflict: false });
  return {
    present,
    absent: risk.filter((i) => i.status === "absent").length,
    unknown: risk.filter((i) => i.status === "unknown" || i.status === "not-assessed").length,
    notRecorded: risk.filter((i) => i.status === "not-recorded").map((i) => i.short),
  };
}

// a medicine given for a cardiomyopathy (e.g. a beta-blocker for obstructive HCM) is listed there,
// not under its catalogue purpose
const CMP_INDICATIONS = new Set(["hcm", "dcm", "ndlvc", "arvc", "rcm", "amyloid"]);
const purposeOf = (m: { purpose: string; indication: string }) => (CMP_INDICATIONS.has(m.indication) ? "Cardiomyopathy" : m.purpose);
export function medicationGroups(s: PatientState) {
  const live = s.meds.filter((m) => m.status !== "stopped");
  const groups = PURPOSE_ORDER.map((purpose) => ({
    purpose,
    meds: live
      .filter((m) => purposeOf(m) === purpose)
      .map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        drugClass: m.drugClass,
        status: m.status,
        dose: doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit),
        doseValue: m.doseValue,
        frequency: m.frequency,
        route: m.route,
        startedAt: m.startedAt,
        preexisting: !!m.preexisting && !m.startedAt,
        tags: m.tags,
        indication: m.indication,
        targetProgress: hfDoseProgress(s, m),
        lastChange: m.lastChange ? { kind: m.lastChange.kind === "continue" && /^Frequency changed/.test(m.lastChange.reason) ? "frequency" : m.lastChange.kind, at: m.lastChange.effective_at } : null,
        planned: s.plan.find((p) => p.status === "planned" && p.medication_id === m.id) ?? null,
      })),
  })).filter((g) => g.meds.length);
  const stopped = s.meds.filter((m) => m.status === "stopped").map((m) => ({ id: m.id, name: m.name, stoppedAt: m.lastChange?.effective_at ?? null }));
  // several medicines whose only entry is a "start" on the same day: often the patient's existing list typed in
  // at registration — offer to record them as already taking (start dates not known)
  const single = live.filter((m) => !m.preexisting && m.events.length === 1 && m.events[0].kind === "start");
  const byDay = new Map<string, string[]>();
  for (const m of single) { const d = localDay(m.events[0].effective_at); byDay.set(d, [...(byDay.get(d) ?? []), m.id]); }
  const bulk = [...byDay.entries()].filter(([, ids]) => ids.length >= 2).sort((a, b) => b[1].length - a[1].length)[0];
  return { groups, stopped, warnings: medicationOverlaps(s.meds), history: medicationHistory(s), recordedTogether: bulk ? { day: bulk[0], ids: bulk[1] } : null };
}

export function medicationHistory(s: PatientState) {
  const rows = s.meds.flatMap((m) => {
    let dose: number | null = null, unit: string | null = null, frequency: string | null = null, route: string | null = null;
    const line = () => [doseLabel(MEDICATION[m.code], dose, unit), frequency, route].filter(Boolean).join(" ");
    return m.events.map((e, order) => {
      const before = dose != null ? line() : null;
      if (e.kind !== "planned") {
        if (e.dose_value != null) { dose = e.dose_value; unit = e.dose_unit; }
        if (e.frequency) frequency = e.frequency;
        if (e.route) route = e.route;
      }
      const kind = e.kind === "continue" && /^Medication reconciliation:/.test(e.reason) ? "reconciliation" : e.kind === "continue" && /^Frequency changed/.test(e.reason) ? "frequency" : e.kind;
      return { id: e.id, medicationId: m.id, name: m.name, code: m.code, kind, at: e.effective_at, order,
        before, after: e.kind === "planned" ? [doseLabel(MEDICATION[m.code], e.dose_value, e.dose_unit), e.frequency, e.route].filter(Boolean).join(" ") : line(), reason: e.reason };
    });
  });
  return rows.sort((a, b) => b.at.localeCompare(a.at) || b.order - a.order);
}

const KEY_RESULTS = [...new Set(["potassium", "creatinine", "egfr", "sodium", "haemoglobin", "nt-probnp", "ldl-c", "hba1c", ...LABS.map((l) => l.code)])];

export function results(s: PatientState, codes = KEY_RESULTS) {
  return codes
    .map((code) => {
      const r = s.resolved(code);
      if (!r.current) return null;
      const def = MEASURES[code];
      const latest = r.latest!;
      const comparable = r.history.filter((o) => o.status === "final" && o.value_num != null && o.unit === latest.unit && o.effective_at <= latest.effective_at);
      // A corrected version is not a new measurement; compare strictly earlier effective times.
      const previous = latest.status === "final" && latest.value_num != null ? comparable.find((o) => o.effective_at < latest.effective_at) ?? null : null;
      const delta = previous ? latest.value_num! - previous.value_num! : null;
      const percent = previous && previous.value_num !== 0 ? delta! / Math.abs(previous.value_num!) * 100 : null;
      return {
        code,
        label: def?.short ?? code,
        display: def?.display ?? code,
        unit: def?.unit ?? "",
        decimals: def?.decimals ?? 0,
        ref: def?.ref ?? null,
        current: { id: r.current.id, value: r.current.value_num, valueHigh: r.current.value_high ?? null, referenceHigh:r.current.reference_high ?? null, at: r.current.effective_at, quality: r.current.quality, source: r.current.source },
        reason: r.reason,
        latestId: r.latest?.id,
        latest: { id: latest.id, value: latest.value_num, valueHigh: latest.value_high ?? null, referenceHigh:latest.reference_high ?? null, at: latest.effective_at, status: latest.status, source: latest.source },
        trend: { previous: previous ? { id: previous.id, value: previous.value_num, at: previous.effective_at } : null, delta, percent,
          direction: delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
          note: latest.status === "preliminary" ? "Awaiting verification" : !previous ? "First comparable result" : percent == null ? "Previous result was zero" : null },
        displaySeries: latest.status === "final" ? comparable.slice(0, 6).reverse().map((o) => ({ value: o.value_num, at: o.effective_at })) : [],
        series: r.history.slice(0, 6).reverse().map((o) => ({ id: o.id, value: o.value_num, valueHigh: o.value_high ?? null, referenceHigh:o.reference_high ?? null, at: o.effective_at, status: o.status, quality: o.quality })),
      };
    })
    .filter(Boolean);
}

// Compares now with the last reference point (discharge, else last closed visit).
export function whatChanged(s: PatientState) {
  const dis = latestDischarge(s);
  const lastVisit = [...s.contexts].reverse().find((c) => c.status === "closed" && c.kind === "clinic_visit");
  const ref = [dis, lastVisit].filter(Boolean).sort((a, b) => ((a!.ended_at ?? "") < (b!.ended_at ?? "") ? 1 : -1))[0] ?? null;
  if (!ref?.ended_at) return { since: null, label: null, items: [] as any[] };
  const since = ref.ended_at;
  const items: { kind: string; label: string; before?: string; after?: string; tone?: string; text?: string }[] = [];
  const valueAt = (code: string, at: string) =>
    s.resolved(code).history.find((o) => o.effective_at <= at && o.status === "final") ??
    // for discharge the admission's last value is the baseline
    null;
  const direction: Record<string, "up-bad" | "down-bad" | "neutral"> = {
    potassium: "up-bad", creatinine: "up-bad", egfr: "down-bad", weight: "up-bad", "nt-probnp": "up-bad", lvef: "down-bad", sodium: "down-bad", haemoglobin: "down-bad",
  };
  for (const code of ["potassium", "creatinine", "egfr", "weight", "nt-probnp", "lvef", "sodium", "haemoglobin"]) {
    const now = s.resolved(code).current;
    const before = valueAt(code, since);
    if (!now || !before || now.id === before.id || now.effective_at <= since) continue;
    const def = MEASURES[code];
    const diff = now.value_num! - before.value_num!;
    if (Math.abs(diff) < 10 ** -(def.decimals + 1)) continue;
    const bad = direction[code] === "up-bad" ? diff > 0 : direction[code] === "down-bad" ? diff < 0 : false;
    const ref = def.ref;
    const out = (x: number) => !!ref && ((ref.high != null && x > ref.high) || (ref.low != null && x < ref.low));
    const outOfRange = out(now.value_num!);
    // small moves inside the reference range are noise, not change
    if (ref && !outOfRange && !out(before.value_num!) && Math.abs(diff) / Math.max(Math.abs(before.value_num!), 1e-9) < 0.1) continue;
    items.push({
      kind: "value",
      label: def.display,
      before: formatNumber(before.value_num!, def.decimals),
      after: formatNumber(now.value_num!, def.decimals),
      text: def.unit,
      tone: bad ? (outOfRange ? "red" : "orange") : "green",
    });
  }
  const medChanges = s.meds.flatMap((m) =>
    m.events.filter((e) => e.effective_at > since && e.kind !== "continue").map((e) => ({ m, e })),
  );
  const started = medChanges.filter((x) => x.e.kind === "start").map((x) => x.m.name);
  if (started.length) items.push({ kind: "text", label: "Started", text: started.join(", ") });
  for (const x of medChanges.filter((x) => x.e.kind === "increase" || x.e.kind === "decrease"))
    items.push({ kind: "text", label: x.e.kind === "increase" ? "Increased" : "Reduced", text: `${x.m.name} → ${doseLabel(MEDICATION[x.m.code], x.e.dose_value)}` });
  const held = medChanges.filter((x) => x.e.kind === "hold" || x.e.kind === "stop").map((x) => `${x.m.name} (${x.e.kind === "hold" ? "held" : "stopped"})`);
  if (held.length) items.push({ kind: "text", label: "Held / stopped", text: held.join(", "), tone: "orange" });
  const completed = s.plan.filter((p) => p.status === "completed" && p.completed_at && p.completed_at > since);
  if (completed.length) items.push({ kind: "text", label: "Completed", text: completed.map((p) => p.title).join(", "), tone: "green" });
  const cong = s.resolved("congestion");
  if (cong.current && cong.current.effective_at > since) {
    const prev = cong.history.find((o) => o.effective_at <= since);
    if (prev && prev.value_text !== cong.current.value_text)
      items.push({ kind: "value", label: "Congestion", before: prev.value_text ?? "", after: cong.current.value_text ?? "", tone: cong.current.value_text === "None" ? "green" : "orange" });
  }
  return { since, label: ref.kind === "admission" ? "Since discharge" : "Since last visit", items };
}

export function planView(s: PatientState) {
  const withState = s.plan.map((p) => ({
    id: p.id,
    category: p.category,
    clinicalContext: planContext(s, p),
    title: p.title,
    reason: p.reason,
    dueDate: p.due_date,
    status: p.status,
    view: p.status === "completed" && p.progress === "performed" ? "review" : planStatusView(p.status, p.due_date, s.today),
    owner: p.owner,
    progress: p.progress,
    awaitingReview: p.status === "completed" && p.progress === "performed",
    reviewedAt: p.reviewed_at,
    reviewedBy: p.reviewed_by,
    evidence: (p.completion_refs ?? []).map((id) => {
      const original = s.observations.find((o) => o.id === id || o.logical_id === id);
      const o = original && s.observations.find((o) => o.logical_id === original.logical_id);
      if (o) return { id: o.id, label: MEASURES[o.code]?.display ?? o.code, value: o.value_num, valueHigh: o.value_high ?? null, unit: o.unit, at: o.effective_at };
      const procedure = s.procedures.find(pr => pr.id === id);
      if (procedure) return { id, label: procedure.summary, value: null, unit: null, at: procedure.performed_at };
      const study = s.studies.find((st) => st.id === id);
      return study ? { id, label: study.kind, value: null, unit: null, at: study.performed_at } : { id, label: "Recorded event", value: null, unit: null, at: p.completed_at };
    }),
    outcome: p.outcome,
    completedAt: p.completed_at,
    source: (() => {
      const c = s.contexts.find((c) => c.id === p.source_context_id);
      if (!c) return null;
      // an admission still open has an admission plan; it becomes the discharge plan at discharge (19 Oct audit)
      return { kind: c.kind, at: c.ended_at ?? c.started_at, label: c.kind === "admission" ? (c.ended_at ? "Discharge plan" : "Admission plan") : "Visit plan" };
    })(),
    completesOn: {...p.completes_on, requiresReview: needsExplicitReview(p.title,p.completes_on)},
    indications: p.indications ?? [p.title], decisionRefs: p.decision_refs ?? [],
    version: p.version,
    medicationId: p.medication_id,
    // a planned procedure with a checklist before it
    checklist: p.status === "planned" ? checklistForPlan(p.title, p.category) : null,
  }));
  const order = { overdue: 0, review: 1, due: 2, planned: 3, done: 4, deferred: 5, cancelled: 6, superseded: 7 } as Record<string, number>;
  return withState.sort((a, b) => order[a.view] - order[b.view] || (a.dueDate ?? "9") .localeCompare(b.dueDate ?? "9"));
}

// Guideline goals are clinical content still in review: shown on sandbox sites only.
export async function summary(tx: Q, patientId: string, siteMode: "sandbox" | "production" = "production") {
  const s = await loadState(tx, patientId);
  const plan = planView(s);
  // the active plan: what came out of the most recent plan-making context plus anything still open
  const lastSource = [...s.contexts].reverse().find((c) => s.plan.some((p) => p.source_context_id === c.id));
  const active = plan.filter((p) => p.view !== "cancelled" && p.view !== "superseded" && (p.status === "planned" || p.awaitingReview || (lastSource && s.plan.find((x) => x.id === p.id)?.source_context_id === lastSource.id)));
  // linked decisions: facts from elsewhere in the record, and dependent alerts folded under their decision
  const attention: any[] = linkAttention(s, await recommendations(tx, patientId)).map(a => {
    const task = a.action?.type === "plan" ? plan.find(p => p.id === a.action.planId) : null;
    return task ? { ...a, clinicalContext: task.clinicalContext } : a;
  });
  const changes = whatChanged(s);
  // the echo-surveillance intervals are shown only where their rule runs (sandbox, or once approved)
  const surveillanceLive = (siteMode === "sandbox" && s.patient.synthetic) || ((await tx.query(`SELECT 1 FROM cf.rule_version WHERE rule_id='valve.echo-surveillance' AND status='PUBLISHED' LIMIT 1`)).rows.length > 0);
  const valve = valveProfile(s);
  if (valve && !surveillanceLive) valve.surveillance = [];
  const head = header(s);
  const goals = targets(s);
  const res = results(s);
  return {
    consultation: consultationPriorities(attention, plan, s.today, s.meds),
    header: head,
    currentLvef: (()=>{ const r=s.resolved("lvef"), o=r.current; return o?.value_num != null ? {value:o.value_num,high:o.value_high,at:o.effective_at,quality:o.quality,source:o.source,reason:r.reason,id:o.id} : null; })(),
    // the overview as a story (20 Oct 2026): story, where things stand, one timeline, abnormal results once
    story: storyView(s),
    chronology: chronologyView(s, cardiacEvents(s)),
    standing: standingView(s),
    timeline: timelineView(s),
    // problem solving (20 Oct 2026, stage 2): reasoning per card, follow-through, what to ask and examine today
    reasoning: problemReasoning(s),
    followUp: sinceLastVisit(s),
    ask: askToday(s, attention),
    abnormal: abnormalView(s, res, { ldl: goals.ldl ? { goal: goals.ldl.goal, met: goals.ldl.met } : null, hba1c: goals.diabetes ? { target: goals.diabetes.target, met: goals.diabetes.met } : null }),
    today: s.today,
    overview: overview(s, attention, plan, changes),
    reviewContext: {
      // the latest value of what the decisions need (problems at a glance reads dates and gaps from here)
      results: ["potassium", "creatinine", "egfr", "sbp", "dbp", "hr", "weight", "sodium", "haemoglobin", "ferritin", "tsat", "ldl-c", "hba1c", "uacr", "inr", "nt-probnp", "tsh"].map((code) => {
        const o = s.resolved(code).current;
        return { code, label: MEASURES[code]?.short ?? code, value: o?.value_num ?? null, unit: MEASURES[code]?.unit ?? "", at: o?.effective_at ?? null };
      }),
      medicines: s.meds.filter((m) => ["active", "held", "not_taking"].includes(m.status) && m.tags.some((t) => ["raas", "arni", "bb", "mra", "loop", "sglt2", "oac", "antiplatelet"].includes(t)))
        .map((m) => ({ id: m.id, name: m.name, dose: m.doseValue == null ? "Dose not recorded" : MEDICATION[m.code] ? doseLabel(MEDICATION[m.code], m.doseValue) : `${m.doseValue} ${m.doseUnit ?? ""}`, frequency: m.frequency, status: m.status })),
    },
    attention,
    dismissed: await dismissed(tx, patientId),
    changes,
    plan: active,
    planSource: lastSource ? { kind: lastSource.kind, at: lastSource.ended_at ?? lastSource.started_at } : null,
    medications: medicationGroups(s),
    medicationReview: medicationReview(s,attention),
    pregnancy:pregnancyProfile(s),
    results: res,
    // the last echo's valve grades: the echo form offers "same as last echo"
    lastEcho: (() => {
      const e = latestValveEcho(s);
      return e ? { at: e.at, valves: e.valves, mrType: e.mrType } : null;
    })(),
    lvef: (() => {
      const r = s.resolved("lvef");
      return r.current ? { value: r.current.value_num, valueHigh: r.current.value_high ?? null, referenceHigh:r.current.reference_high ?? null, at: r.current.effective_at, quality: r.current.quality, reason: r.reason, latestQuality: r.latest?.quality, latestAt: r.latest?.effective_at, latestValue: r.latest?.value_num } : null;
    })(),
    vitals: ["sbp", "dbp", "hr", "weight"].map((c) => {
      const cur = s.resolved(c).current;
      return cur ? { code: c, value: cur.value_num, at: cur.effective_at, contextId:cur.context_id, source:cur.source } : null;
    }).filter(Boolean),
    // the last recorded NYHA class and congestion: "same as last visit" in the visit assessment (19 Oct 2026)
    lastAssessment: Object.fromEntries((["nyha", "congestion"] as const).map((c) => { const o = s.resolved(c).current; return [c, o?.value_text ? { value: o.value_text, at: o.effective_at } : null]; })),
    upcoming: plan.filter((p) => p.status === "planned" && p.dueDate && p.dueDate > s.today).slice(0, 4),
    // guideline goals: shown on every site (rules justified by current guidelines are published)
    targets: goals,
    // HF profile: type with dates, LVEF history, status, therapy per drug (HF patients only)
    hf: hfProfile(s),
    // coronary profile: events with dates, antithrombotic regimen with planned stops, lipids (CAD patients)
    cad: cadProfile(s),
    rhythm: rhythmProfile(s),
    valve,
    cmp: cmpProfile(s),
    ph: phProfile(s),
    // complications followed as episodes (open, and resolved in the last 30 days)
    episodes: episodesView(s),
    // why a drug class is not given (recorded once, reused by every rule)
    barriers: s.barriers.map((b) => ({
      cls: b.drug_class, label: classLabel(b.drug_class), category: b.category, reason: BARRIER_LABEL[b.category], detail: b.detail, at: b.effective_at,
      active: !!activeBarrier(s, b.drug_class), lasting: b.category === "intolerance" || b.category === "contraindication",
    })),
  };
}

// The five questions at the top of the patient page (blueprint P1.10).
export function overview(s: PatientState, attention: any[], plan: ReturnType<typeof planView>, changes: ReturnType<typeof whatChanged>) {
  const ctx = openContext(s);
  const dis = latestDischarge(s);
  const lastVisit = [...s.contexts].reverse().find((c) => c.kind === "clinic_visit" && c.status === "closed");
  let why: { text: string; sub?: string };
  if (s.deceased) why = { text: `Deceased ${fmtDay(s.status.vital!.effective_on, { year: true })}` };
  else if (ctx?.kind === "admission")
    why = { text: `Admitted ${fmtDay(ctx.started_at)} · day ${daysBetween(ctx.started_at, s.today) + 1}`, sub: ctx.reasons.join(", ") || undefined };
  else if (ctx?.kind === "clinic_visit") why = { text: `In clinic today · ${ctx.service ?? "OPD"}`, sub: ctx.reasons.join(", ") || undefined };
  else if (dis?.ended_at && daysBetween(dis.ended_at, s.today) <= 30)
    why = { text: `Discharged ${fmtDay(dis.ended_at)} · day ${daysBetween(dis.ended_at, s.today)}`, sub: dis.reasons.join(", ") || undefined };
  else why = { text: lastVisit ? `Last seen ${fmtDay(lastVisit.started_at, { year: true })}` : "No visit recorded yet", sub: lastVisit?.reasons.join(", ") || undefined };
  const sev = (k: string) => attention.filter((a) => a.severity === k).length;
  const unfinished = plan.filter((p) => !isRoutinePlan(p) && (p.view === "overdue" || p.view === "due"));
  const next = plan.filter(p => !isRoutinePlan(p)).filter(p => (p.status === "planned" && (p.dueDate || p.clinicalContext.urgent)) || p.awaitingReview)
    .sort((a, b) => Number(b.clinicalContext.urgent) - Number(a.clinicalContext.urgent) ||
      Number(b.awaitingReview) - Number(a.awaitingReview) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  return {
    why,
    changed: { since: changes.since, label: changes.label, count: changes.items.length, top: changes.items.slice(0, 3).map((i: any) => i.after != null ? `${i.label} ${i.before ?? "—"} → ${i.after}` : i.text ?? i.label) },
    attention: { red: sev("red"), orange: sev("orange"), yellow: sev("yellow"), blue: sev("blue"), top: attention[0]?.title ?? null },
    unfinished: { overdue: unfinished.filter((p) => p.view === "overdue").length, due: unfinished.filter((p) => p.view === "due").length, review: plan.filter((p) => p.awaitingReview).length, top: unfinished.slice(0, 2).map((p) => p.title) },
    counts: overviewCounts(attention, plan),
    next: next.slice(0, 2).map((p) => ({ id: p.id, title: p.title, dueDate: p.dueDate, view: p.view })),
  };
}

export async function journey(tx: Q, patientId: string) {
  const s = await loadState(tx, patientId);
  const events = (
    await tx.query(
      `SELECT id,occurred_at,kind,category,title,detail,ref_type,ref_id,context_id FROM cf.clinical_event WHERE patient_id=$1 ORDER BY occurred_at, recorded_at`,
      [patientId],
    )
  ).rows.map((e: any) => ({ ...e, occurred_at: new Date(e.occurred_at).toISOString(), planned: false }));
  // entries corrected away (entered in error) leave the journey with them
  const hidden = await correctedRefs(tx, patientId);
  events.splice(0, events.length, ...events.filter((e: any) => !(e.ref_id && hidden.has(String(e.ref_id)))));
  const liveIds = new Set(s.contexts.map(c => c.id));
  events.splice(0, events.length, ...events.filter(e => e.ref_type !== "care_context" || liveIds.has(String(e.ref_id))).map(e => {
    const c = s.contexts.find(c => c.id === e.ref_id && e.ref_type === "care_context");
    if (c) {
      e.dateOnly = c.summary.dateOnly === true;
      if (e.kind === "admission" || e.kind === "clinic-visit") {
        e.occurred_at = c.started_at;
        e.title = c.kind === "admission" ? `${c.summary.historical ? "Past admission" : "Admitted"} · ${c.reasons.join(", ")}` : `${c.service} visit`;
        e.detail = [c.location, c.reasons.join(", "), c.summary.historical ? `Source: ${c.summary.source}` : null, c.summary.narrative].filter(Boolean).join(" · ");
      } else if (e.kind === "discharge") {
        e.occurred_at = c.ended_at ?? e.occurred_at;
        e.title = c.summary.historical ? `Past admission ended · day ${c.summary.los}` : c.summary.outcome === "died" ? `Died in hospital · day ${c.summary.los}` : `Discharged · day ${c.summary.los}${e.title.match(/ · \d+ plan actions? created$/)?.[0] ?? ""}`;
        e.detail = [c.summary.dischargeStatus,c.summary.destination,(c.summary.events as string[] | undefined)?.length ? "Events: " + (c.summary.events as string[]).join(", ") : null].filter(Boolean).join(" · ");
      }
    }
    if (e.context_id && !liveIds.has(e.context_id)) e.context_id = null;
    return e;
  }));
  const planned = s.plan
    .filter((p) => p.status === "planned" && p.due_date && p.due_date > s.today)
    .map((p) => ({
      id: "plan-" + p.id, occurred_at: p.due_date + "T09:00:00.000Z", kind: "planned", category: "plan", title: p.title, detail: p.reason,
      ref_type: "plan_action", ref_id: p.id, context_id: p.source_context_id, planned: true,
    }));
  const actionViews = new Map(planView(s).map(a => [a.id, a]));
  const projectAction = (a: typeof s.plan[number]) => {
    const { id, title, dueDate, progress, view } = actionViews.get(a.id)!;
    return { id, title, dueDate, progress, view };
  };
  const contexts = s.contexts.map((c) => {
    const actions = s.plan.filter((p) => p.source_context_id === c.id || (p.context_refs ?? []).includes(c.id));
    const meds = s.meds.flatMap((m) =>
      m.events
        .filter((e) => e.effective_at >= c.started_at && (!c.ended_at || e.effective_at <= c.ended_at) && e.kind !== "continue")
        .map((e) => ({ name: m.name, kind: e.kind, dose: doseLabel(MEDICATION[m.code], e.dose_value, e.dose_unit), frequency: e.frequency, route: e.route })),
    );
    return {
      id: c.id, version: c.version, kind: c.kind, status: c.status, startedAt: c.started_at, endedAt: c.ended_at, location: c.location, service: c.service, reasons: c.reasons, summary: c.summary,
      actions: actions.map(projectAction),
      meds,
    };
  });
  const projected = [...events, ...planned].map(e => {
    const ctx = e.ref_type === "care_context" ? contexts.find(c => c.id === e.ref_id) : null;
    // A decision shows its own actions, even outside an admission. Never infer ownership from dates.
    const actions = ctx?.actions ?? s.plan.filter(a => e.ref_type === "decision" ? (a.decision_id === e.ref_id || (a.decision_refs ?? []).includes(e.ref_id)) : e.ref_type === "plan_action" && a.id === e.ref_id).map(projectAction);
    const meds = ctx?.meds ?? (e.ref_type === "decision" ? s.meds.flatMap(m => m.events.filter(ev => ev.decision_id === e.ref_id && ev.kind !== "continue").map(ev => ({ name: m.name, kind: ev.kind, dose: doseLabel(MEDICATION[m.code], ev.dose_value, ev.dose_unit), frequency: ev.frequency, route: ev.route }))) : []);
    return { ...e, linked: { actions, meds }, reading: e.category === "complication" && e.ref_type === "decision" ? journeySummary(e.detail ?? "", actions.map(a => a.title), meds.map(m => m.name)) : null };
  });
  return { today: s.today, events: projected, contexts };
}

// One set-based query for the whole list (latency to the database dominates, not query cost).
// sample = the synthetic demonstration patients; the default list is real patients only
export async function worklist(q: Q, siteId: string, sample = false) {
  const today = todayFn();
  const rows = (
    await q.query<any>(
      `SELECT p.id, p.name, p.mrn, p.sex, p.birth_date,
         oc.kind AS open_kind, oc.location AS open_location, oc.service AS open_service,
         ld.ended_at AS last_discharge,
         coalesce(cd.codes, '{}') AS codes,
         tr.severity AS top_severity, tr.title AS top_title, tr.rule_status AS top_status,
         rc.recs,
         nx.title AS next_title, nx.due_date AS next_due, ls.last_seen,
         coalesce(pc.overdue,0) overdue, coalesce(pc.due_today,0) due_today, coalesce(pc.review,0) awaiting_review
       FROM cf.patient p
       LEFT JOIN LATERAL (SELECT kind, location, service FROM cf.care_context c WHERE c.patient_id=p.id AND c.removed_at IS NULL AND c.status='open' ORDER BY started_at DESC LIMIT 1) oc ON true
       LEFT JOIN LATERAL (SELECT ended_at FROM cf.care_context c WHERE c.patient_id=p.id AND c.removed_at IS NULL AND c.kind='admission' AND c.status='closed' ORDER BY ended_at DESC LIMIT 1) ld ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(code) codes FROM (SELECT DISTINCT ON (logical_id) code, status FROM cf.condition c WHERE c.patient_id=p.id ORDER BY logical_id, version DESC) x WHERE status='active'
       ) cd ON true
       LEFT JOIN LATERAL (
         SELECT severity, title, rule_status FROM cf.recommendation r WHERE r.patient_id=p.id AND r.status='active'
         ORDER BY CASE severity WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'yellow' THEN 2 ELSE 3 END, created_at DESC LIMIT 1
       ) tr ON true
       LEFT JOIN LATERAL (
         SELECT coalesce(json_agg(json_build_object('s', severity, 'a', action) ORDER BY CASE severity WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'yellow' THEN 2 ELSE 3 END), '[]') recs
         FROM cf.recommendation r WHERE r.patient_id=p.id AND r.status='active'
       ) rc ON true
       LEFT JOIN LATERAL (SELECT max(coalesce(ended_at, started_at)) last_seen FROM cf.care_context c WHERE c.patient_id=p.id AND c.removed_at IS NULL) ls ON true
       LEFT JOIN LATERAL (SELECT title, due_date FROM cf.plan_action a WHERE a.patient_id=p.id AND a.status='planned' AND a.due_date IS NOT NULL ORDER BY due_date LIMIT 1) nx ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status='planned' AND due_date < $2::date) overdue, count(*) FILTER (WHERE status='planned' AND due_date = $2::date) due_today,
                count(*) FILTER (WHERE status='completed' AND progress='performed') review
         FROM cf.plan_action a WHERE a.patient_id=p.id
       ) pc ON true
       WHERE p.site_id=$1 AND p.removed_at IS NULL AND p.synthetic = $3
         AND coalesce((SELECT status FROM cf.status_event se WHERE se.patient_id=p.id AND se.kind='vital' ORDER BY effective_on DESC, recorded_at DESC LIMIT 1), 'alive') <> 'died'`,
      [siteId, today, sample],
    )
  ).rows;
  const out = rows.map((r) => {
    const codes: string[] = r.codes ?? [];
    const conds = codes.map((c) => DIAGNOSIS[c]).filter(Boolean);
    // as the header reads (19 Oct audit): coronary codes as one "IHD", HF first, then valve, congenital, rhythm
    const order = ["Heart failure", "Cardiomyopathy", "Coronary", "Valve", "Congenital", "Arrhythmia"];
    const main = [...new Set(conds.filter((d) => order.includes(d.family)).sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family))
      .map((d) => (d.family === "Coronary" && !NOT_IHD.has(d.code) ? "IHD" : d.code === "prosthetic-valve" ? "Valve intervention" : d.display)))];
    const ckd = conds.find((d) => d.code.startsWith("ckd"));
    let where = "Outpatient";
    if (r.open_kind === "admission") where = `Inpatient${r.open_location ? ` · ${r.open_location}` : ""}`;
    else if (r.open_kind === "clinic_visit") where = `In clinic · ${r.open_service ?? "OPD"}`;
    else if (r.last_discharge && daysBetween(new Date(r.last_discharge).toISOString(), today) <= 30)
      where = `Post-discharge · day ${daysBetween(new Date(r.last_discharge).toISOString(), today)}`;
    const nextDue = r.next_due ? String(r.next_due).slice(0, 10) : null;
    return {
      id: r.id,
      name: r.name,
      mrn: r.mrn,
      sample,
      age: ageOn(String(r.birth_date).slice(0, 10), today),
      sex: r.sex,
      where,
      inpatient: r.open_kind === "admission",
      postDischarge: where.startsWith("Post-discharge"),
      problem: [...main.slice(0, 2), ...(ckd ? [ckd.display] : [])].join(" · ") || conds[0]?.display || "—",
      alert: r.top_severity ? { severity: r.top_severity, title: r.top_title, draft: r.top_status !== "PUBLISHED" } : null,
      alertCounts: countMerged(typeof r.recs === "string" ? JSON.parse(r.recs) : r.recs ?? []),
      next: r.next_title ? { title: r.next_title, dueDate: nextDue, view: planStatusView("planned", nextDue, today) } : null,
      // 19 Oct 2026 (audit): when nothing is planned, say so for patients outside hospital, with the last contact
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      overdue: Number(r.overdue),
      dueToday: Number(r.due_today),
      awaitingReview: Number(r.awaiting_review),
    };
  });
  const rank = (r: any) => (r.alert ? SEVERITY_ORDER[r.alert.severity as keyof typeof SEVERITY_ORDER] : 9) * 10 - (r.overdue ? 1 : 0) - (r.awaitingReview ? 0.5 : 0);
  out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return out;
}

// alert counts with same-class drug suggestions counted once (as on the patient page)
function countMerged(recs: { s: string; a: any }[]) {
  const seen = new Set<string>();
  const c = { red: 0, orange: 0, yellow: 0, blue: 0 } as Record<string, number>;
  for (const r of recs) {
    const k = mergeKey({ action: r.a });
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    c[r.s] = (c[r.s] ?? 0) + 1;
  }
  return c;
}

export async function attentionCount(q: Q, siteId: string, sample = false) {
  const r = (
    await q.query<{ n: number }>(
      `SELECT count(*)::int n FROM cf.patient p
       WHERE p.site_id=$1 AND p.removed_at IS NULL AND p.synthetic = $2 AND (
         EXISTS (SELECT 1 FROM cf.recommendation r WHERE r.patient_id=p.id AND r.status='active' AND r.severity IN ('red','orange'))
         OR EXISTS (SELECT 1 FROM cf.plan_action a WHERE a.patient_id=p.id AND a.status='completed' AND a.progress='performed'))
         AND coalesce((SELECT status FROM cf.status_event se WHERE se.patient_id=p.id AND se.kind='vital' ORDER BY effective_on DESC, recorded_at DESC LIMIT 1), 'alive') <> 'died'`,
      [siteId, sample],
    )
  ).rows[0];
  return Number(r?.n ?? 0);
}

export { fmtDay };

// Complication episodes (migration 004): what was decided, what is still open, what is on hold,
// how the pathway's lead value moved since the start, and the next dated step.
export function episodesView(s: PatientState) {
  return s.episodes
    .filter((e) => e.status === "open" || (e.resolved_at && daysBetween(e.resolved_at, s.today) <= 30))
    .map((e) => {
      const def = WIZARDS[e.wizard];
      const ids = new Set(e.decisions.map((d) => d.id));
      const items = s.plan.filter((p) => ((p.decision_id && ids.has(p.decision_id)) || (p.decision_refs ?? []).some(id => ids.has(id))) && p.status !== "superseded" && p.status !== "cancelled");
      const open = items.filter((p) => p.status === "planned").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
      const held = s.meds.filter((m) => m.status === "held" && m.events.some((ev) => ev.kind === "hold" && ev.decision_id && ids.has(ev.decision_id)));
      let trend = null;
      if (def?.trend && MEASURES[def.trend]) {
        const h = series(s, def.trend);
        const now = h[0];
        const before = h.find((o) => o.effective_at <= e.started_at);
        if (now) trend = {
          label: MEASURES[def.trend].short, unit: MEASURES[def.trend].unit,
          start: before && before.id !== now.id ? { value: formatNumber(before.value_num!, MEASURES[def.trend].decimals), at: before.effective_at } : null,
          now: { value: formatNumber(now.value_num!, MEASURES[def.trend].decimals), at: now.effective_at },
        };
      }
      const last = e.decisions[e.decisions.length - 1];
      return {
        id: e.id, wizard: e.wizard, title: def?.title ?? e.wizard, tone: def?.tone ?? "blue", status: e.status,
        startedAt: e.started_at, day: daysBetween(e.started_at, e.resolved_at ?? s.today) + 1,
        reviews: Math.max(0, e.decisions.length - 1), lastAt: last?.decided_at ?? e.started_at,
        resolvedAt: e.resolved_at, outcome: e.outcome, note: e.note,
        done: items.filter((p) => p.status === "completed").length, total: items.length,
        next: open[0] ? { id: open[0].id, title: open[0].title, due: open[0].due_date, overdue: !!open[0].due_date && open[0].due_date < s.today } : null,
        open: open.map((p) => ({ id: p.id, title: p.title, due: p.due_date, overdue: !!p.due_date && p.due_date < s.today })),
        held: held.map((m) => ({ id: m.id, name: m.name })),
        trend,
      };
    })
    .sort((a, b) => (a.status === b.status ? b.startedAt.localeCompare(a.startedAt) : a.status === "open" ? -1 : 1));
}
