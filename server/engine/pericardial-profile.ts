import { createHash } from "node:crypto";
import { latestStudy, type PatientState } from "../kernel/state.js";
import {
  pericardialSize,
  type PericardialContext,
} from "../../shared/pericardial.js";
export function pericardialProfile(s: PatientState): PericardialContext {
  const report = latestStudy(s, "pericardial_imaging");
  // A later limited echo without pericardial fields does not establish resolution.
  // A dated dedicated report can explicitly supersede the earlier finding.
  const echo =
    [...s.studies]
      .filter(
        (st) =>
          st.kind === "echo" &&
          st.findings.some((f) =>
            /pericardial effusion|tamponade|constrictive/i.test(f),
          ),
      )
      .sort((a, b) => b.performed_at.localeCompare(a.performed_at))[0] ?? null;
  const drainage = [...s.procedures]
    .reverse()
    .find(
      (p) =>
        p.kind === "pericardiocentesis" &&
        p.attributes.result === "Drainage performed",
    );
  const fluid = drainage
    ? [...s.studies]
        .reverse()
        .find(
          (st) =>
            st.kind === "pericardial_fluid" &&
            st.attributes.procedureId === drainage.id,
        )
    : undefined;
  const live = s.contexts.filter((c) => !c.summary?.historical);
  const context = [...live]
    .reverse()
    .find(
      (c) =>
        (c.status === "open" || c === live.at(-1)) &&
        c.reasons.some((r) =>
          /pericarditis|pericardial|tamponade|constrictive/i.test(r),
        ),
    );
  const condition = [...s.conditions]
    .sort(
      (a, b) =>
        [
          "constrictive-pericarditis",
          "pericarditis",
          "pericardial-effusion",
        ].indexOf(a.code) -
        [
          "constrictive-pericarditis",
          "pericarditis",
          "pericardial-effusion",
        ].indexOf(b.code),
    )
    .find((c) =>
      [
        "pericarditis",
        "pericardial-effusion",
        "constrictive-pericarditis",
      ].includes(c.code),
    );
  const medicine = s.meds.find(
    (m) => m.status === "active" && /^pericarditis/i.test(m.indication ?? ""),
  );
  const a = report?.attributes ?? {},
    urgent: string[] = [],
    missing: string[] = [],
    risks: string[] = [];
  // A completed drainage does not prove resolution, but an earlier tamponade report is no longer the current pre-drainage state.
  const beforeDrain =
    !!drainage && (!report || report.performed_at < drainage.performed_at);
  if (
    !beforeDrain &&
    ["Clinical tamponade", "Echo signs concerning for tamponade"].includes(
      a.haemodynamics,
    )
  )
    urgent.push(a.haemodynamics);
  if (
    fluid &&
    (fluid.attributes.microbiology === "Organism identified" ||
      fluid.attributes.appearance === "Purulent")
  )
    urgent.push("Pericardial fluid: possible bacterial infection");
  if (
    echo &&
    (!report || echo.performed_at > report.performed_at) &&
    echo.findings.some((f) => /tamponade/i.test(f)) &&
    (!drainage || echo.performed_at > drainage.performed_at)
  )
    urgent.push("New echo reports tamponade concern");
  const echoConcern =
    !!echo &&
    (!report || echo.performed_at > report.performed_at) &&
    echo.findings.some((f) =>
      /pericardial effusion|tamponade|constrictive/i.test(f),
    );
  const reportConcern =
    !!report &&
    (a.effusion !== "Absent" ||
      ["Suspected", "Confirmed"].includes(a.constriction) ||
      a.inflammation === "Present" ||
      urgent.length > 0);
  if (
    (!report || (echo && echo.performed_at > report.performed_at)) &&
    echoConcern
  )
    missing.push("Effusion size, haemodynamics and inflammation assessment");
  if (
    report &&
    ["Circumferential", "Loculated"].includes(a.effusion) &&
    a.size == null
  )
    missing.push("Measured effusion size");
  if (report && a.haemodynamics === "Not assessed")
    missing.push("Haemodynamic assessment");
  if (beforeDrain) missing.push("Post-drainage echo and clinical assessment");
  if (
    drainage &&
    (!fluid ||
      ["microbiology", "cytology", "tb"].some((k) =>
        ["Pending", "Not sent"].includes(fluid.attributes[k]),
      ))
  )
    missing.push("Pericardial fluid results and clinical review");
  const active = s.meds.filter((m) => m.status === "active");
  if (active.some((m) => m.tags.includes("oac")))
    risks.push(
      "Oral anticoagulant: assess bleeding risk before anti-inflammatory therapy / drainage",
    );
  if (s.tags.has("hf"))
    risks.push(
      "Heart failure: review fluid retention and renal risk with NSAIDs",
    );
  if (
    s.resolved("egfr").current?.value_num != null &&
    s.resolved("egfr").current!.value_num! < 60
  )
    risks.push("Reduced eGFR: prescriber renal-dose and interaction review");
  const label =
    (condition
      ? {
          pericarditis: "Pericarditis",
          "pericardial-effusion": "Pericardial effusion",
          "constrictive-pericarditis": "Constrictive pericarditis",
        }[condition.code]
      : null) ??
    context?.reasons.find((r) => /pericard|tamponade|constrictive/i.test(r)) ??
    (medicine
      ? `${medicine.name} recorded for pericarditis`
      : "Pericardial disease");
  const suggestedType =
    beforeDrain || (drainage && report?.attributes.purpose === "After drainage")
      ? "aftercare"
      : ["Suspected", "Confirmed"].includes(a.constriction) ||
          condition?.code === "constrictive-pericarditis"
        ? "constriction"
        : condition?.code === "pericarditis" ||
            context?.reasons.some((r) => /pericarditis/i.test(r)) ||
            medicine ||
            a.inflammation === "Present"
          ? "pericarditis"
          : reportConcern || echoConcern || condition
            ? "effusion"
            : null;
  const fingerprint = {
    condition: condition?.id,
    report: report?.id,
    echo: echoConcern ? echo?.id : null,
    drainage: drainage?.id,
    fluid: fluid?.id,
    context: context ? [context.id, context.reasons] : null,
    meds: active
      .filter((m) =>
        m.tags.some((t) => ["oac", "nsaid", "colchicine"].includes(t)),
      )
      .map((m) => [m.id, m.doseValue, m.frequency, m.events.at(-1)?.id]),
    labs: [
      "crp",
      "hs-troponin",
      "creatinine",
      "haemoglobin",
      "temp",
      "sbp",
      "hr",
    ].map((c) => s.resolved(c).current?.id),
  };
  return {
    key: createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex"),
    eligible: !!(
      condition ||
      context ||
      medicine ||
      reportConcern ||
      echoConcern ||
      drainage
    ),
    label,
    suggestedType,
    report: report
      ? {
          id: report.id,
          at: report.performed_at,
          summary: [report.findings.join(" · "), pericardialSize(a.size)]
            .filter(Boolean)
            .join(" · "),
          attributes: a,
        }
      : null,
    drainage: drainage
      ? {
          id: drainage.id,
          at: drainage.performed_at,
          summary: drainage.summary,
          attributes: drainage.attributes,
        }
      : null,
    fluid: fluid
      ? {
          id: fluid.id,
          at: fluid.performed_at,
          summary: fluid.findings.join(" · "),
          attributes: fluid.attributes,
        }
      : null,
    urgent,
    missing,
    risks,
  };
}
