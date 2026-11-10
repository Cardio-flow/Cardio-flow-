// An alert's single action button and its "Why?" panel, shared by the overview, the medication review and the
// visit drawers. Moved out of Summary.tsx on 10 Nov 2026 (unchanged) so no screen imports the overview to get them.
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Link, Tag } from "../ui";
import { api } from "../api";
import { fmtDay } from "../../shared/clinical";
import { BARRIER_CATEGORIES } from "../../shared/catalog";
import type { Open } from "./Patient";

export function ActionButton({ a, open }: { a: any; open(o: Open): void }) {
  const act = a.action ?? {};
  if(act.type === "pregnancy-context")return <button className="go" onClick={()=>open({kind:"pregnancy-context"})}>{act.label}</button>;
  // after a PCI, the stop dates are set on the next-steps sheet (timeline) rather than in the pathway
  if (act.type === "wizard" && act.wizard === "antithrombotic" && a.rule_id === "cad.antithrombotic-plan" && /PCI/.test(a.title))
    return (
      <button className="go" onClick={() => open({ kind: "after-pci" })}>
        Plan after PCI
      </button>
    );
  if (act.type === "wizard")
    return (
      <button className="go" onClick={() => open({ kind: "wizard", wizard: act.wizard, recommendationId: act.standalone ? undefined : a.id })}>
        {({ "pregnancy-plan":"Review pregnancy care", "vitamin-d-result":"Review vitamin D", "anaemia-result":"Review anaemia", "iv-iron":"Plan IV iron", "liver-result":"Review liver tests", "statin-ck-result":"Review statin CK", hyperkalaemia: "Manage hyperkalaemia", "renal-function": "Review renal function", congestion: "Manage congestion", hypotension: "Manage low BP", bradycardia: "Manage bradycardia",
          shock: "Manage shock", sepsis: "Sepsis pathway", hyperglycaemia: "Manage glucose crisis", hypoglycaemia: "Manage hypoglycaemia", bleeding: "Manage bleeding",
          "low-potassium": "Manage low K / Mg", hyponatraemia: "Manage low sodium", inr: "Manage INR", digoxin: "Manage digoxin", "severe-hypertension": "Manage severe BP",
          "htn-review": "Review hypertension", "htn-resistance": "Verify resistance", "htn-secondary": "Screen secondary causes", "rdn-plan": "Assess RDN", "after-rdn": "Review RDN recovery",
          diabetes: "Diabetes plan", "sick-day": "Sick-day rules", ramadan: "Ramadan plan",
          syncope: "Assess syncope", "chest-infection": "Chest infection pathway", pericarditis: "Pericardial plan", endocarditis: "Endocarditis pathway", "pre-procedure": "Pre-op assessment", "amiodarone-thyroid": "Thyroid pathway", antithrombotic: "Plan antithrombotics", "acs-discharge": "Open bundle", "chest-pain-cad": "Chest pain pathway", "af-care": "AF-CARE plan", "peri-af-procedure": "Plan anticoagulation", "icd-shock": "ICD shock pathway", "valve-heart-team": "Heart Team decision", "valve-antithrombotic": "Plan antithrombotics", "prosthetic-valve": "Prosthetic valve pathway", "hcm-scd": "Assess SCD risk", "hcm-lvoto": "LVOT obstruction plan", "cmp-family": "Plan family screening", myocarditis: "Myocarditis pathway", "pah-followup": "Assess PAH risk", "post-pe": "After-PE pathway", "ph-lhd-lung": "PH pathway", "ph-suspected": "Suspected PH pathway", "after-cabg": "After-CABG plan", "after-device": "After-implant plan", "ccs-test-result": "Decide from the test", "suspected-ihd": "Choose the first test" } as Record<string, string>)[act.wizard] ?? "Review"}
      </button>
    );
  if (act.type === "plan")
    return (
      <button className="go" onClick={() => open({ kind: "plan-item", planId: act.planId })}>
        Open
      </button>
    );
  if (act.type === "add-plan")
    return (
      <button className="go" onClick={() => open({ kind: "plan-add", template: act.template, medicationId: act.medicationId })}>
        {act.template === "renal-k" ? "Book renal/K check" : act.template === "ecg" ? "Book ECG" : act.template === "device" ? "Plan device review" : act.template === "dm-eyes" ? "Book retinal screening" : act.template === "dm-feet" ? "Plan foot examination" : act.template === "device-check" || act.template === "device-first-check" ? "Book device check" : act.template === "wound-check" ? "Book wound check" : act.template === "valve-echo" ? "Book echo" : act.template === "remote-monitoring" ? "Plan remote monitoring" : act.template === "generator-change" ? "Plan generator change" : act.template === "lead-review" ? "Refer for lead review" : act.template?.startsWith("mon-") || act.template === "lipids" ? "Book check" : act.template === "echo" ? "Book echo" : "Add to plan"}
      </button>
    );
  if (act.type === "tab")
    return (
      <Link className="go" to={`${location.pathname.replace(/\/(history|journey|visits|medications|investigations|plan|registries)$/, "")}/${act.tab}`}>
        {act.tab === "medications" ? "Review medications" : act.tab === "journey" ? "Open journey" : "Review plan"}
      </Link>
    );
  if (act.type === "start-med")
    return (
      <button className="go" onClick={() => open({ kind: "med-add", code: act.code, dose: act.dose, reason: a.title })}>
        {act.label}
      </button>
    );
  if (act.type === "titrate")
    return (
      <button className="go" onClick={() => open({ kind: "med-action", medId: act.medicationId, action: act.direction, dose: act.dose, reason: act.direction === "increase" ? "Titration toward target" : undefined })}>
        {act.label}
      </button>
    );
  if (act.type === "med-correct") return <button className="go" onClick={()=>open({kind:"med-dose",medId:act.medicationId})}>{act.label}</button>;
  if (act.type === "med-action")
    return (
      <button className="go" onClick={() => open({ kind: "med-action", medId: act.medicationId, action: act.action, reason: act.action === "resume" ? undefined : a.title })}>
        {act.label}
      </button>
    );
  if (act.type === "edit-dx")
    return (
      <button className="go" onClick={() => open({ kind: "dx-edit", code: act.code })}>
        {act.label ?? "Edit diagnosis"}
      </button>
    );
  if (act.type === "history")
    return (
      <button className="go" onClick={() => open({ kind: "history", focus: act.focus })}>
        {act.label}
      </button>
    );
  if (act.type === "add-labs")
    return (
      <button className="go" onClick={() => open({ kind: "labs", codes: act.codes })}>
        {act.label}
      </button>
    );
  return null;
}

