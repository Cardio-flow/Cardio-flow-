import { lazy, Suspense, useCallback, useState, useEffect } from "react";
import {
  FlaskConical,
  Plus,
  Stethoscope,
  BedDouble,
  LogOut as DischargeIcon,
  Route,
  FileText,
  Pencil,
} from "lucide-react";
import { useData, setSampleMode } from "../api";
import { Drawer, DrawerWorkspace, Link, Tag, initials, useToast } from "../ui";
import { SummaryTab, ActionButton, WhyPanel } from "./Summary";
import { triage } from "../../shared/triage";
import { JourneyTab } from "./Journey";
import {
  MedicationsTab,
  InvestigationsTab,
  PlanTab,
  VisitsTab,
  RegistriesTab,
} from "./Tabs";
import { AdmissionBrief } from "./AdmissionTimeline";
import { QuickLabs } from "../drawers/QuickLabs";
import type { PathwayPart } from "../drawers/Wizard";
const WizardDrawer = lazy(() =>
  import("../drawers/Wizard").then((m) => ({ default: m.WizardDrawer })),
);
import type { CheckKind } from "../../shared/procedures";
import { ProcedureDrawer } from "../drawers/Procedure";
import { AddMedication, MedicationAction } from "../drawers/Medication";
import { AddPlan, PlanItem } from "../drawers/PlanDrawers";
import { AddEcho } from "../drawers/AddEcho";
import { AddStudy } from "../drawers/AddStudy";
import { Admission, Discharge, ClinicVisit } from "../drawers/Contexts";
import { PastAdmission } from "../drawers/PastAdmission";
import { ContextEdit } from "../drawers/ContextEdit";
import { AddDiagnosis } from "../drawers/NewPatient";
import { HistoryDrawer, IdentityDrawer } from "../drawers/History";
import {
  CorrectMedication,
  CorrectResult,
  VoidEntry,
} from "../drawers/Corrections";
import { AddMedications } from "../drawers/MedicationBatch";
import { EditDiagnosis } from "../drawers/Diagnosis";
import { HistoryTab } from "./History";
import { StatusDrawer } from "../drawers/Status";
const Pathways = lazy(() =>
  import("../drawers/Pathways").then((m) => ({ default: m.Pathways })),
);
import { DocumentsDrawer } from "../drawers/Documents";
import { AfterPci } from "../drawers/AfterPci";
import { ChecklistDrawer } from "../drawers/Checklist";

export type Open =
  | { kind: "labs"; codes?: string[] }
  | {
      kind: "wizard";
      wizard: string;
      recommendationId?: string;
      carried?: PathwayPart[];
      resume?: PathwayPart;
      ahead?: PathwayPart[];
    }
  | { kind: "med-add"; code?: string; dose?: number; reason?: string }
  | {
      kind: "med-action";
      medId: string;
      action?: string;
      dose?: number;
      reason?: string;
    }
  | { kind: "plan-add"; template?: string; medicationId?: string }
  | { kind: "plan-item"; planId: string }
  | { kind: "echo" }
  | { kind: "study"; studyKind?: string; initial?: Record<string, any> }
  | { kind: "admit" }
  | { kind: "past-admission" }
  | { kind: "discharge"; contextId: string }
  | { kind: "visit"; contextId?: string }
  | { kind: "context-edit"; context: any; remove?: boolean }
  | { kind: "dx" }
  | { kind: "dx-manage" }
  | { kind: "procedure-pick" }
  | {
      kind: "procedure";
      group?: "coronary" | "rhythm" | "valve" | "ph" | "hypertension" | "pericardial";
      procedureKind?: import("../../shared/procedures").ProcedureKind;
    }
  | { kind: "history"; focus?: "risk" | "cardiac" | "past" }
  | { kind: "identity"; identity: any }
  | { kind: "status" }
  | { kind: "pathways" }
  | { kind: "documents" }
  | { kind: "after-pci" }
  | { kind: "checklist"; check?: CheckKind }
  | { kind: "med-correct"; med: any; mode?: string }
  | { kind: "med-dose"; medId: string }
  | { kind: "med-batch" }
  | { kind: "dx-edit"; dx?: any; code?: string }
  | { kind: "result-correct"; result: any }
  | { kind: "void"; what: string; path: string };

