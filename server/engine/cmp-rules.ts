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
];
