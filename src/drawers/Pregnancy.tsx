import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { api, useData } from "../api";
import { DateInput, Drawer, MultiChoice, SingleChoice } from "../ui";
import {
  cleanPregnancy,
  PREGNANCY_FIELDS,
  pregnancyFieldShown,
  type PregnancyField,
} from "../../shared/pregnancy";

export function PregnancyFields({
  value,
  onChange,
}: {
  value: Record<string, any>;
  onChange(value: Record<string, any>): void;
}) {
  const render = (f: PregnancyField) =>
    !pregnancyFieldShown(f, value) ? null : (
      <div
        className="q"
        key={f.key}
        role={f.type === "multi" ? "group" : undefined}
        aria-label={f.type === "multi" ? f.label : undefined}
      >
        {f.type === "date" ? (
          <label className="field">
            <span>{f.label}</span>
            <DateInput
              className="input"
              aria-label={f.label}
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
          </label>
        ) : f.type === "number" ? (
          <label className="field">
            <span>{f.label}</span>
            <input
              className="input"
              inputMode="decimal"
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
          </label>
        ) : (
          <>
            <div className="label">{f.label}</div>
            {f.type === "multi" ? (
              <MultiChoice
                options={f.options!.map((v) => ({ value: v, label: v }))}
                value={value[f.key] ?? []}
                onChange={(v) => onChange({ ...value, [f.key]: v })}
              />
            ) : (
              <SingleChoice
                label={f.label}
                options={f.options!.map((v) => ({
                  value: v,
                  label:
                    v === "Follow-up complete"
                      ? "Not pregnant; postpartum follow-up complete"
                      : v,
                }))}
                value={value[f.key]}
                onChange={(v) => onChange({ ...value, [f.key]: v })}
              />
            )}
          </>
        )}
      </div>
    );
  return (
    <div className="pregnancy-fields">
      {PREGNANCY_FIELDS.filter((f) =>
        ["phase", "edd", "deliveredOn", "breastfeeding", "mwho"].includes(
          f.key,
        ),
      ).map(render)}
      <details className="pregnancy-extra">
        <summary>Symptoms and assessment date</summary>
        {PREGNANCY_FIELDS.filter((f) =>
          ["assessedOn", "symptoms"].includes(f.key),
        ).map(render)}
        {value.assessedOn && (
          <p className="small muted">
            Recorded assessment:{" "}
            {String(value.assessedOn).split("-").reverse().join("/")}
          </p>
        )}
      </details>
      {["Planning pregnancy", "Pregnant"].includes(value.phase) && (
        <details className="pregnancy-extra">
          <summary>Additional pre-eclampsia risks</summary>
          {PREGNANCY_FIELDS.filter((f) =>
            ["highRisks", "moderateRisks", "bookingBmi"].includes(f.key),
          ).map(render)}
          <p className="small muted">
            Existing hypertension, CKD and diabetes are read from the record.
          </p>
        </details>
      )}
    </div>
  );
}
export function PregnancyContextDrawer({
  patientId,
  onClose,
  onDone,
}: {
  patientId: string;
  onClose(): void;
  onDone(message?: string, result?: any): void;
}) {
  const { data: record, error: loadError } = useData<any>(
    `/patients/${patientId}/record`,
  );
  const { data: health } = useData<any>("/health");
  const existing = record?.conditions.find(
    (c: any) => c.code === "pregnancy-care",
  );
  const [value, setValue] = useState<Record<string, any> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (record && !value) setValue({ ...existing?.attributes });
  let problem = "";
  if (value)
    try {
      cleanPregnancy(value, health?.today);
    } catch (e) {
      problem = (e as Error).message;
    }
  const save = async () => {
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      const attributes = cleanPregnancy(value, health?.today);
      const r = await api(`/patients/${patientId}/history`, {
        body: existing
          ? {
              update: [
                {
                  logicalId: existing.logical_id,
                  onset: existing.onset,
                  onsetYear: existing.attributes?.onsetYear ?? null,
                  attributes,
                },
              ],
            }
          : { add: [{ code: "pregnancy-care", attributes }] },
      });
      onDone("Pregnancy context saved", r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Drawer
      title="Pregnancy context"
      subtitle="Dated clinical context for the shared cardiac care plan."
      icon={<HeartPulse size={22} />}
      onClose={onClose}
      footer={
        <>
          <span className="note">{problem}</span>
          <span className="end">
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={
                !value?.phase || !health || !!problem || busy || !record
              }
              onClick={save}
            >
              {busy ? "Saving…" : "Save pregnancy context"}
            </button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        {value ? (
          <PregnancyFields value={value} onChange={setValue} />
        ) : (
          <p className="muted">Loading context…</p>
        )}
        {(error || loadError) && (
          <div className="error-box" role="alert">
            {error || loadError}
          </div>
        )}
      </div>
    </Drawer>
  );
}