const TABS = [
  ["summary", "Overview"],
  ["visits", "Admissions & visits"],
  ["history", "History"],
  ["journey", "Journey"],
  ["medications", "Medications"],
  ["investigations", "Investigations"],
  ["plan", "Plan & follow-up"],
  ["registries", "Registries"],
] as const;

const LEAD_FAMILIES = ["Heart failure", "Cardiomyopathy", "Pulmonary hypertension"];
export function PatientPage({ id, tab }: { id: string; tab: string }) {
  const { data: s, error, reload } = useData<any>(`/patients/${id}/summary`);
  const [open, setOpen] = useState<Open | null>(null);
  const [suspendedVisit, setSuspendedVisit] = useState<Extract<
    Open,
    { kind: "visit" }
  > | null>(null);
  const visitAction = (action: Open) => {
    if (open?.kind === "visit") setSuspendedVisit(open);
    setOpen(action);
  };
  const [nextSteps, setNextSteps] = useState<any[]>([]);
  const [showAllNext, setShowAllNext] = useState(false);
  const [version, setVersion] = useState(0);
  const toast = useToast();
  const done = useCallback(
    (message?: string, result?: any) => {
      setOpen(suspendedVisit);
      setSuspendedVisit(null);
      reload();
      setVersion((v) => v + 1);
      const created = result?.engine?.created ?? [];
      const entry =
        open &&
        [
          "labs",
          "echo",
          "study",
          "procedure",
          "med-add",
          "med-action",
          "med-batch",
          "dx",
          "dx-edit",
          "history",
          "result-correct",
          "admit",
        ].includes(open.kind);
      const actionable = created.filter(
        (c: any) =>
          c.action && !c.rule_id.startsWith("ops.") && c.action.type !== "tab",
      );
      const unique = triage(actionable).map(card => ({...card.lead,title:card.title,also:card.items.filter(item=>item.id!==card.lead.id)}));
      if (entry && unique.length) {
        setNextSteps(
          unique.sort(
            (a: any, b: any) =>
              ["red", "orange", "yellow", "blue"].indexOf(a.severity) -
              ["red", "orange", "yellow", "blue"].indexOf(b.severity),
          ),
        );
        setShowAllNext(false);
      }
      const red = created.find((c: any) => c.severity === "red") ?? created.find((c: any) => c.severity === "orange");
      if (red)
        toast({ text: `${message ?? "Saved"}. New alert: ${red.title}` });
      else if (message) toast({ text: message });
    },
    [reload, toast, suspendedVisit, open],
  );
  const close = useCallback(() => {
    setOpen(suspendedVisit);
    setSuspendedVisit(null);
  }, [suspendedVisit]);

  useEffect(() => { if(s?.header) setSampleMode(!!s.header.sample); }, [s?.header.id, s?.header.sample]);

  if (error)
    return (
      <main className="page">
        <div className="error-box">{error}</div>
      </main>
    );
  if (!s) return <main className="page" aria-busy="true" />;
  const h = s.header;
  // diagnoses only: risk factors (hypertension, diabetes, dyslipidaemia, obesity, CKD) have their own row
  const dxOnly = h.diagnoses.filter((d: any) => !d.riskFactor);
  // header line: cardiac diagnoses only — coronary disease as one IHD line with its history, non-cardiac
  // conditions on the risk-factor line (14 Oct 2026, Ahmed)
  const headDx = dxOnly.filter((d: any) => d.family !== "Comorbidity" && !(h.ihd && h.ihd.codes.includes(d.code)) && !(h.structural && h.structural.covers.includes(d.code)));
  const ctx = h.openContext;
  const redCount = triage(s.attention).filter((c) => c.lane === "act").length;
  return (
    <>
      <section
        className={`pt-head ${tab === "visits" && ctx?.kind === "admission" ? "admission-patient-head" : ""}`}
      >
        <Link to="/" className="pt-back">
          ‹ Worklist
        </Link>
        <div className="pt-top">
          <div className="pt-avatar">{initials(h.name)}</div>
          <div className="col" style={{ gap: 8, minWidth: 0 }}>
            <div className="pt-name">
              <h1>{h.name}</h1>
              <span className="id">
                {h.birthDateEstimated ? "~" : ""}
                {h.age} y · {h.sex} · MRN {h.mrn}
              </span>
              <button
                className="pt-edit"
                onClick={() =>
                  setOpen({
                    kind: "identity",
                    identity: {
                      name: h.name,
                      mrn: h.mrn,
                      sex: h.sex,
                      birthDate: h.birthDate,
                      birthDateEstimated: h.birthDateEstimated,
                      civilId: h.civilId,
                      nationality: h.nationality,
                      mobile: h.mobile,
                      allergies: h.allergies,
                      sample: h.sample,
                    },
                  })
                }
              >
                <Pencil size={14} /> Edit details
              </button>
              {h.sample && (
                <span className="chip sample-chip">
                  {tab === "visits" && ctx?.kind === "admission"
                    ? "Sample · synthetic"
                    : "Sample patient · synthetic"}
                </span>
              )}
              <span className={`chip ${h.deceased ? "deceased" : "gray"}`}>
                {h.where}
              </span>
              {h.readmission?.hfReadmission && h.readmission.days <= 30 && (
                <span className="chip sev sev-orange">
                  <span className="dot" />
                  HF readmission · day {h.readmission.days}
                </span>
              )}
              {h.status?.followUp &&
                h.status.followUp.status !== "active" &&
                !h.deceased && (
                  <span className="chip outline">
                    {
                      (
                        {
                          lost: "Lost to follow-up",
                          transferred: "Transferred care",
                          discharged_from_clinic: "Discharged from clinic",
                        } as any
                      )[h.status.followUp.status]
                    }
                  </span>
                )}
              {s.attention.length > 0 && (
                <span className={`chip sev sev-${s.attention[0].severity}`}>
                  <span className="dot" />
                  {s.attention.length} alert
                  {s.attention.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          <div className="pt-actions">
            {!h.deceased && (
              <button
                className="btn secondary"
                onClick={() => setOpen({ kind: "pathways" })}
              >
                <Route size={18} />
                Pathways
              </button>
            )}
            {tab !== "investigations" && (<button
              className="btn secondary"
              onClick={() => setOpen({ kind: "labs" })}
            >
              <FlaskConical size={18} />
              Add labs
            </button>)}
            <button
              className="btn secondary docs-phone"
              onClick={() => setOpen({ kind: "documents" })}
            >
              <FileText size={18} />
              Documents
            </button>
            {h.deceased ? (
              <button
                className="btn secondary"
                onClick={() => setOpen({ kind: "status" })}
              >
                Patient status
              </button>
            ) : ctx?.kind === "admission" ? (
              <button
                className="btn primary"
                onClick={() =>
                  setOpen({ kind: "discharge", contextId: ctx.id })
                }
              >
                <DischargeIcon size={18} />
                Discharge
              </button>
            ) : ctx?.kind === "clinic_visit" ? (
              <button
                className="btn primary"
                onClick={() => setOpen({ kind: "visit", contextId: ctx.id })}
              >
                <Stethoscope size={18} />
                Continue visit
              </button>
            ) : (
              <>
                <button
                  className="btn secondary"
                  onClick={() => setOpen({ kind: "admit" })}
                >
                  <BedDouble size={18} />
                  Admit
                </button>
                <button
                  className="btn primary"
                  onClick={() => setOpen({ kind: "visit" })}
                >
                  <Stethoscope size={18} />
                  Start clinic visit
                </button>
              </>
            )}
          </div>
        </div>
        <div className="patient-lines">
          <div className="patient-line diagnosis-line" aria-label="Diagnoses">
            <span className="line-label">Diagnoses</span>
            <div className="line-scroll">
              {/* heart failure / cardiomyopathy / PH first, then IHD with its history, then valve interventions,
                  LAA closure and devices, then the remaining cardiac diagnoses (19 Oct 2026) */}
              {[
                ...headDx.filter((d: any) => LEAD_FAMILIES.includes(d.family)).map((d: any) => ({ key: d.id, text: d.label.replace(" · EF", " EF"), title: undefined as string | undefined, click: () => setOpen({ kind: "dx-edit", dx: d }) })),
                ...(h.ihd ? [{ key: "ihd", text: h.ihd.label, title: h.ihd.events.map((e: any) => e.text).join("\n"), click: () => setOpen({ kind: "dx-manage" }) }] : []),
                ...(h.structural?.items ?? []).map((t: string, i: number) => ({ key: `st${i}`, text: t, title: undefined, click: () => setOpen({ kind: "dx-manage" }) })),
                ...headDx.filter((d: any) => !LEAD_FAMILIES.includes(d.family)).map((d: any) => ({ key: d.id, text: d.label.replace(" · EF", " EF"), title: undefined, click: () => setOpen({ kind: "dx-edit", dx: d }) })),
              ].map((x, i, all) => (
                <span key={x.key}>
                  <button className="line-text" title={x.title} onClick={x.click}>{x.text}</button>
                  {i < all.length - 1 && <span className="line-dot"> · </span>}
                </span>
              ))}
              {!headDx.length && !h.ihd && !h.structural && <span className="muted">Add diagnosis</span>}
            </div>
            <button
              className="record-icon"
              aria-label="Edit diagnoses"
              title="Edit diagnoses"
              onClick={() => setOpen({ kind: "dx-manage" })}
            >
              <Pencil size={16} />
            </button>
          </div>
          <RiskRow
            rf={h.riskFactors}
            onOpen={() => setOpen({ kind: "history", focus: "risk" })}
          />
          {h.allergies && h.allergies !== "Not recorded" && (
            <span className="patient-allergy">Allergies: {h.allergies}</span>
          )}
        </div>
        <nav
          className="tabs"
          aria-label="Patient sections"
          ref={(el) => {
            // keep the current tab visible when the bar scrolls sideways (phones), without moving the page
            const a = el?.querySelector<HTMLElement>('[aria-current="page"]');
            if (el && a)
              el.scrollLeft =
                a.offsetLeft - el.clientWidth / 2 + a.clientWidth / 2;
          }}
        >
          {TABS.map(([key, label]) => (
            <Link
              key={key}
              to={`/patients/${id}${key === "summary" ? "" : "/" + key}`}
              aria-current={tab === key ? "page" : undefined}
            >
              {label}
              {key === "summary" && redCount > 0 && (
                <span className="n">{redCount}</span>
              )}
            </Link>
          ))}
          <button
            className="tab-action"
            onClick={() => setOpen({ kind: "documents" })}
          >
            <FileText size={16} />
            Documents
          </button>
        </nav>
      </section>
      {s.attention.some((a: any) => a.rule_status !== "PUBLISHED") &&
        tab === "summary" && (
          <div className="sandbox-banner">
            <Tag sev="yellow">SANDBOX</Tag>
            Some alerts come from rules still in clinical review. They run here
            for testing only and never on a production site.
          </div>
        )}
      {tab === "summary" && <SummaryTab s={s} open={setOpen} done={done} />}
      {tab === "history" && (
        <HistoryTab id={id} version={version} open={setOpen} />
      )}
      {tab === "journey" && <JourneyTab id={id} version={version} />}
      {tab === "visits" && (
        <VisitsTab id={id} version={version} summary={s} open={setOpen} />
      )}
      {tab === "medications" && (
        <MedicationsTab id={id} version={version} open={setOpen} />
      )}
      {tab === "investigations" && (
        <InvestigationsTab
          id={id}
          version={version}
          open={setOpen}
          done={done}
        />
      )}
      {tab === "plan" && <PlanTab id={id} version={version} open={setOpen} />}
      {tab === "registries" && <RegistriesTab id={id} version={version} />}

      <DrawerWorkspace.Provider
        value={
          ctx?.kind === "admission" &&
          open &&
          [
            "labs",
            "med-add",
            "med-action",
            "med-batch",
            "plan-add",
            "discharge",
            "pathways",
            "wizard",
            "result-correct",
            "med-correct",
          ].includes(open.kind) ? (
            <AdmissionBrief
              id={id}
              contextId={ctx.id}
              header={h}
              attention={s.attention}
              version={version}
            />
          ) : null
        }
      >
        <Suspense
          fallback={
            open ? (
              <Drawer
                title="Loading action"
                subtitle={h.name}
                icon={<Route size={22} />}
                onClose={close}
              >
                <div className="drawer-body" role="status">
                  Loading…
                </div>
              </Drawer>
            ) : null
          }
        >
          {open?.kind === "labs" && (
            <QuickLabs
              patientId={id}
              codes={open.codes}
              contextId={ctx?.id}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "wizard" && (
            <WizardDrawer
              key={`${open.wizard}:${open.carried?.length ?? 0}`}
              patientId={id}
              patientName={h.name}
              wizard={open.wizard}
              recommendationId={
                open.resume?.recommendationId ?? open.recommendationId
              }
              contextId={ctx?.id}
              onClose={close}
              onDone={done}
              carried={open.carried}
              resume={open.resume}
              // going back keeps the later parts (answers, moved dates, override reasons) to return to them unchanged
              onJoin={(parts, next) => {
                const ahead = open.ahead ?? [];
                setOpen({
                  kind: "wizard",
                  wizard: next,
                  carried: parts,
                  resume: ahead[0]?.wizard === next ? ahead[0] : undefined,
                  ahead: ahead[0]?.wizard === next ? ahead.slice(1) : [],
                });
              }}
              onBack={(i, current) => {
                const c = open.carried ?? [];
                setOpen({
                  kind: "wizard",
                  wizard: c[i].wizard,
                  carried: c.slice(0, i),
                  resume: c[i],
                  ahead: [...c.slice(i + 1), current, ...(open.ahead ?? [])],
                });
              }}
            />
          )}
          {open?.kind === "med-add" && (
            <AddMedication
              patientId={id}
              summary={s}
              contextId={ctx?.id}
              preset={
                open.code
                  ? { code: open.code, dose: open.dose, reason: open.reason }
                  : undefined
              }
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "med-action" && (
            <MedicationAction
              patientId={id}
              summary={s}
              medId={open.medId}
              initial={open.action}
              initialDose={open.dose}
              initialReason={open.reason}
              contextId={ctx?.id}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "plan-add" && (
            <AddPlan
              patientId={id}
              template={open.template}
              medicationId={open.medicationId}
              contextId={ctx?.id}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "plan-item" && (
            <PlanItem
              patientId={id}
              planId={open.planId}
              onClose={close}
              onDone={done}
              open={setOpen}
            />
          )}
          {open?.kind === "echo" && (
            <AddEcho
              patientId={id}
              contextId={ctx?.id}
              summary={s}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "study" && (
            <AddStudy
              patientId={id}
              kind={open.studyKind}
              initial={open.initial}
              contextId={ctx?.id}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "admit" && (
            <Admission
              patientId={id}
              summary={s}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "past-admission" && (
            <PastAdmission patientId={id} today={s.today} onClose={close} onDone={done} />
          )}
          {open?.kind === "discharge" && (
            <Discharge
              patientId={id}
              summary={s}
              contextId={open.contextId}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "context-edit" && (
            <ContextEdit
              patientId={id}
              context={open.context}
              remove={open.remove}
              onClose={close}
              onDone={done}
            />
          )}
          {(open?.kind === "visit" || suspendedVisit) && (
            <ClinicVisit
              patientId={id}
              summary={s}
              contextId={
                (open?.kind === "visit" ? open : suspendedVisit)?.contextId
              }
              active={open?.kind === "visit" && !nextSteps.length}
              onClose={close}
              onDone={done}
              open={visitAction}
              onStarted={() => {
                reload();
                setVersion((v) => v + 1);
              }}
            />
          )}
          {open?.kind === "procedure-pick" && (
            <Drawer
              title="Add procedure"
              icon={<Route size={22} />}
              onClose={close}
            >
              <div className="drawer-body study-kinds">
                {(
                  [
                    {
                      group: "coronary",
                      label: "Coronary",
                      hint: "PCI · CABG",
                    },
                    {
                      group: "rhythm",
                      label: "Rhythm & devices",
                      hint: "Ablation · LAA closure · Device",
                    },
                    {
                      group: "valve",
                      label: "Structural & valve",
                      hint: "TAVI · TEER · Surgery",
                    },
                    {group:"pericardial",label:"Pericardial drainage",hint:"Pericardiocentesis · Surgical drainage"},
                    {
                      group: "hypertension",
                      label: "Renal denervation",
                      hint: "RDN procedure",
                    },
                    {
                      group: "ph",
                      label: "Pulmonary vascular",
                      hint: "Intervention",
                    },
                  ] as const
                ).map((p) => (
                  <button
                    className="study-kind"
                    key={p.group}
                    onClick={() =>
                      setOpen({ kind: "procedure", group: p.group })
                    }
                  >
                    <b>{p.label}</b>
                    <span>{p.hint}</span>
                  </button>
                ))}
              </div>
            </Drawer>
          )}
          {open?.kind === "procedure" && (
            <ProcedureDrawer
              patientId={id}
              contextId={ctx?.id}
              group={open.group ?? "coronary"}
              initialKind={open.procedureKind}
              onClose={close}
              onDone={done}
              onAfterPci={() => setOpen({ kind: "after-pci" })}
              onAfter={(w) => setOpen({ kind: "wizard", wizard: w })}
            />
          )}
          {open?.kind === "dx-manage" && (
            <Drawer
              title="Diagnoses"
              icon={<Pencil size={22} />}
              onClose={close}
              footer={
                <button
                  className="btn primary"
                  onClick={() => setOpen({ kind: "dx" })}
                >
                  <Plus size={16} /> Add diagnosis
                </button>
              }
            >
              <div className="drawer-body diagnosis-picker">
                {dxOnly.map((d: any) => (
                  <button
                    className="study-kind"
                    key={d.id}
                    onClick={() => setOpen({ kind: "dx-edit", dx: d })}
                  >
                    <b>{d.label}</b>
                    <Pencil size={16} />
                  </button>
                ))}
              </div>
            </Drawer>
          )}
          {open?.kind === "dx" && (
            <AddDiagnosis
              patientId={id}
              existing={h.diagnoses.map((d: any) => d.code)}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "history" && (
            <HistoryDrawer
              patientId={id}
              focus={open.focus}
              summary={s}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "identity" && (
            <IdentityDrawer
              patientId={id}
              identity={open.identity}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "pathways" && (
            <Pathways
              summary={s}
              onClose={close}
              onPick={(w) =>
                setOpen({
                  kind: "wizard",
                  wizard: w,
                  recommendationId: s.attention.find(
                    (a: any) =>
                      a.action?.type === "wizard" && a.action.wizard === w,
                  )?.id,
                })
              }
              onChecklist={(c) => setOpen({ kind: "checklist", check: c })}
            />
          )}
          {open?.kind === "after-pci" && (
            <AfterPci
              patientId={id}
              contextId={ctx?.id}
              onClose={close}
              onDone={done}
              onBundle={() =>
                setOpen({ kind: "wizard", wizard: "acs-discharge" })
              }
            />
          )}
          {open?.kind === "checklist" && (
            <ChecklistDrawer
              patientId={id}
              initial={open.check}
              onClose={close}
              open={setOpen}
            />
          )}
          {open?.kind === "documents" && (
            <DocumentsDrawer patientId={id} onClose={close} />
          )}
          {open?.kind === "dx-edit" &&
            (open.dx ?? h.diagnoses.find((d: any) => d.code === open.code)) && (
              <EditDiagnosis
                patientId={id}
                dx={
                  open.dx ?? h.diagnoses.find((d: any) => d.code === open.code)
                }
                onClose={close}
                onDone={done}
              />
            )}
          {open?.kind === "med-batch" && (
            <AddMedications
              patientId={id}
              summary={s}
              contextId={ctx?.id}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "med-dose" && <AddMissingDose patientId={id} medId={open.medId} today={s.today} onClose={close} onDone={done} />}
          {open?.kind === "med-correct" && (
            <CorrectMedication
              patientId={id}
              med={open.med}
              initialMode={open.mode}
              today={s.today}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "result-correct" && (
            <CorrectResult
              patientId={id}
              result={open.result}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "void" && (
            <VoidEntry
              patientId={id}
              what={open.what}
              path={open.path}
              onClose={close}
              onDone={done}
            />
          )}
          {open?.kind === "status" && (
            <StatusDrawer
              patientId={id}
              today={s.today}
              current={h.status}
              onClose={close}
              onDone={done}
            />
          )}
        </Suspense>
        {nextSteps.length > 0 && (
          <Drawer
            title="Results → next steps"
            subtitle={`${nextSteps.length} new suggestion${nextSteps.length === 1 ? "" : "s"} · review and confirm`}
            icon={<Route size={22} />}
            onClose={() => setNextSteps([])}
            footer={
              <button
                className="btn secondary"
                onClick={() => setNextSteps([])}
              >
                Continue data entry
              </button>
            }
          >
            <div className="drawer-body next-step-list">
              {(showAllNext ? nextSteps : nextSteps.slice(0, 3)).map((a) => (
                <section
                  key={a.id}
                  className={`next-step-card sev-${a.severity}`}
                >
                  <Tag sev={a.severity}>
                    {a.severity === "red" ? "Urgent" : "Suggested"}
                  </Tag>
                  <h3>{a.title}</h3>
                  <p>{a.detail}</p>
                  <div className="next-step-actions">{[a,...(a.also ?? [])].map(item=><ActionButton key={item.id} a={item} open={action=>{setNextSteps([]);visitAction(action);}} />)}</div>
                  <details className="next-step-why">
                    <summary>Why?</summary>
                    <WhyPanel a={a} />
                  </details>
                </section>
              ))}
              {!showAllNext && nextSteps.length > 3 && (
                <button
                  className="btn ghost"
                  onClick={() => setShowAllNext(true)}
                >
                  Show {nextSteps.length - 3} more suggestions
                </button>
              )}
            </div>
          </Drawer>
        )}
      </DrawerWorkspace.Provider>
    </>
  );
}

function RiskRow({ rf, onOpen }: { rf: any; onOpen(): void }) {
  if (!rf) return null;
  return (
    <div className="patient-line risk-line" aria-label="Risk factors">
      <span className="line-label">{(rf.other ?? []).length ? "Risk factors & other" : "Risk factors"}</span>
      <div className="line-scroll">
        {rf.present.map((p: any, i: number) => (
          <span key={p.key}>
            {i > 0 && <span className="line-dot"> · </span>}
            <button
              className={`line-text ${p.conflict ? "conflict" : ""}`}
              onClick={onOpen}
              title={p.conflict ? "Records disagree: reconcile" : undefined}
            >
              {p.label}
            </button>
          </span>
        ))}
        {rf.present.length === 0 && !(rf.other ?? []).length && <span className="muted">—</span>}
        {(rf.other ?? []).map((o: any, i: number) => (
          <span key={o.id}>
            {(i > 0 || rf.present.length > 0) && <span className="line-dot"> · </span>}
            <button className="line-text other" onClick={onOpen} title={o.brief || undefined}>
              {o.label}{o.brief ? <small> ({o.brief})</small> : null}
            </button>
          </span>
        ))}
      </div>
      <button
        className="record-icon"
        aria-label="Edit risk factors"
        title="Edit risk factors"
        onClick={onOpen}
      >
        <Pencil size={16} />
      </button>
    </div>
  );
}

// A medicine recorded without a dose (14 Oct 2026, Ahmed): the overview opens the correction with the dose
// to add; the full medicine (with its events) comes from the record.
function AddMissingDose({ patientId, medId, today, onClose, onDone }: { patientId: string; medId: string; today: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data } = useData<any>(`/patients/${patientId}/record`);
  const med = data?.meds?.find((m: any) => m.id === medId);
  if (!med) return null;
  return <CorrectMedication patientId={patientId} med={med} initialMode="fix" today={today} onClose={onClose} onDone={onDone} />;
}
