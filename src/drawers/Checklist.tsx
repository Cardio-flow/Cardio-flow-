// Checklist before a procedure (redesign slice 7): read from the record — ticked, flagged or open —
// with one step to enter the missing results and links to the pathway that plans the anticoagulation.
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Info, ListChecks } from "lucide-react";
import { useData } from "../api";
import { Drawer } from "../ui";
import { fmtDay } from "../../shared/clinical";
import type { Open } from "../screens/Patient";

import type { CheckKind as Kind } from "../../shared/procedures";
type Item = { key: string; label: string; status: "ok" | "flag" | "missing" | "info"; value?: string; date?: string; why?: string; source?: string; action?: any };
const KINDS: { value: Kind; label: string }[] = [
  { value: "pci", label: "Angiography / PCI" },
  { value: "cardioversion", label: "Cardioversion" },
  { value: "ablation", label: "AF ablation" },
  { value: "device", label: "Device implant" },
  { value: "valve", label: "Valve intervention" },
  { value: "rhc", label: "Right heart cath" },
  { value: "cabg", label: "CABG" },
  { value: "pericardiocentesis", label: "Pericardiocentesis" },
];
const ICON = { ok: CheckCircle2, flag: AlertTriangle, missing: Circle, info: Info };

export function ChecklistDrawer({ patientId, initial, onClose, open }: { patientId: string; initial?: Kind; onClose(): void; open(o: Open): void }) {
  const [kind, setKind] = useState<Kind>(initial ?? "pci");
  const { data } = useData<{ title: string; items: Item[] }>(`/patients/${patientId}/checklist/${kind}`, [kind]);
  const items = data?.items ?? [];
  const missingLabs = [...new Set(items.filter((i) => i.action?.type === "add-labs").flatMap((i) => i.action.codes as string[]))];
  const n = { ok: items.filter((i) => i.status === "ok").length, flag: items.filter((i) => i.status === "flag").length, missing: items.filter((i) => i.status === "missing").length };
  return (
    <Drawer
      wide
      title="Checklist before a procedure"
      subtitle="Read from the record: ticked, to act on, or not recorded"
      icon={<ListChecks size={22} />}
      onClose={onClose}
      head={
        <div className="ck-kinds" role="tablist" aria-label="Procedure">
          {KINDS.map((k) => (
            <button key={k.value} role="tab" aria-selected={kind === k.value} className="ck-kind" onClick={() => setKind(k.value)}>{k.label}</button>
          ))}
        </div>
      }
      footer={
        <>
          <span className="note">{data ? `${n.ok} ready · ${n.flag} to act on · ${n.missing} not recorded` : "Reading the record…"}</span>
          <span className="end">
            {missingLabs.length > 0 && <button className="btn secondary" onClick={() => open({ kind: "labs", codes: missingLabs })}>Enter missing results</button>}
            {kind !== "pericardiocentesis" && <button className="btn primary" onClick={() => open({ kind: "procedure", group: kind === "pci" || kind === "cabg" ? "coronary" : kind === "valve" ? "valve" : kind === "rhc" ? "ph" : "rhythm" })}>Record the procedure</button>}
          </span>
        </>
      }
    >
      <div className="drawer-body">
        {data && (
          <div className="ck-meter" aria-hidden="true">
            {items.map((i) => <i key={i.key} className={`st-${i.status}`} />)}
          </div>
        )}
        <div className="ck-list">
          {items.map((i) => {
            const Icon = ICON[i.status];
            return (
              <div key={i.key} className={`ck-item st-${i.status}`}>
                <Icon size={20} className="ck-ic" />
                <div className="ck-txt">
                  <b>{i.label}{i.value && <span className="ck-val">{i.value}</span>}</b>
                  {(i.why || i.date) && <span>{[i.date ? fmtDay(i.date, { year: true }) : null, i.why].filter(Boolean).join(" · ")}</span>}
                  {i.source && <small>{i.source}</small>}
                </div>
                {i.action?.type === "wizard" && <button className="btn ghost small" onClick={() => open({ kind: "wizard", wizard: i.action.wizard })}>{i.action.label}</button>}
                {i.action?.type === "add-labs" && <button className="btn ghost small" onClick={() => open({ kind: "labs", codes: i.action.codes })}>{i.action.label}</button>}
              </div>
            );
          })}
        </div>
      </div>
    </Drawer>
  );
}
