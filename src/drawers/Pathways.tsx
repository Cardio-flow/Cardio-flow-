import { useMemo, useState } from "react";
import { Route, Search } from "lucide-react";
import { Drawer } from "../ui";
import { WIZARDS } from "../../shared/wizards";
import { DIAGNOSIS } from "../../shared/catalog";

const GROUPS = ["Acute & safety", "Procedures & general medicine", "Coronary", "Inflammatory & infective heart disease", "Heart failure", "Rhythm & devices", "Valve disease", "Cardiomyopathy", "Pulmonary hypertension", "Diabetes"] as const;
// diagnosis tags that make a group relevant to this patient
const GROUP_TAGS: Record<string, string[]> = {
  Coronary: ["cad", "ascvd"], "Heart failure": ["hf"], "Rhythm & devices": ["af", "cied", "rhythm"], "Valve disease": ["valve", "mechanical-valve"],
  Cardiomyopathy: ["cmp", "hcm"], "Pulmonary hypertension": ["ph"], Diabetes: ["dm"],
};

// Every pathway, opened on demand (alerts open the same pathways automatically). Search by name or source;
// the ones this patient's alerts and open episodes point to come first.
export function Pathways({ summary, onClose, onPick }: { summary?: any; onClose(): void; onPick(wizard: string): void }) {
  const [q, setQ] = useState("");
  const all = Object.values(WIZARDS);
  const forPatient = useMemo(() => {
    const ids = new Map<string, string>();
    for (const a of summary?.attention ?? []) if (a.action?.type === "wizard" && WIZARDS[a.action.wizard] && !ids.has(a.action.wizard)) ids.set(a.action.wizard, a.title);
    for (const e of summary?.episodes ?? []) if (e.status === "open" && WIZARDS[e.wizard] && !ids.has(e.wizard)) ids.set(e.wizard, "Open episode: review");
    return [...ids.entries()];
  }, [summary]);
  const tags = new Set<string>((summary?.header?.diagnoses ?? []).flatMap((d: any) => DIAGNOSIS[d.code]?.tags ?? []));
  const relevant = (g: string) => (GROUP_TAGS[g] ?? []).some((t) => tags.has(t));
  const needle = q.trim().toLowerCase();
  const match = (w: (typeof all)[number]) => !needle || `${w.title} ${w.source ?? ""} ${w.group ?? ""}`.toLowerCase().includes(needle);
  const groups = [...GROUPS].sort((a, b) => Number(relevant(b)) - Number(relevant(a)));
  return (
    <Drawer
      title="Clinical pathways"
      subtitle="Step-by-step management from the latest guidelines, filled in from the record, ending in a dated plan"
      icon={<Route size={22} />}
      onClose={onClose}
      head={
        <label className="pw-search">
          <Search size={18} />
          <input autoFocus placeholder="Search pathways: e.g. potassium, AF, bleeding, valve" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pathways" />
        </label>
      }
    >
      <div className="drawer-body">
        {!needle && forPatient.length > 0 && (
          <section className="col" style={{ gap: 10 }}>
            <span className="pw-head">For this patient now</span>
            <div className="study-kinds">
              {forPatient.map(([id, why]) => (
                <button key={id} className={`study-kind path sev-${WIZARDS[id].tone}`} onClick={() => onPick(id)}>
                  <b>{WIZARDS[id].title}</b>
                  <span>{why}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {groups.map((g) => {
          const items = all.filter((w) => (w.group ?? "Heart failure") === g && match(w));
          if (!items.length) return null;
          return (
            <section key={g} className="col" style={{ gap: 10 }}>
              <span className="pw-head">{g}{relevant(g) && <em>matches the problem list</em>}</span>
              <div className="study-kinds">
                {items.map((w) => (
                  <button key={w.id} className={`study-kind path sev-${w.tone}`} onClick={() => onPick(w.id)}>
                    <b>{w.title}</b>
                    {w.source && <span>{w.source}</span>}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {needle && !all.some(match) && <div className="empty">No pathway matches “{q}”.</div>}
      </div>
    </Drawer>
  );
}
