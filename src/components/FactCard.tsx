"use client";

import { useCallback, useEffect, useState } from "react";
import type { FactErrorResponse, FactResponse } from "@/app/api/fact/route";

type State =
  | { status: "loading"; previous?: FactResponse }
  | { status: "ready"; data: FactResponse }
  | { status: "error"; message: string; previous?: FactResponse };

const SOURCE_LABEL: Record<FactResponse["source"], string> = {
  generated: "Fresh fact",
  cache: "Cached (under 60s old)",
  fallback: "Couldn't reach the AI service — showing your last fact",
};

export function FactCard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setState((s) => ({ status: "loading", previous: s.status === "ready" ? s.data : undefined }));
    try {
      const res = await fetch("/api/fact", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/";
        return;
      }
      const body = (await res.json()) as FactResponse | FactErrorResponse;
      if (!res.ok || "error" in body) {
        const message = "error" in body ? body.error.message : "Something went wrong.";
        setState((s) => ({ status: "error", message, previous: "previous" in s ? s.previous : undefined }));
        return;
      }
      setState({ status: "ready", data: body });
    } catch {
      setState((s) => ({
        status: "error",
        message: "Network error. Check your connection and try again.",
        previous: "previous" in s ? s.previous : undefined,
      }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tick once a second so the "new fact in Ns" hint counts down.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const data = state.status === "ready" ? state.data : state.previous;
  const secondsLeft = data ? Math.ceil((new Date(data.freshUntil).getTime() - now) / 1000) : 0;

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Fun fact</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.status === "loading"}
          className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-medium transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {state.status === "loading" ? "Loading…" : "Refresh"}
        </button>
      </div>

      {state.status === "loading" && !data && (
        <div className="mt-4 space-y-2" aria-label="Loading fact">
          <div className="h-4 w-full animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
        </div>
      )}

      {data && (
        <>
          <p className={`mt-4 text-lg leading-relaxed ${state.status === "loading" ? "opacity-50" : ""}`}>
            {data.fact.content}
          </p>
          <p className="mt-4 text-xs text-zinc-500">
            {SOURCE_LABEL[data.source]}
            {secondsLeft > 0 ? ` · new fact available in ${secondsLeft}s` : " · refresh for a new fact"}
          </p>
        </>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {state.message}
        </p>
      )}
    </section>
  );
}
