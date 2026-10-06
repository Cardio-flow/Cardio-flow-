// After PCI: the next-steps sheet (workflow redesign, slice 3). Opens straight after a PCI is saved, and
// from the "antithrombotic stop dates not set" card. The plan is drawn as a drug timeline; every end date
// can be moved; secondary-prevention steps are pre-ticked when the guideline asks for them.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, HeartPulse } from "lucide-react";
import { api, useData } from "../api";
import { Drawer } from "../ui";
import { fmtDay, addDays } from "../../shared/clinical";
import { DAPT_OPTIONS, DUAL_OPTIONS, P2Y12, TAT_OPTIONS, defaultChoice, extras as extrasFor, highIschaemic, phases, type Choice, type PciContext } from "../../shared/after-pci";

type Hit = { severity: "red" | "orange" | "yellow"; title: string; detail: string; source: string };

export function AfterPci({ patientId, contextId, onClose, onDone, onBundle }: { patientId: string; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void; onBundle?(): void }) {
  const { data } = useData<{ context: PciContext | null }>(`/patients/${patientId}/after-pci`);
  const c = data?.context;
  if (data && !c) return (
    <Drawer title="After PCI" icon={<HeartPulse size={22} />} onClose={onClose}>
      <div className="drawer-body"><div className="empty">No PCI on record.</div></div>
    </Drawer>
  );
  if (!c) return <Drawer title="After PCI" icon={<HeartPulse size={22} />} onClose={onClose}><div className="drawer-body" aria-busy="true" /></Drawer>;
  return <Sheet c={c} patientId={patientId} contextId={contextId} onClose={onClose} onDone={onDone} onBundle={onBundle} />;
}

