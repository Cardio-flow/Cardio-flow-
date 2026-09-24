import { useCallback, useState } from "react";
import { FlaskConical, Plus, Stethoscope, BedDouble, LogOut as DischargeIcon } from "lucide-react";
import { useData } from "../api";
import { Link, Tag, initials, useToast } from "../ui";
import { SummaryTab } from "./Summary";
import { JourneyTab } from "./Journey";
import { MedicationsTab, InvestigationsTab, PlanTab, VisitsTab, RegistriesTab } from "./Tabs";
import { QuickLabs } from "../drawers/QuickLabs";
import { WizardDrawer } from "../drawers/Wizard";
import { AddMedication, MedicationAction } from "../drawers/Medication";
import { AddPlan, PlanItem } from "../drawers/PlanDrawers";
import { AddEcho } from "../drawers/AddEcho";
import { Admission, Discharge, ClinicVisit } from "../drawers/Contexts";
import { AddDiagnosis } from "../drawers/NewPatient";

export type Open =
  | { kind: "labs"; codes?: string[] }
  | { kind: "wizard"; wizard: string; recommendationId?: string }
  | { kind: "med-add"; code?: string; dose?: number; reason?: string }
  | { kind: "med-action"; medId: string; action?: string; dose?: number; reason?: string }
  | { kind: "plan-add"; template?: string; medicationId?: string }
  | { kind: "plan-item"; planId: string }
  | { kind: "echo" }
  | { kind: "admit" }
  | { kind: "discharge"; contextId: string }
  | { kind: "visit"; contextId?: string }
  | { kind: "dx" };

const TABS = [
  ["summary", "Summary"], ["journey", "Journey"], ["visits", "Visits"], ["medications", "Medications"], ["investigations", "Investigations"], ["plan", "Plan & follow-up"], ["registries", "Registries"],
] as const;

