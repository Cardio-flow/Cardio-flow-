// Medicine safety table (medication coverage, slice 1): contraindicated or not-recommended combinations of
// two medicines, and of a medicine with a condition in the record. One table read by two rules, so every
// module's medicines are checked in one place. Every row quotes its source:
//  - product labelling (EU/UK SmPC, section given): red only for a section 4.3 contraindication; orange for
//    "not recommended" / "should be avoided"; yellow for "with caution" / "discouraged";
//  - ESC guidelines with class and level where the row comes from a recommendation table.
// No locally chosen numbers: every threshold below is the label's or the guideline's own (CrCl <30 / <15,
// heart rate <50, LVEF <35% for propafenone, MI within 3 months, NYHA IV for ibuprofen). Where the label
// names a state without a number ("heart failure", "renal impairment") the record's own diagnosis is used,
// or the guideline definition: LVEF ≤40% = reduced ejection fraction (ESC HF), eGFR <60 = CKD (KDIGO), eGFR
// <30 = severe renal impairment (KDIGO G4–G5).
import { DIAGNOSIS, MEASURES, formatNumber } from "../../shared/catalog.js";
import { poorOrUnknown } from "../../shared/mavacamten.js";
import { cockcroftGault, daysBetween, fmtDay, localDay } from "../../shared/clinical.js";
import type { MedState, PatientState } from "../kernel/state.js";

export type Severity = "red" | "orange" | "yellow";
export type SafetyHit = { meds: MedState[]; reason: string; severity?: Severity };
export type SafetyRow = {
  id: string;
  // prestart: checked only for a proposed medicine in the drawer (the label's "do not initiate" values)
  kind: "interaction" | "condition" | "prestart";
  severity: Severity;
  title: (h: SafetyHit) => string;
  detail: string;
  source: string;
  check: (s: PatientState, f: Facts) => SafetyHit[];
};

// what the rows read, computed once per patient
export type Facts = ReturnType<typeof facts>;
export function facts(s: PatientState) {
  const meds = s.meds.filter((m) => m.status === "active");
  const recent = (code: string, days: number) => {
    const o = s.resolved(code).current;
    return o?.value_num != null && daysBetween(localDay(o.effective_at), s.today) <= days ? o.value_num : null;
  };
  const cr = recent("creatinine", 180), wt = recent("weight", 365);
  const conds = s.conditions.filter((c) => c.status === "active");
  const tags = new Set(conds.flatMap((c) => DIAGNOSIS[c.code]?.tags ?? []));
  const lvef = recent("lvef", 3650);
  return {
    meds,
    crcl: cr != null && wt != null ? cockcroftGault(cr, s.patient.age, wt, s.patient.sex) : null,
    egfr: recent("egfr", 365),
    lvef, hr: recent("hr", 30),
    nyha: (s.resolved("nyha").current?.value_text as string | undefined) ?? null,
    hf: tags.has("hf") || (lvef != null && lvef <= 40),
    hfLabel: tags.has("hf") ? conds.filter((c) => DIAGNOSIS[c.code]?.tags.includes("hf")).map((c) => DIAGNOSIS[c.code].display).join(", ") : lvef != null && lvef <= 40 ? `LVEF ${lvef}%` : "",
    hfref: conds.some((c) => c.code === "hfref"),
    ckd: tags.has("ckd"), dialysis: tags.has("dialysis"),
    dm: tags.has("dm"),
    aps: conds.some((c) => c.code === "aps"),
    liver: conds.some((c) => c.code === "liver-disease"),
    permanentAf: conds.some((c) => c.code === "af" && c.attributes?.pattern === "Permanent"),
    priorMi: conds.some((c) => c.code === "prior-mi" || c.code === "acs-stemi" || c.code === "acs-nstemi"),
    // MI within the last 3 months: an ACS / MI diagnosis with an onset in the last 91 days
    recentMi: conds.find((c) => ["prior-mi", "acs-stemi", "acs-nstemi"].includes(c.code) && c.onset && daysBetween(String(c.onset).slice(0, 10), s.today) <= 91) ?? null,
    severeValve: conds.filter((c) => ["as", "ar", "mr-primary", "mr-secondary", "ms", "tr"].includes(c.code) && c.attributes?.severity === "Severe").map((c) => DIAGNOSIS[c.code].display),
    tags,
    // CYP2C19 result on the HCM diagnosis (mavacamten dosing and interactions)
    cyp2c19: (conds.find((c) => c.code === "hcm")?.attributes?.cyp2c19 as string | undefined) ?? null,
    // ALT upper limit of normal: the laboratory reference range in the catalogue
    altUln: MEASURES.alt.ref?.high ?? null,
    // latest values for start limits (within 60 days, as the HF start gates), heart rate within 30 days
    k60: recent("potassium", 60), alt60: recent("alt", 60),
    // results recorded after a medicine was started, newest first
    after: (code: string, since: string | null) => s.observations.filter((o) => o.code === code && o.status !== "entered_in_error" && o.value_num != null && (!since || o.effective_at > since)).sort((a, b) => b.effective_at.localeCompare(a.effective_at)),
    before: (code: string, at: string | null) => (at ? s.observations.filter((o) => o.code === code && o.status !== "entered_in_error" && o.value_num != null && o.effective_at <= at).sort((a, b) => b.effective_at.localeCompare(a.effective_at))[0] ?? null : null),
    lvefAfter: (since: string | null) => s.observations.filter((o) => o.code === "lvef" && o.status !== "entered_in_error" && o.value_num != null && (!since || o.effective_at > since)).sort((a, b) => b.effective_at.localeCompare(a.effective_at)),
  };
}
const startOf = (m: MedState) => [...m.events].reverse().find((e) => e.kind === "start" || e.kind === "restart")?.effective_at ?? m.startedAt ?? null;
const omeprazoleDaily = (m: MedState) => (m.doseValue ?? 0) * (({ OD: 1, BID: 2, TID: 3 } as Record<string, number>)[m.frequency ?? "OD"] ?? 1);

