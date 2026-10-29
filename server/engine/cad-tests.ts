// The latest non-invasive coronary test and the decision it calls for (7 Oct 2026). Risk classes are the
// guideline's own (ESC CCS 2024, Rec. Table 14; shared/ccs-tests.ts).
import { localDay } from "../../shared/clinical.js";
import { ccsTestRisk, CCS_TEST_KINDS, ruleOutCapable } from "../../shared/ccs-tests.js";
import { STUDY_LABEL, cathExtent, coronaryAnatomyComplete, obstructiveCad, studySummary } from "../../shared/studies.js";
import type { PatientState } from "../kernel/state.js";
import type { RuleDef } from "./rules.js";

export function latestCcsTest(s: PatientState) {
  const st = [...s.studies].reverse().find((x) => (CCS_TEST_KINDS as readonly string[]).includes(x.kind) && ccsTestRisk(x.kind, x.attributes ?? {}));
  if (!st) return null;
  const r = ccsTestRisk(st.kind, st.attributes ?? {})!;
  return { id: st.id, kind: st.kind, label: STUDY_LABEL[st.kind] ?? st.kind, at: localDay(st.performed_at), summary: studySummary(st.kind, st.attributes ?? {}), risk: r.risk, why: r.why, ccta: st.kind === "ccta" };
}

