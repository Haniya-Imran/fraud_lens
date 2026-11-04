import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { THRESHOLD_MAX, THRESHOLD_MIN } from "./config";
import { clamp, round2 } from "./format";
import type { Assumptions } from "./types";

/**
 * The threshold and money assumptions chosen on one page carry over to the
 * others for this browser tab. `null` threshold means "use the model's
 * recommended threshold" (read from /model-info), so nothing is hard-coded.
 */
type Settings = {
  threshold: number | null;
  assumptions: Assumptions;
  setThreshold: (t: number | null) => void;
  setAssumptions: (a: Assumptions) => void;
  resetAll: () => void;
};

export const DEFAULT_ASSUMPTIONS: Assumptions = { prevention_effectiveness: 0.9, review_cost: 5 };
const KEY = "fraudlens.settings.v1";

function load(): { threshold: number | null; assumptions: Assumptions } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const t = typeof raw.threshold === "number" ? clamp(raw.threshold, THRESHOLD_MIN, THRESHOLD_MAX) : null;
      const a = raw.assumptions ?? {};
      return {
        threshold: t,
        assumptions: {
          prevention_effectiveness: clamp(Number(a.prevention_effectiveness ?? 0.9), 0, 1),
          review_cost: clamp(Number(a.review_cost ?? 5), 0, 500),
        },
      };
    }
  } catch {
    /* ignore */
  }
  return { threshold: null, assumptions: DEFAULT_ASSUMPTIONS };
}

const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);
  const setThreshold = useCallback(
    (t: number | null) => setState((s) => ({ ...s, threshold: t === null ? null : round2(clamp(t, THRESHOLD_MIN, THRESHOLD_MAX)) })),
    [],
  );
  const setAssumptions = useCallback((a: Assumptions) => setState((s) => ({ ...s, assumptions: a })), []);
  const resetAll = useCallback(() => setState({ threshold: null, assumptions: DEFAULT_ASSUMPTIONS }), []);
  const value = useMemo(() => ({ ...state, setThreshold, setAssumptions, resetAll }), [state, setThreshold, setAssumptions, resetAll]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used inside SettingsProvider");
  return v;
}

/** Debounce a changing value (used so dragging a slider doesn't flood the API). */
export function useDebounced<T>(value: T, ms = 180): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
