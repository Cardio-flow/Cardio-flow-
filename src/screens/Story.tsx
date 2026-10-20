// The overview as a story (20 Oct 2026 — Ahmed: "isolated islands, not a continuous story"; "I need the
// trends, creative display and smart problem solving"). Story and where things stand, one timeline with every
// key trend on the same time axis, abnormal results once with their trend, and why each HF medicine is held.
import { useMemo, useState } from "react";
import { Sparkline } from "../ui";
import { fmtDay } from "../../shared/clinical";

const TONE: Record<string, string> = { good: "st-good", bad: "st-bad", warn: "st-warn", neutral: "st-neutral" };

export function StoryCard({ s, narrow }: { s: any; narrow: boolean }) {
  const lines = (s.story ?? []) as any[];
  const standing = (s.standing ?? []) as any[];
  const chron = s.chronology as { items: { at: string; when: string; text: string; tone?: string }[]; undated: string[] } | undefined;
  if (!lines.length && !standing.length && !s.timeline && !chron?.items.length) return null;
  return (
    <section className="card pad story-card" aria-label="Story">
      <div className={`story-top${narrow ? " narrow" : ""}`}>
        <div className="story-lines">
          <h2>The story so far</h2>
          {chron && chron.items.length > 0 && <Chronology c={chron} />}
          {lines.map((l) => (
            <p key={l.key} className={l.tone ? `sl-${l.tone}` : undefined}><b>{l.label}</b> {l.text}</p>
          ))}
        </div>
        {standing.length > 0 && (
          <div className="standing" aria-label="Where things stand">
            <span className="standing-h">Where things stand</span>
            {standing.map((x) => (
              <div key={x.key} className="standing-row"><span>{x.label}</span><b className={TONE[x.tone]}>{x.value}</b></div>
            ))}
          </div>
        )}
      </div>
      {s.timeline && <Timeline t={s.timeline} narrow={narrow} />}
    </section>
  );
}

// Dated record, oldest first; the year is printed once per year (20 Oct 2026)
function Chronology({ c }: { c: { items: { at: string; when: string; text: string; tone?: string }[]; undated: string[] } }) {
  let lastYear = "";
  return (
    <ol className="chron" aria-label="Chronology">
      {c.items.map((it, i) => {
        const year = it.at ? it.at.slice(0, 4) : "";
        const showYear = year && year !== lastYear;
        if (year) lastYear = year;
        const month = it.when.replace(/\s*\d{4}$/, "");
        return (
          <li key={i} className={`${it.tone ? `ch-${it.tone}` : ""}${it.at ? "" : " ch-gap"}`}>
            <span className="ch-year">{showYear ? year : ""}</span>
            <span className="ch-month">{it.at && month !== it.when ? month : ""}</span>
            <span className="ch-text">{it.text}</span>
          </li>
        );
      })}
      {c.undated.length > 0 && (
        <li className="ch-undated"><span className="ch-year" /><span className="ch-month" /><span className="ch-text">Date not recorded: {c.undated.join(", ")}</span></li>
      )}
    </ol>
  );
}

const LANE_COLOR: Record<string, string> = { lvef: "#0b2d5b", creatinine: "#b42318", potassium: "#b42318", haemoglobin: "#b93815", "nt-probnp": "#9a3412" };

