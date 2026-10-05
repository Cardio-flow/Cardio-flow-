// Guideline suggestions inside every pathway (Ahmed, 3 Oct 2026: "the pathways show the actions
// we do but do not suggest the steps according to guidelines — that is their purpose").
//
// For each question, a function reads the patient's data (latest values, diagnoses, medicines)
// and the answers given so far, and returns the option(s) the guideline recommends, each with the
// reason and its source. The wizard shows them as "Guideline" suggestions with one tap to apply;
// the clinician still decides and confirms. Thresholds are the ones each guideline states (cited
// beside each rule); nothing here is a locally chosen number. No doses.
//
// Sources: ESC HF 2021 (+2023 update, 2026) and its practical guidance on RAAS inhibitors, MRA,
// beta-blockers and diuretics; HFA 2019 diuretic position paper; ESC 2021 pacing; SCAI SHOCK 2022;
// Surviving Sepsis Campaign 2021; ADA/EASD/JBDS hyperglycaemic crises consensus 2024; ADA Standards
// of Care 2026; ESC 2023 CVD in diabetes; 2021 EHRA NOAC guide; ACCP/CHEST 2012 VKA; European
// hyponatraemia guideline 2014; ESC 2024 hypertension; IDF-DAR 2021; ESC 2022 non-cardiac surgery;
// NICE NG138/NG139 and BTS; ESC 2025 myocarditis/pericarditis; ESC 2023 endocarditis; ETA 2018.
import type { Answers, WizardContext } from "./wizards.js";
import { localDay } from "./clinical.js";
import { chestPainRisk, highIschaemic, isHbr } from "./wizards-coronary.js";

export type Suggestion = { value: string; why: string };
type Fn = (a: Answers, ctx: WizardContext) => (Suggestion | false | null | undefined | "" | 0)[];

const val = (c: WizardContext, code: string) => c.values?.[code]?.value ?? null;
const prev = (c: WizardContext, code: string) => c.values?.[code]?.prev ?? null;
const on = (c: WizardContext, ...tags: string[]) => c.meds.some((m) => m.tags.some((t) => tags.includes(t)));
const onCode = (c: WizardContext, ...codes: string[]) => c.meds.some((m) => codes.includes(m.code));
const dx = (c: WizardContext, ...d: string[]) => (c.dx ?? []).some((x) => d.includes(x));
const list = (a: Answers, id: string) => ((a[id] as string[] | undefined) ?? []).filter((v) => v !== "none");
const is = (a: Answers, id: string, v: string) => (Array.isArray(a[id]) ? (a[id] as string[]).includes(v) : a[id] === v);
const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
const S = (value: string, why: string): Suggestion => ({ value, why });

