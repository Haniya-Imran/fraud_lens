import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, History, RotateCcw, ScanSearch, Trash2 } from "lucide-react";
import { AssumptionsPanel, ThresholdControl } from "../components/Controls";
import { ErrorState, LoadingBlock } from "../components/States";
import { RiskDial } from "../components/three/RiskDial";
import { ApiError, api } from "../lib/api";
import { downloadText, validateTransaction } from "../lib/csv";
import { eur, hhmm, pct, score, signed, thr } from "../lib/format";
import { addEntry, clearHistoryStorage, loadHistory, saveHistory, type HistoryEntry } from "../lib/history";
import { buildReportHtml, reportFileName } from "../lib/report";
import { DEFAULT_ASSUMPTIONS, useDebounced, useSettings } from "../lib/settings";
import type { Contribution, PredictResponse, Sample, Transaction } from "../lib/types";
import { useApi } from "../lib/useApi";

const toStrings = (tx: Transaction) => Object.fromEntries(Object.entries(tx).map(([k, v]) => [k, String(v)]));

function Reason({ c, max }: { c: Contribution; max: number }) {
  const up = c.shap_value > 0;
  const shown = c.feature === "Amount" ? eur(c.value) : c.feature === "Hour" ? hhmm(c.value) : c.value.toFixed(3);
  return (
    <li className="reason">
      <div className="reason-top">
        <span>
          {c.label} <em>= {shown}</em> <span className="reason-note">({c.value_note})</span>
        </span>
        <span className={`mono ${up ? "ink-red-soft" : "ink-mint"}`}>{signed(c.shap_value)}</span>
      </div>
      <div className="reason-track" aria-hidden="true">
        <div className={up ? "rf-up" : "rf-down"} style={{ width: `${Math.max(3, (Math.abs(c.shap_value) / max) * 100)}%` }} />
      </div>
    </li>
  );
}

