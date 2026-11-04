import type { Transaction } from "./types";

/**
 * Check history for the current browser tab only (sessionStorage). It is cleared
 * when the tab closes and never leaves the browser. Only the fields needed to
 * re-open a check are kept, and at most MAX entries.
 */
export type HistoryEntry = {
  id: string;
  at: string;
  label: string;
  input: Transaction;
  score: number;
  threshold: number;
  decision: "Block" | "Approve";
  review: boolean;
};

const KEY = "fraudlens.history.v1";
export const MAX_HISTORY = 15;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    /* storage unavailable: history simply isn't kept */
  }
}

export function clearHistoryStorage(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const addEntry = (entries: HistoryEntry[], entry: HistoryEntry) => [entry, ...entries].slice(0, MAX_HISTORY);
