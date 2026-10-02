import { targets } from "../engine/guidelines.js";
import { hfProfile } from "../engine/hf-profile.js";
// Read models: Summary, What changed, Journey, Worklist. All are projections of the kernel.
import type { Q } from "../db/db.js";
import { BARRIER_LABEL, DIAGNOSIS, MEASURES, PURPOSE_ORDER, classLabel, doseLabel, drugClassOf, MEDICATION, formatNumber } from "../../shared/catalog.js";
import { ageOn, bmi, daysBetween, fmtDay, planStatusView } from "../../shared/clinical.js";
import { ANSWER_LABEL, HISTORY_ITEMS, attributesText, historyCode } from "../../shared/history.js";
import { activeBarrier, loadState, latestDischarge, openContext, type PatientState } from "./state.js";
import { today as todayFn } from "./base.js";

const FAMILY_ORDER = ["Heart failure", "Coronary", "Valve", "Arrhythmia", "Device", "Comorbidity"];
const SEVERITY_ORDER = { red: 0, orange: 1, yellow: 2, blue: 3 } as const;

// Suggestions that propose a drug of the same class (an SGLT2 inhibitor from the HF rule and from
// the diabetes rule, a GLP-1 RA from the diabetes and obesity rules, finerenone from the HF and
// cardiorenal rules) are shown once: the most urgent card carries the others as "also".
export function mergeKey(r: { action?: any }) {
  const a = typeof r.action === "string" ? JSON.parse(r.action) : r.action;
  if (a?.type !== "start-med") return null;
  return `start:${drugClassOf(a.code)}`;
}

export async function recommendations(tx: Q, patientId: string) {
  const rows = (
    await tx.query(
      `SELECT id,rule_id,rule_version,rule_status,severity,title,detail,facts,missing,action,created_at FROM cf.recommendation WHERE patient_id=$1 AND status='active'`,
      [patientId],
    )
  ).rows as any[];
  rows.sort((a, b) => SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] - SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER] || String(a.created_at).localeCompare(String(b.created_at)));
  const out: any[] = [];
  const byKey = new Map<string, any>();
  for (const r of rows) {
    const key = mergeKey(r);
    const lead = key ? byKey.get(key) : null;
    if (lead) {
      lead.also.push({ id: r.id, rule_id: r.rule_id, rule_status: r.rule_status, title: r.title, detail: r.detail, facts: r.facts });
      continue;
    }
    const card = { ...r, also: [] as any[] };
    if (key) byKey.set(key, card);
    out.push(card);
  }
  return out;
}

export function header(s: PatientState) {
  const ef = s.resolved("lvef").current;
  const ctx = openContext(s);
  const dis = latestDischarge(s);
  let where = "Outpatient";
  if (s.deceased) where = `Deceased · ${fmtDay(s.status.vital!.effective_on, { year: true })}`;
  else if (ctx?.kind === "admission") where = `Inpatient · ${ctx.location ?? "ward"}`;
  else if (ctx?.kind === "clinic_visit") where = `In clinic · ${ctx.service ?? "OPD"}`;
  else if (dis && dis.ended_at && daysBetween(dis.ended_at, s.today) <= 30) where = `Post-discharge · day ${daysBetween(dis.ended_at, s.today)}`;
  return {
    id: s.patient.id,
    name: s.patient.name,
    mrn: s.patient.mrn,
    sex: s.patient.sex,
    age: s.patient.age,
    allergies: s.patient.allergies,
    civilId: s.patient.civil_id,
    nationality: s.patient.nationality,
    mobile: s.patient.mobile,
    where,
    openContext: ctx,
    diagnoses: [...s.conditions].sort((a, b) => FAMILY_ORDER.indexOf(DIAGNOSIS[a.code]?.family ?? "") - FAMILY_ORDER.indexOf(DIAGNOSIS[b.code]?.family ?? "")).map((c) => ({
      id: c.logical_id,
      code: c.code,
      label: DIAGNOSIS[c.code]?.tags.includes("hf") && ef?.value_num != null ? `${c.display} · EF ${formatNumber(ef.value_num, 0)}%` : conditionLabel(c),
      family: DIAGNOSIS[c.code]?.family ?? "Other",
      onset: c.onset,
    })),
    riskFactors: riskRow(s),
    deceased: s.deceased,
    status: s.status,
    readmission: ctx?.kind === "admission" ? (ctx.summary as any)?.readmission ?? null : null,
  };
}

