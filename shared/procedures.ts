import { LAA_METHODS, LAA_DEVICES, LAA_RESULTS, LAA_REGIMENS } from "./af.js";
import { STRUCTURAL_RESULTS, STRUCTURAL_COMPLICATIONS, RESIDUAL_GRADES } from "./structural.js";
// Procedures (coronary module, 4 Oct 2026): PCI and CABG as their own dated records, so that
// antithrombotic durations can be counted from the exact day and the setting (ACS or elective).
// Descriptive vocabulary only. Complex PCI follows the ESC definition used for DAPT decisions
// (≥3 vessels treated, ≥3 stents, ≥3 lesions, bifurcation with 2 stents, total stent length
// >60 mm, chronic total occlusion).

export const PCI_SETTINGS = [
  { value: "stemi", label: "Primary PCI (STEMI)", acs: true },
  { value: "nste-acs", label: "NSTE-ACS", acs: true },
  { value: "elective", label: "Elective (chronic coronary syndrome)", acs: false },
  { value: "staged", label: "Staged after ACS", acs: true },
] as const;
export const PCI_VESSELS = ["Left main", "LAD", "LCx", "RCA", "Graft"] as const;
export const PCI_DEVICES = ["Drug-eluting stent", "Drug-coated balloon", "Balloon only"] as const;
// in-lab and early complications, recorded as they happened (descriptive; no threshold attached)
export const PCI_COMPLICATIONS = ["Coronary dissection", "No-reflow / slow flow", "Coronary perforation", "Side-branch occlusion", "Acute stent thrombosis", "Peri-procedural MI", "VT / VF needing treatment", "Access-site haematoma or bleeding", "Contrast reaction", "Contrast-associated kidney injury"] as const;
export const COMPLEX_FEATURES = ["≥3 vessels treated", "≥3 stents", "≥3 lesions", "Bifurcation with 2 stents", "Total stent length >60 mm", "Chronic total occlusion"] as const;
export const CABG_GRAFTS = ["LIMA to LAD", "Other arterial graft", "Vein grafts"] as const;
export const ACCESS = ["Radial", "Femoral"] as const;

// Rhythm & devices module (5 Oct 2026): device implants, ablations and cardioversions use the same
// append-only table; the kind is validated here, not in the schema.
export const DEVICE_TYPES = [
  "Pacemaker (single chamber)", "Pacemaker (dual chamber)", "Leadless pacemaker", "ICD (transvenous)", "Subcutaneous ICD",
  "CRT-P", "CRT-D", "Implantable loop recorder",
] as const;
export const DEVICE_ACTIONS = ["New implant", "Upgrade", "Generator change", "Lead revision", "Extraction"] as const;
export const DEVICE_INDICATIONS = [
  "Sinus node dysfunction", "AV block", "AF with slow ventricular rate", "Pace and ablate", "Primary prevention ICD", "Secondary prevention ICD",
  "CRT for heart failure", "Syncope / arrhythmia monitoring", "Other",
] as const;
export const REMOTE_MONITORING = ["Enrolled", "Not enrolled"] as const;
export const PACING_SITES = ["RV pacing", "Conduction system pacing (His / LBBAP)", "Biventricular", "No pacing lead"] as const;
export const ABLATION_TARGETS = [
  "AF (pulmonary vein isolation)", "Atrial flutter (CTI)", "Atypical flutter / atrial tachycardia", "AVNRT", "Accessory pathway", "VT", "PVCs", "AV node (pace and ablate)",
] as const;
export const ABLATION_ENERGY = ["Radiofrequency", "Cryoballoon", "Pulsed field", "Other"] as const;
export const ABLATION_RESULT = ["Acute success", "Partial", "Unsuccessful"] as const;
export const CV_METHOD = ["Electrical", "Pharmacological"] as const;
export const CV_RHYTHM = ["Atrial fibrillation", "Atrial flutter", "Other"] as const;
export const CV_PREP = ["Anticoagulated ≥3 weeks", "TOE-guided", "AF onset <24 h", "Emergency (haemodynamic instability)"] as const;
export const CV_RESULT = ["Sinus rhythm restored", "Unsuccessful", "Early recurrence"] as const;

