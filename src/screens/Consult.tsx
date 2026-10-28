import { consultationPriorities } from "../../shared/consultation.js";
// "Consult" overview (25 Oct 2026, Ahmed: "stunning, premium and creative … many distractions"; approved mockup).
// The overview reads like a consultant's handover:
//   1. one sentence about the patient,
//   2. the decisions for today, ranked, each with the exact action (from the pathway's own engine), why,
//      what to check before confirming, and Confirm / Other options / Not now,
//   3. the HF medicines as one strip — what blocks each and what unlocks it,
//   4. the story as a thin timeline,
//   5. a rail with what changed since discharge (vitals, trends, every other abnormal result), the medicines
//      once and the next booking,
// and everything stable or routine folded into one line each. The rest of the record (plan, results, module
// detail) stays one tap away at the end. No new clinical logic here: everything shown comes from the summary
// and the decision preview the alert cards already used.
import { useEffect, useState, type ReactNode } from "react";
import { Info, ChevronDown, AlertTriangle } from "lucide-react";
import { api } from "../api";
import { isRoutine, isRoutinePlan } from "../../shared/routine";
import { PlanTasks } from "./PlanTasks";
import { problemOfRule } from "../../shared/overview";
import { fmtDay } from "../../shared/clinical";
import { ActionButton } from "./Summary";
import { DismissPanel, buildProblems, RESULT_PROBLEM, TITLES } from "./Today";
import { DecisionPanel } from "./Decision";
import type { Open } from "./Patient";

const SEV: Record<string, number> = { red: 0, orange: 1, yellow: 2, blue: 3 };
// the problem names are the overview's own (one name per problem everywhere)
const TAG: Record<string, string> = new Proxy({} as Record<string, string>, { get: (_t, k: string) => TITLES[k] ?? TITLES.other });
// the questions and examination from "ask today" that belong with each kind of decision
const ASK_FOR: Record<string, string[]> = {
  kidney: ["nsaid", "postural"], anaemia: ["bleeding", "angina"], cad: ["angina", "bleeding"], hf: ["congestion", "urine", "postural"],
  af: ["af"], diabetes: ["urine"], medication: ["nsaid"], bp: ["postural"],
};
const decides = (a: any) => a.action?.type === "wizard" && a.severity !== "blue" && !(a.action.wizard === "antithrombotic" && a.rule_id === "cad.antithrombotic-plan" && /PCI/.test(a.title));
// an alert's problem: its own context, else (an open task) the task's problem, else the rule's
const homeOf = (a: any, s?: any) => a.clinicalContext?.problem ?? (a.action?.type === "plan" ? ((s?.plan ?? []) as any[]).find((p) => p.id === a.action.planId)?.clinicalContext?.problem : null) ?? problemOfRule(a.rule_id);
const toneOf = (sev: string) => (sev === "red" ? "red" : sev === "orange" ? "amber" : "blue");

export type ConsultSlots = { episodes?: ReactNode; meds?: ReactNode; plan?: ReactNode; results?: ReactNode; more?: ReactNode; moreLabel?: string; dismissed?: ReactNode };

// ---------- the one-sentence brief ----------
function brief(s: any): string | null {
  const h = s.header ?? {};
  const dx = (h.diagnoses ?? []) as any[];
  const hf = dx.find((d) => d.family === "Heart failure");
  const current=s.currentLvef;
  const course=current ? `, EF ${current.value}${current.high != null ? `–${current.high}` : ""}% (${current.quality}, ${fmtDay(current.at)})` : "";
  // coronary diagnoses are said once, in the IHD line (28 Oct 2026: "Chronic coronary syndrome; IHD: chronic coronary syndrome")
  const ihd = h.ihd?.label ? String(h.ihd.label).replace(/^IHD · /, "IHD: ") : null;
  const other = dx.find((d) => d.family !== "Comorbidity" && !d.riskFactor && !(ihd && d.family === "Coronary"))?.label ?? null;
  const first = hf ? `${hf.label.replace(/(\s*·\s*EF)?\s*[\d–-]+%$/, "")}${course}` : ihd ?? other;
  const extra = [hf ? ihd : ihd ? other : null, ...((h.structural?.items ?? []) as string[])].filter(Boolean).slice(0, 2);
  const s1 = first ? `${first}${extra.length ? `; ${extra.join("; ")}` : ""}.` : extra.length ? `${extra.join("; ")}.` : "";
  const since = (s.story ?? []).find((l: any) => l.key === "since");
  const adm = [...((s.chronology?.items ?? []) as any[])].reverse().find((i) => /^Admitted/.test(i.text));
  const reasons = adm ? adm.text.replace(/^Admitted[^:]*:\s*/, "").split(" · ")[0].toLowerCase() : "";
  const s2 = since ? `${adm && /discharge/i.test(since.label) ? `Since the ${adm.when} admission (${reasons})` : since.label}, ${since.text}.` : "";
  const out = `${s1} ${s2}`.trim();
  return out || null;
}

