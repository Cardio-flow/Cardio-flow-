// Echo (redesign slice 4: light forms). Only LVEF is required. The essentials are on top — date, quality,
// LVEF with the HF class and the change since the last value, valve grades — and the rest folds away and
// opens by itself where it matters: the stenosis numbers when a stenosis is graded moderate or worse, LV
// size with significant regurgitation, the right-heart section when TR is graded, the cardiomyopathy
// measurements when the patient has a cardiomyopathy.
import { useMemo, useState, type ReactNode } from "react";
import { Activity, ChevronDown, Copy } from "lucide-react";
import { api } from "../api";
import { Drawer, MultiChoice, Segmented } from "../ui";
import { ECHO_NUMBERS, ECHO_VALVES, MR_TYPES, VALVE_GRADES, valveFindings } from "../../shared/studies";
import { PH_SIGNS, PROBABILITY_LABEL, phEchoProbability } from "../../shared/ph";
import { fmtDay } from "../../shared/clinical";
import { DateField } from "../screens/SuggestLine";

const COMMON = ["Regional wall motion abnormality", "Dilated LV", "LV hypertrophy", "RV dysfunction", "Pericardial effusion", "LV thrombus"];
const MORE = [
  "LV size normalised", "Calcified aortic valve", "Bicuspid aortic valve", "Asymmetric septal hypertrophy", "Systolic anterior motion (SAM)", "LV apical aneurysm", "Rheumatic mitral valve",
  "Prosthetic valve dysfunction", "Prosthetic valve thrombus", "Paravalvular leak", "Dilated aortic root / ascending aorta", "Raised PASP", "Dilated IVC", "Limited windows",
];
const NUM = (code: string) => ECHO_NUMBERS.find((n) => n.code === code)!;
const RANK: Record<string, number> = { None: 0, Mild: 1, Moderate: 2, Severe: 3 };

function Fold({ title, hint, open, children }: { title: string; hint?: string; open: boolean; children: ReactNode }) {
  return (
    <details className="ef-fold" open={open || undefined}>
      <summary><b>{title}</b>{hint && <span>{hint}</span>}<ChevronDown size={18} className="chev" /></summary>
      <div className="ef-fold-body">{children}</div>
    </details>
  );
}

