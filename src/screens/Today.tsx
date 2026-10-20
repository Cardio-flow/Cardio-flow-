// The overview's first screen (redesign, 14 Oct 2026 — Ahmed: "problems at a glance, which I prefer", no
// duplicate lanes): the brief, then one card per problem — where it stands against its guideline goal, what
// data the decision still needs, and every open item for it with its action. Nothing is listed twice: an item
// lives in its problem's card; items with no problem go to "Other". Due tests are gathered in one button.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, FlaskConical, X, RotateCcw, AlertTriangle, Info } from "lucide-react";
import { api } from "../api";
import { formatNumber, MEASURES, MEDICATION } from "../../shared/catalog";
import { fmtDay } from "../../shared/clinical";
import { triage, PANEL_OF } from "../../shared/triage";
import { ActionButton, WhyPanel } from "./Summary";
import { HeldMedicines, ResultRows } from "./Story";
import { SuggestLine } from "./SuggestLine";
import { DecisionPanel } from "./Decision";
import { WIZARDS } from "../../shared/wizards";
import { pregnancyHaemoglobinCutoff } from "../../shared/pregnancy";
import type { Open } from "./Patient";

export function useTriage(s: any) {
  const cards = triage(s.attention);
  // module panels holding an urgent or decision item start open on larger screens
  const hot = new Set(cards.filter((c) => c.lane === "act" || c.lane === "decide").flatMap((c) => c.items.map((f) => PANEL_OF(f.rule_id))).filter(Boolean) as string[]);
  return { cards, hot };
}

