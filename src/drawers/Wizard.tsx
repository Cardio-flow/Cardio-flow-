import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Activity, Check, Info, CalendarCheck, ClipboardCheck, Pill } from "lucide-react";
import { api } from "../api";
import { Drawer, MultiChoice, SingleChoice, Segmented, Sparkline, DateInput } from "../ui";
import { suggest, type Suggestion } from "../../shared/wizard-guidance";
import { JOIN, joinFor, prefill } from "../../shared/wizard-prefill";
import { RELEVANT_TAGS, WIZARDS, buildOutcome, doseChoices, missingRequired, optionsFor, visibleQuestions, type Answers, type WizardContext } from "../../shared/wizards";
import { flagFor, fmtDay } from "../../shared/clinical";
import { MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog";

// one part of a joined pathway, answered and waiting to be recorded with the parts after it
export type PathwayPart = {
  wizard: string; answers: Answers; dueDates: Record<string, string>; overrides: Record<string, string>; recommendationId?: string | null;
  outcome: string[]; assessment: { heading: string; recommendations: string[] } | null; step: number;
};
type Hit = { severity: "red" | "orange" | "yellow"; title: string; detail: string; source?: string };

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
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  // phones: the record panel is folded away by default so it never covers the questions
  const [sideOpen, setSideOpen] = useState(false);
  // an open episode of this pathway: this run is its review
  const [episode, setEpisode] = useState<{ id: string; startedAt: string; day: number; reviews: number; lastAt: string } | null>(null);
  const [reason, setReason] = useState("");
  const [autoFilled, setAutoFilled] = useState<string[]>([]);
  const [dueDates, setDueDates] = useState<Record<string, string>>(resume?.dueDates ?? {});
  const [overrides, setOverrides] = useState<Record<string, string>>(resume?.overrides ?? {});
  const [startHits, setStartHits] = useState<Record<string, Hit[]>>({});
  const loaded = useRef(false);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    // a later part of a joined pathway reads the record as it will be after the earlier parts
    const before = carried.map((p) => ({ wizard: p.wizard, answers: p.answers, overrides: p.overrides }));
    (before.length ? api(`/patients/${patientId}/wizards/${wizard}/context`, { body: { before } }) : api(`/patients/${patientId}/wizards/${wizard}`)).then((r) => {
      setCtx(r.context);
      setEpisode(r.episode ?? null);
      // a review starts from the episode's last answers (a newer draft wins); going back in a joined pathway
      // returns to the answers given there
      const base = resume?.answers ?? r.draft?.answers ?? r.episode?.answers;
      if (base) {
        // drop choices that no longer fit the patient's medicines (e.g. the drug was stopped since the draft)
        const clean: Record<string, any> = { ...base };
        for (const q of def.steps.flatMap((st) => st.questions).filter((q) => q.options)) {
          const ok = new Set(optionsFor(q, r.context).map((o) => o.value));
          const v = clean[q.id];
          if (Array.isArray(v)) clean[q.id] = v.filter((x: string) => ok.has(x));
          else if (v != null && !ok.has(String(v))) delete clean[q.id];
        }
        setAnswers(clean);
        setStep(resume ? Math.min(resume.step, def.steps.length) : r.draft ? Math.min(r.draft.step, def.steps.length) : 0);
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
  useEffect(() => {
    if (!loaded.current) return;
    // opening a pathway is not an edit: no draft until the clinician changes something, so the next open
    // is prefilled again from the record as it is then
    const key = JSON.stringify([answers, step]);
    if (opened.current == null) { opened.current = key; return; }
    if (opened.current === key) return;
    setDirty(true);
    setSaved(false);
    if (confirming.current) return;
    const t = setTimeout(() => {
      if (confirming.current) return;
      draftReq.current = api(`/patients/${patientId}/wizards/${wizard}/draft`, { method: "PUT", body: { answers, step, recommendationId: recommendationId ?? null } }).then(() => setSaved(true)).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [answers, step, patientId, wizard, recommendationId]);
  const isReview = step === def.steps.length;
  const allAnswered = def.steps.every((st) => !missingRequired(st, answers).length);
  // the first step that still needs an answer: everything before it is filled in from the record and the guideline
  const firstOpen = def.steps.findIndex((st) => missingRequired(st, answers).length > 0);
  const join = isReview && onJoin ? joinFor(wizard, answers, ctx) : null;
  const current = def.steps[step];
  const missing = current ? missingRequired(current, answers) : [];
  const outcome = useMemo(() => (ctx ? buildOutcome(wizard, answers, ctx) : []), [ctx, wizard, answers]);
  // medicines this pathway starts go through the pre-start check; a red hit needs a reason (as in the drawer)
  const startKey = outcome.filter((o) => o.kind === "start").map((o) => (o as any).code).join(",");
  useEffect(() => {
    if (!isReview || !startKey) { setStartHits({}); return; }
    let live = true;
    api(`/patients/${patientId}/wizards/${wizard}/start-check`, { body: { answers, before: carried.map((p) => ({ wizard: p.wizard, answers: p.answers, overrides: p.overrides })) } }).then((r) => live && setStartHits(r.hits ?? {}), () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReview, startKey, patientId, wizard]);
  const needReason = Object.entries(startHits).filter(([code, hits]) => hits.some((h) => h.severity === "red") && (overrides[code]?.trim().length ?? 0) < 3).map(([c]) => c);
  const assessment = useMemo(() => (ctx && def.assess ? def.assess(answers, ctx) : null), [ctx, def, answers]);
  // guideline suggestions for every question, from the record and the answers so far
  const suggestions = useMemo(() => {
    const out: Record<string, Suggestion[]> = {};
    if (!ctx) return out;
    for (const q of def.steps.flatMap((st) => visibleQuestions(st, answers)).filter((q) => q.options))
      out[q.id] = suggest(wizard, q.id, answers, ctx, new Set(optionsFor(q, ctx).map((o) => o.value)));
    return out;
  }, [ctx, def, wizard, answers]);
  const qType = (id: string) => def.steps.flatMap((st) => st.questions).find((q) => q.id === id)?.type;
  const isChosen = (id: string, v: string) => (qType(id) === "multi" ? ((answers[id] as string[]) ?? []).includes(v) : answers[id] === v);
  const applySuggestions = (id: string) => {
    const vals = (suggestions[id] ?? []).map((x) => x.value);
    if (!vals.length) return;
    if (qType(id) === "multi") {
      const cur = ((answers[id] as string[]) ?? []).filter((v) => vals.includes("none") || v !== "none");
      set(id, vals.includes("none") ? ["none"] : [...new Set([...cur, ...vals])]);
    } else set(id, vals[0]);
  };
  // on the Confirm step: guideline suggestions that were not taken
  const notTaken = isReview
    ? Object.entries(suggestions).flatMap(([id, list]) => list.filter((x) => !isChosen(id, x.value) && x.value !== "none").map((x) => ({ id, ...x, label: def.steps.flatMap((st) => st.questions).find((q) => q.id === id)?.options?.find((o) => o.value === x.value)?.label ?? x.value })))
    : [];
  const set = (id: string, v: any) => setAnswers((a) => ({ ...a, [id]: v }));
  const tone = def.tone;
  const thisPart = (): PathwayPart => ({
    wizard, answers, dueDates, overrides, recommendationId: recommendationId ?? null, step,
    outcome: outcome.map((o) => o.label || (o as any).title), assessment: assessment ? { heading: assessment.heading, recommendations: assessment.recommendations } : null,
  });
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    confirming.current = true;
    await draftReq.current;
    try {
      if (carried.length) {
        const parts = [...carried, thisPart()].map((p) => ({ wizard: p.wizard, answers: p.answers, recommendationId: p.recommendationId ?? null, dueDates: p.dueDates, overrides: p.overrides }));
        const r = await api(`/patients/${patientId}/wizards-joined/complete`, { body: { parts, contextId: contextId ?? null } });
        const n = r.outcome?.length ?? 0;
        onDone(`${parts.map((p) => WIZARDS[p.wizard].title).join(" + ")} recorded · ${n} action${n === 1 ? "" : "s"} added to the plan`, r);
        return;
      }
      const r = await api(`/patients/${patientId}/wizards/${wizard}/complete`, { body: { answers, recommendationId: recommendationId ?? null, contextId: contextId ?? null, dueDates, overrides } });
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
  const Icon = tone === "red" ? AlertTriangle : Activity;
  // the latest value is shown in alarm colours only when it is outside its reference range
  const lastTrend = ctx?.trend?.points.length ? ctx.trend.points[ctx.trend.points.length - 1].value : null;
  const trendRef = ctx?.trend ? MEASURES[ctx.trend.code]?.ref : undefined;
  const trendInRange = lastTrend != null && !!trendRef && !flagFor(lastTrend, trendRef);
  return (
    <Drawer
      wide
      title={def.title}
      subtitle={`${patientName} · ${episode ? `review, day ${episode.day}` : "prefilled from the record"}`}
      icon={<Icon size={22} />}
      tone={tone}
      onClose={onClose}
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
        <ol className="steps" data-caption={`Step ${step + 1} of ${def.steps.length + 1} · ${[...def.steps.map((s) => s.title), "Confirm"][step]}`} style={{ gridTemplateColumns: `repeat(${def.steps.length + 1}, minmax(0, 1fr))` }}>
          {[...def.steps.map((s) => s.title), "Confirm"].map((t, i) => (
            <li key={t} className={i < step ? "done" : i === step ? "cur" : ""} aria-current={i === step ? "step" : undefined}>
              <i />
              {i + 1} · {t}
            </li>
          ))}
        </ol>
        </>
      }
      footer={
        declining ? (
          <>
            <input className="input grow" autoFocus placeholder="Why is no action needed? (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for closing the alert" />
            <button className="btn ghost" onClick={() => setDeclining(false)}>Back</button>
            <button className="btn danger" disabled={busy || reason.trim().length < 3} onClick={decline}>Close alert</button>
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
              <button className="btn secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
              {!isReview && !missing.length && step < def.steps.length - 1 && (allAnswered ? (
                <button className="btn secondary" onClick={() => setStep(def.steps.length)}>Review plan</button>
              ) : firstOpen > step + 1 ? (
                <button className="btn secondary" onClick={() => setStep(firstOpen)}>Skip to {def.steps[firstOpen].title.toLowerCase()}</button>
              ) : null)}
              {isReview && join ? (
                <>
                  <button className="btn secondary" disabled={busy || needReason.length > 0} onClick={() => confirm()}>{carried.length ? "Confirm all without it" : "Confirm without it"}</button>
                  <button className="btn primary" disabled={needReason.length > 0} title={join.why} onClick={() => onJoin?.([...carried, thisPart()], join.next)}>Continue to {WIZARDS[join.next].title.charAt(0).toLowerCase() + WIZARDS[join.next].title.slice(1)}</button>
                </>
              ) : isReview ? (
                <button className="btn primary" disabled={busy || needReason.length > 0} title={needReason.length ? "Give the reason to start despite the contraindication" : undefined} onClick={() => confirm()}>
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
                {ctx.trend.label} · {fmtDay(ctx.trend.points[ctx.trend.points.length - 1].date)}
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
                  <span key={p.date}>{fmtDay(p.date)}</span>
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
                {f.date && <div className="small muted" style={{ fontWeight: 600 }}>{fmtDay(f.date)}</div>}
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
          {error && <div className="error-box">{error}</div>}
          {episode && step === 0 && (
            <div className="wiz-review">
              <b>Review · day {episode.day}</b> of the episode opened {fmtDay(episode.startedAt)}
              {episode.reviews ? ` (${episode.reviews} earlier review${episode.reviews === 1 ? "" : "s"})` : ""}. Your last answers are kept: change what is different. New plan items are added; earlier ones stay.
            </div>
          )}
          {!ctx && !error && <div className="muted">Loading patient data…</div>}
          {ctx && current &&
            visibleQuestions(current, answers).map((q) => {
              const sug = suggestions[q.id] ?? [];
              const recVals = sug.map((x) => x.value);
              const label = (v: string) => q.options?.find((o) => o.value === v)?.label ?? v;
              const pending = sug.filter((x) => !isChosen(q.id, x.value));
              return (
              <div className="q" key={q.id}>
                <div className="label">{q.label}{autoFilled.includes(q.id) && <span className="prefilled" title="Filled in from the guideline suggestion: change it if it does not fit">suggested</span>}</div>
                {q.help && <div className="help">{q.help}</div>}
                {sug.length > 0 && (
                  <div className="guide">
                    <div className="guide-head">
                      <span>Guideline suggests</span>
                      {pending.length > 0 ? (
                        <button type="button" className="btn ghost small" onClick={() => applySuggestions(q.id)}>Apply</button>
                      ) : (
                        <span className="guide-done"><Check size={14} strokeWidth={3} /> Applied</span>
                      )}
                    </div>
                    <ul>
                      {sug.map((x) => (
                        <li key={x.value} className={isChosen(q.id, x.value) ? "on" : ""}>
                          <b>{label(x.value)}</b> — {x.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {q.type === "multi" && (
                  <MultiChoice options={optionsFor(q, ctx)} value={(answers[q.id] as string[]) ?? []} onChange={(v) => set(q.id, v)} auto={ctx.detected[q.id] ?? []} rec={recVals} />
                )}
                {q.type === "single" && (q.options!.length <= 4 && q.options!.every((o) => o.label.length < 22 && !o.hint) && !recVals.length ? (
                  <Segmented label={q.label} options={optionsFor(q, ctx)} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />
                ) : (
                  <SingleChoice label={q.label} options={optionsFor(q, ctx)} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} rec={recVals} />
                ))}
                {q.type === "date" && (
                  <DateInput className="input" style={{ maxWidth: 220 }} aria-label={q.label} min={ctx.today} value={(answers[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} />
                )}
                {q.type === "dose" && (() => {
                  const { med, options } = doseChoices(ctx, q);
                  if (!med) return <div className="infobox">No active medication of this type is recorded.</div>;
                  if (!options.length) return <div className="infobox">{med.name} is already at {doseLabel(MEDICATION[med.code], med.doseValue, med.doseUnit)}, the lowest dose in the catalogue: go back one question and choose Hold instead.</div>;
                  return (
                    <>
                      <div className="small" style={{ fontWeight: 600, color: "var(--ink-3)" }}>
                        {med.name} · now {doseLabel(MEDICATION[med.code], med.doseValue, med.doseUnit)}
                      </div>
                      <SingleChoice label={q.label} options={options} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />
                    </>
                  );
                })()}
              </div>
              );
            })}
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
                      return <div key={q.id} className="wiz-ans-row"><span>{q.label}</span><b>{Array.isArray(v) ? v.map(lab).join(" · ") : lab(String(v))}</b></div>;
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
          {ctx && isReview && (
            <div className="q">
              <div className="label">This will be recorded</div>
              <div className="outcome">
                {outcome.length === 0 && <div>Decision recorded with no further actions</div>}
                {outcome.map((o, i) => {
                  const hits = o.kind === "start" ? startHits[o.code] ?? [] : [];
                  const red = hits.some((h) => h.severity === "red");
                  return (
                    <div key={i} className={hits.length ? "has-hits" : undefined}>
                      <div className="out-line">
                        {o.kind === "medication" || o.kind === "start" ? <Pill size={18} /> : o.kind === "condition" ? <ClipboardCheck size={18} /> : <CalendarCheck size={18} />}
                        <span className="grow">{o.label}</span>
                        {o.kind === "plan" && o.dueDate && (
                          <DateInput className="sl-input" min={ctx.today} value={dueDates[o.title] ?? o.dueDate} onChange={(e) => e.target.value && setDueDates((d) => ({ ...d, [o.title]: e.target.value }))} aria-label={`${o.title} due date`} />
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
              <div className="help" style={{ marginTop: 4 }}>Medication changes take effect now. Each dated item becomes a task that closes itself when the result or visit is recorded.</div>
            </div>
          )}
          <div className="infobox" style={{ marginTop: "auto" }}>
            <Info size={20} color="var(--action)" style={{ flexShrink: 0 }} />
            <span>
              <b>How this works</b>
              {def.note}
              {def.source && <details style={{ marginTop: 8 }}><summary>References</summary><span className="help">{def.source}</span></details>}
            </span>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
