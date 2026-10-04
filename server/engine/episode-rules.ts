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
import type { PatientState } from "../kernel/state.js";
import { cadEvents } from "./cad-profile.js";
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

const SHORT: Record<string, string> = { "chest-infection": "chest infection", pericarditis: "pericarditis", endocarditis: "endocarditis", "pre-procedure": "pre-procedure", "chest-pain-cad": "chest pain after ACS / PCI", bleeding: "bleeding" };
const offer = (wizard: string, t: Trigger, detail: string, severity: Finding["severity"] = "orange"): Finding => ({
  key: wizard,
  signature: t.ref,
  severity,
  title: `${t.label} → ${SHORT[wizard] ?? WIZARDS[wizard].title.toLowerCase()} pathway`,
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
];