export function AddEcho({ patientId, contextId, summary, onClose, onDone }: { patientId: string; contextId?: string; summary?: any; onClose(): void; onDone(m?: string, r?: any): void }) {
  const today: string = summary?.today ?? new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [quality, setQuality] = useState("formal");
  const [lvef, setLvef] = useState("");
  const [findings, setFindings] = useState<string[]>([]);
  const [conclusion, setConclusion] = useState("");
  const [valves, setValves] = useState<Record<string, string>>({});
  const [mrType, setMrType] = useState<string | undefined>();
  const [nums, setNums] = useState<Record<string, string>>({});
  const [phSigns, setPhSigns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dx = new Set<string>((summary?.header?.diagnoses ?? []).map((d: any) => d.code));
  const cardiomyopathy = ["hcm", "dcm", "amyloid", "arvc", "lvnc", "rcm"].some((c) => dx.has(c));
  const last = summary?.lastEcho as { at: string; valves: Record<string, string>; mrType: string | null } | null | undefined;
  const prev = summary?.lvef as { value: number; at: string } | null | undefined;

  const trvNum = nums.trv ? Number(nums.trv) : null;
  const prob = trvNum != null || phSigns.length ? phEchoProbability(trvNum, phSigns) : null;
  const badNum = ECHO_NUMBERS.filter((n) => nums[n.code] && !(Number(nums[n.code]) >= n.min && Number(nums[n.code]) <= n.max));
  const ef = Number(lvef);
  const efOk = lvef !== "" && ef >= 5 && ef <= 85;
  const valid = efOk && !badNum.length;
  const g = (k: string) => RANK[valves[k] ?? ""] ?? -1;
  // which folded sections open by themselves
  const show = {
    aortic: g("as") >= 2, mitral: g("ms") >= 2, size: g("ar") >= 2 || g("mr") >= 2 || findings.includes("Dilated LV"),
    right: g("tr") >= 1 || findings.includes("Raised PASP") || findings.includes("RV dysfunction") || dx.has("ph"),
    cmp: cardiomyopathy || findings.includes("LV hypertrophy") || findings.includes("Asymmetric septal hypertrophy"),
  };
  const preview = useMemo(() => [efOk ? `LVEF ${ef}%` : null, ...valveFindings(valves, mrType)].filter(Boolean).join(" · "), [efOk, ef, valves, mrType]);
  const numField = (code: string) => {
    const n = NUM(code);
    return (
      <label key={code} className="field">
        <span>{n.label} <span className="muted">{n.unit}</span></span>
        <input className={`input num${badNum.includes(n) ? " bad" : ""}`} inputMode="decimal" value={nums[code] ?? ""} onChange={(e) => setNums({ ...nums, [code]: e.target.value })} aria-label={`${n.label} ${n.unit}`} />
      </label>
    );
  };

  async function save() {
    setBusy(true);
    setError("");
    try {
      const at = date === today ? new Date().toISOString() : new Date(`${date}T10:00:00+03:00`).toISOString();
      const r = await api(`/patients/${patientId}/echo`, { body: {
        date: at, quality, lvef: ef, findings, conclusion, contextId: contextId ?? null,
        valves, mrType: valves.mr && valves.mr !== "None" ? mrType ?? null : null,
        measures: Object.fromEntries(Object.entries(nums).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])),
        phSigns,
      } });
      onDone(`Echo recorded · ${preview}`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      wide
      title="Add echo"
      subtitle="Only LVEF is required; the rest opens when it matters"
      icon={<Activity size={22} />}
      onClose={onClose}
      footer={
        <>
          <span className="note">{!efOk ? "Needed: LVEF (5–85%)" : preview}</span>
          <span className="end">
            <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : "Save echo"}</button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        <section className="ef-core">
          <div className="ef-lvef">
            <label>
              <small>LVEF <em>required</em></small>
              <span className="ef-input">
                <input inputMode="numeric" autoFocus value={lvef} onChange={(e) => setLvef(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} aria-label="LVEF percent" placeholder="—" />
                <b>%</b>
              </span>
            </label>
            <div className="ef-gauge" aria-hidden="true">
              <span className="ef-band low" style={{ width: `${((50 - 5) / 80) * 100}%` }}>Reduced &lt;50</span>
              <span className="ef-band norm">≥50</span>
              {efOk && <i className="ef-mark" style={{ left: `${((ef - 5) / 80) * 100}%` }} />}
              {prev && <i className="ef-prev" style={{ left: `${((prev.value - 5) / 80) * 100}%` }} title={`Previous ${prev.value}%`} />}
            </div>
            <span className="ef-delta">
              {efOk && prev ? `${ef > prev.value ? "↑" : ef < prev.value ? "↓" : "→"} from ${prev.value}% on ${fmtDay(prev.at, { year: true })}` : prev ? `Previous ${prev.value}% on ${fmtDay(prev.at, { year: true })}` : "First LVEF in the record"}
            </span>
          </div>
          <div className="ef-meta">
            <DateField label="Study date" value={date} onChange={setDate} today={today} max={today} quick={[{ label: "Today", days: 0 }, { label: "Yesterday", days: -1 }]} />
            <div className="q">
              <div className="label" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-4)" }}>Study</div>
              <Segmented label="Study quality" options={[{ value: "formal", label: "Formal TTE" }, { value: "limited", label: "Limited" }, { value: "bedside", label: "Bedside" }]} value={quality} onChange={setQuality} />
            </div>
          </div>
        </section>
        {quality !== "formal" && <div className="infobox">A limited or bedside study is kept in the record but does not replace a recent formal study as the current LVEF.</div>}

        <section className="ef-valves">
          <div className="ef-valves-head">
            <b>Valves</b><span>grade as reported · leave blank if not reported</span>
            {last && Object.keys(last.valves).length > 0 && (
              <button type="button" className="btn ghost small" onClick={() => { setValves({ ...last.valves }); if (last.mrType) setMrType(last.mrType); }}>
                <Copy size={14} /> Same as {fmtDay(last.at)}
              </button>
            )}
          </div>
          <div className="ef-vgrid">
            {ECHO_VALVES.map((v) => (
              <div key={v.key} className="ef-vrow">
                <span className="ef-vname" title={v.label}>{v.short}<em>{v.label}</em></span>
                <div className="ef-grades" role="radiogroup" aria-label={v.label}>
                  {VALVE_GRADES.map((gr) => (
                    <button key={gr} type="button" role="radio" aria-checked={valves[v.key] === gr} className={`ef-g g${RANK[gr]}`}
                      onClick={() => setValves((x) => { const n = { ...x }; if (n[v.key] === gr) delete n[v.key]; else n[v.key] = gr; return n; })}>
                      {gr}
                    </button>
                  ))}
                </div>
                {last?.valves[v.key] && last.valves[v.key] !== valves[v.key] && <span className="ef-last">last {last.valves[v.key].toLowerCase()}</span>}
                {v.key === "mr" && g("mr") >= 1 && (
                  <div className="ef-sub"><Segmented label="MR mechanism" options={MR_TYPES.map((x) => ({ value: x, label: x }))} value={mrType} onChange={setMrType} /></div>
                )}
                {v.key === "as" && show.aortic && <div className="ef-sub ef-nums">{numField("av-vmax")}{numField("av-mg")}{numField("ava")}</div>}
                {v.key === "ms" && show.mitral && <div className="ef-sub ef-nums">{numField("mva")}</div>}
              </div>
            ))}
          </div>
        </section>

        <section className="ef-findings">
          <b>Findings</b>
          <MultiChoice options={COMMON.map((f) => ({ value: f, label: f }))} value={findings.filter((f) => COMMON.includes(f))} onChange={(x) => setFindings([...x, ...findings.filter((f) => !COMMON.includes(f))])} />
        </section>

        <Fold title="LV size" hint="LVESD, LVEDD" open={show.size}>
          <div className="ef-nums">{numField("lvesd")}{numField("lvedd")}</div>
        </Fold>
        <Fold title="Right heart and pulmonary pressure" hint="TR velocity, SPAP, PH signs" open={show.right}>
          <div className="ef-nums">{numField("trv")}{numField("spap")}</div>
          <MultiChoice options={PH_SIGNS.map((s) => ({ value: s.key, label: s.label }))} value={phSigns} onChange={setPhSigns} />
          {prob && <div className="infobox"><span>{`Echo probability of PH: ${PROBABILITY_LABEL[prob.probability]}${prob.trv != null ? ` · TRV ${prob.trv} m/s` : " · TRV not measured"}${prob.categories.length ? ` · signs in ${prob.categories.length} categor${prob.categories.length > 1 ? "ies" : "y"}` : ""} (ESC/ERS 2022)`}</span></div>}
        </Fold>
        <Fold title="Cardiomyopathy measurements" hint="wall thickness, LA, LVOT gradients" open={show.cmp}>
          <div className="ef-nums">{numField("mwt")}{numField("la-diam")}{numField("lvot-rest")}{numField("lvot-provoked")}</div>
        </Fold>
        <Fold title="More findings and conclusion" hint={`${MORE.filter((f) => findings.includes(f)).length || "none"} selected`} open={false}>
          <MultiChoice options={MORE.map((f) => ({ value: f, label: f }))} value={findings.filter((f) => MORE.includes(f))} onChange={(x) => setFindings([...findings.filter((f) => !MORE.includes(f)), ...x])} />
          <label className="field">
            <span>Conclusion</span>
            <textarea className="input" rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
          </label>
        </Fold>
        {badNum.length > 0 && <div className="error-box">{badNum.map((n) => `${n.label}: ${n.min}–${n.max} ${n.unit}`).join(" · ")}</div>}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
