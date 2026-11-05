import { useId } from "react";
import { eur, num, pct, thr } from "../lib/format";
import type { Confusion, CurvePoint, GroupRate, Importance } from "../lib/types";

/** Ring dial: the coloured arc shows where the threshold sits between 0 and 1. */
export function Dial({ value, size = 220 }: { value: number; size?: number }) {
  const id = useId().replace(/:/g, "");
  const r = 92;
  const c = 2 * Math.PI * r;
  return (
    <div className="dial-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 220 220" width={size} height={size} role="img" aria-label={`Threshold dial at ${thr(value)}`}>
        <defs>
          <linearGradient id={`d${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4F46E5" />
            <stop offset="1" stopColor="#06B6D4" />
          </linearGradient>
        </defs>
        <circle cx="110" cy="110" r={r} fill="none" stroke="#EEF2FF" strokeWidth="16" />
        <circle
          cx="110"
          cy="110"
          r={r}
          fill="none"
          stroke={`url(#d${id})`}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.01, value) * c} ${c}`}
          transform="rotate(-90 110 110)"
          className="dial-arc"
        />
      </svg>
      <div className="dial-center">
        <span className="mono dial-value" aria-live="polite">
          {thr(value)}
        </span>
        <span className="dial-sub">block if score ≥</span>
      </div>
    </div>
  );
}

/** Column bars for the fraud rate in each 3-hour block of the day. */
export function HourBars({ rows }: { rows: GroupRate[] }) {
  const max = Math.max(...rows.map((r) => r.fraud_rate));
  return (
    <figure className="hour-bars" aria-label="Fraud rate by hour of day">
      <div className="hb-cols">
        {rows.map((r) => (
          <div key={r.group} className="hb-col" title={`${r.group}h: ${pct(r.fraud_rate, 2)} (${num(r.fraud)} frauds)`}>
            <span className="hb-val mono">{pct(r.fraud_rate, 2)}</span>
            <span className="hb-bar" style={{ height: `${(r.fraud_rate / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="hb-labels mono">
        {rows.map((r) => (
          <span key={r.group}>{r.group}</span>
        ))}
      </div>
    </figure>
  );
}

export function ImbalanceBar({ legit, fraud }: { legit: number; fraud: number }) {
  const total = legit + fraud;
  const fraudShare = fraud / total;
  return (
    <div className="imbalance">
      <div className="imbalance-bar" role="img" aria-label={`${pct(1 - fraudShare, 2)} normal, ${pct(fraudShare, 2)} fraud`}>
        <div style={{ flex: legit }} className="imb-legit" />
        {/* Fraud is drawn at least 1% wide so it stays visible; the label gives the true share. */}
        <div style={{ flex: Math.max(fraud, total * 0.01) }} className="imb-fraud" />
      </div>
      <div className="imbalance-legend mono">
        <span>
          {num(legit)} normal · {pct(1 - fraudShare, 2)}
        </span>
        <span className="ink-fraud">
          {num(fraud)} fraud · {pct(fraudShare, 2)}
        </span>
      </div>
    </div>
  );
}

const W = 600;
const H = 240;
const PAD = { l: 44, r: 14, t: 12, b: 30 };
const sx = (t: number) => PAD.l + ((t - 0) / 1) * (W - PAD.l - PAD.r);

function path(points: CurvePoint[], y: (p: CurvePoint) => number) {
  return points.map((p, i) => `${i ? "L" : "M"}${sx(p.threshold).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
}

/** Precision / recall / F1 against the threshold, with a marker at the chosen value. */
export function CurveChart({ points, threshold }: { points: CurvePoint[]; threshold: number }) {
  const sy = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
  const at = points.reduce((best, p) => (Math.abs(p.threshold - threshold) < Math.abs(best.threshold - threshold) ? p : best), points[0]);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="curve-desc" preserveAspectRatio="xMidYMid meet">
        <desc id="curve-desc">
          Precision and recall for every threshold from 0.01 to 0.99. At {thr(at.threshold)}: precision {pct(at.precision, 1)}, recall{" "}
          {pct(at.recall, 1)}.
        </desc>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} className="grid" />
            <text x={PAD.l - 8} y={sy(v) + 4} textAnchor="end" className="tick">
              {pct(v)}
            </text>
          </g>
        ))}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
          <text key={v} x={sx(v)} y={H - 8} textAnchor="middle" className="tick">
            {v.toFixed(1)}
          </text>
        ))}
        <path d={path(points, (p) => sy(p.precision))} className="line line-precision" />
        <path d={path(points, (p) => sy(p.recall))} className="line line-recall" />
        <path d={path(points, (p) => sy(p.f1))} className="line line-f1" />
        <line x1={sx(threshold)} x2={sx(threshold)} y1={PAD.t} y2={H - PAD.b} className="marker" />
        <circle cx={sx(at.threshold)} cy={sy(at.precision)} r="4.5" className="dot-precision" />
        <circle cx={sx(at.threshold)} cy={sy(at.recall)} r="4.5" className="dot-recall" />
      </svg>
      <figcaption className="legend">
        <span>
          <i className="sw sw-precision" /> Precision (alerts that are real fraud)
        </span>
        <span>
          <i className="sw sw-recall" /> Recall (fraud that gets caught)
        </span>
        <span>
          <i className="sw sw-f1" /> F1
        </span>
        <span>
          <i className="sw sw-marker" /> Your threshold
        </span>
      </figcaption>
    </figure>
  );
}

/** Estimated net benefit (€) against the threshold. */
export function NetBenefitChart({ points, threshold }: { points: CurvePoint[]; threshold: number }) {
  const max = Math.max(...points.map((p) => p.net_benefit), 1);
  const min = Math.min(0, ...points.map((p) => p.net_benefit));
  const sy = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const best = points.reduce((b, p) => (p.net_benefit > b.net_benefit ? p : b), points[0]);
  const ticks = [min, (min + max) / 2, max];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="nb-desc" preserveAspectRatio="xMidYMid meet">
        <desc id="nb-desc">
          Estimated net benefit for each threshold. Highest on this period: {eur(best.net_benefit, 0)} at {thr(best.threshold)}.
        </desc>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} className="grid" />
            <text x={PAD.l - 8} y={sy(v) + 4} textAnchor="end" className="tick">
              {v >= 1000 ? `€${(v / 1000).toFixed(1)}k` : `€${Math.round(v)}`}
            </text>
          </g>
        ))}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
          <text key={v} x={sx(v)} y={H - 8} textAnchor="middle" className="tick">
            {v.toFixed(1)}
          </text>
        ))}
        <path d={`${path(points, (p) => sy(p.net_benefit))} L${sx(points[points.length - 1].threshold)},${sy(min)} L${sx(points[0].threshold)},${sy(min)} Z`} className="area-net" />
        <path d={path(points, (p) => sy(p.net_benefit))} className="line line-net" />
        <line x1={sx(threshold)} x2={sx(threshold)} y1={PAD.t} y2={H - PAD.b} className="marker" />
      </svg>
      <figcaption className="legend">
        <span>
          <i className="sw sw-net" /> Estimated net benefit
        </span>
        <span>
          <i className="sw sw-marker" /> Your threshold
        </span>
        <span className="muted">
          Peak on this period: {eur(best.net_benefit, 0)} at {thr(best.threshold)}
        </span>
      </figcaption>
    </figure>
  );
}

