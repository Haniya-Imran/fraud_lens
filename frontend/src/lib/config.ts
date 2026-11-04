// The API base URL comes from VITE_API_BASE_URL. The localhost fallback is only
// used by the dev server; a production build without the variable calls the API
// on the same origin (e.g. behind a reverse proxy).
const fallback = import.meta.env.DEV ? "http://localhost:8000" : "";
const rawBase = import.meta.env.VITE_API_BASE_URL ?? fallback;

export const API_BASE_URL = rawBase.replace(/\/+$/, "");
export const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000) || 20000;

export const THRESHOLD_MIN = 0.01;
export const THRESHOLD_MAX = 0.99;
export const MAX_BATCH_ROWS = 1000;
export const MAX_CSV_BYTES = 900_000; // stays under the API's 1 MB body limit once converted to JSON
