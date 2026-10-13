import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Pending values are server drafts, never clinical observations until confirmation.
export function useEntryDraft(
  patientId: string,
  scope: string | null,
  answers: Record<string, unknown>,
  restore: (answers: any) => void,
  ready = true,
) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0),
    baseline = useRef(""),
    pending = useRef<any>(null);
  const request = useRef<Promise<any> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false),
    restoreRef = useRef(restore);
  restoreRef.current = restore;
  const key = JSON.stringify(answers);
  const path = scope ? `/patients/${patientId}/entry-draft/${scope}` : null;
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    await request.current;
    const body = pending.current;
    if (!body || !path || stopped.current) return;
    pending.current = null;
    const req = api(path, {
      body: { version: version.current, answers: body },
    });
    request.current = req;
    try {
      const d = await req;
      version.current = d.version;
      baseline.current = JSON.stringify(body);
      setError("");
    } catch (e) {
      pending.current = body;
      setError(`Draft not saved: ${(e as Error).message}`);
      throw e;
    } finally {
      request.current = null;
    }
    if (pending.current) await flush();
  }
  useEffect(() => {
    if (!path || !ready) return;
    let live = true;
    api(path)
      .then((d) => {
        if (!live) return;
        version.current = d.version;
        if (d.answers) restoreRef.current(d.answers);
        baseline.current = d.answers ? JSON.stringify(d.answers) : key;
        setLoaded(true);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [path, ready]);
  useEffect(() => {
    if (!loaded || stopped.current || key === baseline.current) return;
    pending.current = answers;
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, loaded]);
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
      void flush().catch(() => {});
    };
  }, [path]);
  function complete() {
    stopped.current = true;
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
  }
  return { loaded: loaded || !scope, error, flush, complete };
}
