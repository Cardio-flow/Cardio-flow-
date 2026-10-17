import { createHash } from "node:crypto";
import type { PatientState } from "../kernel/state.js";
import type { AortaContext } from "../../shared/aorta.js";
import { fmtDay } from "../../shared/clinical.js";
import {
  aorticMaximum,
  aorticSurgeryRecommended,
} from "../../shared/bicuspid.js";

export function aortaProfile(s: PatientState): AortaContext {
  // Dedicated reports and TAVI reports share the same measured anatomy. No free-text number extraction.
  const reports = s.studies.filter(
    (st) =>
      st.kind === "aortic_imaging" ||
      (st.kind === "structural_imaging" &&
        st.attributes.intervention === "TAVI" &&
        (st.attributes.aorticMorphology === "Bicuspid" ||
          aorticMaximum(st.attributes) > 0)),
  );
  const raw = [...reports].sort((a, b) =>
    b.performed_at.localeCompare(a.performed_at),
  )[0];
  const a = raw?.attributes ?? {};
  const echoes = s.studies.filter((st) => st.kind === "echo");
  const echo =
    [...echoes].reverse().find((st) => st.quality === "formal") ??
    echoes.at(-1);
  const valveAssessment =
    echo?.attributes.valves?.as && echo?.attributes.valves?.ar
      ? {
          at: echo.performed_at,
          summary: `AS ${echo.attributes.valves.as} · AR ${echo.attributes.valves.ar}`,
        }
      : null;
  const bicuspid =
    s.conditions.some((c) => c.code === "bav") ||
    reports.some((st) => st.attributes.aorticMorphology === "Bicuspid") ||
    s.studies.some(
      (st) =>
        st.kind === "echo" && st.findings.includes("Bicuspid aortic valve"),
    );
  const familyReport = [...reports]
    .reverse()
    .find((st) =>
      st.attributes.aorticRisks?.includes(
        "Family history of acute aortic syndrome",
      ),
    );
  const heritable =
    s.conditions.some((c) => c.code === "heritable-aortopathy") ||
    reports.some((st) =>
      st.attributes.aorticRisks?.includes(
        "Heritable aortopathy / syndromic features",
      ),
    );
  const establishedHistory = reports.some(
    (st) =>
      [
        "Thoracic aortic dilatation",
        "Thoracic aortic aneurysm",
        "Chronic dissection / residual aortic disease",
      ].includes(st.attributes.interpretation) ||
      st.attributes.purpose === "After aortic repair" ||
      aorticMaximum(st.attributes) >= 40 ||
      st.attributes.archDiameter >= 55 ||
      st.attributes.descendingDiameter >= 55,
  );
  const eligible =
    establishedHistory ||
    !!familyReport ||
    ["Indeterminate", "Suspected acute aortic syndrome"].includes(
      a.interpretation,
    ) ||
    bicuspid ||
    heritable ||
    s.tags.has("aorta") ||
    !!echo?.findings.includes("Dilated aortic root / ascending aorta");
  const urgent: string[] = [],
    referral: string[] = [],
    missing: string[] = [];
  if (a.interpretation === "Suspected acute aortic syndrome")
    urgent.push(
      `Suspected acute aortic syndrome on report (${fmtDay(raw!.performed_at)})`,
    );
  if (familyReport)
    referral.push(
      `Recorded family history of acute aortic syndrome (${fmtDay(familyReport.performed_at)}): specialist family-risk review`,
    );
  if (heritable)
    referral.push(
      "Heritable / syndromic aortic disease: individualized specialist thresholds",
    );
  const max = aorticMaximum(a);
  if (bicuspid ? aorticSurgeryRecommended(a) : max >= 55)
    referral.push(
      "Root / ascending aortic size meets a guideline surgical-assessment threshold",
    );
  if (a.archDiameter >= 55 || a.descendingDiameter >= 55)
    referral.push("Arch / descending diameter ≥55 mm: aortic-team assessment");
  if (
    (a.comparison === "Comparable same-segment measurements reviewed" ||
      raw?.kind === "structural_imaging") &&
    a.aorticGrowth >= 3
  )
    referral.push(
      "Reported growth ≥3 mm/year: confirm method and obtain specialist review",
    );
  if (a.coarctation?.startsWith("Present"))
    referral.push("Coarctation requires a specialist strategy");
  if (a.aorticStrategy === "Aortic surgery indicated / preferred")
    referral.push("Recorded aortic surgical indication");
  if (
    reports.some(
      (st) =>
        st.attributes.purpose === "After aortic repair" ||
        st.attributes.interpretation ===
          "Chronic dissection / residual aortic disease",
    ) ||
    s.conditions.some((c) => c.code === "chronic-aortic-dissection")
  )
    referral.push(
      "Repair / chronic dissection: individualized aortic-team follow-up",
    );
  if (!valveAssessment) missing.push("Aortic valve function assessment (TTE)");
  if (!raw) missing.push("Dated aortic measurements and imaging extent");
  else {
    if (
      ![a.sinusDiameter, a.stjDiameter, a.ascendingDiameter].every(
        (n) => typeof n === "number" && n > 0,
      )
    )
      missing.push("Sinus, STJ and ascending aorta measurements");
    if (
      !["Tricuspid", "Bicuspid", "Other morphology"].includes(
        a.aorticMorphology,
      )
    )
      missing.push("Valve morphology and function review");
    if (
      (max >= 40 ||
        s.conditions.some((c) =>
          ["thoracic-aortic-dilatation", "thoracic-aortic-aneurysm"].includes(
            c.code,
          ),
        ) ||
        ["Thoracic aortic dilatation", "Thoracic aortic aneurysm"].includes(
          a.interpretation,
        )) &&
      a.extent !== "Entire thoracic aorta" &&
      !["CT reviewed", "CMR reviewed"].includes(a.thoracicAorta)
    )
      missing.push("Complete thoracic CT / CMR assessment where indicated");
    if (
      bicuspid &&
      ![
        "No dilatation",
        "Root phenotype",
        "Ascending phenotype",
        "Mixed / other",
      ].includes(a.aorticPhenotype)
    )
      missing.push("Bicuspid aortic phenotype");
    if (
      bicuspid &&
      ![
        "Excluded",
        "Present",
        "Present; specialist strategy recorded",
      ].includes(a.coarctation)
    )
      missing.push("Bicuspid coarctation assessment");
    if (a.interpretation === "Indeterminate")
      missing.push("Definitive aortic report interpretation");
  }
  const contexts = s.contexts
    .filter((c) => !c.summary?.historical && c.status === "open")
    .map((c) => [c.id, c.version, c.reasons, c.summary.symptoms]);
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        reports: reports.map((st) => st.id),
        echo: echo?.id,
        conditions: s.conditions.map((c) => c.id).sort(),
        contexts,
        bp: ["sbp", "dbp"].map((code) => s.resolved(code).current?.id),
        meds: s.meds
          .filter((m) =>
            m.tags.some((t) => ["raas", "bb", "bp-lowering"].includes(t)),
          )
          .map((m) => [m.id, m.events.at(-1)?.id, m.status]),
      }),
    )
    .digest("hex");
  return {
    key,
    eligible: eligible || referral.length > 0 || urgent.length > 0,
    bicuspid,
    heritable,
    valveAssessment,
    familyRecommended:
      bicuspid ||
      heritable ||
      !!familyReport ||
      s.conditions.some((c) => c.code === "chronic-aortic-dissection") ||
      // ACC/AHA family imaging recommendation addresses root/ascending aneurysm or dissection.
      // A report with measured non-dilated proximal segments and documented distal disease
      // does not establish that indication; personal/family/genetic risk still takes priority.
      ((a.interpretation === "Thoracic aortic aneurysm" ||
        s.conditions.some((c) => c.code === "thoracic-aortic-aneurysm")) &&
        !(
          [a.sinusDiameter, a.ascendingDiameter].every(
            (n) => typeof n === "number" && n > 0 && n < 40,
          ) &&
          a.extent === "Entire thoracic aorta" &&
          (a.archDiameter != null || a.descendingDiameter != null)
        )),
    report: raw
      ? {
          id: raw.id,
          at: raw.performed_at,
          attributes: a,
          summary: raw.findings.join(" · "),
          conclusion: raw.conclusion,
        }
      : null,
    urgent,
    referral,
    missing,
  };
}
