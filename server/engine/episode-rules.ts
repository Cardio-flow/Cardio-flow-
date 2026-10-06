// Event-triggered pathways (Ahmed, 2 Oct 2026): a complication recorded anywhere in the record —
// an admission or visit reason, a medicine started for it, a thyroid result on amiodarone, a
// pre-operative visit — offers its pathway under Needs attention. The pathway never opens by
// itself; it is offered once per event and stays quiet while an episode of it is open or after an
// episode was opened for that event. No clinical threshold is chosen here: the triggers are the
// clinician's own entries, and the TSH check uses the laboratory reference range (ETA 2018:
// thyroid function before amiodarone and during treatment).
import { MEASURES } from "../../shared/catalog.js";
import { flagFor, fmtDay } from "../../shared/clinical.js";
import { WIZARDS } from "../../shared/wizards.js";
import { checkHasShock } from "../../shared/studies.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import { cadEvents } from "./cad-profile.js";
import { localDay } from "../../shared/clinical.js";

// echo findings and grades that point at a prosthesis problem (valve module, slice 5): the
// echocardiographer's own words and grades, on a position treated before that echo
export const PROSTHESIS_FINDINGS = ["Prosthetic valve thrombus", "Prosthetic valve dysfunction", "Paravalvular leak"];
const POSITION_GRADES: Record<string, [string, string][]> = { Aortic: [["as", "stenosis"], ["ar", "regurgitation"]], Mitral: [["ms", "stenosis"], ["mr", "regurgitation"]], Tricuspid: [["tr", "regurgitation"]] };
export function prosthesisEchoProblem(s: PatientState) {
  const e = latestStudy(s, "echo");
  if (!e) return null;
  const items = e.findings.filter((f) => PROSTHESIS_FINDINGS.includes(f));
  for (const c of s.conditions.filter((x) => x.code === "prosthetic-valve")) {
    const pos = String(c.attributes?.position ?? "");
    const proc = s.procedures.filter((p) => p.kind === "valve" && p.attributes.position === pos).map((p) => p.performed_at).sort().pop();
    const since = proc ?? c.onset;
    if (!since || localDay(e.performed_at) <= localDay(since)) continue;
    for (const [k, word] of POSITION_GRADES[pos] ?? []) {
      const g = (e.attributes?.valves as Record<string, string> | undefined)?.[k];
      if (g === "Moderate" || g === "Severe") items.push(`${g.toLowerCase()} ${pos.toLowerCase()} prosthesis ${word}`);
    }
  }
  return items.length ? { e, items, thrombus: items.includes("Prosthetic valve thrombus") } : null;
}
import type { Finding, RuleDef } from "./rules.js";

type Trigger = { at: string; label: string; ref: string };

// handled: an episode of this pathway is open, or one was opened after the event
const handled = (s: PatientState, wizard: string, at: string) =>
  s.episodes.some((e) => e.wizard === wizard && (e.status === "open" || e.started_at >= at.slice(0, 10)));

// the event: an open admission/visit, or the latest one, with a matching reason; or a current
// medicine started for the matching indication
function trigger(s: PatientState, wizard: string, reason: RegExp, indication: RegExp | null): Trigger | null {
  const latest = s.contexts[s.contexts.length - 1];
  const ctxs = s.contexts.filter((c) => c.status === "open" || c === latest);
  const found: Trigger[] = [];
  for (const c of ctxs) {
    const r = c.reasons.find((x) => reason.test(x));
    if (r) found.push({ at: c.started_at, label: `${c.kind === "admission" ? "Admission" : "Visit"} for ${r.toLowerCase()} · ${fmtDay(c.started_at)}`, ref: c.id });
  }
  if (indication)
    for (const m of s.meds.filter((x) => (x.status === "active" || x.status === "held") && indication.test(x.indication ?? "")))
      found.push({ at: m.startedAt ?? m.events[0]?.effective_at ?? s.today, label: `${m.name} started for ${m.indication.replace(/\s*\(.*\)$/, "").toLowerCase()}${m.startedAt ? ` · ${fmtDay(m.startedAt)}` : ""}`, ref: m.id });
  const open = found.filter((t) => !handled(s, wizard, t.at)).sort((a, b) => b.at.localeCompare(a.at));
  return open[0] ?? null;
}