const has = (m: MedState, x: string[]) => x.includes(m.code) || m.tags.some((t) => x.includes(t));
const pick = (f: Facts, x: string[]) => f.meds.filter((m) => has(m, x));
const names = (ms: MedState[]) => ms.map((m) => m.name).join(" + ");
// a drug–drug pair: every medicine of group A with every medicine of group B (one hit per row)
const pair = (a: string[], b: string[], reason = "") => (_s: PatientState, f: Facts): SafetyHit[] => {
  const A = pick(f, a), B = pick(f, b).filter((m) => !A.includes(m));
  return A.length && B.length ? [{ meds: [...A, ...B], reason }] : [];
};
const ROUND = (x: number) => formatNumber(x, 0);
// "Simvastatin with Clarithromycin (strong CYP3A4 inhibitor): contraindicated" — the first medicine of the pair, then its partners
const withPartner = (what: string, verdict = "contraindicated") => (h: SafetyHit) => `${h.meds[0].name} with ${h.meds.slice(1).map((m) => m.name).join(", ")}${what ? ` (${what})` : ""}: ${verdict}`;

const STRONG_3A4 = ["cyp3a4-inhibitor"]; // catalogue: clarithromycin
const DOACS_15 = ["apixaban", "rivaroxaban", "edoxaban"];

