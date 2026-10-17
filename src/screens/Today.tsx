// The overview's first screen (redesign, 14 Oct 2026 — Ahmed: "problems at a glance, which I prefer", no
// duplicate lanes): the brief, then one card per problem — where it stands against its guideline goal, what
// data the decision still needs, and every open item for it with its action. Nothing is listed twice: an item
// lives in its problem's card; items with no problem go to "Other". Due tests are gathered in one button.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, FlaskConical, X, RotateCcw, AlertTriangle } from "lucide-react";
import { api } from "../api";
import { formatNumber, MEASURES, MEDICATION } from "../../shared/catalog";
import { fmtDay } from "../../shared/clinical";
import { triage, PANEL_OF } from "../../shared/triage";
import { ActionButton, WhyPanel } from "./Summary";
import { SuggestLine } from "./SuggestLine";
import { DecisionPanel } from "./Decision";
import { WIZARDS } from "../../shared/wizards";
import type { Open } from "./Patient";

export function useTriage(s: any) {
  const cards = triage(s.attention);
  // module panels holding an urgent or decision item start open on larger screens
  const hot = new Set(cards.filter((c) => c.lane === "act" || c.lane === "decide").flatMap((c) => c.items.map((f) => PANEL_OF(f.rule_id))).filter(Boolean) as string[]);
  return { cards, hot };
}

const SEV_RANK: Record<string, number> = { red: 0, orange: 1, yellow: 2, blue: 3 };
// which problem an alert belongs to (one place only)
const PROBLEM_OF = (ruleId: string): string => {
  if (["hf.hyperkalaemia-review", "hf.worsening-renal-function", "safety.low-potassium", "safety.hyponatraemia", "ops.monitoring-after-change"].includes(ruleId) || ruleId.startsWith("cardiorenal.")) return "kidney";
  if (["lab.anaemia", "lab.iron-deficiency", "hf.iron-deficiency", "safety.bleeding"].includes(ruleId)) return "anaemia";
  if (["safety.inr", "safety.digoxin", "event.amiodarone-thyroid"].includes(ruleId)) return "af";
  if (["lab.liver-enzymes", "lab.statin-ck"].includes(ruleId)) return "lipids";
  if (ruleId.startsWith("hf.")) return "hf";
  if (ruleId.startsWith("htn.")) return "bp";
  if (ruleId.startsWith("lipids.")) return "lipids";
  if (ruleId.startsWith("dm.") || ruleId.startsWith("metabolic.")) return "diabetes";
  if (ruleId.startsWith("af.") || ruleId.startsWith("rhythm.")) return "af";
  if (ruleId.startsWith("cad.") || ruleId.startsWith("acs.")) return "cad";
  if (ruleId.startsWith("valve.") || ruleId.startsWith("structural.")) return "valve";
  if (ruleId.startsWith("cmp.")) return "cmp";
  if (ruleId.startsWith("ph.")) return "ph";
  return "other";
};
type Stat = { label: string; value: string; tone?: "ok" | "warn" | "bad" };
type Problem = { key: string; label: string; sub?: string; history?: string[]; stats: Stat[]; goal?: string; therapy?: string; need: { code: string; label: string }[] };
const TITLES: Record<string, string> = { hf: "Heart failure", kidney: "Kidney & potassium", anaemia: "Anaemia & iron", bp: "Blood pressure", lipids: "Lipids", diabetes: "Diabetes", af: "Atrial fibrillation", cad: "Coronary disease", valve: "Valve / structural", cmp: "Cardiomyopathy", ph: "Pulmonary hypertension", other: "Other alerts" };
const labelOf = (c: string) => NEED_LABEL[c] ?? MEASURES[c]?.short ?? MEASURES[c]?.display ?? c;
const NEED_LABEL: Record<string, string> = { sbp: "BP", dbp: "BP", hr: "Heart rate", weight: "Weight", creatinine: "Creatinine", potassium: "Potassium", "ldl-c": "LDL-C", hba1c: "HbA1c", uacr: "UACR", haemoglobin: "Hb", ferritin: "Ferritin", tsat: "TSAT", inr: "INR", "nt-probnp": "NT-proBNP" };