export function Timeline({ t, narrow }: { t: any; narrow: boolean }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<string | null>(null);
  const W = narrow ? 420 : 1100, L = narrow ? 70 : 120, R = narrow ? 34 : 56;
  const laneH = narrow ? 46 : 54, top = 22;
  const from = Date.parse(t.from), to = Date.parse(t.to);
  const x = (at: string) => L + ((Date.parse(at) - from) / (to - from || 1)) * (W - L - R);
  const lanes = (t.lanes as any[]).filter((l) => !hidden.has(l.code));
  const medRows = hidden.has("meds") ? [] : (t.meds as any[]);
  const H = top + lanes.length * laneH + (medRows.length ? 14 + medRows.length * (narrow ? 15 : 17) : 0) + 26;
  const ticks = useMemo(() => {
    const out: { at: string; label: string }[] = [];
    const d = new Date(t.from); d.setDate(1); d.setMonth(d.getMonth() + 1);
    const step = (to - from) / 864e5 > 400 ? (narrow ? 6 : 3) : narrow ? 3 : 1;
    while (d.getTime() < to) {
      if (d.getMonth() % step === 0) out.push({ at: d.toISOString(), label: d.toLocaleDateString("en-GB", { month: "short", year: d.getMonth() === 0 || !out.length ? "numeric" : undefined }) });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [t.from, t.to, narrow]);
  // the facts a tap shows: the latest value of each row, each admission
  const picks: { key: string; label: string; detail: string }[] = [
    ...(t.admissions as any[]).map((a) => ({ key: `adm-${a.id}`, label: `Admission ${fmtDay(a.from)}`, detail: `${fmtDay(a.from)}${a.open ? " – now" : ` – ${fmtDay(a.to, { year: true })}`} · ${a.label}${a.changed.length ? ` · ${a.changed.join(", ")}` : ""}` })),
    ...(t.lanes as any[]).map((l) => {
      const p = l.points[l.points.length - 1];
      return { key: l.code, label: `${l.label.replace(" %", "")} history`, detail: `${l.label.replace(" %", "")}: ${l.points.map((q: any) => `${q.text} (${fmtDay(q.at, { year: true })})`).join(" → ")} · latest from ${p.source}` };
    }),
  ];
  const chosen = picks.find((p) => p.key === pick);
  const toggle = (k: string) => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="timeline">
      <div className="tl-controls" role="group" aria-label="Show or hide timeline rows">
        {[...(t.lanes as any[]).map((l) => [l.code, l.label.replace(" %", "")]), ...(t.meds.length ? [["meds", "Medicines"]] : [])].map(([k, label]) => (
          <button key={k} type="button" className={`tl-chip${hidden.has(k) ? "" : " on"}`} aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}>{label}</button>
        ))}
      </div>
      <svg className="tl-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Timeline from ${fmtDay(t.from, { year: true })} to today: ${(t.lanes as any[]).map((l) => l.label).join(", ")}${t.admissions.length ? `, ${t.admissions.length} admission${t.admissions.length === 1 ? "" : "s"}` : ""}`}>
        {(t.admissions as any[]).map((a) => (
          <g key={a.id}>
            <rect x={x(a.from)} y={top - 6} width={Math.max(5, x(a.to) - x(a.from))} height={H - top - 20} fill="#fdecea" />
            <text x={x(a.from)} y={top - 9} fontSize="10.5" fontWeight="700" fill="#b42318" textAnchor="middle">{narrow ? "Adm" : "Admitted"}</text>
          </g>
        ))}
        <line x1={W - R} x2={W - R} y1={top - 6} y2={H - 20} stroke="#1565c0" strokeDasharray="3 3" />
        {lanes.map((l, i) => {
          const y0 = top + i * laneH, y1 = y0 + laneH - 12;
          const vals = l.points.flatMap((p: any) => [p.value, p.high ?? p.value]).concat(l.ref ? [l.ref.value] : []);
          let min = Math.min(...vals), max = Math.max(...vals);
          if (max - min < 1e-9) { min -= 1; max += 1; }
          const pad = (max - min) * 0.15;
          const y = (v: number) => y1 - ((v - (min - pad)) / (max - min + 2 * pad)) * (y1 - y0);
          const color = LANE_COLOR[l.code] ?? "#344054";
          const last = l.points[l.points.length - 1];
          return (
            <g key={l.code}>
              <line x1={L} x2={W - R} y1={y1 + 6} y2={y1 + 6} stroke="#eef2f6" />
              <text x={0} y={(y0 + y1) / 2 + 4} fontSize={narrow ? 10.5 : 12} fontWeight="700" fill="#344054">{narrow ? l.label.replace(" %", "").replace("Haemoglobin", "Hb").replace("Creatinine", "Creat.").replace("Potassium", "K") : l.label}</text>
              {l.ref && <><line x1={L} x2={W - R} y1={y(l.ref.value)} y2={y(l.ref.value)} stroke="#9fb3c8" strokeDasharray="4 4" />{!narrow && <text x={L + 4} y={y(l.ref.value) - 3} fontSize="9.5" fill="#667085">{l.ref.label}</text>}</>}
              {l.points.length > 1 && <polyline points={l.points.map((p: any) => `${x(p.at)},${y(p.value)}`).join(" ")} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />}
              {l.points.map((p: any) => p.high != null
                ? <line key={p.id} x1={x(p.at)} x2={x(p.at)} y1={y(p.value)} y2={y(p.high)} stroke={color} strokeWidth="6" strokeLinecap="round" />
                : <circle key={p.id} cx={x(p.at)} cy={y(p.value)} r={p === last ? 4 : 3} fill={p.flag ? color : "#fff"} stroke={color} strokeWidth="1.6" />)}
              <text x={Math.min(x(last.at) + 6, W - R + 4)} y={y(last.value) + 4} fontSize={narrow ? 10 : 11} fontWeight="700" fill={color}>{last.text}</text>
            </g>
          );
        })}
        {medRows.map((m: any, i: number) => {
          const yy = top + lanes.length * laneH + 10 + i * (narrow ? 15 : 17);
          return (
            <g key={m.id}>
              {i === 0 && <text x={0} y={yy + 9} fontSize={narrow ? 10.5 : 12} fontWeight="700" fill="#344054">{narrow ? "Meds" : "Medicines"}</text>}
              {m.periods.map((p: any, j: number) => (
                <rect key={j} x={x(p.from)} y={yy} width={Math.max(3, x(p.to) - x(p.from))} height={narrow ? 11 : 12} rx="6" fill={p.state === "on" ? "#dbe7f5" : "#fff"} stroke={p.state === "on" ? "none" : "#b42318"} strokeDasharray={p.state === "on" ? undefined : "3 3"} />
              ))}
              <text x={x(m.periods[0].from) + 6} y={yy + (narrow ? 9 : 10)} fontSize={narrow ? 9 : 10.5} fontWeight="600" fill="#0b2d5b">{m.name}{m.status === "held" ? " (held)" : m.status === "stopped" ? " (stopped)" : ""}</text>
            </g>
          );
        })}
        {ticks.map((k) => <text key={k.at} x={x(k.at)} y={H - 6} fontSize={narrow ? 9.5 : 10.5} fill="#667085" textAnchor="middle">{k.label}</text>)}
      </svg>
      {((t.before as string[]).length > 0 || (t.steady ?? []).length > 0) && (
        <p className="tl-before">{[(t.steady ?? []).length ? `Unchanged throughout: ${t.steady.join(", ")}` : null, t.before.length ? `Before this period: ${t.before.join(" · ")}` : null].filter(Boolean).join(" · ")}</p>
      )}
      <div className="tl-picks" role="group" aria-label="Values on the timeline">
        {picks.map((p) => <button key={p.key} type="button" className={`tl-chip${pick === p.key ? " on" : ""}`} aria-pressed={pick === p.key} onClick={() => setPick(pick === p.key ? null : p.key)}>{p.label}</button>)}
      </div>
      {chosen && <p className="tl-detail" aria-live="polite">{chosen.detail}</p>}
    </div>
  );
}

