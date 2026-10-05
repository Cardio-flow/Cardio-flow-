// Medicine safety rules (medication coverage, slice 1). Two rules read the shared table in
// ./med-safety.ts (combinations of two medicines; a medicine with a condition in the record), so every
// module's medicines are checked in one place. A third rule carries the ESC AF 2024 class III B rows on
// antiplatelet therapy added to oral anticoagulation.
import { addDays, fmtDay, localDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
import { safetyHits, type SafetyRow } from "./med-safety.js";
import { daptIndication } from "./valve-rules.js";

const tableRule = (id: string, kind: SafetyRow["kind"], title: string, evidence: string): RuleDef => ({
  id, kind: "clinical", title, inputs: ["meds", "conditions", "creatinine", "egfr", "weight", "lvef", "hr", "nyha"], defaultParams: {}, evidence,
  evaluate(s) {
    return safetyHits(s, kind).map(({ row, hit }) => ({
      key: `${row.id}:${hit.meds.map((m) => m.code).join("+")}`,
      signature: `${hit.meds.map((m) => m.id).sort().join(",")}:${hit.reason}`,
      severity: hit.severity ?? row.severity,
      title: row.title(hit),
      detail: hit.reason ? `${hit.reason}. ${row.detail}`.replace(/\.\. /, ". ") : row.detail,
      facts: [
        { label: "Medicines", value: hit.meds.map((m) => m.name).join(", ") },
        { label: "Source", value: row.source },
      ],
      missing: [], action: { type: "tab", tab: "medications" },
    }) as Finding);
  },
});

export const MED_RULES: RuleDef[] = [
  tableRule("med.interaction", "interaction", "Medicine combination contraindicated or not recommended",
    "Medicine safety table (server/engine/med-safety.ts), combinations of two current medicines, each row quoting its product label (EU/UK SmPC section) or guideline: PDE5 inhibitor + nitrate, riociguat + PDE5 inhibitor or nitrate, ivabradine + verapamil/diltiazem or a strong CYP3A4 inhibitor, ticagrelor / simvastatin / dronedarone / eplerenone / finerenone + a strong CYP3A4 inhibitor, dronedarone + dabigatran, sacubitril/valsartan + ACE inhibitor, two potassium-sparing medicines, eplerenone + ACEi + ARB, colchicine + P-gp/CYP3A4 inhibitor with renal or hepatic impairment (all section 4.3 contraindications: red); ACEi + ARB (4.4 not recommended) and DOAC + rifampicin (avoid: orange; caution: yellow); clopidogrel + omeprazole/esomeprazole (discouraged: yellow)."),
  tableRule("med.contraindication", "condition", "Medicine contraindicated or not recommended with a condition in the record",
    "Medicine safety table (server/engine/med-safety.ts), a current medicine with a condition or value in the record, each row quoting its product label section: dronedarone with heart failure / LV systolic dysfunction or permanent AF; dabigatran and dronedarone CrCl <30, sotalol CrCl <10; eplerenone and colchicine eGFR <30; flecainide with heart failure; propafenone with MI within 3 months or heart failure with LVEF <35%; diltiazem with heart rate <50 (all section 4.3: red); apixaban/rivaroxaban/edoxaban CrCl <15 or dialysis and DOACs with antiphospholipid syndrome (not recommended: orange); flecainide after MI or with severe valve disease, verapamil/diltiazem with LVEF ≤40%, ibuprofen with heart failure (orange; red at NYHA IV). CrCl by Cockcroft–Gault from creatinine within 180 days and weight within 365 days."),
  {
    id: "med.oac-antiplatelet",
    kind: "clinical",
    title: "AF on anticoagulation with an antiplatelet and no PCI or ACS in the last 12 months",
    inputs: ["meds", "conditions", "procedures"],
    defaultParams: {},
    evidence: "2024 ESC AF guidelines: adding antiplatelet treatment to oral anticoagulation is not recommended in AF patients for the goal of preventing ischaemic stroke or thromboembolism (III B), nor to prevent recurrent embolic stroke (III B); antiplatelet therapy beyond 12 months is not recommended in stable patients with chronic coronary or vascular disease treated with oral anticoagulation (III B). Fires with AF or flutter listed, an oral anticoagulant and an antiplatelet, no PCI or ACS in the last 12 months (procedure record or dated diagnosis), no PCI/CABG diagnosis dated in the last 12 months, and no mechanical valve.",
    evaluate(s) {
      if (!s.tags.has("af") || s.tags.has("mechanical-valve")) return [];
      const meds = s.meds.filter((m) => m.status === "active");
      const oac = meds.filter((m) => m.tags.includes("oac"));
      const ap = meds.filter((m) => m.tags.includes("antiplatelet"));
      if (!oac.length || !ap.length || daptIndication(s)) return [];
      const since = addDays(s.today, -365);
      const recentRevasc = s.conditions.find((c) => (c.code === "prior-pci" || c.code === "prior-cabg") && c.status === "active" && c.onset && localDay(c.onset) >= since);
      if (recentRevasc) return [];
      const cabg = s.procedures.find((p) => p.kind === "cabg" && localDay(p.performed_at) >= since);
      if (cabg) return [];
      const cad = s.tags.has("cad") || s.tags.has("vascular") || s.tags.has("ascvd");
      return [{
        key: "oac-antiplatelet", signature: [...oac, ...ap].map((m) => m.id).sort().join(","), severity: "yellow",
        title: `AF on ${oac.map((m) => m.name).join(", ")} with ${ap.map((m) => m.name).join(", ")}: review the antiplatelet`,
        detail: cad
          ? "No PCI or ACS in the last 12 months: antiplatelet therapy beyond 12 months is not recommended in stable coronary or vascular disease treated with oral anticoagulation (III B). Anticoagulation alone, unless another indication is recorded."
          : "Adding an antiplatelet to oral anticoagulation is not recommended in AF to prevent stroke or thromboembolism (III B). Record the indication or review.",
        facts: [
          { label: "Anticoagulant", value: oac.map((m) => m.name).join(", ") },
          { label: "Antiplatelet", value: ap.map((m) => `${m.name}${m.startedAt ? ` since ${fmtDay(m.startedAt, { year: true })}` : ""}`).join(", ") },
          { label: "Guideline", value: "ESC AF 2024 · III B" },
        ],
        missing: [], action: { type: "tab", tab: "medications" },
      } as Finding];
    },
  },
];