function Chips<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; hint?: string; disabled?: boolean }[]; onChange(v: T): void }) {
  return (
    <div className="ap-choice" role="radiogroup" aria-label={label}>
      <small>{label}</small>
      <div className="ap-chips">
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} className="ap-chip" onClick={() => onChange(o.value)} title={o.hint}>
            <b>{o.label}</b>
            {o.hint && <span>{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Sheet({ c, patientId, contextId, onClose, onDone, onBundle }: { c: PciContext; patientId: string; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void; onBundle?(): void }) {
  const [ch, setCh] = useState<Choice>(() => defaultChoice(c));
  const [ends, setEnds] = useState<Record<string, string>>({});
  const set = <K extends keyof Choice>(k: K, v: Choice[K]) => { setCh((x) => ({ ...x, [k]: v })); setEnds({}); };
  const ph = phases(c, ch, ends);
  const ex = useMemo(() => extrasFor(c, ch), [c]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ex.filter((e) => e.on).map((e) => e.id)));
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // medicines this plan starts: their pre-start check
  const starts = [...(!c.aspirin ? ["aspirin"] : []), ...(c.p2y12?.code !== ch.p2y12 ? [ch.p2y12] : [])];
  const [hits, setHits] = useState<Record<string, Hit[]>>({});
  useEffect(() => {
    let live = true;
    Promise.all(starts.map((code) => api<{ hits: Hit[] }>(`/patients/${patientId}/medication-check/${code}`).then((r) => [code, r.hits] as const)))
      .then((all) => live && setHits(Object.fromEntries(all)))
      .catch(() => {});
    return () => { live = false; };
  }, [starts.join(",")]);
  const reds = starts.filter((code) => hits[code]?.some((h) => h.severity === "red"));
  const ready = reds.every((code) => (overrides[code] ?? "").trim().length >= 3);
  const acs = c.pci.acs;

  async function save(thenBundle = false) {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${patientId}/after-pci`, {
        body: {
          regimen: ch.regimen, p2y12: ch.p2y12, aspirinDose: ch.aspirinDose,
          stops: ph.filter((p) => p.stop && p.to).map((p) => ({ target: p.stop!.target, title: p.stop!.title, dueDate: p.to! })),
          extras: [...picked], overrides: Object.fromEntries(reds.map((k) => [k, overrides[k] ?? ""])), contextId: contextId ?? null,
        },
      });
      onDone(`Plan after PCI saved · ${ph.filter((p) => p.stop && p.to).map((p) => `${p.label.toLowerCase()} ends ${fmtDay(p.to!)}`).join(" · ")}`, r);
      if (thenBundle) onBundle?.();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const p2opts = (["ticagrelor", "prasugrel", "clopidogrel"] as const).map((k) => ({
    value: k, label: `${P2Y12[k].name} ${P2Y12[k].dose(c)} mg ${P2Y12[k].frequency === "BID" ? "twice daily" : "daily"}`,
    hint: ch.regimen === "oac" && k !== "clopidogrel" ? "Not with an anticoagulant" : P2Y12[k].note(c) ?? (k === "clopidogrel" ? (acs ? "When ticagrelor/prasugrel are not suitable" : "Elective PCI default") : acs ? "ACS · I B" : undefined),
    disabled: (ch.regimen === "oac" && k !== "clopidogrel") || (k === "prasugrel" && c.priorStroke),
  }));

  return (
    <Drawer
      wide
      title="After PCI: next steps"
      subtitle={`${fmtDay(c.pci.at, { weekday: true })} · ${c.pci.summary}`}
      icon={<HeartPulse size={22} />}
      onClose={onClose}
      footer={
        <>
          <span className="note">{reds.length && !ready ? "A contraindication needs a reason" : `${ph.filter((p) => p.stop).length} dated stop${ph.filter((p) => p.stop).length === 1 ? "" : "s"} · ${picked.size} other step${picked.size === 1 ? "" : "s"}`}</span>
          <span className="end">
            <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Later</button>
            {acs && onBundle && <button className="btn secondary" disabled={busy || !ready} onClick={() => save(true)}>Save, then ACS bundle</button>}
            <button className="btn primary" disabled={busy || !ready} onClick={() => save()}>{busy ? "Saving…" : "Save plan"}</button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        <div className="ap-facts">
          <span className={`ap-fact${acs ? " hot" : ""}`}><small>Setting</small><b>{acs ? "Acute coronary syndrome" : "Elective (chronic coronary syndrome)"}</b></span>
          <span className="ap-fact"><small>Anticoagulant</small><b>{c.oac?.name ?? "None"}</b></span>
          <span className={`ap-fact${c.hbr.hbr ? " warn" : ""}`} title={[...c.hbr.major.map((x) => "Major: " + x), ...c.hbr.minor.map((x) => "Minor: " + x)].join("\n")}>
            <small>Bleeding risk (ARC-HBR)</small><b>{c.hbr.hbr ? "High" : "Not high"}</b>
            {(c.hbr.major.length > 0 || c.hbr.minor.length > 0) && <em>{[...c.hbr.major, ...c.hbr.minor].join(" · ")}</em>}
          </span>
          <span className={`ap-fact${highIschaemic(c) ? " warn" : ""}`}><small>Ischaemic risk</small><b>{highIschaemic(c) ? "High" : "Not flagged"}</b>{(c.pci.complex || c.pci.complications.length > 0) && <em>{[c.pci.complex ? "complex PCI" : null, ...c.pci.complications].filter(Boolean).join(" · ")}</em>}</span>
        </div>
        {c.pci.complications.length > 0 && (
          <div className="ap-comp"><AlertTriangle size={16} /> Complications recorded: {c.pci.complications.join(", ").toLowerCase()}. Weigh them in the durations below.</div>
        )}

        <section className="ap-sec">
          <h3>Antithrombotic plan</h3>
          <div className="ap-grid">
            <Chips label="P2Y12 inhibitor" value={ch.p2y12} options={p2opts} onChange={(v) => set("p2y12", v)} />
            {!c.aspirin && <Chips label="Aspirin" value={ch.aspirinDose} options={[75, 81, 100].map((d) => ({ value: d, label: `${d} mg daily` }))} onChange={(v) => set("aspirinDose", v)} />}
            {ch.regimen === "dapt" ? (
              <>
                <Chips label="DAPT for" value={ch.dapt} options={DAPT_OPTIONS.filter((o) => o.acs === acs).map((o) => ({ value: o.value, label: o.label, hint: o.hint }))} onChange={(v) => set("dapt", v)} />
                <Chips label="Then" value={ch.sapt} options={[{ value: "aspirin", label: "Aspirin alone" }, { value: "clopidogrel", label: "Clopidogrel alone", hint: "ESC CCS 2024, I A" }]} onChange={(v) => set("sapt", v)} />
              </>
            ) : (
              <>
                <Chips label="Triple therapy" value={ch.tat} options={TAT_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))} onChange={(v) => set("tat", v)} />
                <Chips label="Anticoagulant + clopidogrel" value={ch.dual} options={DUAL_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))} onChange={(v) => set("dual", v)} />
              </>
            )}
          </div>
          <Timeline c={c} phases={ph} onEnd={(k, d) => setEnds((e) => ({ ...e, [k]: d }))} />
          {starts.map((code) => (hits[code]?.length ?? 0) > 0 && (
            <div key={code} className="sl-hits">
              {hits[code].map((h, i) => (
                <div key={i} className={`sl-hit sev-${h.severity}`}><AlertTriangle size={15} /><span><b>{h.title}</b> {h.detail} <small>{h.source}</small></span></div>
              ))}
              {reds.includes(code) && (
                <label className="sl-override"><span>Reason to start {code} despite the contraindication</span>
                  <input className="input" value={overrides[code] ?? ""} onChange={(e) => setOverrides((o) => ({ ...o, [code]: e.target.value }))} /></label>
              )}
            </div>
          ))}
          {starts.length > 0 && starts.every((code) => hits[code] && !hits[code].length) && (
            <div className="sl-safety ok"><CheckCircle2 size={15} /> Starts {starts.map((k) => (k === "aspirin" ? "aspirin" : P2Y12[k as Choice["p2y12"]].name.toLowerCase())).join(" and ")}: no contraindication or interaction found.</div>
          )}
          {c.planned.stops && <div className="sl-note">Some antithrombotic stop dates are already planned; these are added alongside them.</div>}
        </section>

        {ex.length > 0 && (
          <section className="ap-sec">
            <h3>Also after PCI</h3>
            <div className="ap-extras">
              {ex.map((e) => (
                <label key={e.id} className={`ap-extra${picked.has(e.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={picked.has(e.id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })} />
                  <span><b>{e.label}</b><em>{e.detail}</em></span>
                </label>
              ))}
            </div>
          </section>
        )}
        {acs && <div className="sl-note">After ACS, the secondary-prevention bundle (beta-blocker, RAS inhibitor, MRA, SGLT2 inhibitor, vaccination) follows: “Save, then ACS bundle”.</div>}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

