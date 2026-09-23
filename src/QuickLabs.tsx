import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, currentDate, useData } from "./api";
import type { CareEncounter } from "./care-model";
import type { LabDefinition } from "./medication-laboratory";
import { ErrorBox, Loading, Modal } from "./ui";

type LabRow = { key: string; testId: string; value: string; unit: string };
const row = (testId = "", unit = ""): LabRow => ({
  key: crypto.randomUUID(),
  testId,
  value: "",
  unit,
});
const presets: Record<string, string[]> = {
  "Renal profile": ["creatinine", "sodium", "potassium", "urea"],
  "HF monitoring": ["creatinine", "potassium", "sodium", "nt-probnp"],
  Lipids: ["ldl-c", "hdl-c", "triglycerides", "total-cholesterol"],
  "Anaemia / iron": ["haemoglobin", "ferritin", "transferrin-saturation"],
  Anticoagulation: ["inr", "haemoglobin", "creatinine"],
};

function preferredUnit(test: LabDefinition): string {
  const local: Record<string, string> = {
    creatinine: "µmol/L",
    haemoglobin: "g/L",
  };
  const preferred = local[test.test_id];
  return preferred && test.accepted_units.includes(preferred)
    ? preferred
    : test.canonical_unit;
}

export function QuickLabs({
  patientId,
  encounters,
  onClose,
  onSaved,
  onPartialSaved,
}: {
  patientId: string;
  encounters: CareEncounter[];
  onClose: () => void;
  onSaved: () => void;
  onPartialSaved?: () => void;
}) {
  const { data, error: loadError } = useData<{ tests: LabDefinition[] }>(
    "/laboratory/catalog",
  );
  const [rows, setRows] = useState<LabRow[]>([row()]);
  const [resultDate, setResultDate] = useState(currentDate());
  const [encounterId, setEncounterId] = useState(
    encounters.find((item) => item.state === "open")?.id ?? "",
  );
  const [verification, setVerification] = useState("unconfirmed");
  const [source, setSource] = useState("Clinician-entered result");
  const [lab, setLab] = useState("");
  const [specimen, setSpecimen] = useState("");
  const [assay, setAssay] = useState("");
  const [referenceHigh, setReferenceHigh] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const tests = (data?.tests ?? []).filter(
    (test) =>
      !["egfr-ckd-epi-2021", "crcl-cockcroft-gault"].includes(test.test_id),
  );
  const available = (id: string) => tests.find((test) => test.test_id === id);
  const update = (key: string, patch: Partial<LabRow>) =>
    setRows((items) =>
      items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  const addPreset = (name: string) => {
    if (!data) return;
    const existing = new Set(rows.map((item) => item.testId));
    const added = presets[name]
      .filter((id) => !existing.has(id))
      .map((id) => available(id))
      .filter((test): test is LabDefinition => !!test)
      .map((test) => row(test.test_id, preferredUnit(test)));
    setRows((items) => [
      ...items.filter((item) => item.testId || item.value),
      ...added,
    ]);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !rows.length ||
      rows.some((item) => !item.testId || item.value === "")
    ) {
      setError("Choose a test and enter a result for each row.");
      return;
    }
    setBusy(true);
    setError("");
    let completed = 0;
    try {
      for (const item of rows) {
        const test = available(item.testId);
        if (!test) throw new Error(`Unknown test: ${item.testId}`);
        const at = new Date(`${resultDate}T12:00:00`).toISOString();
        await api(`/patients/${patientId}/laboratory`, {
          test_id: item.testId,
          value: Number(item.value),
          unit: item.unit || preferredUnit(test),
          specimen: specimen || null,
          collected_at: at,
          resulted_at: at,
          source_type: "clinician",
          source_id: `manual-${crypto.randomUUID()}`,
          source_label: source,
          laboratory_name: lab || null,
          reference_high:
            item.testId.startsWith("hs-troponin") && referenceHigh
              ? Number(referenceHigh)
              : null,
          abnormal_flag: null,
          verification_status: verification,
          provenance: {
            entryMethod: "clinician_quick_entry",
            ...(item.testId.startsWith("hs-troponin") && assay
              ? { assay }
              : {}),
          },
          encounter_id: encounterId || null,
        });
        completed++;
        setSavedCount((count) => count + 1);
        setRows((items) =>
          items.filter((candidate) => candidate.key !== item.key),
        );
      }
      onSaved();
    } catch (caught) {
      if (completed) onPartialSaved?.();
      setError(
        `${completed ? `${completed} result${completed === 1 ? "" : "s"} saved. ` : ""}${(caught as Error).message} Remaining rows have not been saved.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add labs" onClose={onClose} wide>
      <ErrorBox message={error || loadError} />
      {!data ? (
        <Loading />
      ) : (
        <form className="quick-labs" onSubmit={submit}>
          <div className="quick-lab-heading">
            <div>
              <h3>Results</h3>
              <p>Enter one result or several from the same date.</p>
            </div>
            <label>
              Result date
              <input
                aria-label="Result date"
                type="date"
                value={resultDate}
                max={currentDate()}
                onChange={(event) => setResultDate(event.target.value)}
                required
              />
            </label>
          </div>
          <div className="quick-lab-presets" aria-label="Lab groups">
            {Object.keys(presets).map((name) => (
              <button
                key={name}
                type="button"
                className="secondary"
                onClick={() => addPreset(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="quick-lab-rows">
            {rows.map((item, index) => {
              const test = available(item.testId);
              return (
                <div className="quick-lab-row" key={item.key}>
                  <label>
                    Test
                    <select
                      aria-label={
                        rows.length === 1 ? "Test" : `Test ${index + 1}`
                      }
                      value={item.testId}
                      required
                      onChange={(event) => {
                        const next = available(event.target.value);
                        update(item.key, {
                          testId: event.target.value,
                          unit: next ? preferredUnit(next) : "",
                        });
                      }}
                    >
                      <option value="">Choose test</option>
                      {[...new Set(tests.map((entry) => entry.category))].map(
                        (category) => (
                          <optgroup key={category} label={category}>
                            {tests
                              .filter((entry) => entry.category === category)
                              .map((entry) => (
                                <option
                                  key={entry.test_id}
                                  value={entry.test_id}
                                >
                                  {entry.display}
                                </option>
                              ))}
                          </optgroup>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Result
                    <input
                      aria-label={
                        rows.length === 1 ? "Result" : `Result ${index + 1}`
                      }
                      type="number"
                      step="any"
                      value={item.value}
                      required
                      onChange={(event) =>
                        update(item.key, { value: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      aria-label={
                        rows.length === 1 ? "Unit" : `Unit ${index + 1}`
                      }
                      value={item.unit}
                      onChange={(event) =>
                        update(item.key, { unit: event.target.value })
                      }
                      disabled={!test}
                    >
                      {(test?.accepted_units ?? []).map((unit) => (
                        <option key={unit}>{unit}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove result ${index + 1}`}
                    disabled={rows.length === 1}
                    onClick={() =>
                      setRows((items) =>
                        items.filter((candidate) => candidate.key !== item.key),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => setRows((items) => [...items, row()])}
          >
            <Plus size={16} /> Add another result
          </button>
          <details className="quick-lab-advanced">
            <summary>Advanced details</summary>
            <p>
              Unconfirmed is the default for manually entered results. Mark
              verified only after checking the source report.
            </p>
            <div className="form-grid compact-form">
              <label>
                Verification
                <select
                  value={verification}
                  onChange={(event) => setVerification(event.target.value)}
                >
                  <option value="unconfirmed">Unconfirmed</option>
                  <option value="preliminary">Preliminary</option>
                  <option value="verified">Verified against source</option>
                </select>
              </label>
              <label>
                Source
                <input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  required
                />
              </label>
              <label>
                Laboratory
                <input
                  value={lab}
                  onChange={(event) => setLab(event.target.value)}
                />
              </label>
              <label>
                Specimen
                <input
                  value={specimen}
                  onChange={(event) => setSpecimen(event.target.value)}
                />
              </label>
              <label>
                Care context
                <select
                  value={encounterId}
                  onChange={(event) => setEncounterId(event.target.value)}
                >
                  <option value="">Continuing record</option>
                  {encounters.map((encounter) => (
                    <option key={encounter.id} value={encounter.id}>
                      {encounter.kind} · {encounter.reason}
                    </option>
                  ))}
                </select>
              </label>
              {rows.some((item) => item.testId.startsWith("hs-troponin")) ? (
                <>
                  <label>
                    Assay / platform
                    <input
                      value={assay}
                      onChange={(event) => setAssay(event.target.value)}
                    />
                  </label>
                  <label>
                    Assay-specific upper reference limit (ng/L)
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={referenceHigh}
                      onChange={(event) => setReferenceHigh(event.target.value)}
                    />
                  </label>
                </>
              ) : null}
            </div>
          </details>
          {savedCount ? (
            <p role="status">
              {savedCount} result{savedCount === 1 ? "" : "s"} saved.
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy || !rows.length}>
              {busy
                ? "Saving…"
                : rows.length === 1
                  ? "Save result"
                  : `Save ${rows.length} results`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
