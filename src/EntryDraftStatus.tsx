import type { useEntryDraft } from "./useEntryDraft";
export function EntryDraftStatus({
  draft,
  onDiscard,
  showStatus = false,
}: {
  draft: ReturnType<typeof useEntryDraft>;
  onDiscard(): void;
  showStatus?: boolean;
}) {
  if (draft.conflict)
    return (
      <div className="infobox warn" role="alert" style={{ display: "block" }}>
        <p style={{ margin: "0 0 10px" }}>
          {draft.conflict.kind === "record"
            ? "New readings are available. Review before saving."
            : "Draft changed in another window."}
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void draft.useSaved()}
          >
            {draft.conflict.kind === "record"
              ? "Use latest readings"
              : "Use saved draft"}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void draft.keepEdits()}
          >
            Keep my edits
          </button>
          <button type="button" className="btn ghost" onClick={onDiscard}>
            Close without saving
          </button>
        </div>
      </div>
    );
  if (draft.error)
    return (
      <div className="error-box" role="alert">
        {draft.error}
      </div>
    );
  return showStatus ? (
    <div className="help" role="status">
      {draft.loaded ? draft.status : "Restoring draft…"}
    </div>
  ) : null;
}
