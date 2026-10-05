import type { Q } from "../db/db.js";
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, localDay } from "../../shared/clinical.js";
import { WIZARDS, buildOutcome, missingRequired, optionsFor, visibleQuestions, type Answers, type WizardContext } from "../../shared/wizards.js";
import { suggest } from "../../shared/wizard-guidance.js";
import { ApiError, audit, journeyEvent, nowIso, today, uuid, type Actor } from "../kernel/base.js";
import { addCondition, addPlanAction, medicationEvent, startMedication, updateCondition, type Changed } from "../kernel/clinical.js";
import { latestStudy, loadState, series, type PatientState } from "../kernel/state.js";
import { recentRaasStart } from "./rules.js";
import { acsIndex, arcHbr, indexEvent } from "./cad-profile.js";
import { cha2ds2va, doacDoseCheck } from "./guidelines.js";
import { deviceStatus } from "./rhythm-profile.js";
import { latestValveEcho } from "./valve-profile.js";
import { daptIndication, oacIndication, valveInterventions } from "./valve-rules.js";
import { mechanicalInrTarget } from "./acute-rules.js";
import { interventionFor } from "../../shared/wizards-valve.js";

function baseContext(s: PatientState, wizardId: string): WizardContext {
  const meds = s.meds
    .filter((m) => m.status === "active" || m.status === "held")
    .map((m) => ({ id: m.id, code: m.code, name: m.name, doseValue: m.doseValue, doseUnit: m.doseUnit, frequency: m.frequency, tags: m.tags, startedAt: m.startedAt ?? null }));
  const fact = (code: string, tone?: string) => {
    const c = s.resolved(code).current;
    if (!c) return { label: MEASURES[code]?.display ?? code, value: "Not available", tone: "orange" };
    return { label: code === "sbp" ? "Systolic BP" : code === "hr" ? "Heart rate" : MEASURES[code].short === "Cr" ? "Creatinine" : MEASURES[code].short, value: `${formatNumber(c.value_num!, MEASURES[code].decimals)} ${MEASURES[code].unit}`, date: c.effective_at, tone };
  };
  const detected: Record<string, string[]> = { contributors: [] };
  const cr = series(s, "creatinine");
  const wrf = cr.length > 1 && cr[0].value_num! - Math.min(...cr.slice(1).map((o) => o.value_num!)) >= 26.5;
  if (recentRaasStart(s)) detected.contributors.push("raas-start");
  if (s.meds.some((m) => m.status === "active" && m.tags.includes("mra")) && wizardId === "hyperkalaemia") detected.contributors.push("mra");
  if (wrf && wizardId === "hyperkalaemia") detected.contributors.push("wrf");
  if (wizardId === "renal-function") {
    if (s.meds.some((m) => m.tags.includes("sglt2") && m.startedAt && daysBetween(m.startedAt, s.today) <= 30)) detected.contributors.push("sglt2-start");
    const wt = series(s, "weight");
    if (wt.length > 1 && wt[0].value_num! < wt[wt.length - 1].value_num! - 1.5 && s.meds.some((m) => m.status === "active" && m.tags.includes("loop")))
      detected.contributors.push("diuretic");
  }
  const on = (tag: string) => s.meds.some((m) => m.status === "active" && m.tags.includes(tag));
  if (wizardId === "congestion" || wizardId === "hypotension" || wizardId === "bradycardia") return extraContext(s, wizardId, meds, fact, on, detected);
  const def = WIZARDS[wizardId];
  if (def?.facts) {
    // content-driven wizards: facts, trend and AUTO detection all come from the definition
    for (const q of def.steps.flatMap((st) => st.questions))
      for (const o of q.options ?? []) {
        const lab = o.detectLab ? s.resolved(o.detectLab.code).current?.value_num : null;
        if (o.detectTag?.some((t) => on(t)) || o.detectCondition?.some((c) => s.conditions.some((x) => x.code === c)) || (lab != null && lab > o.detectLab!.above))
          (detected[q.id] ??= []).push(o.value);
      }
    const t = def.trend ? series(s, def.trend).slice(0, 5).reverse() : [];
    return {
      today: s.today, meds, detected,
      profile: {
        age: s.patient.age,
        cvd: ["cad", "hf", "stroke", "af", "valve", "vascular", "ascvd"].some((t) => s.tags.has(t)),
        riskFactors: s.patient.age >= 65 || ["htn", "dm", "ckd", "lipids", "obesity"].some((t) => s.tags.has(t)) || s.conditions.some((c) => c.code === "smoker"),
      },
      facts: def.facts.filter((c) => MEASURES[c]).map((c) => fact(c)),
      trend: def.trend && MEASURES[def.trend] ? { code: def.trend, label: MEASURES[def.trend].display, unit: MEASURES[def.trend].unit, points: t.map((o) => ({ date: o.effective_at, value: o.value_num! })) } : undefined,
    };
  }
  const code = wizardId === "hyperkalaemia" ? "potassium" : "creatinine";
  const hist = series(s, code).slice(0, 3).reverse();
  const facts =
    wizardId === "hyperkalaemia"
      ? [fact("creatinine"), fact("egfr"), fact("sbp"), fact("hr")]
      : [fact("potassium"), fact("egfr"), fact("sbp"), fact("weight")];
  return {
    today: s.today,
    meds,
    facts,
    detected,
    trend: { code, label: MEASURES[code].display, unit: MEASURES[code].unit, points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
  };
}

// Every pathway also gets the numbers and diagnoses its guideline suggestions read: the latest
// value of each measure (with the one before it), and the diagnosis codes and tags.
export function wizardContext(s: PatientState, wizardId: string): WizardContext {
  const base = baseContext(s, wizardId);
  const values: NonNullable<WizardContext["values"]> = {};
  for (const code of Object.keys(MEASURES)) {
    const h = series(s, code).filter((o) => o.value_num != null && o.status === "final");
    if (h[0]) values[code] = { value: h[0].value_num!, at: h[0].effective_at, prev: h[1]?.value_num ?? null };
  }
  const dx = [...new Set([...s.conditions.map((c) => c.code), ...s.tags])];
  const profile = base.profile ?? {
    age: s.patient.age,
    cvd: ["cad", "hf", "stroke", "af", "valve", "vascular", "ascvd"].some((t) => s.tags.has(t)),
    riskFactors: s.patient.age >= 65 || ["htn", "dm", "ckd", "lipids", "obesity"].some((t) => s.tags.has(t)) || s.conditions.some((c) => c.code === "smoker"),
  };
  const ix = indexEvent(s);
  const hbr = arcHbr(s);
  const acs = acsIndex(s);
  const coronary = ix ? {
    acsAt: acs?.acsAt ?? null,
    indexAt: (ix.pci?.at ?? ix.at), indexTitle: `${ix.title}${ix.detail ? ` · ${ix.detail}` : ""}`, acs: ix.acs, pciAt: ix.pci?.at ?? null,
    complexPci: !!ix.pci?.complex, days: ix.days, hbrMajor: hbr.major, hbrMinor: hbr.minor,
  } : null;
  const planned = s.plan.filter((p) => p.status === "planned").map((p) => p.title);
  const afc = s.conditions.find((c) => c.code === "af" || c.code === "flutter");
  const ecg = latestStudy(s, "ecg");
  const ecgAf = /fibrillation|flutter/i.test(String(ecg?.attributes?.rhythm ?? ""));
  const sc = afc || ecgAf ? cha2ds2va(s) : null;
  const af = sc ? {
    score: sc.score, items: sc.items.map((i) => `${i.label} +${i.pts}`),
    pattern: (afc?.attributes?.pattern as string | undefined) ?? null,
    ecgRhythm: (ecg?.attributes?.rhythm as string | undefined) ?? null, ecgRate: (ecg?.attributes?.rate as number | undefined) ?? null,
    doac: doacDoseCheck(s).map((c) => ({ code: c.med.code, dose: c.med.doseValue, right: c.right, why: c.why })),
  } : null;
  const ds = deviceStatus(s);
  const device = ds ? { type: ds.type, checkAt: ds.check ? localDay(ds.check.at) : null, check: ds.check?.a ?? null } : null;
  const ve = latestValveEcho(s);
  const valve = {
    nyha: (s.resolved("nyha").current?.value_text as string | undefined) ?? null,
    lesions: s.conditions.filter((c) => ["as", "ar", "mr-primary", "mr-secondary", "ms", "tr"].includes(c.code) && c.status === "active").map((c) => ({ code: c.code, severity: (c.attributes?.severity as string | undefined) ?? null })),
    echo: ve?.valves ?? {}, mrType: ve?.mrType ?? null,
    treated: s.conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active").map((c) => String(c.attributes?.position ?? "")),
    bicuspid: s.studies.some((x) => x.kind === "echo" && x.findings.includes("Bicuspid aortic valve")),
    interventions: valveInterventions(s).map((v) => ({ position: v.position, procedure: v.procedure, type: v.type ?? "", name: v.name, day: v.day })),
    daptIndication: daptIndication(s), oacIndication: oacIndication(s),
    prostheses: s.conditions.filter((c) => c.code === "prosthetic-valve").map((c) => ({ position: String(c.attributes?.position ?? ""), type: String(c.attributes?.type ?? "") })),
    echoFindings: latestStudy(s, "echo")?.findings ?? [],
    inrTarget: (() => { const r = s.tags.has("mechanical-valve") ? mechanicalInrTarget(s) : null; return r ? `${formatNumber(r.target, 1)} (${formatNumber(r.low, 1)}–${formatNumber(r.high, 1)})` : null; })(),
  };
  if (wizardId === "valve-antithrombotic") {
    const kind = valve.interventions.map((v) => interventionFor(v.type, v.procedure, v.position)).find(Boolean);
    if (kind && !base.detected.intervention) base.detected.intervention = [kind];
    if (valve.daptIndication) (base.detected.indications ??= []).push("pci");
  }
  return { ...base, values, dx, planned, profile: { ...profile, sex: s.patient.sex }, coronary, af, device, valve };
}

export async function getWizard(tx: Q, patientId: string, wizardId: string) {
  if (!WIZARDS[wizardId]) throw new ApiError(404, "Unknown wizard");
  const s = await loadState(tx, patientId);
  const draft = (
    await tx.query(`SELECT id,answers,step,recommendation_id FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1`, [patientId, wizardId])
  ).rows[0];
  // an open episode of this pathway: the wizard opens as its review, with the last answers kept
  const ep = s.episodes.find((e) => e.wizard === wizardId && e.status === "open");
  let episode = null;
  if (ep) {
    const last = ep.decisions[ep.decisions.length - 1];
    const answers = last ? ((await tx.query(`SELECT answers FROM cf.decision WHERE id=$1`, [last.id])).rows[0] as any)?.answers ?? {} : {};
    episode = { id: ep.id, startedAt: ep.started_at, day: daysBetween(ep.started_at, s.today) + 1, reviews: Math.max(0, ep.decisions.length - 1), lastAt: last?.decided_at ?? ep.started_at, answers: typeof answers === "string" ? JSON.parse(answers) : answers };
  }
  return { context: wizardContext(s, wizardId), draft: draft ?? null, episode };
}

export async function saveDraft(tx: Q, actor: Actor, patientId: string, wizardId: string, input: { answers: Answers; step: number; recommendationId?: string | null }) {
  const existing = (await tx.query(`SELECT id FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft'`, [patientId, wizardId])).rows[0];
  if (existing)
    await tx.query(`UPDATE cf.wizard_draft SET answers=$2, step=$3, updated_by=$4, updated_at=now() WHERE id=$1`, [existing.id, JSON.stringify(input.answers), input.step, actor.id]);
  else
    await tx.query(`INSERT INTO cf.wizard_draft(id,patient_id,wizard,recommendation_id,answers,step,status,updated_by) VALUES($1,$2,$3,$4,$5,$6,'draft',$7)`, [
      uuid(), patientId, wizardId, input.recommendationId ?? null, JSON.stringify(input.answers), input.step, actor.id,
    ]);
}

export async function completeWizard(
  tx: Q,
  actor: Actor,
  patientId: string,
  wizardId: string,
  input: { answers: Answers; recommendationId?: string | null; contextId?: string | null },
) {
  const def = WIZARDS[wizardId];
  if (!def) throw new ApiError(404, "Unknown wizard");
  for (const step of def.steps) {
    const missing = missingRequired(step, input.answers);
    if (missing.length) throw new ApiError(400, `Answer "${missing[0].label}" before confirming`);
  }
  const s = await loadState(tx, patientId);
  const ctx = wizardContext(s, wizardId);
  // an option that does not fit the patient's medicines cannot be confirmed
  for (const q of def.steps.flatMap((st) => st.questions).filter((q) => q.options)) {
    const allowed = new Set(optionsFor(q, ctx).map((o) => o.value));
    const chosen = input.answers[q.id];
    for (const v of Array.isArray(chosen) ? chosen : chosen != null ? [String(chosen)] : [])
      if (!allowed.has(String(v))) throw new ApiError(400, `"${q.options!.find((o) => o.value === v)?.label ?? v}" does not apply to this patient's medicines`);
  }
  // a date answer is a planned day: a calendar date, today or later
  for (const q of def.steps.flatMap((st) => st.questions).filter((q) => q.type === "date")) {
    const v = input.answers[q.id];
    if (v == null || v === "") continue;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < ctx.today) throw new ApiError(400, `${q.label}: choose today or a later date`);
  }
  const outcome = buildOutcome(wizardId, input.answers, ctx);
  const decisionId = uuid();
  const at = nowIso();
  // the complication episode: the first completion opens it, later ones are its reviews
  let episodeId: string | null = null;
  let review = false;
  if (def.episode !== false) {
    const open = s.episodes.find((e) => e.wizard === wizardId && e.status === "open");
    if (open) { episodeId = open.id; review = true; }
    else {
      episodeId = uuid();
      await tx.query(`INSERT INTO cf.episode(id,patient_id,wizard,status,started_at,started_by,context_id) VALUES($1,$2,$3,'open',$4,$5,$6)`, [episodeId, patientId, wizardId, at, actor.id, input.contextId ?? null]);
    }
  }
  await tx.query(
    `INSERT INTO cf.decision(id,patient_id,recommendation_id,wizard,outcome,answers,context_id,decided_by,episode_id) VALUES($1,$2,$3,$4,'acted',$5,$6,$7,$8)`,
    [decisionId, patientId, input.recommendationId ?? null, wizardId, JSON.stringify(input.answers), input.contextId ?? null, actor.id, episodeId],
  );
  const changed: Changed = ["plan", "episodes", "pathways"];
  // medicines started by the pathway come first so dated plan items can link to them
  for (const item of outcome.filter((i) => i.kind === "start")) {
    if (item.kind !== "start") continue;
    if (s.meds.some((m) => m.code === item.code && (m.status === "active" || m.status === "held"))) continue;
    const r = await startMedication(tx, actor, patientId, { code: item.code, doseValue: item.doseValue, frequency: item.frequency, route: "PO", indication: item.indication, effectiveAt: at, contextId: input.contextId });
    changed.push(...r.changed);
  }
  const medByRef = async (ref: string | undefined) => {
    if (!ref?.startsWith("code:")) return null;
    const row = (await tx.query(`SELECT m.id FROM cf.medication m WHERE m.patient_id=$1 AND m.drug=$2 ORDER BY m.created_at DESC LIMIT 1`, [patientId, ref.slice(5)])).rows[0] as any;
    return row?.id ?? null;
  };
  // diagnoses the pathway confirms: added with today's date, or their detail updated (onset kept)
  for (const item of outcome) {
    if (item.kind !== "condition") continue;
    const cur = s.conditions.find((c) => c.code === item.code && c.status === "active");
    if (!cur) changed.push(...(await addCondition(tx, actor, patientId, { code: item.code, onset: today(), contextId: input.contextId, attributes: item.attributes })).changed);
    else {
      const { onsetYear, ...rest } = cur.attributes ?? {};
      changed.push(...(await updateCondition(tx, actor, patientId, cur.logical_id, { onset: cur.onset ? String(cur.onset).slice(0, 10) : null, onsetYear: (onsetYear as number | undefined) ?? null, attributes: { ...rest, ...item.attributes } })));
    }
  }
  for (const item of outcome) {
    if (item.kind === "start" || item.kind === "condition") continue;
    if (item.kind === "medication") {
      changed.push(...(await medicationEvent(tx, actor, patientId, item.medicationId, {
        kind: item.event, doseValue: item.doseValue, reason: def.title, effectiveAt: at, contextId: input.contextId, decisionId,
      })));
    } else if (item.kind === "plan") {
      await addPlanAction(tx, actor, patientId, {
        category: item.category, title: item.title, reason: def.title, dueDate: item.dueDate, completesOn: item.completesOn, contextId: input.contextId, decisionId,
        medicationId: item.medicationId ?? (await medByRef(item.medicationRef)),
      });
    }
  }
  if (input.recommendationId)
    await tx.query(`UPDATE cf.recommendation SET status='decided', closed_at=now() WHERE id=$1 AND patient_id=$2 AND status='active'`, [input.recommendationId, patientId]);
  await tx.query(`UPDATE cf.wizard_draft SET status='completed', updated_at=now() WHERE patient_id=$1 AND wizard=$2 AND status='draft'`, [patientId, wizardId]);
  const actions = (input.answers.actions as string[] | undefined) ?? [];
  const assessment = def.assess?.(input.answers, ctx);
  // guideline suggestions the clinician did not take are recorded with the decision (Journey)
  const chosen = (id: string, v: string) => (Array.isArray(input.answers[id]) ? (input.answers[id] as string[]).includes(v) : input.answers[id] === v);
  const notTaken = def.steps.flatMap((st) => visibleQuestions(st, input.answers)).filter((q) => q.options)
    .flatMap((q) => suggest(wizardId, q.id, input.answers, ctx, new Set(optionsFor(q, ctx).map((o) => o.value)))
      .filter((x) => x.value !== "none" && !chosen(q.id, x.value))
      .map((x) => q.options!.find((o) => o.value === x.value)?.label ?? x.value));
  const summary = assessment ? [...assessment.rows.map((r) => `${r.label}: ${r.value}`), ...assessment.recommendations].join(" · ") : "";
  await journeyEvent(tx, actor, {
    patientId, occurredAt: at, kind: "complication-review", category: "complication",
    title: review ? `${def.title} · review` : def.title,
    detail: [summary, outcome.map((o) => o.label).filter(Boolean).join(" · ") || actions.join(", "), notTaken.length ? `Guideline suggestions not taken: ${notTaken.join("; ")}` : ""].filter(Boolean).join(" · "),
    refType: "decision", refId: decisionId, contextId: input.contextId,
  });
  await audit(tx, actor, "complete-wizard", "decision", decisionId, patientId, { wizard: wizardId });
  return { decisionId, episodeId, review, outcome, assessment: assessment ?? null, notTaken, changed: [...new Set(changed)] };
}