export function TodayBoard({ s, open, done }: { s: any; open(o: Open): void; done(message?: string): void }) {
  const [why, setWhy] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [selected, setSelected] = useState<string|null>(null);
  const [dismiss, setDismiss] = useState<string | null>(null);
  const row: RowProps = { selected, setSelected, why, setWhy, open, done, patientId: s.header.id, s, line, setLine, dismiss, setDismiss };
  const problems = buildProblems(s);
  // an alert whose problem has no card of its own (e.g. statin CK without a lipid card) gets a card with the
  // problem's name, so nothing on the list is ever left out of the overview
  for (const key of new Set((s.attention as any[]).map((a) => PROBLEM_OF(a.rule_id))))
    if (!problems.some((p) => p.key === key)) problems.splice(problems.length - 1, 0, { key, label: TITLES[key] ?? TITLES.other, stats: [], need: [] } as Problem);
  const items = (key: string) => (s.attention as any[]).filter((a) => PROBLEM_OF(a.rule_id) === key).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const shown = problems.filter((p) => p.key !== "other" || items("other").length);
  const rank = (p: Problem) => { const r = items(p.key)[0]; return r ? SEV_RANK[r.severity] : 9; };
  shown.sort((x, y) => rank(x) - rank(y));
  // one decision per pathway: the first alert (in display order) that opens it carries the plan
  const panels = new Set<string>(), seenWiz = new Set<string>();
  for (const p of shown) for (const a of items(p.key).filter((x) => x.severity !== "blue"))
    if (decides(a) && !seenWiz.has(a.action.wizard)) { seenWiz.add(a.action.wizard); panels.add(a.id); }
  row.panels = panels;
  // every due test in one entry (the items stay in their problem cards)
  const dueLabs = (s.attention as any[]).filter((a) => a.action?.type === "add-labs");
  const dueCodes = [...new Set([...dueLabs.flatMap((a) => a.action.codes ?? []), ...shown.flatMap((p) => p.need.map((n) => n.code))])];
  const urgent = (s.attention as any[]).filter((a) => a.severity === "red").length;
  const decisions = (s.attention as any[]).filter((a) => a.action?.type !== "add-labs").length;
  const draft = s.attention.some((a: any) => a.rule_status !== "PUBLISHED");
  return (
    <section className="tb" aria-labelledby="att-h" id="att">
      <div className="tb-head">
        <h2 id="att-h">Today</h2>
        <Brief o={s.overview} />
      </div>
      {s.attention.length === 0 && !s.plan.some((p: any) => p.awaitingReview) ? (
        <div className="tb-clear"><CheckCircle2 size={22} /> Nothing needs attention. Every plan item is on track.</div>
      ) : (
        <div className="tb-summary">
          {urgent > 0 && <span className="tb-count red"><AlertTriangle size={15} /> {urgent} urgent</span>}
          {decisions > 0 && <span className="tb-count">{decisions} decision{decisions === 1 ? "" : "s"}</span>}
          {dueCodes.length > 0 && (
            <button className="btn primary small tb-labs" onClick={() => open({ kind: "labs", codes: dueCodes })}>
              <FlaskConical size={15} /> Enter due results · {dueCodes.map(labelOf).filter((v, i, all) => all.indexOf(v) === i).slice(0, 5).join(", ")}{dueCodes.length > 5 ? "…" : ""}
            </button>
          )}
        </div>
      )}
      {draft && <p className="tb-draft">Items marked “in review” come from rules still in clinical review. They run on this sandbox only.</p>}
      {s.plan.some((p: any) => p.awaitingReview) && <div className="lane review-queue" aria-label="Results awaiting review">
        <div className="lane-head"><span className="lane-title">Results to review</span><span className="lane-hint">Recorded evidence, awaiting your decision</span></div>
        <div className="lane-rows">{s.plan.filter((p: any) => p.awaitingReview).map((p: any) => <div className="review-row" key={p.id}><div><b>{p.title}</b><span className="small muted">{p.owner ? `Owner: ${p.owner} · ` : ""}{p.completedAt ? fmtDay(p.completedAt) : "Result recorded"}</span></div><button className="btn secondary small" onClick={() => open({ kind: "plan-item", planId: p.id })}>Review result</button></div>)}</div>
      </div>}
      <div className="problems" aria-label="Problems at a glance">
        {shown.map((p) => <ProblemCard key={p.key} p={p} items={items(p.key)} row={row} />)}
      </div>
      <Dismissed s={s} done={done} />
    </section>
  );
}

