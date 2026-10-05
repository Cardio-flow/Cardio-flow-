// The pulmonary hypertension profile (PH module, slice 1): the latest echo probability of PH (peak TR
// velocity with the additional signs), SPAP, the PH diagnosis with its clinical group and catheter
// haemodynamics, and the PH-specific medicines. Shown when PH is listed or the latest echo gives an
// intermediate or high probability.
import { DIAGNOSIS, MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { PH_SIGNS, phEchoProbability } from "../../shared/ph.js";
import type { PatientState } from "../kernel/state.js";

// the latest echo that measured the TR velocity or recorded a PH sign, with its probability
export function latestPhEcho(s: PatientState) {
  const trvObs = s.resolved("trv").current;
  const echoes = s.studies.filter((x) => x.kind === "echo").sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  const e = echoes.find((x) => (x.attributes?.phSigns as string[] | undefined)?.length || (trvObs && trvObs.study_id === x.id));
  if (!e) return null;
  const trv = trvObs && trvObs.study_id === e.id ? trvObs.value_num : null;
  const signs = (e.attributes?.phSigns as string[] | undefined) ?? [];
  return { id: e.id, at: e.performed_at, signs, ...phEchoProbability(trv, signs) };
}

export function phProfile(s: PatientState) {
  const c = s.conditions.find((x) => x.code === "ph" && x.status === "active");
  const echo = latestPhEcho(s);
  if (!c && (!echo || echo.probability === "low") && !s.procedures.some((x) => x.kind === "rhc")) return null;
  const value = (code: string) => {
    const o = s.resolved(code).current;
    return o?.value_num != null ? { code, label: MEASURES[code].short, value: formatNumber(o.value_num, MEASURES[code].decimals), unit: MEASURES[code].unit, at: o.effective_at } : null;
  };
  const rhcs = s.procedures.filter((x) => x.kind === "rhc").sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  const rhc = rhcs[0] ? { at: rhcs[0].performed_at, class: (rhcs[0].attributes.class as string | undefined) ?? null, summary: rhcs[0].summary } : null;
  const meds = s.meds.filter((m) => (m.status === "active" || m.status === "held") && MEDICATION[m.code]?.purpose === "Pulmonary hypertension");
  return {
    listed: c ? { title: DIAGNOSIS.ph.display, since: c.onset, group: (c.attributes?.group as string | undefined) ?? null, haemo: (c.attributes?.haemo as string | undefined) ?? null } : null,
    echo: echo ? { at: echo.at, probability: echo.probability, trv: echo.trv, signs: echo.signs.map((k) => PH_SIGNS.find((x) => x.key === k)?.label ?? k), categories: echo.categories } : null,
    rhc,
    values: ["mpap", "pawp", "pvr", "trv", "spap", "nt-probnp"].map(value).filter(Boolean) as NonNullable<ReturnType<typeof value>>[],
    meds: meds.map((m) => ({ name: m.name, dose: `${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} ${m.frequency ?? ""}`.trim() })),
  };
}
