// Read models: Summary, What changed, Journey, Worklist. All are projections of the kernel.
import type { Q } from "../db/db.js";
import { DIAGNOSIS, MEASURES, PURPOSE_ORDER, doseLabel, MEDICATION, formatNumber } from "../../shared/catalog.js";
import { daysBetween, fmtDay, planStatusView } from "../../shared/clinical.js";
import { loadState, latestDischarge, openContext, type PatientState } from "./state.js";

const FAMILY_ORDER = ["Heart failure", "Coronary", "Valve", "Arrhythmia", "Comorbidity"];
const SEVERITY_ORDER = { red: 0, orange: 1, yellow: 2, blue: 3 } as const;

export async function recommendations(tx: Q, patientId: string) {
  const rows = (
    await tx.query(
      `SELECT id,rule_id,rule_version,rule_status,severity,title,detail,facts,missing,action,created_at FROM cf.recommendation WHERE patient_id=$1 AND status='active'`,
      [patientId],
    )
  ).rows as any[];
  return rows.sort((a, b) => SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] - SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER]);
}

export function header(s: PatientState) {
  const ef = s.resolved("lvef").current;
  const ctx = openContext(s);
  const dis = latestDischarge(s);
  let where = "Outpatient";
  if (ctx?.kind === "admission") where = `Inpatient · ${ctx.location ?? "ward"}`;
  else if (ctx?.kind === "clinic_visit") where = `In clinic · ${ctx.service ?? "OPD"}`;
  else if (dis && dis.ended_at && daysBetween(dis.ended_at, s.today) <= 30) where = `Post-discharge · day ${daysBetween(dis.ended_at, s.today)}`;
  return {
    id: s.patient.id,
    name: s.patient.name,
    mrn: s.patient.mrn,
    sex: s.patient.sex,
    age: s.patient.age,
    allergies: s.patient.allergies,
    where,
    openContext: ctx,
    diagnoses: [...s.conditions].sort((a, b) => FAMILY_ORDER.indexOf(DIAGNOSIS[a.code]?.family ?? "") - FAMILY_ORDER.indexOf(DIAGNOSIS[b.code]?.family ?? "")).map((c) => ({
      id: c.logical_id,
      code: c.code,
      label: DIAGNOSIS[c.code]?.tags.includes("hf") && ef?.value_num != null ? `${c.display} · EF ${formatNumber(ef.value_num, 0)}%` : c.display,
      family: DIAGNOSIS[c.code]?.family ?? "Other",
      onset: c.onset,
    })),
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

export async function summary(tx: Q, patientId: string) {
  const s = await loadState(tx, patientId);
  const plan = planView(s);
  // the active plan: what came out of the most recent plan-making context plus anything still open
  const lastSource = [...s.contexts].reverse().find((c) => s.plan.some((p) => p.source_context_id === c.id));
  const active = plan.filter((p) => p.view !== "cancelled" && p.view !== "superseded" && (p.status === "planned" || (lastSource && s.plan.find((x) => x.id === p.id)?.source_context_id === lastSource.id)));
  return {
    header: header(s),
    today: s.today,
    attention: await recommendations(tx, patientId),
    changes: whatChanged(s),
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

export async function worklist(tx: Q, siteId: string) {
  const patients = (await tx.query(`SELECT id FROM cf.patient WHERE site_id=$1 ORDER BY name`, [siteId])).rows as { id: string }[];
  const rows = [];
  for (const { id } of patients) {
    const s = await loadState(tx, id);
    const recs = await recommendations(tx, id);
    const h = header(s);
    const open = s.plan.filter((p) => p.status === "planned" && p.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
    const next = open[0] ?? null;
    const overdue = open.filter((p) => p.due_date! < s.today).length;
    const dueToday = open.filter((p) => p.due_date === s.today).length;
    const main = s.conditions.filter((c) => ["Heart failure", "Coronary", "Valve", "Arrhythmia"].includes(DIAGNOSIS[c.code]?.family ?? "")).map((c) => c.display);
    const ckd = s.conditions.find((c) => c.code.startsWith("ckd"));
    rows.push({
      id,
      name: h.name,
      mrn: h.mrn,
      age: h.age,
      sex: h.sex,
      where: h.where,
      inpatient: h.openContext?.kind === "admission",
      postDischarge: h.where.startsWith("Post-discharge"),
      problem: [...main.slice(0, 2), ...(ckd ? [ckd.display] : [])].join(" · ") || s.conditions[0]?.display || "—",
      alert: recs[0] ? { severity: recs[0].severity, title: recs[0].title, draft: recs[0].rule_status !== "PUBLISHED" } : null,
      alertCounts: {
        red: recs.filter((r) => r.severity === "red").length,
        orange: recs.filter((r) => r.severity === "orange").length,
        yellow: recs.filter((r) => r.severity === "yellow").length,
        blue: recs.filter((r) => r.severity === "blue").length,
      },
      next: next ? { title: next.title, dueDate: next.due_date, view: planStatusView(next.status, next.due_date, s.today) } : null,
      overdue,
      dueToday,
    });
  }
  const rank = (r: any) => (r.alert ? SEVERITY_ORDER[r.alert.severity as keyof typeof SEVERITY_ORDER] : 9) * 10 - (r.overdue ? 1 : 0);
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return rows;
}

export { fmtDay };
