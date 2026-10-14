// Overview "pulse" (14 Oct 2026, Ahmed: "I scroll a lot to get the meds and lab trends"): the first thing on the
// overview — vitals and LVEF in one line, the key lab trends as a swipeable strip (value, direction, change,
// sparkline) and the current medicines as compact chips. A tap on a trend or "+N" opens the full list.
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Sparkline, type Sev } from "../ui";
import { fmtDay } from "../../shared/clinical";
import { MEASURES, formatNumber } from "../../shared/catalog";
import type { Open } from "./Patient";

// the results a cardiologist looks for first, in this order (others follow by date)
const KEY = ["creatinine", "egfr", "potassium", "sodium", "nt-probnp", "haemoglobin", "ldl-c", "hba1c", "ferritin", "tsat", "inr", "uacr", "tsh", "alt", "magnesium", "digoxin-level", "troponin"];
const PURPOSE_HUE: Record<string, string> = {};
const HUES = ["#1757a8", "#0f7b6c", "#8a4fbf", "#b45309", "#be185d", "#475569", "#0e7490", "#4d7c0f"];

export const toneOf = (r: any): Sev => {
  const v = r.latest?.value ?? r.current?.value;
  if (v == null) return "gray";
  if (r.ref?.high != null && v > r.ref.high) return r.code === "potassium" ? "red" : "orange";
  if (r.ref?.low != null && v < r.ref.low) return "orange";
  return "blue";
};

export function Pulse({ s, open, go }: { s: any; open(o: Open): void; go(pane: string, code?: string): void }) {
  const byCode = new Map<string, any>((s.results ?? []).map((r: any) => [r.code, r]));
  const trends = [...KEY.filter((c) => byCode.has(c)).map((c) => byCode.get(c)), ...(s.results ?? []).filter((r: any) => !KEY.includes(r.code))].slice(0, 10);
  const v = Object.fromEntries((s.vitals ?? []).map((x: any) => [x.code, x]));
  const vitals: [string, string, string | undefined][] = [];
  if (v.sbp) vitals.push(["BP", `${formatNumber(v.sbp.value, 0)}${v.dbp ? `/${formatNumber(v.dbp.value, 0)}` : ""}`, v.sbp.at]);
  if (v.hr) vitals.push(["HR", formatNumber(v.hr.value, 0), v.hr.at]);
  if (v.weight) vitals.push(["Wt", `${formatNumber(v.weight.value, 1)} kg`, v.weight.at]);
  if (s.lvef) vitals.push(["LVEF", `${formatNumber(s.lvef.value, 0)}%`, s.lvef.at]);
  const groups = (s.medications?.groups ?? []) as any[];
  groups.forEach((g, i) => (PURPOSE_HUE[g.purpose] ??= HUES[i % HUES.length]));
  const meds = groups.flatMap((g) => g.meds.map((m: any) => ({ ...m, purpose: g.purpose })));
  const shown = meds.slice(0, 12);
  return (
    <section className="pulse" aria-label="Patient pulse">
      <div className="pulse-vitals">
        {vitals.length ? vitals.map(([k, val, at]) => (
          <span key={k} className="pv" title={at ? fmtDay(at, { year: true }) : undefined}><em>{k}</em>{val}</span>
        )) : <span className="pv muted">No vitals recorded</span>}
        <button className="pv add" onClick={() => open({ kind: "labs", codes: ["sbp", "dbp", "hr", "weight"] })}>+ Vitals</button>
      </div>
      {trends.length > 0 && (
        <div className="pulse-strip" role="list" aria-label="Key result trends">
          {trends.map((r: any) => {
            const t = toneOf(r), latest = r.latest ?? r.current, tr = r.trend;
            const Dir = tr?.direction === "up" ? ArrowUpRight : tr?.direction === "down" ? ArrowDownRight : Minus;
            const pct = tr?.percent;
            return (
              <button key={r.code} role="listitem" className={`ptile tone-${t}`} onClick={() => go("results", r.code)} aria-label={`${r.display} ${latest.value} ${r.unit}`}>
                <span className="ptile-name">{MEASURES[r.code]?.short ?? r.display}</span>
                <span className="ptile-val">{latest.value == null ? "—" : formatNumber(latest.value, r.decimals)}<small>{r.unit}</small></span>
                <Sparkline values={(r.displaySeries ?? r.series).map((p: any) => p.value)} tone={t} width={84} height={22} />
                <span className="ptile-foot">
                  {pct != null ? <b><Dir size={12} aria-hidden="true" />{`${pct > 0 ? "+" : ""}${formatNumber(pct, 0)}%`}</b> : <b className="muted">first</b>}
                  <time>{fmtDay(latest.at)}</time>
                </span>
              </button>
            );
          })}
          <button className="ptile more" onClick={() => go("results")}>All {s.results.length}<small>results</small></button>
        </div>
      )}
      <div className="pulse-meds" aria-label="Current medicines">
        {meds.length === 0 && <span className="muted small">No current medicines</span>}
        {shown.map((m: any) => (
          <button key={m.id} className={`pm${m.status === "held" ? " held" : ""}${m.doseValue == null ? " nodose" : ""}`} style={{ ["--hue" as any]: PURPOSE_HUE[m.purpose] }}
            title={`${m.purpose} · ${m.name} ${m.dose} ${m.frequency ?? ""}`}
            onClick={() => open(m.doseValue == null ? { kind: "med-dose", medId: m.id } : { kind: "med-action", medId: m.id })}>
            <b>{m.name.replace(/ \(.*\)$/, "")}</b> {m.doseValue == null ? "dose?" : m.dose.replace(/ \(.*\)$/, "")}{m.frequency ? ` ${m.frequency}` : ""}
          </button>
        ))}
        {meds.length > shown.length ? <button className="pm more" onClick={() => go("meds")}>+{meds.length - shown.length} more</button>
          : meds.length > 0 && <button className="pm more" onClick={() => go("meds")}>Details</button>}
      </div>
    </section>
  );
}