// "Prosthetic valve / repair · Aortic · Mechanical"
export function conditionLabel(c: { code: string; display: string; attributes?: Record<string, unknown> }) {
  const extra = attributesText(c.code, c.attributes);
  if (c.code === "cied" && c.attributes?.type) return String(c.attributes.type);
  if (c.code === "prosthetic-valve") {
    const pos = c.attributes?.position ? String(c.attributes.position) : "";
    const type = String(c.attributes?.type ?? "");
    const what = type === "Mechanical" ? "mechanical valve" : type.startsWith("Bioprosthetic") ? "bioprosthetic valve" : type === "TAVI" ? "TAVI" : type === "Repair / ring" ? "valve repair" : "prosthetic valve";
    return `${pos} ${what}`.trim().replace(/^./, (x) => x.toUpperCase());
  }
  return extra ? `${c.display} · ${extra}` : c.display;
}

export function currentBmi(s: PatientState) {
  const w = s.resolved("weight").current, h = s.resolved("height").current;
  if (!w?.value_num || !h?.value_num || daysBetween(w.effective_at, s.today) > 365) return null;
  return { value: Math.round(bmi(w.value_num, h.value_num) * 10) / 10, at: w.effective_at };
}

type HxStatus = "present" | "absent" | "unknown" | "not-assessed" | "na" | "not-recorded";
// Structured history: every item says present / absent / unknown / not assessed / not recorded,
// with its date and where it came from. Nothing missing is shown as "no".
export function historyView(s: PatientState) {
  const b = currentBmi(s);
  const covered = new Set(HISTORY_ITEMS.flatMap((i) => i.conditions ?? []));
  const items = HISTORY_ITEMS.map((item) => {
    const stmt = s.resolved(historyCode(item.key)).current;
    const conds = item.conditions ? s.conditions.filter((c) => item.conditions!.includes(c.code)) : [];
    let status: HxStatus = "not-recorded";
    let text = "Not recorded";
    let at: string | null = null;
    let source: "diagnosis" | "history" | null = null;
    let conflict: string | null = null;
    const details: Record<string, number> = {};
    if (item.conditions) {
      if (conds.length) {
        status = "present";
        text = conds.map((c) => conditionLabel(c)).join(" · ");
        source = "diagnosis";
      } else if (stmt?.value_text) {
        status = stmt.value_text === "no" ? "absent" : (stmt.value_text as HxStatus);
        text = ANSWER_LABEL[stmt.value_text] ?? stmt.value_text;
        at = stmt.effective_at;
        source = "history";
      }
    } else {
      const legacy = item.key === "smoking" ? s.conditions.find((c) => c.code === "smoker") : undefined;
      if (stmt?.value_text) {
        const opt = item.options!.find((o) => o.value === stmt.value_text);
        status = opt?.present ? "present" : stmt.value_text === "unknown" || stmt.value_text === "not-assessed" ? (stmt.value_text as HxStatus) : "absent";
        const detail = (item.details ?? [])
          .map((d) => {
            const o = s.resolved(`${historyCode(item.key)}.${d.key}`).current;
            if (!o || o.effective_at !== stmt.effective_at || o.value_num == null || !d.when.includes(stmt.value_text!)) return null;
            details[d.key] = o.value_num;
            return d.key === "quitYear" ? `stopped ${o.value_num}` : `${formatNumber(o.value_num, 0)} ${d.label.toLowerCase()}`;
          })
          .filter(Boolean);
        text = [opt?.label ?? stmt.value_text, ...detail].join(" · ");
        at = stmt.effective_at;
        source = "history";
        if (legacy && stmt.value_text !== "current") conflict = `Diagnosis list still says "Current smoker" (added ${fmtDay(legacy.recorded_at, { year: true })})`;
      } else if (legacy) {
        status = "present";
        text = "Current smoker";
        source = "diagnosis";
        conflict = "Recorded only as a diagnosis: confirm the smoking status";
      }
    }
    if (item.key === "obesity" && b) text = `${text} · BMI ${formatNumber(b.value, 1)}`;
    return {
      key: item.key, section: item.section, label: item.label, short: item.short, major: !!item.major,
      status, text, at, source, conflict,
      answer: stmt?.value_text ?? null,
      details,
      conditions: conds.map((c) => ({ id: c.logical_id, code: c.code, display: c.display, label: conditionLabel(c), onset: c.onset, onsetYear: c.attributes?.onsetYear ?? null, attributes: c.attributes ?? {} })),
    };
  });
  const comorbidities = s.conditions
    .filter((c) => !covered.has(c.code) && c.code !== "smoker")
    .map((c) => ({ id: c.logical_id, code: c.code, label: conditionLabel(c), family: DIAGNOSIS[c.code]?.family ?? "Other", onset: c.onset, onsetYear: c.attributes?.onsetYear ?? null, attributes: c.attributes ?? {} }));
  return {
    items,
    bmi: b,
    comorbidities,
    identity: { civilId: s.patient.civil_id, nationality: s.patient.nationality, mobile: s.patient.mobile, allergies: s.patient.allergies },
    missing: items.filter((i) => i.status === "not-recorded").map((i) => i.label),
  };
}

