import { useMemo } from "react";
import { score as fmtScore, thr } from "../../lib/format";
import type { Decision } from "../../lib/types";
import { supports3D, usePrefersReducedMotion, useTilt } from "./useTilt";

const REST = { x: 10, y: -20 };

/** 3D dial showing the fraud score and decision. Ring colour follows the decision. */
export function RiskDial({ decision }: { decision: Decision | null }) {
  const reduced = usePrefersReducedMotion();
  const has3D = useMemo(supports3D, []);
  const { rot, dragging, handlers } = useTilt(REST, { disabled: reduced || !has3D, maxX: 14, maxY: 24 });
  const tone = !decision ? "idle" : decision.flagged ? "block" : decision.review_recommended ? "review" : "approve";
  const label = decision
    ? `Fraud score ${fmtScore(decision.score)}, decision ${decision.decision} at threshold ${thr(decision.threshold)}`
    : "No transaction checked yet";
  // Arc showing the score (0–1) around the dial.
  const r = 124;
  const c = 2 * Math.PI * r;
  return (
    <div className={`dial-stage ${has3D ? "" : "flat"} ${dragging ? "dragging" : ""}`} role="img" aria-label={label} {...handlers}>
      <div
        className={`dial tone-${tone}`}
        style={{ transform: `rotateY(${rot.y}deg) rotateX(${rot.x}deg)`, transition: dragging ? "transform .05s linear" : "transform .9s var(--ease-spring)" }}
      >
        <div className="d-layer d-1" />
        <div className="d-layer d-2" />
        <div className="d-layer d-face" />
        <svg className="d-layer d-arc" viewBox="0 0 280 280" aria-hidden="true">
          <circle cx="140" cy="140" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="8" />
          {decision && (
            <circle
              cx="140"
              cy="140"
              r={r}
              fill="none"
              className="d-arc-fill"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0.004, decision.score) * c} ${c}`}
              transform="rotate(-90 140 140)"
            />
          )}
        </svg>
        <div className="d-layer d-ring" />
        <div className="d-layer d-text">
          <span className="d-k">Fraud score</span>
          <span className="d-v mono">{decision ? fmtScore(decision.score) : "—"}</span>
          {decision ? (
            <span className={`badge ${decision.flagged ? "badge-block" : "badge-approve"}`}>{decision.decision}</span>
          ) : (
            <span className="d-k">Pick a sample and check it</span>
          )}
        </div>
      </div>
      <div className="d-shadow" />
    </div>
  );
}
