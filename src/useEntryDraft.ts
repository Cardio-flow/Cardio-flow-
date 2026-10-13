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
type Conflict = {
  kind: "draft" | "record" | "closed";
  latest?: any;
  message?: string;
};

// Current form intent always wins over an older queued/in-flight save. Conflicting
// drafts are replaced only after an explicit clinician choice.
export function useEntryDraft(
  patientId: string,
  scope: string | null,
  answers: Record<string, unknown>,
  restore: (answers: any, snapshot?: any) => void,
  ready = true,
  transport?: { path: string | null; flat: true },
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
    path = transport
      ? transport.path
      : scope
        ? `/patients/${patientId}/entry-draft/${scope}`
        : null;
  const read = async () => {
    const d = await api(path!);
    if (!transport?.flat) return d;
    const { version, updatedAt, originalNarrative, ...answers } = d;
    return { version, answers, originalNarrative };
  };
  function closedError(e: any) {
    if (!["visit_closed", "visit_unavailable"].includes(e.code)) return false;
    setBlocked({ kind: "closed", message: e.message });
    setError("");
    return true;
  }
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
  async function refreshConflict(
    kind: "draft" | "record" | "closed" = "record",
    message?: string,
  ) {
    if (kind === "closed") {
      setBlocked({ kind, message });
      setError("");
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    const pendingConflict: Conflict = { kind };
    setBlocked(pendingConflict);
    if (timer.current) clearTimeout(timer.current);
    if (!path) return;
    try {
      const d = await read();
      if (!stopped.current && blocked.current === pendingConflict)
        setBlocked({ kind, latest: d });
    } catch (e) {
      if (
        !stopped.current &&
        blocked.current === pendingConflict &&
        !closedError(e)
      )
        setError((e as Error).message);
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
      body: transport?.flat
        ? { ...body, version: version.current }
        : { version: version.current, answers: body },
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
        if (closedError(e)) {
          /* preserve the form and offer the saved visit */
        } else if ((e as any).status === 409) await refreshConflict("draft");
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
    read()
      .then((d) => {
        if (live) install(d);
      })
      .catch((e) => {
        if (live && !closedError(e)) setError(e.message);
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
      const d = await read();
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
          resolution: keepEdits ? "keep" : "load",
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
      if (!closedError(e)) setError((e as Error).message);
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
    loaded: loaded || !path,
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