// Compact risk-factor row for the patient header.
function riskRow(s: PatientState) {
  const h = historyView(s);
  const risk = h.items.filter((i) => i.section === "risk");
  const present = risk
    .filter((i) => i.status === "present")
    .map((i) => ({
      key: i.key,
      label:
        i.key === "smoking" ? (i.text.startsWith("Ex") ? "Ex-smoker" : "Current smoker")
        : i.key === "ckd" ? i.conditions.map((c) => c.display.replace(" (with albuminuria)", "")).join(", ")
        : i.key === "diabetes" ? i.conditions.map((c) => (c.code === "t1dm" ? "Type 1 diabetes" : "Type 2 diabetes")).join(", ")
        : i.key === "obesity" && h.bmi ? `Obesity · BMI ${formatNumber(h.bmi.value, 1)}`
        : i.short,
      major: i.major && !(i.key === "smoking" && i.text.startsWith("Ex")),
      conflict: !!i.conflict,
    }));
  if (h.bmi && !present.some((p) => p.key === "obesity")) present.push({ key: "bmi", label: `BMI ${formatNumber(h.bmi.value, 1)}`, major: false, conflict: false });
  return {
    present,
    absent: risk.filter((i) => i.status === "absent").length,
    unknown: risk.filter((i) => i.status === "unknown" || i.status === "not-assessed").length,
    notRecorded: risk.filter((i) => i.status === "not-recorded").map((i) => i.short),
  };
}

export function medicationGroups(s: PatientState) {
  const live = s.meds.filter((m) => m.status !== "stopped");
  const groups = PURPOSE_ORDER.map((purpose) => ({
    purpose,
    meds: live
      .filter((m) => m.purpose === purpose)
      .map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        drugClass: m.drugClass,
        status: m.status,
        dose: doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit),
        doseValue: m.doseValue,
        frequency: m.frequency,
        route: m.route,
        startedAt: m.startedAt,
        tags: m.tags,
        indication: m.indication,
        lastChange: m.lastChange ? { kind: m.lastChange.kind, at: m.lastChange.effective_at } : null,
        planned: s.plan.find((p) => p.status === "planned" && p.medication_id === m.id) ?? null,
      })),
  })).filter((g) => g.meds.length);
  const stopped = s.meds.filter((m) => m.status === "stopped").map((m) => ({ id: m.id, name: m.name, stoppedAt: m.lastChange?.effective_at ?? null }));
  return { groups, stopped };
}