// Valve module (5 Oct 2026): valve interventions, surgical and transcatheter, in the same table.
export const VALVE_POSITIONS = ["Aortic", "Mitral", "Tricuspid", "Pulmonary"] as const;
export const VALVE_PROCEDURES = [
  "TAVI", "Surgical replacement", "Surgical repair", "Transcatheter edge-to-edge repair (TEER)", "Balloon valvotomy", "Transcatheter valve replacement", "Valve-in-valve",
] as const;
export const VALVE_PROSTHESES = ["Mechanical", "Bioprosthetic"] as const;
export const VALVE_ACCESS = ["Transfemoral", "Other access"] as const;
export const MECH_DESIGNS = ["Bileaflet / current tilting-disc", "Older tilting-disc", "Caged-ball", "Unknown"] as const;
// the prosthesis a valve procedure leaves (problem-list vocabulary), or null for a valvotomy
export const PROSTHESIS_TYPE = (a: Record<string, any>): string | null =>
  a.result === "Aborted / no implant" ? null : a.procedure === "TAVI" ? "TAVI"
  : a.procedure === "Surgical replacement" ? (a.prosthesis === "Mechanical" ? "Mechanical" : "Bioprosthetic (surgical)")
  : a.procedure === "Surgical repair" ? "Repair / ring"
  : a.procedure === "Transcatheter edge-to-edge repair (TEER)" ? "Edge-to-edge repair (clip)"
  : a.procedure === "Transcatheter valve replacement" || a.procedure === "Valve-in-valve" ? (a.position === "Aortic" ? "TAVI" : "Transcatheter valve")
  : null;

export type ProcedureKind = "pci" | "cabg" | "device" | "ablation" | "cardioversion" | "valve" | "rhc" | "laao";
export const PROCEDURE_LABEL: Record<ProcedureKind, string> = { pci: "PCI", cabg: "CABG", device: "Device", ablation: "Ablation", cardioversion: "Cardioversion", valve: "Valve intervention", rhc: "Right heart catheterisation", laao: "LAA closure" };
// Right heart catheterisation (PH module, slice 2): the measured pressures, flow and resistance, and the
// 2022 ESC/ERS haemodynamic definition they meet. PVR is taken as measured, or computed as
// (mPAP − PAWP) / cardiac output when only the cardiac output is given.
export const RHC_NUMBERS = [
  { key: "mpap", label: "Mean PA pressure", unit: "mmHg", min: 5, max: 100 },
  { key: "pawp", label: "PA wedge pressure", unit: "mmHg", min: 1, max: 50 },
  { key: "rap", label: "Right atrial pressure", unit: "mmHg", min: 0, max: 40 },
  { key: "co", label: "Cardiac output", unit: "L/min", min: 1, max: 15 },
  { key: "pvr", label: "PVR", unit: "WU", min: 0, max: 40 },
  { key: "svo2", label: "Mixed venous O₂ saturation", unit: "%", min: 20, max: 95 },
] as const;
export const VASOREACTIVITY = ["Not done", "Positive", "Negative"] as const;
export function rhcPvr(a: { mpap?: number | null; pawp?: number | null; co?: number | null; pvr?: number | null }) {
  if (a.pvr != null) return a.pvr;
  if (a.mpap != null && a.pawp != null && a.co) return Math.round(((a.mpap - a.pawp) / a.co) * 10) / 10;
  return null;
}
// ESC/ERS 2022: PH mPAP >20 mmHg; pre-capillary PAWP ≤15 and PVR >2 WU; isolated post-capillary PAWP >15
// and PVR ≤2 WU; combined post- and pre-capillary PAWP >15 and PVR >2 WU.
export function rhcClass(a: { mpap?: number | null; pawp?: number | null; co?: number | null; pvr?: number | null }) {
  const pvr = rhcPvr(a);
  if (a.mpap == null || a.pawp == null) return null;
  if (a.mpap <= 20) return "No pulmonary hypertension at rest";
  if (pvr == null) return a.pawp > 15 ? "Post-capillary PH (PVR not available)" : "PH (PVR not available)";
  if (a.pawp <= 15) return pvr > 2 ? "Pre-capillary" : "mPAP >20 with PAWP ≤15 and PVR ≤2 (neither pre- nor post-capillary)";
  return pvr > 2 ? "Combined post- and pre-capillary" : "Isolated post-capillary";
}
export const VALVE_KINDS: ProcedureKind[] = ["valve"];
export const CORONARY_KINDS: ProcedureKind[] = ["pci", "cabg"];
export const RHYTHM_KINDS: ProcedureKind[] = ["device", "ablation", "cardioversion", "laao"];
// the problem-list device type for a device record
export const CIED_TYPE = (t: string) =>
  /^Pacemaker|Leadless/.test(t) ? "Pacemaker" : /ICD/.test(t) ? "ICD" : t === "CRT-P" ? "CRT-P" : t === "CRT-D" ? "CRT-D" : "Loop recorder";

