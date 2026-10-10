// The rhythm profile (rhythm & devices module, slice 1): one view model for the "Rhythm & devices"
// panel, notes and documents. Descriptive only: AF and its pattern, CHA₂DS₂-VA, anticoagulation with
// the DOAC label-dose check, rate- and rhythm-control medicines, the latest ECG and ambulatory ECG,
// conduction disease, cardiac devices, ablations and cardioversions — each with its date.
import { addCalendarMonths } from "../../shared/af.js";
import { DIAGNOSIS, MEDICATION, doseLabel } from "../../shared/catalog.js";
import { attributesText } from "../../shared/history.js";
import { addDays, daysBetween, localDay } from "../../shared/clinical.js";
import { CIED_TYPE, PROCEDURE_LABEL, RHYTHM_KINDS } from "../../shared/procedures.js";
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

// The current cardiac device and its follow-up (slice 4). Interval to the next check from the 2023
// HRS/EHRA/APHRS/LAHRS remote device clinic consensus (I, C-EO): at least every 3–12 months for a
// pacemaker and every 3–6 months for an ICD (CRT-P as a pacemaker, CRT-D as an ICD), every 1–3 months
// as the battery approaches elective replacement. The outer limit of each range is used; a loop
// recorder is followed by alerts, so no scheduled check is due.
export const CHECK_MONTHS: Record<string, number | null> = { Pacemaker: 12, "CRT-P": 12, ICD: 6, "CRT-D": 6, "Loop recorder": null };
export function deviceStatus(s: PatientState) {
  const procs = s.procedures.filter((p) => p.kind === "device").sort((a, b) => a.performed_at.localeCompare(b.performed_at));
  const lastProc = procs[procs.length - 1] ?? null;
  const cied = s.conditions.find((c) => c.code === "cied" && c.status === "active");
  if (lastProc?.attributes.action === "Extraction" && !cied) return null;
  if (!lastProc && !cied) return null;
  const type: string | null = lastProc && lastProc.attributes.action !== "Extraction" ? CIED_TYPE(lastProc.attributes.type) : ((cied?.attributes?.type as string | undefined) ?? null);
  const implant = [...procs].reverse().find((p) => ["New implant", "Upgrade", "Generator change"].includes(p.attributes.action)) ?? null;
  const implantAt = implant ? localDay(implant.performed_at) : cied?.onset ? localDay(cied.onset) : null;
  const checks = s.studies.filter((x) => x.kind === "device_check").sort((a, b) => a.performed_at.localeCompare(b.performed_at));
  const check = checks[checks.length - 1] ?? null;
  const checkAt = check ? localDay(check.performed_at) : null;
  // a generator change after the last check resets the battery
  const batteryLow = !!check && check.attributes.battery !== "OK" && !(implant && implant.performed_at >= check.performed_at);
  const months = type ? CHECK_MONTHS[type] ?? null : null;
  const since = [checkAt, implantAt].filter(Boolean).sort().pop() ?? null;
  const intervalMonths = months == null ? null : batteryLow ? 3 : months;
  const dueAt = since && intervalMonths ? addDays(since, Math.round(intervalMonths * 30.44)) : null;
  return {
    type, implantAt, implantId: implant?.id ?? null, procs,
    check: check ? { id: check.id, at: check.performed_at, a: check.attributes as Record<string, any>, summary: check.findings[0] ?? "" } : null,
    checks: checks.length, batteryLow, intervalMonths, dueAt, since,
  };
}

export function rhythmProfile(s: PatientState) {
  const conds = s.conditions.filter((c) => ARRHYTHMIA.includes(c.code));
  const procs = s.procedures.filter((p) => (RHYTHM_KINDS as string[]).includes(p.kind));
  const rhythmDrugs = live(s).filter((m) => RHYTHM_DRUGS.includes(m.code));
  const ecgAf = [latestStudy(s, "ecg"), latestStudy(s, "holter")].some((st) => st && /fibrillation|flutter|paroxysmal AF/i.test(String(st.attributes.rhythm ?? "")));
  if (!conds.length && !procs.length && !rhythmDrugs.length && !ecgAf && !s.studies.some((x) => x.kind === "device_check")) return null;

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

  const ablation = [...procs].reverse().find(p => p.kind === "ablation" && (p.attributes.targets ?? []).some((t: string) => /^AF/.test(t)));
  const closure = [...procs].reverse().find(p => p.kind === "laao" && p.attributes.result === "Implanted / completed");
  const laImage = closure ? [...s.studies].reverse().find(st => st.kind === "laa_imaging" && st.attributes.purpose === "After closure" && st.performed_at >= closure.performed_at) : null;
  const dev = deviceStatus(s);
  return {
    aftercare: {
      ablation: ablation ? { day: localDay(ablation.performed_at), blankingEnd: addDays(localDay(ablation.performed_at),56), minimumOac: addCalendarMonths(localDay(ablation.performed_at), s.afReviews?.["after-af-ablation"]?.answers._procedureId === ablation.id && s.afReviews["after-af-ablation"].answers.basis === "acc" ? 3 : 2) } : null,
      closure: closure ? { day: localDay(closure.performed_at), device: closure.attributes.device, method: closure.attributes.method, regimen: s.afReviews?.["after-laao"]?.answers._procedureId === closure.id ? s.afReviews["after-laao"].answers.regimen : closure.attributes.regimen, image: laImage ? { day: localDay(laImage.performed_at), thrombus: laImage.attributes.deviceThrombus, leak: laImage.attributes.leak } : null } : null,
    },
    device: dev ? {
      type: dev.type, implantAt: dev.implantAt, dueAt: dev.dueAt, intervalMonths: dev.intervalMonths, overdue: !!dev.dueAt && dev.dueAt < s.today,
      check: dev.check ? { at: dev.check.at, summary: dev.check.summary, battery: dev.check.a.battery, longevity: dev.check.a.longevity ?? null, setting: dev.check.a.setting } : null,
    } : null,
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
          advice: closure?.attributes.method === "Transcatheter occlusion" && !s.conditions.some(c => ["mechanical-valve", "ms-significant"].includes(c.code)) ? "LAA closure: device-specific stroke-prevention review" : score.score >= 2 ? "OAC recommended (I)" : score.score === 1 ? "OAC should be considered (IIa)" : "No OAC indication from the score",
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
