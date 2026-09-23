import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, useData } from "../api";
import { Tag, useSession, useToast, type Sev } from "../ui";
import { fmtDay } from "../../shared/clinical";

const STATUS_SEV: Record<string, Sev> = { DRAFT: "gray", CLINICAL_REVIEW: "yellow", APPROVED: "blue", PUBLISHED: "green", RETIRED: "gray" };
const NEXT: Record<string, { to: string; label: string; roles: string[] }[]> = {
  DRAFT: [{ to: "CLINICAL_REVIEW", label: "Send for clinical review", roles: ["admin", "reviewer"] }],
  CLINICAL_REVIEW: [{ to: "APPROVED", label: "Approve", roles: ["reviewer"] }, { to: "DRAFT", label: "Return to draft", roles: ["reviewer", "admin"] }],
  APPROVED: [{ to: "PUBLISHED", label: "Publish", roles: ["admin"] }, { to: "DRAFT", label: "Return to draft", roles: ["admin", "reviewer"] }],
  PUBLISHED: [{ to: "RETIRED", label: "Retire", roles: ["admin"] }],
  RETIRED: [],
};

export function Governance() {
  const { data, reload } = useData<any[]>("/rules");
  const session = useSession();
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<Record<string, Record<string, string>>>({});
  const key = (r: any) => `${r.rule_id}@${r.version}`;
  async function move(r: any, to: string) {
    try {
      await api(`/rules/${r.rule_id}/${r.version}/transition`, { body: { to, note: notes[key(r)] ?? "" } });
      toast({ text: `${r.title} v${r.version} → ${to.replace("_", " ").toLowerCase()}` });
      reload();
    } catch (e) {
      toast({ text: (e as Error).message, err: true });
    }
  }
  async function draft(r: any) {
    try {
      const params = Object.fromEntries(Object.entries(edit[key(r)] ?? {}).map(([k, v]) => [k, Number.isFinite(Number(v)) ? Number(v) : v]));
      const res = await api(`/rules/${r.rule_id}/draft`, { body: { params, evidence: r.evidence } });
      toast({ text: `Draft v${res.version} created` });
      setEdit({ ...edit, [key(r)]: {} });
      reload();
    } catch (e) {
      toast({ text: (e as Error).message, err: true });
    }
  }
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Rule governance</h1>
          <p>Only published rules affect patients on a production site. Authors cannot approve their own rules; reviewers cannot publish.</p>
        </div>
        <span className="chip gray">You: {session.role}</span>
      </div>
      {(data ?? []).map((r) => (
        <section key={key(r)} className="card pad">
          <div className="card-head">
            <div className="row">
              <ShieldCheck size={20} color="var(--navy)" />
              <h2>{r.title}</h2>
              <span className="muted small" style={{ fontWeight: 700 }}>{r.rule_id} · v{r.version}</span>
            </div>
            <div className="row">
              <Tag sev={r.kind === "clinical" ? "blue" : "gray"}>{r.kind}</Tag>
              <Tag sev={STATUS_SEV[r.status]}>{r.status.replace("_", " ")}</Tag>
            </div>
          </div>
          <p style={{ margin: "0 0 12px", fontWeight: 500, color: "var(--ink-3)" }}>{r.evidence}</p>
          <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
            <span className="eyebrow">Reads</span>
            {r.inputs.map((i: string) => <span key={i} className="chip outline">{i}</span>)}
          </div>
          {Object.keys(r.params).length > 0 && (
            <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
              {Object.entries(r.params).map(([k, v]) => (
                <label key={k} className="field">
                  <span>{k.replace(/_/g, " ")}</span>
                  <input
                    className="input"
                    style={{ width: 140 }}
                    disabled={r.status === "RETIRED" || !["admin", "reviewer"].includes(session.role)}
                    value={edit[key(r)]?.[k] ?? String(v)}
                    onChange={(e) => setEdit({ ...edit, [key(r)]: { ...(edit[key(r)] ?? {}), [k]: e.target.value } })}
                  />
                </label>
              ))}
              {Object.keys(edit[key(r)] ?? {}).length > 0 && <button className="btn secondary" style={{ alignSelf: "flex-end" }} onClick={() => draft(r)}>Save as new draft version</button>}
            </div>
          )}
          {NEXT[r.status].length > 0 && (
            <div className="row wrap">
              <input className="input grow" placeholder={r.status === "CLINICAL_REVIEW" ? "Review note: source checked, boundaries tested, decision (required to approve)" : "Note (optional)"} value={notes[key(r)] ?? ""} onChange={(e) => setNotes({ ...notes, [key(r)]: e.target.value })} aria-label="Governance note" />
              {NEXT[r.status].map((n) => (
                <button key={n.to} className={`btn ${n.to === "APPROVED" || n.to === "PUBLISHED" ? "primary" : "secondary"}`} disabled={!n.roles.includes(session.role)} title={n.roles.includes(session.role) ? undefined : `Requires ${n.roles.join(" or ")}`} onClick={() => move(r, n.to)}>
                  {n.label}
                </button>
              ))}
            </div>
          )}
          {r.history.length > 0 && (
            <div className="small muted" style={{ marginTop: 10, fontWeight: 600 }}>
              {r.history.map((h: any) => `${fmtDay(h.at, { year: true })}: ${h.from_status ?? "created"} → ${h.to_status} by ${h.actor}${h.note ? ` (“${h.note}”)` : ""}`).join(" · ")}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