const KEY_RESULTS = ["potassium", "creatinine", "egfr", "sodium", "haemoglobin", "nt-probnp", "ldl-c", "hba1c"];

export function results(s: PatientState, codes = KEY_RESULTS) {
  return codes
    .map((code) => {
      const r = s.resolved(code);
      if (!r.current) return null;
      const def = MEASURES[code];
      return {
        code,
        label: def?.short ?? code,
        display: def?.display ?? code,
        unit: def?.unit ?? "",
        decimals: def?.decimals ?? 0,
        ref: def?.ref ?? null,
        current: { id: r.current.id, value: r.current.value_num, at: r.current.effective_at, quality: r.current.quality, source: r.current.source },
        reason: r.reason,
        latestId: r.latest?.id,
        series: r.history.slice(0, 6).reverse().map((o) => ({ id: o.id, value: o.value_num, at: o.effective_at, status: o.status, quality: o.quality })),
      };
    })
    .filter(Boolean);
}

// Compares now with the last reference point (discharge, else last closed visit).
export function whatChanged(s: PatientState) {
  const dis = latestDischarge(s);
  const lastVisit = [...s.contexts].reverse().find((c) => c.status === "closed" && c.kind === "clinic_visit");
  const ref = [dis, lastVisit].filter(Boolean).sort((a, b) => ((a!.ended_at ?? "") < (b!.ended_at ?? "") ? 1 : -1))[0] ?? null;
  if (!ref?.ended_at) return { since: null, label: null, items: [] as any[] };
  const since = ref.ended_at;
  const items: { kind: string; label: string; before?: string; after?: string; tone?: string; text?: string }[] = [];
  const valueAt = (code: string, at: string) =>
    s.resolved(code).history.find((o) => o.effective_at <= at && o.status === "final") ??
    // for discharge the admission's last value is the baseline
    null;
  const direction: Record<string, "up-bad" | "down-bad" | "neutral"> = {
    potassium: "up-bad", creatinine: "up-bad", egfr: "down-bad", weight: "up-bad", "nt-probnp": "up-bad", lvef: "down-bad", sodium: "down-bad", haemoglobin: "down-bad",
  };
  for (const code of ["potassium", "creatinine", "egfr", "weight", "nt-probnp", "lvef", "sodium", "haemoglobin"]) {
    const now = s.resolved(code).current;
    const before = valueAt(code, since);
    if (!now || !before || now.id === before.id || now.effective_at <= since) continue;
    const def = MEASURES[code];
    const diff = now.value_num! - before.value_num!;
    if (Math.abs(diff) < 10 ** -(def.decimals + 1)) continue;
    const bad = direction[code] === "up-bad" ? diff > 0 : direction[code] === "down-bad" ? diff < 0 : false;
    const ref = def.ref;
    const out = (x: number) => !!ref && ((ref.high != null && x > ref.high) || (ref.low != null && x < ref.low));
    const outOfRange = out(now.value_num!);
    // small moves inside the reference range are noise, not change
    if (ref && !outOfRange && !out(before.value_num!) && Math.abs(diff) / Math.max(Math.abs(before.value_num!), 1e-9) < 0.1) continue;
    items.push({
      kind: "value",
      label: def.display,
      before: formatNumber(before.value_num!, def.decimals),
      after: formatNumber(now.value_num!, def.decimals),
      text: def.unit,
      tone: bad ? (outOfRange ? "red" : "orange") : "green",
    });
  }
  const medChanges = s.meds.flatMap((m) =>
    m.events.filter((e) => e.effective_at > since && e.kind !== "continue").map((e) => ({ m, e })),
  );
  const started = medChanges.filter((x) => x.e.kind === "start").map((x) => x.m.name);
  if (started.length) items.push({ kind: "text", label: "Started", text: started.join(", ") });
  for (const x of medChanges.filter((x) => x.e.kind === "increase" || x.e.kind === "decrease"))
    items.push({ kind: "text", label: x.e.kind === "increase" ? "Increased" : "Reduced", text: `${x.m.name} → ${doseLabel(MEDICATION[x.m.code], x.e.dose_value)}` });
  const held = medChanges.filter((x) => x.e.kind === "hold" || x.e.kind === "stop").map((x) => `${x.m.name} (${x.e.kind === "hold" ? "held" : "stopped"})`);
  if (held.length) items.push({ kind: "text", label: "Held / stopped", text: held.join(", "), tone: "orange" });
  const completed = s.plan.filter((p) => p.status === "completed" && p.completed_at && p.completed_at > since);
  if (completed.length) items.push({ kind: "text", label: "Completed", text: completed.map((p) => p.title).join(", "), tone: "green" });
  const cong = s.resolved("congestion");
  if (cong.current && cong.current.effective_at > since) {
    const prev = cong.history.find((o) => o.effective_at <= since);
    if (prev && prev.value_text !== cong.current.value_text)
      items.push({ kind: "value", label: "Congestion", before: prev.value_text ?? "", after: cong.current.value_text ?? "", tone: cong.current.value_text === "None" ? "green" : "orange" });
  }
  return { since, label: ref.kind === "admission" ? "Since discharge" : "Since last visit", items };
}

