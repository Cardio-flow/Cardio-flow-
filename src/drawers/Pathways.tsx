import { Route } from "lucide-react";
import { Drawer } from "../ui";
import { WIZARDS } from "../../shared/wizards";

const GROUPS = ["Acute & safety", "Heart failure", "Rhythm & devices", "Diabetes"] as const;

// Every complication pathway, opened on demand (alerts open the same wizards automatically).
export function Pathways({ onClose, onPick }: { onClose(): void; onPick(wizard: string): void }) {
  const all = Object.values(WIZARDS);
  return (
    <Drawer title="Clinical pathways" subtitle="Step-by-step management from the latest guidelines, ending in a dated plan" icon={<Route size={22} />} onClose={onClose}>
      <div className="drawer-body">
        {GROUPS.map((g) => {
          const items = all.filter((w) => (w.group ?? "Heart failure") === g);
          if (!items.length) return null;
          return (
            <section key={g} className="col" style={{ gap: 10 }}>
              <span className="eyebrow">{g}</span>
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
      </div>
    </Drawer>
  );
}
