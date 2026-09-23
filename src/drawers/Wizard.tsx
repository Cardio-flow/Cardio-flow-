import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Activity, Check, Info, CalendarCheck, Pill } from "lucide-react";
import { api } from "../api";
import { Drawer, MultiChoice, SingleChoice, Segmented, Sparkline } from "../ui";
import { WIZARDS, buildOutcome, doseChoices, missingRequired, visibleQuestions, type Answers, type WizardContext } from "../../shared/wizards";
import { fmtDay } from "../../shared/clinical";
import { MEDICATION, doseLabel, formatNumber } from "../../shared/catalog";

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
  const [reason, setReason] = useState("");
  const loaded = useRef(false);
  useEffect(() => {
    api(`/patients/${patientId}/wizards/${wizard}`).then((r) => {
      setCtx(r.context);
      if (r.draft) {
        setAnswers(r.draft.answers);
        setStep(Math.min(r.draft.step, def.steps.length));
      } else setAnswers({ contributors: r.context.detected.contributors ?? [] });
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
  const set = (id: string, v: any) => setAnswers((a) => ({ ...a, [id]: v }));
  const tone = def.tone;
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${patientId}/wizards/${wizard}/complete`, { body: { answers, recommendationId: recommendationId ?? null, contextId: contextId ?? null } });
      onDone(`${def.title} recorded · ${outcome.length} action${outcome.length === 1 ? "" : "s"} added to the plan`, r);
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
  return (
    <Drawer
      wide
      title={def.title}
      subtitle={`${patientName} · prefilled from the record`}
      icon={<Icon size={22} />}
      tone={tone}
      onClose={onClose}
      head={
        <ol className="steps" style={{ gridTemplateColumns: `repeat(${def.steps.length + 1}, minmax(0, 1fr))` }}>
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
        <aside className="wiz-side">
          <span className="eyebrow">Prefilled from record</span>
          {ctx?.trend && ctx.trend.points.length > 0 && (
            <div className="card" style={{ padding: 16, borderColor: tone === "red" ? "var(--red-line)" : "var(--line)" }}>
              <div className="small" style={{ fontWeight: 700, color: "var(--ink-3)" }}>
                {ctx.trend.label} · {fmtDay(ctx.trend.points[ctx.trend.points.length - 1].date)}
              </div>
              <div className="row" style={{ alignItems: "baseline", gap: 6, margin: "6px 0" }}>
                <span style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, color: tone === "red" ? "var(--red-ink)" : "var(--orange-ink)" }}>
                  {formatNumber(ctx.trend.points[ctx.trend.points.length - 1].value, ctx.trend.code === "potassium" ? 1 : 0)}
                </span>
                <span className="small muted" style={{ fontWeight: 600 }}>{ctx.trend.unit}</span>
              </div>
              <Sparkline values={ctx.trend.points.map((p) => p.value)} tone={tone === "red" ? "red" : "orange"} width={200} height={44} />
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
            {ctx?.meds.filter((m) => m.tags.some((t) => ["raas", "mra", "potassium-sparing", "loop", "sglt2"].includes(t))).map((m) => (
              <span key={m.id} style={{ fontSize: 13.5, fontWeight: 600 }}>
                {m.name} {doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} {m.frequency}
              </span>
            ))}
          </div>
        </aside>
        <div className="wiz-main">
          {error && <div className="error-box">{error}</div>}
          {!ctx && !error && <div className="muted">Loading patient data…</div>}
          {ctx && current &&
            visibleQuestions(current, answers).map((q) => (
              <div className="q" key={q.id}>
                <div className="label">{q.label}</div>
                {q.help && <div className="help">{q.help}</div>}
                {q.type === "multi" && (
                  <MultiChoice options={q.options!} value={(answers[q.id] as string[]) ?? []} onChange={(v) => set(q.id, v)} auto={ctx.detected[q.id] ?? []} />
                )}
                {q.type === "single" && (q.options!.length <= 4 && q.options!.every((o) => o.label.length < 22) ? (
                  <Segmented label={q.label} options={q.options!} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />
                ) : (
                  <SingleChoice label={q.label} options={q.options!} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />
                ))}
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
            ))}
          {ctx && isReview && (
            <div className="q">
              <div className="label">This will be recorded</div>
              <div className="outcome">
                {outcome.length === 0 && <div>Decision recorded with no further actions</div>}
                {outcome.map((o, i) => (
                  <div key={i}>
                    {o.kind === "medication" ? <Pill size={18} /> : <CalendarCheck size={18} />}
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