const oneOf = <T extends readonly string[]>(list: T, v: unknown, what: string) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !list.includes(v)) throw new Error(`${what}: unknown value`);
  return v;
};
const someOf = <T extends readonly string[]>(list: T, v: unknown, what: string) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !list.includes(x))) throw new Error(`${what}: unknown value`);
  return [...new Set(v as string[])];
};

// Validate and clean a procedure's details.
export function cleanProcedure(kind: ProcedureKind, a: Record<string, unknown>) {
  if (kind === "rhc") {
    const out: Record<string, unknown> = {};
    for (const n of RHC_NUMBERS) {
      const v = a[n.key];
      if (v == null || v === "") { out[n.key] = null; continue; }
      const x = Number(v);
      if (!Number.isFinite(x) || x < n.min || x > n.max) throw new Error(`${n.label}: ${n.min}–${n.max} ${n.unit}`);
      out[n.key] = x;
    }
    if (out.mpap == null || out.pawp == null) throw new Error("Mean PA pressure and wedge pressure are required");
    out.pvr = rhcPvr(out as any);
    out.pvrComputed = a.pvr == null || a.pvr === "" ? out.pvr != null : false;
    out.vasoreactivity = oneOf(VASOREACTIVITY, a.vasoreactivity, "Vasoreactivity") ?? "Not done";
    out.class = rhcClass(out as any);
    return out;
  }
  if (kind === "pci") {
    const setting = oneOf(PCI_SETTINGS.map((s) => s.value), a.setting, "Setting");
    if (!setting) throw new Error("Setting is required");
    const vessels = someOf(PCI_VESSELS, a.vessels, "Vessels");
    if (!vessels.length) throw new Error("Choose the vessel(s) treated");
    // devices: several may be used in one procedure (DES and DCB); `device` stays the main one for older readers
    const picked = a.devices != null ? someOf(PCI_DEVICES, a.devices, "Devices") : [oneOf(PCI_DEVICES, a.device, "Device") ?? "Drug-eluting stent"];
    const devices = PCI_DEVICES.filter((d) => picked.includes(d)) as string[];
    if (!devices.length) throw new Error("Choose the device(s) used");
    const count = (v: unknown, what: string) => {
      const n = v == null || v === "" ? null : Number(v);
      if (n != null && (!Number.isInteger(n) || n < 0 || n > 12)) throw new Error(`${what}: 0–12`);
      return n;
    };
    const stents = devices.includes("Drug-eluting stent") ? count(a.stents, "Number of stents") : null;
    const dcb = devices.includes("Drug-coated balloon") ? count(a.dcb, "Number of drug-coated balloons") : null;
    const complex = someOf(COMPLEX_FEATURES, a.complex, "Complex PCI");
    // ≥3 stents is part of the ESC complex-PCI definition: derived from the count
    if (stents != null && stents >= 3 && !complex.includes("≥3 stents")) complex.push("≥3 stents");
    return {
      setting, vessels, device: devices[0], devices, stents, dcb,
      complex,
      complications: someOf(PCI_COMPLICATIONS, a.complications, "Complications"),
      access: oneOf(ACCESS, a.access, "Access"),
    };
  }
  if (kind === "device") {
    const type = oneOf(DEVICE_TYPES, a.type, "Device");
    if (!type) throw new Error("Choose the device");
    return {
      type,
      action: oneOf(DEVICE_ACTIONS, a.action, "Procedure") ?? "New implant",
      indication: oneOf(DEVICE_INDICATIONS, a.indication, "Indication"),
      pacing: oneOf(PACING_SITES, a.pacing, "Pacing"),
      remote: oneOf(REMOTE_MONITORING, a.remote, "Remote monitoring"),
    };
  }
  if (kind === "laao") {
    const method = oneOf(LAA_METHODS, a.method, "Closure method");
    const device = oneOf(LAA_DEVICES, a.device, "Closure device");
    const result = oneOf(LAA_RESULTS, a.result, "Closure result");
    if (!method || !device || !result) throw new Error("Record method, device and result");
    if ((method === "Surgical exclusion") !== device.startsWith("Surgical")) throw new Error("Device does not match closure method");
    const regimen = oneOf(LAA_REGIMENS, a.regimen, "Antithrombotic regimen") ?? "Not documented";
    const reviewDate = a.reviewDate ? String(a.reviewDate) : null;
    if (reviewDate && (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || Number.isNaN(Date.parse(reviewDate)) || new Date(reviewDate).toISOString().slice(0,10) !== reviewDate)) throw new Error("Invalid regimen review date");
    return { method, device, result, regimen, reviewDate };
  }
  if (kind === "ablation") {
    const targets = someOf(ABLATION_TARGETS, a.targets, "Target");
    if (!targets.length) throw new Error("Choose what was ablated");
    return { targets, energy: oneOf(ABLATION_ENERGY, a.energy, "Energy"), result: oneOf(ABLATION_RESULT, a.result, "Result") ?? "Acute success" };
  }
  if (kind === "valve") {
    const position = oneOf(VALVE_POSITIONS, a.position, "Valve");
    if (!position) throw new Error("Choose the valve");
    const procedure = oneOf(VALVE_PROCEDURES, a.procedure, "Procedure");
    if (!procedure) throw new Error("Choose the procedure");
    if (procedure === "TAVI" && position !== "Aortic") throw new Error("TAVI is an aortic procedure");
    if (procedure === "Transcatheter edge-to-edge repair (TEER)" && !["Mitral","Tricuspid"].includes(position)) throw new Error("TEER requires a mitral or tricuspid valve");
    const number = (key:string,max:number) => {
      if (a[key] == null || a[key] === "") return null;
      const n=Number(a[key]);
      if (!Number.isFinite(n) || n < 0 || n > max || (key === "implantCount" && !Number.isInteger(n))) throw new Error(`${key}: invalid reported value`);
      return n;
    };
    const prosthesis = procedure === "Surgical replacement" ? oneOf(VALVE_PROSTHESES, a.prosthesis, "Prosthesis") : null;
    if (procedure === "Surgical replacement" && !prosthesis) throw new Error("Mechanical or bioprosthetic?");
    return {
      position, procedure, prosthesis,
      design: prosthesis === "Mechanical" ? oneOf(MECH_DESIGNS, a.design, "Valve design") ?? "Unknown" : null,
      access: procedure === "TAVI" || procedure === "Valve-in-valve" ? oneOf(VALVE_ACCESS, a.access, "Access") : null,
      result: oneOf(STRUCTURAL_RESULTS,a.result,"Procedure result") ?? "Completed",
      deviceModel: a.deviceModel == null ? null : String(a.deviceModel).trim().slice(0,80),
      deviceSize: number("deviceSize",100), implantCount: number("implantCount",20),
      residualGrade: oneOf(RESIDUAL_GRADES,a.residualGrade,"Residual regurgitation / leak"),
      meanGradient: number("meanGradient",200), complications: someOf(STRUCTURAL_COMPLICATIONS,a.complications,"Complications"),
    };
  }
  if (kind === "cardioversion") {
    const method = oneOf(CV_METHOD, a.method, "Method");
    if (!method) throw new Error("Electrical or pharmacological?");
    return {
      method,
      rhythm: oneOf(CV_RHYTHM, a.rhythm, "Rhythm") ?? "Atrial fibrillation",
      prep: oneOf(CV_PREP, a.prep, "Before cardioversion"),
      result: oneOf(CV_RESULT, a.result, "Result") ?? "Sinus rhythm restored",
    };
  }
  const grafts = someOf(CABG_GRAFTS, a.grafts, "Grafts");
  const count = a.count == null || a.count === "" ? null : Number(a.count);
  if (count != null && (!Number.isInteger(count) || count < 1 || count > 8)) throw new Error("Number of grafts: 1–8");
  const setting = oneOf(["acs", "elective"] as const, a.setting, "Setting") ?? "elective";
  return { grafts, count, setting };
}

