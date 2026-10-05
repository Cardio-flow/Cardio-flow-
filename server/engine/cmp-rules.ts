// Cardiomyopathy rules (cardiomyopathy module, slice 1). Recommendations from the 2023 ESC Guidelines
// for the management of cardiomyopathies (Arbelo et al., Eur Heart J 2023;44:3503), wording as
// transcribed in the guideline's recommendation tables:
//  - "Contrast-enhanced CMR is recommended in patients with cardiomyopathy at initial evaluation" (I B).
//  - "Genetic testing is recommended in patients fulfilling diagnostic criteria for cardiomyopathy in
//    cases where it enables diagnosis, prognostication, therapeutic stratification, or reproductive
//    management of the patient, or where it enables cascade genetic evaluation of their relatives" (I B);
//    genetic counselling for families with an inherited or suspected inherited cardiomyopathy (I B).
//  - "All clinically-stable patients with cardiomyopathy undergo routine follow-up using a
//    multi-parametric approach that includes ECG and echocardiography every 1–2 years" (I C).
//  - HCM: TTE at rest and during Valsalva (sitting and semi-supine, then standing if no gradient) at the
//    initial evaluation to detect LVOTO (I B); symptomatic HCM with a resting or provoked peak LVOT
//    gradient <50 mmHg: exercise echocardiography (I B).
//  - ICD after cardiac arrest due to VT/VF or sustained VT with haemodynamic compromise / instability:
//    HCM (I B), DCM (I B), NDLVC (I C), ARVC (I A).
import { DIAGNOSIS } from "../../shared/catalog.js";
import { addDays, daysBetween, fmtDay, localDay } from "../../shared/clinical.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
import { cmpConditions, ventricularEvents } from "./cmp-profile.js";
import { deviceStatus } from "./rhythm-profile.js";
import { hcmRiskScd, RISK_BAND_TEXT } from "../../shared/cmp.js";
import { historyCode } from "../../shared/history.js";

const SRC = "ESC cardiomyopathies 2023";
const planned = (s: PatientState, re: RegExp) => s.plan.some((p) => p.status === "planned" && re.test(p.title));
const names = (cs: { code: string }[]) => cs.map((c) => DIAGNOSIS[c.code]?.display ?? c.code).join(", ");
const ICD_CLASS: Record<string, string> = { hcm: "I B", dcm: "I B", ndlvc: "I C", arvc: "I A" };

