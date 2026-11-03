// The overview snapshot (3 Nov 2026 — Ahmed: "the overview sometimes does not show the story in glance and
// spreads the findings… patient is going for operation so the pre-procedure pathway, echo results and stress
// MIBI result are priorities to show. Result of stress MIBI done recently does not show. I need the overview to
// give me what is needed to be done, the story and the actual running problem. Keep it simple and to the point").
// Read-only, from the record; no new clinical thresholds:
//  - now: the running problem(s) — current or recent admission, pathways in progress, a planned operation or
//    procedure, a recent cardiac event, a recent abnormal test without a recorded next step;
//  - tests: the latest report of each investigation (echo, MIBI, stress, CT coronary, cath, Holter, ECG…),
//    newest first, abnormal ones marked. Before this the overview showed only the echo's EF number.
import type { PatientState, StudyRow } from "./state.js";
import { STUDY, studySummary, obstructiveCad } from "../../shared/studies.js";
import { daysBetween, fmtDay, localDay } from "../../shared/clinical.js";
import { formatRange } from "../../shared/catalog.js";
import { WIZARDS } from "../../shared/wizards.js";
import { cardiacEvents } from "./views.js";

export type Tone = "good" | "bad" | "warn" | "neutral";
export type NowItem = { key: string; text: string; sub?: string; tone: Tone; at: string | null };
export type TestItem = { id: string; kind: string; label: string; at: string; when: string; text: string; sub: string; tone: Tone; recent: boolean };

// a planned operation or procedure, as the clinician wrote it (the same words the pre-procedure trigger reads)
export const SURGERY = /pre-?op|pre-?operative|surgery|surgical|operation|clearance|transplant/i;
// a work-up test ("Echo (pre-transplant work-up)") is a test, not the operation
export const isOperationPlan = (p: { category: string; title: string; status: string }) =>
  p.status === "planned" && (p.category === "procedure" || (SURGERY.test(p.title) && !["investigation", "monitoring"].includes(p.category)));
const MIBI_PREFIX = /^(Adenosine|Regadenoson|Dipyridamole|Dobutamine|Exercise) MIBI · /;
const reportLine = (kind: string, a: Record<string, any>) => studySummary(kind, a).replace(MIBI_PREFIX, "$1 · ");
const ISCHAEMIA_KINDS = new Set(["nuclear", "stress"]);
const ANATOMY_KINDS = new Set(["cath", "ccta"]);
const short = (t: string, n = 180) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t);

// the reported result in one tone: ischaemia, obstructive disease, LVEF <50% (CardioFlow's HFrEF line) are "bad";
// a normal perfusion study or a negative stress test "good"; everything else as written
export function testTone(st: StudyRow, lvef?: number | null): Tone {
  const a = st.attributes ?? {};
  if (st.kind === "echo") return lvef != null && lvef < 50 ? "bad" : "neutral";
  if (st.kind === "nuclear") return a.result === "Normal perfusion" ? "good" : /ischaemia|scar/i.test(String(a.result ?? "")) ? "bad" : a.result === "Equivocal" ? "warn" : "neutral";
  if (st.kind === "stress") return a.result === "Negative" ? "good" : a.result === "Positive for ischaemia" ? "bad" : a.result === "Equivocal" ? "warn" : "neutral";
  if (ANATOMY_KINDS.has(st.kind)) return obstructiveCad(st.kind, a) ? "bad" : "neutral";
  if (st.kind === "holter") return a.nsvt === "Yes" || (a.avBlock && !["None", "First-degree"].includes(a.avBlock)) || /AF/.test(String(a.rhythm ?? "")) ? "warn" : "neutral";
  return "neutral";
}

function echoText(s: PatientState, st: StudyRow) {
  const ef = s.observations.find((o) => o.code === "lvef" && o.study_id === st.id && o.value_num != null);
  const efText = ef ? `EF ${formatRange(ef.value_num!, ef.value_high ?? null, 0)}%` : null;
  return { text: [efText, ...st.findings.slice(0, 4)].filter(Boolean).join(" · ") || "Echo", lvef: ef?.value_num ?? null };
}

export function keyTests(s: PatientState): TestItem[] {
  const latest = new Map<string, StudyRow>();
  for (const st of [...s.studies].sort((a, b) => a.performed_at.localeCompare(b.performed_at))) {
    if (st.kind === "culture" && daysBetween(st.performed_at, s.today) > 60) continue;
    latest.set(st.kind, st);
  }
  return [...latest.values()]
    .filter((st) => daysBetween(st.performed_at, s.today) <= 3 * 365)
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))
    .slice(0, 6)
    .map((st) => {
      const e = st.kind === "echo" ? echoText(s, st) : null;
      const label = st.kind === "echo" ? "Echo" : STUDY[st.kind]?.short ?? st.kind;
      const text = e ? e.text : reportLine(st.kind, st.attributes ?? {}) || label;
      const month = st.attributes?.datePrecision === "month";
      return {
        id: st.id, kind: st.kind, label, at: st.performed_at,
        when: month ? fmtDay(st.performed_at, { year: true }).replace(/^\d+ /, "") : fmtDay(st.performed_at, { year: true }),
        text, sub: short(st.conclusion ?? ""), tone: testTone(st, e?.lvef), recent: daysBetween(st.performed_at, s.today) <= 90,
      };
    });
}