export const isAcsProcedure = (p: { kind: string; attributes: Record<string, any> }) =>
  p.kind === "pci" ? PCI_SETTINGS.some((s) => s.value === p.attributes.setting && s.acs) : p.attributes.setting === "acs";
export const isComplexPci = (p: { kind: string; attributes: Record<string, any> }) => p.kind === "pci" && (p.attributes.complex?.length ?? 0) > 0;

// One line for lists, the journey and notes.
export function procedureSummary(kind: string, a: Record<string, any>) {
  if (kind === "pci") {
    const setting = PCI_SETTINGS.find((s) => s.value === a.setting)?.label ?? "";
    const devs: string[] = a.devices ?? (a.device ? [a.device] : []);
    const dev = devs.map((d) => (d === "Drug-eluting stent" ? (a.stents ? `DES ×${a.stents}` : "DES") : d === "Drug-coated balloon" ? (a.dcb ? `DCB ×${a.dcb}` : "DCB") : "balloon only")).join(" + ");
    const comp: string[] = a.complications ?? [];
    return [`${(a.vessels ?? []).join(", ")}${dev ? ` ${dev}` : ""}`, setting, a.complex?.length ? "complex PCI" : null, comp.length ? `complication: ${comp.map((c) => c.toLowerCase()).join(", ")}` : null].filter(Boolean).join(" · ");
  }
  if (kind === "device") return [a.type, a.action !== "New implant" ? a.action?.toLowerCase() : null, a.indication, a.pacing && a.pacing !== "No pacing lead" ? a.pacing : null, a.remote === "Enrolled" ? "remote monitoring" : null].filter(Boolean).join(" · ");
  if (kind === "laao") return [a.method, a.device, a.result, `Regimen: ${a.regimen}`].filter(Boolean).join(" · ");
  if (kind === "ablation") return [(a.targets ?? []).join(" + "), a.energy, a.result !== "Acute success" ? a.result?.toLowerCase() : null].filter(Boolean).join(" · ");
  if (kind === "valve") {
    const what: Record<string, string> = {
      TAVI: "TAVI", "Surgical replacement": `${a.position} valve replacement (${String(a.prosthesis ?? "").toLowerCase()})`, "Surgical repair": `${a.position} valve repair`,
      "Transcatheter edge-to-edge repair (TEER)": `${a.position} TEER`, "Balloon valvotomy": `${a.position} balloon valvotomy`,
      "Transcatheter valve replacement": `${a.position} transcatheter valve replacement`, "Valve-in-valve": `${a.position} valve-in-valve`,
    };
    return [a.result === "Aborted / no implant" ? "Aborted / no implant" : null, what[a.procedure] ?? a.procedure, a.deviceModel || null, a.implantCount ? `${a.implantCount} implants` : null, a.residualGrade ? `residual ${a.residualGrade}` : null, a.meanGradient != null ? `mean gradient ${a.meanGradient} mmHg` : null, a.design && a.design !== "Unknown" ? a.design : null, a.access ? a.access.toLowerCase() : null].filter(Boolean).join(" · ");
  }
  if (kind === "rhc") return [`mPAP ${a.mpap} · PAWP ${a.pawp}${a.pvr != null ? ` · PVR ${a.pvr} WU` : ""}`, a.class ? String(a.class).replace(/^Pre-capillary$/, "pre-capillary PH").replace(/^Isolated post-capillary$/, "isolated post-capillary PH").replace(/^Combined post- and pre-capillary$/, "combined post- and pre-capillary PH") : null, a.vasoreactivity && a.vasoreactivity !== "Not done" ? `vasoreactivity ${String(a.vasoreactivity).toLowerCase()}` : null].filter(Boolean).join(" · ");
  if (kind === "cardioversion") return [`${a.method} cardioversion of ${String(a.rhythm ?? "").toLowerCase()}`, a.prep, a.result].filter(Boolean).join(" · ");
  return [a.count ? `${a.count} graft${a.count === 1 ? "" : "s"}` : null, (a.grafts ?? []).join(", ") || null, a.setting === "acs" ? "during ACS" : null].filter(Boolean).join(" · ");
}