export function WhyPanel({ a, patientId, done }: { a: any; patientId?: string; done?(message?: string): void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("");
  const isDrug = a.action?.type === "start-med" || (a.action?.type === "titrate" && a.action.direction === "increase");
  const close = async (outcome: "deferred" | "declined", category?: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/recommendations/${a.id}/decline`, { body: { outcome, reason, also: (a.also ?? []).map((x: any) => x.id), ...(category ? { category } : {}) } });
      done?.(category ? "Reason recorded" : outcome === "deferred" ? "Suggestion deferred" : "Suggestion closed");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const sources = [a, ...(a.also ?? [])];
  return (
    <div className="why-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ color: "var(--navy)" }}>Why am I seeing this?</b>
        <span className="small muted" style={{ fontWeight: 600 }}>
          Rule {a.rule_id} · v{a.rule_version} · <Tag sev={a.rule_status === "PUBLISHED" ? "green" : "yellow"}>{a.rule_status.replace("_", " ")}</Tag>
        </span>
      </div>
      <div className="facts">
        {a.facts.filter((f: any) => f.label !== "Guideline").map((f: any, i: number) => (
          <div className="fact" key={i}>
            <small>
              {f.label}
              {f.date ? ` · ${fmtDay(f.date)}` : ""}
            </small>
            <b style={{ color: f.tone ? `var(--${f.tone}-ink, var(--${f.tone}))` : undefined }}>{f.value}</b>
          </div>
        ))}
      </div>
      {sources.flatMap((x: any) => x.facts.filter((f: any) => f.label === "Guideline").map((f: any) => f.value)).filter((v: string, i: number, all: string[]) => all.indexOf(v) === i).map((v: string, i: number) => (
        <div className="guideline-src" key={"g" + i}>
          <BookOpen size={14} /> {v}
        </div>
      ))}
      {sources.filter((x: any) => x.ruleEvidence).map((x: any) => <details className="small muted" key={x.id}><summary>Evidence for {x.rule_id} · v{x.rule_version}</summary><p>{x.ruleEvidence}</p></details>)}
      {a.also?.length > 0 && (
        <div className="small" style={{ fontWeight: 600, color: "var(--ink-3)" }}>
          Merged with {a.also.length} other suggestion{a.also.length === 1 ? "" : "s"} for the same drug class: {a.also.map((x: any) => x.title).join(" · ")}
        </div>
      )}
      {a.missing.length > 0 && (
        <div className="small" style={{ fontWeight: 700, color: "var(--orange-ink)" }}>
          Assessment incomplete: {a.missing.join(", ")} not available. Missing data is never assumed normal.
        </div>
      )}
      {patientId && isDrug && (
        <div className="notnow">
          <span className="small" style={{ fontWeight: 700, color: "var(--ink-3)", flexBasis: "100%" }}>Not giving it? Record why once: this drug class stops being suggested.</span>
          <div className="choices" role="radiogroup" aria-label="Reason the medicine is not given" style={{ flexBasis: "100%" }}>
            {BARRIER_CATEGORIES.map((c) => (
              <button key={c.value} type="button" className="choice small" role="radio" aria-checked={cat === c.value} aria-pressed={cat === c.value} onClick={() => setCat(c.value)}>{c.label}</button>
            ))}
          </div>
          <input className="input" placeholder={cat === "other" ? "Note (required)" : "Note (optional), e.g. genital infection, angioedema"} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Note" />
          <button className="btn ghost small" disabled={busy || !cat || (cat === "other" && reason.trim().length < 3)} onClick={() => close("declined", cat)}>Record reason</button>
          {error && <span className="small" style={{ color: "var(--red-ink)", fontWeight: 700 }}>{error}</span>}
        </div>
      )}
      {patientId && a.action?.type !== "wizard" && !isDrug && (
        <div className="notnow">
          <input className="input" placeholder="Reason (e.g. patient preference, not available, already tried)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for not acting now" />
          <button className="btn ghost small" disabled={busy || reason.trim().length < 3} onClick={() => close("deferred")}>Not now</button>
          <button className="btn ghost small" disabled={busy || reason.trim().length < 3} onClick={() => close("declined")}>Not appropriate</button>
          {error && <span className="small" style={{ color: "var(--red-ink)", fontWeight: 700 }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
