// Pulmonary hypertension rules (PH module). 2022 ESC/ERS PH guidelines: the echo probability of PH from
// the peak TR velocity (threshold >2.8 m/s, I C) and the additional signs; referral to a PH centre for an
// intermediate or high probability with risk factors for PAH or a history of pulmonary embolism (I C).
import { fmtDay } from "../../shared/clinical.js";
import { formatNumber } from "../../shared/catalog.js";
import { PROBABILITY_LABEL, STRATA_LABEL, fourStrata } from "../../shared/ph.js";
import { daysBetween, localDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
import { latestPhEcho } from "./ph-profile.js";
import { PVR_SEVERE } from "../../shared/wizards-ph.js";

const active = (s: PatientState, code: string) => s.conditions.find((c) => c.code === code && c.status === "active");
const IIP_TYPES = ["IPF", "Other idiopathic interstitial pneumonia"];
const PAH_DRUG_TAGS = ["pde5", "era", "sgc", "prostacyclin"];
const onMeds = (s: PatientState, tags: string[]) => s.meds.filter((m) => m.status === "active" && m.tags.some((t) => tags.includes(t)));
const symptomaticNyha = (v: string | null | undefined) => v === "II" || v === "III" || v === "IV";

const SRC = "ESC/ERS pulmonary hypertension 2022";
const planned = (s: PatientState, re: RegExp) => s.plan.some((p) => p.status === "planned" && re.test(p.title));

export const PH_RULES: RuleDef[] = [
  {
    id: "ph.echo-probability",
    kind: "clinical",
    title: "Intermediate or high echo probability of pulmonary hypertension",
    inputs: ["trv", "studies", "conditions", "plan"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines: echocardiographic probability from the peak TR velocity (>2.8 m/s, I C) and signs in three categories (ventricles, pulmonary artery, IVC/RA): intermediate = TRV ≤2.8 m/s with signs from ≥2 categories or 2.9–3.4 m/s without; high = 2.9–3.4 m/s with signs from ≥2 categories or >3.4 m/s. Referral to a PH centre for intermediate/high probability with risk factors for PAH or a history of pulmonary embolism (I C). Quiet once PH has been characterised by right heart catheterisation or a referral is planned.",
    evaluate(s) {
      const e = latestPhEcho(s);
      if (!e || e.probability === "low") return [];
      const ph = s.conditions.find((c) => c.code === "ph" && c.status === "active");
      if ((ph?.attributes?.haemo && ph.attributes.haemo !== "Not catheterised") || planned(s, /right heart cath|PH centre/i)) return [];
      const high = e.probability === "high";
      return [{
        key: `ph-${e.probability}`, signature: e.id, severity: high ? "orange" : "yellow",
        title: `${PROBABILITY_LABEL[e.probability]} echo probability of pulmonary hypertension${e.trv != null ? ` (TRV ${e.trv} m/s)` : ""}`,
        detail: `${high ? "Pulmonary hypertension is likely" : "Pulmonary hypertension is possible"}: look for left heart and lung disease, and refer to a PH centre for right heart catheterisation with risk factors for PAH or a history of pulmonary embolism (I C).`,
        facts: [
          { label: "Echo", value: fmtDay(e.at, { year: true }) },
          { label: "TR velocity", value: e.trv != null ? `${e.trv} m/s` : "Not measured" },
          { label: "Other signs", value: e.categories.length ? `${e.signs.length} sign${e.signs.length > 1 ? "s" : ""} in ${e.categories.length} categor${e.categories.length > 1 ? "ies" : "y"}` : "None recorded" },
          { label: "Guideline", value: `${SRC} · I C` },
        ],
        missing: [], action: { type: "add-plan", template: "ph-referral" },
      } as Finding];
    },
  },
  {
    id: "ph.pah-risk",
    kind: "clinical",
    title: "PAH: four-strata risk assessment every 3–6 months",
    inputs: ["conditions", "nyha", "6mwd", "nt-probnp", "pathways", "plan"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines: at follow-up, PAH risk by the four-strata model (functional class, 6-minute walk distance, BNP/NT-proBNP); treatment goal low risk; reassessment every 3–6 months. Due when PAH is listed and no PAH risk pathway in the last 6 months (the outer limit); orange when the record-based category is intermediate-high or high.",
    evaluate(s) {
      const ph = s.conditions.find((c) => c.code === "ph" && c.status === "active" && c.attributes?.group === "Group 1 · PAH");
      if (!ph) return [];
      const done = s.pathwaysDone["pah-followup"];
      if ((done && daysBetween(localDay(done), s.today) <= 182) || planned(s, /PAH: risk/i)) return [];
      const r = fourStrata({ fc: s.resolved("nyha").current?.value_text ?? null, sixmwd: s.resolved("6mwd").current?.value_num ?? null, ntprobnp: s.resolved("nt-probnp").current?.value_num ?? null });
      const bad = r.category === "intermediate-high" || r.category === "high";
      return [{
        key: "pah-risk", signature: `${done ?? "never"}:${r.category ?? "-"}`, severity: bad ? "orange" : "yellow",
        title: r.category ? `PAH: ${STRATA_LABEL[r.category].toLowerCase()} risk on the latest values — review therapy (goal: low risk)` : "PAH: four-strata risk assessment due",
        detail: r.category ? `Four-strata mean ${r.mean} (${r.items.map((i) => `${i.label === "NT-proBNP" ? i.label : i.label.toLowerCase()} ${i.value}`).join(", ")}). Reassess every 3–6 months; escalate therapy until low risk.` : "Functional class, 6-minute walk and NT-proBNP every 3–6 months; goal low risk.",
        facts: [{ label: "Last assessment", value: done ? fmtDay(done, { year: true }) : "None" }, { label: "Guideline", value: SRC }],
        missing: r.missing, action: { type: "wizard", wizard: "pah-followup" },
      } as Finding];
    },
  },
  // ---------- slice 4: CTEPH after pulmonary embolism; PH with left heart or lung disease ----------
  {
    id: "ph.after-pe",
    kind: "clinical",
    title: "Breathlessness after pulmonary embolism: evaluate for CTEPH / CTEPD",
    inputs: ["conditions", "nyha", "studies", "pathways", "plan"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines: in patients with persistent or new-onset dyspnoea or exercise limitation following PE, further diagnostic evaluation to assess for CTEPH/CTEPD is recommended (I C); symptomatic patients with mismatched perfusion defects beyond 3 months of anticoagulation are referred to a PH/CTEPH centre (I C). Fires from 3 months after a listed PE when NYHA class II–IV or an intermediate/high echo probability of PH is recorded after it; quiet once CTEPH is listed, the post-PE pathway was completed in the last year, or a CTEPH work-up or referral is planned.",
    evaluate(s) {
      const pe = active(s, "pe");
      const at = pe?.onset ? String(pe.onset).slice(0, 10) : null;
      if (!at || daysBetween(at, s.today) < 91) return [];
      if (active(s, "ph")?.attributes?.group === "Group 4 · CTEPH / PA obstruction") return [];
      const done = s.pathwaysDone["post-pe"];
      if ((done && daysBetween(localDay(done), s.today) <= 365) || planned(s, /CTEPH|CTEPD/i)) return [];
      const ny = s.resolved("nyha").current;
      const nyha = ny && localDay(ny.effective_at) >= at && symptomaticNyha(ny.value_text) ? ny.value_text : null;
      const e = latestPhEcho(s);
      const echo = e && localDay(e.at) >= at && e.probability !== "low" ? e : null;
      if (!nyha && !echo) return [];
      return [{
        key: "after-pe", signature: `${pe!.id}:${nyha ?? "-"}:${echo?.id ?? "-"}`, severity: echo ? "orange" : "yellow",
        title: "Breathlessness after pulmonary embolism: evaluate for CTEPH / CTEPD",
        detail: `${[nyha && `NYHA ${nyha}`, echo && `${PROBABILITY_LABEL[echo.probability].toLowerCase()} echo probability of PH`].filter(Boolean).join(" and ")} more than 3 months after the embolism. Echo, NT-proBNP and a V/Q scan (I C); mismatched perfusion defects beyond 3 months of anticoagulation → PH / CTEPH centre (I C).`,
        facts: [
          { label: "Pulmonary embolism", value: fmtDay(at, { year: true }) },
          ...(nyha ? [{ label: "NYHA", value: nyha }] : []),
          ...(echo ? [{ label: "Echo probability", value: `${PROBABILITY_LABEL[echo.probability]} · ${fmtDay(echo.at, { year: true })}` }] : []),
          { label: "Guideline", value: `${SRC} · I C` },
        ],
        missing: [], action: { type: "wizard", wizard: "post-pe" },
      } as Finding];
    },
  },
  {
    id: "ph.cteph-anticoagulation",
    kind: "clinical",
    title: "CTEPH: lifelong therapeutic anticoagulation (VKA with antiphospholipid syndrome)",
    inputs: ["conditions", "meds"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines, recommendation table 24: lifelong therapeutic doses of anticoagulation are recommended in all patients with CTEPH (class I); in CTEPH with antiphospholipid syndrome, anticoagulation with VKAs is recommended (class I). Fires when PH group 4 is listed with no active oral or parenteral anticoagulant, or with antiphospholipid syndrome listed and a DOAC.",
    evaluate(s) {
      const ph = active(s, "ph");
      if (ph?.attributes?.group !== "Group 4 · CTEPH / PA obstruction") return [];
      const oac = onMeds(s, ["oac", "oac-parenteral"]);
      const doac = oac.filter((m) => m.tags.includes("doac"));
      if (!oac.length) return [{
        key: "cteph-no-oac", signature: ph.id, severity: "orange",
        title: "CTEPH without anticoagulation: lifelong therapeutic anticoagulation is recommended",
        detail: "Lifelong therapeutic anticoagulation in all patients with CTEPH (class I); a VKA with antiphospholipid syndrome (class I). Record the anticoagulant, or the reason it is not given.",
        facts: [{ label: "Anticoagulant", value: "None active" }, { label: "Guideline", value: `${SRC} · class I` }],
        missing: [], action: { type: "wizard", wizard: "post-pe" },
      } as Finding];
      if (active(s, "aps") && doac.length) return [{
        key: "cteph-aps-doac", signature: `${ph.id}:${doac.map((m) => m.id).join(",")}`, severity: "orange",
        title: "CTEPH with antiphospholipid syndrome on a DOAC: a VKA is recommended",
        detail: `${doac.map((m) => m.name).join(", ")} with antiphospholipid syndrome: in CTEPH with APS, anticoagulation with a VKA is recommended (class I). Plan the switch with the CTEPH team.`,
        facts: [{ label: "Anticoagulant", value: doac.map((m) => m.name).join(", ") }, { label: "Guideline", value: `${SRC} · class I` }],
        missing: [], action: { type: "wizard", wizard: "post-pe" },
      } as Finding];
      return [];
    },
  },
  {
    id: "ph.cteph-team",
    kind: "clinical",
    title: "CTEPH: CTEPH team review for multimodality management",
    inputs: ["conditions", "pathways", "plan"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines, recommendation table 24: all patients with CTEPH are reviewed by a CTEPH team for multimodality management (class I) — PEA for surgically accessible obstructions (I), BPA when inoperable or with residual PH (I B), riociguat for symptomatic inoperable or persistent/recurrent PH after PEA (I B); long-term follow-up (I). Due when CTEPH is listed and the post-PE pathway has never been completed and no CTEPH team review is planned.",
    evaluate(s) {
      const ph = active(s, "ph");
      if (ph?.attributes?.group !== "Group 4 · CTEPH / PA obstruction" || s.pathwaysDone["post-pe"] || planned(s, /CTEPH team|CTEPH centre/i)) return [];
      return [{
        key: "cteph-team", signature: ph.id, severity: "yellow",
        title: "CTEPH: CTEPH team review (PEA, BPA, riociguat)",
        detail: "All patients with CTEPH are reviewed by a CTEPH team for multimodality management (class I); test for antiphospholipid syndrome (class I).",
        facts: [{ label: "Guideline", value: `${SRC} · class I` }],
        missing: [], action: { type: "add-plan", template: "cteph-team" },
      } as Finding];
    },
  },
  {
    id: "ph.severe-precapillary",
    kind: "clinical",
    title: "PH with left heart or lung disease and PVR >5 WU: PH centre",
    inputs: ["conditions", "pvr", "plan"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines: in left heart disease, a severe pre-capillary component and/or RV dysfunction → referral to a PH centre for a complete diagnostic work-up (I); combined post- and pre-capillary PH with a severe pre-capillary component (e.g. PVR >5 WU) → individualised approach (I). In lung disease, severe PH (PVR >5 WU) or uncertainty → PH centre (I), individualised approach (I). Fires when PH group 2 or 3 is listed and the latest PVR is >5 WU, with no PH centre referral planned.",
    evaluate(s) {
      const ph = active(s, "ph");
      const g = String(ph?.attributes?.group ?? "");
      if (!ph || !(g.startsWith("Group 2") || g.startsWith("Group 3"))) return [];
      const pvr = s.resolved("pvr").current;
      if (pvr?.value_num == null || pvr.value_num <= PVR_SEVERE || planned(s, /PH centre/i)) return [];
      const lhd = g.startsWith("Group 2");
      return [{
        key: "ph-severe", signature: pvr.id, severity: "orange",
        title: `PH with ${lhd ? "left heart" : "lung"} disease and PVR ${formatNumber(pvr.value_num, 1)} WU: refer to a PH centre`,
        detail: lhd
          ? "Severe pre-capillary component (PVR >5 WU): refer to a PH centre for a complete work-up and an individualised approach (I)."
          : "Severe PH with lung disease (PVR >5 WU): refer to a PH centre for an individualised approach (I); consider lung transplant evaluation if eligible (I).",
        facts: [{ label: "PVR", value: `${formatNumber(pvr.value_num, 1)} WU · ${fmtDay(pvr.effective_at, { year: true })}` }, { label: "Clinical group", value: g }, { label: "Guideline", value: `${SRC} · class I` }],
        missing: [], action: { type: "wizard", wizard: "ph-lhd-lung" },
      } as Finding];
    },
  },
  {
    id: "ph.pah-drug-group-2-3",
    kind: "clinical",
    title: "PAH drug in PH from left heart or lung disease",
    inputs: ["conditions", "meds", "pvr"],
    defaultParams: {},
    evidence: "2022 ESC/ERS PH guidelines, recommendation table 23: ambrisentan is not recommended in PH associated with IPF (III); riociguat is not recommended in PH associated with idiopathic interstitial pneumonia (III). Drugs approved for PAH are not recommended in PH-LHD, and PH drugs not in non-severe PH with lung disease (as summarised in the Rev Esp Cardiol 2023 comments on the guideline; class to confirm). Orange for the class III rows; yellow for the others.",
    evaluate(s) {
      const ph = active(s, "ph");
      const g = String(ph?.attributes?.group ?? "");
      if (!ph || !(g.startsWith("Group 2") || g.startsWith("Group 3"))) return [];
      const drugs = onMeds(s, PAH_DRUG_TAGS);
      if (!drugs.length) return [];
      const ild = String(active(s, "ild")?.attributes?.type ?? "");
      const out: Finding[] = [];
      const fact = (m: { name: string }[]) => ({ label: "Medicine", value: m.map((x) => x.name).join(", ") });
      if (g.startsWith("Group 3")) {
        const amb = drugs.filter((m) => m.code === "ambrisentan");
        const rio = drugs.filter((m) => m.code === "riociguat");
        if (ild === "IPF" && amb.length) out.push({
          key: "ambrisentan-ipf", signature: amb.map((m) => m.id).join(","), severity: "orange",
          title: "Ambrisentan in PH with idiopathic pulmonary fibrosis: not recommended",
          detail: "Ambrisentan is not recommended in patients with PH associated with IPF (III). Review with the PH centre.",
          facts: [fact(amb), { label: "Guideline", value: `${SRC} · III` }], missing: [], action: { type: "tab", tab: "medications" },
        } as Finding);
        if (IIP_TYPES.includes(ild) && rio.length) out.push({
          key: "riociguat-iip", signature: rio.map((m) => m.id).join(","), severity: "orange",
          title: "Riociguat in PH with idiopathic interstitial pneumonia: not recommended",
          detail: "Riociguat is not recommended in patients with PH associated with an idiopathic interstitial pneumonia (III). Review with the PH centre.",
          facts: [fact(rio), { label: "Guideline", value: `${SRC} · III` }], missing: [], action: { type: "tab", tab: "medications" },
        } as Finding);
        const pvr = s.resolved("pvr").current?.value_num;
        if (!out.length && pvr != null && pvr <= PVR_SEVERE) out.push({
          key: "pah-drug-nonsevere-lung", signature: drugs.map((m) => m.id).join(","), severity: "yellow",
          title: "PH drug in non-severe PH with lung disease",
          detail: `PVR ${formatNumber(pvr, 1)} WU (not >5): PH drugs are not recommended in non-severe PH with lung disease (class to confirm). Review the indication with the PH centre.`,
          facts: [fact(drugs), { label: "Guideline", value: `${SRC} (Rev Esp Cardiol comments)` }], missing: [], action: { type: "tab", tab: "medications" },
        } as Finding);
      } else out.push({
        key: "pah-drug-lhd", signature: drugs.map((m) => m.id).join(","), severity: "yellow",
        title: "PAH drug in PH from left heart disease",
        detail: "Drugs approved for PAH are not recommended in PH from left heart disease (class to confirm). Check the indication (a PH centre may treat combined post- and pre-capillary PH individually).",
        facts: [fact(drugs), { label: "Haemodynamics", value: String(ph.attributes?.haemo ?? "Not recorded") }, { label: "Guideline", value: `${SRC} (Rev Esp Cardiol comments)` }], missing: [], action: { type: "tab", tab: "medications" },
      } as Finding);
      return out;
    },
  },
];
