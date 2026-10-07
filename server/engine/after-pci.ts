// After PCI (redesign slice 3): the context the sheet needs, and one write that applies the plan —
// antithrombotic starts and switches (maintenance doses only), dated stops linked to the medicine they stop,
// and the chosen secondary-prevention steps. Choices and durations: shared/after-pci.ts.
import { MEDICATION } from "../../shared/catalog.js";
import { addDays, daysBetween, localDay } from "../../shared/clinical.js";
import { P2Y12, type PciContext } from "../../shared/after-pci.js";
import { isAcsProcedure, isComplexPci } from "../../shared/procedures.js";
import type { Actor } from "../kernel/base.js";
import * as K from "../kernel/clinical.js";
import type { PatientState } from "../kernel/state.js";
import { arcHbr, indexEvent } from "./cad-profile.js";
import { statinIntensity } from "./guidelines.js";
import { preStartCheck } from "./med-safety.js";
import { bookMonitoringAtStart } from "./med-rules.js";

const live = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held");
type Q = Parameters<typeof K.addPlanAction>[0];

export function pciContext(s: PatientState): PciContext | null {
  const p = [...s.procedures].reverse().find((x) => x.kind === "pci");
  if (!p) return null;
  const at = localDay(p.performed_at);
  const ix = indexEvent(s);
  const acs = isAcsProcedure(p) || !!(ix?.acs && ix.pci && localDay(ix.pci.at) === at);
  const meds = live(s);
  const oac = meds.find((m) => m.tags.includes("oac"));
  const aspirin = meds.find((m) => m.code === "aspirin");
  const p2 = meds.find((m) => m.tags.includes("p2y12"));
  const statin = meds.find((m) => m.tags.includes("statin"));
  const planned = (re: RegExp) => s.plan.some((x) => x.status === "planned" && re.test(x.title));
  const lvef = s.resolved("lvef").current;
  return {
    today: s.today,
    pci: { id: p.id, at, acs, summary: p.summary, complex: isComplexPci(p), complications: p.attributes.complications ?? [] },
    age: s.patient.age,
    weight: s.resolved("weight").current?.value_num ?? null,
    oac: oac ? { id: oac.id, name: oac.name } : null,
    aspirin: aspirin ? { id: aspirin.id, name: aspirin.name, dose: aspirin.doseValue } : null,
    p2y12: p2 ? { id: p2.id, name: p2.name, code: p2.code, potent: p2.tags.includes("p2y12-potent") } : null,
    hbr: arcHbr(s),
    statin: statin ? { name: statin.name, high: statinIntensity(statin) === "high" } : null,
    ppi: meds.some((m) => m.tags.includes("ppi")),
    nsaid: meds.some((m) => m.tags.includes("nsaid") || m.tags.includes("steroid")),
    planned: {
      rehab: planned(/rehabilitation/i), echo: planned(/\becho\b/i), lipids: planned(/lipid|LDL/i),
      stops: s.plan.some((x) => x.status === "planned" && x.medication_id && [aspirin?.id, p2?.id].includes(x.medication_id)),
    },
    lvefSince: !!lvef && daysBetween(lvef.effective_at, at) <= 7,
    priorStroke: s.conditions.some((c) => c.code === "stroke-tia" && c.status === "active"),
  };
}

export type AfterPciInput = {
  regimen: "dapt" | "oac";
  p2y12: "ticagrelor" | "prasugrel" | "clopidogrel";
  aspirinDose: number;
  stops: { target: "aspirin" | "p2y12"; title: string; dueDate: string }[];
  extras: string[];
  overrides?: Record<string, string>;
  contextId?: string | null;
};

export class Refused extends Error {}

