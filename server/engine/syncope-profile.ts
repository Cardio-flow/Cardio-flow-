import { deviceStatus } from "./rhythm-profile.js";
import { createHash } from "node:crypto";
import { latestStudy, type PatientState } from "../kernel/state.js";
import { localDay, fmtDay } from "../../shared/clinical.js";
export function syncopeProfile(s: PatientState) {
  const contexts = s.contexts.filter(
    (c) => c.status === "open" || c === s.contexts.at(-1),
  );
  const context = [...contexts]
    .reverse()
    .find((c) =>
      [...c.reasons, ...((c.summary as any)?.symptoms ?? [])].some(
        (v: string) => /syncope|presyncope|unexplained fall/i.test(v),
      ),
    );
  const ecg = latestStudy(s, "ecg"),
    holter = latestStudy(s, "holter"),
    standing = latestStudy(s, "orthostatic_bp"),
    echo = latestStudy(s, "echo"),
    device = latestStudy(s, "device_check");
  const urgent: string[] = [];
  // The latest reported high-grade AV block is a concern, never an automatic causal diagnosis.
  if (ecg && ["Mobitz II", "Complete"].includes(String(ecg.attributes.avBlock)))
    urgent.push(
      `${ecg.attributes.avBlock} AV block on ECG (${fmtDay(ecg.performed_at)})`,
    );
  if (
    holter &&
    ["Mobitz II", "Complete"].includes(String(holter.attributes.avBlock))
  )
    urgent.push(
      `${holter.attributes.avBlock} AV block on ambulatory ECG (${fmtDay(holter.performed_at)})`,
    );
  if (device && ["Sustained VT", "VF"].includes(String(device.attributes.va)))
    urgent.push(
      `${device.attributes.va} on device check (${fmtDay(device.performed_at)})`,
    );
  if (echo?.attributes?.valves?.as === "Severe")
    urgent.push(
      "Severe aortic stenosis on the recorded echo: assess possible cardiac syncope",
    );
  const val = (code: string) => s.resolved(code).current;
  const relevantMeds = s.meds
    .filter((m) => m.status === "active" || m.status === "held")
    .filter((m) =>
      m.tags.some((t) =>
        [
          "bb",
          "rate-slowing",
          "digoxin",
          "loop",
          "thiazide",
          "raas",
          "mra",
          "vasodilator",
          "nitrate",
          "bp-lowering",
        ].includes(t),
      ),
    );
  const fingerprint = {
    context: context
      ? {
          id: context.id,
          reasons: context.reasons,
          symptoms: (context.summary as any)?.symptoms ?? [],
          narrative: (context.summary as any)?.narrative ?? "",
        }
      : null,
    studies: [ecg, holter, standing, echo, device].map((x) => x?.id ?? null),
    vitals: ["sbp", "dbp", "hr", "lvef"].map((x) => val(x)?.id ?? null),
    conditions: s.conditions.map((c) => c.id).sort(),
    meds: relevantMeds.map((m) => [m.id, m.status, m.events.at(-1)?.id]).sort(),
  };
  const key = createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex");
  return {
    key,
    contextId: context?.id ?? null,
    at: context?.started_at ?? null,
    presentation: context
      ? [
          ...context.reasons,
          ...((context.summary as any)?.symptoms ?? []),
        ].some((v: string) => /unexplained fall/i.test(v))
        ? "fall"
        : [...context.reasons].some((v: string) => /^presyncope$/i.test(v))
          ? "presyncope"
          : context.reasons.some((v) => /^syncope$/i.test(v))
            ? "syncope"
            : null
      : null,
    urgent,
    ecg: ecg
      ? {
          id: ecg.id,
          at: ecg.performed_at,
          summary: ecg.conclusion || ecg.findings.join(" · ") || "ECG recorded",
        }
      : null,
    standing: standing
      ? {
          id: standing.id,
          at: standing.performed_at,
          result: String(standing.attributes.interpretation ?? "Uncertain"),
          symptoms: String(standing.attributes.symptoms ?? "Not recorded"),
        }
      : null,
    hasDevice:
      !!deviceStatus(s),
    structuralConcern:
      s.tags.has("hf") || s.tags.has("cmp") || s.tags.has("valve"),
    medicineNames: relevantMeds.map((m) => m.name),
  };
}