export function planView(s: PatientState) {
  const withState = s.plan.map((p) => ({
    id: p.id,
    category: p.category,
    title: p.title,
    reason: p.reason,
    dueDate: p.due_date,
    status: p.status,
    view: planStatusView(p.status, p.due_date, s.today),
    outcome: p.outcome,
    completedAt: p.completed_at,
    source: (() => {
      const c = s.contexts.find((c) => c.id === p.source_context_id);
      if (!c) return null;
      return { kind: c.kind, at: c.ended_at ?? c.started_at, label: c.kind === "admission" ? "Discharge plan" : "Visit plan" };
    })(),
    completesOn: p.completes_on,
    version: p.version,
    medicationId: p.medication_id,
  }));
  const order = { overdue: 0, due: 1, planned: 2, done: 3, deferred: 4, cancelled: 5, superseded: 6 } as Record<string, number>;
  return withState.sort((a, b) => order[a.view] - order[b.view] || (a.dueDate ?? "9") .localeCompare(b.dueDate ?? "9"));
}

// Guideline goals are clinical content still in review: shown on sandbox sites only.
export async function summary(tx: Q, patientId: string, siteMode: "sandbox" | "production" = "production") {
  const s = await loadState(tx, patientId);
  const plan = planView(s);
  // the active plan: what came out of the most recent plan-making context plus anything still open
  const lastSource = [...s.contexts].reverse().find((c) => s.plan.some((p) => p.source_context_id === c.id));
  const active = plan.filter((p) => p.view !== "cancelled" && p.view !== "superseded" && (p.status === "planned" || (lastSource && s.plan.find((x) => x.id === p.id)?.source_context_id === lastSource.id)));
  const attention = await recommendations(tx, patientId);
  const changes = whatChanged(s);
  return {
    header: header(s),
    today: s.today,
    overview: overview(s, attention, plan, changes),
    attention,
    changes,
    plan: active,
    planSource: lastSource ? { kind: lastSource.kind, at: lastSource.ended_at ?? lastSource.started_at } : null,
    medications: medicationGroups(s),
    results: results(s),
    lvef: (() => {
      const r = s.resolved("lvef");
      return r.current ? { value: r.current.value_num, at: r.current.effective_at, quality: r.current.quality, reason: r.reason, latestQuality: r.latest?.quality, latestAt: r.latest?.effective_at, latestValue: r.latest?.value_num } : null;
    })(),
    vitals: ["sbp", "dbp", "hr", "weight"].map((c) => {
      const cur = s.resolved(c).current;
      return cur ? { code: c, value: cur.value_num, at: cur.effective_at } : null;
    }).filter(Boolean),
    upcoming: plan.filter((p) => p.status === "planned" && p.dueDate && p.dueDate > s.today).slice(0, 4),
    // guideline goals: shown on every site (rules justified by current guidelines are published)
    targets: targets(s),
    // HF profile: type with dates, LVEF history, status, therapy per drug (HF patients only)
    hf: hfProfile(s),
    // why a drug class is not given (recorded once, reused by every rule)
    barriers: s.barriers.map((b) => ({
      cls: b.drug_class, label: classLabel(b.drug_class), category: b.category, reason: BARRIER_LABEL[b.category], detail: b.detail, at: b.effective_at,
      active: !!activeBarrier(s, b.drug_class), lasting: b.category === "intolerance" || b.category === "contraindication",
    })),
  };
}