function ProblemCard({ p, items, row }: { p: Problem; items: any[]; row: RowProps }) {
  const [more, setMore] = useState(false);
  const top = items[0];
  // low-priority suggestions fold under "to consider" so the card leads with what matters
  const main = items.filter((a) => a.severity !== "blue" || a.rule_id === "htn.rdn");
  const consider = items.filter((a) => a.severity === "blue" && a.rule_id !== "htn.rdn");
  return (
    <section className={`problem ${top ? `p-${top.severity}` : "ok"}`} aria-label={p.label}>
      <div className="problem-head">
        <b>{p.label}</b>
        {p.sub && <span className="problem-sub">{p.sub}</span>}
        {!top && <span className="problem-ok"><CheckCircle2 size={15} /> On track</span>}
      </div>
      {p.history && p.history.length > 0 && <ol className="problem-history" aria-label="History">{p.history.map((h, i) => <li key={i}>{h}</li>)}</ol>}
      {p.stats.length > 0 && (
        <div className="problem-stats">
          {p.stats.map((x, i) => <span key={i} className={`pstat ${x.tone ?? ""}`}><small>{x.label}</small>{x.value}</span>)}
        </div>
      )}
      {(p.goal || p.therapy) && <div className="problem-goal">{[p.goal, p.therapy].filter(Boolean).join(" · ")}</div>}
      {p.need.length > 0 && (
        <div className="problem-need">
          <span>Needed for the decision: <b>{[...new Set(p.need.map((n) => n.label))].join(", ")}</b></span>
          <button className="btn ghost small" onClick={() => row.open({ kind: "labs", codes: [...new Set(p.need.map((n) => n.code))] })}>Record</button>
        </div>
      )}
      {main.length > 0 && <div className="problem-items">{main.map((a) => <Item key={a.id} a={a} {...row} />)}</div>}
      {consider.length > 0 && (
        <div className="problem-consider">
          <button type="button" className="btn ghost small" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Hide" : `${consider.length} to consider`} <ChevronDown size={14} style={{ transform: more ? "rotate(180deg)" : undefined }} /></button>
          {more && <div className="problem-items">{consider.map((a) => <Item key={a.id} a={a} compact {...row} />)}</div>}
        </div>
      )}
    </section>
  );
}

