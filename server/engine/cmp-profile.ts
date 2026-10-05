// The cardiomyopathy profile (cardiomyopathy module, slice 1): one view model for the
// "Cardiomyopathy" panel and the rules. Descriptive only: each cardiomyopathy on the problem list
// with its form, genetic result and gene; the measurements risk assessment reads (maximal wall
// thickness, LA diameter, LVOT gradients, LVEF, LGE extent); the latest ECG, echo and CMR; family
// history of sudden death or cardiomyopathy; the cardiac device; and ventricular arrhythmia or cardiac
// arrest recorded at an admission, a visit or a device check.
import { DIAGNOSIS, MEASURES, formatNumber } from "../../shared/catalog.js";
import { attributesText, historyCode } from "../../shared/history.js";
import { localDay } from "../../shared/clinical.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import { deviceStatus } from "./rhythm-profile.js";

export const CMP_CODES = ["hcm", "dcm", "ndlvc", "arvc", "rcm", "amyloid"];
export const CMP_MEASURES = ["lvef", "mwt", "la-diam", "lvot-rest", "lvot-provoked", "lge-extent", "rvef"];
const ICD_TYPES = new Set(["ICD", "CRT-D"]);

export const cmpConditions = (s: PatientState) => s.conditions.filter((c) => CMP_CODES.includes(c.code) && c.status === "active");

// sustained VT / VF or cardiac arrest: admission or visit reason, discharge event, device check
export function ventricularEvents(s: PatientState) {
  const out: { at: string; label: string; ref: string }[] = [];
  for (const c of s.contexts) {
    const r = c.reasons.find((x) => /VT \/ VF|cardiac arrest/i.test(x));
    if (r) out.push({ at: c.started_at, label: `${c.kind === "admission" ? "Admission" : "Visit"} for ${r} · ${localDay(c.started_at)}`, ref: c.id });
    const ev = (((c.summary as any)?.events as string[] | undefined) ?? []).find((e) => /VT \/ VF|Cardiac arrest/i.test(e));
    if (ev) out.push({ at: c.ended_at ?? c.started_at, label: `${ev} during the admission of ${localDay(c.started_at)}`, ref: `${c.id}:event` });
  }
  for (const d of s.studies.filter((x) => x.kind === "device_check" && (x.attributes?.va === "Sustained VT" || x.attributes?.va === "VF")))
    out.push({ at: d.performed_at, label: `${d.attributes.va} on the device check of ${localDay(d.performed_at)}`, ref: d.id });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function cmpProfile(s: PatientState) {
  const conds = cmpConditions(s);
  if (!conds.length) return null;
  const value = (code: string) => {
    const o = s.resolved(code).current;
    return o?.value_num != null ? { code, label: MEASURES[code].short, value: formatNumber(o.value_num, MEASURES[code].decimals), unit: MEASURES[code].unit, at: o.effective_at } : null;
  };
  const study = (kind: string) => {
    const x = latestStudy(s, kind);
    return x ? { at: x.performed_at, conclusion: x.conclusion, findings: x.findings, attributes: x.attributes } : null;
  };
  const dev = deviceStatus(s);
  const fhx = s.resolved(historyCode("fhx-scd")).current?.value_text ?? null;
  return {
    conditions: conds.map((c) => ({
      code: c.code, title: DIAGNOSIS[c.code]?.display ?? c.display, since: c.onset, detail: attributesText(c.code, c.attributes) || null,
      genetic: (c.attributes?.genetic as string | undefined) ?? null, gene: (c.attributes?.gene as string | undefined) ?? null,
      form: (c.attributes?.form as string | undefined) ?? null, type: (c.attributes?.type as string | undefined) ?? null,
    })),
    values: CMP_MEASURES.map(value).filter(Boolean) as NonNullable<ReturnType<typeof value>>[],
    ecg: study("ecg"), echo: study("echo"), cmr: study("cmr"),
    familySCD: fhx === "yes" ? "Yes" : fhx === "no" ? "No" : null,
    device: dev ? { type: dev.type, icd: !!dev.type && ICD_TYPES.has(dev.type) } : null,
    ventricular: ventricularEvents(s).slice(0, 3),
  };
}
export type CmpProfile = NonNullable<ReturnType<typeof cmpProfile>>;
