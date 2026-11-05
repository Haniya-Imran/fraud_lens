import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Info } from "lucide-react";
import { ConfusionMatrix, CurveChart, Dial, HourBars, ImbalanceBar, NetBenefitChart, RateBars } from "../components/charts";
import { AssumptionsPanel, ThresholdControl } from "../components/Controls";
import { ErrorState, LoadingBlock } from "../components/States";
import { ApiError, api } from "../lib/api";
import { eur, hhmm, num, pct, score, thr } from "../lib/format";
import { DEFAULT_ASSUMPTIONS, useDebounced, useSettings } from "../lib/settings";
import type { CurvePoint, ThresholdMetrics } from "../lib/types";
import { useApi } from "../lib/useApi";

type Split = "test" | "validation";

export default function DashboardPage() {
  const info = useApi((s) => api.modelInfo(s));
  const overview = useApi((s) => api.overview(s));
  const { threshold: chosen, assumptions, setThreshold, setAssumptions } = useSettings();
  const recommended = info.data?.threshold.value ?? 0.5;
  const t = chosen ?? recommended;
  const [split, setSplit] = useState<Split>("test");

  const dt = useDebounced(t);
  const da = useDebounced(assumptions, 250);
  const [metrics, setMetrics] = useState<ThresholdMetrics | null>(null);
  const [metricsErr, setMetricsErr] = useState<ApiError | null>(null);
  const [curve, setCurve] = useState<CurvePoint[] | null>(null);
  const [curveErr, setCurveErr] = useState<ApiError | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    // Wait until the debounced value has caught up with the model's recommended threshold on first load.
    if (!info.data || (metrics === null && dt !== t)) return;
    const c = new AbortController();
    api
      .threshold(dt, da, split, c.signal)
      .then((m) => {
        setMetrics(m);
        setMetricsErr(null);
      })
      .catch((e) => !c.signal.aborted && setMetricsErr(e instanceof ApiError ? e : new ApiError("server", "Unexpected error.")));
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dt, da, split, info.data, retry]);

  useEffect(() => {
    if (!info.data) return;
    const c = new AbortController();
    api
      .curve(da, split, c.signal)
      .then((r) => {
        setCurve(r.points);
        setCurveErr(null);
      })
      .catch((e) => !c.signal.aborted && setCurveErr(e instanceof ApiError ? e : new ApiError("server", "Unexpected error.")));
    return () => c.abort();
  }, [da, split, info.data, retry]);

  if (info.error) return <ErrorState error={info.error} onRetry={info.retry} title="The dashboard could not load" />;
  const m = info.data;
  const o = overview.data;
  const periodFraud = m ? (split === "test" ? m.split.test.fraud : m.split.validation.fraud) : 0;
  const periodRows = m ? (split === "test" ? m.split.test.rows : m.split.validation.rows) : 0;

  const periodSeg = (
    <div className="seg" role="group" aria-label="Evaluation period">
      {(["test", "validation"] as Split[]).map((s) => (
        <button key={s} type="button" aria-pressed={split === s} className={split === s ? "on" : ""} onClick={() => setSplit(s)}>
          {s === "test" ? "Test" : "Validation"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Fraud Overview</h1>
          <p className="muted">How the model performs on unseen, later transactions — and what your threshold choice is worth.</p>
        </div>
        <div className="head-actions">
          {m && (
            <span className="period-note mono">
              {split} period · {num(periodRows)} tx · {periodFraud} fraud
            </span>
          )}
          {periodSeg}
          <Link to="/check" className="btn btn-green">
            Check a transaction <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {!m || !o ? (
        overview.error ? (
          <ErrorState error={overview.error} onRetry={overview.retry} />
        ) : (
          <LoadingBlock label="Loading dashboard" height={360} />
        )
      ) : (
        <>
          {metricsErr && <ErrorState error={metricsErr} onRetry={() => setRetry((r) => r + 1)} title="Metrics unavailable" />}
          <div className="kpi-grid">
            <div className="kpi">
              <span>Fraud caught</span>
              <strong className="mono ink-green">{metrics ? metrics.confusion_matrix.tp : "—"}</strong>
              <em>{metrics ? `of ${periodFraud} frauds · recall ${pct(metrics.recall, 1)}` : " "}</em>
            </div>
            <div className="kpi">
              <span>Fraud missed</span>
              <strong className="mono ink-fraud">{metrics ? metrics.confusion_matrix.fn : "—"}</strong>
              <em>{metrics ? `slipped through · ${eur(metrics.missed_fraud_loss, 0)} lost` : " "}</em>
            </div>
            <div className="kpi">
              <span>False alarms</span>
              <strong className="mono ink-amber">{metrics ? metrics.confusion_matrix.fp : "—"}</strong>
              <em>{metrics ? `honest customers stopped · precision ${pct(metrics.precision, 1)}` : " "}</em>
            </div>
            <div className="kpi kpi-hl">
              <span>Estimated money saved ({split} period)</span>
              <strong className="mono" data-testid="kpi-net">
                {metrics ? eur(metrics.net_benefit) : "—"}
              </strong>
              <em>net benefit · see breakdown below</em>
            </div>
          </div>

          <div className="radar-grid">
            <section className="card thr-card">
              <div className="card-head">
                <h2>Alarm threshold</h2>
                <span className="muted">How strict should the alarm be?</span>
              </div>
              <Dial value={t} />
              <ThresholdControl value={t} recommended={recommended} onChange={setThreshold} />
              {metrics ? (
                <div className="mini-stats">
                  <div>
                    <span>Precision</span>
                    <b className="mono ink-accent">{pct(metrics.precision, 1)}</b>
                  </div>
                  <div>
                    <span>Recall</span>
                    <b className="mono ink-cyan">{pct(metrics.recall, 1)}</b>
                  </div>
                  <div>
                    <span>F1</span>
                    <b className="mono">{metrics.f1.toFixed(3)}</b>
                  </div>
                </div>
              ) : (
                !metricsErr && <LoadingBlock label="Calculating metrics" height={60} />
              )}
              <p className="hint">
                Real results of the trained model on the {split} period. Small fraud counts mean these numbers can move noticeably between periods.
              </p>
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Threshold vs precision &amp; recall</h2>
                <span className="muted">{split} period</span>
              </div>
              {curveErr ? <ErrorState error={curveErr} onRetry={() => setRetry((r) => r + 1)} /> : curve ? <CurveChart points={curve} threshold={t} /> : <LoadingBlock label="Loading chart" height={240} />}
              <h3 className="mini-h">Fraud rate by hour of day (whole dataset)</h3>
              <HourBars rows={o.fraud_rate_by_hour} />
            </section>
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>Money breakdown</h2>
                <span className="muted">Estimates · EUR · {split} period</span>
              </div>
              {metrics && (
                <dl className="money">
                  <div>
                    <dt>Fraud amount caught (gross)</dt>
                    <dd className="mono">{eur(metrics.caught_fraud_value)}</dd>
                  </div>
                  <div>
                    <dt>× prevention effectiveness {pct(metrics.assumptions.prevention_effectiveness)}</dt>
                    <dd className="mono">= {eur(metrics.prevented_loss)} prevented loss</dd>
                  </div>
                  <div>
                    <dt>
                      − false alarms {metrics.confusion_matrix.fp} × {eur(metrics.assumptions.review_cost_per_false_alarm)}
                    </dt>
                    <dd className="mono">− {eur(metrics.false_alarm_cost)}</dd>
                  </div>
                  <div className="money-total">
                    <dt>Estimated net benefit (money saved)</dt>
                    <dd className="mono">{eur(metrics.net_benefit)}</dd>
                  </div>
                  <div className="money-miss">
                    <dt>Fraud still missed (not prevented)</dt>
                    <dd className="mono">{eur(metrics.missed_fraud_loss)}</dd>
                  </div>
                </dl>
              )}
              <p className="hint">
                <Info size={13} aria-hidden="true" /> The gross caught amount is not "money saved": only part of a blocked fraud is truly avoided, and every false
                alarm costs review time. The dataset does not state a currency; EUR is assumed (European cardholders).
              </p>
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Assumptions</h2>
                <span className="muted">Change them to match your business</span>
              </div>
              <AssumptionsPanel value={assumptions} onChange={setAssumptions} onReset={() => setAssumptions(DEFAULT_ASSUMPTIONS)} />
            </section>
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>Threshold vs estimated net benefit</h2>
                <span className="muted">{split} period</span>
              </div>
              {curve ? <NetBenefitChart points={curve} threshold={t} /> : !curveErr && <LoadingBlock label="Loading chart" height={240} />}
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Confusion matrix</h2>
                <span className="muted">
                  at {thr(t)} · {split} period
                </span>
              </div>
              {metrics && <ConfusionMatrix cm={metrics.confusion_matrix} />}
            </section>
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>Imbalanced data: normal vs fraud</h2>
                <span className="muted">That is why accuracy alone is misleading</span>
              </div>
              <div className="data-facts">
                <div>
                  <span>Transactions</span>
                  <b className="mono">{num(o.dataset_totals.rows)}</b>
                </div>
                <div>
                  <span>Fraud cases</span>
                  <b className="mono ink-fraud">{num(o.dataset_totals.fraud)}</b>
                </div>
                <div>
                  <span>Avg fraud amount</span>
                  <b className="mono">{eur(o.dataset_totals.amount_mean_fraud)}</b>
                </div>
              </div>
              <ImbalanceBar legit={o.dataset_totals.legitimate} fraud={o.dataset_totals.fraud} />
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Fraud rate by amount (€)</h2>
                <span className="muted">whole dataset</span>
              </div>
              <RateBars rows={o.fraud_rate_by_amount} unit="" />
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Highest-risk transactions (test period)</h2>
              <span className="muted">Decisions update with your threshold</span>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Amount</th>
                    <th>Time</th>
                    <th>Fraud score</th>
                    <th>Decision at {thr(t)}</th>
                    <th>Dataset label</th>
                  </tr>
                </thead>
                <tbody>
                  {o.top_risk_test.map((r) => {
                    const block = r.score >= t;
                    const near = Math.abs(r.score - t) <= 0.15;
                    return (
                      <tr key={r.row_id}>
                        <td className="mono">#{r.row_id}</td>
                        <td>{eur(r.amount)}</td>
                        <td>{hhmm(r.hour)}</td>
                        <td className="mono strong">{score(r.score)}</td>
                        <td>
                          <span className={`badge ${block ? "badge-block" : "badge-approve"}`}>{block ? "Block" : "Approve"}</span>
                          {near && <span className="badge badge-review">Review</span>}
                        </td>
                        <td>{r.known_class === 1 ? <span className="ink-fraud">Fraud</span> : "Legitimate"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">Dataset labels are shown only to compare against the model; the model never sees them when scoring.</p>
          </section>
        </>
      )}
    </div>
  );
}