export const SAFETY_ROWS: SafetyRow[] = [
  // ---------- two medicines ----------
  {
    id: "pde5-nitrate", kind: "interaction", severity: "red",
    title: withPartner(""),
    detail: "Nitrates or nitric oxide donors with sildenafil or tadalafil: risk of severe hypotension. Stop one of them.",
    source: "SmPC sildenafil (Revatio) 4.3; tadalafil 4.3 (organic nitrates)",
    check: pair(["pde5"], ["nitrate"]),
  },
  {
    id: "riociguat-pde5", kind: "interaction", severity: "red",
    title: withPartner(""),
    detail: "Co-administration of riociguat with PDE5 inhibitors is contraindicated (symptomatic hypotension). The PH centre switches, never combines.",
    source: "SmPC riociguat (Adempas) 4.3; sildenafil 4.3/4.5",
    check: pair(["sgc"], ["pde5"]),
  },
  {
    id: "riociguat-nitrate", kind: "interaction", severity: "red",
    title: withPartner(""),
    detail: "Riociguat with nitrates or nitric oxide donors in any form is contraindicated.",
    source: "SmPC riociguat (Adempas) 4.3",
    check: pair(["sgc"], ["nitrate"]),
  },
  {
    id: "ivabradine-ndhp", kind: "interaction", severity: "red",
    title: withPartner(""),
    detail: "Verapamil and diltiazem are moderate CYP3A4 inhibitors that also slow the heart rate.",
    source: "SmPC ivabradine (Procoralan) 4.3; verapamil and diltiazem 4.3",
    check: pair(["ivabradine"], ["ndhp-ccb"]),
  },
  {
    id: "ivabradine-3a4", kind: "interaction", severity: "red",
    title: withPartner("strong CYP3A4 inhibitor"),
    detail: "Strong CYP3A4 inhibitors (e.g. clarithromycin) raise ivabradine exposure. Hold ivabradine or choose another antibiotic.",
    source: "SmPC ivabradine (Procoralan) 4.3",
    check: pair(["ivabradine"], STRONG_3A4),
  },
  {
    id: "ticagrelor-3a4", kind: "interaction", severity: "red",
    title: withPartner("strong CYP3A4 inhibitor"),
    detail: "Strong CYP3A4 inhibitors (e.g. clarithromycin) substantially increase ticagrelor exposure. Choose another antibiotic, or discuss the P2Y12 inhibitor.",
    source: "SmPC ticagrelor (Brilique) 4.3",
    check: pair(["ticagrelor"], STRONG_3A4),
  },
  {
    id: "simvastatin-3a4", kind: "interaction", severity: "red",
    title: withPartner("strong CYP3A4 inhibitor"),
    detail: "Potent CYP3A4 inhibitors (e.g. clarithromycin) with simvastatin are contraindicated (myopathy). Hold simvastatin during the course or choose another antibiotic.",
    source: "SmPC simvastatin (Zocor) 4.3",
    check: pair(["simvastatin"], STRONG_3A4),
  },
  {
    id: "dronedarone-3a4", kind: "interaction", severity: "red",
    title: withPartner("strong CYP3A4 inhibitor"),
    detail: "Potent CYP3A4 inhibitors (including clarithromycin) with dronedarone are contraindicated.",
    source: "SmPC dronedarone (Multaq) 4.3",
    check: pair(["dronedarone"], STRONG_3A4),
  },
  {
    id: "dronedarone-dabigatran", kind: "interaction", severity: "red",
    title: () => "Dronedarone with dabigatran: contraindicated",
    detail: "Co-administration with dabigatran is contraindicated.",
    source: "SmPC dronedarone (Multaq) 4.3",
    check: pair(["dronedarone"], ["dabigatran"]),
  },
  {
    id: "mra-3a4", kind: "interaction", severity: "red",
    title: withPartner("strong CYP3A4 inhibitor"),
    detail: "Eplerenone and finerenone are contraindicated with strong CYP3A4 inhibitors (e.g. clarithromycin): hyperkalaemia risk. Hold the MRA during the course or choose another antibiotic.",
    source: "SmPC eplerenone (Inspra) 4.3; finerenone (Kerendia) 4.3",
    check: pair(["eplerenone", "finerenone"], STRONG_3A4),
  },
  {
    id: "arni-acei", kind: "interaction", severity: "red",
    title: () => "Sacubitril/valsartan with an ACE inhibitor: contraindicated",
    detail: "Concomitant use with ACE inhibitors is contraindicated (angioedema). Sacubitril/valsartan must not be given until 36 hours after the last ACE-inhibitor dose.",
    source: "SmPC sacubitril/valsartan (Entresto) 4.3; ESC HF 2021 (36-hour washout)",
    check: pair(["arni"], ["acei"]),
  },
  {
    id: "mra-k-sparing", kind: "interaction", severity: "red",
    title: () => "Two potassium-sparing medicines: contraindicated",
    detail: "Spironolactone with eplerenone or another potassium-sparing diuretic, or eplerenone with a potassium-sparing diuretic, is contraindicated (hyperkalaemia).",
    source: "SmPC spironolactone (Aldactone) 4.3; eplerenone (Inspra) 4.3",
    check: (_s, f) => {
      const mra = pick(f, ["spironolactone", "eplerenone"]);
      // finerenone is a non-steroidal MRA, not a potassium-sparing diuretic: not part of this label row
      const all = [...new Set([...mra, ...pick(f, ["potassium-sparing"]).filter((m) => m.code !== "finerenone")])];
      return mra.length && all.length > 1 ? [{ meds: all, reason: "" }] : [];
    },
  },
  {
    id: "eplerenone-acei-arb", kind: "interaction", severity: "red",
    title: () => "Eplerenone with an ACE inhibitor and an ARB: contraindicated",
    detail: "The combination of an ACE inhibitor and an ARB with eplerenone is contraindicated.",
    source: "SmPC eplerenone (Inspra) 4.3",
    check: (_s, f) => {
      const e = pick(f, ["eplerenone"]), a = pick(f, ["acei"]), b = pick(f, ["arb", "arni"]);
      return e.length && a.length && b.length ? [{ meds: [...e, ...a, ...b], reason: "" }] : [];
    },
  },
  {
    id: "dual-ras", kind: "interaction", severity: "orange",
    title: () => "Dual RAS blockade: ACE inhibitor with an ARB",
    detail: "Dual blockade of the renin–angiotensin system with an ACE inhibitor and an ARB is not recommended; if considered absolutely necessary, only under specialist supervision with close monitoring of renal function, electrolytes and BP. Not to be used together in diabetic nephropathy.",
    source: "SmPC ramipril and candesartan 4.4 (dual blockade of the RAAS)",
    check: (s, f) => {
      const a = pick(f, ["acei"]).filter((m) => !m.tags.includes("arni")), b = pick(f, ["arb"]).filter((m) => !m.tags.includes("arni") && !a.includes(m));
      return a.length && b.length ? [{ meds: [...a, ...b], reason: f.dm && f.ckd ? "Diabetes with CKD: the label says not to use them together in diabetic nephropathy." : "" }] : [];
    },
  },
  {
    id: "colchicine-3a4-renal-hepatic", kind: "interaction", severity: "red",
    title: () => "Colchicine with a P-gp or strong CYP3A4 inhibitor and renal or hepatic impairment: contraindicated",
    detail: "Colchicine is contraindicated in renal or hepatic impairment with a P-glycoprotein inhibitor (e.g. verapamil) or a strong CYP3A4 inhibitor (e.g. clarithromycin): colchicine toxicity.",
    source: "SmPC colchicine 500 microgram 4.3/4.5",
    check: (_s, f) => {
      const c = pick(f, ["colchicine"]), inh = pick(f, [...STRONG_3A4, "verapamil"]);
      const organ = [f.ckd || (f.egfr != null && f.egfr < 60) ? `renal impairment${f.egfr != null ? ` (eGFR ${ROUND(f.egfr)})` : ""}` : null, f.liver ? "chronic liver disease" : null].filter(Boolean);
      return c.length && inh.length && organ.length ? [{ meds: [...c, ...inh], reason: `With ${organ.join(" and ")}.` }] : [];
    },
  },
  {
    id: "clopidogrel-ppi", kind: "interaction", severity: "yellow",
    title: withPartner("", "discouraged"),
    detail: "Omeprazole and esomeprazole inhibit CYP2C19 and reduce clopidogrel activation; concomitant use should be discouraged. Pantoprazole is the usual alternative.",
    source: "SmPC clopidogrel (Plavix) 4.4/4.5",
    check: pair(["clopidogrel"], ["omeprazole", "esomeprazole"]),
  },
  {
    id: "doac-inducer", kind: "interaction", severity: "orange",
    title: withPartner("strong inducer", "lower anticoagulant effect"),
    detail: "Strong CYP3A4/P-gp inducers lower DOAC levels (loss of protection from thrombosis).",
    source: "SmPC dabigatran 4.4 (avoid); rivaroxaban 4.5 (avoid unless closely observed); apixaban 4.4 (caution in AF, not for treating DVT/PE); edoxaban 4.5 (caution)",
    check: (_s, f) => {
      const ind = pick(f, ["strong-inducer"]);
      if (!ind.length) return [];
      return pick(f, ["doac"]).map((d) => ({
        meds: [d, ...ind],
        severity: (d.code === "dabigatran" || d.code === "rivaroxaban" ? "orange" : "yellow") as Severity,
        reason: d.code === "dabigatran" ? "The label says the combination should be avoided."
          : d.code === "rivaroxaban" ? "The label says to avoid it unless the patient is closely observed for thrombosis."
          : d.code === "apixaban" ? "The label says use with caution for AF and for preventing recurrent VTE, and not at all for treating an acute DVT/PE."
          : "The label says use with caution.",
      }));
    },
  },

  // ---------- mavacamten: interactions by CYP2C19 phenotype (SmPC Camzyos 4.3, 4.5 Table 2) ----------
  {
    id: "mavacamten-3a4-pm", kind: "interaction", severity: "red",
    title: withPartner("strong CYP3A4 inhibitor, CYP2C19 poor or undetermined"),
    detail: "Mavacamten is contraindicated with strong CYP3A4 inhibitors (e.g. clarithromycin) in CYP2C19 poor metabolisers and when the phenotype is undetermined.",
    source: "SmPC mavacamten (Camzyos) 4.3",
    check: (_s, f) => (poorOrUnknown(f.cyp2c19) ? pair(["mavacamten"], STRONG_3A4, f.cyp2c19 && f.cyp2c19 !== "Not tested" ? "CYP2C19 poor metaboliser" : "CYP2C19 phenotype not determined")(_s, f) : []),
  },
  {
    id: "mavacamten-3a4", kind: "interaction", severity: "yellow",
    title: withPartner("strong CYP3A4 inhibitor", "monitor LVEF"),
    detail: "With a strong CYP3A4 inhibitor in CYP2C19 intermediate, normal, rapid or ultra-rapid metabolisers: no dose adjustment; monitor LVEF 4 weeks later.",
    source: "SmPC mavacamten (Camzyos) 4.5, Table 2",
    check: (_s, f) => (!poorOrUnknown(f.cyp2c19) ? pair(["mavacamten"], STRONG_3A4, `CYP2C19 ${f.cyp2c19!.toLowerCase()}`)(_s, f) : []),
  },
  {
    id: "mavacamten-mod-3a4-pm", kind: "interaction", severity: "orange",
    title: withPartner("moderate CYP3A4 inhibitor, CYP2C19 poor or undetermined", "reduce the mavacamten dose"),
    detail: "Verapamil and diltiazem are moderate CYP3A4 inhibitors. In CYP2C19 poor metabolisers (and until the phenotype is known) on 5 mg mavacamten, reduce to 2.5 mg; on 2.5 mg, pause treatment for 4 weeks.",
    source: "SmPC mavacamten (Camzyos) 4.5, Table 2; ivabradine 4.3 (verapamil and diltiazem: moderate CYP3A4 inhibitors)",
    check: (_s, f) => (poorOrUnknown(f.cyp2c19) ? pair(["mavacamten"], ["ndhp-ccb"], f.cyp2c19 && f.cyp2c19 !== "Not tested" ? "CYP2C19 poor metaboliser" : "CYP2C19 phenotype not determined")(_s, f) : []),
  },
  {
    id: "mavacamten-ppi", kind: "interaction", severity: "yellow",
    title: withPartner("CYP2C19 inhibitor", "check the mavacamten dose"),
    detail: "Omeprazole and esomeprazole inhibit CYP2C19; intermittent use is not recommended.",
    source: "SmPC mavacamten (Camzyos) 4.5, Table 2",
    check: (_s, f) => {
      // poor metabolisers (and undetermined phenotype, dosed as poor): no dose adjustment with a CYP2C19 inhibitor
      if (poorOrUnknown(f.cyp2c19)) return [];
      const mav = pick(f, ["mavacamten"]);
      if (!mav.length) return [];
      return pick(f, ["omeprazole", "esomeprazole"]).map((p) => {
        const moderate = p.code === "omeprazole" && omeprazoleDaily(p) >= 40;
        return {
          meds: [...mav, p],
          severity: (moderate ? "orange" : "yellow") as Severity,
          reason: moderate
            ? `Omeprazole ${omeprazoleDaily(p)} mg a day is a moderate CYP2C19 inhibitor: no change to a 5 mg starting dose, but when it is started or increased during mavacamten, reduce mavacamten by one dose level (pause if on 2.5 mg)`
            : `${p.name} is a weak CYP2C19 inhibitor (omeprazole 20 mg a day, esomeprazole): monitor LVEF 4 weeks later and adjust the mavacamten dose on clinical assessment`,
        };
      });
    },
  },
  // ---------- on treatment: the label's limits ----------
  {
    id: "mavacamten-lvef", kind: "condition", severity: "red",
    title: (h) => `Mavacamten with LVEF ${h.reason.match(/\d+/)?.[0]}%: interrupt treatment`,
    detail: "If at any visit LVEF is <50%, interrupt mavacamten for 4 weeks and until LVEF returns to ≥50%, then restart at the next lower dose; permanently discontinue if LVEF is <50% twice on 2.5 mg.",
    source: "SmPC mavacamten (Camzyos) 4.2",
    check: (_s, f) => pick(f, ["mavacamten"]).flatMap((m) => {
      const v = f.lvefAfter(startOf(m))[0];
      return v && v.value_num! < 50 ? [{ meds: [m], reason: `LVEF ${formatNumber(v.value_num!, 0)}% on ${fmtDay(v.effective_at, { year: true })}${m.doseValue === 2.5 ? " (on 2.5 mg)" : ""}` }] : [];
    }),
  },
  {
    id: "alt-limit", kind: "condition", severity: "orange",
    title: (h) => `${h.meds[0].name}: ALT above 3 × the upper limit of normal`,
    detail: "Transaminases above three times the upper limit of normal on treatment.",
    source: "SmPC amiodarone 4.4 (reduce or discontinue); dronedarone (Multaq) 4.4 (re-measure within 48–72 h, withdraw if confirmed); bosentan (Tracleer) 4.4 (table by × ULN)",
    check: (_s, f) => {
      if (f.altUln == null) return [];
      const uln = f.altUln, out: SafetyHit[] = [];
      for (const m of pick(f, ["amiodarone", "dronedarone", "bosentan"])) {
        const [last, prev] = f.after("alt", startOf(m));
        if (!last || last.value_num! <= 3 * uln) continue;
        const x = last.value_num! / uln, v = `${formatNumber(last.value_num!, 0)} U/L (${formatNumber(x, 1)} × ULN ${formatNumber(uln, 0)})`;
        if (m.code === "amiodarone") out.push({ meds: [m], reason: `ALT ${v}. Reduce the amiodarone dose or discontinue (label)` });
        if (m.code === "dronedarone") {
          const confirmed = prev && prev.value_num! >= 3 * uln;
          out.push({ meds: [m], severity: confirmed ? "red" : "orange", reason: `ALT ${v}. ${confirmed ? "Confirmed on two measurements: withdraw dronedarone (label)" : "Re-measure within 48–72 hours; if confirmed ≥3 × ULN, withdraw dronedarone (label)"}` });
        }
        if (m.code === "bosentan") out.push({
          meds: [m], severity: x > 5 ? "red" : "orange",
          reason: `ALT ${v}. ${x > 8 ? "Above 8 × ULN: stop bosentan; do not reintroduce (label)" : x > 5 ? "Above 5 × ULN: confirm with a second test; if confirmed stop bosentan and monitor aminotransferases at least every 2 weeks (label)" : "3–5 × ULN: confirm with a second test; if confirmed decide on continuing (possibly at a reduced dose) or stopping (label)"}`,
        });
      }
      return out;
    },
  },
  {
    id: "dronedarone-creatinine", kind: "condition", severity: "yellow",
    title: () => "Dronedarone: creatinine still rising",
    detail: "An increase in creatinine is expected after starting dronedarone; re-measure after a further 7 days and use the stable value as the new baseline. If creatinine continues to rise, consider further investigation and discontinuing treatment.",
    source: "SmPC dronedarone (Multaq) 4.4",
    check: (_s, f) => pick(f, ["dronedarone"]).flatMap((m) => {
      const base = f.before("creatinine", startOf(m));
      const [last, prev] = f.after("creatinine", startOf(m));
      return base && last && prev && last.value_num! > prev.value_num! && prev.value_num! > base.value_num!
        ? [{ meds: [m], reason: `Creatinine ${formatNumber(base.value_num!, 0)} before, then ${formatNumber(prev.value_num!, 0)} and ${formatNumber(last.value_num!, 0)} µmol/L` }] : [];
    }),
  },
  // ---------- before starting: the label's "do not initiate" values (drawer only) ----------
  {
    id: "start-mavacamten-lvef", kind: "prestart", severity: "red",
    title: () => "Mavacamten: do not initiate with LVEF below 55%",
    detail: "If LVEF is <55%, treatment should not be initiated.",
    source: "SmPC mavacamten (Camzyos) 4.2",
    check: (_s, f) => (f.lvef != null && f.lvef < 55 ? pick(f, ["mavacamten"]).map((m) => ({ meds: [m], reason: `Latest LVEF ${f.lvef}%` })) : []),
  },
  {
    id: "start-ivabradine-hr", kind: "prestart", severity: "red",
    title: () => "Ivabradine: do not initiate with resting heart rate below 70/min",
    detail: "Resting heart rate below 70 beats per minute before treatment is a contraindication (heart failure also needs ≥75/min).",
    source: "SmPC ivabradine (Procoralan) 4.3/4.4",
    check: (_s, f) => (f.hr != null && f.hr < 70 ? pick(f, ["ivabradine"]).map((m) => ({ meds: [m], reason: `Heart rate ${ROUND(f.hr!)}/min` })) : []),
  },
  {
    id: "start-potassium", kind: "prestart", severity: "orange",
    title: (h) => `${h.meds[0].name}: potassium too high to start`,
    detail: "The label's potassium limit for starting.",
    source: "SmPC eplerenone (Inspra) 4.3 (>5.0 contraindicated); sacubitril/valsartan (Entresto) 4.4 (>5.4); finerenone (Kerendia) 4.2 (≤4.8 in CKD with T2D, ≤5.0 in heart failure)",
    check: (_s, f) => {
      if (f.k60 == null) return [];
      const k = f.k60, out: SafetyHit[] = [];
      for (const m of pick(f, ["eplerenone"])) if (k > 5.0) out.push({ meds: [m], severity: "red", reason: `Potassium ${k} mmol/L (contraindicated above 5.0 at initiation)` });
      for (const m of pick(f, ["arni"])) if (k > 5.4) out.push({ meds: [m], reason: `Potassium ${k} mmol/L (not to be started above 5.4)` });
      for (const m of pick(f, ["finerenone"])) {
        const lim = f.tags.has("hf") ? 5.0 : 4.8;
        if (k > lim) out.push({ meds: [m], reason: `Potassium ${k} mmol/L (can be started at ≤${formatNumber(lim, 1)} ${f.tags.has("hf") ? "in heart failure" : "in CKD with type 2 diabetes"})` });
      }
      return out;
    },
  },
  {
    id: "start-era-alt", kind: "prestart", severity: "red",
    title: (h) => `${h.meds[0].name}: do not initiate with ALT above 3 × ULN`,
    detail: "Baseline aminotransferases above 3 × the upper limit of normal are a contraindication.",
    source: "SmPC ambrisentan (Volibris) 4.3; macitentan (Opsumit) 4.3",
    check: (_s, f) => (f.alt60 != null && f.altUln != null && f.alt60 > 3 * f.altUln ? pick(f, ["ambrisentan", "macitentan"]).map((m) => ({ meds: [m], reason: `ALT ${ROUND(f.alt60!)} U/L (ULN ${ROUND(f.altUln!)})` })) : []),
  },
  // ---------- a medicine with a condition ----------
  {
    id: "dronedarone-hf", kind: "condition", severity: "red",
    title: () => "Dronedarone with heart failure or LV systolic dysfunction: contraindicated",
    detail: "History of, or current, heart failure or left ventricular systolic dysfunction is a contraindication to dronedarone.",
    source: "SmPC dronedarone (Multaq) 4.3",
    check: (_s, f) => (f.hf ? pick(f, ["dronedarone"]).map((m) => ({ meds: [m], reason: f.hfLabel })) : []),
  },
  {
    id: "dronedarone-permanent-af", kind: "condition", severity: "red",
    title: () => "Dronedarone in permanent AF: contraindicated",
    detail: "Permanent AF (≥6 months or unknown, rhythm control no longer pursued) is a contraindication to dronedarone.",
    source: "SmPC dronedarone (Multaq) 4.3",
    check: (_s, f) => (f.permanentAf ? pick(f, ["dronedarone"]).map((m) => ({ meds: [m], reason: "AF pattern: permanent" })) : []),
  },
  {
    id: "renal-contraindicated", kind: "condition", severity: "red",
    title: (h) => `${h.meds[0].name} with ${h.reason.split(" ·")[0]}: contraindicated`,
    detail: "Below the label's renal threshold the medicine is contraindicated.",
    source: "SmPC dabigatran (Pradaxa) 4.3 (CrCl <30); dronedarone (Multaq) 4.3 (CrCl <30); sotalol 4.3 (CrCl <10)",
    check: (_s, f) => {
      if (f.crcl == null) return [];
      const out: SafetyHit[] = [];
      for (const m of pick(f, ["dabigatran", "dronedarone"])) if (f.crcl < 30) out.push({ meds: [m], reason: `CrCl ${ROUND(f.crcl)} mL/min · threshold <30` });
      for (const m of pick(f, ["sotalol"])) if (f.crcl < 10) out.push({ meds: [m], reason: `CrCl ${ROUND(f.crcl)} mL/min · threshold <10` });
      return out;
    },
  },
  {
    id: "doac-crcl-15", kind: "condition", severity: "orange",
    title: (h) => `${h.meds[0].name} with CrCl <15 mL/min or dialysis: not recommended`,
    detail: "Apixaban, rivaroxaban and edoxaban are not recommended with a creatinine clearance below 15 mL/min or on dialysis (no clinical experience).",
    source: "SmPC apixaban 4.2/4.4; rivaroxaban 4.2/4.4; edoxaban 4.2",
    check: (_s, f) => {
      const low = f.dialysis ? "on dialysis" : f.crcl != null && f.crcl < 15 ? `CrCl ${ROUND(f.crcl)} mL/min` : null;
      return low ? pick(f, DOACS_15).map((m) => ({ meds: [m], reason: low })) : [];
    },
  },
  {
    id: "doac-aps", kind: "condition", severity: "orange",
    title: (h) => `${h.meds[0].name} with antiphospholipid syndrome: not recommended`,
    detail: "DOACs are not recommended for patients with a history of thrombosis who have antiphospholipid syndrome (especially triple-positive): more recurrent thrombosis than with a VKA.",
    source: "SmPC apixaban, rivaroxaban, edoxaban, dabigatran 4.4",
    check: (_s, f) => (f.aps ? pick(f, ["doac"]).map((m) => ({ meds: [m], reason: "Antiphospholipid syndrome on the problem list" })) : []),
  },
  {
    id: "flecainide-hf", kind: "condition", severity: "red",
    title: () => "Flecainide with heart failure: contraindicated",
    detail: "Flecainide is contraindicated in cardiac failure and in cardiogenic shock.",
    source: "SmPC flecainide (Tambocor) 4.3",
    check: (_s, f) => (f.hf ? pick(f, ["flecainide"]).map((m) => ({ meds: [m], reason: f.hfLabel })) : []),
  },
  {
    id: "flecainide-mi-valve", kind: "condition", severity: "orange",
    title: () => "Flecainide after myocardial infarction or with significant valve disease: check the label contraindications",
    detail: "Flecainide is contraindicated after a myocardial infarction with asymptomatic ventricular ectopics or non-sustained VT, and in haemodynamically significant valvular heart disease. Review the indication.",
    source: "SmPC flecainide (Tambocor) 4.3",
    check: (_s, f) => {
      const why = [f.priorMi ? "previous myocardial infarction" : null, f.severeValve.length ? `${f.severeValve.join(", ")} (severe)` : null].filter(Boolean).join("; ");
      return why ? pick(f, ["flecainide"]).map((m) => ({ meds: [m], reason: why[0].toUpperCase() + why.slice(1) })) : [];
    },
  },
  {
    id: "propafenone-structural", kind: "condition", severity: "red",
    title: () => "Propafenone with significant structural heart disease: contraindicated",
    detail: "Propafenone is contraindicated in significant structural heart disease, e.g. myocardial infarction within the last 3 months or uncontrolled heart failure with LV output below 35%.",
    source: "SmPC propafenone (Arythmol) 4.3",
    check: (_s, f) => {
      const why = [f.recentMi ? `Myocardial infarction on ${String(f.recentMi.onset).slice(0, 10)} (within 3 months)` : null, f.hf && f.lvef != null && f.lvef < 35 ? `Heart failure with LVEF ${f.lvef}%` : null].filter(Boolean).join("; ");
      return why ? pick(f, ["propafenone"]).map((m) => ({ meds: [m], reason: why })) : [];
    },
  },
  {
    id: "ndhp-hfref", kind: "condition", severity: "orange",
    title: (h) => `${h.meds[0].name} with heart failure and reduced ejection fraction`,
    detail: "Verapamil is contraindicated in uncompensated heart failure, diltiazem in left ventricular failure with pulmonary stasis (labels). Review the rate-control or anti-anginal choice.",
    source: "SmPC verapamil (Securon) 4.3; diltiazem (Tildiem) 4.3",
    check: (_s, f) => {
      // reduced ejection fraction: the latest LVEF ≤40% (ESC HF definition), or HFrEF on the problem list without an LVEF
      const reduced = f.lvef != null ? f.lvef <= 40 : f.hfref;
      return reduced ? pick(f, ["ndhp-ccb"]).map((m) => ({ meds: [m], reason: f.lvef != null ? `LVEF ${f.lvef}%` : "HFrEF on the problem list" })) : [];
    },
  },
  {
    id: "diltiazem-bradycardia", kind: "condition", severity: "red",
    title: () => "Diltiazem with heart rate below 50/min: contraindicated",
    detail: "Severe bradycardia (less than 50 beats per minute) is a contraindication to diltiazem.",
    source: "SmPC diltiazem (Tildiem) 4.3",
    check: (_s, f) => (f.hr != null && f.hr < 50 ? pick(f, ["diltiazem"]).map((m) => ({ meds: [m], reason: `Heart rate ${ROUND(f.hr!)}/min` })) : []),
  },
  {
    id: "nsaid-hf", kind: "condition", severity: "orange",
    title: (h) => `${h.meds[0].name} with heart failure`,
    detail: "Ibuprofen is contraindicated in severe heart failure (NYHA IV); with NYHA II–III only after careful consideration, avoiding high doses (fluid retention, oedema).",
    source: "SmPC ibuprofen (Brufen) 4.3/4.4",
    check: (_s, f) => (f.hf ? pick(f, ["nsaid"]).map((m) => ({ meds: [m], reason: `${f.hfLabel}${f.nyha ? ` · NYHA ${f.nyha}` : ""}`, severity: (f.nyha === "IV" ? "red" : "orange") as Severity })) : []),
  },
  {
    id: "renal-severe", kind: "condition", severity: "red",
    title: (h) => `${h.meds[0].name} with eGFR below 30: contraindicated`,
    detail: "Eplerenone (eGFR <30) and colchicine (severe renal impairment) are contraindicated.",
    source: "SmPC eplerenone (Inspra) 4.3; colchicine 4.3",
    check: (_s, f) => (f.egfr != null && f.egfr < 30 ? pick(f, ["eplerenone", "colchicine"]).map((m) => ({ meds: [m], reason: `eGFR ${ROUND(f.egfr!)}` })) : []),
  },
];