export function runningProblems(s: PatientState): NowItem[] {
  const out: NowItem[] = [];
  const day = (d: string) => fmtDay(d, { year: true });
  // in hospital now, or discharged in the last 30 days
  for (const c of s.contexts.filter((c) => c.kind === "admission")) {
    if (c.status === "open" && !c.ended_at) out.push({ key: `adm-${c.id}`, text: `In hospital since ${day(c.started_at)} for ${c.reasons.join(", ")}`, tone: "bad", at: c.started_at });
    else if (c.ended_at && daysBetween(c.ended_at, s.today) <= 30) out.push({ key: `adm-${c.id}`, text: `Discharged ${day(c.ended_at)} after admission for ${c.reasons.join(", ")}`, sub: c.location ?? undefined, tone: "warn", at: c.ended_at });
  }
  // the reason for today's open visit
  for (const c of s.contexts.filter((c) => c.kind !== "admission" && c.status === "open" && c.reasons.length))
    out.push({ key: `visit-${c.id}`, text: `Seen for ${c.reasons.join(", ").toLowerCase()}`, tone: "neutral", at: c.started_at });
  // a planned operation or procedure
  for (const p of s.plan.filter(isOperationPlan))
    out.push({ key: `plan-${p.id}`, text: p.title, sub: [p.due_date ? `Due ${day(p.due_date)}` : null, p.reason || null].filter(Boolean).join(" · ") || undefined, tone: "warn", at: p.created_at });
  // tests ordered and not yet reported
  const awaited = s.plan.filter((p) => p.status === "planned" && p.category === "investigation").sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  if (awaited.length) out.push({ key: "awaited", text: `Awaiting: ${awaited.map((p) => `${p.title}${p.due_date ? ` (${day(p.due_date)})` : ""}`).join(" · ")}`, tone: "neutral", at: awaited[0].created_at });
  // pathways in progress
  for (const e of s.episodes.filter((e) => e.status === "open"))
    out.push({ key: `ep-${e.id}`, text: `${WIZARDS[e.wizard]?.title ?? e.wizard} in progress`, sub: `Since ${day(e.started_at)}`, tone: "neutral", at: e.started_at });
  // a cardiac event (MI, PCI, CABG, valve or device procedure) in the last 12 months
  const events = cardiacEvents(s).filter((e) => e.at && daysBetween(e.at, s.today) <= 365 && daysBetween(e.at, s.today) >= 0);
  if (events.length) out.push({ key: "event", text: events.map((e) => `${e.title}${e.detail ? ` (${e.detail})` : ""}`).join(" → ") + ` · ${events[events.length - 1].when}`, tone: "warn", at: events[0].at });
  // a new cardiac diagnosis in the last 90 days (AF, HF…)
  for (const c of s.conditions.filter((c) => c.status === "active" && c.onset && daysBetween(c.onset, s.today) <= 90 && !["acs-stemi", "acs-nstemi", "prior-mi", "prior-pci", "prior-cabg"].includes(c.code)))
    out.push({ key: `dx-${c.logical_id}`, text: `New: ${c.display}`, sub: `Since ${day(c.onset!)}`, tone: "warn", at: c.onset });
  // an ischaemia test or angiogram in the last 6 months showing disease, with no angiogram or revascularisation after it
  const abnormal = [...s.studies].filter((st) => (ISCHAEMIA_KINDS.has(st.kind) || ANATOMY_KINDS.has(st.kind)) && daysBetween(st.performed_at, s.today) <= 183 && testTone(st) === "bad")
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))[0];
  if (abnormal) {
    // an angiogram after the test, or a revascularisation on the same day or later (PCI at the same cath)
    const after = (x: string) => localDay(x) > localDay(abnormal.performed_at);
    const sameOrAfter = (x: string) => localDay(x) >= localDay(abnormal.performed_at);
    const next = s.studies.some((x) => ANATOMY_KINDS.has(x.kind) && after(x.performed_at)) || s.procedures.some((p) => ["pci", "cabg"].includes(p.kind) && sameOrAfter(p.performed_at)) || (abnormal.kind === "cath" && abnormal.attributes?.outcome === "PCI performed");
    if (!next) out.push({ key: `test-${abnormal.id}`, text: `${STUDY[abnormal.kind]?.short ?? abnormal.kind} ${day(abnormal.performed_at)}: ${reportLine(abnormal.kind, abnormal.attributes ?? {})}`, sub: "No angiogram or revascularisation recorded since", tone: "bad", at: abnormal.performed_at });
  }
  return out.slice(0, 6);
}

export function snapshot(s: PatientState) {
  return { now: runningProblems(s), tests: keyTests(s) };
}