// the problems this patient has, from the problem list and the guideline targets
function buildProblems(s: any): Problem[] {
  const t = s.targets ?? {};
  const n = (v: number | null | undefined, d = 0) => (v == null ? "—" : formatNumber(v, d));
  const R: Record<string, any> = Object.fromEntries((s.reviewContext?.results ?? []).map((r: any) => [r.code, r]));
  const days = (at: string | null) => (at ? Math.round((Date.parse(s.today) - Date.parse(String(at).slice(0, 10))) / 86400000) : null);
  const recent = (code: string, within: number) => R[code]?.value != null && (days(R[code].at) ?? 9999) <= within;
  const val = (code: string, d = 0) => (R[code]?.value != null ? `${n(R[code].value, d)}${R[code].at ? ` · ${fmtDay(R[code].at)}` : ""}` : "Not recorded");
  const meds = (s.medications?.groups ?? []).flatMap((g: any) => g.meds).filter((m: any) => m.status === "active" || m.status === "held");
  const line = (tags: string[]) => meds.filter((m: any) => m.tags?.some((x: string) => tags.includes(x))).map((m: any) => `${m.name} ${m.dose}${m.status === "held" ? " (held)" : ""}`).join(" · ");
  const dx = new Set<string>((s.header?.diagnoses ?? []).map((d: any) => d.code));
  const tagSet = new Set<string>(s.header?.tags ?? []);
  const has = (...codes: string[]) => codes.some((c) => dx.has(c) || tagSet.has(c));
  const need = (codes: string[], within: number) => codes.filter((c) => !recent(c, within)).map((c) => ({ code: c, label: labelOf(c) }));
  const out: Problem[] = [];
  if (t.hf) {
    const on = t.hf.pillars.filter((x: any) => x.state === "on" || x.state === "target").length;
    out.push({
      key: "hf", label: `${TITLES.hf} · ${t.hf.phenotype}${t.hf.lvef != null ? ` · LVEF ${n(t.hf.lvef)}%` : ""}`,
      sub: s.hf?.admissions?.last12m ? `${s.hf.admissions.last12m} HF admission${s.hf.admissions.last12m === 1 ? "" : "s"} in 12 months` : undefined,
      stats: [
        ...t.hf.pillars.map((x: any) => ({ label: x.label.split(" (")[0].replace("ARNI / ACE inhibitor / ARB", "ARNI/ACEi/ARB"), value: x.state === "target" ? "At target" : x.state === "on" ? `${x.percentOfTarget ?? "?"}% of target` : x.state === "held" ? "Held" : x.state === "blocked" ? "Not now" : "Not started", tone: x.state === "target" ? "ok" : x.state === "on" ? undefined : "warn" })),
        ...(R["nt-probnp"]?.value != null ? [{ label: "NT-proBNP", value: val("nt-probnp") }] : []),
      ],
      goal: `${on} of ${t.hf.pillars.length} foundational medicines · goal: all at target or maximum tolerated dose`,
      therapy: line(["loop", "thiazide"]) ? `Diuretic: ${line(["loop", "thiazide"])}` : undefined,
      need: need(["sbp", "hr", "weight"], 60),
    });
  }
  const k = t.kidney;
  if (k && (k.egfr != null || k.k != null || has("ckd"))) {
    const stats: Stat[] = [];
    if (k.egfr != null) stats.push({ label: "eGFR", value: `${n(k.egfr)}${k.egfrAt ? ` · ${fmtDay(k.egfrAt)}` : ""}`, tone: k.egfr < 30 ? "bad" : k.egfr < 60 ? "warn" : "ok" });
    if (k.creatinine) stats.push({ label: "Creatinine vs baseline", value: `${n(k.creatinine.baseline)} → ${n(k.creatinine.current)} (${k.creatinine.rise >= 0 ? "+" : ""}${k.creatinine.rise}%)`, tone: k.creatinine.review ? "bad" : undefined });
    if (k.k != null) stats.push({ label: "Potassium", value: `${n(k.k, 1)}${k.kAt ? ` · ${fmtDay(k.kAt)}` : ""}`, tone: k.k > 5.5 || k.k < 3.5 ? "bad" : k.k > 5.0 ? "warn" : "ok" });
    if (R.sodium?.value != null) stats.push({ label: "Sodium", value: val("sodium"), tone: R.sodium.value < 135 ? "warn" : "ok" });
    if (k.uacr != null) stats.push({ label: "UACR", value: `${n(k.uacr, 1)} mg/mmol`, tone: k.uacr >= 3 ? "warn" : "ok" });
    out.push({ key: "kidney", label: TITLES.kidney, stats, therapy: line(["raas", "mra", "sglt2", "k-binder"]) || undefined, need: has("ckd") || t.hf ? need(["creatinine", "potassium"], 90) : [] });
  }
  if (has("anaemia") || (R.haemoglobin?.value != null && R.haemoglobin.value < (s.header?.sex === "Female" ? 12 : 13)) || (s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === "anaemia"))
    out.push({ key: "anaemia", label: TITLES.anaemia, stats: [{ label: "Hb", value: val("haemoglobin", 1), tone: "warn" }, { label: "Ferritin", value: val("ferritin") }, { label: "TSAT", value: R.tsat?.value != null ? `${n(R.tsat.value)}%` : "Not recorded" }], therapy: line(["oac", "antiplatelet"]) ? `Antithrombotic: ${line(["oac", "antiplatelet"])}` : undefined, need: need(["ferritin", "tsat"], 365) });
  if (t.af) {
    const hr = R.hr?.value;
    out.push({
      key: "af", label: TITLES.af, sub: undefined,
      stats: [
        { label: "CHA₂DS₂-VA", value: String(t.af.score) },
        { label: "Anticoagulant", value: t.af.oac.length ? t.af.oac.join(" · ") : "None", tone: t.af.oac.length ? "ok" : t.af.score >= 2 ? "bad" : undefined },
        { label: "Heart rate", value: val("hr"), tone: hr == null ? undefined : hr >= 110 ? "warn" : "ok" },
        ...(t.af.inr != null ? [{ label: "INR", value: n(t.af.inr, 1) }] : []),
      ],
      therapy: line(["bb", "bb-other", "ndhp-ccb", "digoxin", "rate-slowing"]) ? `Rate control: ${line(["bb", "bb-other", "ndhp-ccb", "digoxin"])}` : undefined,
      need: need(["hr"], 60).concat(t.af.oac.length ? need(["weight", "creatinine"], 365) : []),
    });
  }
  if (has("cad", "ascvd") || (s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === "cad"))
    out.push({ key: "cad", label: TITLES.cad, sub: s.header?.ihd?.label?.replace(/^IHD · /, ""), history: (s.header?.ihd?.events ?? []).map((e: any) => e.text), stats: [{ label: "Antithrombotic", value: line(["antiplatelet", "oac"]) || "None" }, ...(line(["nitrate", "nitrate-sl", "ranolazine", "ivabradine"]) ? [{ label: "Anti-anginal", value: line(["nitrate", "ranolazine", "ivabradine"]) }] : [])], need: [] });
  if (t.ldl) out.push({ key: "lipids", label: TITLES.lipids, stats: [{ label: "LDL-C", value: t.ldl.value != null ? `${n(t.ldl.value, 2)} mmol/L${t.ldl.at ? ` · ${fmtDay(t.ldl.at)}` : ""}` : "Not measured", tone: t.ldl.met === true ? "ok" : t.ldl.met === false ? "warn" : undefined }], goal: `Goal <${t.ldl.goal} mmol/L · ${t.ldl.category} risk`, therapy: t.ldl.therapy.length ? t.ldl.therapy.join(" + ") : "No lipid-lowering therapy", need: need(["ldl-c"], 365) });
  if (t.bp) out.push({ key: "bp", label: TITLES.bp, stats: [{ label: "Latest", value: t.bp.sbp != null ? `${n(t.bp.sbp)}${t.bp.dbp != null ? "/" + n(t.bp.dbp) : ""} mmHg${t.bp.at ? ` · ${fmtDay(t.bp.at)}` : ""}` : "Not measured", tone: t.bp.met === true ? "ok" : t.bp.met === false ? "warn" : undefined }], goal: t.bp.target === "Individualized" ? "Individualized target" : `Goal ${t.bp.target}/${t.bp.diastolicTarget} if tolerated (ESC 2024)`, need: need(["sbp"], 90) });
  if (t.diabetes) out.push({ key: "diabetes", label: TITLES.diabetes, stats: [{ label: "HbA1c", value: t.diabetes.hba1c != null ? `${n(t.diabetes.hba1c, 1)}%${t.diabetes.at ? ` · ${fmtDay(t.diabetes.at)}` : ""}` : "Not measured", tone: t.diabetes.met === true ? "ok" : t.diabetes.met === false ? "warn" : undefined }], goal: `Target ${t.diabetes.target}`, therapy: t.diabetes.therapy.length ? t.diabetes.therapy.join(" · ") : "No glucose-lowering therapy", need: need(["hba1c"], 180) });
  for (const key of ["valve", "cmp", "ph"]) if ((s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === key)) out.push({ key, label: TITLES[key], stats: [], need: [] });
  out.push({ key: "other", label: TITLES.other, stats: [], need: [] });
  return out;
}