const offer = (wizard: string, t: Trigger, detail: string, severity: Finding["severity"] = "orange"): Finding => ({
  key: wizard,
  signature: t.ref,
  severity,
  // the button names the pathway (Overview), so the title is the event alone
  title: t.label,
  detail,
  facts: [{ label: "Recorded", value: t.label }, { label: "Pathway", value: `${WIZARDS[wizard].title} · ${WIZARDS[wizard].source ?? ""}`.replace(/ · $/, "") }],
  missing: [],
  action: { type: "wizard", wizard },
});

export const EPISODE_RULES: RuleDef[] = [
  {
    id: "event.chest-infection",
    kind: "clinical",
    title: "Chest infection recorded → chest infection pathway",
    inputs: ["contexts", "meds", "episodes"],
    defaultParams: {},
    evidence: "NICE NG138/NG139, BTS and ATS/IDSA 2019: assess severity (CURB-65), site of care, tests and antibiotic choice; in cardiac patients look for MI, AF and HF decompensation and check drug interactions.",
    evaluate(s) {
      const t = trigger(s, "chest-infection", /chest infection|pneumonia/i, /^chest infection/i);
      return t ? [offer("chest-infection", t, "Severity and site of care, tests, guideline antibiotic choice, cardiac drug interactions and sick-day holds, then follow-up.")] : [];
    },
  },
  {
    id: "event.myocarditis",
    kind: "clinical",
    title: "Myocarditis recorded → myocarditis pathway",
    inputs: ["contexts", "meds", "episodes"],
    defaultParams: {},
    evidence: "2025 ESC myocarditis and pericarditis guidelines: hospital admission, CMR for diagnosis (I B), biopsy in heart failure or shock, beta-blocker for at least 6 months (IIa C), exercise restriction, CMR within 6 months (I B).",
    evaluate(s) {
      const t = trigger(s, "myocarditis", /myocarditis/i, /myocarditis/i);
      return t ? [offer("myocarditis", t, "Admission and monitoring, CMR, biopsy if heart failure or shock, beta-blocker, exercise restriction and follow-up CMR.")] : [];
    },
  },
  {
    id: "event.pericarditis",
    kind: "clinical",
    title: "Pericarditis recorded → pericarditis pathway",
    inputs: ["contexts", "meds", "episodes"],
    defaultParams: {},
    evidence: "2025 ESC myocarditis and pericarditis guidelines: confirm the diagnosis, triage high-risk features, aspirin/NSAID + colchicine (I A), exercise restriction and CRP-guided follow-up.",
    evaluate(s) {
      const t = trigger(s, "pericarditis", /pericarditis/i, /^pericarditis/i);
      return t ? [offer("pericarditis", t, "Diagnosis, high-risk features, myocardial involvement, first-line therapy and its duration, activity and CRP follow-up.")] : [];
    },
  },
  {
    id: "event.endocarditis",
    kind: "clinical",
    title: "Endocarditis recorded → endocarditis pathway",
    inputs: ["contexts", "meds", "episodes"],
    defaultParams: {},
    evidence: "2023 ESC endocarditis guidelines: blood cultures, TTE/TOE and further imaging, Endocarditis Team, surgical indications and timing.",
    evaluate(s) {
      const t = trigger(s, "endocarditis", /endocarditis/i, /endocarditis/i);
      return t ? [offer("endocarditis", t, "Blood cultures, imaging, Duke-ISCVID, Endocarditis Team and surgical indications, antibiotic monitoring.")] : [];
    },
  },
  {
    id: "event.pre-procedure",
    kind: "clinical",
    title: "Pre-operative visit → pre-procedure pathway",
    inputs: ["contexts", "episodes"],
    defaultParams: {},
    evidence: "2022 ESC non-cardiac surgery guidelines: stepwise assessment of surgical and patient risk, functional capacity, tests and peri-operative medicines.",
    evaluate(s) {
      const t = trigger(s, "pre-procedure", /pre-?operative|pre-?procedure/i, null);
      return t ? [offer("pre-procedure", t, "Surgical and patient risk, functional capacity, tests, medicines around the procedure, then the cardiology conclusion.")] : [];
    },
  },
  {
    id: "event.chest-pain-cad",
    kind: "clinical",
    title: "Chest pain in coronary disease → recurrent chest pain pathway",
    inputs: ["contexts", "episodes", "procedures", "conditions"],
    defaultParams: {},
    evidence: "2023 ESC ACS: ECG within 10 minutes, hs-troponin 0 h/1 h, risk-based timing of the invasive strategy; after PCI think of stent thrombosis and of interrupted antiplatelet therapy. 2024 ESC CCS for a stable angina pattern.",
    evaluate(s) {
      const t = trigger(s, "chest-pain-cad", /chest pain|angina/i, null);
      if (!t || !cadEvents(s).some((e) => e.kind !== "cath" && e.at < t.at)) return [];
      return [offer("chest-pain-cad", t, "ECG, troponin and very high-risk features decide the invasive timing; stent-thrombosis timing and antiplatelet interruptions; stable angina plan.")];
    },
  },
  {
    id: "event.bleeding",
    kind: "clinical",
    title: "Bleeding recorded on antithrombotic therapy → bleeding pathway",
    inputs: ["contexts", "episodes", "meds"],
    defaultParams: {},
    evidence: "EHRA NOAC guide 2021 and the ESC 2017 DAPT bleeding algorithm (ESC ACS 2023): severity-based management, which antithrombotic to keep, PPI, and an early restart plan.",
    evaluate(s) {
      const on = s.meds.filter((m) => (m.status === "active" || m.status === "held") && (m.tags.includes("antiplatelet") || m.tags.includes("oac")));
      if (!on.length) return [];
      const t = trigger(s, "bleeding", /bleed|haemorrhage|hemorrhage/i, null);
      return t ? [offer("bleeding", t, `On ${on.map((m) => m.name.toLowerCase()).join(" + ")}: severity, what to hold or keep, source control, PPI and the restart plan.`)] : [];
    },
  },
  {
    id: "event.amiodarone-thyroid",
    kind: "clinical",
    title: "Thyroid function on amiodarone",
    inputs: ["meds", "tsh", "episodes"],
    defaultParams: {},
    evidence: "2018 European Thyroid Association guidelines on amiodarone-associated thyroid dysfunction: thyroid function before amiodarone and during treatment; hypothyroidism and thyrotoxicosis are managed with endocrinology.",
    evaluate(s) {
      const amio = s.meds.find((m) => (m.status === "active" || m.status === "held") && m.code === "amiodarone");
      if (!amio) return [];
      const tsh = s.resolved("tsh").current;
      if (!tsh) {
        if (handled(s, "amiodarone-thyroid", amio.startedAt ?? s.today)) return [];
        return [{
          key: "amiodarone-thyroid", signature: `none:${amio.id}`, severity: "yellow",
          title: "On amiodarone with no TSH recorded",
          detail: "Thyroid function is checked before amiodarone and during treatment (ETA 2018).",
          facts: [{ label: "Amiodarone", value: amio.startedAt ? `since ${fmtDay(amio.startedAt, { year: true })}` : "current" }, { label: "TSH", value: "Not recorded" }],
          missing: ["TSH"], action: { type: "wizard", wizard: "amiodarone-thyroid" },
        }];
      }
      const flag = flagFor(tsh.value_num!, MEASURES.tsh.ref);
      if (!flag || handled(s, "amiodarone-thyroid", tsh.effective_at)) return [];
      return [{
        key: "amiodarone-thyroid", signature: tsh.id, severity: "orange",
        title: `TSH ${tsh.value_num} mIU/L on amiodarone: ${flag === "high" ? "hypothyroidism?" : "thyrotoxicosis?"}`,
        detail: flag === "high" ? "Amiodarone can usually continue with levothyroxine; confirm with FT4." : "Thyrotoxicosis can bring back arrhythmia or worsen HF: FT4/FT3 and endocrinology to type it.",
        facts: [{ label: "TSH", value: `${tsh.value_num} mIU/L`, date: tsh.effective_at, tone: "orange" }, { label: "Reference", value: `${MEASURES.tsh.ref!.low}–${MEASURES.tsh.ref!.high} mIU/L` }, { label: "Guideline", value: "ETA 2018" }],
        missing: [], action: { type: "wizard", wizard: "amiodarone-thyroid" },
      }];
    },
  },
  {
    id: "event.icd-shock",
    kind: "clinical",
    title: "ICD shock or ventricular arrhythmia → ICD shock / VA pathway",
    inputs: ["contexts", "episodes", "studies"],
    defaultParams: {},
    evidence: "2022 ESC VA guidelines: electrical storm = ≥3 sustained VA within 24 h, each needing termination — amiodarone, non-selective beta-blocker and mild–moderate sedation (I), catheter ablation for recurrent storm; ablation preferred over escalating antiarrhythmics for recurrent monomorphic VT in IHD despite amiodarone (I). 2023 HRS/EHRA/APHRS/LAHRS consensus: every ICD shock alerts the clinic (I).",
    evaluate(s) {
      const ck = latestStudy(s, "device_check");
      const a = (ck?.attributes ?? {}) as Record<string, any>;
      const found: Trigger[] = [];
      if (ck && (checkHasShock(a) || a.va === "Sustained VT" || a.va === "VF") && !handled(s, "icd-shock", ck.performed_at))
        found.push({ at: ck.performed_at, label: `Device check ${fmtDay(ck.performed_at)}: ${a.storm === "Yes" ? "electrical storm" : checkHasShock(a) ? (Number(a.shocks) > 1 ? `${a.shocks} shocks` : "ICD shock") : String(a.va).toLowerCase()}`, ref: ck.id });
      const c = trigger(s, "icd-shock", /ICD shock|VT \/ VF|ventricular (tachycardia|arrhythmia)/i, null);
      if (c) found.push(c);
      const t = found.sort((x, y) => y.at.localeCompare(x.at))[0];
      if (!t) return [];
      const storm = t.ref === ck?.id && a.storm === "Yes";
      return [offer("icd-shock", t, storm
        ? "Electrical storm: monitored bed, amiodarone, non-selective beta-blocker and sedation (ESC VA 2022, I); ablation for recurrent storm. Find the trigger."
        : "Appropriate or inappropriate? Find and correct the trigger, then prevent recurrence: reprogramming, drugs, ablation.", storm ? "red" : "orange")];
    },
  },
  {
    id: "event.prosthetic-valve",
    kind: "clinical",
    title: "Prosthetic valve problem → prosthetic valve pathway",
    inputs: ["contexts", "episodes", "studies", "conditions", "procedures"],
    defaultParams: {},
    evidence: "2025 ESC/EACTS VHD: TOE and/or 4D-CT to confirm suspected valve thrombosis (I C); Heart Team for acute HF from obstructive mechanical valve thrombosis — repeat replacement or low-dose slow-infusion fibrinolysis (I B); VKA for bioprosthetic valve thrombosis before reintervention (I B); reoperation / reintervention for symptomatic dysfunction not due to thrombosis (I C); valve-in-valve at intermediate or high risk (IIa B); Heart Team for paravalvular leak closure (I C). Triggered by the echocardiographer's finding or grade on a treated position, or an admission or visit for a prosthetic valve problem.",
    evaluate(s) {
      if (!s.conditions.some((c) => c.code === "prosthetic-valve")) return [];
      const found: Trigger[] = [];
      const pe = prosthesisEchoProblem(s);
      if (pe && !handled(s, "prosthetic-valve", pe.e.performed_at))
        found.push({ at: pe.e.performed_at, label: `Echo ${fmtDay(pe.e.performed_at)}: ${pe.items.map((x, i) => (i ? x.toLowerCase() : x[0].toUpperCase() + x.slice(1))).join(", ")}`, ref: pe.e.id });
      const c = trigger(s, "prosthetic-valve", /prosthetic valve/i, null);
      if (c) found.push(c);
      const t = found.sort((x, y) => y.at.localeCompare(x.at))[0];
      if (!t) return [];
      const thrombus = t.ref === pe?.e.id && pe.thrombus;
      return [offer("prosthetic-valve", t, thrombus
        ? "Prosthetic valve thrombus: confirm with TOE and/or 4D-CT (I C); Heart Team for obstruction with acute HF (I B); VKA for bioprosthetic thrombosis (I B)."
        : "Find the cause (thrombosis, structural dysfunction, paravalvular leak, endocarditis), then the Heart Team decides on reintervention.", thrombus ? "red" : "orange")];
    },
  },
];
