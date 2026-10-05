import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Activity, Check, Info, CalendarCheck, ClipboardCheck, Pill } from "lucide-react";
import { api } from "../api";
import { Drawer, MultiChoice, SingleChoice, Segmented, Sparkline } from "../ui";
import { suggest, type Suggestion } from "../../shared/wizard-guidance";
import { RELEVANT_TAGS, WIZARDS, buildOutcome, doseChoices, missingRequired, optionsFor, visibleQuestions, type Answers, type WizardContext } from "../../shared/wizards";
import { flagFor, fmtDay } from "../../shared/clinical";
import { MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog";

export function WizardDrawer({
  patientId, patientName, wizard, recommendationId, contextId, onClose, onDone,
}: { patientId: string; patientName: string; wizard: string; recommendationId?: string; contextId?: string; onClose(): void; onDone(msg?: string, r?: any): void }) {
  const def = WIZARDS[wizard];
  const [ctx, setCtx] = useState<WizardContext | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  // phones: the record panel is folded away by default so it never covers the questions
  const [sideOpen, setSideOpen] = useState(false);
  // an open episode of this pathway: this run is its review
  const [episode, setEpisode] = useState<{ id: string; startedAt: string; day: number; reviews: number; lastAt: string } | null>(null);
  const [reason, setReason] = useState("");
  const loaded = useRef(false);
  useEffect(() => {
    api(`/patients/${patientId}/wizards/${wizard}`).then((r) => {
      setCtx(r.context);
      setEpisode(r.episode ?? null);
      // a review starts from the episode's last answers (a newer draft wins)
      const base = r.draft?.answers ?? r.episode?.answers;
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
        setStep(r.draft ? Math.min(r.draft.step, def.steps.length) : 0);
      } else {
        // everything the record already shows is prefilled (and marked AUTO); the clinician confirms or changes it
        const pre: Record<string, any> = {};
        for (const q of def.steps.flatMap((st) => st.questions)) {
          const d = r.context.detected[q.id];
          if (d?.length) pre[q.id] = q.type === "single" ? d[0] : d;
        }
        setAnswers(pre);
      }
      loaded.current = true;
    }, (e) => setError(e.message));
  }, [patientId, wizard, def]);
  // keep a draft so an accidental close loses nothing
  useEffect(() => {
    if (!loaded.current) return;
    setSaved(false);
    const t = setTimeout(() => api(`/patients/${patientId}/wizards/${wizard}/draft`, { method: "PUT", body: { answers, step, recommendationId: recommendationId ?? null } }).then(() => setSaved(true)).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [answers, step, patientId, wizard, recommendationId]);
  const isReview = step === def.steps.length;
  const current = def.steps[step];
  const missing = current ? missingRequired(current, answers) : [];
  const outcome = useMemo(() => (ctx ? buildOutcome(wizard, answers, ctx) : []), [ctx, wizard, answers]);
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
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${patientId}/wizards/${wizard}/complete`, { body: { answers, recommendationId: recommendationId ?? null, contextId: contextId ?? null } });
      onDone(`${def.title}${r.review ? " review" : ""} recorded · ${outcome.length} action${outcome.length === 1 ? "" : "s"} added to the plan`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
        <ol className="steps" data-caption={`Step ${step + 1} of ${def.steps.length + 1} · ${[...def.steps.map((s) => s.title), "Confirm"][step]}`} style={{ gridTemplateColumns: `repeat(${def.steps.length + 1}, minmax(0, 1fr))` }}>
          {[...def.steps.map((s) => s.title), "Confirm"].map((t, i) => (
            <li key={t} className={i < step ? "done" : i === step ? "cur" : ""} aria-current={i === step ? "step" : undefined}>
              <i />
              {i + 1} · {t}
            </li>
          ))}
        </ol>
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
              {saved ? <><Check size={16} color="var(--green)" strokeWidth={2.6} /> Draft saved</> : "Saving draft…"}
            </span>
            {recommendationId && step === 0 && (
              <button className="btn ghost small" style={{ color: "var(--ink-3)" }} onClick={() => setDeclining(true)}>No action needed</button>
            )}
            <span className="end">
              <button className="btn secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
              {isReview ? (
                <button className="btn primary" disabled={busy} onClick={confirm}>{busy ? "Recording…" : "Confirm plan"}</button>
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
                <div className="label">{q.label}</div>
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
                  <input type="date" className="input" style={{ maxWidth: 220 }} aria-label={q.label} min={ctx.today} value={(answers[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} />
                )}
                {q.type === "dose" && (() => {
                  const { med, options } = doseChoices(ctx, q);
                  if (!med) return <div className="infobox">No active medication of this type is recorded.</div>;
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
                {outcome.map((o, i) => (
                  <div key={i}>
                    {o.kind === "medication" || o.kind === "start" ? <Pill size={18} /> : o.kind === "condition" ? <ClipboardCheck size={18} /> : <CalendarCheck size={18} />}
                    {o.label}
                  </div>
                ))}
              </div>
              <div className="help" style={{ marginTop: 4 }}>Medication changes take effect now. Each dated item becomes a task that closes itself when the result or visit is recorded.</div>
            </div>
          )}
          <div className="infobox" style={{ marginTop: "auto" }}>
            <Info size={20} color="var(--action)" style={{ flexShrink: 0 }} />
            <span>
              <b>How this works</b>
              {def.note}
            </span>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
