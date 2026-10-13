import { useState } from "react";
import { BedDouble } from "lucide-react";
import { api } from "../api";
import { Drawer, DateInput, MultiChoice, SingleChoice } from "../ui";
import { useEntryDraft } from "../useEntryDraft";
import { EntryDraftStatus } from "../EntryDraftStatus";
import {
  emptyPastAdmission,
  ADMISSION_HISTORY_SOURCES,
  type PastAdmissionAnswers,
} from "../../shared/admission-history";
import {
  ADMISSION_REASONS,
  IN_HOSPITAL_EVENTS,
  DISCHARGE_CONDITION,
  DISCHARGE_DESTINATION,
} from "../../shared/encounters";
const options = (list: readonly string[]) =>
  list.map((value) => ({ value, label: value }));
export function PastAdmission({
  patientId,
  today,
  onClose,
  onDone,
}: {
  patientId: string;
  today: string;
  onClose(): void;
  onDone(m?: string, r?: any): void;
}) {
  const [form, setForm] = useState<PastAdmissionAnswers>(emptyPastAdmission),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key: keyof PastAdmissionAnswers, value: any) =>
    setForm((old) => ({ ...old, [key]: value }));
  const draft = useEntryDraft(
    patientId,
    "past-admission",
    form as unknown as Record<string, unknown>,
    (d) => setForm({ ...emptyPastAdmission(), ...d, location: "" }),
  );
  const valid =
    draft.loaded &&
    !draft.conflict &&
    form.startedOn &&
    form.endedOn &&
    form.startedOn <= form.endedOn &&
    form.endedOn <= today &&
    form.reasons.length > 0 &&
    form.source;
  const discard = () => {
    draft.complete();
    onClose();
  };
  async function close() {
    if (busy) return;
    if (draft.conflict) {
      if (
        window.confirm(
          "Close without saving this window's edits? The saved draft will be kept.",
        )
      )
        discard();
      return;
    }
    try {
      await draft.flush();
      onClose();
    } catch (e) {
      if (!draft.conflict) setError((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await draft.flush();
      const r = await api(`/patients/${patientId}/admissions/history`, {
        body: { ...form, draftVersion: draft.getVersion() },
      });
      draft.complete();
      onDone("Past admission recorded", r);
    } catch (e) {
      if ((e as any).code === "entry_draft_changed")
        await draft.refreshConflict("draft");
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const text = (key: keyof PastAdmissionAnswers, label: string, rows = 3) => (
    <label className="field">
      <span>{label}</span>
      <textarea
        className="input"
        aria-label={label}
        rows={rows}
        maxLength={key === "note" ? 64000 : 4000}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  return (
    <Drawer
      title="Record past admission"
      subtitle="A closed admission from the patient's history"
      icon={<BedDouble size={22} />}
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid || busy}
            onClick={save}
          >
            {busy ? "Saving…" : "Save past admission"}
          </button>
        </>
      }
    >
      <fieldset
        className="drawer-body"
        disabled={!draft.loaded || busy}
        style={{ border: 0, margin: 0 }}
      >
        <EntryDraftStatus draft={draft} onDiscard={discard} />
        {error && !draft.conflict && !draft.error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="row wrap" style={{ gap: 16 }}>
          <label className="field">
            <span>Admission date</span>
            <DateInput
              aria-label="Admission date"
              value={form.startedOn}
              onChange={(e) => set("startedOn", e.target.value)}
              max={today}
            />
          </label>
          <label className="field">
            <span>Discharge date</span>
            <DateInput
              aria-label="Discharge date"
              value={form.endedOn}
              onChange={(e) => set("endedOn", e.target.value)}
              min={form.startedOn || undefined}
              max={today}
            />
          </label>
        </div>
        {form.startedOn && form.endedOn && form.endedOn < form.startedOn && (
          <div className="error-box">
            Discharge must be on or after admission.
          </div>
        )}
        <label className="field">
          <span>Source</span>
          <select
            className="input"
            aria-label="Source"
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
          >
            <option value="">Choose source</option>
            {ADMISSION_HISTORY_SOURCES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <div className="q">
          <div className="label">Reason for admission</div>
          <MultiChoice
            options={options(ADMISSION_REASONS)}
            value={form.reasons}
            onChange={(x) => set("reasons", x)}
          />
        </div>
        {text("note", "Discharge summary (optional)")}
        <details
          className="card pad"
          style={{ background: "var(--surface-2)" }}
        >
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>
            Events & admission details
          </summary>
          <div className="stack" style={{ marginTop: 16 }}>
            {text("narrative", "Admission history")}
            <div className="q">
              <div className="label">In-hospital events</div>
              <MultiChoice
                options={options(IN_HOSPITAL_EVENTS)}
                value={form.events}
                onChange={(x) =>
                  set(
                    "events",
                    x.includes("None") && !form.events.includes("None")
                      ? ["None"]
                      : x.filter((e) => e !== "None"),
                  )
                }
              />
            </div>
            <div className="q">
              <div className="label">Condition at discharge</div>
              <SingleChoice
                label="Condition at discharge"
                options={options(DISCHARGE_CONDITION)}
                value={form.dischargeStatus}
                onChange={(x) => set("dischargeStatus", x)}
              />
            </div>
            <div className="q">
              <div className="label">Destination</div>
              <SingleChoice
                label="Destination"
                options={options(DISCHARGE_DESTINATION)}
                value={form.destination}
                onChange={(x) => set("destination", x)}
              />
            </div>
          </div>
        </details>
        <details
          className="card pad"
          style={{ background: "var(--surface-2)" }}
        >
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>
            Historical labs & medicines
          </summary>
          <div className="stack" style={{ marginTop: 16 }}>
            {text("reportedLabs", "Labs during admission (reported)")}
            {text("reportedMedications", "Medicines at discharge (historical)")}
          </div>
        </details>
      </fieldset>
    </Drawer>
  );
}
