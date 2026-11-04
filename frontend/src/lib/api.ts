import { API_BASE_URL, API_TIMEOUT_MS } from "./config";
import type {
  Assumptions,
  BatchResponse,
  CurveResponse,
  ModelInfo,
  Overview,
  PredictResponse,
  SamplesResponse,
  ThresholdMetrics,
  Transaction,
} from "./types";

export type ApiErrorKind = "network" | "timeout" | "validation" | "unavailable" | "server" | "invalid_response" | "aborted";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  details?: { field: string | null; message: string }[];

  constructor(kind: ApiErrorKind, message: string, status?: number, details?: ApiError["details"]) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

type Validator<T> = (data: unknown) => data is T;

async function send(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    if (timedOut) throw new ApiError("timeout", "The server took too long to respond. Please try again.");
    if (signal?.aborted) throw new ApiError("aborted", "Request cancelled.");
    throw new ApiError("network", "Can't reach the FraudLens server. Check that the backend is running and try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function fail(response: Response): Promise<never> {
  let body: { message?: string; detail?: string; details?: ApiError["details"] } = {};
  try {
    body = await response.json();
  } catch {
    /* non-JSON error */
  }
  const message = body.message ?? body.detail ?? `Request failed (${response.status}).`;
  if (response.status === 422) throw new ApiError("validation", message, 422, body.details);
  if (response.status === 503) throw new ApiError("unavailable", message, 503);
  throw new ApiError("server", message, response.status);
}

async function request<T>(path: string, validate: Validator<T>, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await send(path, { ...init, headers: { Accept: "application/json" } }, signal);
  if (!response.ok) return fail(response);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!validate(body)) throw new ApiError("invalid_response", "The server sent an unexpected response, so no result is shown.");
  return body;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isProb = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;

export const isPredictResponse = (d: unknown): d is PredictResponse => {
  if (!isObj(d) || !isObj(d.prediction) || !isObj(d.explanation) || !isObj(d.financial_impact)) return false;
  const p = d.prediction;
  const e = d.explanation;
  return (
    isProb(p.score) &&
    isProb(p.threshold) &&
    (p.decision === "Block" || p.decision === "Approve") &&
    Array.isArray(e.contributions) &&
    e.contributions.length > 0 &&
    typeof e.base_value === "number"
  );
};

export const isThresholdMetrics = (d: unknown): d is ThresholdMetrics =>
  isObj(d) && isProb(d.threshold) && isObj(d.confusion_matrix) && typeof d.net_benefit === "number" && isProb(d.recall);

export const isBatchResponse = (d: unknown): d is BatchResponse =>
  isObj(d) && Array.isArray(d.results) && typeof d.flagged === "number" && d.results.every((r) => isObj(r) && isProb(r.score));

const isModelInfo = (d: unknown): d is ModelInfo => isObj(d) && typeof d.model_name === "string" && isObj(d.threshold) && isObj(d.feature_bounds);
const isOverview = (d: unknown): d is Overview => isObj(d) && isObj(d.dataset_totals) && Array.isArray(d.top_risk_test);
const isSamples = (d: unknown): d is SamplesResponse => isObj(d) && Array.isArray(d.samples);
const isCurve = (d: unknown): d is CurveResponse => isObj(d) && Array.isArray(d.points) && d.points.length > 0;
const isHealth = (d: unknown): d is { status: string; model_loaded: boolean } => isObj(d) && typeof d.status === "string";

const qs = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  health: (signal?: AbortSignal) => request("/health", isHealth, {}, signal),
  modelInfo: (signal?: AbortSignal) => request("/model-info", isModelInfo, {}, signal),
  overview: (signal?: AbortSignal) => request("/analytics/overview", isOverview, {}, signal),
  samples: (signal?: AbortSignal) => request("/samples", isSamples, {}, signal),
  threshold: (threshold: number, a: Assumptions, split: "test" | "validation" = "test", signal?: AbortSignal) =>
    request(
      `/analytics/threshold?${qs({ threshold, split, effectiveness: a.prevention_effectiveness, review_cost: a.review_cost })}`,
      isThresholdMetrics,
      {},
      signal,
    ),
  curve: (a: Assumptions, split: "test" | "validation" = "test", signal?: AbortSignal) =>
    request(`/analytics/curve?${qs({ split, effectiveness: a.prevention_effectiveness, review_cost: a.review_cost })}`, isCurve, {}, signal),
  predict: (transaction: Transaction, threshold: number, assumptions: Assumptions, signal?: AbortSignal) =>
    request("/predict", isPredictResponse, { method: "POST", body: JSON.stringify({ transaction, threshold, assumptions }) }, signal),
  predictBatch: (transactions: (Transaction & { transaction_id?: string })[], threshold: number, signal?: AbortSignal) =>
    request("/predict/batch", isBatchResponse, { method: "POST", body: JSON.stringify({ transactions, threshold }) }, signal),
  sampleCsv: async (signal?: AbortSignal): Promise<string> => {
    const r = await send("/samples/batch.csv", {}, signal);
    if (!r.ok) return fail(r);
    return r.text();
  },
};