type ProposalItem={kind:string;label:string;routine?:boolean};
export function ProposalPlan({plan}:{plan:ProposalItem[]}) {
  const routine=plan.filter(x=>x.routine && !["start","medication"].includes(x.kind));
  const main=plan.filter(x=>!routine.includes(x));
  const list=(items:ProposalItem[])=><ul className="cx-changes">{items.map((x,i)=><li key={i}>{x.label.replace(/^[^:]{3,60}\?:\s*/, "")}</li>)}</ul>;
  return <section aria-label="This will be recorded">{list(main)}{routine.length>0 && <details className="cx-routine-plan"><summary>{routine.length} routine actions included</summary>{list(routine)}</details>}</section>;
}
function openRecord(section:string) {
  const record=document.getElementById("cx-meds") as HTMLDetailsElement|null;
  if(record)record.open=true;
  requestAnimationFrame(()=>{const el=document.getElementById(section);el?.scrollIntoView({block:"start"});el?.focus({preventScroll:true});});
}

// ---------- a decision ----------
function DecisionCard({ a, n, s, open, done, tasks = [], extra = [], compact = false, results = [], prob = null }: { a: any; n: number; s: any; open(o: Open): void; done(m?: string, r?: any): void; tasks?: any[]; extra?: any[]; compact?: boolean; results?: string[]; prob?: any }) {
  // after the first three, a decision shows as one line (headline, what is still needed, its buttons) and opens in place
  const [more, setMore] = useState(!compact);
  // an alert that is itself an open task shows as the task (with its due date and evidence)
  const ownTask = a.action?.type === "plan" ? ((s.plan ?? []) as any[]).find((p) => p.id === a.action.planId) ?? null : null;
  const allTasks = ownTask ? [ownTask, ...tasks.filter((t) => t.id !== ownTask.id)] : tasks;
  const wizardRec=decides(a) ? a : extra.find(decides);
  const wizard = wizardRec?.action.wizard as string | undefined;
  const [p, setP] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismiss, setDismiss] = useState(false);
  const [panel, setPanel] = useState(false);
  const patientId = s.header.id;
  useEffect(() => {
    if (!wizard) return;
    let live = true;
    setP(null);
    api(`/patients/${patientId}/decisions/${wizard}/preview`, { body: { answers: {}, dueDates: {} } }).then((r) => live && setP(r), () => live && setP(false));
    return () => { live = false; };
  }, [patientId, wizard, a.id, s]);
  const home = homeOf(a, s);
  const plan = (p?.plan ?? []) as { kind: string; label: string; routine?: boolean }[];
  const firstMed = plan.find((x) => x.kind === "medication" || x.kind === "start");
  const headline = firstMed && a.severity !== "red" ? firstMed.label.split(" — ")[0].split(": start")[0] + (firstMed.kind === "start" ? ": start" : "") : a.title;
  const why = [...new Set(((p?.reasons ?? []) as any[]).filter((r) => r.source === "guideline" && r.why).flatMap((r) => (r.why as string).split(" · ")))].filter((w, i, all) => !all.slice(0, i).some((x) => x.slice(0, 40) === w.slice(0, 40))).slice(0, 2);
  const links = ((a.links ?? []) as string[]).slice(0, 3);
  const asks = ((s.ask ?? []) as any[]).filter((q) => (ASK_FOR[home] ?? []).includes(q.key)).map((q) => `${q.ask} — ${q.why}`);
  const data = ((p?.needData ?? []) as any[]).map((d) => `Record ${d.label.toLowerCase()}: ${d.why}`);
  const warns = ((p?.medReview ?? []) as any[]).filter((m) => m.tone === "warn").map((m) => m.title as string).slice(0, 2);
  const reminders = ((p?.reminders ?? []) as string[]).slice(0, 3);
  const checks = [...new Set([...data, ...asks, ...warns, ...reminders])];
  // medicines this decision already stops, changes or starts: an alert about them has no second button
  const actedOn = new Set(((p?.plan ?? []) as any[]).flatMap((x) => [x.medicationId, x.code].filter(Boolean)));
  const ready = !!p && p.ready && !p.joined;
  const decisionState = p ? p.blockers?.length ? "Resolve safety checks first" : p.needData?.length || p.needed?.length ? "Information needed before deciding" : p.joined ? "Linked decision required" : "Proposed plan — review and confirm" : null;
  async function confirm() {
    if (!p || busy) return;
    setBusy(true); setError("");
    try {
      const r = await api(`/patients/${patientId}/wizards/${wizard}/complete`, { body: { answers: p.answers, dueDates: {}, evidenceKey: p.evidenceKey, recommendationId: wizardRec?.id } });
      done(`${p.title} recorded`, r);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <article className={`cx-dec sev-${a.severity}${more ? "" : " compact"}`} data-recommendation-id={a.id} data-problem={TAG[home]} tabIndex={-1} aria-label={a.title}>
      <div className="cx-num" aria-hidden="true">{n}</div>
      <div className="cx-dec-body">
        <div className="cx-dec-tagline">
          <span className={`cx-tag t-${toneOf(a.severity)}`}>{a.severity === "red" && <AlertTriangle size={13} />}{TAG[home] ?? TAG.other}</span>
          {headline !== a.title && <span className="cx-problem">{a.title}</span>}
        </div>
        {decisionState && <div className="cx-decision-state">{decisionState}</div>}
        <h3 className="cx-headline">{headline}</h3>
        {wizard && wizardRec !== a && !ownTask && <div className="cx-actions"><ActionButton a={a} open={open} /></div>}
        {wizard && p === null && <div className="cx-loading" aria-busy="true">Working out the decision…</div>}
        {more && plan.length > 0 && <ProposalPlan plan={plan} />}
        {/* where the problem stands against its goal (the tile it replaces) */}
        {more && prob && (prob.stats?.length > 0 || prob.goal || prob.therapy) && (
          <section className="cx-goal" aria-label={prob.label}>
            {prob.stats?.length > 0 && <b>{prob.stats.map((x: any) => `${x.label} ${x.value}`).join(" · ")}</b>}
            {(prob.goal || prob.therapy) && <span>{[prob.goal, prob.therapy].filter(Boolean).join(" · ")}</span>}
          </section>
        )}
        {more && results.length > 0 && <div className="cx-results"><b>Results:</b> {results.join(" · ")}</div>}
        {more && data.length > 0 && <div className="cx-needed">{data.join(" · ")}</div>}
        {more && (why.length > 0 || a.detail || links.length > 0 || checks.length > 0) && <details className="cx-rationale">
          <summary>Why & reminders</summary>
          <p className="cx-why">{why.length ? why.join(" · ") : a.detail}</p>
          {links.length > 0 && <ul className="cx-links">{links.map((l,i)=><li key={i}>{l}</li>)}</ul>}
          {checks.length > 0 && <ul className="cx-checks">{checks.map((c,i)=><li key={i}>{c}</li>)}</ul>}
        </details>}
        {p && p.blockers?.length > 0 && !panel && p.blockers.map((b: string) => <div key={b} className="cx-blocker" role="alert">{b}</div>)}
        {p && !p.ready && (p.needed?.length > 0) && !panel && <div className="cx-needed">To decide: <b>{(p.needed as any[]).map((q) => q.last ? `${q.label} (last ${fmtDay(q.last.at)}: ${q.last.label})` : q.label).join(" · ")}</b></div>}
        {(more || allTasks.some((t) => t.clinicalContext?.urgent || t.awaitingReview)) && allTasks.length > 0 && <div className="cx-tasks"><PlanTasks tasks={allTasks} open={open} today={s.today} /></div>}
        {more && extra.length > 0 && (
          <div className="cx-extra" aria-label="Also for this problem">
            <div className="cx-checks-h">Also for this problem</div>
            {extra.map((x) => <Row key={x.id} a={x} s={s} open={open} done={done} covered={wizard} coveredMeds={actedOn} />)}
          </div>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}
        {/* the decision answered in place: the questions the record cannot answer, then Apply (as the old cards) */}
        {panel && wizard && <div className="cx-panel-inline"><DecisionPanel key={wizardRec.id} a={wizardRec} patientId={patientId} open={open} done={done} /></div>}
        {dismiss ? (
          <DismissPanel a={a} patientId={patientId} done={done} onCancel={() => setDismiss(false)} />
        ) : (
          <div className="cx-actions">
            {wizard ? (
              ready && more ? (
                <>
                  <button className="btn primary" disabled={busy} onClick={confirm}>{busy ? "Recording…" : "Confirm"}</button>
                  <button className="btn secondary" aria-expanded={panel} onClick={() => {setMore(true); setPanel(!panel);}}>{panel ? "Close decision" : wizard === "pregnancy-plan" ? "Review pregnancy care" : wizard === "diabetes" ? "Review diabetes care" : "Review plan"}</button>
                </>
              ) : (
                <button className="btn primary" disabled={p === null} aria-expanded={panel} onClick={() => {setMore(true); setPanel(!panel);}}>
                  {panel ? "Close decision" : wizard === "pregnancy-plan" ? "Review pregnancy care" : wizard === "diabetes" ? "Review diabetes care" : "Review plan"}
                </button>
              )
            ) : ownTask ? null : (
              <ActionButton a={a} open={open} />
            )}
            {wizard && <button className="btn secondary" onClick={() => open({ kind: "wizard", wizard, recommendationId: wizardRec?.id } as Open)}>Other options</button>}
            {!more && <button className="btn ghost" aria-expanded={false} onClick={() => setMore(true)}>Details{extra.length ? ` · ${extra.length + 1} items` : ""}</button>}
            <button className="btn ghost cx-notnow" onClick={() => setDismiss(true)}>Not now</button>
          </div>
        )}
      </div>
    </article>
  );
}

// ---------- small pieces ----------
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg viewBox="0 0 120 32" className="cx-spark" aria-hidden="true"><circle cx="112" cy="16" r="3.4" fill={color} /></svg>;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [4 + i * (112 / (values.length - 1)), 28 - ((v - lo) / span) * 24]);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 120 32" className="cx-spark" aria-hidden="true">
      <polyline points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.4" fill={color} />
    </svg>
  );
}