export async function declineRecommendation(tx: Q, actor: Actor, patientId: string, recommendationId: string, input: { outcome: "declined" | "deferred"; reason: string }) {
  const rec = (await tx.query(`SELECT * FROM cf.recommendation WHERE id=$1 AND patient_id=$2 AND status='active'`, [recommendationId, patientId])).rows[0];
  if (!rec) throw new ApiError(404, "This alert is no longer active");
  if (!input.reason.trim()) throw new ApiError(400, "Give a short reason");
  await tx.query(`INSERT INTO cf.decision(id,patient_id,recommendation_id,outcome,reason,decided_by) VALUES($1,$2,$3,$4,$5,$6)`, [
    uuid(), patientId, recommendationId, input.outcome, input.reason, actor.id,
  ]);
  await tx.query(`UPDATE cf.recommendation SET status='decided', closed_at=now() WHERE id=$1`, [recommendationId]);
  await audit(tx, actor, input.outcome, "recommendation", recommendationId, patientId, { reason: input.reason });
}

// Congestion, hypotension and bradycardia: facts, trend and what the record already shows.
function extraContext(
  s: PatientState,
  wizardId: string,
  meds: WizardContext["meds"],
  fact: (code: string, tone?: string) => WizardContext["facts"][number],
  on: (tag: string) => boolean,
  detected: Record<string, string[]>,
): WizardContext {
  const recentDays = (iso: string) => daysBetween(iso, s.today);
  const ecg = latestStudy(s, "ecg", 90);
  const holter = latestStudy(s, "holter", 90);
  const studyFacts = [ecg, holter].filter(Boolean).map((st) => ({ label: st!.kind === "ecg" ? "ECG" : "Holter", value: st!.findings[0] ?? "recorded", date: st!.performed_at }));
  if (wizardId === "congestion") {
    const wt = series(s, "weight").filter((o) => recentDays(o.effective_at) <= 7);
    detected.signs = [];
    if (wt.length > 1 && wt[0].value_num! - Math.min(...wt.slice(1).map((o) => o.value_num!)) >= 2) detected.signs.push("weight");
    const cong = s.resolved("congestion").current;
    if (cong && ["Moderate", "Severe"].includes(cong.value_text ?? "") && recentDays(cong.effective_at) <= 7) detected.signs.push("oedema");
    detected.precipitants = [];
    if (ecg && /fibrillation|flutter/i.test(ecg.attributes.rhythm ?? "") && recentDays(ecg.performed_at) <= 30) detected.precipitants.push("af");
    if (on("ndhp-ccb")) detected.precipitants.push("drugs");
    const cr = series(s, "creatinine");
    if (cr.length > 1 && cr[0].value_num! - Math.min(...cr.slice(1).map((o) => o.value_num!)) >= 26.5) detected.precipitants.push("renal");
    const hist = series(s, "weight").slice(0, 5).reverse();
    return {
      today: s.today, meds, detected,
      facts: [fact("weight"), fact("sbp"), fact("creatinine"), fact("potassium"), fact("nt-probnp"), ...studyFacts.slice(0, 1)],
      trend: { code: "weight", label: "Weight", unit: "kg", points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
    };
  }
  if (wizardId === "hypotension") {
    detected.contributors = [];
    if (on("vasodilator")) detected.contributors.push("vasodilator");
    const cong = s.resolved("congestion").current;
    if (on("loop") && cong?.value_text === "None") detected.contributors.push("diuretic");
    if (s.meds.some((m) => m.events.some((e) => e.kind === "increase" && recentDays(e.effective_at) <= 14))) detected.contributors.push("recent-uptitration");
    const hist = series(s, "sbp").slice(0, 5).reverse();
    return {
      today: s.today, meds, detected,
      facts: [fact("sbp"), fact("dbp"), fact("hr"), fact("creatinine"), fact("weight")],
      trend: { code: "sbp", label: "Systolic BP", unit: "mmHg", points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
    };
  }
  // bradycardia
  detected.contributors = [];
  for (const [tag, v] of [["bb", "bb"], ["bb-other", "bb"], ["ivabradine", "ivabradine"], ["digoxin", "digoxin"], ["qt", "amiodarone"], ["ndhp-ccb", "ccb"]] as const) if (on(tag)) detected.contributors.push(v);
  if ((s.resolved("potassium").current?.value_num ?? 0) > 5.5) detected.contributors.push("hyperkalaemia");
  const av = [ecg, holter].map((st) => st?.attributes.avBlock).find(Boolean);
  const block =
    av === "Mobitz II" || av === "Complete" ? "high-grade"
    : holter && Number(holter.attributes.longestPause ?? 0) >= 3 ? "pauses"
    : av === "Mobitz I" ? "mobitz1"
    : av === "First-degree" ? "first-degree"
    : ecg && /fibrillation/i.test(ecg.attributes.rhythm ?? "") ? "slow-af"
    : ecg ? "sinus-brady" : "no-ecg";
  detected.block = [block];
  const hist = series(s, "hr").slice(0, 5).reverse();
  return {
    today: s.today, meds, detected,
    facts: [fact("hr"), fact("sbp"), fact("potassium"), fact("tsh"), ...studyFacts],
    trend: { code: "hr", label: "Heart rate", unit: "bpm", points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
  };
}

// Close a complication episode with its outcome. Plan items and held medicines are not changed
// here: the screen shows what is still open so the clinician decides about each one.
export const EPISODE_OUTCOMES = ["Resolved", "Improved, follow-up continues", "Transferred / referred", "Opened in error"] as const;
export async function resolveEpisode(tx: Q, actor: Actor, patientId: string, episodeId: string, input: { outcome: string; note?: string }) {
  const ep = (await tx.query(`SELECT * FROM cf.episode WHERE id=$1 AND patient_id=$2`, [episodeId, patientId])).rows[0] as any;
  if (!ep) throw new ApiError(404, "Episode not found");
  if (ep.status !== "open") throw new ApiError(409, "This episode is already closed");
  if (!(EPISODE_OUTCOMES as readonly string[]).includes(input.outcome)) throw new ApiError(400, "Choose an outcome");
  const at = nowIso();
  await tx.query(`UPDATE cf.episode SET status='resolved', resolved_at=$2, resolved_by=$3, outcome=$4, note=$5 WHERE id=$1`, [episodeId, at, actor.id, input.outcome, input.note?.trim() ?? ""]);
  const def = WIZARDS[ep.wizard];
  const days = daysBetween(new Date(ep.started_at).toISOString(), today()) + 1;
  await journeyEvent(tx, actor, {
    patientId, occurredAt: at, kind: "complication-review", category: "complication",
    title: `${def?.title ?? ep.wizard} · ${input.outcome === "Opened in error" ? "closed" : "resolved"}`,
    detail: [`${input.outcome} after ${days} day${days === 1 ? "" : "s"}`, input.note?.trim()].filter(Boolean).join(" · "),
    refType: "episode", refId: episodeId,
  });
  await audit(tx, actor, "resolve-episode", "episode", episodeId, patientId, { outcome: input.outcome });
  return { changed: ["episodes"] };
}
