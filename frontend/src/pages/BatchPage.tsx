import { useRef, useState } from "react";
import { Download, FileUp, Play, RotateCcw } from "lucide-react";
import { ThresholdControl } from "../components/Controls";
import { ErrorState, LoadingBlock } from "../components/States";
import { ApiError, api } from "../lib/api";
import { MAX_BATCH_ROWS, MAX_CSV_BYTES } from "../lib/config";
import { downloadText, parseBatchCsv, resultsToCsv, type ParsedBatch } from "../lib/csv";
import { eur, hhmm, num, score, signed, thr } from "../lib/format";
import { useSettings } from "../lib/settings";
import type { BatchResponse } from "../lib/types";
import { useApi } from "../lib/useApi";

export default function BatchPage() {
  const info = useApi((s) => api.modelInfo(s));
  const { threshold: chosen, setThreshold } = useSettings();
  const recommended = info.data?.threshold.value ?? 0.5;
  const t = chosen ?? recommended;

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBatch | null>(null);
  const [result, setResult] = useState<BatchResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "block" | "review">("all");
  const input = useRef<HTMLInputElement>(null);

  if (info.error) return <ErrorState error={info.error} onRetry={info.retry} title="The model is not available" />;
  if (!info.data) return <LoadingBlock label="Loading model" height={300} />;
  const m = info.data;

  const loadText = (name: string, text: string) => {
    setFileName(name);
    setResult(null);
    setError(null);
    setParsed(parseBatchCsv(text, m.features.order, m.feature_bounds));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_CSV_BYTES) {
      setFileName(f.name);
      setParsed({ rows: [], errors: [`The file is ${(f.size / 1e6).toFixed(1)} MB; the limit is ${(MAX_CSV_BYTES / 1e6).toFixed(1)} MB.`], warnings: [] });
      return;
    }
    loadText(f.name, await f.text());
  };

  const useSample = async () => {
    setError(null);
    try {
      loadText("fraudlens-sample-batch.csv (real test rows)", await api.sampleCsv());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("server", "Unexpected error."));
    }
  };

  const downloadSample = async () => {
    try {
      downloadText("fraudlens-sample-batch.csv", await api.sampleCsv(), "text/csv");
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("server", "Unexpected error."));
    }
  };

  const runBatch = async () => {
    if (!parsed?.rows.length) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.predictBatch(parsed.rows, t));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e : new ApiError("server", "Unexpected error."));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setResult(null);
    setError(null);
    setFilter("all");
    if (input.current) input.current.value = "";
  };

  const rows = result?.results.filter((r) => (filter === "all" ? true : filter === "block" ? r.flagged : r.review_recommended)) ?? [];
  const stale = result && result.threshold !== t;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Batch CSV check</h1>
          <p className="muted">Score up to {num(MAX_BATCH_ROWS)} transactions at once and download the decisions.</p>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>1. Upload a CSV</h2>
          </div>
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files[0]);
            }}
          >
            <FileUp size={26} aria-hidden="true" />
            <span>
              <strong>Choose a .csv file</strong> or drop it here
            </span>
            <span className="hint">
              Columns: Hour (or the dataset's Time), Amount, V1–V28; optional transaction_id. Max {num(MAX_BATCH_ROWS)} rows. The file is read in your browser
              and only the feature values are sent for scoring; nothing is stored.
            </span>
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} aria-label="CSV file" />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-light btn-sm" onClick={useSample}>
              Use sample batch
            </button>
            <button type="button" className="btn btn-light btn-sm" onClick={downloadSample}>
              <Download size={14} aria-hidden="true" /> Download sample CSV
            </button>
            {(parsed || result) && (
              <button type="button" className="btn btn-light btn-sm" onClick={reset}>
                <RotateCcw size={14} aria-hidden="true" /> Reset
              </button>
            )}
          </div>
          {parsed && (
            <div className="parse-status" aria-live="polite">
              <p>
                <strong>{fileName}</strong>
              </p>
              {parsed.errors.length > 0 ? (
                <div className="alert alert-error" role="alert">
                  <div className="alert-body">
                    <strong>The file can't be scored yet</strong>
                    <ul>
                      {parsed.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="ink-green">{num(parsed.rows.length)} valid transactions ready.</p>
              )}
              {parsed.warnings.map((w) => (
                <p key={w} className="hint">
                  {w}
                </p>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>2. Choose the threshold and run</h2>
          </div>
          <ThresholdControl id="batch-thr" value={t} recommended={recommended} onChange={setThreshold} />
          <div className="form-actions">
            <button type="button" className="btn btn-green btn-lg" disabled={!parsed?.rows.length || loading} onClick={runBatch}>
              <Play size={17} aria-hidden="true" /> {loading ? "Scoring…" : stale ? "Re-run with new threshold" : "Score batch"}
            </button>
          </div>
          {error && <ErrorState error={error} title="The batch failed" />}
        </section>
      </div>

      {loading && <LoadingBlock label="Scoring batch" height={160} />}
      {result && (
        <section className="card">
          <div className="card-head">
            <h2>Results</h2>
            <button type="button" className="btn btn-dark btn-sm" onClick={() => downloadText(`fraudlens-batch-results-${new Date().toISOString().slice(0, 10)}.csv`, resultsToCsv(result.results), "text/csv")}>
              <Download size={14} aria-hidden="true" /> Download results CSV
            </button>
          </div>
          <div className="kpi-grid">
            <div className="kpi">
              <span>Transactions scored</span>
              <strong className="mono">{num(result.rows)}</strong>
            </div>
            <div className="kpi">
              <span>Blocked at {thr(result.threshold)}</span>
              <strong className="mono ink-fraud">{num(result.flagged)}</strong>
            </div>
            <div className="kpi">
              <span>Need human review</span>
              <strong className="mono">{num(result.results.filter((r) => r.review_recommended).length)}</strong>
            </div>
            <div className="kpi">
              <span>Amount on hold (gross)</span>
              <strong className="mono">{eur(result.flagged_amount)}</strong>
            </div>
          </div>
          <p className="hint">
            "Amount on hold" is the total value of blocked payments, not money saved — outcomes for uploaded rows are unknown.
            {stale && " The threshold changed since this run; press Re-run to update decisions."}
          </p>
          <div className="seg seg-light" role="group" aria-label="Filter results">
            {(["all", "block", "review"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "block" ? "Blocked" : "Review"}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Amount</th>
                  <th>Time</th>
                  <th>Fraud score</th>
                  <th>Decision</th>
                  <th>Top reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.transaction_id ?? "row"}-${i}`}>
                    <td className="mono">{r.transaction_id ?? `row ${result.results.indexOf(r) + 1}`}</td>
                    <td>{eur(r.amount)}</td>
                    <td>{hhmm(r.hour)}</td>
                    <td className="mono strong">{score(r.score)}</td>
                    <td>
                      <span className={`badge ${r.flagged ? "badge-block" : "badge-approve"}`}>{r.decision}</span>
                      {r.review_recommended && <span className="badge badge-review">Review</span>}
                    </td>
                    <td className="small">
                      {r.top_factors[0] ? `${r.top_factors[0].label} (${signed(r.top_factors[0].shap_value)})` : "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No rows match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