export function PatientPage({ id, tab }: { id: string; tab: string }) {
  const { data: s, error, reload } = useData<any>(`/patients/${id}/summary`);
  const [open, setOpen] = useState<Open | null>(null);
  const [version, setVersion] = useState(0);
  const toast = useToast();
  const done = useCallback(
    (message?: string, result?: any) => {
      setOpen(null);
      reload();
      setVersion((v) => v + 1);
      const created = result?.engine?.created ?? [];
      const red = created.find((c: any) => c.severity === "red" || c.severity === "orange");
      if (red) toast({ text: `${message ?? "Saved"}. New alert: ${red.title}` });
      else if (message) toast({ text: message });
    },
    [reload, toast],
  );
  const close = useCallback(() => setOpen(null), []);
  if (error) return <main className="page"><div className="error-box">{error}</div></main>;
  if (!s) return <main className="page" aria-busy="true" />;
  const h = s.header;
  const ctx = h.openContext;
  const redCount = s.attention.filter((a: any) => a.severity === "red" || a.severity === "orange").length;
  return (
    <>
      <section className="pt-head">
        <div className="pt-top">
          <div className="pt-avatar">{initials(h.name)}</div>
          <div className="col" style={{ gap: 8, minWidth: 0 }}>
            <div className="pt-name">
              <h1>{h.name}</h1>
              <span className="id">
                {h.age} y · {h.sex} · MRN {h.mrn}
              </span>
              <span className="chip gray">{h.where}</span>
              {s.attention.length > 0 && (
                <span className={`chip sev sev-${s.attention[0].severity}`}>
                  <span className="dot" />
                  {s.attention.length} alert{s.attention.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              {h.diagnoses.map((d: any) => (
                <span key={d.id} className="chip dx">{d.label}</span>
              ))}
              <button className="chip outline" style={{ cursor: "pointer" }} onClick={() => setOpen({ kind: "dx" })}>
                <Plus size={14} /> Diagnosis
              </button>
              <span className="chip outline">Allergies: {h.allergies}</span>
            </div>
          </div>
          <div className="pt-actions">
            <button className="btn secondary" onClick={() => setOpen({ kind: "labs" })}>
              <FlaskConical size={18} />
              Add labs
            </button>
            {ctx?.kind === "admission" ? (
              <button className="btn primary" onClick={() => setOpen({ kind: "discharge", contextId: ctx.id })}>
                <DischargeIcon size={18} />
                Discharge
              </button>
            ) : ctx?.kind === "clinic_visit" ? (
              <button className="btn primary" onClick={() => setOpen({ kind: "visit", contextId: ctx.id })}>
                <Stethoscope size={18} />
                Continue visit
              </button>
            ) : (
              <>
                <button className="btn secondary" onClick={() => setOpen({ kind: "admit" })}>
                  <BedDouble size={18} />
                  Admit
                </button>
                <button className="btn primary" onClick={() => setOpen({ kind: "visit" })}>
                  <Stethoscope size={18} />
                  Start clinic visit
                </button>
              </>
            )}
          </div>
        </div>
        <nav className="tabs" aria-label="Patient sections">
          {TABS.map(([key, label]) => (
            <Link key={key} to={`/patients/${id}${key === "summary" ? "" : "/" + key}`} aria-current={tab === key ? "page" : undefined}>
              {label}
              {key === "summary" && redCount > 0 && <span className="n">{redCount}</span>}
            </Link>
          ))}
        </nav>
      </section>
      {s.attention.some((a: any) => a.rule_status !== "PUBLISHED") && tab === "summary" && (
        <div className="sandbox-banner">
          <Tag sev="yellow">SANDBOX</Tag>
          Some alerts come from rules still in clinical review. They run here for testing only and never on a production site.
        </div>
      )}
      {tab === "summary" && <SummaryTab s={s} open={setOpen} />}
      {tab === "journey" && <JourneyTab id={id} version={version} />}
      {tab === "visits" && <VisitsTab id={id} version={version} open={setOpen} />}
      {tab === "medications" && <MedicationsTab id={id} version={version} open={setOpen} />}
      {tab === "investigations" && <InvestigationsTab id={id} version={version} open={setOpen} done={done} />}
      {tab === "plan" && <PlanTab id={id} version={version} open={setOpen} />}
      {tab === "registries" && <RegistriesTab />}

      {open?.kind === "labs" && <QuickLabs patientId={id} codes={open.codes} onClose={close} onDone={done} />}
      {open?.kind === "wizard" && <WizardDrawer patientId={id} patientName={h.name} wizard={open.wizard} recommendationId={open.recommendationId} contextId={ctx?.id} onClose={close} onDone={done} />}
      {open?.kind === "med-add" && <AddMedication patientId={id} summary={s} contextId={ctx?.id} preset={open.code ? { code: open.code, dose: open.dose, reason: open.reason } : undefined} onClose={close} onDone={done} />}
      {open?.kind === "med-action" && <MedicationAction patientId={id} summary={s} medId={open.medId} initial={open.action} initialDose={open.dose} initialReason={open.reason} contextId={ctx?.id} onClose={close} onDone={done} />}
      {open?.kind === "plan-add" && <AddPlan patientId={id} template={open.template} medicationId={open.medicationId} contextId={ctx?.id} onClose={close} onDone={done} />}
      {open?.kind === "plan-item" && <PlanItem patientId={id} planId={open.planId} onClose={close} onDone={done} open={setOpen} />}
      {open?.kind === "echo" && <AddEcho patientId={id} contextId={ctx?.id} onClose={close} onDone={done} />}
      {open?.kind === "admit" && <Admission patientId={id} summary={s} onClose={close} onDone={done} />}
      {open?.kind === "discharge" && <Discharge patientId={id} summary={s} contextId={open.contextId} onClose={close} onDone={done} />}
      {open?.kind === "visit" && <ClinicVisit patientId={id} summary={s} contextId={open.contextId} onClose={close} onDone={done} open={setOpen} />}
      {open?.kind === "dx" && <AddDiagnosis patientId={id} onClose={close} onDone={done} />}
    </>
  );
}
