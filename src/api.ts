export type Session = { id: string; name: string; role: "clinician" | "reviewer" | "admin"; siteId: string; email: string; csrf: string };

let csrf = "";
export const setCsrf = (token: string) => (csrf = token);

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch("/api" + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // a gateway error page (HTML) instead of JSON: say what happened in plain words
    if (!response.ok) throw new HttpError(response.status, response.status >= 500 ? "The server did not answer. Nothing was saved — try again." : `Request failed (${response.status})`);
    throw new HttpError(response.status, "Unexpected answer from the server");
  }
  if (!response.ok) throw new HttpError(response.status, data?.error ?? "Request failed");
  return data as T;
}

// tiny data hook with manual reload
import { useCallback, useEffect, useState } from "react";
export function useData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}