export function ConfusionMatrix({ cm }: { cm: Confusion }) {
  const cells = [
    { k: "tp", label: "Fraud caught", sub: "actual fraud · blocked", v: cm.tp, cls: "cm-good" },
    { k: "fn", label: "Fraud missed", sub: "actual fraud · approved", v: cm.fn, cls: "cm-bad" },
    { k: "fp", label: "False alarms", sub: "honest · blocked", v: cm.fp, cls: "cm-warn" },
    { k: "tn", label: "Correctly approved", sub: "honest · approved", v: cm.tn, cls: "cm-neutral" },
  ];
  return (
    <div className="cm" role="table" aria-label="Confusion matrix">
      <div role="row" className="cm-head">
        <span role="columnheader" />
        <span role="columnheader">Model: Block</span>
        <span role="columnheader">Model: Approve</span>
      </div>
      <div role="row" className="cm-row">
        <span role="rowheader" className="cm-rh">
          Actually fraud
        </span>
        {[cells[0], cells[1]].map((c) => (
          <span role="cell" key={c.k} className={`cm-cell ${c.cls}`}>
            <strong className="mono">{num(c.v)}</strong>
            <span>{c.label}</span>
          </span>
        ))}
      </div>
      <div role="row" className="cm-row">
        <span role="rowheader" className="cm-rh">
          Actually honest
        </span>
        {[cells[2], cells[3]].map((c) => (
          <span role="cell" key={c.k} className={`cm-cell ${c.cls}`}>
            <strong className="mono">{num(c.v)}</strong>
            <span>{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function RateBars({ rows, unit }: { rows: GroupRate[]; unit: string }) {
  const max = Math.max(...rows.map((r) => r.fraud_rate));
  return (
    <ul className="rate-bars">
      {rows.map((r) => (
        <li key={r.group}>
          <span className="rb-label">
            {r.group}
            {unit}
          </span>
          <span className="rb-track" aria-hidden="true">
            <span className="rb-fill" style={{ width: `${(r.fraud_rate / max) * 100}%` }} />
          </span>
          <span className="rb-value mono">
            {pct(r.fraud_rate, 2)} <em>({num(r.fraud)})</em>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ImportanceBars({ rows }: { rows: Importance[] }) {
  const max = rows[0]?.mean_abs_shap ?? 1;
  return (
    <ul className="rate-bars">
      {rows.map((r) => (
        <li key={r.feature}>
          <span className="rb-label">{r.label}</span>
          <span className="rb-track" aria-hidden="true">
            <span className="rb-fill rb-dark" style={{ width: `${(r.mean_abs_shap / max) * 100}%` }} />
          </span>
          <span className="rb-value mono">{r.mean_abs_shap.toFixed(3)}</span>
        </li>
      ))}
    </ul>
  );
}