export const CAD_TEST_RULES: RuleDef[] = [
  {
    id: "cad.suspected-workup",
    kind: "clinical",
    title: "Suspected IHD: first test",
    inputs: ["conditions", "studies", "procedures", "pathways", "plan"],
    defaultParams: {},
    evidence:
      "2024 ESC CCS: estimate the clinical likelihood of obstructive CAD and choose the first test — CCTA for low/moderate likelihood (I A), functional imaging for moderate/high (I B), ICA when symptoms occur at a low level of exercise (I C), deferral when very low (IIa B). A negative test with the working diagnosis still listed asks whether IHD is ruled out.",
    evaluate(s) {
      const c = s.conditions.find((x) => x.code === "cad-suspected");
      if (!c) return [];
      if (s.conditions.some((x) => ["cad-ccs", "prior-mi", "prior-pci", "prior-cabg", "acs-stemi", "acs-nstemi"].includes(x.code))) return [];
      // coronary artery ectasia is a coronary finding, not a question to rule out (28 Oct 2026, Ahmed: a patient with
      // ectatic vessels was labelled "rule out IHD"): ask to replace the working diagnosis, never "choose the first test"
      const ectasia = s.conditions.find((x) => x.code === "coronary-ectasia" && x.status === "active");
      if (ectasia)
        return [{ key: "ectasia", signature: `${c.id}:${ectasia.id}`, severity: "yellow", title: "Coronary artery ectasia recorded: resolve \"Suspected IHD (to rule out)\"", detail: "The angiographic finding is coronary artery ectasia; resolve the working diagnosis from the header, or change it to chronic coronary syndrome if there is also obstructive disease or ischaemia.", facts: [{ label: "Coronary finding", value: `Coronary artery ectasia${(ectasia.attributes as any)?.vessels?.length ? ` · ${(ectasia.attributes as any).vessels.join(", ")}` : ""}` }], missing: [], action: { type: "edit-dx", code: "cad-suspected", label: "Resolve" } }];
      const since = c.onset ? String(c.onset).slice(0, 10) : localDay(c.recorded_at);
      const t = latestCcsTest(s);
      // a working diagnosis brought in from history (no onset): an angiogram from the last 12 months counts too
      const cath = [...s.studies].reverse().find((x) => x.kind === "cath" && (localDay(x.performed_at) >= since || (!c.onset && (Date.parse(s.today) - Date.parse(x.performed_at)) / 864e5 <= 365)));
      // a working diagnosis brought in from history has no onset: a test from the last 12 months already counts
      // (20 Oct 2026, real case imported with last year's stress test)
      const recentBefore = !!t && !c.onset && (Date.parse(s.today) - Date.parse(t.at)) / 864e5 <= 365;
      const tested = (t && t.at >= since) || recentBefore || !!cath;
      if (tested) {
        const decided = s.pathwaysDone["ccs-test-result"] && localDay(s.pathwaysDone["ccs-test-result"]) >= (t?.at ?? since);
        // a coronary angiogram without obstructive disease, or a negative imaging test: ask to rule it out
        if (cath && !coronaryAnatomyComplete(cath.attributes ?? {}) && !obstructiveCad('cath',cath.attributes ?? {}))
          return [{key:'incomplete',signature:cath.id,severity:'yellow',title:'Coronary angiography: anatomy incomplete — review the report',detail:'Missing or not-assessed vessels do not exclude obstructive disease. Complete the existing report before resolving the working diagnosis.',facts:[{label:'Angiography',value:'Incomplete anatomy',date:localDay(cath.performed_at)}],missing:['Coronary anatomy'],action:{type:'tab',tab:'investigations'}}];
        if (cath && !obstructiveCad("cath", cath.attributes ?? {}) && (!t || localDay(cath.performed_at) >= t.at))
          return [{ key: "negative", signature: cath.id, severity: "yellow", title: "Suspected IHD: no obstructive disease on angiography — rule it out?", detail: "Resolve the working diagnosis from the header, or consider ANOCA/INOCA testing if angina persists.", facts: [{ label: "Angiography", value: "No obstructive coronary disease", date: localDay(cath.performed_at) }], missing: [], action: { type: "edit-dx", code: "cad-suspected", label: "Rule out" } }];
        if (t && t.risk === "negative" && t.at >= since && ruleOutCapable(t.kind, s.studies.find((x) => x.id === t.id)?.attributes ?? {}) && !decided)
          return [{ key: "negative", signature: t.id, severity: "yellow", title: "Suspected IHD: test negative — rule it out?", detail: `${t.why}. Resolve the working diagnosis from the header, or plan the next step.`, facts: [{ label: "Test", value: t.label, date: t.at }], missing: [], action: { type: "edit-dx", code: "cad-suspected", label: "Rule out" } }];
        return [];
      }
      if (s.pathwaysDone["suspected-ihd"] && localDay(s.pathwaysDone["suspected-ihd"]) >= since) return [];
      if (s.plan.some((p) => p.status === "planned" && /coronary angiography|stress|ct coronary|mibi/i.test(p.title))) return [];
      return [{
        key: "workup", signature: since, severity: "yellow",
        title: "Suspected IHD: choose the first test",
        detail: "Clinical likelihood decides: CCTA (low–moderate), functional imaging (moderate–high), ICA (very high or symptoms at low exercise).",
        facts: [{ label: "Working diagnosis", value: "Suspected IHD (to rule out)", date: since }, { label: "Guideline", value: "ESC CCS 2024" }],
        missing: [], action: { type: "wizard", wizard: "suspected-ihd" },
      }];
    },
  },
  {
    id: "cad.test-result",
    kind: "clinical",
    title: "Non-invasive coronary test result needs a decision",
    inputs: ["studies", "procedures", "pathways", "plan"],
    defaultParams: {},
    evidence:
      "2024 ESC CCS: high event risk on non-invasive testing (Rec. Table 14, I B) → revascularisation recommended (Rec. Table 22, I B) after ICA with functional assessment; uncertain non-invasive result → ICA with invasive functional assessment (Rec. Table 11, I B); positive, not high risk → medical therapy, revascularisation if angina persists. Shown for a test in the last 12 months until the pathway is completed, an angiography or revascularisation follows, or an angiography is planned.",
    evaluate(s) {
      const t = latestCcsTest(s);
      if (!t || t.risk === "negative") return [];
      const daysOld = (Date.parse(s.today) - Date.parse(t.at)) / 864e5;
      if (daysOld > 365) return [];
      const after = (d: string) => localDay(d) >= t.at;
      if (s.studies.some((x) => x.kind === "cath" && after(x.performed_at))) return [];
      if (s.procedures.some((p) => (p.kind === "pci" || p.kind === "cabg") && after(p.performed_at))) return [];
      if (s.pathwaysDone["ccs-test-result"] && localDay(s.pathwaysDone["ccs-test-result"]) >= t.at) return [];
      if (s.plan.some((p) => p.status === "planned" && /^invasive coronary angiography/i.test(p.title))) return [];
      const title =
        t.risk === "high" ? `${t.label}: high-risk result — invasive angiography with a view to revascularisation`
        : t.risk === "uncertain" ? `${t.label}: uncertain result — decide the next test`
        : `${t.label}: ischaemia / obstructive disease — plan management`;
      return [{
        key: "test", signature: t.id, severity: t.risk === "high" ? "orange" : "yellow",
        title,
        detail: t.why,
        facts: [{ label: "Test", value: `${t.label}${t.summary ? ` · ${t.summary}` : ""}`, date: t.at }, { label: "Guideline", value: "ESC CCS 2024" }],
        missing: [], action: { type: "wizard", wizard: "ccs-test-result" },
      }];
    },
  },
{
    // 28 Oct 2026 (Ahmed: "CA came MVD for CABG, not done as the patient refused, and nothing in the overview")
    id: "cad.cath-revascularisation",
    kind: "clinical",
    title: "Left main / multivessel disease at angiography: revascularisation decision",
    inputs: ["studies", "procedures", "contexts", "plan"],
    defaultParams: {},
    evidence:
      "2024 ESC CCS: significant left main stenosis — CABG recommended over medical therapy alone to improve survival (Rec. Table 22, I A); multivessel disease — revascularisation to reduce cardiovascular death and MI, CABG preferred in complex multivessel disease or diabetes (I A); PCI an alternative in left main/multivessel disease of low–intermediate anatomical complexity (I A); Heart Team decision with the patient's preference (I C). Shown until a CABG or PCI is recorded after the angiogram, or a Heart Team decision for medical therapy is recorded as the angiography outcome.",
    evaluate(s) {
      const cath = [...s.studies].filter((x) => x.kind === "cath").sort((a, b) => a.performed_at.localeCompare(b.performed_at)).pop();
      if (!cath) return [];
      const a = cath.attributes ?? {};
      const ext = cathExtent(a);
      const day = localDay(cath.performed_at);
      const outcome = String(a.outcome ?? "");
      if (!ext || outcome === "Medical therapy" || outcome === "PCI performed") return [];
      if (!ext.prognostic && !["Referred for CABG", "CABG declined by patient", "Heart team discussion"].includes(outcome)) return [];
      if (s.procedures.some((p) => (p.kind === "cabg" || p.kind === "pci") && localDay(p.performed_at) >= day)) return [];
      // the patient's refusal: recorded as the outcome, or the admission of the angiogram ended against medical advice
      const lama = s.contexts.find((c) => c.kind === "admission" && (c.summary as any)?.destination === "Left against medical advice" &&
        localDay(c.started_at) <= day && localDay(c.ended_at ?? s.today) >= day);
      const declined = outcome === "CABG declined by patient";
      const booked = s.plan.find((p) => p.status === "planned" && /heart team|cabg|cardiac surg/i.test(p.title));
      const what = ext.short;
      const title = declined
        ? `${what}: patient declined CABG — re-discuss surgery; Heart Team for PCI if still declined`
        : outcome === "Referred for CABG"
          ? `${what}: referred for CABG — surgery not yet recorded`
          : `${what} at angiography: revascularisation decision (Heart Team)`;
      const detail = declined
        ? "CABG improves survival in left main and multivessel disease (ESC CCS 2024, I A). Re-discuss surgery with the patient and family and record the answer; if CABG is still declined, Heart Team review for PCI as the alternative revascularisation. Meanwhile full anti-anginal therapy and secondary prevention (LDL-C, BP, antiplatelet), and early review for any angina."
        : outcome === "Referred for CABG"
          ? "Book the surgical review/operation and track it to completion; if surgery is not done, record why (patient declined, unsuitable) so the Heart Team can consider PCI."
          : "Left main ≥50% or 3-vessel disease: revascularisation improves prognosis (ESC CCS 2024, I A). Decide CABG vs PCI with the Heart Team and the patient.";
      const facts: { label: string; value: string; date?: string }[] = [
        { label: "Angiography", value: ext.text, date: day },
        { label: "Outcome", value: outcome || "Not stated" },
      ];
      if (lama) facts.push({ label: "Discharge", value: "Left against medical advice", date: localDay(lama.ended_at ?? lama.started_at) });
      if (booked) facts.push({ label: "Booked", value: booked.title, date: booked.due_date ? String(booked.due_date).slice(0, 10) : undefined });
      return [{
        key: declined ? "declined" : "pending", signature: `${cath.id}:${declined ? "declined" : outcome}:${booked?.id ?? ""}`,
        severity: booked ? "yellow" : "orange", title, detail, facts, missing: [],
        action: booked ? { type: "tab", tab: "plan" } : { type: "add-plan", template: "coronary-heart-team" },
      }];
    },
  },
];