export async function applyAfterPci(tx: Q, actor: Actor, patientId: string, s: PatientState, input: AfterPciInput) {
  const c = pciContext(s);
  if (!c) throw new Refused("No PCI on record");
  const now = new Date().toISOString();
  const reason = `After PCI ${c.pci.at}`;
  const ctxId = input.contextId ?? null;
  if (input.regimen === "oac" && input.p2y12 !== "clopidogrel") throw new Refused("With an anticoagulant, clopidogrel is the P2Y12 inhibitor (ESC ACS 2023)");
  // a red pre-start hit needs the clinician's reason, as in the medicine drawer
  const start = async (code: string, dose: number, frequency: string, indication: string) => {
    const def = MEDICATION[code];
    const reds = preStartCheck(s, code, def).filter((h) => h.severity === "red");
    const why = input.overrides?.[code]?.trim();
    if (reds.length && (!why || why.length < 3)) throw new Refused(`${reds[0].title}. Record a reason to start it anyway.`);
    const r = await K.startMedication(tx, actor, patientId, {
      code, doseValue: dose, frequency, route: def.routes[0], indication, effectiveAt: now, contextId: ctxId,
      reason: reds.length ? `${reason} · Started despite: ${reds.map((h) => h.title).join("; ")} — ${why}`.slice(0, 300) : reason,
    });
    return r.medicationId as string;
  };
  // aspirin
  let aspirinId = c.aspirin?.id ?? null;
  if (!aspirinId) aspirinId = await start("aspirin", input.aspirinDose, "OD", "cad");
  // P2Y12 inhibitor: keep, switch or start
  let p2Id = c.p2y12?.id ?? null;
  if (c.p2y12 && c.p2y12.code !== input.p2y12) {
    await K.medicationEvent(tx, actor, patientId, c.p2y12.id, { kind: "stop", reason: `Switched to ${P2Y12[input.p2y12].name.toLowerCase()} (${reason})`, effectiveAt: now, contextId: ctxId });
    p2Id = null;
  }
  if (!p2Id) p2Id = await start(input.p2y12, P2Y12[input.p2y12].dose(c), P2Y12[input.p2y12].frequency, "cad");
  // dated stops, linked to the medicine they stop; saving the sheet again replaces the earlier stops
  // instead of adding a second set
  if (input.stops.length)
    await tx.query(
      `UPDATE cf.plan_action SET status='cancelled', outcome='Replaced by the after-PCI plan', updated_at=now(), version=version+1
       WHERE patient_id=$1 AND status='planned' AND category='medication' AND medication_id = ANY($2::uuid[]) AND completes_on->>'type'='manual' AND title ~* '(stop|DAPT|triple)'`,
      [patientId, [aspirinId, p2Id].filter(Boolean)],
    );
  for (const st of input.stops) {
    if (st.dueDate < c.pci.at) throw new Refused("A stop date cannot be before the PCI");
    // a date already passed (PCI entered late) becomes today, and says so
    const late = st.dueDate < s.today;
    await K.addPlanAction(tx, actor, patientId, {
      category: "medication", title: late ? `${st.title} (due ${st.dueDate})` : st.title, reason, dueDate: late ? s.today : st.dueDate, completesOn: { type: "manual" },
      contextId: ctxId, medicationId: st.target === "aspirin" ? aspirinId : p2Id,
    });
  }
  // the other steps
  const ex = new Set(input.extras);
  if (ex.has("statin") && !c.statin) {
    const id = await start("atorvastatin", c.pci.acs ? 80 : 40, "OD", "cad");
    await bookMonitoringAtStart(tx, actor, patientId, id, ctxId); // LDL-C 6 weeks after the start (ESC/EAS)
  }
  if (ex.has("statin-up") && c.statin) {
    const st = live(s).find((m) => m.tags.includes("statin"))!;
    await K.addPlanAction(tx, actor, patientId, { category: "medication", title: `${/atorva|rosuva/i.test(st.name) ? `Increase ${st.name.toLowerCase()} to high intensity` : `Change ${st.name.toLowerCase()} to a high-intensity statin`} (atorvastatin 40–80 mg / rosuvastatin 20–40 mg)`, reason, dueDate: s.today, completesOn: { type: "manual" }, contextId: ctxId, medicationId: st.id });
  }
  if (ex.has("ppi") && !c.ppi) await start("pantoprazole", 40, "OD", "GI protection on antithrombotic therapy");
  if (ex.has("rehab") && !c.planned.rehab) await K.addPlanAction(tx, actor, patientId, { category: "referral", title: "Cardiac rehabilitation referral", reason, dueDate: addDays(s.today, 7), completesOn: { type: "manual" }, contextId: ctxId });
  if (ex.has("echo") && !c.planned.echo) await K.addPlanAction(tx, actor, patientId, { category: "investigation", title: "Echo: LV function after ACS", reason, dueDate: s.today, completesOn: { type: "study", kind: "echo" }, contextId: ctxId });
  if (ex.has("lipids") && !c.planned.lipids) await K.addPlanAction(tx, actor, patientId, { category: "monitoring", title: "Lipid profile 4–6 weeks after ACS", reason, dueDate: addDays(c.pci.at, 42) < s.today ? s.today : addDays(c.pci.at, 42), completesOn: { type: "lab", codes: ["ldl-c"] }, contextId: ctxId });
  return { changed: ["meds", "plan"] };
}
