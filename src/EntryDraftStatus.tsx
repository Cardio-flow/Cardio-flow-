import type { useEntryDraft } from "./useEntryDraft";
export function EntryDraftStatus({
  draft,
  onDiscard,
  showStatus = false,
  label = "Draft",
  savedLabel = "Use saved draft",
  onViewClosed,
}: {
  draft: ReturnType<typeof useEntryDraft>;
  onDiscard(): void;
  showStatus?: boolean;
  label?: string;
  savedLabel?: string;
  onViewClosed?(): void;
}) {
  if (draft.conflict?.kind === "closed")
    return (
      <div className="infobox warn" role="alert" style={{ display: "block" }}>
        <p style={{ margin: "0 0 10px" }}>
          {draft.conflict.message ??
            "This visit is no longer open. Your local edits have not been saved."}
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          {onViewClosed && (
            <button
              className="btn secondary"
              type="button"
              onClick={onViewClosed}
            >
              View saved visit
            </button>
          )}
          <button className="btn ghost" type="button" onClick={onDiscard}>
            Close without saving
          </button>
        </div>
      </div>
    );
  if (draft.conflict)
    return (
      <div className="infobox warn" role="alert" style={{ display: "block" }}>
        <p style={{ margin: "0 0 10px" }}>
          {draft.conflict.kind === "record"
            ? "New readings are available. Review before saving."
            : `${label} changed in another window.`}
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void draft.useSaved()}
          >
            {draft.conflict.kind === "record"
              ? "Use latest readings"
              : savedLabel}
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