// one abnormal result, shown once, in the problem it belongs to (20 Oct 2026)
export function ResultRows({ items }: { items: any[] }) {
  if (!items.length) return null;
  return (
    <ul className="abn-list">
      {items.map((r: any) => (
        <li key={r.code} className={`abn-${r.flag}`}>
          <span className="abn-name"><b>{r.label} {r.text}</b> <small>{r.unit}</small>{r.note && <em>{r.note}</em>}<time>{fmtDay(r.at)}{r.previous ? ` · before ${r.previous.text}` : " · first result"}</time></span>
          {r.series.length > 1 ? <Sparkline values={r.series} tone={r.flag === "high" ? "red" : "orange"} width={72} height={22} /> : <span />}
          <span className="abn-pct">{r.percent != null ? `${r.percent > 0 ? "+" : ""}${r.percent}%` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

// why each HF medicine is not started or not increased, and what would let it back
export function HeldMedicines({ s }: { s: any }) {
  // every HF pillar once (20 Oct 2026): what she takes and how far from target, or why it is not given and
  // what would let it back — replaces the separate pillar pills and "held" list
  const pillars = (s.targets?.hf?.pillars ?? []) as any[];
  if (!pillars.length) return null;
  const state = (p: any) => p.state === "target" ? "At target" : p.state === "on" ? `${p.med ?? "On"}${p.percentOfTarget != null ? ` · ${p.percentOfTarget}% of target` : ""}` : p.state === "held" ? `${p.med ?? "Held"}` : p.note?.startsWith("Not given") ? p.note : "Not started";
  return (
    <div className="held-card" aria-label="Heart failure medicines">
      {pillars.map((p) => {
        const why = p.block ?? p.increaseBlock ?? null;
        return (
          <div key={p.key} className={`held-row pill-${p.state}`}>
            <b>{p.label.split(" (")[0].replace("ARNI / ACE inhibitor / ARB", "ARNI / ACEi / ARB")}</b>
            <span className={p.state === "target" ? "st-good" : p.state === "on" ? "" : "held-why"}>{p.block ? `Not now: ${p.block}` : state(p)}{!p.block && p.increaseBlock ? ` · not increased: ${p.increaseBlock}` : ""}</span>
            <span className="small muted">{why ? p.unlock ?? p.increaseUnlock ?? "" : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
