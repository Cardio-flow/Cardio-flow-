// The rhythm profile (rhythm & devices module, slice 1): one view model for the "Rhythm & devices"
// panel, notes and documents. Descriptive only: AF and its pattern, CHA₂DS₂-VA, anticoagulation with
// the DOAC label-dose check, rate- and rhythm-control medicines, the latest ECG and ambulatory ECG,
// conduction disease, cardiac devices, ablations and cardioversions — each with its date.
import { DIAGNOSIS, MEDICATION, doseLabel } from "../../shared/catalog.js";
import { attributesText } from "../../shared/history.js";
import { daysBetween } from "../../shared/clinical.js";
import { PROCEDURE_LABEL, RHYTHM_KINDS } from "../../shared/procedures.js";
import { latestStudy, type MedState, type PatientState } from "../kernel/state.js";
import { cha2ds2va, doacDoseCheck } from "./guidelines.js";

const live = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held");
const RHYTHM_DRUGS = ["amiodarone", "sotalol", "flecainide", "propafenone", "dronedarone"];
const RATE = (m: MedState) => m.tags.includes("bb") || m.tags.includes("ndhp-ccb") || m.tags.includes("digoxin") || (m.tags.includes("bb-other") && m.tags.includes("rate-slowing"));
const ARRHYTHMIA = ["af", "flutter", "svt", "vt", "av-block", "cied"];
const drugView = (s: PatientState, m: MedState) => ({
  id: m.id, name: m.name, status: m.status,
  dose: MEDICATION[m.code] ? `${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} ${m.frequency ?? ""}`.trim() : "",
  since: m.startedAt, days: m.startedAt ? daysBetween(m.startedAt, s.today) : null,
});

export function rhythmProfile(s: PatientState) {
  const conds = s.conditions.filter((c) => ARRHYTHMIA.includes(c.code));
  const procs = s.procedures.filter((p) => (RHYTHM_KINDS as string[]).includes(p.kind));
  const rhythmDrugs = live(s).filter((m) => RHYTHM_DRUGS.includes(m.code));
  const ecgAf = [latestStudy(s, "ecg"), latestStudy(s, "holter")].some((st) => st && /fibrillation|flutter|paroxysmal AF/i.test(String(st.attributes.rhythm ?? "")));
  if (!conds.length && !procs.length && !rhythmDrugs.length && !ecgAf) return null;

  const afc = s.conditions.find((c) => c.code === "af") ?? s.conditions.find((c) => c.code === "flutter") ?? null;
  const oacs = live(s).filter((m) => m.tags.includes("oac"));
  const checks = doacDoseCheck(s);
  const score = afc || ecgAf ? cha2ds2va(s) : null;
  const ecg = latestStudy(s, "ecg");
  const holter = latestStudy(s, "holter");
  const hr = s.resolved("hr").current;
  const devices = procs.filter((p) => p.kind === "device");
  const cied = s.conditions.find((c) => c.code === "cied");
  const av = s.conditions.find((c) => c.code === "av-block");

  return {
    af: !afc && ecgAf
      ? { title: "AF on ECG / Holter — not on the problem list", pattern: null, since: null }
      : afc
      ? {
          title: DIAGNOSIS[afc.code]?.display ?? afc.display,
          pattern: (afc.attributes?.pattern as string | undefined) && afc.attributes.pattern !== "Unknown" ? (afc.attributes.pattern as string) : null,
          since: afc.onset ?? (afc.attributes?.onsetYear ? String(afc.attributes.onsetYear) : null),
        }
      : null,
    stroke: score
      ? {
          score: score.score,
          items: score.items.map((i) => `${i.label} +${i.pts}`),
          // ESC AF 2024: OAC recommended with CHA2DS2-VA ≥2 (I), considered with 1 (IIa)
          advice: score.score >= 2 ? "OAC recommended (I)" : score.score === 1 ? "OAC should be considered (IIa)" : "No OAC indication from the score",
        }
      : null,
    anticoagulation: oacs.map((m) => {
      const c = checks.find((x) => x.med.id === m.id);
      return {
        ...drugView(s, m),
        doseCheck: c ? (c.right === m.doseValue ? "label dose" : `label dose ${doseLabel(MEDICATION[m.code], c.right)} (${c.why})`) : m.tags.includes("vka") ? "INR-guided" : null,
        doseOk: c ? c.right === m.doseValue : null,
      };
    }),
    rate: live(s).filter(RATE).map((m) => drugView(s, m)),
    rhythm: rhythmDrugs.map((m) => drugView(s, m)),
    hr: hr?.value_num != null ? { value: hr.value_num, at: hr.effective_at } : null,
    ecg: ecg
      ? {
          at: ecg.performed_at, rhythm: ecg.attributes.rhythm ?? null, rate: ecg.attributes.rate ?? null, qrs: ecg.attributes.qrs ?? null,
          qtc: ecg.attributes.qtc ?? null, morphology: ecg.attributes.qrsMorphology ?? null, avBlock: ecg.attributes.avBlock ?? null,
        }
      : null,
    holter: holter ? { at: holter.performed_at, summary: holter.findings[0] ?? "", attributes: holter.attributes } : null,
    conduction: av ? attributesText("av-block", av.attributes) || "AV block" : null,
    devices: devices.length
      ? devices.map((p) => ({ at: p.performed_at, type: p.attributes.type, action: p.attributes.action, indication: p.attributes.indication ?? null, pacing: p.attributes.pacing ?? null }))
      : cied ? [{ at: cied.onset, type: cied.attributes?.type ?? "Cardiac device", action: null, indication: null, pacing: null }] : [],
    events: procs
      .map((p) => ({ at: p.performed_at, kind: p.kind, title: PROCEDURE_LABEL[p.kind as "device"] ?? p.kind, detail: p.summary }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    conditions: conds.filter((c) => c.code !== "af" && c.code !== "flutter" && c.code !== "cied").map((c) => ({ title: DIAGNOSIS[c.code]?.display ?? c.display, detail: attributesText(c.code, c.attributes) })),
  };
}
export type RhythmProfile = NonNullable<ReturnType<typeof rhythmProfile>>;
