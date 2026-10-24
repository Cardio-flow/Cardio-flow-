import { decisionDataNeeded, decisionQuestions } from "../../shared/decision-requirements.js";
import { decisionBlocker } from "../../shared/decision-validation.js";
import { pregnancyProfile } from "./pregnancy-profile.js";
import { validatePregnancy, pregnancyOutcomeBlocker } from "../../shared/wizards-pregnancy.js";
import { medicationReviewContext } from "./medication-review.js";
import { validateMedicationMonitoring } from "../../shared/wizards-medication.js";
import { pericardialProfile } from "./pericardial-profile.js";
import { validatePericardial } from "../../shared/wizards-pericardial.js";
import { aortaProfile } from "./aorta-profile.js";
import { validateAorta } from "../../shared/wizards-aorta.js";
import { syncopeProfile } from "./syncope-profile.js";
import { validateSyncope } from "../../shared/wizards-syncope.js";
import { potassiumFirst } from "../../shared/decision-safety.js";
import { validateIronDates, ironDates } from "../../shared/wizards-iron.js";
import { glycaemicTarget, TARGET_PARAMS } from "./diabetes-rules.js";
import { IRON_CHECKS, ferinjectPlan, ironInputs } from "../../shared/wizards-iron.js";
import { evidenceKey, checkEvidence, checkRecommendation } from "../kernel/evidence.js";
import { validateLabAnswers } from "../../shared/wizards-lab.js";
import { labResults } from "./lab-results.js";
import { validDate } from "../../shared/dates.js";
import { hypertensionProfile } from "./hypertension-profile.js";
import { rdnSchedulingMissing } from "../../shared/wizards-hypertension.js";
import { structuralEvidenceKey } from "./structural-evidence.js";
import { addCalendarMonths } from "../../shared/af.js";
import type { Q } from "../db/db.js";
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, localDay } from "../../shared/clinical.js";
import { WIZARDS, buildOutcome, missingRequired, optionsFor, visibleQuestions, visibleAnswers, type Answers, type WizardContext } from "../../shared/wizards.js";
import { suggest } from "../../shared/wizard-guidance.js";
import { ApiError, audit, journeyEvent, liveContext, nowIso, today, uuid, type Actor } from "../kernel/base.js";
import { structuralPlanning, taviSchedulingMissing } from "../../shared/wizards-structural.js";
import { structuralTarget } from "../../shared/structural.js";
import { isHfAdmission } from "../../shared/encounters.js";
import { LIVE_MED, addCondition, addPlanAction, medicationEvent, recordBarrier, startMedication, updateCondition, type Changed } from "../kernel/clinical.js";
import { latestStudy, loadState, series, type PatientState } from "../kernel/state.js";
import { recentRaasStart } from "./rules.js";
import { acsIndex, arcHbr, indexEvent } from "./cad-profile.js";
import { cha2ds2va, doacDoseCheck } from "./guidelines.js";
import { deviceStatus } from "./rhythm-profile.js";
import { latestValveEcho } from "./valve-profile.js";
import { historyCode } from "../../shared/history.js";
import { daptIndication, oacIndication, valveInterventions } from "./valve-rules.js";
import { mechanicalInrTarget } from "./acute-rules.js";
import { interventionFor } from "../../shared/wizards-valve.js";
import { DIAGNOSIS, MEDICATION } from "../../shared/catalog.js";
import { preStartCheck, proposedMedicines } from "./med-safety.js";
import { creatinineTrend } from "./renal-trend.js";
import { latestPhEcho } from "./ph-profile.js";
import { latestCcsTest } from "./cad-tests.js";