type RowProps = { selected:string|null; setSelected(id:string|null):void; panels?: Set<string>; dismiss: string | null; setDismiss(id: string | null): void; why: string | null; setWhy(id: string | null): void; open(o: Open): void; done(message?: string): void; patientId: string; s: any; line: string | null; setLine(id: string | null): void };


// an alert that opens a pathway shows the pathway's decision on the card (the after-PCI plan opens its own
// sheet; a joined pathway is recorded in the pathway)
const decides = (a: any) => a.action?.type === "wizard" && a.severity !== "blue" && !(a.action.wizard === "antithrombotic" && a.rule_id === "cad.antithrombotic-plan" && /PCI/.test(a.title));
function Item({ a, compact, ...p }: { a: any; compact?: boolean } & RowProps) {
  // a medicine start or dose change opens inline as an editable line (drug, dose, dates)
  const inline = (a.action?.type === "start-med" && MEDICATION[a.action.code]) || a.action?.type === "titrate";
  return (
    <div className={`item${compact ? " compact" : ""}`}>
      <div className="item-main">
        <span className={`tick sev-${a.severity}`} aria-hidden="true" />
        <div className="item-txt">
          <span className="t">
            {a.title}
            {a.rule_status !== "PUBLISHED" && <em className="review">in review</em>}
          </span>
          {!compact && p.why === a.id && a.detail && <span className="d">{a.detail}</span>}
        </div>
        <div className="item-acts">
          <button className="why" aria-expanded={p.why === a.id} onClick={() => p.setWhy(p.why === a.id ? null : a.id)}>Why?</button>
          <button className="dismiss" aria-expanded={p.dismiss === a.id} aria-label={`Not needed: ${a.title}`} title="Not needed — dismiss" onClick={() => p.setDismiss(p.dismiss === a.id ? null : a.id)}><X size={16} /></button>
          {inline ? (
            <button className="go" aria-expanded={p.line === a.id} onClick={() => p.setLine(p.line === a.id ? null : a.id)}>{a.action.label}</button>
          ) : (
            <ActionButton a={a} open={p.open} />
          )}
        </div>
      </div>
      {p.why === a.id && <WhyPanel a={a} patientId={p.patientId} done={p.done} />}
      {p.dismiss === a.id && <DismissPanel a={a} patientId={p.patientId} done={p.done} onCancel={() => p.setDismiss(null)} />}
      {inline && p.line === a.id && <SuggestLine a={a} s={p.s} open={p.open} done={p.done} onCancel={() => p.setLine(null)} />}
      {!compact && decides(a) && p.panels?.has(a.id) && <div className="decision-entry"><button className="btn secondary small" aria-expanded={p.selected===a.id} onClick={()=>p.setSelected(p.selected===a.id?null:a.id)}>{p.selected===a.id?"Close decision":"Review plan"}</button>{p.selected===a.id&&<DecisionPanel key={a.id} a={a} patientId={p.patientId} open={p.open} done={p.done}/>}</div>}
    </div>
  );
}