// The five questions at the top of the patient page (blueprint P1.10).
export function overview(s: PatientState, attention: any[], plan: ReturnType<typeof planView>, changes: ReturnType<typeof whatChanged>) {
  const ctx = openContext(s);
  const dis = latestDischarge(s);
  const lastVisit = [...s.contexts].reverse().find((c) => c.kind === "clinic_visit" && c.status === "closed");
  let why: { text: string; sub?: string };
  if (s.deceased) why = { text: `Deceased ${fmtDay(s.status.vital!.effective_on, { year: true })}` };
  else if (ctx?.kind === "admission")
    why = { text: `Admitted ${fmtDay(ctx.started_at)} · day ${daysBetween(ctx.started_at, s.today) + 1}`, sub: ctx.reasons.join(", ") || undefined };
  else if (ctx?.kind === "clinic_visit") why = { text: `In clinic today · ${ctx.service ?? "OPD"}`, sub: ctx.reasons.join(", ") || undefined };
  else if (dis?.ended_at && daysBetween(dis.ended_at, s.today) <= 30)
    why = { text: `Discharged ${fmtDay(dis.ended_at)} · day ${daysBetween(dis.ended_at, s.today)}`, sub: dis.reasons.join(", ") || undefined };
  else why = { text: lastVisit ? `Last seen ${fmtDay(lastVisit.started_at, { year: true })}` : "No visit recorded yet", sub: lastVisit?.reasons.join(", ") || undefined };
  const sev = (k: string) => attention.filter((a) => a.severity === k).length;
  const unfinished = plan.filter((p) => p.view === "overdue" || p.view === "due");
  const next = plan.filter((p) => p.status === "planned" && p.dueDate && p.dueDate > s.today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return {
    why,
    changed: { since: changes.since, label: changes.label, count: changes.items.length, top: changes.items.slice(0, 3).map((i: any) => i.after != null ? `${i.label} ${i.before ?? "—"} → ${i.after}` : i.text ?? i.label) },
    attention: { red: sev("red"), orange: sev("orange"), yellow: sev("yellow"), blue: sev("blue"), top: attention[0]?.title ?? null },
    unfinished: { overdue: unfinished.filter((p) => p.view === "overdue").length, due: unfinished.filter((p) => p.view === "due").length, top: unfinished.slice(0, 2).map((p) => p.title) },
    next: next.slice(0, 2).map((p) => ({ title: p.title, dueDate: p.dueDate })),
  };
}

export async function journey(tx: Q, patientId: string) {
  const s = await loadState(tx, patientId);
  const events = (
    await tx.query(
      `SELECT id,occurred_at,kind,category,title,detail,ref_type,ref_id,context_id FROM cf.clinical_event WHERE patient_id=$1 ORDER BY occurred_at, recorded_at`,
      [patientId],
    )
  ).rows.map((e: any) => ({ ...e, occurred_at: new Date(e.occurred_at).toISOString(), planned: false }));
  const planned = s.plan
    .filter((p) => p.status === "planned" && p.due_date && p.due_date > s.today)
    .map((p) => ({
      id: "plan-" + p.id, occurred_at: p.due_date + "T09:00:00.000Z", kind: "planned", category: "plan", title: p.title, detail: p.reason,
      ref_type: "plan_action", ref_id: p.id, context_id: p.source_context_id, planned: true,
    }));
  const contexts = s.contexts.map((c) => {
    const actions = s.plan.filter((p) => p.source_context_id === c.id);
    const meds = s.meds.flatMap((m) =>
      m.events
        .filter((e) => e.effective_at >= c.started_at && (!c.ended_at || e.effective_at <= c.ended_at) && e.kind !== "continue")
        .map((e) => ({ name: m.name, kind: e.kind, dose: doseLabel(MEDICATION[m.code], e.dose_value, e.dose_unit) })),
    );
    return {
      id: c.id, kind: c.kind, status: c.status, startedAt: c.started_at, endedAt: c.ended_at, location: c.location, service: c.service, reasons: c.reasons, summary: c.summary,
      actions: actions.map((a) => ({ id: a.id, title: a.title, dueDate: a.due_date, view: planStatusView(a.status, a.due_date, s.today) })),
      meds,
    };
  });
  return { today: s.today, events: [...events, ...planned], contexts };
}

// One set-based query for the whole list (latency to the database dominates, not query cost).
export async function worklist(q: Q, siteId: string) {
  const today = todayFn();
  const rows = (
    await q.query<any>(
      `SELECT p.id, p.name, p.mrn, p.sex, p.birth_date,
         oc.kind AS open_kind, oc.location AS open_location, oc.service AS open_service,
         ld.ended_at AS last_discharge,
         coalesce(cd.codes, '{}') AS codes,
         tr.severity AS top_severity, tr.title AS top_title, tr.rule_status AS top_status,
         rc.recs,
         nx.title AS next_title, nx.due_date AS next_due,
         coalesce(pc.overdue,0) overdue, coalesce(pc.due_today,0) due_today
       FROM cf.patient p
       LEFT JOIN LATERAL (SELECT kind, location, service FROM cf.care_context c WHERE c.patient_id=p.id AND c.status='open' ORDER BY started_at DESC LIMIT 1) oc ON true
       LEFT JOIN LATERAL (SELECT ended_at FROM cf.care_context c WHERE c.patient_id=p.id AND c.kind='admission' AND c.status='closed' ORDER BY ended_at DESC LIMIT 1) ld ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(code) codes FROM (SELECT DISTINCT ON (logical_id) code, status FROM cf.condition c WHERE c.patient_id=p.id ORDER BY logical_id, version DESC) x WHERE status='active'
       ) cd ON true
       LEFT JOIN LATERAL (
         SELECT severity, title, rule_status FROM cf.recommendation r WHERE r.patient_id=p.id AND r.status='active'
         ORDER BY CASE severity WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'yellow' THEN 2 ELSE 3 END, created_at DESC LIMIT 1
       ) tr ON true
       LEFT JOIN LATERAL (
         SELECT coalesce(json_agg(json_build_object('s', severity, 'a', action) ORDER BY CASE severity WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'yellow' THEN 2 ELSE 3 END), '[]') recs
         FROM cf.recommendation r WHERE r.patient_id=p.id AND r.status='active'
       ) rc ON true
       LEFT JOIN LATERAL (SELECT title, due_date FROM cf.plan_action a WHERE a.patient_id=p.id AND a.status='planned' AND a.due_date IS NOT NULL ORDER BY due_date LIMIT 1) nx ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE due_date < $2::date) overdue, count(*) FILTER (WHERE due_date = $2::date) due_today
         FROM cf.plan_action a WHERE a.patient_id=p.id AND a.status='planned'
       ) pc ON true
       WHERE p.site_id=$1
         AND coalesce((SELECT status FROM cf.status_event se WHERE se.patient_id=p.id AND se.kind='vital' ORDER BY effective_on DESC, recorded_at DESC LIMIT 1), 'alive') <> 'died'`,
      [siteId, today],
    )
  ).rows;
  const out = rows.map((r) => {
    const codes: string[] = r.codes ?? [];
    const conds = codes.map((c) => DIAGNOSIS[c]).filter(Boolean);
    const main = conds.filter((d) => ["Heart failure", "Coronary", "Valve", "Arrhythmia"].includes(d.family)).map((d) => d.display);
    const ckd = conds.find((d) => d.code.startsWith("ckd"));
    let where = "Outpatient";
    if (r.open_kind === "admission") where = `Inpatient · ${r.open_location ?? "ward"}`;
    else if (r.open_kind === "clinic_visit") where = `In clinic · ${r.open_service ?? "OPD"}`;
    else if (r.last_discharge && daysBetween(new Date(r.last_discharge).toISOString(), today) <= 30)
      where = `Post-discharge · day ${daysBetween(new Date(r.last_discharge).toISOString(), today)}`;
    const nextDue = r.next_due ? String(r.next_due).slice(0, 10) : null;
    return {
      id: r.id,
      name: r.name,
      mrn: r.mrn,
      age: ageOn(String(r.birth_date).slice(0, 10), today),
      sex: r.sex,
      where,
      inpatient: r.open_kind === "admission",
      postDischarge: where.startsWith("Post-discharge"),
      problem: [...main.slice(0, 2), ...(ckd ? [ckd.display] : [])].join(" · ") || conds[0]?.display || "—",
      alert: r.top_severity ? { severity: r.top_severity, title: r.top_title, draft: r.top_status !== "PUBLISHED" } : null,
      alertCounts: countMerged(typeof r.recs === "string" ? JSON.parse(r.recs) : r.recs ?? []),
      next: r.next_title ? { title: r.next_title, dueDate: nextDue, view: planStatusView("planned", nextDue, today) } : null,
      overdue: Number(r.overdue),
      dueToday: Number(r.due_today),
    };
  });
  const rank = (r: any) => (r.alert ? SEVERITY_ORDER[r.alert.severity as keyof typeof SEVERITY_ORDER] : 9) * 10 - (r.overdue ? 1 : 0);
  out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return out;
}

// alert counts with same-class drug suggestions counted once (as on the patient page)
function countMerged(recs: { s: string; a: any }[]) {
  const seen = new Set<string>();
  const c = { red: 0, orange: 0, yellow: 0, blue: 0 } as Record<string, number>;
  for (const r of recs) {
    const k = mergeKey({ action: r.a });
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    c[r.s] = (c[r.s] ?? 0) + 1;
  }
  return c;
}

export async function attentionCount(q: Q, siteId: string) {
  const r = (
    await q.query<{ n: number }>(
      `SELECT count(DISTINCT r.patient_id)::int n FROM cf.recommendation r JOIN cf.patient p ON p.id=r.patient_id
       WHERE p.site_id=$1 AND r.status='active' AND r.severity IN ('red','orange')
         AND coalesce((SELECT status FROM cf.status_event se WHERE se.patient_id=p.id AND se.kind='vital' ORDER BY effective_on DESC, recorded_at DESC LIMIT 1), 'alive') <> 'died'`,
      [siteId],
    )
  ).rows[0];
  return Number(r?.n ?? 0);
}

export { fmtDay };