export default function CheckPage() {
  const info = useApi((s) => api.modelInfo(s));
  const samples = useApi((s) => api.samples(s));
  const { threshold: chosen, assumptions, setThreshold, setAssumptions } = useSettings();
  const recommended = info.data?.threshold.value ?? 0.5;
  const t = chosen ?? recommended;
  const order = info.data?.features.order ?? [];
  const bounds = info.data?.feature_bounds ?? {};

  const [values, setValues] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Sample | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [resultInput, setResultInput] = useState<{ tx: Transaction; label: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const ctrl = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Pre-fill with the first real sample once samples arrive.
  useEffect(() => {
    if (samples.data && !picked && Object.keys(values).length === 0) {
      const s = samples.data.samples[0];
      setPicked(s);
      setValues(toStrings(s.features));
    }
  }, [samples.data, picked, values]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (tx: Transaction, label: string, record: boolean) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    try {
      const r = await api.predict(tx, t, assumptions, c.signal);
      if (c.signal.aborted) return;
      setResult(r);
      setResultInput({ tx, label });
      if (record) {
        const entry: HistoryEntry = {
          id: `${Date.now()}`,
          at: r.generated_at,
          label,
          input: tx,
          score: r.prediction.score,
          threshold: r.prediction.threshold,
          decision: r.prediction.decision,
          review: r.prediction.review_recommended,
        };
        setHistory((h) => {
          const next = addEntry(h, entry);
          saveHistory(next);
          return next;
        });
        requestAnimationFrame(() => resultRef.current?.focus());
      }
    } catch (e) {
      if (c.signal.aborted) return;
      setResult(null);
      setError(e instanceof ApiError ? e : new ApiError("server", "Unexpected error."));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };

  // When the threshold or assumptions change, re-score the current result so the decision stays consistent.
  const dt = useDebounced(t, 300);
  const da = useDebounced(assumptions, 300);
  const lastKey = useRef("");
  useEffect(() => {
    const key = `${dt}|${da.prevention_effectiveness}|${da.review_cost}`;
    if (resultInput && lastKey.current && key !== lastKey.current) run(resultInput.tx, resultInput.label, false);
    lastKey.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dt, da]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { tx, errors: errs } = validateTransaction(values, order, bounds);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setError(new ApiError("validation", `Please fix ${Object.keys(errs).length} field(s) before checking.`));
      return;
    }
    const edited = picked && order.some((f) => Number(values[f]) !== picked.features[f]);
    const label = picked ? `${picked.label}${edited ? " (edited)" : ""} · row ${picked.row_id}` : `Manual entry · ${eur(tx.Amount)}`;
    run(tx, label, true);
  };

  const pick = (s: Sample) => {
    setPicked(s);
    setValues(toStrings(s.features));
    setErrors({});
    setError(null);
  };

  const reset = () => {
    ctrl.current?.abort();
    setPicked(null);
    setValues(Object.fromEntries(order.map((f) => [f, ""])));
    setErrors({});
    setResult(null);
    setResultInput(null);
    setError(null);
    setLoading(false);
  };

  const field = (f: string, label: string, hint?: string) => (
    <div className={`field ${errors[f] ? "has-error" : ""}`} key={f}>
      <label htmlFor={`f-${f}`}>{label}</label>
      <input
        id={`f-${f}`}
        className="input mono"
        inputMode="decimal"
        value={values[f] ?? ""}
        aria-invalid={!!errors[f]}
        aria-describedby={errors[f] ? `e-${f}` : hint ? `h-${f}` : undefined}
        onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
      />
      {errors[f] ? (
        <span id={`e-${f}`} className="field-error">
          {errors[f]}
        </span>
      ) : (
        hint && (
          <span id={`h-${f}`} className="hint">
            {hint}
          </span>
        )
      )}
    </div>
  );

  if (info.error) return <ErrorState error={info.error} onRetry={info.retry} title="The model is not available" />;
  if (!info.data) return <LoadingBlock label="Loading model" height={400} />;

  const p = result?.prediction ?? null;
  const exp = result?.explanation;
  const reasons = exp ? [...exp.top_raising.slice(0, 4), ...exp.top_lowering.slice(0, 2)] : [];
  const maxShap = Math.max(...reasons.map((c) => Math.abs(c.shap_value)), 1e-9);
  const knownClass = picked && resultInput?.label.startsWith(picked.label) && !resultInput.label.includes("(edited)") ? picked.known_class : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Check a transaction</h1>
          <p className="muted">Score one card payment, see why the model decided, and what it could cost.</p>
        </div>
      </div>

      <div className="check-grid">
        <form className="card check-form" onSubmit={onSubmit} noValidate aria-label="Transaction details">
          <fieldset className="plain">
            <legend className="step">1. Choose a sample (real rows from the test period)</legend>
            {samples.error && <ErrorState error={samples.error} onRetry={samples.retry} title="Samples unavailable" />}
            <div className="sample-row">
              {samples.data?.samples.map((s) => (
                <button key={s.row_id} type="button" className={`chip ${picked?.row_id === s.row_id ? "on" : ""}`} aria-pressed={picked?.row_id === s.row_id} onClick={() => pick(s)}>
                  {s.label.replace(" example", "")}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="plain">
            <legend className="step">2. Transaction details</legend>
            <div className="grid-2">
              {field("Amount", "Amount (€)", "0 to 100,000")}
              {field("Hour", "Hour of day", "0–23.99, e.g. 14.5 = 14:30")}
            </div>
            <details className="advanced">
              <summary>Advanced: 28 anonymised features (V1–V28)</summary>
              <p className="hint">
                The bank replaced the real details (merchant, location and so on) with 28 numbers for privacy. They are filled from the chosen sample and can be
                edited (−200 to 200).
              </p>
              <div className="grid-4">{order.filter((f) => f.startsWith("V")).map((f) => field(f, f))}</div>
            </details>
          </fieldset>

          <fieldset className="plain">
            <legend className="step">3. Decision settings</legend>
            <ThresholdControl id="check-thr" value={t} recommended={recommended} onChange={setThreshold} />
            <details className="advanced">
              <summary>Money assumptions</summary>
              <AssumptionsPanel value={assumptions} onChange={setAssumptions} onReset={() => setAssumptions(DEFAULT_ASSUMPTIONS)} />
            </details>
          </fieldset>

          <div className="form-actions">
            <button type="submit" className="btn btn-green btn-lg" disabled={loading}>
              <ScanSearch size={18} aria-hidden="true" /> {loading ? "Checking…" : "Check transaction"}
            </button>
            <button type="button" className="btn btn-light" onClick={reset}>
              <RotateCcw size={16} aria-hidden="true" /> Clear
            </button>
          </div>
        </form>

        <div className="check-results" ref={resultRef} tabIndex={-1} aria-live="polite" aria-busy={loading}>
          {error && <ErrorState error={error} title={error.kind === "validation" ? "Check the inputs" : "The check failed"} />}
          <div className="result-top">
            <RiskDial decision={p} />
            <section className="why card-dark-panel">
              <h2>Why this decision?</h2>
              {!exp ? (
                <p className="muted-dark">The top reasons from SHAP appear here after a check.</p>
              ) : (
                <>
                  <ul className="reasons">
                    {reasons.map((c) => (
                      <Reason key={c.feature} c={c} max={maxShap} />
                    ))}
                  </ul>
                  <p className="small muted-dark">
                    Red pushes the score towards fraud, green towards normal ({exp.output_space} units). {exp.note}
                  </p>
                </>
              )}
            </section>
          </div>

          {p && result && (
            <>
              {p.review_recommended ? (
                <div className="alert alert-warn" role="status">
                  <AlertTriangle size={20} aria-hidden="true" className="alert-icon" />
                  <div className="alert-body">
                    <strong>Human review recommended</strong>
                    <span>{p.review_reason}</span>
                  </div>
                </div>
              ) : (
                <div className="alert alert-info" role="note">
                  <span>
                    Decision support only: the score is {score(p.score)} against a threshold of {thr(p.threshold)}. A person should confirm before a customer is
                    affected.
                  </span>
                </div>
              )}

              <section className="card">
                <div className="card-head">
                  <h2>Summary</h2>
                  {knownClass !== null && (
                    <span className="muted">
                      Dataset label for this row: <strong className={knownClass ? "ink-fraud" : ""}>{knownClass ? "Fraud" : "Legitimate"}</strong>
                    </span>
                  )}
                </div>
                <p>{exp?.summary}</p>
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Estimated financial impact</h2>
                  <span className="muted">EUR (assumed) · true outcome unknown</span>
                </div>
                <dl className="money">
                  <div>
                    <dt>Amount</dt>
                    <dd className="mono">{eur(result.financial_impact.amount)}</dd>
                  </div>
                  <div>
                    <dt>If fraud and approved: loss</dt>
                    <dd className="mono ink-fraud">{eur(result.financial_impact.potential_loss_if_fraud_and_approved)}</dd>
                  </div>
                  <div>
                    <dt>If fraud and blocked: loss prevented (× {pct(assumptions.prevention_effectiveness)})</dt>
                    <dd className="mono ink-green">{eur(result.financial_impact.loss_prevented_if_fraud_and_blocked)}</dd>
                  </div>
                  <div>
                    <dt>If honest and blocked: review cost</dt>
                    <dd className="mono">{eur(result.financial_impact.review_cost_if_legitimate_and_blocked)}</dd>
                  </div>
                  <div className="money-total">
                    <dt>Expected loss if approved (score × amount)</dt>
                    <dd className="mono">{eur(result.financial_impact.expected_loss_if_approved)}</dd>
                  </div>
                </dl>
                <p className="hint">{result.financial_impact.note}</p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-dark btn-sm"
                    onClick={() =>
                      resultInput &&
                      downloadText(reportFileName(resultInput.label), buildReportHtml(resultInput.label, resultInput.tx, result, assumptions), "text/html")
                    }
                  >
                    <Download size={15} aria-hidden="true" /> Download report
                  </button>
                  <span className="hint">
                    {result.model.name} v{result.model.version} · {new Date(result.generated_at).toLocaleTimeString()}
                  </span>
                </div>
              </section>
            </>
          )}
          {loading && !result && <LoadingBlock label="Scoring transaction" height={120} />}

          <section className="card">
            <div className="card-head">
              <h2>
                <History size={17} aria-hidden="true" /> Session history
              </h2>
              {history.length > 0 && (
                <button
                  type="button"
                  className="btn btn-light btn-sm"
                  onClick={() => {
                    clearHistoryStorage();
                    setHistory([]);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" /> Clear history
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="muted">Checks you run appear here. History is kept only in this browser tab and disappears when you close it.</p>
            ) : (
              <ul className="history">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="history-item"
                      onClick={() => {
                        setPicked(null);
                        setValues(toStrings(h.input));
                        run(h.input, h.label, false);
                      }}
                    >
                      <span className={`badge ${h.decision === "Block" ? "badge-block" : "badge-approve"}`}>{h.decision}</span>
                      <span className="history-label">{h.label}</span>
                      <span className="mono">
                        {score(h.score)} @ {thr(h.threshold)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