export const GUIDANCE: Record<string, Record<string, Fn>> = {
  // ---------------- Heart failure ----------------
  hyperkalaemia: {
    result: (_a, c) => {
      const k = val(c, "potassium");
      return [k != null && k > 5.5 && k <= 6.0 && S("repeat", `K ${n1(k)}: repeat to exclude a haemolysed sample before changing therapy`)];
    },
    actions: (a, c) => {
      const k = val(c, "potassium");
      if (k == null) return [];
      const ecg = a.ecg === "present", sym = list(a, "symptoms").length > 0;
      return [
        (k >= 6.5 || ecg || (k > 6.0 && sym)) && S("urgent", `K ${n1(k)}${ecg ? " with ECG changes" : ""}: same-day emergency treatment`),
        k > 6.0 && on(c, "mra") && S("hold-mra", `K >6.0: stop the MRA (ESC HF practical guidance)`),
        k > 5.5 && k <= 6.0 && on(c, "mra") && S("reduce-mra", `K 5.5–6.0: halve the MRA dose (ESC HF practical guidance)`),
        k > 5.5 && !on(c, "mra") && on(c, "raas") && S("reduce-raas", `K >5.5: halve the ACEi/ARB/ARNI dose; stop if K >6.0 (ESC HF practical guidance)`),
        k > 5.0 && on(c, "raas", "mra") && S("binder", `A potassium binder may be considered to keep RAAS inhibitor/MRA therapy (ESC HF 2021, IIb)`),
        (list(a, "contributors").includes("k-supplement") || onCode(c, "potassium-chloride")) && S("stop-supplement", "Stop potassium supplements and K-containing salt substitutes"),
        k > 5.0 && S("diet-advice", "Limit high-potassium foods and salt substitutes"),
      ];
    },
    recheck: (_a, c) => {
      const k = val(c, "potassium");
      return [k != null && (k > 6.0 ? S("0", "K >6.0: repeat today after treatment") : k > 5.5 ? S("7", "Recheck K and renal function within 1–2 weeks of a dose change (ESC HF practical guidance)") : null)];
    },
  },
  "renal-function": {
    actions: (a, c) => {
      const cr = val(c, "creatinine"), p = prev(c, "creatinine"), egfr = val(c, "egfr");
      const rise = cr != null && p ? (cr - p) / p : null;
      const severe = (rise != null && rise > 1) || (cr != null && cr > 310) || (egfr != null && egfr < 20);
      const big = rise != null && rise > 0.5;
      return [
        a.volume === "congested" && on(c, "loop") && S("increase-diuretic", "Still congested: decongest; a creatinine rise during decongestion is expected and should not stop treatment (HFA 2019)"),
        a.volume === "dry" && on(c, "loop") && S("reduce-diuretic", "Dry: reduce the loop diuretic (ESC HF practical guidance)"),
        (list(a, "contributors").includes("nsaid") || list(a, "contributors").includes("contrast") || on(c, "nsaid")) && S("hold-nephrotoxin", "Stop NSAIDs and other nephrotoxins"),
        rise != null && !big && cr! <= 266 && (egfr == null || egfr >= 25) && S("continue", `Creatinine ${p}→${cr} µmol/L (+${Math.round(rise * 100)}%): a rise ≤50% (and <266 µmol/L, eGFR ≥25) is acceptable — continue (ESC HF practical guidance)`),
        big && on(c, "raas") && S("reduce-raas", severe ? `Creatinine +${Math.round(rise! * 100)}%${cr! > 310 ? `, ${cr} µmol/L` : ""}: stop the ACEi/ARB/ARNI (rise >100%, >310 µmol/L or eGFR <20)` : `Creatinine +${Math.round(rise! * 100)}%: halve the ACEi/ARB/ARNI dose (rise >50%, ESC HF practical guidance)`),
        severe && S("nephrology", "Severe deterioration: specialist / nephrology input"),
      ];
    },
    recheck: (_a, c) => {
      const cr = val(c, "creatinine"), p = prev(c, "creatinine");
      return [cr != null && p ? ((cr - p) / p > 1 ? S("3", "Large rise: recheck within days") : S("7", "Recheck renal function and K in 1–2 weeks (ESC HF practical guidance)")) : null];
    },
  },
  congestion: {
    actions: (a, c) => [
      list(a, "redflags").length > 0 && S("admit", "Red flags (hypoxia, hypoperfusion, ACS, arrhythmia, K/renal): hospital assessment (ESC HF acute HF)"),
      on(c, "loop") ? S("increase-loop", "Congested on a loop diuretic: increase the dose (ESC HF 2021, I C)") : S("start-loop", "Congestion without a loop diuretic: start one (ESC HF 2021, I C)"),
      !on(c, "sglt2") && dx(c, "hf") && S("sglt2", "SGLT2 inhibitor for every HF patient (ESC HF 2021/2023, I A)"),
      list(a, "precipitants").length > 0 && S("precipitant", "Treat the precipitant you found"),
      S("self-care", "Daily weights and a written diuretic plan (ESC HF self-care, I)"),
    ],
    recheck: () => [S("3", "Renal function, K and weight a few days after a diuretic increase (HFA 2019)")],
    review: () => [S("phone-3", "Early review of the response to diuretics (HFA 2019)")],
  },
  hypotension: {
    actions: (a, c) => {
      const sym = list(a, "symptoms").length > 0;
      if (!sym) return [S("continue", "Asymptomatic low BP: no change to HF therapy (ESC HF practical guidance)")];
      return [
        on(c, "vasodilator", "bp-lowering") && S("stop-vasodilator", "Symptomatic: first stop BP-lowering drugs without HF benefit (nitrates, CCB, alpha-blockers)"),
        a.volume !== "congested" && on(c, "loop") && S("reduce-loop", "Not congested: then reduce the diuretic"),
        S("stagger", "Space the HF drugs through the day"),
        is(a, "symptoms", "syncope") && S("specialist", "Syncope: specialist review"),
      ];
    },
  },
  bradycardia: {
    actions: (a, c) => {
      const hr = val(c, "hr");
      const highGrade = a.block === "high-grade" || a.block === "pauses";
      const sym = list(a, "symptoms").length > 0;
      return [
        (highGrade || is(a, "symptoms", "syncope")) && S("urgent", "High-grade AV block, pauses or syncope: same-day assessment"),
        highGrade && S("pacing", "Mobitz II, high-grade AV block or symptomatic pauses: pacing evaluation (ESC 2021 pacing, I)"),
        a.block === "no-ecg" && S("ecg", "Exclude AV block on a 12-lead ECG"),
        on(c, "ivabradine", "digoxin", "ndhp-ccb") && S("stop-other", "Review other rate-slowing drugs before the beta-blocker (ESC HF practical guidance)"),
        sym && hr != null && hr < 50 && on(c, "bb") && !highGrade && S("reduce-bb", `HR ${hr} with symptoms: halve the beta-blocker (ESC HF practical guidance)`),
        !sym && !highGrade && a.block && a.block !== "no-ecg" && S("continue", "Asymptomatic sinus bradycardia: no change"),
      ];
    },
  },

  // ---------------- Acute & safety ----------------
  shock: {
    stage: (_a, c) => {
      const sbp = val(c, "sbp"), lac = val(c, "lactate");
      return [sbp != null && sbp < 90 && (lac != null && lac >= 2 ? S("C", `SBP ${sbp} with lactate ${n1(lac)}: hypoperfusion needing intervention (SCAI C)`) : S("B", `SBP ${sbp} without raised lactate: SCAI B (beginning)`))];
    },
    actions: (a) => [
      S("icu", "Shock: ICU/CCU-level care"),
      S("hold-hf", "Stop beta-blockers, RAAS inhibitors, MRA, SGLT2i and vasodilators while in shock"),
      S("echo", "Urgent echo to define the type"),
      (a.type === "cardiogenic" || a.type === "mixed") && S("ecg-cath", "Cardiogenic: ECG and immediate angiography if ACS-related (ESC ACS, I B)"),
      (a.type === "septic" || a.type === "mixed") && S("cultures", "Septic: cultures and antibiotics within 1 h (SSC 2021)"),
      (a.type === "septic" || a.type === "mixed") && S("pressor", "Septic shock: norepinephrine first line, MAP ≥65 (SSC 2021)"),
      a.type === "cardiogenic" && (a.stage === "D" || a.stage === "E") && S("mcs", "SCAI D/E cardiogenic shock: shock team / mechanical support discussion"),
      a.type === "obstructive" && S("drain", "Obstructive: relieve the cause (tamponade drainage, PE reperfusion)"),
    ],
    recheck: () => [S("0", "Lactate and haemodynamics again today")],
  },
  sepsis: {
    signs: (_a, c) => {
      const t = val(c, "temp"), hr = val(c, "hr"), rr = val(c, "rr"), sbp = val(c, "sbp"), lac = val(c, "lactate");
      return [
        t != null && (t > 38 || t < 36) && S("fever", `Temperature ${n1(t)} °C`),
        hr != null && hr > 90 && S("tachycardia", `HR ${hr}/min (>90)`),
        rr != null && rr >= 22 && S("tachypnoea", `RR ${rr} (qSOFA ≥22)`),
        sbp != null && sbp <= 100 && S("hypotension", `SBP ${sbp} (qSOFA ≤100)`),
        lac != null && lac >= 2 && S("lactate", `Lactate ${n1(lac)} mmol/L (≥2)`),
      ];
    },
    actions: (a, c) => {
      const sbp = val(c, "sbp"), lac = val(c, "lactate");
      const shock = (sbp != null && sbp < 90) || (lac != null && lac >= 4) || is(a, "signs", "hypotension");
      return [
        S("cultures", "Blood cultures before antibiotics (SSC 2021)"),
        S("lactate", "Measure lactate; repeat if raised (SSC 2021)"),
        S("antibiotics", shock ? "Possible septic shock: antibiotics within 1 h (SSC 2021)" : "Antibiotics within 3 h if sepsis is likely (SSC 2021)"),
        shock && S("fluids", "Hypotension or lactate ≥4: fluids, in small boluses with reassessment in HF/low EF (SSC 2021)"),
        S("hold-sickday", "Hold SGLT2i, metformin, diuretics and RAAS/MRA while septic and not congested"),
        (a.source === "valve" || dx(c, "prosthetic-valve", "cied")) && S("endocarditis", "Prosthetic valve, device or valve source: look for endocarditis"),
        shock && S("escalate", "Persistent hypotension or lactate ≥4: escalate (norepinephrine, ICU)"),
      ];
    },
    recheck: (_a, c) => [val(c, "lactate") != null && val(c, "lactate")! >= 2 ? S("0", "Raised lactate: remeasure within hours (SSC 2021)") : null],
  },
  hyperglycaemia: {
    picture: (_a, c) => {
      const g = val(c, "glucose"), k = val(c, "ketones"), ph = val(c, "ph"), hco3 = val(c, "bicarbonate");
      const acid = (ph != null && ph < 7.3) || (hco3 != null && hco3 < 18);
      return [
        k != null && k >= 3 && acid && g != null && g >= 11.1 && S("dka", `Glucose ${n1(g)}, ketones ${n1(k)}, acidosis: DKA (2024 consensus)`),
        k != null && k >= 3 && acid && g != null && g < 11.1 && S("eudka", `Ketones ${n1(k)} with acidosis and glucose <11.1${on(c, "sglt2") ? " on an SGLT2i" : ""}: euglycaemic DKA`),
        g != null && g >= 33.3 && (k == null || k < 3) && S("hhs", `Glucose ${n1(g)} without significant ketosis: HHS (2024 consensus)`),
      ];
    },
    actions: (a, c) => {
      const crisis = ["dka", "eudka", "hhs"].includes(String(a.picture));
      return [
        crisis && S("emergency", "DKA/HHS: emergency treatment per protocol"),
        (crisis || is(a, "drugs", "sglt2")) && on(c, "sglt2") && S("stop-sglt2", "Stop the SGLT2 inhibitor during ketoacidosis / acute illness"),
        S("diabetes-team", "Diabetes team review"),
        a.picture === "uncontrolled" && S("intensify", "Uncontrolled without crisis: intensify glucose-lowering therapy (ADA 2026)"),
        S("sick-day", "Sick-day rules education"),
      ];
    },
    recheck: (a) => [["dka", "eudka", "hhs"].includes(String(a.picture)) ? S("0", "Crisis: glucose, ketones, K and gas hourly to 2-hourly per protocol") : null],
  },
  hypoglycaemia: {
    level: (_a, c) => {
      const g = val(c, "glucose");
      return [g != null && (g < 3.0 ? S("2", `Glucose ${n1(g)} <3.0 mmol/L: level 2 (ADA 2026)`) : g < 3.9 ? S("1", `Glucose ${n1(g)} <3.9 mmol/L: level 1 (ADA 2026)`) : null)];
    },
    actions: (a, c) => {
      return [
        on(c, "sulfonylurea") && S("stop-su", "Hypoglycaemia on a sulfonylurea: stop or switch to a lower-risk drug (ADA 2026)"),
        on(c, "insulin") && S("reduce-insulin", "Reduce insulin and review timing (ADA 2026)"),
        a.level && a.level !== "1" && S("relax-target", "Level 2–3 hypoglycaemia: raise the glycaemic target for a time (ADA 2026)"),
        S("education", "Hypoglycaemia recognition and treatment education; glucagon if level 2–3"),
        a.level !== "1" && S("diabetes-team", "Level 2–3: re-evaluate the treatment plan with the diabetes team (ADA 2026)"),
      ];
    },
  },
  bleeding: {
    actions: (a, c) => {
      const major = a.severity === "major" || a.severity === "life", mod = a.severity === "moderate";
      const dapt = c.meds.filter((m) => m.tags.includes("antiplatelet")).length >= 2;
      return [
        major && S("emergency", "Major bleeding: emergency assessment, resuscitation, find the source (EHRA 2021)"),
        (major || mod) && on(c, "oac") && S("hold-oac", "Hold the anticoagulant (EHRA 2021)"),
        a.severity === "life" && on(c, "antiplatelet") && S("hold-ap", "Life-threatening bleeding: stop all antiplatelets; once controlled, re-evaluate DAPT or single antiplatelet, preferably the P2Y12 inhibitor (ESC DAPT 2017)"),
        major && a.severity !== "life" && !dapt && on(c, "antiplatelet") && S("hold-ap", "Major bleeding: hold antiplatelet therapy (weigh stent risk)"),
        a.severity === "minor" && dapt && S("continue-dapt", "Trivial or mild bleeding: continue DAPT; consider a shorter course or a less potent P2Y12 inhibitor if it recurs (ESC DAPT 2017)"),
        (mod || a.severity === "major") && dapt && S("sapt", `${mod ? "Moderate" : "Severe"} bleeding on DAPT: single antiplatelet, preferably the P2Y12 inhibitor (especially upper GI); restart DAPT as soon as safe (ESC DAPT 2017)`),
        (mod || a.severity === "minor") && dapt && on(c, "p2y12-potent") && S("to-clopidogrel", "Bleeding on ticagrelor/prasugrel: consider switching to clopidogrel (ESC DAPT 2017 / ACS 2023 de-escalation)"),
        c.coronary && c.coronary.days <= 365 && on(c, "antiplatelet") && S("restart", `${c.coronary.pciAt ? "PCI" : "ACS"} ${c.coronary.days} days ago: plan the antiplatelet restart early — stent thrombosis risk is highest in the first months`),
        major && on(c, "oac") && S("reversal", "Life-threatening bleeding on an anticoagulant: specific reversal per protocol (EHRA 2021)"),
        a.site === "gi" && S("gi", "GI bleeding: endoscopy"),
        (a.site === "gi" || (on(c, "antiplatelet") && on(c, "oac"))) && S("ppi", "PPI with antithrombotic therapy at GI risk (ESC, I A)"),
        S("restart", "Set the restart date before discharge: most patients need their antithrombotic back (EHRA 2021)"),
      ];
    },
  },
  "low-potassium": {
    actions: (a, c) => {
      const k = val(c, "potassium"), mg = val(c, "magnesium");
      return [
        k != null && (k < 2.5 || a.ecg === "changes") && S("urgent", `K ${n1(k)}${a.ecg === "changes" ? " with ECG changes" : ""}: urgent IV replacement with monitoring`),
        k != null && k < 3.5 && S("oral-k", `K ${n1(k)}: replace potassium`),
        ((mg != null && mg < 0.7) || on(c, "loop", "thiazide")) && S("mg", mg != null && mg < 0.7 ? `Mg ${mg}: replace magnesium (needed to correct K)` : "Check and replace magnesium on diuretics"),
        dx(c, "hf") && !on(c, "mra") && S("mra", "HF: an MRA corrects K long term and is indicated in HFrEF (ESC HF, I A)"),
        on(c, "loop", "thiazide") && S("review-diuretic", "Review the diuretic dose"),
      ];
    },
    recheck: (_a, c) => {
      const k = val(c, "potassium");
      return [k != null && (k < 3.0 ? S("1", "Recheck tomorrow") : S("3", "Recheck in a few days"))];
    },
  },
  hyponatraemia: {
    actions: (a, c) => {
      return [
        a.symptoms === "severe" && S("emergency", "Severe symptoms: emergency treatment (hypertonic saline per protocol) (European guideline 2014)"),
        on(c, "thiazide") && S("stop-thiazide", "Stop the thiazide: the commonest drug cause"),
        (a.volume === "congested" || a.volume === "euvolaemic") && S("fluid", "Fluid restriction"),
        a.volume === "congested" && S("decongest", "Congested HF: decongest with a loop diuretic"),
        (a.volume === "dry" || is(a, "causes", "ssri")) && S("review-drug", "Review drugs (SSRIs, diuretics)"),
      ];
    },
    recheck: (_a, c) => {
      const na = val(c, "sodium");
      return [na != null && (na < 125 ? S("1", "Profound hyponatraemia: recheck within 24 h") : S("7", "Recheck in a week"))];
    },
  },
  inr: {
    direction: (_a, c) => {
      const inr = val(c, "inr");
      return [inr != null && (inr > 3 ? S("high", `INR ${n1(inr)}`) : inr < 2 ? S("low", `INR ${n1(inr)}`) : null)];
    },
    actions: (a, c) => {
      const inr = val(c, "inr");
      const high = a.direction === "high";
      return [
        a.bleeding === "major" && S("emergency", "Major bleeding: emergency reversal (PCC + IV vitamin K) per protocol (CHEST 2012)"),
        high && a.bleeding !== "major" && S("omit", "Supratherapeutic INR: omit/reduce the next dose(s) (CHEST 2012)"),
        high && a.bleeding !== "major" && inr != null && inr > 10 && S("vitk", `INR ${n1(inr)} >10 without bleeding: oral vitamin K (CHEST 2012)`),
        high && a.bleeding === "minor" && S("vitk", "Minor bleeding with a high INR: consider oral vitamin K"),
        !high && dx(c, "mechanical-valve") && S("bridge", "Low INR with a mechanical valve: consider bridging with heparin until INR in range"),
        S("education", "Review interactions, diet and adherence"),
      ];
    },
    recheck: (a) => [a.direction === "high" ? S("3", "Repeat INR in a few days") : S("7", "Repeat INR within a week")],
  },
  digoxin: {
    actions: (a, c) => {
      const lvl = val(c, "digoxin-level"), k = val(c, "potassium");
      const severe = is(a, "features", "arrhythmia");
      return [
        severe && S("emergency", "Toxicity with arrhythmia: emergency care"),
        severe && S("antibody", "Life-threatening arrhythmia: digoxin-specific antibody per protocol"),
        (list(a, "features").length > 0 || (lvl != null && lvl > 2)) && on(c, "digoxin") && S("stop", "Symptoms of toxicity: stop digoxin"),
        lvl != null && lvl > 0.9 && list(a, "features").length === 0 && on(c, "digoxin") && S("hold", `Level ${lvl} ng/mL above the 0.5–0.9 target (ESC HF): hold, then restart at a lower dose`),
        k != null && k < 3.5 && S("correct-k", `K ${n1(k)}: correct K and Mg (low K worsens toxicity)`),
      ];
    },
    recheck: () => [S("1", "K, renal function and ECG tomorrow")],
  },
  "severe-hypertension": {
    actions: (a, c) => {
      const hmod = list(a, "hmod").length > 0;
      return [
        hmod && S("emergency", "Acute organ damage: hypertensive emergency — admit for IV therapy (ESC 2024)"),
        !hmod && S("oral", "No acute organ damage: oral therapy, lower BP over days to weeks; avoid rapid drops (ESC 2024)"),
        !hmod && S("home-bp", "Confirm with home / ambulatory BP (ESC 2024)"),
        ((c.profile?.age ?? 99) < 40 || (val(c, "potassium") ?? 9) < 3.5) && S("secondary", "Age <40 or low K: screen for secondary hypertension (ESC 2024)"),
      ];
    },
    recheck: (a) => [list(a, "hmod").length ? S("0", "Hypertensive emergency: monitor continuously") : S("7", "Review BP within a week")],
  },

  // ---------------- Diabetes ----------------
  diabetes: {
    protect: (_a, c) => {
      const egfr = val(c, "egfr"), uacr = val(c, "uacr"), k = val(c, "potassium");
      const ascvd = dx(c, "ascvd", "cad", "stroke", "pad"), hf = dx(c, "hf"), ckd = dx(c, "ckd") || (egfr != null && egfr < 60) || (uacr != null && uacr >= 3);
      const out = [
        !on(c, "sglt2") && (hf || ckd || ascvd) && (egfr == null || egfr >= 20) && S("sglt2", `${hf ? "HF" : ckd ? "CKD" : "ASCVD"}: SGLT2 inhibitor regardless of HbA1c (ESC 2023 CVD-DM, I A)`),
        !on(c, "glp1") && ascvd && S("glp1", "ASCVD: GLP-1 RA with proven CV benefit regardless of HbA1c (ESC 2023, I A)"),
        !onCode(c, "finerenone") && on(c, "raas") && uacr != null && uacr >= 3 && (egfr == null || egfr >= 25) && (k == null || k <= 5.0) && S("finerenone", `UACR ${uacr} mg/mmol on a RAAS inhibitor: finerenone (ESC 2023, I A)`),
      ].filter(Boolean) as Suggestion[];
      return out.length ? out : [S("covered", "Heart and kidney protection already in place")];
    },
    lower: (a, c) => {
      const a1c = val(c, "hba1c"), egfr = val(c, "egfr");
      if (a1c == null || a1c <= 7) return [a1c != null && S("no-change", `HbA1c ${n1(a1c)}% at the usual 7% target (ADA 2026)`)];
      return [
        !on(c, "metformin") && (egfr == null || egfr >= 30) && S("metformin", `HbA1c ${n1(a1c)}%: metformin if not contraindicated (ADA 2026)`),
        dx(c, "obesity") && !on(c, "glp1") && S("tirzepatide", "Obesity: GLP-1 RA / tirzepatide lowers glucose and weight (ADA 2026)"),
      ];
    },
    safety: (_a, c) => {
      const egfr = val(c, "egfr");
      return [
        on(c, "tzd") && dx(c, "hf") && S("stop-tzd", "Pioglitazone is contraindicated in heart failure (ESC HF, III A)"),
        on(c, "dpp4-hf") && dx(c, "hf") && S("stop-dpp4-hf", "Saxagliptin/alogliptin: HF hospitalisation signal — avoid in HF (ESC, III B)"),
        on(c, "glibenclamide") && S("switch-glib", "Glibenclamide: highest hypoglycaemia risk — switch (ADA 2026)"),
        on(c, "metformin") && egfr != null && egfr < 30 && S("stop-metformin", `eGFR ${egfr} <30: stop metformin (label)`),
        on(c, "metformin") && egfr != null && egfr >= 30 && egfr < 45 && S("reduce-metformin", `eGFR ${egfr} 30–44: maximum 1000 mg/day (label)`),
      ];
    },
    monitoring: () => [S("hba1c", "HbA1c every 3–6 months (ADA 2026)"), S("renal", "eGFR and UACR at least yearly (ADA 2026)"), S("eyes", "Annual eye screening"), S("feet", "Annual foot examination")],
  },
  "sick-day": {
    pause: (a, c) => {
      const ill = list(a, "illness").length > 0;
      const dry = is(a, "redflags", "dehydrated") || is(a, "redflags", "fluids");
      return [
        ill && on(c, "sglt2") && S("sglt2", "Pause SGLT2 inhibitor (ketoacidosis risk)"),
        ill && on(c, "metformin") && S("metformin", "Pause metformin (lactic acidosis / AKI)"),
        ill && on(c, "sulfonylurea") && S("sulfonylurea", "Pause sulfonylurea when not eating (hypoglycaemia)"),
        is(a, "illness", "vomiting") && on(c, "glp1") && S("glp1", "Vomiting: pause the GLP-1 RA"),
        dry && on(c, "raas") && S("raas", "Dehydrated (not congested): pause ACEi/ARB/ARNI"),
        dry && on(c, "mra") && S("mra", "Dehydrated: pause MRA"),
        dry && on(c, "loop", "thiazide") && S("diuretic", "Dehydrated: pause the diuretic"),
      ];
    },
    checks: (_a, c) => [
      on(c, "insulin") && S("basal", "Never stop basal insulin"),
      (on(c, "sglt2") || dx(c, "t1dm")) && S("ketones", "Check ketones"),
      S("fluids", "Keep drinking"), S("no-nsaid", "Avoid NSAIDs"), S("restart", "Restart within 24–48 h of eating and drinking normally"), S("when-help", "When to seek help"),
    ],
    review: (a) => [list(a, "redflags").length > 0 ? S("phone-1", "Red flags: call within a day") : null],
  },
  ramadan: {
    advice: (a) => [a.category === "high" ? S("not-fast", "High risk (IDF-DAR 2021): advise not to fast") : a.category ? S("fast-plan", `${a.category === "low" ? "Low" : "Moderate"} risk (IDF-DAR 2021): fasting possible with a plan`) : null],
    monitoring: () => [S("smbg", "Glucose checks while fasting (IDF-DAR 2021)"), S("break", "When to break the fast"), S("education", "Pre-Ramadan education")],
  },

  // ---------------- Procedures & general medicine ----------------
  "pre-procedure": {
    tests: (a, c) => {
      const risk = String(a.risk ?? ""), poor = a.capacity !== "good" && !!a.capacity;
      const atRisk = !!c.profile && (c.profile.cvd || c.profile.riskFactors || c.profile.age >= 65);
      if (a.urgency === "emergency") return [S("none", "Emergency surgery: do not delay for testing")];
      if (risk === "low") return [S("none", "Low-risk surgery: routine cardiac testing not recommended (ESC 2022)")];
      if (!risk) return [];
      return [
        atRisk && S("ecg", "CVD, risk factors or age ≥65 before intermediate/high-risk surgery: ECG (ESC 2022, I C)"),
        atRisk && S("troponin", "hs-troponin before and at 24/48 h (ESC 2022, I B)"),
        atRisk && S("bnp", "Consider NT-proBNP (ESC 2022, IIa B)"),
        S("labs", "Hb, renal function and K"),
        poor && (risk === "high" || dx(c, "hf", "valve")) && S("echo", "Poor capacity before high-risk surgery / HF / valve disease: echo (ESC 2022, I B)"),
        poor && risk === "high" && (dx(c, "cad") || list(a, "rcri").length >= 2) && S("stress", "High-risk surgery, poor capacity and likely CAD: stress imaging (ESC 2022, I B)"),
      ];
    },
    meds: (a, c) => [
      on(c, "bb", "bb-other") && S("bb", "Continue beta-blocker (ESC 2022, I B); do not start routinely"),
      on(c, "statin") && S("statin", "Continue statin (ESC 2022, I B)"),
      on(c, "antiplatelet") && a.bleeding !== "high" && S("aspirin", "Continue aspirin after PCI if bleeding risk allows (ESC 2022, I B)"),
      on(c, "raas") && !dx(c, "hf") && S("raas", "No HF: consider withholding ACEi/ARB on the day of surgery (ESC 2022, IIa)"),
      on(c, "sglt2") && a.risk !== "low" && S("sglt2", "Stop SGLT2i ≥3 days before intermediate/high-risk surgery (ESC 2022, IIa)"),
      on(c, "p2y12") && a.urgency !== "emergency" && a.pci !== "pci-1" && a.bleeding !== "minimal" && S("p2y12", "Interrupt P2Y12 inhibitor: clopidogrel 5, ticagrelor 3–5, prasugrel 7 days (ESC 2022)"),
      on(c, "doac") && a.bleeding !== "minimal" && S("doac", "Interrupt DOAC by bleeding risk and renal function; no bridging (EHRA 2021)"),
      on(c, "vka") && a.bleeding !== "minimal" && S("vka", "Stop warfarin 5 days before; INR the day before"),
      on(c, "metformin") && S("metformin", "Hold metformin on the day"),
      on(c, "glp1") && S("glp1", "Weekly GLP-1 RA: follow the anaesthesia fasting guidance"),
      on(c, "insulin") && S("insulin", "Peri-operative insulin plan"),
    ],
    conclusion: (a) => {
      if (list(a, "active").length && a.urgency !== "emergency") return [S("delay", "Active cardiac condition: treat before elective surgery (ESC 2022)")];
      if (a.urgency === "emergency" || a.risk === "low") return [S("proceed", "Proceed")];
      if (list(a, "tests").length) return [S("after-tests", "Proceed after the tests")];
      return [];
    },
  },
  "chest-infection": {
    curb: (_a, c) => {
      const urea = val(c, "urea"), rr = val(c, "rr"), sbp = val(c, "sbp"), dbp = val(c, "dbp"), age = c.profile?.age;
      return [
        urea != null && urea > 7 && S("u", `Urea ${n1(urea)} mmol/L (>7)`), rr != null && rr >= 30 && S("r", `RR ${rr}/min (≥30)`),
        ((sbp != null && sbp < 90) || (dbp != null && dbp <= 60)) && S("b", `BP ${sbp ?? "?"}/${dbp ?? "?"} (SBP <90 or DBP ≤60)`), age != null && age >= 65 && S("65", `Age ${age} (≥65)`),
      ];
    },
    severity: (a) => {
      if (a.setting !== "cap") return [];
      const n = list(a, "curb").length;
      return [n <= 1 ? S("low", `CURB-65 ${n}: low severity — home treatment (NICE NG138)`) : n === 2 ? S("moderate", "CURB-65 2: moderate — consider hospital (NICE NG138)") : S("high", `CURB-65 ${n}: high — hospital, consider ICU (NICE NG138)`)];
    },
    tests: (a, c) => {
      const sev = a.severity !== "low", spo2 = val(c, "spo2");
      return [
        S("cxr", "Chest X-ray"), sev && S("bloods", "FBC, CRP, renal function"), sev && S("cultures", "Moderate/high severity: blood and sputum cultures (NICE NG138)"),
        sev && S("antigen", "Moderate/high: pneumococcal and Legionella urinary antigens (NICE NG138)"),
        spo2 != null && spo2 < 92 && S("abg", `SpO₂ ${spo2}%: blood gas`),
        dx(c, "hf", "cad", "af") && S("cardiac", "Cardiac patient: ECG and troponin (pneumonia raises MI, AF and HF risk)"),
        dx(c, "hf") && S("bnp", "HF: NT-proBNP if breathlessness may be cardiac"),
      ];
    },
    "cap-abx": (a) => [a.severity === "low" ? S("amox", "Low severity: amoxicillin (NICE NG138)") : a.severity === "moderate" ? S("amox-mac", "Moderate: amoxicillin + clarithromycin (NICE NG138)") : a.severity === "high" ? S("coamox-mac", "High: co-amoxiclav + clarithromycin IV (NICE NG138)") : null],
    "hap-abx": (a) => [a.severity === "high" ? S("severe", "Severe / resistance risk: antipseudomonal agent (NICE NG139)") : a.severity ? S("nonsevere", "Non-severe: co-amoxiclav (NICE NG139)") : null],
    cardiac: (a, c) => {
      const macrolide = a["cap-abx"] === "amox-mac" || a["cap-abx"] === "coamox-mac";
      return [
        macrolide && on(c, "qt") && S("qt", "Macrolide with a QT-prolonging drug: check QTc"),
        macrolide && on(c, "statin") && S("statin", "Clarithromycin: pause simvastatin / review atorvastatin (CYP3A4)"),
        macrolide && on(c, "doac", "p2y12") && S("doac", "Clarithromycin raises DOAC/ticagrelor levels: prefer doxycycline"),
        on(c, "vka") && S("warfarin", "On warfarin: INR in 3–5 days on antibiotics"),
        (val(c, "sbp") ?? 999) < 90 && S("sickday", "Hypotensive: sick-day holds"),
        dx(c, "hf") && on(c, "loop") && S("hf", "HF: daily weight and fluid balance"),
      ];
    },
    after: (a, c) => [
      S("review", "Review at 48–72 h if not improving (NICE NG138)"),
      is(a, "cardiac", "sickday") && S("restart", "Restart held medicines when eating, drinking and stable"),
      (c.profile?.age ?? 0) >= 50 && dx(c, "smoker") && S("cxr6", "Age ≥50 and smoker: repeat chest X-ray at 6 weeks"),
      S("vaccines", "Influenza, pneumococcal and COVID-19 vaccination"),
    ],
  },

  // ---------------- Coronary ----------------
  antithrombotic: {
    setting: (_a, c) => [c.coronary ? S(c.coronary.acs ? "acs" : "ccs", `${c.coronary.indexTitle} (${localDay(c.coronary.indexAt)})`) : null],
    oac: (_a, c) => [on(c, "oac") ? S("yes", "On an oral anticoagulant") : S("no", "No anticoagulant recorded")],
    hbr: (_a, c) => {
      const egfr = val(c, "egfr"), hb = val(c, "haemoglobin"), plt = val(c, "platelets"), age = c.profile?.age ?? 0;
      const male = c.profile?.sex !== "Female";
      const out = [
        on(c, "oac") && S("oac-long", "On an oral anticoagulant (ARC-HBR major)"),
        egfr != null && egfr < 30 && S("egfr30", `eGFR ${Math.round(egfr)} (ARC-HBR major)`),
        egfr != null && egfr >= 30 && egfr < 60 && S("egfr59", `eGFR ${Math.round(egfr)} (ARC-HBR minor)`),
        hb != null && hb < 11 && S("hb11", `Hb ${hb} g/dL (ARC-HBR major)`),
        hb != null && hb >= 11 && hb < (male ? 13 : 12) && S("hb-minor", `Hb ${hb} g/dL (ARC-HBR minor — 11–12.9 men, 11–11.9 women)`),
        plt != null && plt < 100 && S("plt100", `Platelets ${plt} (ARC-HBR major)`),
        dx(c, "liver-disease") && S("liver", "Chronic liver disease recorded: major if cirrhosis with portal hypertension"),
        age >= 75 && S("age75", `Age ${age} (ARC-HBR minor)`),
        on(c, "nsaid", "steroid") && S("nsaid", "On an NSAID or steroid (ARC-HBR minor)"),
        dx(c, "stroke-tia") && S("stroke", "Previous stroke/TIA recorded (ARC-HBR minor if ischaemic)"),
      ];
      return out.some(Boolean) ? out : [S("none", "No ARC-HBR criterion in the record")];
    },
    ischaemic: (_a, c) => {
      const egfr = val(c, "egfr");
      const out = [
        c.coronary?.complexPci && S("complex", "Complex PCI recorded"),
        dx(c, "dm") && (on(c, "metformin", "insulin", "sulfonylurea", "glp1", "dpp4", "sglt2")) && S("dm", "Diabetes on treatment"),
        egfr != null && egfr >= 15 && egfr < 60 && S("ckd", `eGFR ${Math.round(egfr)}`),
        dx(c, "pad") && S("pad", "Peripheral arterial disease recorded"),
      ];
      return out.some(Boolean) ? out : [S("none", "No high ischaemic risk feature in the record")];
    },
    dapt: (a) => {
      const hbr = isHbr(a);
      if (a.setting === "acs") return [hbr ? S("1m-acs", "ACS with high bleeding risk: single antiplatelet after 1 month of DAPT may be considered (ESC ACS 2023, IIb A)") : S("12m", "ACS: DAPT for 12 months by default (ESC ACS 2023, I A)")];
      if (a.setting === "ccs") return [hbr && !highIschaemic(a) ? S("1-3m", "Elective PCI with high bleeding risk, not high ischaemic risk: DAPT 1–3 months (ESC CCS 2024, I A)") : S("6m", "Elective PCI: DAPT 6 months (ESC CCS 2024)")];
      return [];
    },
    tat: (a) => [highIschaemic(a) && !isHbr(a) ? S("1m", "High ischaemic risk without high bleeding risk: triple therapy up to 1 month (ESC ACS 2023)") : S("1w", "Triple therapy up to 1 week, then stop aspirin (ESC ACS 2023 / CCS 2024, I A)")],
    dual: (a) => [a.setting === "ccs" ? S("6m", "Elective PCI: anticoagulant + clopidogrel to 6 months, then anticoagulant alone (ESC CCS 2024)") : isHbr(a) ? S("6m", "ACS with high bleeding risk: consider stopping the antiplatelet at 6 months (ESC ACS 2023)") : a.setting === "acs" ? S("12m", "ACS: anticoagulant + clopidogrel to 12 months, then anticoagulant alone (ESC ACS 2023, I A)") : null],
    now: (a, c) => {
      const combined = c.meds.filter((m) => m.tags.some((t) => t === "antiplatelet" || t === "oac")).length >= 2;
      return [
        on(c, "p2y12-potent") && (on(c, "oac") || a.oac === "yes") && S("to-clopidogrel", "With an anticoagulant, clopidogrel is the P2Y12 inhibitor of choice; ticagrelor/prasugrel are not recommended in triple therapy (ESC ACS 2023)"),
        combined && !on(c, "ppi") && S("ppi", "PPI with combined antithrombotic therapy at increased GI-bleeding risk (ESC ACS 2023, I A)"),
      ];
    },
  },

  "chest-pain-cad": {
    instability: (_a, c) => {
      const sbp = val(c, "sbp");
      return [sbp != null && sbp < 90 ? S("shock", `SBP ${sbp} mmHg (<90: SCAI shock criterion)`) : null];
    },
    adherence: (_a, c) => {
      const recent = c.coronary && c.coronary.days <= 365;
      return [on(c, "antiplatelet") ? S("taking", "Antiplatelet therapy on the medication list: confirm doses were not missed") : recent ? S("stopped", `No antiplatelet on the list ${c.coronary!.days} days after ${c.coronary!.pciAt ? "the PCI" : "the ACS"}`) : null];
    },
    actions: (a, c) => {
      const risk = chestPainRisk(a);
      return [
        risk === "stemi" && S("cath-now", "ST elevation with ongoing ischaemia: immediate primary PCI (ESC ACS 2023, I A)"),
        risk === "very-high" && S("cath-now", "Very high-risk NSTE-ACS: immediate invasive strategy <2 h (ESC ACS 2023, I C)"),
        risk === "high" && S("invasive-24", "NSTE-ACS: early invasive strategy within 24 h (ESC ACS 2023, IIa A)"),
        a.ecg === "not-done" && S("ecg", "ECG within 10 minutes (ESC ACS 2023, I B)"),
        a.troponin === "pending" && S("serial-trop", "hs-troponin 0 h/1 h or 0 h/2 h (ESC ACS 2023, I B)"),
        (a.adherence === "stopped" || a.adherence === "missed") && S("restart-ap", "Interrupted antiplatelet therapy after PCI: restart unless bleeding forbids it"),
        risk === "stable" && !on(c, "nitrate") && S("sl-nitrate", "Short-acting nitrate for immediate relief (ESC CCS 2024, I B)"),
        risk === "stable" && S("antianginal", "Beta-blocker and/or calcium-channel blocker first line (ESC CCS 2024, I B)"),
        risk === "stable" && S("functional", "Recurrent angina after PCI: test for ischaemia or restenosis (ESC CCS 2024)"),
        risk === "atypical" && S("non-cardiac", "Look for a non-cardiac cause"),
      ];
    },
  },
  "acs-discharge": {
    type: (_a, c) => {
      const t = c.coronary?.acs ? c.coronary.indexTitle : "";
      return [/NSTE|NSTEMI/i.test(t) ? S("nstemi", `${t} recorded`) : /STEMI/i.test(t) ? S("stemi", `${t} recorded`) : dx(c, "acs-stemi") ? S("stemi", "STEMI on the problem list") : dx(c, "acs-nstemi") ? S("nstemi", "NSTEMI on the problem list") : null];
    },
    lvef: (_a, c) => {
      const ef = c.values?.lvef;
      const since = ef && c.coronary?.acsAt ? localDay(ef.at) >= c.coronary.acsAt : !!ef;
      if (!ef || !since) return [S("not-measured", "No LVEF since the ACS: echo during the admission to assess LV function (ESC ACS 2023)")];
      return [S(ef.value <= 40 ? "le40" : ef.value < 50 ? "41-49" : "ge50", `LVEF ${ef.value}% (${localDay(ef.at)})`)];
    },
    start: (a, c) => {
      const lowEf = a.lvef === "le40";
      const ldl = val(c, "ldl-c");
      const onStatinBefore = c.meds.some((m) => m.tags.includes("statin") && (!c.coronary?.acsAt || !m.startedAt || localDay(m.startedAt) < c.coronary.acsAt));
      return [
        !on(c, "statin") && S("statin", "High-intensity statin as early as possible after ACS (ESC ACS 2023, I A)"),
        on(c, "statin") && !c.meds.some((m) => m.tags.includes("statin") && ((m.code.startsWith("atorvastatin") && (m.doseValue ?? 0) >= 40) || (m.code.startsWith("rosuvastatin") && (m.doseValue ?? 0) >= 20))) && S("intensify", "Statin below high intensity (atorvastatin 40–80 mg / rosuvastatin 20–40 mg) (ESC ACS 2023, I A)"),
        !on(c, "ezetimibe") && onStatinBefore && ldl != null && ldl >= 1.4 && S("ezetimibe", `Already on a statin at the ACS and LDL-C ${ldl}: intensify lipid-lowering therapy (ESC ACS 2023, I)`),
        lowEf && !on(c, "bb") && S("bb", "LVEF ≤40% after ACS: beta-blocker (ESC ACS 2023, I A)"),
        !on(c, "raas") && (lowEf || dx(c, "hf", "dm", "htn", "ckd")) && S("acei", `ACE inhibitor: ${[lowEf && "LVEF ≤40%", dx(c, "hf") && "HF", dx(c, "dm") && "diabetes", dx(c, "htn") && "hypertension", dx(c, "ckd") && "CKD"].filter(Boolean).join(", ")} (ESC ACS 2023, I A)`),
        !on(c, "mra") && lowEf && dx(c, "hf", "dm") && S("mra", `LVEF ≤40% with ${dx(c, "hf") ? "HF" : "diabetes"}: MRA (ESC ACS 2023, I A)`),
      ];
    },
    prevent: (_a, c) => [
      !(c.planned ?? []).some((t) => /rehabilitation/i.test(t)) && S("rehab", "Comprehensive cardiac rehabilitation for all ACS patients (ESC ACS 2023, I A)"),
      dx(c, "smoker") && S("smoking", "Current smoker: stop smoking (ESC ACS 2023)"),
      S("flu", "Influenza vaccination for ACS patients (ESC ACS 2023)"),
      val(c, "hba1c") == null && S("hba1c", "No HbA1c recorded: assess glycaemic status in every ACS patient (ESC ACS 2023)"),
    ],
    followup: (a, c) => [
      !(c.planned ?? []).some((t) => /lipid/i.test(t)) && S("lipids", "Re-evaluate lipids 4–6 weeks after ACS (ESC ACS 2023)"),
      a.lvef === "le40" && S("echo", "LVEF ≤40%: re-evaluate 6–12 weeks after MI for a primary-prevention ICD (ESC VA 2022, I C)"),
      a.revasc === "staged" && S("staged", a.type === "stemi" ? "STEMI: complete revascularisation within 45 days (ESC ACS 2023, I A)" : "Complete the planned revascularisation"),
    ],
  },

  "peri-af-procedure": {
    oacNow: (_a, c) => {
      const m = c.meds.find((x) => x.tags.includes("oac"));
      if (!m) return [S("none", "No anticoagulant on the medication list")];
      const days = m.startedAt ? Math.round((Date.parse(c.today) - Date.parse(localDay(m.startedAt))) / 86400000) : null;
      return [days != null && days < 21 ? S("short", `${m.name} started ${days} day${days === 1 ? "" : "s"} ago`) : S("3w", `${m.name}${days != null ? ` for ${days} days` : ""}: confirm no missed doses (or INR >2 throughout)`)];
    },
    start: (_a, c) => [dx(c, "mechanical-valve", "ms-significant") ? S("other", "Mechanical valve or significant MS: warfarin, not a DOAC") : S("apixaban", "A DOAC in preference to warfarin (ESC AF 2024)")],
    prep: (a) => [
      a.onset === "lt24" ? S("early", "Known onset <24 h: early cardioversion without TOE is possible (ESC AF 2024)")
      : a.oacNow === "3w" ? S("wait", "≥3 weeks of effective anticoagulation: cardioversion can go ahead")
      : S("wait", "AF ≥24 h or unknown: ≥3 weeks of effective anticoagulation first, or TOE-guided (ESC AF 2024)"),
    ],
    post: (a) => [
      S("oac", a.proc === "ablation" ? "Anticoagulation for ≥2 months after ablation, then by CHA₂DS₂-VA — not by the rhythm" : "Anticoagulation for ≥4 weeks after cardioversion, then by CHA₂DS₂-VA — not by the rhythm"),
      S("ecg", "ECG to document the rhythm after the procedure"),
    ],
  },
  "af-care": {
    pattern: (_a, c) => {
      const p = c.af?.pattern;
      const map: Record<string, string> = { "First diagnosed": "first", Paroxysmal: "paroxysmal", Persistent: "persistent", Permanent: "permanent" };
      return [p && map[p] ? S(map[p], `Recorded on the problem list: ${p.toLowerCase()}`) : !(c.dx ?? []).includes("af") && c.af?.ecgRhythm ? S("first", `ECG shows ${c.af.ecgRhythm.toLowerCase()}; no AF on the problem list`) : null];
    },
    comorb: (_a, c) => {
      const sbp = val(c, "sbp"), wt = val(c, "weight"), ht = val(c, "height");
      const bmi = wt && ht ? wt / (ht / 100) ** 2 : null;
      return [
        sbp != null && sbp >= 130 && dx(c, "htn") && S("htn", `SBP ${sbp}: treat hypertension to target (ESC AF 2024 / HTN 2024)`),
        bmi != null && bmi >= 30 && S("weight", `BMI ${n1(bmi)}: weight loss reduces AF burden (ESC AF 2024)`),
        dx(c, "dm") && S("dm", "Diabetes: glycaemic control as part of AF-CARE"),
        dx(c, "hf") && !on(c, "sglt2") && S("hf", "AF with HF: SGLT2 inhibitor and foundational HF therapy"),
        dx(c, "smoker") && S("smoking", "Current smoker: stop smoking"),
      ];
    },
    oac: (_a, c) => {
      const sc = c.af?.score ?? null;
      const valve = dx(c, "mechanical-valve", "ms-significant");
      if (on(c, "oac")) return [on(c, "vka") && !valve ? S("vka-to-doac", "No mechanical valve or moderate–severe MS: a DOAC is preferred to warfarin (ESC AF 2024, I A)") : S("continue", "Already anticoagulated: continue, check the dose")];
      if (sc == null) return [];
      if (sc >= 2) return [S(valve ? "other-doac" : "apixaban", `CHA₂DS₂-VA ${sc}: oral anticoagulation recommended (ESC AF 2024, I); DOAC preferred`)];
      if (sc === 1) return [S(valve ? "other-doac" : "apixaban", "CHA₂DS₂-VA 1: oral anticoagulation should be considered (ESC AF 2024, IIa)")];
      return [S("not-indicated", "CHA₂DS₂-VA 0: no anticoagulation for stroke prevention")];
    },
    bleed: (_a, c) => {
      const sbp = val(c, "sbp");
      const out = [
        sbp != null && sbp > 160 && S("bp", `SBP ${sbp} (>160: uncontrolled, a bleeding risk factor)`),
        onCode(c, "aspirin") && !dx(c, "cad", "pad", "ascvd") && S("stop-asa", "No vascular indication: antiplatelet therapy is not used for stroke prevention in AF (ESC AF 2024, III)"),
        on(c, "nsaid") && S("nsaid", "NSAID with anticoagulation: avoid"),
      ];
      return out.some(Boolean) ? out : [S("none", "No modifiable bleeding risk factor in the record (scores are not used to withhold OAC)")];
    },
    rate: (a, c) => {
      const hr = c.af?.ecgRate ?? val(c, "hr");
      const lvef = val(c, "lvef");
      if (hr == null || hr < 110 || a.pattern === "paroxysmal") return [];
      return [
        !on(c, "bb") ? S("bb", `Rate ${hr}: beta-blocker for rate control (any LVEF) — lenient target <110 (ESC AF 2024)`)
        : lvef != null && lvef > 40 && !on(c, "ndhp-ccb") ? S("ccb", `Rate ${hr} on a beta-blocker, LVEF ${lvef}%: add or switch to diltiazem/verapamil`)
        : !on(c, "digoxin") ? S("digoxin", `Rate ${hr} on a beta-blocker${lvef != null && lvef <= 40 ? `, LVEF ${lvef}%` : ""}: add digoxin`) : null,
      ];
    },
    rhythm: (a, c) => {
      const lvef = val(c, "lvef");
      return [
        a.pattern === "paroxysmal" && S("ablation", "Paroxysmal AF: catheter ablation is a first-line rhythm-control option (ESC AF 2024, I A)"),
        a.pattern !== "permanent" && lvef != null && lvef <= 40 && S("ablation", `LVEF ${lvef}%: ablation when tachycardia-induced cardiomyopathy is suspected (ESC AF 2024)`),
        (a.pattern === "persistent" || a.pattern === "first") && S("cardioversion", "Symptomatic persistent or first AF: cardioversion as part of rhythm control (after ≥3 weeks OAC or TOE)"),
        a.pattern === "permanent" && S("none", "Permanent AF: no further rhythm control"),
      ];
    },
    tests: (_a, c) => [
      val(c, "lvef") == null && S("echo", "No LVEF recorded: echocardiography for every new AF (ESC AF 2024)"),
      (val(c, "tsh") == null || val(c, "creatinine") == null || val(c, "haemoglobin") == null) && S("bloods", "Renal function, blood count and thyroid function at diagnosis (ESC AF 2024)"),
    ],
  },

  // ---------------- Inflammatory & infective ----------------
  pericarditis: {
    criteria: (_a, c) => {
      const crp = val(c, "crp");
      return [crp != null && crp > 5 && S("crp", `CRP ${crp} mg/L`)];
    },
    highrisk: (_a, c) => {
      const t = val(c, "temp");
      return [t != null && t > 38 && S("fever", `Temperature ${n1(t)} °C`), on(c, "oac") && S("oac", "On oral anticoagulation")];
    },
    tests: (a) => [S("ecg", "ECG for every patient (ESC)"), S("bloods", "CRP, troponin, FBC, renal function"), S("echo", "Echo for every patient (ESC)"), list(a, "highrisk").length > 0 && S("cause", "High-risk features: look for a specific cause")],
    first: (_a, c) => [
      on(c, "oac", "antiplatelet") || dx(c, "cad", "prior-mi") ? S("aspirin", "Coronary disease / on antithrombotics: aspirin preferred to NSAIDs") : S("nsaid", "Aspirin or NSAID at anti-inflammatory dose (ESC 2025, I A)"),
      S("colchicine", "Add colchicine for at least 3–6 months, stopped last (ESC 2025, I A)"),
      S("ppi", "Gastroprotection while on aspirin/NSAID"),
    ],
    activity: (a) => [a.myocardium === "yes" ? S("myo", "Myocardial involvement: longer restriction until recovery is confirmed") : S("1m", "Restrict exercise for 1 month, then individualise (ESC 2025)")],
    crp: () => [S("7", "CRP in 1–2 weeks to guide tapering (ESC)")],
  },
  endocarditis: {
    tests: (a) => {
      const pv = is(a, "features", "prosthetic") || is(a, "features", "device");
      return [
        S("cultures", "Three sets of blood cultures before antibiotics (ESC 2023, I)"), S("tte", "TTE first line (ESC 2023, I B)"),
        (pv || is(a, "features", "bacteraemia")) && S("toe", "Prosthetic valve, device or S. aureus bacteraemia: TOE (ESC 2023, I B)"),
        S("repeat", "Repeat TTE/TOE in 5–7 days if suspicion stays high (ESC 2023, I)"),
        pv && S("ct", "Cardiac CTA for possible prosthetic valve IE (ESC 2023, I)"),
        pv && S("pet", "FDG-PET/CT for possible prosthetic valve IE (ESC 2023, I)"),
        is(a, "features", "embolic") && S("brain", "Embolic event: brain imaging"),
        S("ecg", "ECG: new AV block suggests an abscess"), S("bloods", "CRP, FBC, renal function"),
      ];
    },
    team: (a) => [(is(a, "features", "prosthetic") || is(a, "features", "device") || is(a, "features", "hf") || is(a, "features", "embolic") || a.duke === "definite") ? S("refer", "Complicated or prosthetic/device IE: Endocarditis Team (ESC 2023, I B)") : null],
    surgery: (a) => [is(a, "features", "hf") && S("hf", "Heart failure from valve dysfunction: urgent surgery (ESC 2023, I B)"), is(a, "features", "device") && S("device", "Device infection: complete extraction (ESC 2023, I)")],
    monitoring: (a, c) => [
      S("clearance", "Repeat cultures to document clearance"), S("drug-levels", "Vancomycin/gentamicin levels and renal function"), S("ecg", "Serial ECGs"),
      on(c, "oac", "antiplatelet") && S("antithrombotic", "Review antithrombotics with the team"), S("dental", "Dental assessment and prophylaxis education (ESC 2023)"), S("end-echo", "Echo at the end of treatment"),
      a.duke && !is(a, "features", "prosthetic") && S("oral", "Stable left-sided IE after ≥10 days IV: consider partial oral therapy (ESC 2023, IIa)"),
    ],
  },
  "amiodarone-thyroid": {
    situation: (_a, c) => {
      const tsh = val(c, "tsh");
      return [tsh == null ? S("baseline", "No TSH recorded: baseline thyroid function (ETA 2018)") : tsh > 4.0 ? S("hypo", `TSH ${tsh} above range`) : tsh < 0.4 ? S("thyrotox", `TSH ${tsh} below range`) : S("routine", `TSH ${tsh} in range: routine 6-monthly check (ETA 2018)`)];
    },
    hypo: () => [S("continue", "Amiodarone can continue (ETA 2018)"), S("lt4", "Levothyroxine (ETA 2018)"), S("tsh", "TSH in 6–8 weeks")],
    type: (a) => [a.type ? null : S("pending", "Endocrinology types it (Doppler, uptake, antibodies)")],
    cardiac: (_a, c) => [S("amio", "Decide amiodarone continuation with endocrinology (ETA 2018)"), S("rate", "Beta-blocker for rate control"), on(c, "vka") && S("inr", "Thyrotoxicosis raises warfarin effect: INR"), dx(c, "dm") && S("glucose", "Glucose monitoring on steroids")],
    endo: (a) => [a.situation === "hypo" || a.situation === "thyrotox" ? S("refer", "Thyroid dysfunction on amiodarone: endocrinology (ETA 2018)") : null],
  },
};

// Suggestions for one question, limited to the options this patient can be offered.
export function suggest(wizardId: string, questionId: string, answers: Answers, ctx: WizardContext, allowed?: Set<string>): Suggestion[] {
  const fn = GUIDANCE[wizardId]?.[questionId];
  if (!fn) return [];
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of fn(answers, ctx)) {
    if (!s || seen.has(s.value) || (allowed && !allowed.has(s.value))) continue;
    seen.add(s.value);
    out.push(s);
  }
  return out;
}
