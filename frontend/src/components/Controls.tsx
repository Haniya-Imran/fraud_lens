import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { THRESHOLD_MAX, THRESHOLD_MIN } from "../lib/config";
import { clamp, eur, pct, thr } from "../lib/format";
import type { Assumptions } from "../lib/types";

/** Threshold slider + exact number box, bounded to 0.01–0.99. */
export function ThresholdControl({
  value,
  recommended,
  onChange,
  dark = false,
  id = "threshold",
}: {
  value: number;
  recommended: number;
  onChange: (t: number | null) => void;
  dark?: boolean;
  id?: string;
}) {
  const [text, setText] = useState(thr(value));
  useEffect(() => setText(thr(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) onChange(clamp(n, THRESHOLD_MIN, THRESHOLD_MAX));
    else setText(thr(value));
  };
  return (
    <div className={`thr-control ${dark ? "on-dark" : ""}`}>
      <div className="thr-row">
        <label htmlFor={id} className="thr-label">
          Decision threshold
        </label>
        <input
          aria-label="Threshold value"
          className="thr-number mono"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </div>
      <input
        id={id}
        type="range"
        min={THRESHOLD_MIN}
        max={THRESHOLD_MAX}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${thr(value)}`}
      />
      <div className="thr-scale mono">
        <span>{THRESHOLD_MIN} catch more</span>
        <span>{THRESHOLD_MAX} fewer alarms</span>
      </div>
      <div className="thr-foot">
        <span>
          Recommended: <strong className="mono">{thr(recommended)}</strong> (chosen on validation data)
        </span>
        <button type="button" className={`btn btn-sm ${dark ? "btn-ghost-dark" : "btn-light"}`} onClick={() => onChange(null)} disabled={value === recommended}>
          <RotateCcw size={14} aria-hidden="true" /> Use recommended
        </button>
      </div>
    </div>
  );
}

/** Editable money assumptions. Shown wherever money estimates appear. */
export function AssumptionsPanel({ value, onChange, onReset }: { value: Assumptions; onChange: (a: Assumptions) => void; onReset: () => void }) {
  const [cost, setCost] = useState(String(value.review_cost));
  useEffect(() => setCost(String(value.review_cost)), [value.review_cost]);
  const commitCost = () => {
    const n = Number(cost);
    if (Number.isFinite(n)) onChange({ ...value, review_cost: clamp(Math.round(n * 100) / 100, 0, 500) });
    else setCost(String(value.review_cost));
  };
  return (
    <div className="assumptions">
      <div className="field">
        <label htmlFor="eff">
          Prevention effectiveness <strong className="mono">{pct(value.prevention_effectiveness)}</strong>
        </label>
        <input
          id="eff"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.prevention_effectiveness}
          onChange={(e) => onChange({ ...value, prevention_effectiveness: Number(e.target.value) })}
        />
        <span className="hint">Share of a blocked fraud's amount that is actually recovered or never lost.</span>
      </div>
      <div className="field">
        <label htmlFor="cost">Review cost per false alarm (€)</label>
        <input
          id="cost"
          className="input mono"
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          onBlur={commitCost}
          onKeyDown={(e) => e.key === "Enter" && commitCost()}
        />
        <span className="hint">Analyst time and customer friction when an honest payment is stopped (0–500).</span>
      </div>
      <button type="button" className="btn btn-light btn-sm" onClick={onReset}>
        <RotateCcw size={14} aria-hidden="true" /> Reset assumptions (90%, {eur(5, 0)})
      </button>
    </div>
  );
}
