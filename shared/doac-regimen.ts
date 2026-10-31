// AF maintenance regimens: ESC AF 2024 / EHRA practical guide and each EU SmPC 4.2.
// Milligrams are calculated by the existing renal/age/weight dose engine.
import { DAILY_FREQUENCY } from "./medication-exposure.js";
export const AF_DOAC_FREQUENCY: Record<string, string> = {
  apixaban: "BID",
  rivaroxaban: "OD",
  edoxaban: "OD",
  dabigatran: "BID",
};
export type AfDoacCheck = {
  code: string;
  dose: number | null;
  right: number;
  why: string;
  frequency?: string | null;
};
export const afDoacNeedsChange = (d: AfDoacCheck) =>
  d.dose != null &&
  (d.dose !== d.right || (d.frequency != null && !afDoacFrequencyMatches(d)));
const afDoacFrequencyMatches = (d: AfDoacCheck) =>
  !!d.frequency &&
  DAILY_FREQUENCY[d.frequency] != null &&
  DAILY_FREQUENCY[d.frequency] === DAILY_FREQUENCY[AF_DOAC_FREQUENCY[d.code]];
export const afDoacMatches = (d: AfDoacCheck) =>
  d.dose != null && d.dose === d.right && afDoacFrequencyMatches(d);
export const afDoacRegimen = (d: AfDoacCheck, target = false) =>
  `${target ? d.right : (d.dose ?? "—")} mg ${target ? AF_DOAC_FREQUENCY[d.code] : (d.frequency ?? "(frequency not recorded)")}`;