function Pillars({ s }: { s: any }) {
  const ps = (s.targets?.hf?.pillars ?? []) as any[];
  if (!ps.length) return null;
  const on = ps.filter((p) => p.state === "on" || p.state === "target").length;
  return (
    <section className="cx-sec" aria-label="Heart failure medicines">
      <div className="cx-sec-h"><h2>Heart failure medicines · {on} of {ps.length} on</h2><span>Each says what unlocks it</span></div>
      <div className="cx-pillars">
        {ps.map((p) => {
          const pct = p.percentOfTarget ?? null;
          const color = p.state === "target" ? "#0E7C66" : p.state === "on" ? "#1F4FD8" : "#B54708";
          const state = p.state === "target" ? "At target" : p.state === "on" ? `${p.med ?? "On"}${p.percentOfTarget != null ? ` · ${p.percentOfTarget}%` : " · dose comparison unavailable"}` : p.block ? `Not now · ${p.block}` : p.state === "held" ? `Held${p.med ? ` · ${p.med}` : ""}` : "Not started";
          const unlock = p.block ? p.unlock : p.increaseBlock ? `Up-titrate ${p.increaseUnlock ?? ""} (${p.increaseBlock})` : p.state === "target" ? "Keep" : p.state === "on" ? "Up-titrate towards target" : "Start when appropriate";
          return (
            <div key={p.key} className="cx-pillar">
              <div className="cx-pillar-h">
                <svg width="34" height="34" viewBox="0 0 36 36" role="img" aria-label={pct == null ? "Dose comparison unavailable" : `${pct}% of target`}>
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#EEF1F5" strokeWidth="5" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke={color} strokeWidth="5" strokeDasharray={`${(Math.min(pct ?? 0,100) / 100) * 88} 88`} strokeLinecap="round" transform="rotate(-90 18 18)" />
                </svg>
                <b>{p.label.split(" (")[0].replace("ARNI / ACE inhibitor / ARB", "ARNI / ACEi / ARB")}</b>
              </div>
              <div className="cx-pillar-state" style={{ color }}>{state}</div>
              <div className="cx-pillar-unlock">{unlock}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Lifeline({ s }: { s: any }) {
  const items = ((s.chronology?.items ?? []) as any[]).filter((i) => i.at);
  if (!items.length) return null;
  return (
    <section className="cx-sec" aria-label="The story">
      <div className="cx-sec-h"><h2>The story</h2>{(s.chronology?.undated ?? []).length > 0 && <span>Date not recorded: {s.chronology.undated.join(", ")}</span>}</div>
      <ol className="cx-life">
        {items.map((e, i) => <li key={i} className={e.tone === "bad" ? "bad" : e.tone === "good" ? "good" : ""}><b>{e.when}</b>{e.text}</li>)}
      </ol>
    </section>
  );
}

function Rail({ s, open }: { s: any; open(o: Open): void }) {
  const v = Object.fromEntries(((s.vitals ?? []) as any[]).map((x) => [x.code, x]));
  const lanes = ((s.timeline?.lanes ?? []) as any[]);
  const abn = new Set(((s.abnormal?.items ?? []) as any[]).map((x) => x.code));
  const other = ((s.abnormal?.items ?? []) as any[]).filter((x) => !lanes.some((l) => l.code === x.code));
  const meds = ((s.medications?.groups ?? []) as any[]).flatMap((g) => g.meds);
  const next = (s.upcoming ?? [])[0];
  return (
    <aside className="cx-rail" aria-label="Current results and medicines">
      <section className="cx-panel cx-key-results">
        <h2 className="cx-ph">Latest results</h2>
        <div className="cx-vitals pulse-vitals">
          {/* systolic and diastolic are paired only when measured together (17 Oct audit: never today's SBP with an old DBP) */}
          {v.sbp && v.dbp && v.dbp.at === v.sbp.at ? <span><b>{Math.round(v.sbp.value)}/{Math.round(v.dbp.value)}</b> BP</span> : <span><b>{v.sbp ? Math.round(v.sbp.value) : "—"}</b> SBP</span>}
          <span><b>{v.hr ? Math.round(v.hr.value) : "—"}</b> HR</span>
          <span><b className={v.weight ? "" : "muted"}>{v.weight ? v.weight.value : "—"}</b> weight</span>
        </div>
        <div className="cx-trends">{lanes.map((l) => {
          const pts = l.points as any[];
          const last = l.current ?? pts[pts.length - 1], first = pts[0];
          const latest=pts[pts.length-1], differs=last.id && latest.id!==last.id;
          const good = l.code === "lvef" ? last.value >= first.value : !abn.has(l.code);
          const color = good ? "#0E7C66" : "#B42318";
          const pct = first.value ? Math.round(((last.value - first.value) / first.value) * 100) : null;
          return (
            <div key={l.code} className="cx-trend">
              <span>{l.label.replace(" %", "")}</span>
              <Spark values={pts.map((x) => x.value)} color={color} />
              <span className="cx-trend-v"><b>{last.text ?? last.value} <small>{l.unit}</small></b><i style={{ color }}>{pct != null && !differs ? `${pct >= 0 ? "+" : ""}${pct}% from ${first.text ?? first.value}` : "Used for decisions"}</i><small>{differs ? `${last.quality} · ${fmtDay(last.at,{year:true})}` : `${fmtDay(first.at,{year:true})} → ${fmtDay(last.at,{year:true})}`}</small>{differs && <small>Latest {latest.quality}: {latest.text} {l.unit} · {fmtDay(latest.at)}. {last.reason}</small>}</span>
            </div>
          );
        })}</div>
        {/* every other abnormal latest result in the strip itself (28 Oct 2026, Ahmed: an LDL above goal was not in the lab strip) */}
        {other.length > 0 && (
          <div className="cx-abn-list">
            {other.map((x: any) => (
              <div key={x.code} className={`cx-abn ${x.flag}`}>
                <span>{x.label}</span>
                <b>{x.text} <small>{x.unit}</small></b>
                <i>{x.note ?? (x.flag === "high" ? "high" : "low")}{x.previous ? ` · was ${x.previous.text}` : ""} · {fmtDay(x.at, { year: true })}</i>
              </div>
            ))}
            <a className="cx-also-link" href="#cx-standing">By problem below</a>
          </div>
        )}
      </section>
      {meds.length > 0 && (
        <section className="cx-panel cx-rail-medicines">
          <div className="cx-ph-row"><h2 className="cx-ph">Medicines · {meds.length}</h2><a href="#cx-meds" className="small" onClick={() => { const d = document.getElementById("cx-meds") as HTMLDetailsElement | null; if (d) d.open = true; }}>Details</a></div>
          {meds.map((m: any) => (
            <div key={m.id} className="cx-med"><b>{m.name}</b><span>{m.dose} {m.frequency}{m.status === "held" ? " · held" : ""}</span></div>
          ))}
        </section>
      )}
      {next && (
        <button type="button" className="cx-panel cx-next" onClick={() => open({ kind: "plan-item", planId: next.id } as Open)}>
          <span className="cx-date"><small>{new Date(next.dueDate).toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}</small><b>{new Date(next.dueDate).getDate()}</b></span>
          <span><b>{next.title}</b><small>Next booked{next.owner ? ` · ${next.owner}` : ""}</small></span>
        </button>
      )}
    </aside>
  );
}

function Row({ a, s, open, done, covered, coveredMeds, coveredLabel = "In the decision above" }: { a: any; s: any; open(o: Open): void; done(m?: string): void; covered?: string | null; coveredMeds?: Set<string>; coveredLabel?: string }) {
  const [dismiss, setDismiss] = useState(false);
  const act = a.action ?? {};
  const inDecision = (covered && act.type === "wizard" && act.wizard === covered) || (!!coveredMeds && ((act.medicationId && coveredMeds.has(act.medicationId)) || (act.code && coveredMeds.has(act.code))));
  return (
    <div className="cx-row" data-recommendation-id={a.id} tabIndex={-1}>
      <span className={`cx-dot sev-${a.severity}`} aria-hidden="true" />
      <div className="cx-row-t"><b>{a.title}</b>{a.detail && <span>{a.detail}</span>}</div>
      <div className="cx-row-a">
        {/* one decision per pathway: an alert whose pathway the card above already decides has no second button */}
        {inDecision ? <span className="cx-covered">{coveredLabel}</span> : <ActionButton a={a} open={open} />}
        <button className="btn ghost small" onClick={() => setDismiss(!dismiss)} aria-expanded={dismiss}>Not now</button>
      </div>
      {dismiss && <div className="cx-row-d"><DismissPanel a={a} patientId={s.header.id} done={done} onCancel={() => setDismiss(false)} /></div>}
    </div>
  );
}

function FoldLine({ dot, title, sub, children, id, className = "", remember }: { dot: string; title: string; sub?: string; children: ReactNode; id?: string; className?: string; remember?: string }) {
  // "More detail" remembers being opened on this device (as since 20 Oct)
  const initial = (() => { if (!remember) return false; try { return localStorage.getItem(remember) === "1"; } catch { return false; } })();
  return (
    <details className={`cx-fold ${className}`} id={id} open={initial || undefined} onToggle={remember ? (e) => { try { localStorage.setItem(remember, (e.currentTarget as HTMLDetailsElement).open ? "1" : "0"); } catch {} } : undefined}>
      <summary><span className="cx-dot" style={{ background: dot }} aria-hidden="true" /><b>{title}</b>{sub && <span>{sub}</span>}<ChevronDown size={16} /></summary>
      <div className="cx-fold-body">{children}</div>
    </details>
  );
}

// ---------- where things stand: one line per problem (status against its goal, results, missing data) ----------
function Standing({ s, open, problems, tasksOf }: { s: any; open(o: Open): void; problems: any[]; tasksOf(key: string): any[] }) {
  if (!problems.length) return null;
  // a result with a trend lives in the rail's sparklines; the rest live here, once
  const lanes = new Set(((s.timeline?.lanes ?? []) as any[]).map((l) => l.code));
  const items = ((s.abnormal?.items ?? []) as any[]).filter((r) => !lanes.has(r.code)), normal = ((s.abnormal?.normal ?? []) as any[]);
  const keys = new Set(problems.map((p) => p.key));
  const home = (code: string) => { const k = RESULT_PROBLEM[code]; return k && keys.has(k) ? k : null; };
  const status = (p: any) => p.assessment === "above" ? (p.key === "bp" && s.pregnancy?.phase === "Pregnant" ? "Above pregnancy target" : "Above target") : p.assessment === "incomplete" ? "Incomplete reading" : p.need.length ? "Needs data" : p.assessment === "met" ? "On track" : p.assessment === "review" ? "To review" : "";
  return (
    <section className="cx-sec" aria-label="Where things stand" id="cx-standing">
      <div className="cx-sec-h"><h2>Where things stand</h2><span>Each problem against its goal</span></div>
      <div className="cx-probs">
        {problems.map((p) => {
          const abn = items.filter((r) => home(r.code) === p.key).map((r) => `${r.label} ${r.text}`);
          const ok = normal.filter((r) => home(r.code) === p.key).map((r) => r.text);
          const st = status(p);
          const needs = [...new Set((p.need as any[]).map((n) => n.label))];
          // the HF medicines have their own strip below; a tile with nothing to say is left out
          const sub = p.key === "hf" ? null : p.sub;
          const tasks = tasksOf(p.key);
          if (!sub && !p.stats.length && !abn.length && !ok.length && !p.goal && !p.therapy && !needs.length && !st && !tasks.length) return null;
          return (
            <section key={p.key} className={`cx-prob st-${p.assessment ?? "none"}`} aria-label={p.label}>
              <div className="cx-prob-h"><b>{p.label}</b>{st && <span className="cx-prob-st">{st}</span>}</div>
              {sub && <div className="cx-prob-sub">{sub}</div>}
              {(p.stats.length > 0 || abn.length > 0) && <div className="cx-prob-stats">{[...p.stats.map((x: any) => `${x.label} ${x.value}`), ...abn].join(" · ")}</div>}
              {ok.length > 0 && <div className="cx-prob-sub">Normal: {ok.join(" · ")}</div>}
              {(p.goal || p.therapy) && <div className="cx-prob-sub">{[p.goal, p.therapy].filter(Boolean).join(" · ")}</div>}
              {tasks.length > 0 && <PlanTasks tasks={tasks} open={open} today={s.today} />}
              {needs.length > 0 && (
                <div className="cx-prob-need"><span>Needed: <b>{needs.join(", ")}</b></span>
                  <button className="btn ghost small" aria-label={`Record ${p.label}: ${needs.join(", ")}`} onClick={() => open({ kind: "labs", codes: [...new Set((p.need as any[]).map((n) => n.code))] } as Open)}>Record</button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

// ---------- the overview ----------
export function Consult({ s, open, done, slots }: { s: any; open(o: Open): void; done(m?: string, r?: any): void; slots: ConsultSlots }) {
  // tasks of an open complication episode live on its card, except urgent ones (21 Oct 2026: urgent follow-through
  // stays visible); routine tasks fold with the routine checks
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
  const tasksFor = (key: string) => managementTasks.filter((p) => (p.clinicalContext?.problem ?? "other") === key && (!onEpisode.has(p.id) || p.clinicalContext?.urgent) && !planAlerted.has(p.id));
  const consultation=s.consultation ?? consultationPriorities(s.attention ?? [],s.plan ?? [],s.today);
  const ranked = live.filter((a) => !routine.includes(a)).sort((x, y) => SEV[x.severity] - SEV[y.severity] || Number(decides(y)) - Number(decides(x)));
  // one card per problem with a decision (red, orange or yellow), most urgent first; the problem's other alerts sit
  // inside its card; suggestions to consider (blue) fold into "Also to review"
  const groups = new Map<string, any[]>();
  for (const a of ranked.filter((x) => x.severity !== "blue")) { const k = homeOf(a, s); groups.set(k, [...(groups.get(k) ?? []), a]); }
  // the card leads with the problem's decision (a pathway the engine can decide), its other alerts listed inside
  const stage=(a:any)=>a.severity === "red" ? 0 : consultation.clarifyIds.includes(a.id) ? 1 : a.action?.type === "plan" ? 3 : 2;
  const stageLabels=["Urgent findings", "Information needed", "Management decisions", "Follow-through"];
  const ordered = [...groups.values()].sort((a,b)=>stage(a[0])-stage(b[0]));
  const top = ordered.map((g) => g[0]);
  const extraOf = ordered.map((g) => g.slice(1));
  const rest = ranked.filter((x) => x.severity === "blue");
  // each problem's open tasks show once: with its first decision, else in its tile below
  const taskHome = new Set<string>();
  const cardTasks = (a: any) => { const k = homeOf(a, s); if (taskHome.has(k)) return []; taskHome.add(k); return tasksFor(k); };
  const topTasks = top.map(cardTasks);
  const tileTasks = (k: string) => (taskHome.has(k) ? [] : tasksFor(k));
  const laneCodes = new Set(((s.timeline?.lanes ?? []) as any[]).map((l) => l.code));
  const resultsOf = (k: string) => ((s.abnormal?.items ?? []) as any[]).filter((r) => RESULT_PROBLEM[r.code] === k && !laneCodes.has(r.code)).map((r) => `${r.label} ${r.text}${r.note ? ` (${r.note})` : ""}`);
  const cardKeys = new Set(top.map((a) => homeOf(a, s)));
  const text = brief(s);
  const outstanding=pending.filter(p=>p.awaitingReview || p.dueDate && p.dueDate<=s.today);
  const problems = (() => { try { return buildProblems(s); } catch { return []; } })();
  // a problem with nothing to say beyond "on track" folds into one line; the rest are listed
  const quiet = (p: any) => p.assessment === "met" && !p.need.length && !tileTasks(p.key).length && !((s.abnormal?.items ?? []) as any[]).some((r: any) => RESULT_PROBLEM[r.code] === p.key);
  const onTrack = problems.filter((p: any) => quiet(p) && !cardKeys.has(p.key));
  // a problem with a decision card speaks there (its results in the card); the others are listed
  const standing = problems.filter((p: any) => !quiet(p) && !cardKeys.has(p.key));
  const represented=new Set([...cardKeys,...standing.map((p:any)=>p.key),...onTrack.map((p:any)=>p.key)]);
  const orphanTasks=managementTasks.filter(p=>!represented.has(p.clinicalContext?.problem ?? "other") && !onEpisode.has(p.id));
  return (
    <div className="cx">
      {text && <p className="cx-brief">{text}</p>}
      <nav className="cx-shortcuts" aria-label="Overview sections">
        <a className="btn secondary small" href="#att">Decisions</a>
        <button className="btn secondary small" onClick={()=>openRecord("cx-results-record")}>Results</button>
        <button className="btn secondary small" onClick={()=>openRecord("cx-medications-record")}>Medicines</button>
        <button className="btn secondary small" onClick={()=>openRecord("cx-plan-record")}>Plan</button>
      </nav>
      <section className="cx-consultation" aria-label="Consultation priorities">
        <div className="cx-priority-counts">
          {consultation.counts.urgent>0 && <a href="#att" className="urgent">{consultation.counts.urgent} urgent</a>}
          <a href="#att">{consultation.counts.decisions} problems to review</a>
          {consultation.counts.clarify>0 && <a href="#att">{consultation.counts.clarify} need information</a>}
          {(consultation.counts.review>0 || consultation.counts.due>0) && <button onClick={()=>openRecord("cx-plan-record")}>{consultation.counts.review} to review · {consultation.counts.due} due</button>}
        </div>
        {consultation.connected.map((c:any)=><a className="cx-connected" href="#att" key={c.label}>{c.label}</a>)}
        {consultation.reconciliation.length>0 && <button className="cx-next-checkpoint" onClick={()=>openRecord("cx-medications-record")}><b>Medication reconciliation · {consultation.reconciliation.length}</b> {consultation.reconciliation.map((m:any)=>m.label).join(" · ")}</button>}
        {consultation.gaps.length>0 && <details className="cx-gaps"><summary>Missing information · {consultation.gaps.length}</summary>{consultation.gaps.join(" · ")}</details>}
        {consultation.next && <button className="cx-next-checkpoint" onClick={()=>openRecord("cx-plan-record")}><b>Next checkpoint</b> {consultation.next.title} · {fmtDay(consultation.next.dueDate)}</button>}
      </section>
      <div className="cx-grid">
        <div className="cx-main" id="att">
          {slots.episodes}
          <div className="cx-sec-h cx-today"><div className="cx-today-t"><h2 id="att-h">Today</h2></div></div>
          {top.length === 0 && <div className="cx-clear"><Info size={20} /> {outstanding.length > 0 ? `${outstanding.length} tasks need completion or review.` : "Review recorded data and follow-up to complete the assessment."}</div>}
          {top.map((a, i) => <section key={a.id} aria-label={stageLabels[stage(a)]}>{(i===0 || stage(top[i-1])!==stage(a)) && <h3 className="cx-stage-heading">{stageLabels[stage(a)]}</h3>}<DecisionCard a={a} n={i + 1} s={s} open={open} done={done} tasks={topTasks[i]} extra={extraOf[i]} compact={i >= 3 && a.severity !== "red"} results={resultsOf(homeOf(a, s))} prob={problems.find((p: any) => p.key === homeOf(a, s)) ?? null} /></section>)}
          {rest.length > 0 && (
            <FoldLine dot="#B54708" title={`To consider · ${rest.length}`} sub={rest.slice(0, 3).map((a) => a.title.split(":")[0]).join(" · ")}>
              {/* one review per pathway: later rows of the same pathway (e.g. three HF dose steps) point to the first */}
              {rest.map((a, i) => <Row key={a.id} a={a} s={s} open={open} done={done} covered={a.action?.type === "wizard" && rest.slice(0, i).some((x) => x.action?.type === "wizard" && x.action.wizard === a.action.wizard) ? a.action.wizard : null} coveredLabel="Same review as above" />)}
            </FoldLine>
          )}
          {orphanTasks.length>0 && <section aria-label="Outstanding work"><PlanTasks tasks={orphanTasks} open={open} today={s.today}/></section>}
          <Standing s={s} open={open} problems={standing} tasksOf={tileTasks} />
          <Pillars s={s} />
          <Lifeline s={s} />
          {onTrack.length > 0 && (
            <FoldLine dot="#0E7C66" title={`On track · ${onTrack.map((p: any) => p.label.split(" · ")[0].toLowerCase()).join(", ")}`} sub={onTrack.flatMap((p: any) => p.stats.slice(0, 1).map((x: any) => `${x.label} ${x.value}`)).join(" · ")}>
              <div className="cx-probs">{onTrack.map((p: any) => <section key={p.key} className="cx-prob st-met" aria-label={p.label}><div className="cx-prob-h"><b>{p.label}</b><span className="cx-prob-st">On track</span></div>{p.stats.length > 0 && <div className="cx-prob-stats">{p.stats.map((x: any) => `${x.label} ${x.value}`).join(" · ")}</div>}{p.goal && <div className="cx-prob-sub">{p.goal}</div>}</section>)}</div>
            </FoldLine>
          )}
          {(routine.length > 0 || routineTasks.length > 0) && (
            <FoldLine id="routine-due" dot="#8A99AF" title={`Routine checks · ${routine.length + routineTasks.length}`} sub={[...routine.map((a) => a.title.split(":")[0]), ...routineTasks.map((p) => p.title)].slice(0, 3).join(" · ")}>
              {routine.map((a) => <Row key={a.id} a={a} s={s} open={open} done={done} />)}
              <PlanTasks tasks={routineTasks} open={open} today={s.today} />
            </FoldLine>
          )}
          <FoldLine id="cx-meds" className="cx-record" dot="#13294B" title="The record" sub="Medicines, plan and all results">
            <div className="stack"><section id="cx-medications-record" tabIndex={-1}>{slots.meds}</section><section id="cx-plan-record" tabIndex={-1}>{slots.plan}</section><section id="cx-results-record" tabIndex={-1}>{slots.results}</section>{slots.dismissed}</div>
          </FoldLine>
          {slots.more && (
            <FoldLine className="module-detail" remember="cf.fold.more" dot="#5B6B7F" title="More detail" sub={slots.moreLabel ?? "Classification, procedures, devices and surveillance"}>
              {slots.more}
            </FoldLine>
          )}
        </div>
        <Rail s={s} open={open} />
      </div>
    </div>
  );
}