const SEV_RANK: Record<string, number> = { red: 0, orange: 1, yellow: 2, blue: 3 };
// which problem an alert belongs to (one place only)
// shown under "Before discharge or at clinic" during an admission (display grouping only; red never folds)
const CLINIC_LATER = new Set(["lipids.lpa-once", "lipids.ldl-goal", "cardiorenal.screening", "cardiorenal.finerenone", "cardiorenal.ckd-stage", "cardiorenal.stage-review", "dm.annual-checks", "dm.hba1c-due", "dm.glycaemic-control", "metabolic.obesity", "metabolic.diabetes-cv-protection", "hf.device-assessment", "cad.rehab", "cad.dapt-beyond-default", "htn.bp-target", "htn.management", "htn.secondary", "htn.rdn", "lab.vitamin-d", "cmp.family-screening", "cmp.genetic-testing", "valve.echo-surveillance", "rhythm.remote-monitoring", "rhythm.device-check-due"]);
const CLINIC_CARDS = ["lipids", "diabetes", "bp"];
const PROBLEM_OF = (ruleId: string): string => {
  if (["hf.hyperkalaemia-review", "hf.worsening-renal-function", "safety.low-potassium", "safety.hyponatraemia", "ops.monitoring-after-change"].includes(ruleId) || ruleId.startsWith("cardiorenal.")) return "kidney";
  if (["lab.anaemia", "lab.iron-deficiency", "hf.iron-deficiency", "safety.bleeding"].includes(ruleId)) return "anaemia";
  if (ruleId.startsWith("med.") || ruleId === "meds.not-taking") return "medication";
  if (ruleId.startsWith("pregnancy."))return "pregnancy";
  if (ruleId.startsWith("aorta.")) return "aorta";
  if (ruleId === "event.pericarditis") return "pericardial";
  if (ruleId === "event.syncope") return "syncope";
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
// every result belongs to one problem card; abnormal ones are listed there once, with their trend, and the
// rest of a card's results as one "normal" line (20 Oct 2026: one home for every fact)
const RESULT_PROBLEM: Record<string, string> = {
  creatinine: "kidney", urea: "kidney", potassium: "kidney", sodium: "kidney", magnesium: "kidney", uacr: "kidney", bicarbonate: "kidney", chloride: "kidney", phosphate: "kidney", "calcium-total": "kidney", calcium: "kidney", urate: "kidney",
  alt: "lipids", ast: "lipids", ck: "lipids", alp: "lipids", ggt: "lipids", bilirubin: "lipids",
  haemoglobin: "anaemia", ferritin: "anaemia", tsat: "anaemia", iron: "anaemia", transferrin: "anaemia", mcv: "anaemia", b12: "anaemia", folate: "anaemia", platelets: "anaemia", wbc: "anaemia",
  "nt-probnp": "hf", bnp: "hf",
  "ldl-c": "lipids", "total-cholesterol": "lipids", "hdl-c": "lipids", triglycerides: "lipids", lpa: "lipids",
  hba1c: "diabetes", glucose: "diabetes", ketones: "diabetes",
  inr: "af",
};
const resultHome = (code: string, keys: Set<string>) => { const k = RESULT_PROBLEM[code]; return k && keys.has(k) ? k : "results"; };
type Stat = { label: string; value: string; tone?: "ok" | "warn" | "bad" };
type Problem = { key: string; label: string; sub?: string; history?: string[]; stats: Stat[]; goal?: string; therapy?: string; need: { code: string; label: string }[]; assessment?: "met" | "above" | "incomplete" | "review" };
const TITLES: Record<string, string> = { results: "Other results", pregnancy:"Pregnancy & heart disease", pericardial:"Pericardial disease", medication:"Medication review", aorta:"Thoracic aorta", syncope: "Syncope & unexplained falls", hf: "Heart failure", kidney: "Kidney & potassium", anaemia: "Blood count & iron", bp: "Blood pressure", lipids: "Lipids", diabetes: "Diabetes", af: "Atrial fibrillation", cad: "Coronary disease", valve: "Valve / structural", cmp: "Cardiomyopathy", ph: "Pulmonary hypertension", other: "Other alerts" };
const labelOf = (c: string) => NEED_LABEL[c] ?? MEASURES[c]?.short ?? MEASURES[c]?.display ?? c;
const NEED_LABEL: Record<string, string> = { sbp: "BP", dbp: "BP", hr: "Heart rate", weight: "Weight", creatinine: "Creatinine", potassium: "Potassium", "ldl-c": "LDL-C", hba1c: "HbA1c", uacr: "UACR", haemoglobin: "Hb", ferritin: "Ferritin", tsat: "TSAT", inr: "INR", "nt-probnp": "NT-proBNP" };

export function TodayBoard({ s, open, done }: { s: any; open(o: Open): void; done(message?: string): void }) {
  const [why, setWhy] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [selected, setSelected] = useState<string|null>(null);
  const [dismiss, setDismiss] = useState<string | null>(null);
  const row: RowProps = { selected, setSelected, why, setWhy, open, done, patientId: s.header.id, s, line, setLine, dismiss, setDismiss };
  const problems = buildProblems(s);
  // Admission mode (19 Oct 2026, audit): during an open admission, outpatient screening and long-term
  // optimisation fold into "Before discharge or at clinic" (red items never fold). Due plan items of an open
  // complication episode live on its card, not again as alerts.
  const admitted = s.header?.openContext?.kind === "admission";
  const onEpisode = new Set<string>((s.episodes ?? []).filter((e: any) => e.status === "open").flatMap((e: any) => (e.open ?? []).map((x: any) => x.id)));
  const later = (a: any) => admitted && a.severity !== "red" && CLINIC_LATER.has(a.rule_id);
  const attention = (s.attention as any[]).filter((a) => !(a.action?.type === "plan" && onEpisode.has(a.action.planId)));
  const deferred = attention.filter(later);
  // an alert whose problem has no card of its own (e.g. statin CK without a lipid card) gets a card with the
  // problem's name, so nothing on the list is ever left out of the overview
  for (const key of new Set(attention.map((a) => PROBLEM_OF(a.rule_id))))
    if (!problems.some((p) => p.key === key)) problems.splice(problems.length - 1, 0, { key, label: TITLES[key] ?? TITLES.other, stats: [], need: [] } as Problem);
  // an abnormal result whose problem has no card yet gets that card (kidney, anaemia…); the rest go to
  // "Other results" — nothing abnormal is ever left off the overview
  for (const r of (s.abnormal?.items ?? []) as any[]) {
    const k = RESULT_PROBLEM[r.code];
    if (k && ["kidney", "anaemia"].includes(k) && !problems.some((p) => p.key === k)) problems.splice(problems.length - 1, 0, { key: k, label: TITLES[k], stats: [], need: [] } as Problem);
  }
  const keys = new Set(problems.map((p) => p.key));
  const resultsOf = (key: string) => ((s.abnormal?.items ?? []) as any[]).filter((r) => resultHome(r.code, keys) === key);
  const normalOf = (key: string) => ((s.abnormal?.normal ?? []) as any[]).filter((r) => resultHome(r.code, keys) === key).map((r) => r.text);
  if (resultsOf("results").length) problems.splice(problems.length - 1, 0, { key: "results", label: TITLES.results, stats: [], need: [] } as Problem);
  row.resultsOf = resultsOf;
  row.normalOf = normalOf;
  const items = (key: string) => attention.filter((a) => PROBLEM_OF(a.rule_id) === key && !later(a)).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const laterOf = (key: string) => deferred.filter((a) => PROBLEM_OF(a.rule_id) === key);
  // a card left with nothing for today during an admission goes into the folded clinic section
  // (only lipids, diabetes and BP: kidney, HF and the rest keep their results in view during the admission)
  const clinicCard = (p: Problem) => admitted && !items(p.key).length && CLINIC_CARDS.includes(p.key);
  const all = problems.filter((p) => (p.key !== "other" || items("other").length || laterOf("other").length));
  const shown = all.filter((p) => !clinicCard(p));
  const clinic = all.filter(clinicCard);
  // a card with only results ranks after cards with alerts; "Other results" stays last of them
  const rank = (p: Problem) => { const r = items(p.key)[0]; return r ? SEV_RANK[r.severity] : resultsOf(p.key).length ? (p.key === "results" ? 8 : 7) : 9; };
  shown.sort((x, y) => rank(x) - rank(y));
  // one decision per pathway: the first alert (in display order) that opens it carries the plan
  const panels = new Set<string>(), seenWiz = new Set<string>();
  for (const p of shown) for (const a of items(p.key).filter((x) => x.severity !== "blue"))
    if (decides(a) && !seenWiz.has(a.action.wizard)) { seenWiz.add(a.action.wizard); panels.add(a.id); }
  row.panels = panels;
  // every due test in one entry (the items stay in their problem cards)
  const today = attention.filter((a) => !later(a));
  const dueLabs = today.filter((a) => a.action?.type === "add-labs");
  const dueLabCodes = [...new Set(dueLabs.flatMap((a) => a.action.codes ?? []))];
  const dueCodes = [...new Set([...dueLabs.flatMap((a) => a.action.codes ?? []), ...shown.flatMap((p) => p.need.map((n) => n.code))])];
  const urgent = today.filter((a) => a.severity === "red").length;
  const decisions = today.filter((a) => a.action?.type !== "add-labs").length;
  const onCards = s.attention.length - attention.length;
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
          {decisions > 0 && <span className="tb-count">{decisions} to decide</span>}
          {dueLabCodes.length > 0 && <span className="tb-count">{dueLabCodes.length} test{dueLabCodes.length === 1 ? "" : "s"} to arrange</span>}
          {onCards > 0 && <a className="tb-count" href="#eph">{onCards} complication task{onCards === 1 ? "" : "s"}</a>}
          {deferred.length > 0 && <a className="tb-count muted" href="#clinic-later">{deferred.length} for discharge / clinic</a>}
          {dueCodes.length > 0 && (
            <button className="btn primary small tb-labs" onClick={() => open({ kind: "labs", codes: dueCodes })}>
              <FlaskConical size={15} /> Enter results · {dueCodes.map(labelOf).filter((v, i, all) => all.indexOf(v) === i).slice(0, 5).join(", ")}{dueCodes.length > 5 ? "…" : ""}
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
        {shown.map((p) => <ProblemCard key={p.key} p={p} items={items(p.key)} later={laterOf(p.key)} row={row} />)}
      </div>
      {admitted && (clinic.length > 0 || deferred.length > 0) && (
        <details className="clinic-later" id="clinic-later">
          <summary>
            <b>Before discharge or at clinic</b>
            <span>{deferred.length} item{deferred.length === 1 ? "" : "s"}{clinic.length ? ` · ${clinic.map((p) => p.label.split(" · ")[0]).join(", ")}` : ""}</span>
            <ChevronDown size={16} />
          </summary>
          <p className="small muted">Screening and long-term optimisation, kept out of the admission view. Nothing here is dropped: it stays on the record and returns at discharge and clinic.</p>
          <div className="problems">
            {clinic.map((p) => <ProblemCard key={p.key} p={p} items={laterOf(p.key)} row={row} />)}
          </div>
        </details>
      )}
      <Dismissed s={s} done={done} />
    </section>
  );
}

function ProblemCard({ p, items, later = [], row }: { p: Problem; items: any[]; later?: any[]; row: RowProps }) {
  const [more, setMore] = useState(false);
  const [moreLater, setMoreLater] = useState(false);
  const top = items[0];
  // low-priority suggestions fold under "to consider" so the card leads with what matters
  const main = items.filter((a) => a.severity !== "blue" || a.rule_id === "htn.rdn");
  const consider = items.filter((a) => a.severity === "blue" && a.rule_id !== "htn.rdn");
  return (
    <section className={`problem ${top ? `p-${top.severity}` : p.assessment === "above" ? "p-orange" : p.need.length || p.assessment === "incomplete" ? "p-need" : p.assessment === "met" ? "ok" : ""}`} aria-label={p.label}>
      <div className="problem-head">
        <b>{p.label}</b>
        {p.sub && <span className="problem-sub">{p.sub}</span>}
        {!top && !p.need.length && !later.length && p.assessment === "met" && !(row.resultsOf?.(p.key).length) && <span className="problem-ok"><CheckCircle2 size={15} /> On track</span>}
        {!top && p.assessment === "above" && <span className="problem-sub">{p.key === "bp" && row.s.pregnancy?.phase === "Pregnant" ? "Above pregnancy target" : "Above target"}</span>}
        {!top && p.assessment === "incomplete" && <span className="problem-sub">Incomplete reading</span>}
      </div>
      {p.history && p.history.length > 0 && <ol className="problem-history" aria-label="History">{p.history.map((h, i) => <li key={i}>{h}</li>)}</ol>}
      {p.stats.length > 0 && (
        <div className="problem-stats">
          {p.stats.map((x, i) => <span key={i} className={`pstat ${x.tone ?? ""}`}><small>{x.label}</small>{x.value}</span>)}
        </div>
      )}
      {(p.goal || p.therapy) && <div className="problem-goal">{[p.goal, p.therapy].filter(Boolean).join(" · ")}</div>}
      {row.resultsOf && <ResultRows items={row.resultsOf(p.key)} />}
      {row.normalOf && row.normalOf(p.key).length > 0 && <div className="problem-normal">Normal: {row.normalOf(p.key).join(", ")}</div>}
      {p.need.length > 0 && (
        <div className="problem-need">
          <span>Needed for the decision: <b>{[...new Set(p.need.map((n) => n.label))].join(", ")}</b></span>
          <button className="btn ghost small" aria-label={`Record ${p.label}: ${[...new Set(p.need.map((n) => n.label))].join(", ")}`} onClick={() => row.open({ kind: "labs", codes: [...new Set(p.need.map((n) => n.code))] })}>Record</button>
        </div>
      )}
      {p.key === "hf" && <HeldMedicines s={row.s} />}
      {main.length > 0 && <div className="problem-items">{main.map((a) => <Item key={a.id} a={a} {...row} />)}</div>}
      {later.length > 0 && items.length > 0 && (
        <div className="problem-consider">
          <button type="button" className="btn ghost small" aria-expanded={moreLater} onClick={() => setMoreLater(!moreLater)}>{moreLater ? "Hide" : `${later.length} for discharge / clinic`} <ChevronDown size={14} style={{ transform: moreLater ? "rotate(180deg)" : undefined }} /></button>
          {moreLater && <div className="problem-items">{later.map((a) => <Item key={a.id} a={a} compact {...row} />)}</div>}
        </div>
      )}
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
  const pregnant = s.pregnancy?.phase === "Pregnant";
  const hb = R.haemoglobin;
  const hbCutoff = pregnant && hb?.at ? pregnancyHaemoglobinCutoff(s.pregnancy?.edd ?? undefined, String(hb.at).slice(0, 10)) : null;
  const lowHb = hb?.value != null && (pregnant ? hbCutoff != null && hb.value < hbCutoff : hb.value < (s.header?.sex === "Female" ? 12 : 13));
  const out: Problem[] = [];
  if (t.hf) {
    const on = t.hf.pillars.filter((x: any) => x.state === "on" || x.state === "target").length;
    out.push({
      key: "hf", label: `${TITLES.hf} · ${t.hf.improved ? "improved EF" : t.hf.phenotype}`,
      sub: s.hf?.admissions?.last12m ? `${s.hf.admissions.last12m} HF admission${s.hf.admissions.last12m === 1 ? "" : "s"} in 12 months` : undefined,
      // the pillars are listed once, in the HF medicines table of the card
      stats: [],
      goal: `${on} of ${t.hf.pillars.length} foundational medicines on · goal: all at target or maximum tolerated dose`,
      therapy: line(["loop", "thiazide"]) ? `Diuretic: ${line(["loop", "thiazide"])}` : undefined,
      need: need(["sbp", "hr", "weight"], 60),
    });
  }
  const k = t.kidney;
  // kidney and anaemia: the values are the card's result rows; the card adds therapy and what is missing
  if (k && (k.egfr != null || k.creatinineCurrent != null || k.k != null || has("ckd")))
    out.push({ key: "kidney", label: TITLES.kidney, stats: [], therapy: line(["raas", "mra", "sglt2", "k-binder"]) || undefined, need: has("ckd") || t.hf ? need(["creatinine", "potassium"], 90) : [] });
  if (has("anaemia") || lowHb || (s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === "anaemia"))
    out.push({ key: "anaemia", label: TITLES.anaemia, stats: [], therapy: line(["oac", "antiplatelet"]) ? `Antithrombotic: ${line(["oac", "antiplatelet"])}` : undefined, need: lowHb || has("anaemia") ? need(["ferritin", "tsat"], 365) : [] });
  if (t.af) {
    const hr = R.hr?.value;
    out.push({
      key: "af", label: TITLES.af, sub: undefined,
      stats: [
        { label: t.af.assessmentLabel?"Stroke prevention":"CHA₂DS₂-VA", value: t.af.assessmentLabel??String(t.af.score) },
        { label: "Anticoagulant", value: t.af.oac.length ? t.af.oac.join(" · ") : "None", tone: t.af.assessmentLabel?undefined:t.af.oac.length ? "ok" : t.af.score >= 2 ? "bad" : undefined },
        { label: "Heart rate", value: val("hr"), tone: hr == null ? undefined : hr >= 110 ? "warn" : "ok" },
      ],
      therapy: line(["bb", "bb-other", "ndhp-ccb", "digoxin", "rate-slowing"]) ? `Rate control: ${line(["bb", "bb-other", "ndhp-ccb", "digoxin"])}` : undefined,
      need: need(["hr"], 60).concat(t.af.oac.length ? need(["weight", "creatinine"], 365) : []),
    });
  }
  if (has("cad", "ascvd") || (s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === "cad"))
    out.push({ key: "cad", label: TITLES.cad, sub: s.header?.ihd?.label?.replace(/^IHD · /, ""), history: (s.header?.ihd?.events ?? []).map((e: any) => e.text), stats: [{ label: "Antithrombotic", value: line(["antiplatelet", "oac"]) || "None" }, ...(line(["nitrate", "nitrate-sl", "ranolazine", "ivabradine"]) ? [{ label: "Anti-anginal", value: line(["nitrate", "ranolazine", "ivabradine"]) }] : [])], need: [] });
  if (t.ldl) out.push({ key: "lipids", label: TITLES.lipids, stats: t.ldl.value == null ? [{ label: "LDL-C", value: "Not measured" }] : [], goal: `Goal <${t.ldl.goal} mmol/L · ${t.ldl.category} risk`, therapy: t.ldl.therapy.length ? t.ldl.therapy.join(" + ") : "No lipid-lowering therapy", need: need(["ldl-c"], 365), assessment: t.ldl.met === true ? "met" : t.ldl.met === false ? "above" : "review" });
  if (t.bp) out.push({ key: "bp", label: TITLES.bp, stats: [{ label: "Latest", value: t.bp.sbp != null ? `${n(t.bp.sbp)}${t.bp.dbp != null ? "/" + n(t.bp.dbp) : ""} mmHg${t.bp.at ? ` · ${fmtDay(t.bp.at)}` : ""}` : t.bp.dbp != null ? `DBP ${n(t.bp.dbp)} mmHg` : "Not measured", tone: t.bp.met === true ? "ok" : t.bp.met === false ? "warn" : undefined }], goal: t.bp.label ?? (t.bp.target === "Individualized" ? "Individualized target" : `Goal ${t.bp.target}/${t.bp.diastolicTarget} if tolerated (ESC 2024)`), need: t.bp.sbp == null || t.bp.dbp == null || !recent("sbp", 90) || !recent("dbp", 90) ? [{code:"sbp",label:"BP"},{code:"dbp",label:"BP"}] : [], assessment: t.bp.met === true ? "met" : t.bp.met === false ? "above" : t.bp.sbp == null || t.bp.dbp == null ? "incomplete" : "review" });
  if (t.diabetes) out.push({ key: "diabetes", label: TITLES.diabetes, stats: t.diabetes.hba1c == null ? [{ label: "HbA1c", value: "Not measured" }] : [], goal: `Target ${t.diabetes.target}`, therapy: t.diabetes.therapy.length ? t.diabetes.therapy.join(" · ") : "No glucose-lowering therapy", need: need(["hba1c"], 180), assessment: t.diabetes.met === true ? "met" : t.diabetes.met === false ? "above" : "review" });
  for (const key of ["valve", "cmp", "ph"]) if ((s.attention as any[]).some((a) => PROBLEM_OF(a.rule_id) === key)) out.push({ key, label: TITLES[key], stats: [], need: [] });
  out.push({ key: "other", label: TITLES.other, stats: [], need: [] });
  return out;
}

type RowProps = { resultsOf?(key: string): any[]; normalOf?(key: string): string[]; selected:string|null; setSelected(id:string|null):void; panels?: Set<string>; dismiss: string | null; setDismiss(id: string | null): void; why: string | null; setWhy(id: string | null): void; open(o: Open): void; done(message?: string): void; patientId: string; s: any; line: string | null; setLine(id: string | null): void };


// an alert that opens a pathway shows the pathway's decision on the card (the after-PCI plan opens its own
// sheet; a joined pathway is recorded in the pathway)
const decides = (a: any) => a.action?.type === "wizard" && a.severity !== "blue" && !(a.action.wizard === "antithrombotic" && a.rule_id === "cad.antithrombotic-plan" && /PCI/.test(a.title));
function Item({ a, compact, ...p }: { a: any; compact?: boolean } & RowProps) {
  // a medicine start or dose change opens inline as an editable line (drug, dose, dates)
  const inline = (a.action?.type === "start-med" && MEDICATION[a.action.code]) || a.action?.type === "titrate";
  return (
    <div data-recommendation-id={a.id} tabIndex={-1} className={`item${compact ? " compact" : ""}`}>
      <div className="item-main">
        <span className={`tick sev-${a.severity}`} aria-hidden="true" />
        {/* one line per alert (19 Oct 2026): the title opens the reasons (with "Not now / Not appropriate"); the action sits on the right */}
        <div className="item-txt">
          <button type="button" className="t t-btn" aria-expanded={p.why === a.id} title="Why? — reasons and source" onClick={() => p.setWhy(p.why === a.id ? null : a.id)}>
            {a.title}
            {a.rule_status !== "PUBLISHED" && <em className="review">in review</em>}
            <Info size={13} className="t-why" aria-label="Why?" />
          </button>
          {!compact && p.why === a.id && a.detail && <span className="d">{a.detail}</span>}
          {/* linked decisions: what elsewhere in the record bears on this one (20 Oct 2026) */}
          {a.links?.length > 0 && <ul className="item-links" aria-label="Linked facts">{a.links.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>}
        </div>
        <div className="item-acts">
          <button className="dismiss wide-only" aria-expanded={p.dismiss === a.id} aria-label={`Not needed: ${a.title}`} title="Not needed — dismiss" onClick={() => p.setDismiss(p.dismiss === a.id ? null : a.id)}><X size={16} /></button>
          {inline ? (
            <button className="go" aria-expanded={p.line === a.id} onClick={() => p.setLine(p.line === a.id ? null : a.id)}>{a.action.label}</button>
          ) : !(a.action?.wizard === "pregnancy-plan" && p.panels?.has(a.id) && !compact) && (
            <ActionButton a={a} open={p.open} />
          )}
        </div>
      </div>
      {p.why === a.id && <WhyPanel a={a} patientId={p.patientId} done={p.done} />}
      {p.dismiss === a.id && <DismissPanel a={a} patientId={p.patientId} done={p.done} onCancel={() => p.setDismiss(null)} />}
      {inline && p.line === a.id && <SuggestLine a={a} s={p.s} open={p.open} done={p.done} onCancel={() => p.setLine(null)} />}
      {a.children?.length > 0 && <div className="item-children">{a.children.map((c: any) => <Item key={c.id} a={c} compact {...p} />)}</div>}
      {!compact && decides(a) && p.panels?.has(a.id) && <div className="decision-entry"><button className="btn secondary small" aria-expanded={p.selected===a.id} onClick={()=>p.setSelected(p.selected===a.id?null:a.id)}>{p.selected===a.id?"Close decision":a.action?.wizard === "pregnancy-plan" ? "Review pregnancy care":"Review plan"}</button>{p.selected===a.id&&<DecisionPanel key={a.id} a={a} patientId={p.patientId} open={p.open} done={p.done}/>}</div>}
    </div>
  );
}


function Brief({ o }: { o: any }) {
  if (!o) return null;
  const parts: [string, string][] = [
    ["Why here", o.why.text + (o.why.sub ? ` · ${o.why.sub}` : "")],
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