function baseContext(s: PatientState, wizardId: string): WizardContext {
  const meds = s.meds
    .filter((m) => m.status === "active" || m.status === "held")
    .map((m) => ({ id: m.id, code: m.code, name: m.name, status:m.status, doseValue: m.doseValue, doseUnit: m.doseUnit, frequency: m.frequency, tags: m.tags, startedAt: m.startedAt ?? null }));
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
        if (o.detectTag?.some((t) => on(t)) || o.detectCode?.some((c) => s.meds.some((m) => m.status === "active" && m.code === c)) || o.detectCondition?.some((c) => s.conditions.some((x) => x.code === c)) || (lab != null && lab > o.detectLab!.above))
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
  const hypertension = hypertensionProfile(s);
  if (wizardId.startsWith("htn-")) {
    if (wizardId === "htn-review" && hypertension.highRisk) base.detected.risk = ["high"];
    if (wizardId === "htn-review" && hypertension.outside?.valid && hypertension.office) base.detected.confirmation = [hypertension.phenotype === "White-coat phenotype" ? "whitecoat" : hypertension.phenotype === "Masked hypertension" ? "masked" : hypertension.outside.high ? "confirmed" : "repeat"];
    if (wizardId === "htn-secondary") {
      base.detected.clues = hypertension.secondaryClues.flatMap(clue=>clue.includes("40") ? ["young"] : clue.includes("resistant") ? ["resistant"] : clue.includes("kalaemia") ? ["potassium"] : clue.includes("Kidney") ? ["renal"] : clue.includes("apnoea") ? ["osa"] : []);
      if (!hypertension.pa) base.detected.paAction = ["screen"];
      else base.detected.paAction = [hypertension.pa.result === "Positive" ? "refer" : hypertension.pa.reliable && hypertension.pa.result === "Negative" ? "reviewed" : "repeat"];
    }
  }
  const pregnancyForScope=pregnancyProfile(s);
  if(["vitamin-d-result","anaemia-result","liver-result","statin-ck-result"].includes(wizardId) && pregnancyForScope.eligible && (pregnancyForScope.phase === "Pregnant" || pregnancyForScope.phase === "Postpartum" && pregnancyForScope.breastfeeding!=="No"))base.detected.scope=["specialist"];
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
    complexPci: !!ix.pci?.complex || s.procedures.some((p) => p.kind === "pci" && ((p.attributes?.complex as unknown[] | undefined) ?? []).length > 0), days: ix.days, hbrMajor: hbr.major, hbrMinor: hbr.minor,
  } : null;
  const plannedActions = s.plan.filter(p => p.status === "planned").map(p => ({title:p.title, category:p.category, dueDate:p.due_date, completesOn:p.completes_on}));
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
  const ablation = [...s.procedures].reverse().find(p => p.kind === "ablation" && (p.attributes.targets ?? []).some((t: string) => /^AF/.test(t)));
  const closure = [...s.procedures].reverse().find(p => p.kind === "laao" && p.attributes.result === "Implanted / completed");
  const imaging = [...s.studies].reverse().find(st => st.kind === "laa_imaging" && st.attributes.purpose === "After closure" && closure && st.performed_at >= closure.performed_at);
  const preImaging = [...s.studies].reverse().find(st => st.kind === "laa_imaging" && ["Before closure", "Before cardioversion / ablation"].includes(st.attributes.purpose));
  if (closure?.attributes.method === "Transcatheter occlusion") dx.push("laao-transcatheter");
  const afProcedures = {
    ablation: ablation ? { id: ablation.id, day: localDay(ablation.performed_at), result: String(ablation.attributes.result), energy: ablation.attributes.energy, minimumOac: addCalendarMonths(localDay(ablation.performed_at), s.afReviews?.["after-af-ablation"]?.answers._procedureId === ablation.id && s.afReviews["after-af-ablation"].answers.basis === "acc" ? 3 : 2) } : null,
    closure: closure ? { id: closure.id, day: localDay(closure.performed_at), method: String(closure.attributes.method), device: String(closure.attributes.device), regimen: String(closure.attributes.regimen), reviewDate: closure.attributes.reviewDate ?? null } : null,
    imaging: imaging ? { id: imaging.id, day: localDay(imaging.performed_at), findings: imaging.attributes } : null,
    preImaging: preImaging ? { id: preImaging.id, day: localDay(preImaging.performed_at), findings: preImaging.attributes } : null,
  };
  const ds = deviceStatus(s);
  const device = ds ? { type: ds.type, checkAt: ds.check ? localDay(ds.check.at) : null, check: ds.check?.a ?? null } : null;
  const ve = latestValveEcho(s);
  const valve = {
    nyha: (s.resolved("nyha").current?.value_text as string | undefined) ?? null,
    lesions: s.conditions.filter((c) => ["as", "ar", "mr-primary", "mr-secondary", "ms", "tr"].includes(c.code) && c.status === "active").map((c) => ({ code: c.code, severity: (c.attributes?.severity as string | undefined) ?? null })),
    echo: ve?.valves ?? {}, mrType: ve?.mrType ?? null,
    treated: s.conditions.filter((c) => c.code === "prosthetic-valve" && c.status === "active").map((c) => String(c.attributes?.position ?? "")),
    bicuspid: s.conditions.some(c=>c.code === "bav") || s.studies.some((x) => x.kind === "echo" && x.findings.includes("Bicuspid aortic valve")),
    interventions: valveInterventions(s).map((v) => ({ position: v.position, procedure: v.procedure, type: v.type ?? "", name: v.name, day: v.day })),
    daptIndication: daptIndication(s), oacIndication: oacIndication(s),
    prostheses: s.conditions.filter((c) => c.code === "prosthetic-valve").map((c) => ({ position: String(c.attributes?.position ?? ""), type: String(c.attributes?.type ?? "") })),
    echoFindings: latestStudy(s, "echo")?.findings ?? [],
    inrTarget: (() => { const r = s.tags.has("mechanical-valve") ? mechanicalInrTarget(s) : null; return r ? `${formatNumber(r.target, 1)} (${formatNumber(r.low, 1)}–${formatNumber(r.high, 1)})` : null; })(),
  };
  const holter = latestStudy(s, "holter");
  const fhxAns = s.resolved(historyCode("fhx-scd")).current?.value_text ?? null;
  const cmpCond = s.conditions.find((c) => ["hcm", "dcm", "ndlvc", "arvc", "rcm", "amyloid"].includes(c.code) && c.attributes?.genetic === "P/LP variant");
  const anyCmp = s.conditions.find((c) => ["hcm", "dcm", "ndlvc", "arvc", "rcm", "amyloid"].includes(c.code));
  const cmp = { echoFindings: latestStudy(s, "echo")?.findings ?? [], nsvt: (holter?.attributes?.nsvt as string | undefined) ?? null, fhx: fhxAns, pgene: (cmpCond?.attributes?.gene as string | undefined) ?? null,
    genetic: cmpCond ? "P/LP variant" : ((anyCmp?.attributes?.genetic as string | undefined) ?? null),
    cyp2c19: (s.conditions.find((c) => c.code === "hcm" && c.status === "active")?.attributes?.cyp2c19 as string | undefined) ?? null };
  if (wizardId === "hcm-scd" && cmp.nsvt) base.detected.nsvt = [cmp.nsvt === "Yes" ? "yes" : "no"];
  if (wizardId === "valve-antithrombotic") {
    const kind = valve.interventions.map((v) => interventionFor(v.type, v.procedure, v.position)).find(Boolean);
    if (kind && !base.detected.intervention) base.detected.intervention = [kind];
    if (valve.daptIndication) (base.detected.indications ??= []).push("pci");
  }
  const active = (code: string) => s.conditions.find((c) => c.code === code && c.status === "active");
  const phc = active("ph"), pec = active("pe"), ildc = active("ild");
  const ph = {
    group: (phc?.attributes?.group as string | undefined) ?? null, haemo: (phc?.attributes?.haemo as string | undefined) ?? null,
    pvr: s.resolved("pvr").current?.value_num ?? null, echo: latestPhEcho(s)?.probability ?? null,
    peAt: pec?.onset ? String(pec.onset).slice(0, 10) : null, ildType: (ildc?.attributes?.type as string | undefined) ?? null, aps: !!active("aps"),
    anticoagulants: base.meds.filter((m) => m.tags.includes("oac") || m.tags.includes("oac-parenteral")).map((m) => ({ name: m.name, doac: m.tags.includes("doac") })),
  };
  if (wizardId === "post-pe" && ph.peAt) {
    if (!base.detected.time) base.detected.time = [daysBetween(ph.peAt, s.today) >= 91 ? "3m" : "lt3"];
    // NYHA II–IV recorded after the embolism reads as persistent breathlessness or exercise limitation
    const ny = s.resolved("nyha").current;
    if (!base.detected.symptoms && ny && localDay(ny.effective_at) >= ph.peAt && ["II", "III", "IV"].includes(String(ny.value_text))) base.detected.symptoms = ["yes"];
  }
  if (wizardId === "ph-suspected") {
    if (!base.detected.echo && ph.echo) base.detected.echo = [ph.echo];
    if (!base.detected.warning && ["III", "IV"].includes(String(s.resolved("nyha").current?.value_text ?? ""))) base.detected.warning = ["severe"];
  }
  if ((wizardId === "ph-lhd-lung" || wizardId === "ph-suspected") && !base.detected.cause) {
    const tags = new Set(s.conditions.filter((c) => c.status === "active").flatMap((c) => DIAGNOSIS[c.code]?.tags ?? []));
    const cause = [
      (ph.group?.startsWith("Group 2") || tags.has("hf") || valve.lesions.length > 0) && "lhd",
      (ph.group?.startsWith("Group 3") || tags.has("lung")) && "lung",
    ].filter(Boolean) as string[];
    if (cause.length) base.detected.cause = cause;
  }
  const cabg = [...s.procedures].reverse().find((p) => p.kind === "cabg");
  const ccsTest = latestCcsTest(s);
  if (wizardId === "ccs-test-result" && ccsTest && !base.detected.risk) base.detected.risk = [ccsTest.risk];
  const actual = [...s.procedures].reverse().find(p => p.kind === "valve" && p.attributes.result !== "Aborted / no implant" && structuralTarget(p.attributes));
  const structural = {
    planning: [...s.studies].reverse().filter(st => st.kind === "structural_imaging").map(st=>({id:st.id,day:localDay(st.performed_at),findings:st.attributes,conclusion:st.conclusion})),
    actual: actual ? {id:actual.id,day:localDay(actual.performed_at),target:structuralTarget(actual.attributes)!,findings:actual.attributes} : null,
    hfAdmissionInYear: s.contexts.some(c=>c.kind === "admission" && isHfAdmission(c) && localDay(c.started_at) >= new Date(Date.parse(s.today + "T12:00:00Z") - 365*86400000).toISOString().slice(0,10)),
    latestEchoId: latestStudy(s,"echo")?.id ?? null,
    rhcId: [...s.procedures].reverse().find(p=>p.kind === "rhc")?.id ?? null,
  };
  if (wizardId === "tavi-plan") {
    const morphology = structural.planning.find(st => st.findings.intervention === "TAVI")?.findings.aorticMorphology;
    if (valve.bicuspid || morphology === "Bicuspid") base.detected.morphology = ["bicuspid"];
    else if (morphology === "Tricuspid") base.detected.morphology = ["tricuspid"];
    else if (morphology === "Other morphology") base.detected.morphology = ["other"];
  }
  const statins = base.meds.filter(m => m.tags.includes("statin"));
  const ck = s.resolved("ck").current;
  const notices = wizardId === "statin-ck-result" && ck && statins.length && statins.every(m => m.startedAt && ck.effective_at < m.startedAt) ? ["This CK predates the current statin treatment. Verify a current result before attributing it to this prescription."] : [];
  const rt = creatinineTrend(s);
  const renal = rt ? { baseline: rt.baseline.value_num!, current: rt.cur.value_num!, rise: rt.rel, review: rt.review, stop: rt.stop, mra: rt.mra, reviewCr: rt.reviewCr, reviewE: rt.reviewE } : null;
  const dmt = s.tags.has("dm") ? glycaemicTarget(s, TARGET_PARAMS) : null;
  const pericardial=pericardialProfile(s);
  if(wizardId === "pericarditis") {
    if(pericardial.urgent.length)base.detected.safety=["urgent"];
    if(pericardial.suggestedType)base.detected.type=[pericardial.suggestedType];
    if(pericardial.report)base.facts.push({label:"Pericardial report",value:pericardial.report.summary,date:pericardial.report.at});
    if(pericardial.drainage)base.facts.push({label:"Actual drainage",value:pericardial.drainage.summary,date:pericardial.drainage.at});
    if(pericardial.fluid)base.facts.push({label:"Linked fluid report",value:pericardial.fluid.summary,date:pericardial.fluid.at});
    for(const value of pericardial.urgent)base.facts.push({label:"Urgent reported concern",value,tone:"red"});
    for(const value of [...pericardial.missing,...pericardial.risks])base.facts.push({label:"Review",value,tone:"orange"});
  }
  const aorta=aortaProfile(s);
  if(wizardId === "aorta-plan"){
    if(aorta.urgent.length)base.detected.safety=["acute"];
    if(aorta.valveAssessment)base.facts.push({label:"Recorded valve assessment",value:aorta.valveAssessment.summary,date:aorta.valveAssessment.at});
    if(aorta.report)base.facts.push({label:"Aortic imaging",value:aorta.report.summary,date:aorta.report.at});
    for(const value of aorta.referral)base.facts.push({label:"Specialist review",value,tone:"orange"});
    for(const value of aorta.missing)base.facts.push({label:"Missing aortic assessment",value});
  }
  const syncope=syncopeProfile(s);
  if(wizardId === "syncope"){
    if(syncope.presentation)base.detected.presentation=[syncope.presentation];
    if(syncope.urgent.length)base.detected.redflags=["cardiac"];
    if(syncope.standing && localDay(syncope.standing.at) >= localDay(syncope.at ?? s.today) && syncope.standing.result === "Compatible symptomatic orthostatic hypotension" && syncope.standing.symptoms === "Usual symptoms reproduced")base.detected.orthostatic=["positive"];
    if(syncope.standing && localDay(syncope.standing.at) >= localDay(syncope.at ?? s.today) && syncope.standing.result === "No compatible orthostatic hypotension")base.detected.orthostatic=["negative"];
    if(syncope.ecg)base.facts.push({label:"Recorded ECG: review for this event",value:syncope.ecg.summary,date:syncope.ecg.at});
    if(syncope.standing)base.facts.push({label:"Standing BP report",value:syncope.standing.result,date:syncope.standing.at});
    for(const concern of syncope.urgent)base.facts.push({label:"Recorded concern",value:concern,tone:"red"});
  }
  return { ...base, pregnancy:pregnancyProfile(s), pericardial, medicationReview: wizardId === "medication-monitoring" ? medicationReviewContext(s) : undefined, aorta, syncope, glycaemicTarget: dmt ? { value: dmt.value, label: dmt.label } : null, notices, evidenceKey:evidenceKey(s), lab:labResults(s), hypertension, values, renal, dx, planned, plannedActions, structural, profile: { ...profile, sex: s.patient.sex }, coronary, afProcedures, cabgAt: cabg ? localDay(cabg.performed_at) : null, af, device, valve, cmp, ph, ccsTest };
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
  input: { answers: Answers; recommendationId?: string | null; contextId?: string | null; dueDates?: Record<string, string>; overrides?: Record<string, string>; evidenceKey?: string },
) {
  await liveContext(tx,patientId,input.contextId);
  const def = WIZARDS[wizardId];
  if (!def) throw new ApiError(404, "Unknown wizard");
  if(["pericarditis","pregnancy-plan"].includes(wizardId))input={...input,answers:visibleAnswers(wizardId,input.answers)};
  for (const step of def.steps) {
    const missing = missingRequired(step, input.answers);
    if (missing.length) throw new ApiError(400, `Answer "${missing[0].label}" before confirming`);
  }
  const s = await loadState(tx, patientId);
  checkEvidence(s, input.evidenceKey);
  await checkRecommendation(tx, patientId, wizardId, input.recommendationId);
  const ctx = wizardContext(s, wizardId);
  const essential = decisionQuestions(wizardId,input.answers,ctx);
  if(essential.length) throw new ApiError(400,`Answer "${essential[0].label}" before confirming`);
  if(wizardId === "pericarditis") {
    const error=validatePericardial(input.answers,ctx,input.dueDates);
    if(error)throw new ApiError(400,error);
  }
  if(wizardId === "medication-monitoring") {
    const error=validateMedicationMonitoring(input.answers,ctx);
    if(error)throw new ApiError(400,error);
  }
  if(wizardId === "pregnancy-plan") {const error=validatePregnancy(input.answers,ctx,input.dueDates);if(error)throw new ApiError(400,error);}
  const priority = potassiumFirst(wizardId,ctx);
  if (priority) throw new ApiError(409,priority);
  if(wizardId === "aorta-plan"){
    const error=validateAorta(input.answers,ctx,input.dueDates);
    if(error)throw new ApiError(400,error);
  }
  if(wizardId === "syncope"){
    const error=validateSyncope(input.answers,ctx,input.dueDates);
    if(error)throw new ApiError(400,error);
    if(!input.contextId && ctx.syncope?.contextId)input={...input,contextId:ctx.syncope.contextId};
  }
  // an option that does not fit the patient's medicines cannot be confirmed
  for (const q of def.steps.flatMap((st) => st.questions).filter((q) => q.options)) {
    const allowed = new Set(optionsFor(q, ctx).map((o) => o.value));
    const chosen = input.answers[q.id];
    if (q.exclusive && Array.isArray(chosen) && chosen.filter(v => q.exclusive!.includes(String(v))).length > 1)
      throw new ApiError(400, `${q.label}: choose one medication action`);
    for (const v of Array.isArray(chosen) ? chosen : chosen != null ? [String(chosen)] : [])
      if (!allowed.has(String(v))) throw new ApiError(400, `"${q.options!.find((o) => o.value === v)?.label ?? v}" does not apply to this patient's medicines`);
  }
  // a date answer is a planned day: a calendar date, today or later
  for (const q of def.steps.flatMap((st) => st.questions).filter((q) => q.type === "date")) {
    const v = input.answers[q.id];
    if (v == null || v === "") continue;
    if (typeof v !== "string" || !validDate(v) || v < ctx.today) throw new ApiError(400, `${q.label}: choose today or a later date`);
  }
  if (wizardId === "after-af-ablation" && !ctx.afProcedures?.ablation) throw new ApiError(400, "Record the AF ablation before planning post-ablation care");
  if (wizardId === "after-laao" && !ctx.afProcedures?.closure) throw new ApiError(400, "Record a completed LAA closure before planning post-closure care");
  if (wizardId === "after-structural" && !ctx.structural?.actual) throw new ApiError(400,"Record the completed structural intervention before planning its aftercare");
  if (wizardId === "after-laao" && String(input.answers.protocol ?? "").startsWith("flxpro-")) {
    if (ctx.afProcedures?.closure?.device !== "WATCHMAN FLX Pro" || ctx.afProcedures.closure.method !== "Transcatheter occlusion") throw new ApiError(400, "The selected US WATCHMAN FLX Pro protocol does not match the recorded closure device");
    if (input.answers.protocol === "flxpro-ablation" && (!ctx.afProcedures?.ablation || ctx.afProcedures.ablation.day > ctx.afProcedures.closure.day)) throw new ApiError(400, "Record AF ablation on or before closure before selecting the post-ablation device protocol");
    const expected = input.answers.protocol === "flxpro-dapt" ? "dapt" : "oac";
    if (input.answers.regimen !== expected) throw new ApiError(400, "The intended regimen must match the selected device protocol; use the reviewed regional / individualized protocol for exceptions");
  }
  if (wizardId === "rdn-plan" && input.answers.decision === "schedule") { const missing = rdnSchedulingMissing(input.answers,ctx); if (missing.length) throw new ApiError(400, "RDN cannot be scheduled: " + missing.join("; ")); }
  if (wizardId === "tavi-plan" && input.answers.decision === "schedule") { const missing = taviSchedulingMissing(input.answers,ctx); if (missing.length) throw new ApiError(400,"TAVI cannot be scheduled: " + missing.join("; ")); }
  if (wizardId === "after-rdn" && !ctx.hypertension?.actual) throw new ApiError(400,"Record the actual RDN procedure before planning aftercare");
  const ivIron = wizardId === "iv-iron" ? input.answers.decision === "give" : wizardId === "anaemia-result" && Array.isArray(input.answers.actions) && input.answers.actions.includes("iv");
  if (ivIron) {
    input = {...input, dueDates:ironDates(input.answers,ctx,input.dueDates)};
    const dateError = validateIronDates(input.answers,ctx,input.dueDates);
    if(dateError) throw new ApiError(400,dateError);
    const { hb, weight } = ironInputs(ctx);
    if (!ferinjectPlan(hb, weight)) throw new ApiError(400, "Record a haemoglobin (last 3 months) and the weight (last 12 months) to calculate the IV iron dose");
    const ticked = new Set((input.answers[wizardId === "iv-iron" ? "checks" : "ivChecks"] as string[] | undefined) ?? []);
    const open = IRON_CHECKS.filter((c) => !ticked.has(c.value));
    if (open.length) throw new ApiError(400, `Confirm before IV iron: ${open.map((c) => c.label.toLowerCase()).join("; ")} — or choose "Not now"`);
  }
  const dataNeeded = decisionDataNeeded(wizardId,ctx,input.answers);
  if(dataNeeded.length) throw new ApiError(400,`Update ${dataNeeded.map(n=>n.code).join(", ")} before confirming: ${dataNeeded[0].why}`);
  const decisionError = decisionBlocker(wizardId,input.answers,ctx,input.dueDates);
  if(decisionError) throw new ApiError(400,decisionError);
  const labError=validateLabAnswers(wizardId,input.answers,ctx);
  if(labError)throw new ApiError(400,labError);
  // Validate edited dates before a matching existing booking can replace the proposed item.
  const targets = buildOutcome(wizardId,input.answers,{...ctx,plannedActions:[]});
  for (const item of targets) if (item.kind === "plan" && input.dueDates && Object.hasOwn(input.dueDates,item.title)) {
    const day=input.dueDates[item.title];
    if (!validDate(day) || day < ctx.today) throw new ApiError(400, `${item.title}: choose today or a later date`);
  }
  const outcome = buildOutcome(wizardId, input.answers, ctx, input.dueDates);
  const pregnancyBlock=pregnancyOutcomeBlocker(wizardId,outcome,ctx,input.answers);if(pregnancyBlock)throw new ApiError(409,pregnancyBlock);
  // the clinician may move a planned date (keyed by the plan item's title); never before today
  for (const item of outcome)
    if (item.kind === "plan" && input.dueDates && Object.hasOwn(input.dueDates, item.title)) {
      const d = input.dueDates[item.title];
      if (!validDate(d) || d < ctx.today) throw new ApiError(400, `${item.title}: choose today or a later date`);
      item.dueDate = d;
    }
  // a medicine the pathway starts goes through the same pre-start check as the medicine drawer: a red hit
  // (contraindication) needs the clinician's reason, recorded with the start
  const startWhy: Record<string, string> = {};
  const afterStops = startChecksState(s, outcome);
  for (const item of outcome) {
    if (item.kind !== "start" || !MEDICATION[item.code]) continue;
    if (s.meds.some((m) => m.code === item.code && (m.status === "active" || m.status === "held"))) continue;
    const reds = preStartCheck(afterStops, item.code, MEDICATION[item.code]).filter((h) => h.severity === "red" || h.requiresReview);
    if (!reds.length) continue;
    const why = input.overrides?.[item.code]?.trim();
    if (!why || why.length < 3) throw new ApiError(409, `${MEDICATION[item.code].name}: ${reds[0].title}. Record a reason to start it anyway.`);
    startWhy[item.code] = `Started despite: ${reds.map((h) => h.title).join("; ")} — ${why}`.slice(0, 300);
  }
  // Own confirmed prophylaxis must not reopen the care plan immediately. Use the
  // expected post-start regimen, without depending on the future medication UUID.
  const pregnancyAfter={...afterStops,meds:afterStops.meds.map(m=>{
    const start=outcome.find(o=>o.kind === "start" && o.code === m.code);
    return start?.kind === "start" && !s.meds.some(old=>old.code===m.code && ["active","held"].includes(old.status))?{...m,doseValue:start.doseValue,frequency:start.frequency}:m;
  })};
  const pregnancyDecisionKey=wizardId === "pregnancy-plan"?pregnancyProfile(pregnancyAfter).key:null;
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
    [decisionId, patientId, input.recommendationId ?? null, wizardId, JSON.stringify({ ...input.answers, ...(wizardId === "pregnancy-plan" ? {_pregnancyKey:pregnancyDecisionKey}:{}), ...(wizardId === "pericarditis" ? {_pericardialKey:ctx.pericardial!.key}:{}), ...(wizardId === "aorta-plan" ? {_aortaKey:ctx.aorta!.key}:{}), ...(wizardId === "syncope" ? {_syncopeKey:ctx.syncope!.key}:{}), _dueDates:input.dueDates ?? {}, ...(["htn-review","htn-resistance","htn-secondary","rdn-plan","after-rdn"].includes(wizardId) ? {_hypertensionKey:ctx.hypertension!.key,...(wizardId === "htn-review" ? {_managementKey:ctx.hypertension!.managementKey} : {}),...(wizardId === "htn-resistance" ? {_resistanceKey:ctx.hypertension!.resistanceKey} : {}),...(wizardId === "after-rdn" ? {_procedureId:ctx.hypertension!.actual!.id} : {})} : {}), ...(["tavi-plan","teer-plan","other-structural-plan"].includes(wizardId) ? {_preparationKey:structuralEvidenceKey(s),_planningId:structuralPlanning(ctx,wizardId === "tavi-plan" ? "TAVI" : wizardId === "teer-plan" ? input.answers.target === "tricuspid" ? "Tricuspid TEER" : "Mitral TEER" : "Valve-in-valve / other transcatheter valve")?.id ?? null} : {}), ...(wizardId === "after-structural" ? {_procedureId:ctx.structural!.actual!.id,_echoId:ctx.structural!.latestEchoId} : {}), ...(wizardId === "after-laao" ? { _procedureId: ctx.afProcedures!.closure!.id, _imagingId: ctx.afProcedures!.imaging?.id ?? null } : wizardId === "after-af-ablation" ? { _procedureId: ctx.afProcedures!.ablation!.id } : {}) }), input.contextId ?? null, actor.id, episodeId],
  );
  const changed: Changed = ["plan", "episodes", "pathways"];
  // medicines started by the pathway come first so dated plan items can link to them
  for (const item of outcome.filter((i) => i.kind === "start")) {
    if (item.kind !== "start") continue;
    if (s.meds.some((m) => m.code === item.code && (m.status === "active" || m.status === "held"))) continue;
    const r = await startMedication(tx, actor, patientId, { code: item.code, doseValue: item.doseValue, frequency: item.frequency, route: "PO", indication: item.indication, effectiveAt: at, contextId: input.contextId, decisionId, reason: startWhy[item.code] });
    changed.push(...r.changed);
  }
  const medByRef = async (ref: string | undefined) => {
    if (!ref?.startsWith("code:")) return null;
    const row = (await tx.query(`SELECT m.id FROM cf.medication m WHERE m.patient_id=$1 AND m.drug=$2 AND ${LIVE_MED} ORDER BY m.created_at DESC LIMIT 1`, [patientId, ref.slice(5)])).rows[0] as any;
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
    if (item.kind === "barrier") {
      await recordBarrier(tx, actor, patientId, { drugClass: item.drugClass, category: item.category, detail: def.title, effectiveAt: at });
      changed.push("meds", "conditions"); // the rules that suggest this class re-run and stay quiet
      continue;
    }
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
  if (wizardId === "rdn-plan" && input.answers.decision === "schedule") {
    const fulfilled = (await tx.query(`UPDATE cf.plan_action SET status='completed',progress='reviewed',completed_at=$2,completed_by_ref=$3,completion_refs=$4,reviewed_at=$2,reviewed_by=$5,outcome='Specialist assessment confirmed in the RDN approval decision',version=version+1,updated_at=now() WHERE patient_id=$1 AND status='planned' AND title='Resistant hypertension: specialist assessment' RETURNING id`, [patientId, at, decisionId, [decisionId], actor.id])).rows;
    for (const task of fulfilled) await audit(tx, actor, "specialist-assessment-reviewed", "plan_action", task.id, patientId, {decisionId});
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
  const context = (await tx.query(`SELECT id FROM cf.care_context WHERE patient_id=$1 AND removed_at IS NULL AND status='open' ORDER BY started_at DESC LIMIT 1`, [patientId])).rows[0];
  const decisionId = uuid();
  await tx.query(`INSERT INTO cf.decision(id,patient_id,recommendation_id,outcome,reason,decided_by,context_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [
    decisionId, patientId, recommendationId, input.outcome, input.reason, actor.id, context?.id ?? null,
  ]);
  await journeyEvent(tx, actor, {
    patientId, occurredAt: nowIso(), kind: "decision", category: "complication", title: `${rec.title} · ${input.outcome}`,
    detail: input.reason, refType: "decision", refId: decisionId, contextId: context?.id ?? null,
  });
  await tx.query(`UPDATE cf.recommendation SET status='decided', closed_at=now() WHERE id=$1`, [recommendationId]);
  await audit(tx, actor, input.outcome, "recommendation", recommendationId, patientId, { reason: input.reason });
}

// A dismissal taken back: the alert is shown again (the decision stays in the record; append-only history).
export async function restoreRecommendation(tx: Q, actor: Actor, patientId: string, recommendationId: string) {
  const rec = (await tx.query(`SELECT * FROM cf.recommendation WHERE id=$1 AND patient_id=$2 AND status='decided'`, [recommendationId, patientId])).rows[0] as any;
  if (!rec) throw new ApiError(404, "This alert cannot be restored");
  const dup = (await tx.query(`SELECT 1 FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2 AND fingerprint=$3`, [patientId, rec.rule_id, rec.fingerprint])).rows[0];
  if (dup) throw new ApiError(409, "This alert is already shown again");
  await tx.query(`UPDATE cf.recommendation SET status='active', closed_at=NULL WHERE id=$1`, [recommendationId]);
  await journeyEvent(tx, actor, { patientId, occurredAt: nowIso(), kind: "decision", category: "complication", title: `${rec.title} · shown again`, detail: "Dismissal taken back", refType: "recommendation", refId: recommendationId });
  await audit(tx, actor, "restore", "recommendation", recommendationId, patientId, {});
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
  for (const [tag, v] of [["bb", "bb"], ["bb-other", "bb"], ["ivabradine", "ivabradine"], ["digoxin", "digoxin"], ["ndhp-ccb", "ccb"]] as const) if (on(tag)) detected.contributors.push(v);
  // amiodarone / dronedarone / sotalol by name: the QT tag also covers drugs that do not slow the heart
  if (s.meds.some((m) => m.status === "active" && ["amiodarone", "dronedarone", "sotalol"].includes(m.code))) detected.contributors.push("amiodarone");
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

// the record as it will be once the pathway's stops are applied: a medicine being stopped (e.g. ticagrelor
// switched to clopidogrel) does not count against the one being started
export function startChecksState(s: PatientState, outcome: ReturnType<typeof buildOutcome>): PatientState {
  const stopped = new Set(outcome.flatMap((o) => (o.kind === "medication" && o.event === "stop" ? [o.medicationId] : [])));
  const after = stopped.size ? ({ ...s, meds: s.meds.filter((m) => !stopped.has(m.id)) } as PatientState) : s;
  return proposedMedicines(after, outcome.flatMap(o => o.kind === "start" && MEDICATION[o.code] ? [o.code] : []));
}

// pre-start check of every medicine the answers would start (the Confirm step shows them; red needs a reason)
export async function wizardStartCheck(tx: Q, patientId: string, wizardId: string, answers: Answers) {
  if (!WIZARDS[wizardId]) throw new ApiError(404, "Unknown wizard");
  const s = await loadState(tx, patientId);
  const outcome = buildOutcome(wizardId, answers, wizardContext(s, wizardId));
  const after = startChecksState(s, outcome);
  const out: Record<string, ReturnType<typeof preStartCheck>> = {};
  for (const item of outcome)
    if (item.kind === "start" && MEDICATION[item.code] && !s.meds.some((m) => m.code === item.code && (m.status === "active" || m.status === "held")))
      out[item.code] = preStartCheck(after, item.code, MEDICATION[item.code]);
  return out;
}