function Brief({ o }: { o: any }) {
  if (!o) return null;
  const parts: [string, string][] = [
    ["Why here", o.why.text + (o.why.sub ? ` · ${o.why.sub}` : "")],
    ["Changed", o.changed.since ? `${o.changed.count} since ${o.changed.label?.toLowerCase().replace(/^since /, "") ?? "last review"}` : "No earlier review"],
    ["Unfinished", o.unfinished.overdue + o.unfinished.due + (o.unfinished.review ?? 0) === 0 ? "Nothing overdue" : [o.unfinished.overdue && `${o.unfinished.overdue} overdue`, o.unfinished.due && `${o.unfinished.due} due today`, o.unfinished.review && `${o.unfinished.review} to review`].filter(Boolean).join(", ")],
    ["Next", o.next[0] ? `${o.next[0].title} · ${fmtDay(o.next[0].dueDate, { weekday: true })}` : "Nothing booked"],
  ];
  return (
    <dl className="brief">
      {parts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// A module panel that folds to its header and one-line summary. Panels holding an act-now or decide
// finding start open; the clinician's choice is remembered on this device.
export function Fold({ k, hot, children }: { k: string; hot: boolean; children: ReactNode }) {
  const key = "cf.fold." + k;
  const [isOpen, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v === "1";
    } catch {}
    // phones: module panels start folded (Today already lists what needs doing) so the page stays short
    const phone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;
    return hot && !phone;
  });
  const ref = useRef<HTMLDivElement>(null);
  const toggle = () =>
    setOpen((v) => {
      try { localStorage.setItem(key, v ? "0" : "1"); } catch {}
      return !v;
    });
  useEffect(() => {
    const h = ref.current?.querySelector<HTMLElement>(".card-head h2");
    if (!h) return;
    h.tabIndex = 0;
    h.setAttribute("role", "button");
    h.setAttribute("aria-expanded", String(isOpen));
  });
  return (
    <div
      ref={ref}
      className={`fold${isOpen ? " open" : ""}`}
      onClick={(e) => { if ((e.target as HTMLElement).closest(".card-head h2")) toggle(); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).matches(".card-head h2")) { e.preventDefault(); toggle(); } }}
    >
      {children}
    </div>
  );
}

