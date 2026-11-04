import { ImportanceBars } from "../components/charts";
import { ErrorState, LoadingBlock } from "../components/States";
import { api } from "../lib/api";
import { eur, num, pct, thr } from "../lib/format";
import { useApi } from "../lib/useApi";

export default function ModelPage() {
  const info = useApi((s) => api.modelInfo(s));
  if (info.error) return <ErrorState error={info.error} onRetry={info.retry} title="Model information unavailable" />;
  if (!info.data) return <LoadingBlock label="Loading model information" height={400} />;
  const m = info.data;
  const tm = m.test_metrics;
  const q = m.dataset.quality;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Model &amp; data</h1>
          <p className="muted">
            {m.model_name} v{m.model_version} · trained {new Date(m.trained_at).toLocaleDateString()} · {m.latency_ms_single_prediction} ms per prediction
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span>PR-AUC (test)</span>
          <strong className="mono">{tm.pr_auc.toFixed(3)}</strong>
        </div>
        <div className="kpi">
          <span>ROC-AUC (test)</span>
          <strong className="mono">{tm.roc_auc.toFixed(3)}</strong>
        </div>
        <div className="kpi">
          <span>Precision / recall at {thr(m.threshold.value)}</span>
          <strong className="mono">
            {pct(tm.precision, 1)} / {pct(tm.recall, 1)}
          </strong>
        </div>
        <div className="kpi kpi-dark">
          <span>Est. net benefit (test)</span>
          <strong className="mono ink-mint">{eur(tm.net_benefit)}</strong>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Model comparison (validation period)</h2>
          <span className="muted">Accuracy is not used: it is 99.8% even for a model that never flags fraud</span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Model</th>
                <th>PR-AUC</th>
                <th>ROC-AUC</th>
                <th>Brier</th>
                <th>Best threshold</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>Net benefit</th>
              </tr>
            </thead>
            <tbody>
              {m.comparison.map((c) => (
                <tr key={c.model} className={c.model === m.model_name ? "row-selected" : ""}>
                  <td>
                    {c.model}
                    {c.model === m.model_name && <span className="badge badge-approve">Selected</span>}
                  </td>
                  <td className="mono">{c.validation.pr_auc.toFixed(4)}</td>
                  <td className="mono">{c.validation.roc_auc.toFixed(4)}</td>
                  <td className="mono">{c.validation.brier.toFixed(5)}</td>
                  <td className="mono">{thr(c.validation_at_best_threshold.threshold)}</td>
                  <td className="mono">{pct(c.validation_at_best_threshold.precision, 1)}</td>
                  <td className="mono">{pct(c.validation_at_best_threshold.recall, 1)}</td>
                  <td className="mono">{eur(c.validation_at_best_threshold.net_benefit, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">{m.selection_rule}</p>
        <p className="hint">{m.imbalance_handling}</p>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Threshold</h2>
          </div>
          <p>
            Recommended <strong className="mono">{thr(m.threshold.value)}</strong>. {m.threshold.method}
          </p>
          <p className="hint">
            F1-optimal threshold on validation: {thr(m.threshold.f1_optimal_on_validation)}. {m.threshold.limitation}
          </p>
          <p className="hint">
            For reference, at the common default 0.50 the test precision is {pct(m.test_metrics_at_0_5.precision, 1)}, recall{" "}
            {pct(m.test_metrics_at_0_5.recall, 1)} and estimated net benefit {eur(m.test_metrics_at_0_5.net_benefit)}.
          </p>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Overfitting check</h2>
          </div>
          <dl className="money">
            <div>
              <dt>Train PR-AUC</dt>
              <dd className="mono">{m.overfitting_check.train_pr_auc.toFixed(4)}</dd>
            </div>
            <div>
              <dt>Validation PR-AUC</dt>
              <dd className="mono">{m.overfitting_check.validation_pr_auc.toFixed(4)}</dd>
            </div>
            <div>
              <dt>Test PR-AUC</dt>
              <dd className="mono">{m.overfitting_check.test_pr_auc.toFixed(4)}</dd>
            </div>
          </dl>
          <p className="hint">{m.overfitting_check.note}</p>
          <p className="hint">{m.calibration_note}</p>
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Most influential inputs</h2>
            <span className="muted">mean |SHAP| on the test period</span>
          </div>
          <ImportanceBars rows={m.global_importance.slice(0, 10)} />
          <p className="hint">
            {m.shap.method}. {m.shap.note}
          </p>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Time-ordered split</h2>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Rows</th>
                  <th>Fraud</th>
                  <th>Seconds into capture</th>
                </tr>
              </thead>
              <tbody>
                {(["train", "validation", "test"] as const).map((k) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="mono">{num(m.split[k].rows)}</td>
                    <td className="mono">{m.split[k].fraud}</td>
                    <td className="mono">
                      {num(m.split[k].time_range_s[0])}–{num(m.split[k].time_range_s[1])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            {m.split.method}. Earlier transactions train the model, later ones test it — like real deployment. The test period was used only once, for the final
            numbers.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Dataset</h2>
        </div>
        <p>
          <strong>{m.dataset.name}.</strong> {m.dataset.description}
        </p>
        <ul className="facts">
          <li>
            Source:{" "}
            <a href={m.dataset.original_source} target="_blank" rel="noreferrer">
              {m.dataset.original_source}
            </a>
          </li>
          <li>Copy used: {m.dataset.download_mirror} (SHA-256 {m.dataset.sha256.slice(0, 16)}…)</li>
          <li>Other copy: {m.dataset.other_mirror}</li>
          <li>License: {m.dataset.license}</li>
          <li>Citation: {m.dataset.citation}</li>
          <li>
            {num(Number(q.rows))} rows · {num(Number(q.fraud))} fraud · {Number(q.missing_values)} missing values · {num(Number(q.exact_duplicate_rows_removed))}{" "}
            exact duplicates removed before splitting
          </li>
          <li>{String(q.leakage_review)}</li>
          <li>{m.currency_note}</li>
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Limitations</h2>
        </div>
        <ul className="facts">
          {m.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