// Checklists before a procedure (redesign slice 7; valve and RHC added in the audit finish, 6 Oct)
export type CheckKind = "pci" | "cardioversion" | "ablation" | "device" | "valve" | "rhc" | "cabg" | "pericardiocentesis" | "laao";
// a planned procedure (plan item) that has a checklist: matched by its title
export function checklistForPlan(title: string, category: string): CheckKind | null {
  if (!["procedure", "referral", "follow_up"].includes(category) || /immediate|primary PCI|^(anticoagulation|12-lead|ambulatory|TOE|echo)/i.test(title)) return null;
  if (/LAA (closure|occlusion)|left atrial appendage (closure|occlusion)/i.test(title)) return "laao";
  if (/cardioversion/i.test(title)) return "cardioversion";
  if (/AF catheter ablation|ablation for AF|AF ablation/i.test(title)) return "ablation";
  if (/coronary angiography|\bPCI\b/i.test(title)) return "pci";
  if (/TAVI|TEER|valve (replacement|repair|intervention|surgery)|commissurotomy|valvotomy|tricuspid intervention/i.test(title)) return "valve";
  if (/right heart catheteri[sz]ation/i.test(title)) return "rhc";
  if (/\bCABG\b|coronary (artery )?bypass/i.test(title)) return "cabg";
  if (/pericardiocentesis/i.test(title)) return "pericardiocentesis";
  if (/pacemaker implant|ICD implant|CRT implant|device implant/i.test(title)) return "device";
  return null;
}