// one row per medicine, from the PCI across the plan, with the end date of each phase editable
function Timeline({ c, phases: ph, onEnd }: { c: PciContext; phases: ReturnType<typeof phases>; onEnd(key: string, day: string): void }) {
  const start = c.pci.at;
  const lastEnd = ph.map((p) => p.to).filter(Boolean).sort().pop() ?? addDays(start, 365);
  const span = Math.max(400, Math.round((Date.parse(lastEnd) - Date.parse(start)) / 86400000) + 60);
  const x = (d: string) => Math.min(100, Math.max(0, ((Date.parse(d) - Date.parse(start)) / 86400000 / span) * 100));
  const todayX = x(c.today);
  const drugs = [...new Set(ph.flatMap((p) => p.drugs))];
  const rows = drugs.map((name) => {
    const inPh = ph.filter((p) => p.drugs.includes(name));
    const to = inPh.some((p) => p.to == null) ? null : inPh.map((p) => p.to!).sort().pop()!;
    return { name, from: inPh[0].from, to };
  });
  // axis ticks, leaving room for the "Today" label
  const ticks = [0, 30, 91, 182, 365].filter((d) => d <= span && !(todayX > 0 && todayX < 100 && Math.abs(x(addDays(start, d)) - todayX) < 9));
  return (
    <div className="ap-tl" aria-label="Antithrombotic timeline">
      <div className="ap-tl-rows">
        {rows.map((r, i) => (
          <div key={r.name} className="ap-tl-row">
            <span className="ap-tl-name">{r.name}</span>
            <span className="ap-tl-track">
              <span className={`ap-tl-bar c${i % 4}${r.to ? "" : " open"}`} style={{ left: `${x(r.from)}%`, width: `${(r.to ? x(r.to) : 100) - x(r.from)}%` }}>
                {r.to && <em>{fmtDay(r.to)}</em>}
              </span>
              {todayX > 0 && todayX < 100 && <b className="ap-tl-today" style={{ left: `${todayX}%` }} aria-hidden="true" />}
            </span>
          </div>
        ))}
        <div className="ap-tl-row axis">
          <span className="ap-tl-name" />
          <span className="ap-tl-track">
            {ticks.map((d) => <i key={d} style={{ left: `${x(addDays(start, d))}%` }}>{d === 0 ? "PCI" : d < 60 ? `${d} d` : `${Math.round(d / 30.4)} mo`}</i>)}
            {todayX > 0 && todayX < 100 && <i className="ap-tl-now" style={{ left: `${todayX}%` }}>Today</i>}
          </span>
        </div>
      </div>
      <div className="ap-ends">
        {ph.filter((p) => p.stop && p.to).map((p) => (
          <label key={p.key} className="ap-end">
            <span><b>{p.label} ends</b><em>{p.stop!.title}</em></span>
            <input type="date" className="sl-input" min={start} value={p.to!} onChange={(e) => e.target.value && onEnd(p.key, e.target.value)} aria-label={`${p.label} end date`} />
          </label>
        ))}
      </div>
    </div>
  );
}