export function safetyHits(s: PatientState, kind: SafetyRow["kind"]) {
  const f = facts(s);
  return SAFETY_ROWS.filter((r) => r.kind === kind).flatMap((r) => r.check(s, f).map((h) => ({ row: r, hit: h })));
}

// Pre-start check (medicine drawer): the table run with a proposed medicine added to the current list.
// Only hits that involve the proposed medicine are returned, worst first.
export function preStartCheck(s: PatientState, code: string, def: { name: string; drugClass: string; purpose: string; tags: string[] }) {
  const proposed: MedState = {
    id: "proposed", code, name: def.name, drugClass: def.drugClass, purpose: def.purpose, tags: def.tags, indication: "", status: "active",
    doseValue: null, doseUnit: null, frequency: null, route: null, startedAt: s.today, lastChange: null, events: [],
  } as MedState;
  const already = s.meds.some((m) => m.code === code && m.status === "active");
  const s2 = already ? s : ({ ...s, meds: [...s.meds, proposed] } as PatientState);
  const order: Record<Severity, number> = { red: 0, orange: 1, yellow: 2 };
  return [...safetyHits(s2, "interaction"), ...safetyHits(s2, "condition"), ...safetyHits(s2, "prestart")]
    .filter(({ hit }) => hit.meds.some((m) => m.code === code))
    .map(({ row, hit }) => ({ severity: hit.severity ?? row.severity, title: row.title(hit), detail: hit.reason ? `${hit.reason}. ${row.detail}`.replace(/\.\. /, ". ") : row.detail, source: row.source }))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}
