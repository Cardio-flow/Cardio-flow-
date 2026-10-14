import type { RuleDef, Finding } from "./rules.js";
import { labResults } from "./lab-results.js";
import {
  LAB_LIMITS,
  LAB_SOURCES,
  LAB_URLS,
  ratio,
  type LabReview,
} from "../../shared/lab-review.js";
import { DIAGNOSIS, MEASURES, formatNumber } from "../../shared/catalog.js";
// Re-exposure after a result needs a fresh decision; a hold, stop or dose reduction made in answer to the alert
// does not (it would otherwise bring the same alert straight back).
const reExposure = (meds: { events: { id: string; kind: string; effective_at: string }[] }[], since: string) =>
  meds.flatMap((m) => m.events.filter((e) => e.effective_at >= since && ["start", "restart", "resume", "increase"].includes(e.kind)).map((e) => e.id)).sort().join(",");
const finding = (
  labs: LabReview,
  codes: string[],
  wizard: string,
  title: string,
  detail: string,
  severity: Finding["severity"],
  source: string,
  signature: string,
): Finding => ({
  key: "result",
  signature,
  severity,
  title,
  detail,
  source,
  facts: codes
    .filter((c) => labs[c])
    .map((c) => ({
      label: MEASURES[c].display,
      value: `${formatNumber(labs[c].value, MEASURES[c].decimals)} ${MEASURES[c].unit}${labs[c].referenceHigh ? ` · ULN ${labs[c].referenceHigh}` : ""}`,
      date: labs[c].at,
    })),
  missing: [],
  action: { type: "wizard", wizard },
});
export const LAB_RULES: RuleDef[] = [
  {
    id: "lab.vitamin-d",
    kind: "clinical",
    title: "Low vitamin D result",
    inputs: ["vitamin-d", "calcium", "egfr", "meds"],
    defaultParams: { low_nmol: LAB_LIMITS.vitaminD },
    evidence: LAB_SOURCES.vitamin,
    evaluate(s, p) {
      const l = labResults(s),
        r = l["vitamin-d"];
      if (s.patient.age < 18 || !r || r.value >= Number(p.low_nmol)) return [];
      return [
        finding(
          l,
          ["vitamin-d", "calcium", "egfr"],
          "vitamin-d-result",
          `Vitamin D ${r.value} nmol/L: replacement review`,
          "Check calcium, renal disease and existing supplements; select replacement and monitoring.",
          "yellow",
          LAB_URLS.vitamin,
          [
            r.id,
            l.calcium?.id,
            l.egfr?.id,
            // starting replacement is the answer to this alert, not a reason to raise it again
            "",
          ].join(":"),
        ),
      ];
    },
  },
  {
    id: "lab.anaemia",
    kind: "clinical",
    title: "Anaemia result review",
    inputs: [
      "haemoglobin",
      "ferritin",
      "tsat",
      "mcv",
      "b12",
      "folate",
      "egfr",
      "lvef",
      "conditions",
      "meds",
    ],
    defaultParams: {
      male_gdl: LAB_LIMITS.hbMale,
      female_gdl: LAB_LIMITS.hbFemale,
      severe_gdl: LAB_LIMITS.severeHb,
    },
    evidence: LAB_SOURCES.anaemia,
    evaluate(s, p) {
      const l = labResults(s),
        r = l.haemoglobin;
      if (
        s.patient.age < 18 ||
        !r ||
        r.value >=
          Number(s.patient.sex === "Female" ? p.female_gdl : p.male_gdl)
      )
        return [];
      return [
        finding(
          l,
          ["haemoglobin", "mcv", "ferritin", "tsat", "egfr"],
          "anaemia-result",
          `Haemoglobin ${r.value} g/dL: anaemia review`,
          "Assess bleeding and cause before choosing iron; urgent assessment for instability or severe anaemia.",
          r.value < Number(p.severe_gdl) ? "red" : "orange",
          LAB_URLS.anaemia,
          Object.values(l)
            .filter((x) =>
              [
                r.id,
                l.ferritin?.id,
                l.tsat?.id,
                l.mcv?.id,
                l.egfr?.id,
                l.lvef?.id,
                l.b12?.id,
                l.folate?.id,
              ].includes(x.id),
            )
            .map((x) => x.id)
            .join(":") +
            ":" +
            s.conditions
              .filter((c) => DIAGNOSIS[c.code]?.tags.includes("hf"))
              .map((c) => c.id)
              .join(","),
        ),
      ];
    },
  },
  {
    id: "lab.liver-enzymes",
    kind: "clinical",
    title: "Elevated liver enzymes",
    inputs: ["alt", "ast", "alp", "bilirubin", "meds"],
    defaultParams: { statin_review_uln: LAB_LIMITS.liverStop },
    evidence: LAB_SOURCES.liver,
    evaluate(s, p) {
      const l = labResults(s),
        rs = [l.alt, l.ast].filter(Boolean),
        statins = s.meds.filter(
          (m) => m.tags.includes("statin") && m.status === "active",
        );
      const abnormal = rs.some((r) => (ratio(r) ?? 0) > 1),
        missing = rs.some((r) => ratio(r) == null);
      if (!rs.length || (!abnormal && !missing)) return [];
      const high = rs.some(
        (r) => (ratio(r) ?? 0) >= Number(p.statin_review_uln),
      );
      return [
        finding(
          l,
          ["alt", "ast", "alp", "bilirubin"],
          "liver-result",
          missing
            ? "Liver enzymes: verify report limits"
            : high
              ? "Liver enzymes ≥3× ULN: medication and cause review"
              : "Elevated liver enzymes: result review",
          missing
            ? "Enter the lab report's upper limits before using statin thresholds."
            : high && s.meds.some((m) => m.code === "amiodarone" && m.status === "active")
              ? `On amiodarone: the label advises reducing the dose or withdrawing it above 3× ULN${statins.length ? "; also review the statin" : ""}. Assess symptoms and other causes.`
              : statins.length && high
              ? "Suggest pausing the statin pending review; assess symptoms and other causes."
              : "Review symptoms, liver pattern, medicines and other causes; a small rise alone does not require stopping statins.",
          high ? "orange" : "yellow",
          LAB_URLS.statin,
          [
            ...rs.map((r) => r.id),
            l.alp?.id,
            l.bilirubin?.id,
            reExposure(s.meds.filter((m) => m.tags.includes("statin")), rs.map((r) => r!.at).sort()[0]),
          ].join(":"),
        ),
      ];
    },
  },
  {
    id: "lab.statin-ck",
    kind: "clinical",
    title: "CK result on statin",
    inputs: ["ck", "egfr", "creatinine", "meds"],
    defaultParams: {
      review_uln: LAB_LIMITS.ckReview,
      stop_uln: LAB_LIMITS.ckStop,
    },
    evidence: LAB_SOURCES.ck,
    evaluate(s, p) {
      const l = labResults(s),
        r = l.ck,
        meds = s.meds.filter(
          (m) =>
            m.tags.includes("statin") && ["active", "held"].includes(m.status),
        );
      if (!r || !meds.length || (ratio(r) != null && ratio(r)! <= 1)) return [];
      const x = ratio(r),
        high = x != null && x > Number(p.stop_uln);
      return [
        finding(
          l,
          ["ck", "egfr"],
          "statin-ck-result",
          x == null
            ? "CK on statin: verify report limit"
            : `CK ${x.toFixed(1)}× ULN on statin`,
          high
            ? "Stop statin and assess renal function urgently; evaluate for rhabdomyolysis."
            : "Check muscle symptoms, exertion, interactions and the report's reference limit before selecting statin action.",
          high
            ? "red"
            : x != null && x >= Number(p.review_uln)
              ? "orange"
              : "yellow",
          LAB_URLS.statin,
          [r.id, l.egfr?.id, reExposure(meds, r.at)].join(":"),
        ),
      ];
    },
  },
  {
    id: "lab.iron-deficiency",
    kind: "clinical",
    title: "Iron deficiency without anaemia",
    inputs: ["ferritin", "haemoglobin", "conditions"],
    defaultParams: { ferritin_low: 15 },
    evidence: "WHO 2020 guideline on ferritin: serum ferritin <15 µg/L indicates iron deficiency in adults. Iron deficiency needs a cause (blood loss — GI evaluation as indicated, menstrual, malabsorption) and replacement. Heart failure has its own definition (hf.iron-deficiency). Persisting deficiency on oral iron: re-look for blood loss or malabsorption; IV iron when oral iron is ineffective or not tolerated (BSG 2021 iron deficiency anaemia guideline).",
    evaluate(s, p) {
      const f = s.resolved("ferritin").current, hb = s.resolved("haemoglobin").current;
      if (!f || f.value_num == null || f.value_num >= Number(p.ferritin_low) || s.tags.has("hf")) return [];
      // with anaemia the anaemia review covers it
      if (hb?.value_num != null && hb.value_num < (s.patient.sex === "Female" ? 12 : 13)) return [];
      const ts = s.resolved("tsat").current;
      const iron = s.meds.find((m) => m.status === "active" && m.tags.includes("oral-iron"));
      const vals = `ferritin ${formatNumber(f.value_num, 1)} µg/L${ts?.value_num != null ? `, TSAT ${formatNumber(ts.value_num, 0)}%` : ""}`;
      return [{
        key: "iron", signature: `${f.id}:${iron ? "on-iron" : "none"}`, severity: "yellow",
        title: iron ? `Iron deficiency on ${iron.name.split(" (")[0].toLowerCase()}: ${vals} — check the cause and the response` : `Iron deficiency: ${vals} — find the cause and replace`,
        detail: iron
          ? "Ferritin still below 15 µg/L (WHO 2020) on oral iron: look for ongoing blood loss (on antithrombotics: GI evaluation as indicated) or poor absorption, and consider IV iron if oral iron fails or is not tolerated."
          : "Ferritin below 15 µg/L (WHO 2020) with a normal haemoglobin: look for blood loss (on antithrombotics: GI evaluation as indicated) and replace iron.",
        facts: [
          { label: "Ferritin", value: `${formatNumber(f.value_num, 1)} µg/L`, date: f.effective_at },
          ...(ts?.value_num != null ? [{ label: "TSAT", value: `${formatNumber(ts.value_num, 0)}%`, date: ts.effective_at }] : []),
          ...(hb?.value_num != null ? [{ label: "Haemoglobin", value: `${formatNumber(hb.value_num, 1)} g/dL`, date: hb.effective_at }] : []),
          { label: "Guideline", value: "WHO 2020 · ferritin <15 µg/L" },
        ],
        missing: [], action: { type: "wizard", wizard: "anaemia-result" },
      }];
    },
  },
];
