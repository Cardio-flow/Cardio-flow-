// Non-invasive test results in chronic coronary syndromes (7 Oct 2026): which latest test result is
// high-risk, positive, uncertain or negative. The high-event-risk definitions are the guideline's own:
// 2024 ESC CCS, Recommendation Table 14 (I B) — SPECT/PET perfusion: ischaemia ≥10% of the LV myocardium;
// stress echo: ≥3 of 16 segments with stress-induced hypokinesia or akinesia; stress CMR: ≥2 of 16 segments
// with stress perfusion defects (or ≥3 dobutamine-induced dysfunctional segments); CCTA: left main ≥50%,
// three-vessel ≥70%, or two-vessel ≥70% including the proximal LAD; exercise ECG: Duke treadmill score <−10.
// CAD-RADS 4B is left main >50% or three-vessel obstructive (≥70%) disease (CAD-RADS 2.0).
export type TestRisk = "high" | "positive" | "uncertain" | "negative";
export const CCS_TEST_KINDS = ["nuclear", "stress", "ccta"] as const;

export function ccsTestRisk(kind: string, a: Record<string, any>): { risk: TestRisk; why: string } | null {
  const ischaemiaPct = typeof a.ischaemia === "number" ? a.ischaemia : null;
  if (kind === "nuclear") {
    if (["Equivocal", "Non-diagnostic"].includes(a.result)) return { risk: "uncertain", why: `Stress MIBI ${String(a.result).toLowerCase()}` };
    if (a.result === "Normal perfusion") return { risk: "negative", why: "Stress MIBI: normal perfusion" };
    // a fixed defect is infarct scar (unless attenuation): evidence of coronary disease, not a negative test
    if (a.result === "Fixed defect (scar)") return { risk: "positive", why: "Stress MIBI: fixed defect (scar) without ischaemia" };
    if (ischaemiaPct != null && ischaemiaPct >= 10) return { risk: "high", why: `Stress MIBI: ischaemia ${ischaemiaPct}% of the LV (≥10%: high event risk)` };
    return { risk: "positive", why: `Stress MIBI: ${String(a.result).toLowerCase()}${ischaemiaPct != null ? `, ${ischaemiaPct}% of the LV` : a.extent ? `, ${String(a.extent).toLowerCase()} extent (% LV not recorded)` : ""}` };
  }
  if (kind === "stress") {
    const m = String(a.modality ?? "");
    if (["Equivocal", "Non-diagnostic"].includes(a.result)) return { risk: "uncertain", why: `${m}: ${String(a.result).toLowerCase()}` };
    if (a.result === "Negative") return { risk: "negative", why: `${m}: negative` };
    if (m === "PET" && ischaemiaPct != null && ischaemiaPct >= 10) return { risk: "high", why: `PET: ischaemia ${ischaemiaPct}% of the LV (≥10%: high event risk)` };
    if (m === "Stress echo" && typeof a.segmentsEcho === "number" && a.segmentsEcho >= 3) return { risk: "high", why: `Stress echo: ${a.segmentsEcho} of 16 segments with stress-induced hypo/akinesia (≥3: high event risk)` };
    if (m === "Stress CMR" && typeof a.segmentsCmr === "number" && a.segmentsCmr >= 2) return { risk: "high", why: `Stress CMR: ${a.segmentsCmr} of 16 segments with perfusion defects (≥2: high event risk)` };
    if (m === "Exercise ECG" && typeof a.duke === "number" && a.duke < -10) return { risk: "high", why: `Exercise ECG: Duke treadmill score ${a.duke} (<−10: high event risk)` };
    if (a.result === "Positive for ischaemia") return { risk: "positive", why: `${m}: positive for ischaemia` };
    return null;
  }
  if (kind === "ccta") {
    const v: string[] = a.vessels ?? [];
    if (a.cadrads === "N (non-diagnostic)") return { risk: "uncertain", why: "CCTA non-diagnostic" };
    if (v.includes("Left main")) return { risk: "high", why: "CCTA: left main ≥50% stenosis (high event risk)" };
    if (a.cadrads === "4B") return { risk: "high", why: "CCTA: CAD-RADS 4B (left main or three-vessel obstructive disease)" };
    if (a.twoVesselProxLad === "Yes") return { risk: "high", why: "CCTA: two-vessel ≥70% disease including the proximal LAD (high event risk)" };
    if (["3", "4A", "5"].includes(a.cadrads)) return { risk: "positive", why: `CCTA: CAD-RADS ${a.cadrads}${v.length ? ` (${v.join(", ")})` : ""}` };
    if (["0", "1", "2"].includes(a.cadrads)) return { risk: "negative", why: `CCTA: CAD-RADS ${a.cadrads} (no obstructive stenosis)` };
    return null;
  }
  return null;
}

// tests that can rule out obstructive CAD in a patient with suspected IHD: imaging (CCTA, perfusion or stress
// imaging), not a plain exercise ECG
export const ruleOutCapable = (kind: string, a: Record<string, any>) => kind === "ccta" || kind === "nuclear" || (kind === "stress" && a.modality !== "Exercise ECG");