// "Not needed": the clinician closes an alert or decision with a one-tap reason. It stays closed until the data
// behind it change (the engine then raises a new one) and can be shown again from "Dismissed".
const DISMISS_REASONS: { value: string; label: string; outcome: "declined" | "deferred" }[] = [
  { value: "not-relevant", label: "Not relevant for this patient", outcome: "declined" },
  { value: "done", label: "Already done or managed elsewhere", outcome: "declined" },
  { value: "patient", label: "Patient declined", outcome: "declined" },
  { value: "later", label: "Not now — review later", outcome: "deferred" },
];
function DismissPanel({ a, patientId, done, onCancel }: { a: any; patientId: string; done(message?: string): void; onCancel(): void }) {
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const r = DISMISS_REASONS.find((x) => x.value === pick);
  async function save() {
    if (!r || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/recommendations/${a.id}/decline`, { body: { outcome: r.outcome, reason: [r.label, note.trim()].filter(Boolean).join(": "), also: (a.also ?? []).map((x: any) => x.id) } });
      done(r.outcome === "deferred" ? "Set aside for later · shown under Dismissed" : "Dismissed · shown again if the data change");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="dismiss-panel">
      <b>Not needed?</b>
      <div className="choices" role="radiogroup" aria-label="Why it is not needed">
        {DISMISS_REASONS.map((x) => (
          <button key={x.value} type="button" className="choice small" role="radio" aria-checked={pick === x.value} aria-pressed={pick === x.value} onClick={() => setPick(x.value)}>{x.label}</button>
        ))}
      </div>
      <input className="input" placeholder="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary small" disabled={!r || busy} onClick={save}>{busy ? "Saving…" : "Dismiss"}</button>
        <button className="btn ghost small" onClick={onCancel}>Keep it</button>
        {error && <span className="small" style={{ color: "var(--red-ink)", fontWeight: 700 }}>{error}</span>}
      </div>
    </div>
  );
}

function Dismissed({ s, done }: { s: any; done(message?: string): void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const list: any[] = s.dismissed ?? [];
  if (!list.length) return null;
  async function restore(id: string) {
    setBusy(id);
    try {
      await api(`/patients/${s.header.id}/recommendations/${id}/restore`, { body: {} });
      done("Shown again");
    } catch (e) {
      done((e as Error).message);
    }
    setBusy(null);
  }
  return (
    <details className="lane dismissed-list">
      <summary>
        <span className="lane-title">Dismissed</span>
        <span className="lane-hint">{list.length} in the last 90 days · tap to show one again</span>
        <ChevronDown size={18} className="chev" />
      </summary>
      <div className="lane-rows">
        {list.map((d) => (
          <div className="dismissed-row" key={d.id}>
            <span className={`tick sev-${d.severity}`} aria-hidden="true" />
            <div className="grow">
              <b>{d.title}</b>
              <span className="small muted">{d.outcome === "deferred" ? "Later" : "Not needed"} · {d.reason}{d.closed_at ? ` · ${fmtDay(d.closed_at)}` : ""}</span>
            </div>
            <button className="btn ghost small" disabled={busy === d.id} onClick={() => restore(d.id)}><RotateCcw size={14} /> Show again</button>
          </div>
        ))}
      </div>
    </details>
  );
}

// Problems at a glance: each active problem with where it stands against its guideline goal and the first open
