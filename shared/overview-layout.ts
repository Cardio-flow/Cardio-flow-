// How the overview arranges a patient's open work: which alerts are routine, one group per problem with a decision
// (most urgent first), and the single "To do" list. Display arrangement only — no thresholds. One function for the
// server and the screen, so the header, the Overview tab and the "To do" card always show the same number
// (10 Nov 2026; moved from src/screens/Consult.tsx unchanged).
import { isRoutine, isRoutinePlan } from "./routine.js";
import { consultationPriorities } from "./consultation.js";
import { problemOfRule } from "./overview.js";
import { TITLES } from "./overview-problems.js";
import { fmtDay } from "./clinical.js";

const SEV: Record<string, number> = { red: 0, orange: 1, yellow: 2, blue: 3 };
export const TAG: Record<string, string> = new Proxy({} as Record<string, string>, { get: (_t, k: string) => TITLES[k] ?? TITLES.other });
// an alert that opens a pathway shows the pathway's decision on its card
export const decides = (a: any) => a.action?.type === "wizard" && a.severity !== "blue" && !(a.action.wizard === "antithrombotic" && a.rule_id === "cad.antithrombotic-plan" && /PCI/.test(a.title));
export const homeOf = (a: any, s?: any) => a.clinicalContext?.problem ?? (a.action?.type === "plan" ? ((s?.plan ?? []) as any[]).find((p) => p.id === a.action.planId)?.clinicalContext?.problem : null) ?? problemOfRule(a.rule_id);

export function overviewLayout(s: any) {
  const onEpisode = new Set<string>([
    ...((s.episodes ?? []) as any[]).filter((e) => e.status === "open").flatMap((e) => (e.open ?? []).map((x: any) => x.id)),
    ...((s.plan ?? []) as any[]).filter((p) => p.clinicalContext?.episodeId && (p.status === "planned" || p.awaitingReview)).map((p) => p.id),
  ]);
  const live = ((s.attention ?? []) as any[]).filter((a) => !(a.severity !== "red" && a.action?.type === "plan" && onEpisode.has(a.action.planId)));
  const routinePlan = (a: any) => a.action?.type === "plan" && ((s.plan ?? []) as any[]).some((p) => p.id === a.action.planId && isRoutinePlan(p));
  const routine = live.filter((a) => isRoutine(a) || routinePlan(a));
  const pending = ((s.plan ?? []) as any[]).filter((p) => p.status === "planned" || p.awaitingReview);
  const routineTasks = pending.filter(isRoutinePlan);
  const managementTasks = pending.filter((p) => !isRoutinePlan(p));
  const planAlerted = new Set(live.filter((a) => a.action?.type === "plan").map((a) => a.action.planId as string));
  const consultation=s.consultation ?? consultationPriorities(s.attention ?? [],s.plan ?? [],s.today);
  const ranked = live.filter((a) => !routine.includes(a)).sort((x, y) => SEV[x.severity] - SEV[y.severity] || Number(decides(y)) - Number(decides(x)));
  // one card per problem with a decision (red, orange or yellow), most urgent first; the problem's other alerts sit
  // inside its card; suggestions to consider (blue) fold into "Also to review"
  const groups = new Map<string, any[]>();
  for (const a of ranked.filter((x) => x.severity !== "blue")) { const k = homeOf(a, s); groups.set(k, [...(groups.get(k) ?? []), a]); }
  // the card leads with the problem's decision (a pathway the engine can decide), its other alerts listed inside
  const stage=(a:any)=>a.severity === "red" ? 0 : consultation.clarifyIds.includes(a.id) ? 1 : a.action?.type === "plan" ? 3 : 2;
  const ordered = [...groups.values()].sort((a,b)=>stage(a[0])-stage(b[0]));
  const rest = ranked.filter((x) => x.severity === "blue");
  return { onEpisode, live, routine, routineTasks, managementTasks, planAlerted, consultation, ranked, ordered, rest, stage };
}

export type TodoEntry = { key: string; kind: "decision" | "task"; title: string; sub?: string; tone: string; cardId?: string };

// Every non-routine decision (urgent first, then the running problem's own, then the rest) and every open task.
export function todoList(s: any): TodoEntry[] {
  const { onEpisode, managementTasks, planAlerted, ordered } = overviewLayout(s);
  const shownTasks = new Set<string>();
  // the running problem's own work leads (a planned operation's pre-procedure pathway, a positive test's next step),
  // after anything urgent; then the other decisions in their order, then open tasks by date
  const RUNNING = /^(event\.pre-procedure|cad\.test-result|cad\.cath-revascularisation|cad\.acs)/;
  const lead = (a: any) => (a.severity === "red" ? 0 : RUNNING.test(a.rule_id ?? "") || a.action?.wizard === "pre-procedure" ? 1 : 2);
  const operation = /pre-?op|pre-?operative|surgery|surgical|operation|clearance|transplant/i;
  const alertTitles = ordered.flat().map((a) => String(a.title));
  const todo: TodoEntry[] = [
    // every decision, not only the first of each problem (the others sit inside that problem's card)
    ...ordered.flat().map((a, i) => ({ a, i })).sort((x, y) => lead(x.a) - lead(y.a) || x.i - y.i).map(({ a }) => {
      const card = ordered.find((g) => g.includes(a))![0];
      return { key: a.id, kind: "decision" as const, title: a.title, sub: a.action?.wizard === "pre-procedure" ? "Pre-procedure pathway" : TAG[homeOf(a, s)], tone: a.severity, cardId: card.id };
    }),
    // a non-urgent task of an open complication episode stays on the episode card (as in the cards below)
    ...[...managementTasks].filter((p) => (!onEpisode.has(p.id) || p.clinicalContext?.urgent) && !planAlerted.has(p.id) && !alertTitles.some((x) => x.includes(p.title))).sort((x, y) => Number(!operation.test(x.title)) - Number(!operation.test(y.title)) || (x.dueDate ?? "9").localeCompare(y.dueDate ?? "9")).filter((p) => !shownTasks.has(p.id) && shownTasks.add(p.id))
      .map((p) => ({ key: p.id, kind: "task" as const, title: p.title, sub: p.awaitingReview ? "Done — result to review" : p.dueDate ? `${p.dueDate < s.today ? "Overdue · " : ""}${fmtDay(p.dueDate, { year: p.dueDate.slice(0, 4) !== s.today.slice(0, 4) })}` : "No date set", tone: p.awaitingReview || (p.dueDate && p.dueDate < s.today) ? "orange" : "blue" })),
  ];
  return todo;
}
