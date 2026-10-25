import { prioritiseDecision, routineDecisionItem } from "../../shared/decision-display";
import { CURRENT_SCREENS } from "../../shared/decision-assume";
import { decisionDataNeeded, decisionQuestions } from "../../shared/decision-requirements";
import { decisionBlocker } from "../../shared/decision-validation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Activity, Check, Info, CalendarCheck, ClipboardCheck, Pill } from "lucide-react";
import { api } from "../api";
import { Drawer, MultiChoice, SingleChoice, Segmented, Sparkline, DateInput } from "../ui";
import { suggest, type Suggestion } from "../../shared/wizard-guidance";
import { applyInstead, decisionView } from "../../shared/decision-first";
import { JOIN, joinFor, prefill, updateDecisionAnswers } from "../../shared/wizard-prefill";
import { RELEVANT_TAGS, WIZARDS, buildOutcome, doseChoices, missingRequired, optionsFor, visibleQuestions, type Answers, type Question, type WizardContext } from "../../shared/wizards";
import { addDays, flagFor, fmtDay, fmtTime } from "../../shared/clinical";
import { MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog";

// one part of a joined pathway, answered and waiting to be recorded with the parts after it
export type PathwayPart = {
  wizard: string; answers: Answers; dueDates: Record<string, string>; overrides: Record<string, string>; recommendationId?: string | null; evidenceKey?: string;
  outcome: string[]; assessment: { heading: string; recommendations: string[] } | null; step: number;
};
type Hit = { severity: "red" | "orange" | "yellow"; title: string; detail: string; source?: string; requiresReview?: boolean };

// medicine changes lead the decision, then diagnoses, dated plan items and notes

const allAnsweredEarly = (def: (typeof WIZARDS)[string], a: Answers) => def.steps.every((st) => !missingRequired(st, a).length);

export function WizardDrawer({
  patientId, patientName, wizard, recommendationId, contextId, onClose, onDone, onJoin, onBack, carried = [], resume,
}: {
  patientId: string; patientName: string; wizard: string; recommendationId?: string; contextId?: string; onClose(): void; onDone(msg?: string, r?: any): void;
  // joined pathways: carry this part into the next pathway, or go back to an earlier part
  onJoin?(parts: PathwayPart[], next: string): void; onBack?(index: number, current: PathwayPart): void; carried?: PathwayPart[]; resume?: PathwayPart;
}) {
  const def = WIZARDS[wizard];
  const [ctx, setCtx] = useState<WizardContext | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  // decision first (23 Oct 2026): the pathway opens on this patient's decision; the steps are one tap away
  const [mode, setMode] = useState<"decision" | "steps">("decision");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  // phones: the record panel is folded away by default so it never covers the questions
  const [sideOpen, setSideOpen] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  // an open episode of this pathway: this run is its review
  const [episode, setEpisode] = useState<{ id: string; startedAt: string; day: number; reviews: number; lastAt: string } | null>(null);
  const [reason, setReason] = useState("");
  const [autoFilled, setAutoFilled] = useState<string[]>([]);
  const [dueDates, setDueDates] = useState<Record<string, string>>(resume?.dueDates ?? {});
  const [overrides, setOverrides] = useState<Record<string, string>>(resume?.overrides ?? {});
  const [checkedStart, setCheckedStart] = useState("");
  const [startHits, setStartHits] = useState<Record<string, Hit[]>>({});
  const loaded = useRef(false);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    // a later part of a joined pathway reads the record as it will be after the earlier parts
    const before = carried.map((p) => ({ wizard: p.wizard, answers: p.answers, overrides: p.overrides, evidenceKey: p.evidenceKey }));
    (before.length ? api(`/patients/${patientId}/wizards/${wizard}/context`, { body: { before } }) : api(`/patients/${patientId}/wizards/${wizard}`)).then((r) => {
      setCtx(r.context);
      setEpisode(r.episode ?? null);
      // a review starts from the episode's last answers (a newer draft wins); going back in a joined pathway
      // returns to the answers given there
      const base = resume?.answers ?? r.draft?.answers ?? r.episode?.answers;
      if (base) {
        // drop choices that no longer fit the patient's medicines (e.g. the drug was stopped since the draft)
        const clean: Record<string, any> = { ...base };
        // today's state is asked again on a review, unless it was already answered today (then filled, changeable)
        if(!resume) for(const id of CURRENT_SCREENS[wizard] ?? []) { delete clean[id]; const c = r.context.screens?.[id]; if (c?.today) clean[id] = c.value; }
        for (const q of def.steps.flatMap((st) => st.questions).filter((q) => q.options)) {
          const ok = new Set(optionsFor(q, r.context).map((o) => o.value));
          const v = clean[q.id];
          if (Array.isArray(v)) { clean[q.id] = v.filter((x: string) => ok.has(x)); if (q.exclusive && clean[q.id].filter((x: string) => q.exclusive!.includes(x)).length > 1) delete clean[q.id]; }
          else if (v != null && !ok.has(String(v))) delete clean[q.id];
        }
        setDueDates(resume?.dueDates ?? (base as Record<string,any>)._dueDates ?? {});
        delete clean._dueDates;
        setAnswers(clean);
        const restoredStep = resume ? Math.min(resume.step, def.steps.length) : r.draft ? Math.min(r.draft.step, def.steps.length) : 0;
        const unanswered = def.steps.findIndex(st => missingRequired(st, clean).length > 0);
        setStep(unanswered >= 0 ? Math.min(restoredStep,unanswered) : restoredStep);
      } else {
        // everything the record shows, and the guideline's suggestion for every open question, is filled in;
        // the clinician reviews and changes it
        // a joined part starts from what the earlier part carries over (e.g. a new ACS → count from today)
        const last = carried[carried.length - 1];
        const carry = last ? JOIN[last.wizard]?.carry?.(last.answers) ?? {} : {};
        const pre = prefill(wizard, r.context, carry);
        setAnswers(pre.answers);
        setAutoFilled(pre.suggested);
      }
      loaded.current = true;
      opened.current = null;
    }, (e) => setError(e.message));
  }, [patientId, wizard, def]);
  // keep a draft so an accidental close loses nothing; confirming stops further drafts and waits for one in
  // flight, so a late draft save can never resurrect a pathway that was just completed
  const confirming = useRef(false);
  const draftReq = useRef<Promise<unknown> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<any>(null);
  async function flushDraft() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    await draftReq.current;
    const body = pendingDraft.current;
    if (!body) return;
    pendingDraft.current = null;
    const request = api(`/patients/${patientId}/wizards/${wizard}/draft`, { method: "PUT", body });
    draftReq.current = request;
    try { await request; setSaved(true); } catch (e) { pendingDraft.current = body; throw e; }
    finally { draftReq.current = null; }
  }
  async function closeWithDraft() {
    if (busy) return;
    setBusy(true);
    try { await flushDraft(); onClose(); } catch (e) { setError(`Draft not saved: ${(e as Error).message}`); setBusy(false); }
  }
  useEffect(() => {
    if (!loaded.current) return;
    // opening a pathway is not an edit: no draft until the clinician changes something, so the next open
    // is prefilled again from the record as it is then
    const key = JSON.stringify([answers, step, dueDates]);
    if (opened.current == null) { opened.current = key; return; }
    if (opened.current === key) return;
    setDirty(true);
    setSaved(false);
    if (confirming.current) return;
    pendingDraft.current = { answers: {...answers,_dueDates:dueDates}, step, recommendationId: recommendationId ?? null };
    draftTimer.current = setTimeout(() => { if (!confirming.current) void flushDraft().catch(e => setError(`Draft not saved: ${e.message}`)); }, 500);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [answers, step, dueDates, patientId, wizard, recommendationId]);
  const atDecision = mode === "decision";
  const isReview = !atDecision && step === def.steps.length;
  const decisionNeeds = ctx ? decisionQuestions(wizard,answers,ctx) : [];
  const dataNeeded = ctx ? decisionDataNeeded(wizard,ctx,answers) : [];
  const blocker = ctx ? decisionBlocker(wizard,answers,ctx,dueDates) : null;
  const allAnswered = !!ctx && !decisionNeeds.length && !dataNeeded.length && !blocker;
  // the first step that still needs an answer: everything before it is filled in from the record and the guideline
  const firstOpen = def.steps.findIndex((st) => missingRequired(st, answers).length > 0);
  const join = (isReview || atDecision) && onJoin && allAnsweredEarly(def, answers) ? joinFor(wizard, answers, ctx) : null;
  const current = def.steps[step];
  const missing = current ? missingRequired(current, answers) : [];
  const outcome = useMemo(() => (ctx ? buildOutcome(wizard, answers, ctx, dueDates) : []), [ctx, wizard, answers, dueDates]);
  const invalidDates = outcome.some(o => o.kind === "plan" && !o.dueDate);
  // medicines this pathway starts go through the pre-start check; a red hit needs a reason (as in the drawer)
  const startKey = outcome.filter((o) => o.kind === "start").map((o) => (o as any).code).join(",");
  useEffect(() => {
    if (!(isReview || atDecision) || !startKey) { setStartHits({}); setCheckedStart(""); return; }
    setCheckedStart("");
    let live = true;
    api(`/patients/${patientId}/wizards/${wizard}/start-check`, { body: { answers, before: carried.map((p) => ({ wizard: p.wizard, answers: p.answers, overrides: p.overrides })) } }).then((r) => { if (live) { setStartHits(r.hits ?? {}); setCheckedStart(startKey); } }, e => { if (live) setError(`Medication check failed: ${e.message}`); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReview, atDecision, startKey, patientId, wizard, answers]);
  const needReason = Object.entries(startHits).filter(([code, hits]) => hits.some((h) => (h.severity === "red" || h.requiresReview)) && (overrides[code]?.trim().length ?? 0) < 3).map(([c]) => c);
  const assessment = useMemo(() => (ctx && def.assess ? def.assess(answers, ctx) : null), [ctx, def, answers]);
  const dv = useMemo(() => (ctx && atDecision ? decisionView(wizard, answers, ctx) : null), [ctx, atDecision, wizard, answers]);
  // guideline suggestions for every question, from the record and the answers so far
  const suggestions = useMemo(() => {
    const out: Record<string, Suggestion[]> = {};
    if (!ctx) return out;
    for (const q of def.steps.flatMap((st) => visibleQuestions(st, answers)).filter((q) => q.options))
      out[q.id] = suggest(wizard, q.id, answers, ctx, new Set(optionsFor(q, ctx).map((o) => o.value)));
    return out;
  }, [ctx, def, wizard, answers]);
  const manualFor = (id:string) => id === "recheck" ? dueDates[def.recheck?.title ?? "Renal function and potassium check"] : id === "review" ? dueDates[String(answers.review).startsWith("phone-") ? "Phone follow-up" : "Clinic review"] : undefined;
  const choiceValue = (id:string) => manualFor(id) !== undefined ? undefined : answers[id] as string;
  const qType = (id: string) => def.steps.flatMap((st) => st.questions).find((q) => q.id === id)?.type;
  const isChosen = (id: string, v: string) => {
    const day=manualFor(id);
    if (day !== undefined && ctx) {
      if (id === "recheck") return Number.isFinite(Number(v)) && day === addDays(ctx.today,Number(v));
      const [kind,days]=v.split("-");
      return kind === String(answers.review).split("-")[0] && Number.isFinite(Number(days)) && day === addDays(ctx.today,Number(days));
    }
    return qType(id) === "multi" ? ((answers[id] as string[]) ?? []).includes(v) : answers[id] === v;
  };
  const applySuggestions = (id: string) => {
    const vals = (suggestions[id] ?? []).filter(x => !x.alt).map((x) => x.value);
    if (!vals.length) return;
    if (qType(id) === "multi") {
      const exclusive = def.steps.flatMap(st => st.questions).find(q => q.id === id)?.exclusive ?? [];
      const cur = ((answers[id] as string[]) ?? []).filter((v) => (vals.includes("none") || v !== "none") && !(exclusive.includes(v) && vals.some(x => exclusive.includes(x))));
      set(id, vals.includes("none") ? ["none"] : [...new Set([...cur, ...vals])]);
    } else set(id, vals[0]);
  };
  // on the Confirm step: guideline suggestions that were not taken
  const notTaken = isReview
    ? Object.entries(suggestions).flatMap(([id, list]) => list.filter((x) => !x.alt && !isChosen(id, x.value) && x.value !== "none").map((x) => ({ id, ...x, label: def.steps.flatMap((st) => st.questions).find((q) => q.id === id)?.options?.find((o) => o.value === x.value)?.label ?? x.value })))
    : [];
  const set = (id: string, v: any) => {
    if (id === "recheck" || id === "review") setDueDates(d => { const next={...d}; for (const title of id === "recheck" ? [def.recheck?.title ?? "Renal function and potassium check"] : ["Clinic review", "Phone follow-up"]) delete next[title]; return next; });
    setAnswers(a => ctx ? updateDecisionAnswers(wizard,ctx,a,{[id]:v}) : ({...a,[id]:v}));
  };
  const tone = def.tone;
  const thisPart = (): PathwayPart => ({
    wizard, answers, dueDates, overrides, recommendationId: recommendationId ?? null, evidenceKey: ctx?.evidenceKey, step,
    outcome: outcome.map((o) => o.label || (o as any).title), assessment: assessment ? { heading: assessment.heading, recommendations: assessment.recommendations } : null,
  });
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    confirming.current = true;
    try {
      await flushDraft();
      if (carried.length) {
        const parts = [...carried, thisPart()].map((p) => ({ wizard: p.wizard, answers: p.answers, recommendationId: p.recommendationId ?? null, dueDates: p.dueDates, overrides: p.overrides, evidenceKey: p.evidenceKey }));
        const r = await api(`/patients/${patientId}/wizards-joined/complete`, { body: { parts, contextId: contextId ?? null } });
        const n = r.outcome?.length ?? 0;
        onDone(`${parts.map((p) => WIZARDS[p.wizard].title).join(" + ")} recorded · ${n} action${n === 1 ? "" : "s"} added to the plan`, r);
        return;
      }
      const r = await api(`/patients/${patientId}/wizards/${wizard}/complete`, { body: { answers, recommendationId: recommendationId ?? null, contextId: contextId ?? null, dueDates, overrides, evidenceKey: ctx?.evidenceKey } });
      onDone(`${def.title}${r.review ? " review" : ""} recorded · ${outcome.length} action${outcome.length === 1 ? "" : "s"} added to the plan`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      confirming.current = false;
    }
  }
  async function decline() {
    setBusy(true);
    try {
      await api(`/patients/${patientId}/recommendations/${recommendationId}/decline`, { body: { outcome: "declined", reason } });
      onDone("Alert closed with your reason");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const renderQ = (q: Question) => {
    if (!ctx) return null;
              const sug = suggestions[q.id] ?? [];
              const recVals = sug.map((x) => x.value);
              const label = (v: string) => q.options?.find((o) => o.value === v)?.label ?? v;
              const pending = sug.filter((x) => !x.alt && !isChosen(q.id, x.value));
              return (
              <div className="q" key={q.id}>
                <div className="label">{q.label}{autoFilled.includes(q.id) && <span className="prefilled" title="Filled in from the guideline suggestion: change it if it does not fit">suggested</span>}</div>
                {q.help && <details className="question-help"><summary>Details</summary><div className="help">{q.help}</div></details>}
                {(() => {
                  const c = ctx.screens?.[q.id];
                  const v = answers[q.id];
                  if (!c) return null;
                  if (c.today) return <div className="small muted screen-src">Recorded today {fmtTime(c.at)} in {c.title}: {c.label}</div>;
                  return v == null || (Array.isArray(v) && !v.length) ? (
                    <button type="button" className="btn ghost small decision-same" onClick={() => set(q.id, c.value as any)} title={`Answered in ${c.title}`}>Same as {fmtDay(c.at)}: {c.label}</button>
                  ) : null;
                })()}
                {sug.length > 0 && (
                  <details className="guide guide-compact">
                    <summary className="guide-head">
                      <span>Guideline suggests</span>
                      {pending.length > 0 ? (
                        <button type="button" className="btn ghost small" onClick={(e) => { e.preventDefault(); applySuggestions(q.id); }}>Apply</button>
                      ) : (
                        <span className="guide-done"><Check size={14} strokeWidth={3} /> Applied</span>
                      )}
                    </summary>
                    <ul>
                      {sug.map((x) => (
                        <li key={x.value} className={isChosen(q.id, x.value) ? "on" : ""}>
                          <b>{label(x.value)}</b> — {x.why}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {q.type === "multi" && (
                  <MultiChoice options={optionsFor(q, ctx)} value={(answers[q.id] as string[]) ?? []} onChange={(v) => set(q.id, v)} auto={ctx.detected[q.id] ?? []} rec={recVals} exclusive={q.exclusive} />
                )}
                {q.type === "single" && (q.options!.length <= 4 && q.options!.every((o) => o.label.length < 22 && !o.hint) && !recVals.length ? (
                  <Segmented label={q.label} options={optionsFor(q, ctx)} value={choiceValue(q.id)} onChange={(v) => set(q.id, v)} />
                ) : (
                  <SingleChoice label={q.label} options={optionsFor(q, ctx)} value={choiceValue(q.id)} onChange={(v) => set(q.id, v)} rec={recVals} />
                ))}
                {q.type === "date" && (
                  <DateInput className="input" style={{ maxWidth: 220 }} aria-label={q.label} min={ctx.today} value={(answers[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} />
                )}
                {["recheck", "review"].includes(q.id) && answers[q.id] != null && answers[q.id] !== "none" && (() => {
                  const titles = q.id === "recheck" ? [def.recheck?.title ?? "Renal function and potassium check"] : [String(answers.review).startsWith("phone-") ? "Phone follow-up" : "Clinic review"];
                  return outcome.filter(o => o.kind === "plan" && titles.includes(o.title)).map(o => o.kind === "plan" && <label key={o.title} className="manual-date"><span>Manual date</span><DateInput className="input" min={ctx.today} aria-label={`${q.label} exact date`} value={dueDates[o.title] ?? o.dueDate} onChange={e => setDueDates(d => ({...d,[o.title]:e.target.value}))} /></label>);
                })()}
                {q.type === "dose" && (() => {
                  const { med, options } = doseChoices(ctx, q);
                  if (!med) return <div className="infobox">No active medication of this type is recorded.</div>;
                  if (!options.length) return <div className="infobox">{med.name} is already at {doseLabel(MEDICATION[med.code], med.doseValue, med.doseUnit)}, the lowest dose in the catalogue: go back one question and choose Hold instead.</div>;
                  return (
                    <>
                      <div className="small" style={{ fontWeight: 600, color: "var(--ink-3)" }}>
                        {med.name} · now {doseLabel(MEDICATION[med.code], med.doseValue, med.doseUnit)}
                      </div>
                      <SingleChoice label={q.label} options={options} value={choiceValue(q.id)} onChange={(v) => set(q.id, v)} />
                    </>
                  );
                })()}
              </div>
              );
  };
  const outcomeBlock = (heading: string) => !ctx ? null : (

            <div className="q">
              <div className="label">{heading}</div>
              {invalidDates && <div className="help">Complete the manual date to confirm.</div>}
              {!!startKey && checkedStart !== startKey && <div className="help" role="status">Checking the proposed medicines together…</div>}
              {needReason.length > 0 && <div className="infobox warn" role="status">Review the medication warnings below and enter a reason before confirming.</div>}
              <div className="outcome">
                {outcome.length === 0 && <div>No additional action proposed</div>}
                {prioritiseDecision(outcome).filter(o => routineOpen || !routineDecisionItem(o)).map((o, i) => {
                  const hits = o.kind === "start" ? startHits[o.code] ?? [] : [];
                  const red = hits.some((h) => (h.severity === "red" || h.requiresReview));
                  return (
                    <div key={i} className={hits.length ? "has-hits" : undefined}>
                      <div className="out-line" data-plan={o.kind === "plan"}>
                        {o.kind === "medication" || o.kind === "start" ? <Pill size={18} /> : o.kind === "condition" ? <ClipboardCheck size={18} /> : <CalendarCheck size={18} />}
                        <span className="grow">{o.label}</span>
                        {o.kind === "plan" && (
                          <DateInput className="sl-input" min={ctx.today} value={dueDates[o.title] ?? o.dueDate} onChange={(e) => setDueDates((d) => ({ ...d, [o.title]: e.target.value }))} aria-label={`${o.title} due date`} />
                        )}
                      </div>
                      {o.kind === "start" && hits.length > 0 && (
                        <div className="out-hits">
                          {hits.map((h, k) => <div key={k} className={`out-hit sev-${h.severity}`}><AlertTriangle size={14} /> <b>{h.title}</b> <span>{h.detail}</span></div>)}
                          {red && (
                            <input className="input" placeholder="Reason to start it anyway (required)" value={overrides[o.code] ?? ""} onChange={(e) => setOverrides((v) => ({ ...v, [o.code]: e.target.value }))} aria-label={`Reason to start ${o.label}`} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {outcome.some(routineDecisionItem) && <button type="button" className="btn ghost small" aria-expanded={routineOpen} onClick={() => setRoutineOpen(!routineOpen)}>Also due · routine checks ({outcome.filter(routineDecisionItem).length})</button>}
              {outcome.some(o => o.kind === "start" || o.kind === "medication") && <div className="help">Medication changes take effect when confirmed.</div>}
            </div>
            );
  const Icon = tone === "red" ? AlertTriangle : Activity;
  // the latest value is shown in alarm colours only when it is outside its reference range
  const lastTrend = ctx?.trend?.points.length ? ctx.trend.points[ctx.trend.points.length - 1].value : null;
  const trendRef = ctx?.trend ? MEASURES[ctx.trend.code]?.ref : undefined;
  const trendInRange = lastTrend != null && !!trendRef && !flagFor(lastTrend, trendRef);
  return (
    <Drawer
      wide
      title={def.shortTitle ?? def.title}
      subtitle={`${patientName} · ${episode ? `review, day ${episode.day}` : "prefilled from the record"}`}
      icon={<Icon size={22} />}
      tone={tone}
      onClose={closeWithDraft}
      head={
        <>
        {carried.length > 0 && (
          <div className="wiz-chain" aria-label="Joined pathway">
            {carried.map((p, i) => (
              <button key={p.wizard} type="button" className="wiz-chain-part done" onClick={() => onBack?.(i, thisPart())} title="Go back and change">
                <Check size={14} strokeWidth={3} /> {WIZARDS[p.wizard].title}
              </button>
            ))}
            <span className="wiz-chain-part cur">{def.title}</span>
          </div>
        )}
        {atDecision ? (
          <div className="wiz-decision-head">Decision for this patient · from the record and {def.sourceShort ?? "the guideline"}</div>
        ) : <ol className="steps" data-caption={`Step ${step + 1} of ${def.steps.length + 1} · ${[...def.steps.map((s) => s.title), "Confirm"][step]}`} style={{ gridTemplateColumns: `repeat(${def.steps.length + 1}, minmax(0, 1fr))` }}>
          {[...def.steps.map((s) => s.title), "Confirm"].map((t, i) => (
            <li key={t} className={i < step ? "done" : i === step ? "cur" : ""} aria-current={i === step ? "step" : undefined}>
              <i />
              {i + 1} · {t}
            </li>
          ))}
        </ol>}
        </>
      }
      footer={
        declining ? (
          <>
            <input className="input grow" autoFocus placeholder="Why is no action needed? (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for closing the alert" />
            <button className="btn ghost" onClick={() => setDeclining(false)}>Back</button>
            <button className="btn danger" disabled={busy || reason.trim().length < 3} onClick={decline}>Close alert</button>
          </>
        ) : atDecision ? (
          <>
            <span className="note">
              {dv && dv.needed.length > 0 ? <span style={{ color: "var(--orange-ink)", fontWeight: 700 }}>Answer “{dv.needed[0].label}” to complete the decision</span> : "Nothing recorded until you confirm"}
            </span>
            {recommendationId && <button className="btn ghost small" style={{ color: "var(--ink-3)" }} onClick={() => setDeclining(true)}>No action needed</button>}
            <span className="end">
              <button className="btn secondary" onClick={() => { setMode("steps"); setStep(0); }}>Change details</button>
              {join ? (
                <button className="btn primary" disabled={!allAnswered || (dv?.needed.length ?? 0) > 0 || (!!startKey && checkedStart !== startKey) || needReason.length > 0} title={join.why} onClick={() => onJoin?.([...carried, thisPart()], join.next)}>Continue to {WIZARDS[join.next].title.charAt(0).toLowerCase() + WIZARDS[join.next].title.slice(1)}</button>
              ) : (
                <button className="btn primary" disabled={busy || !allAnswered || (dv?.needed.length ?? 0) > 0 || (!!startKey && checkedStart !== startKey) || needReason.length > 0 || invalidDates} onClick={() => confirm()}>
                  {busy ? "Recording…" : carried.length ? `Confirm all ${carried.length + 1}` : "Confirm decision"}
                </button>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="note">
              {/* a disabled Continue says why (phones show no tooltip) */}
              {!isReview && missing.length > 0 ? <span style={{ color: "var(--orange-ink)", fontWeight: 700 }}>Answer “{missing[0].label}” to continue</span>
                : saved ? <><Check size={16} color="var(--green)" strokeWidth={2.6} /> Draft saved</> : dirty ? "Saving draft…" : "Nothing recorded until you confirm"}
            </span>
            {recommendationId && step === 0 && (
              <button className="btn ghost small" style={{ color: "var(--ink-3)" }} onClick={() => setDeclining(true)}>No action needed</button>
            )}
            <span className="end">
              <button className="btn secondary" onClick={() => (step === 0 ? setMode("decision") : setStep(step - 1))}>{step === 0 ? "Back to decision" : "Back"}</button>
              {!isReview && !missing.length && step < def.steps.length - 1 && (allAnswered ? (
                <button className="btn secondary" onClick={() => setStep(def.steps.length)}>Review plan</button>
              ) : firstOpen > step + 1 ? (
                <button className="btn secondary" onClick={() => setStep(firstOpen)}>Skip to {def.steps[firstOpen].title.toLowerCase()}</button>
              ) : null)}
              {isReview && join ? (
                <>
                  <button className="btn secondary" disabled={busy || !allAnswered || (!!startKey && checkedStart !== startKey) || needReason.length > 0 || invalidDates} onClick={() => confirm()}>{carried.length ? "Confirm all without it" : "Confirm without it"}</button>
                  <button className="btn primary" disabled={!allAnswered || (!!startKey && checkedStart !== startKey) || needReason.length > 0} title={join.why} onClick={() => onJoin?.([...carried, thisPart()], join.next)}>Continue to {WIZARDS[join.next].title.charAt(0).toLowerCase() + WIZARDS[join.next].title.slice(1)}</button>
                </>
              ) : isReview ? (
                <button className="btn primary" disabled={busy || !allAnswered || (!!startKey && checkedStart !== startKey) || needReason.length > 0 || invalidDates} title={needReason.length ? "Review medication warnings and give a reason" : undefined} onClick={() => confirm()}>
                  {busy ? "Recording…" : carried.length ? `Confirm all ${carried.length + 1}` : "Confirm plan"}
                </button>
              ) : (
                <button className="btn primary" disabled={missing.length > 0} title={missing.length ? `Answer: ${missing[0].label}` : undefined} onClick={() => setStep(step + 1)}>
                  Continue{def.steps[step + 1] ? ` to ${def.steps[step + 1].title.toLowerCase()}` : ""}
                </button>
              )}
            </span>
          </>
        )
      }
    >
      <div className="wiz">
        <aside className="wiz-side" data-open={sideOpen}>
          <button type="button" className="side-toggle" aria-expanded={sideOpen} onClick={() => setSideOpen(!sideOpen)}>
            <span>Values from the record{ctx ? ` · ${ctx.facts.length + (ctx.trend?.points.length ? 1 : 0)}` : ""}</span>
            <span aria-hidden>{sideOpen ? "Hide ▴" : "Show ▾"}</span>
          </button>
          <span className="eyebrow">Prefilled from record</span>
          {ctx?.trend && ctx.trend.points.length > 0 && (
            <div className="card" style={{ padding: 16, borderColor: tone === "red" && !trendInRange ? "var(--red-line)" : "var(--line)" }}>
              <div className="small" style={{ fontWeight: 700, color: "var(--ink-3)" }}>
                {ctx.trend.label} · {fmtDay(ctx.trend.points[ctx.trend.points.length - 1].date, { year: true })}
              </div>
              <div className="row" style={{ alignItems: "baseline", gap: 6, margin: "6px 0" }}>
                <span style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, color: trendInRange ? "var(--ink)" : tone === "red" ? "var(--red-ink)" : "var(--orange-ink)" }}>
                  {formatNumber(ctx.trend.points[ctx.trend.points.length - 1].value, MEASURES[ctx.trend.code]?.decimals ?? 0)}
                </span>
                <span className="small muted" style={{ fontWeight: 600 }}>{ctx.trend.unit}</span>
              </div>
              <Sparkline values={ctx.trend.points.map((p) => p.value)} tone={trendInRange ? "gray" : tone === "red" ? "red" : "orange"} width={200} height={44} />
              <div className="row small muted" style={{ justifyContent: "space-between", fontWeight: 600 }}>
                {ctx.trend.points.map((p) => (
                  <span key={p.date}>{fmtDay(p.date, { year: true })}</span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {ctx?.facts.map((f) => (
              <div key={f.label} className="card" style={{ padding: 12, borderRadius: 12 }}>
                <div className="small" style={{ fontWeight: 700, color: "var(--ink-4)" }}>{f.label.replace(" (CKD-EPI 2021)", "")}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: f.tone === "orange" ? "var(--orange-ink)" : undefined }}>
                  {f.value.split(" ")[0]} <span className="small muted" style={{ fontWeight: 600 }}>{f.value.split(" ").slice(1).join(" ")}</span>
                </div>
                {f.date && <div className="small muted" style={{ fontWeight: 600 }}>{fmtDay(f.date, { year: true })}</div>}
              </div>
            ))}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="eyebrow">Relevant medications</span>
            {ctx?.meds.filter((m) => !RELEVANT_TAGS[wizard] || m.tags.some((t) => RELEVANT_TAGS[wizard].includes(t))).map((m) => (
              <span key={m.id} style={{ fontSize: 13.5, fontWeight: 600 }}>
                {m.name} {doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} {m.frequency}
              </span>
            ))}
          </div>
        </aside>
        <div className="wiz-main">
          {ctx?.notices?.map(n => <div key={n} className="infobox warn">{n}</div>)}
          {error && <div className="error-box" role="alert">{error}<button className="btn secondary small" onClick={closeWithDraft}>Save draft and close</button></div>}
          {episode && step === 0 && (
            <div className="wiz-review">
              <b>Review · day {episode.day}</b> of the episode opened {fmtDay(episode.startedAt, { year: true })}
              {episode.reviews ? ` (${episode.reviews} earlier review${episode.reviews === 1 ? "" : "s"})` : ""}. Your previous plan is retained. Confirm current safety findings before recording this review.
            </div>
          )}
          {!ctx && !error && <div className="muted">Loading patient data…</div>}
          {ctx && atDecision && dv && (
            <div className="wiz-decision">
              {outcomeBlock(allAnswered ? "Recommended decision" : "Provisional decision")}
              {blocker && <div className="error-box" role="alert">{blocker}</div>}
              {dataNeeded.length > 0 && <div className="decision-need">{dataNeeded.map(n=><p key={n.code}><b>{MEASURES[n.code]?.display ?? n.code}</b> · {n.why}</p>)}<span className="small">Save and close to update these results, then reopen the decision.</span></div>}
              {dv.needed.length > 0 && (
                <section className="dec-needed" aria-label="Needed for this decision">
                  <h3>Needed for this decision</h3>
                  {dv.needed.map(renderQ)}
                </section>
              )}
              {dv.assumed.length > 0 && (
                <details className="dec-assumed" aria-label="Pending checks and follow-up">
                  <summary>Pending checks and follow-up</summary>
                  {dv.assumed.map(renderQ)}
                </details>
              )}
              {dv.why.length > 0 && (
                <details className="dec-why" aria-label="Why">
                  <summary>Why this decision</summary>
                  <ul>{dv.why.map((w) => <li key={w.question + w.label}><b>{w.label}</b> — {w.why}</li>)}</ul>
                </details>
              )}
              {dv.instead.length > 0 && (
                <details className="dec-instead" aria-label="Alternatives">
                  <summary>Alternatives</summary>
                  {dv.instead.map((x) => (
                    <div className="dec-alt" key={x.question + x.value}>
                      <div><b>{x.label}</b><span>{x.why}</span></div>
                      <button type="button" className="btn secondary small" onClick={() => setAnswers((a) => { const changed = applyInstead(a, wizard, x.question, x.value, x.replaces); return updateDecisionAnswers(wizard,ctx,a,{[x.question]:changed[x.question]}); })}>Use this</button>
                    </div>
                  ))}
                </details>
              )}
              {dv.check.length > 0 && (
                <section className="dec-check" aria-label="Look at before confirming">
                  <h3>Look at before confirming</h3>
                  <ul>{dv.check.map((c) => <li key={c}>{c}</li>)}</ul>
                </section>
              )}
              {assessment && (assessment.rows.length > 0 || assessment.recommendations.length > 0) && (
                <details className="dec-assess">
                  <summary>{assessment.heading}</summary>
                  <dl>{assessment.rows.map((r) => <div key={r.label} className={r.tone ? `tone-${r.tone}` : ""}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
                  {assessment.recommendations.length > 0 && <ol>{assessment.recommendations.map((t, i) => <li key={i}>{t}</li>)}</ol>}
                </details>
              )}
            </div>
          )}
          {ctx && current && !atDecision &&
            visibleQuestions(current, answers).map(renderQ)}
          {ctx && isReview && carried.length > 0 && (
            <section className="wiz-carried" aria-label="Earlier parts of this pathway">
              {carried.map((p, i) => (
                <div key={p.wizard} className="wiz-ans">
                  <div className="wiz-ans-head"><b>{WIZARDS[p.wizard].title}</b><button type="button" className="btn ghost small" onClick={() => onBack?.(i, thisPart())}>Change</button></div>
                  {p.outcome.length ? p.outcome.map((o, k) => <div key={k} className="wiz-ans-row"><span>Will record</span><b>{o}</b></div>) : <div className="wiz-ans-row"><span>Will record</span><b>Decision with no further actions</b></div>}
                </div>
              ))}
            </section>
          )}
          {ctx && isReview && join && (
            <div className="wiz-join"><b>Next in this pathway: {WIZARDS[join.next].title}</b><span>{join.why}. Both are recorded together when you confirm.</span></div>
          )}
          {ctx && isReview && (
            <section className="wiz-answers" aria-label="Your answers">
              {def.steps.map((st, i) => {
                const qs = visibleQuestions(st, answers).filter((q) => answers[q.id] != null && answers[q.id] !== "");
                if (!qs.length) return null;
                return (
                  <div key={st.id} className="wiz-ans">
                    <div className="wiz-ans-head"><b>{st.title}</b><button type="button" className="btn ghost small" onClick={() => setStep(i)}>Change</button></div>
                    {qs.map((q) => {
                      const v = answers[q.id];
                      const lab = (x: string) => q.options?.find((o) => o.value === x)?.label ?? x;
                      return <div key={q.id} className="wiz-ans-row"><span>{q.label}</span><b>{Array.isArray(v) ? v.map(lab).join(" · ") : manualFor(q.id) !== undefined ? `${manualFor(q.id) ? fmtDay(manualFor(q.id)!, {year:true}) : "Choose a date"} · manual date` : lab(String(v))}</b></div>;
                    })}
                  </div>
                );
              })}
            </section>
          )}
          {ctx && isReview && assessment && (
            <section className="assess" aria-label={assessment.heading}>
              <h3>{assessment.heading}</h3>
              <dl>
                {assessment.rows.map((r) => (
                  <div key={r.label} className={r.tone ? `tone-${r.tone}` : ""}>
                    <dt>{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
              {assessment.recommendations.length > 0 && (
                <>
                  <div className="assess-sub">Recommendations</div>
                  <ol>
                    {assessment.recommendations.map((t, i) => <li key={i}>{t}</li>)}
                  </ol>
                </>
              )}
            </section>
          )}
          {ctx && isReview && notTaken.length > 0 && (
            <div className="guide not-taken">
              <div className="guide-head"><span>Guideline suggestions not taken</span></div>
              <ul>{notTaken.map((x) => <li key={x.id + x.value}><b>{x.label}</b> — {x.why}</li>)}</ul>
              <div className="help">That is your decision; it is recorded with the plan.</div>
            </div>
          )}
          {ctx && isReview && outcomeBlock("This will be recorded")}
          <details className="wizard-reference">
            <summary><Info size={16} /> Guidance & references <span>{def.sourceShort ?? "Guideline"}</span></summary>
            <p className="help">{def.note}</p>
            {def.source && <p className="help">{def.source}</p>}
          </details>
        </div>
      </div>
    </Drawer>
  );
}