export const CMP_RULES: RuleDef[] = [
  {
    id: "cmp.cmr-baseline",
    kind: "clinical",
    title: "Cardiomyopathy without a cardiac MRI",
    inputs: ["conditions", "studies", "plan"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: contrast-enhanced CMR is recommended in patients with cardiomyopathy at initial evaluation (I B).",
    evaluate(s) {
      const cs = cmpConditions(s);
      if (!cs.length || s.studies.some((x) => x.kind === "cmr") || planned(s, /cardiac MRI|\bCMR\b/i)) return [];
      return [{
        key: "cmr", signature: cs.map((c) => c.code).join(","), severity: "yellow",
        title: `${names(cs)}: no cardiac MRI on record`,
        detail: "Contrast-enhanced CMR at the initial evaluation (I B): phenotype, LGE, and the inputs of risk assessment.",
        facts: [{ label: "Diagnosis", value: names(cs) }, { label: "Guideline", value: `${SRC} · I B` }],
        missing: [], action: { type: "add-plan", template: "cmr" },
      }];
    },
  },
  {
    id: "cmp.genetic-testing",
    kind: "clinical",
    title: "Cardiomyopathy without genetic testing",
    inputs: ["conditions", "plan"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: genetic testing in patients fulfilling diagnostic criteria for cardiomyopathy when it enables diagnosis, prognostication, therapeutic stratification, reproductive management or cascade evaluation of relatives (I B); genetic counselling for families with an inherited or suspected inherited cardiomyopathy (I B). AL amyloidosis is not inherited and is left out.",
    evaluate(s) {
      const cs = cmpConditions(s).filter((c) => !(c.code === "amyloid" && c.attributes?.type === "AL") && (!c.attributes?.genetic || c.attributes.genetic === "Not done"));
      if (!cs.length || planned(s, /genetic/i)) return [];
      return [{
        key: "genetic", signature: cs.map((c) => c.code).join(","), severity: "yellow",
        title: `${names(cs)}: genetic testing not recorded`,
        detail: "Genetic testing with counselling (I B): diagnosis, prognosis and therapy, and cascade testing of relatives if a pathogenic variant is found.",
        facts: [{ label: "Diagnosis", value: names(cs) }, { label: "Genetic test", value: cs.map((c) => c.attributes?.genetic ?? "Not recorded").join(", ") }, { label: "Guideline", value: `${SRC} · I B` }],
        missing: [], action: { type: "add-plan", template: "genetic-test" },
      }];
    },
  },
  {
    id: "cmp.follow-up",
    kind: "clinical",
    title: "Cardiomyopathy: ECG and echo every 1–2 years",
    inputs: ["conditions", "studies", "plan"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: clinically stable patients with cardiomyopathy have routine follow-up with ECG and echocardiography every 1–2 years (I C). The finding opens when either is older than 2 years (the outer limit).",
    evaluate(s) {
      const cs = cmpConditions(s);
      if (!cs.length || planned(s, /echo/i)) return [];
      const ecg = latestStudy(s, "ecg"), echo = latestStudy(s, "echo");
      const old = (x: typeof ecg) => !x || daysBetween(localDay(x.performed_at), s.today) > 730;
      const due = [old(ecg) && "ECG", old(echo) && "echo"].filter(Boolean) as string[];
      if (!due.length) return [];
      const last = (x: typeof ecg, n: string) => ({ label: `Last ${n}`, value: x ? fmtDay(x.performed_at, { year: true }) : "None recorded" });
      return [{
        key: "follow-up", signature: `${ecg?.id ?? "-"}:${echo?.id ?? "-"}`, severity: "yellow",
        title: `${names(cs)}: ${due.join(" and ")} due (every 1–2 years)`,
        detail: "Routine follow-up with ECG and echocardiography every 1–2 years in clinically stable patients (I C).",
        facts: [last(ecg, "ECG"), last(echo, "echo"), { label: "Guideline", value: `${SRC} · I C` }],
        missing: [], action: { type: "add-plan", template: "cmp-echo" },
      }];
    },
  },
  {
    id: "cmp.hcm-lvot",
    kind: "clinical",
    title: "HCM: LVOT gradient at rest and provoked; exercise echo when symptomatic below 50 mmHg",
    inputs: ["conditions", "lvot-rest", "lvot-provoked", "nyha", "studies", "plan"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: in all patients with HCM, at initial evaluation, TTE at rest and during Valsalva (sitting and semi-supine, then standing if no gradient) to detect LVOTO (I B); symptomatic HCM with a resting or provoked peak LVOT gradient <50 mmHg: exercise echocardiography (I B). 50 mmHg is the guideline's own threshold.",
    evaluate(s) {
      if (!s.conditions.some((c) => c.code === "hcm" && c.status === "active")) return [];
      const rest = s.resolved("lvot-rest").current?.value_num ?? null, prov = s.resolved("lvot-provoked").current?.value_num ?? null;
      const out: Finding[] = [];
      if ((rest == null || prov == null) && !planned(s, /LVOT|echo/i))
        out.push({
          key: "lvot-missing", signature: `${rest ?? "-"}:${prov ?? "-"}`, severity: "yellow",
          title: `HCM: LVOT gradient ${rest == null && prov == null ? "at rest and provoked" : rest == null ? "at rest" : "provoked (Valsalva / standing)"} not recorded`,
          detail: "Echo at rest and during Valsalva, sitting and semi-supine, then standing if no gradient is provoked (I B).",
          facts: [{ label: "LVOT rest", value: rest == null ? "Not recorded" : `${rest} mmHg` }, { label: "LVOT provoked", value: prov == null ? "Not recorded" : `${prov} mmHg` }, { label: "Guideline", value: `${SRC} · I B` }],
          missing: [], action: { type: "add-plan", template: "hcm-lvot" },
        });
      const nyha = s.resolved("nyha").current?.value_text ?? null;
      const symptomatic = !!nyha && nyha !== "I";
      const max = Math.max(rest ?? -1, prov ?? -1);
      const exEcho = s.studies.some((x) => x.kind === "stress" && /echo/i.test(String(x.attributes?.modality ?? "")));
      if (symptomatic && rest != null && prov != null && max < 50 && !exEcho && !planned(s, /exercise echo|stress echo/i))
        out.push({
          key: "lvot-exercise", signature: `${max}:${nyha}`, severity: "yellow",
          title: `Symptomatic HCM (NYHA ${nyha}) with LVOT gradient ${max} mmHg: exercise echo`,
          detail: "Resting and provoked gradient below 50 mmHg in a symptomatic patient: exercise echocardiography standing, sitting or semi-supine (I B).",
          facts: [{ label: "LVOT rest", value: `${rest} mmHg` }, { label: "LVOT provoked", value: `${prov} mmHg` }, { label: "NYHA", value: nyha! }, { label: "Guideline", value: `${SRC} · I B` }],
          missing: [], action: { type: "add-plan", template: "exercise-echo" },
        });
      return out;
    },
  },
  {
    id: "cmp.icd-secondary",
    kind: "clinical",
    title: "Cardiomyopathy with cardiac arrest or sustained VT/VF and no ICD",
    inputs: ["conditions", "contexts", "studies", "plan"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: ICD in patients who survived a cardiac arrest due to VT/VF or have spontaneous sustained VT with haemodynamic compromise (HCM I B) / recovered from a ventricular arrhythmia causing haemodynamic instability (DCM I B, NDLVC I C, ARVC I A). The event comes from an admission or visit reason, a discharge event or a device check; the clinician confirms its haemodynamic effect.",
    evaluate(s) {
      const cs = cmpConditions(s).filter((c) => ICD_CLASS[c.code]);
      if (!cs.length) return [];
      const dev = deviceStatus(s);
      if (dev?.type === "ICD" || dev?.type === "CRT-D" || planned(s, /\bICD\b|defibrillator/i)) return [];
      const ev = ventricularEvents(s)[0];
      if (!ev) return [];
      const cls = cs.map((c) => `${DIAGNOSIS[c.code].display} ${ICD_CLASS[c.code]}`).join("; ");
      return [{
        key: "icd-secondary", signature: ev.ref, severity: "orange",
        title: `${names(cs)} with ${/arrest/i.test(ev.label) ? "cardiac arrest" : "sustained VT / VF"}: ICD for secondary prevention`,
        detail: `ICD after cardiac arrest due to VT/VF or haemodynamically compromising sustained VT (${cls}). Confirm the event and its haemodynamic effect.`,
        facts: [{ label: "Event", value: ev.label }, { label: "Device", value: dev?.type ?? "None" }, { label: "Guideline", value: SRC }],
        missing: [], action: { type: "add-plan", template: "icd-referral" },
      }];
    },
  },
  // ---- slice 2: HCM sudden death risk, LVOT obstruction, AF ----
  {
    id: "cmp.hcm-scd-risk",
    kind: "clinical",
    title: "HCM: 5-year sudden death risk (HCM Risk-SCD)",
    inputs: ["conditions", "mwt", "la-diam", "lvot-rest", "lvot-provoked", "studies", "pathways", "plan"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: HCM Risk-SCD to estimate the 5-year risk of sudden death from 16 years (I B), assessed at first evaluation and re-evaluated at 1–2-year intervals or when the clinical status changes (I B); ICD should be considered at ≥6% (IIa B), may be considered at ≥4% to <6% (IIb B). Due when no HCM SCD pathway was completed in the last 2 years (the outer limit). The number shown uses the record (family history from the history item, NSVT from the latest ambulatory ECG, syncope not recorded → treated as unknown) and is confirmed in the pathway.",
    evaluate(s) {
      if (!s.conditions.some((c) => c.code === "hcm" && c.status === "active") || s.patient.age < 16) return [];
      const dev = deviceStatus(s);
      if (dev?.type === "ICD" || dev?.type === "CRT-D") return [];
      const done = s.pathwaysDone["hcm-scd"];
      if ((done && daysBetween(localDay(done), s.today) <= 730) || planned(s, /sudden death risk|ICD/i)) return [];
      const lvr = s.resolved("lvot-rest").current?.value_num ?? null, lvp = s.resolved("lvot-provoked").current?.value_num ?? null;
      const fhx = s.resolved(historyCode("fhx-scd")).current?.value_text ?? null;
      const holter = latestStudy(s, "holter");
      const x = hcmRiskScd({
        age: s.patient.age, mwt: s.resolved("mwt").current?.value_num ?? null, la: s.resolved("la-diam").current?.value_num ?? null,
        lvot: lvr == null && lvp == null ? null : Math.max(lvr ?? 0, lvp ?? 0),
        fhx: fhx === "no" ? false : fhx === "yes" ? true : null, nsvt: holter?.attributes?.nsvt === "Yes" ? true : holter?.attributes?.nsvt === "No" ? false : null, syncope: false,
      });
      const high = x.band === "high" || x.band === "intermediate";
      return [{
        key: "hcm-scd", signature: `${done ?? "never"}:${x.risk ?? "-"}`, severity: high ? "orange" : "yellow",
        title: x.risk != null ? `HCM: estimated 5-year sudden death risk ${x.risk}% (no syncope assumed): confirm and decide on an ICD` : `HCM: 5-year sudden death risk ${done ? "not reassessed in 2 years" : "not assessed"}`,
        detail: x.risk != null ? `HCM Risk-SCD ${RISK_BAND_TEXT[x.band!]}. Family history and syncope are confirmed in the pathway.` : "HCM Risk-SCD at the first evaluation and every 1–2 years (I B).",
        facts: [{ label: "Last assessment", value: done ? fmtDay(done, { year: true }) : "None" }, { label: "Guideline", value: `${SRC} · I B` }],
        missing: x.missing.filter((m) => m !== "unexplained syncope"), action: { type: "wizard", wizard: "hcm-scd" },
      }];
    },
  },
  {
    id: "cmp.hcm-lvoto",
    kind: "clinical",
    title: "Symptomatic obstructive HCM (gradient ≥50 mmHg)",
    inputs: ["conditions", "lvot-rest", "lvot-provoked", "nyha", "pathways", "studies"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: LVOTO therapy — non-vasodilating beta-blocker titrated to the maximum tolerated dose first line (I B); verapamil or diltiazem if a beta-blocker cannot be taken (I B); disopyramide added (I B); mavacamten (IIa A); septal reduction for a resting or maximal provoked gradient ≥50 mmHg with NYHA III–IV despite maximum tolerated therapy (I B). 50 mmHg is the guideline's threshold. Offered once per echo while symptoms (NYHA ≥II) are recorded.",
    evaluate(s) {
      if (!s.conditions.some((c) => c.code === "hcm" && c.status === "active")) return [];
      const r = s.resolved("lvot-rest").current, p = s.resolved("lvot-provoked").current;
      const max = Math.max(r?.value_num ?? 0, p?.value_num ?? 0);
      const nyha = s.resolved("nyha").current?.value_text ?? null;
      if (max < 50 || !nyha || nyha === "I") return [];
      const at = [r?.effective_at, p?.effective_at].filter(Boolean).sort().pop()!;
      const done = s.pathwaysDone["hcm-lvoto"];
      if (done && done >= at) return [];
      return [{
        key: "hcm-lvoto", signature: `${at}:${nyha}`, severity: "orange",
        title: `Obstructive HCM: LVOT gradient ${max} mmHg with NYHA ${nyha}`,
        detail: nyha === "III" || nyha === "IV" ? "Maximum tolerated medical therapy, then septal reduction therapy if NYHA III–IV persists (I B)." : "Beta-blocker to the maximum tolerated dose first (I B); disopyramide or mavacamten if symptoms persist.",
        facts: [{ label: "LVOT rest", value: r?.value_num != null ? `${r.value_num} mmHg` : "Not recorded" }, { label: "LVOT provoked", value: p?.value_num != null ? `${p.value_num} mmHg` : "Not recorded" }, { label: "NYHA", value: nyha }, { label: "Guideline", value: SRC }],
        missing: [], action: { type: "wizard", wizard: "hcm-lvoto" },
      }];
    },
  },
  {
    id: "cmp.hcm-af-oac",
    kind: "clinical",
    title: "AF with HCM without anticoagulation",
    inputs: ["conditions", "meds"],
    defaultParams: {},
    evidence: "2023 ESC cardiomyopathies: oral anticoagulation to reduce the risk of stroke and thrombo-embolic events is recommended in all patients with HCM and AF (class I), whatever the CHA₂DS₂-VA score.",
    evaluate(s) {
      if (!s.conditions.some((c) => c.code === "hcm" && c.status === "active") || !s.tags.has("af")) return [];
      if (s.meds.some((m) => (m.status === "active" || m.status === "held") && m.tags.includes("oac"))) return [];
      return [{
        key: "hcm-af", signature: "af", severity: "orange",
        title: "AF with hypertrophic cardiomyopathy: no anticoagulant",
        detail: "Oral anticoagulation is recommended in all patients with HCM and AF, whatever the CHA₂DS₂-VA score (I).",
        facts: [{ label: "Diagnoses", value: "HCM · atrial fibrillation / flutter" }, { label: "Guideline", value: `${SRC} · I` }],
        missing: [], action: { type: "wizard", wizard: "af-care" },
      }];
    },
  },
];
