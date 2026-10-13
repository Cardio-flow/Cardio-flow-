import { useEffect, useRef, useState } from "react";
import { api, HttpError } from "./api";

const keyFor = (value: any): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k) => v[k] !== undefined)
            .map((k) => [k, v[k]]),
        )
      : v,
  );
type Conflict = { kind: "draft" | "record"; latest?: any };

// Current form intent always wins over an older queued/in-flight save. Conflicting
// drafts are replaced only after an explicit clinician choice.
export function useEntryDraft(
  patientId: string,
  scope: string | null,
  answers: Record<string, unknown>,
  restore: (answers: any, snapshot?: any) => void,
  ready = true,
) {
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState<Conflict | null>(null);
  const [status, setStatus] = useState("Restoring draft…"),
    [revision, setRevision] = useState(0);
  const version = useRef(0),
    baseline = useRef(""),
    pending = useRef<any>(null),
    latest = useRef(answers);
  latest.current = answers;
  const request = useRef<Promise<any> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false),
    isLoaded = useRef(false),
    blocked = useRef<Conflict | null>(null),
    restoreRef = useRef(restore);
  restoreRef.current = restore;
  const key = keyFor(answers),
    path = scope ? `/patients/${patientId}/entry-draft/${scope}` : null;
  function setBlocked(next: Conflict | null) {
    blocked.current = next;
    setConflict(next);
  }
  function install(d: any, body = d.answers) {
    version.current = d.version;
    if (body) {
      latest.current = body;
      restoreRef.current(body, d);
    }
    baseline.current = keyFor(body ?? latest.current);
    pending.current = null;
    setBlocked(d.recordChanged ? { kind: "record", latest: d } : null);
    setError("");
    setStatus("Draft saved");
    isLoaded.current = true;
    setLoaded(true);
  }
  async function refreshConflict(kind: "draft" | "record" = "record") {
    setBlocked({ kind });
    if (timer.current) clearTimeout(timer.current);
    if (!path) return;
    try {
      const d = await api(path);
      if (!stopped.current) setBlocked({ kind, latest: d });
    } catch (e) {
      if (!stopped.current) setError((e as Error).message);
    }
  }
  const flushTask = useRef<Promise<void> | null>(null);
  async function flush() {
    if (flushTask.current) return flushTask.current;
    const task = performFlush();
    flushTask.current = task;
    try {
      await task;
    } finally {
      if (flushTask.current === task) flushTask.current = null;
    }
  }
  async function performFlush(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    if (!path || stopped.current || !isLoaded.current) return;
    if (blocked.current)
      throw new HttpError(
        409,
        "Review the changed draft or readings before saving.",
      );
    await request.current;
    const body = latest.current;
    if (keyFor(body) === baseline.current) {
      pending.current = null;
      return;
    }
    pending.current = null;
    setStatus("Saving draft…");
    const req = api(path, {
      body: { version: version.current, answers: body },
    });
    request.current = req;
    try {
      const d = await req;
      version.current = d.version;
      baseline.current = keyFor(body);
      if (!stopped.current) {
        setError("");
        setStatus(
          keyFor(latest.current) === baseline.current
            ? "Draft saved"
            : "Unsaved entries",
        );
      }
    } catch (e) {
      pending.current = latest.current;
      if (!stopped.current) {
        if ((e as any).status === 409) await refreshConflict("draft");
        else setError(`Draft not saved: ${(e as Error).message}`);
      }
      throw e;
    } finally {
      request.current = null;
    }
    if (!stopped.current && keyFor(latest.current) !== baseline.current)
      await performFlush();
  }
  useEffect(() => {
    if (!path || !ready) return;
    let live = true;
    stopped.current = false;
    isLoaded.current = false;
    setLoaded(false);
    api(path)
      .then((d) => {
        if (live) install(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [path, ready]);
  useEffect(() => {
    if (!loaded || stopped.current || blocked.current) return;
    // Reverting to the baseline cancels a queued change. If its request is already
    // in flight, flush will compare the latest intent after that request settles.
    pending.current =
      key === baseline.current && !request.current ? null : answers;
    if (!pending.current) {
      setStatus("Draft saved");
      return;
    }
    setStatus("Unsaved entries");
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, loaded, revision]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current || request.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (!blocked.current) void flush().catch(() => {});
    };
  }, [path]);
  async function resolve(keepEdits: boolean) {
    if (!path) return;
    try {
      const kind = blocked.current?.kind;
      const d = await api(path);
      const body = keepEdits
        ? {
            ...latest.current,
            ...(d.latestAnswers
              ? {
                  baseline: d.latestAnswers.baseline,
                  baselineValues: d.latestAnswers.baselineValues,
                }
              : {}),
          }
        : kind === "record"
          ? d.latestAnswers
          : d.answers;
      install(
        {
          ...d,
          recordChanged: !keepEdits && kind !== "record" && d.recordChanged,
        },
        body,
      );
      // A kept edit is a deliberate replacement of the saved draft, not an
      // automatic retry against a newer version.
      if (keepEdits) baseline.current = keyFor(d.answers ?? {});
      if (!keepEdits && kind === "record")
        baseline.current = keyFor(d.answers ?? {});
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function complete() {
    stopped.current = true;
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
  }
  function confirmed(body: any, nextVersion: number) {
    install({ version: nextVersion, answers: body, latestAnswers: body });
  }
  return {
    loaded: loaded || !scope,
    error,
    conflict,
    status,
    flush,
    complete,
    confirmed,
    refreshConflict,
    getVersion: () => version.current,
    useSaved: () => resolve(false),
    keepEdits: () => resolve(true),
  };
}
