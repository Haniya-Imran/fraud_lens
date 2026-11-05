import { useEffect, useMemo, useRef, useState } from "react";
import { eur, score, thr } from "../../lib/format";
import { supports3D, usePrefersReducedMotion, useTilt } from "./useTilt";

const REST = { x: 0, y: 0 };
const DESIGN_WIDTH = 580;

function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setFit(Math.min(1, el.clientWidth / DESIGN_WIDTH));
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return { ref, fit };
}

type Props = {
  netBenefit?: number;
  threshold?: number;
  blocked?: { amount: number; score: number; rowId: number };
};

/**
 * Landing-page 3D "fraud radar": tilted rings around a glowing orb, built from
 * CSS layers (preserve-3d). Drag to rotate; it springs back on release.
 * The floating cards show real values from the API.
 */
export function Radar({ netBenefit, threshold, blocked }: Props) {
  const reduced = usePrefersReducedMotion();
  const has3D = useMemo(supports3D, []);
  const { rot, dragging, handlers } = useTilt(REST, { disabled: reduced || !has3D, maxX: 16, maxY: 28 });
  const { ref, fit } = useFit();
  return (
    <div className="radar-fit" ref={ref} style={{ ["--fit" as string]: fit }}>
      <div
        className={`radar-stage ${has3D ? "" : "flat"} ${reduced ? "still" : ""} ${dragging ? "dragging" : ""}`}
        role="img"
        aria-label="3D fraud radar illustration. Drag to rotate."
        {...handlers}
      >
        <div
          className="radar"
          style={{
            transform: `rotateX(${62 + rot.x}deg) rotateZ(${20 + rot.y}deg)`,
            transition: dragging ? "transform 0.05s linear" : "transform 0.9s var(--ease-spring)",
          }}
        >
          <div className="r-ring r-1" />
          <div className="r-ring r-2" />
          <div className="r-ring r-3" />
          <div className="r-sweep" />
          {[
            [18, 30],
            [74, 22],
            [64, 78],
          ].map(([l, t]) => (
            <span key={`${l}-${t}`} className="r-dot" style={{ left: `${l}%`, top: `${t}%` }} />
          ))}
          <span className="r-dot r-dot-bad" style={{ left: "38%", top: "66%" }} />
        </div>
        <div className="r-orb" />
        <div className="r-shadow" />
        {blocked && (
          <div className="glass g-tx bob">
            <span>Transaction #{blocked.rowId}</span>
            <b className="mono ink-fraud">
              Blocked · {score(blocked.score)}
            </b>
            <span className="mono">{eur(blocked.amount)}</span>
          </div>
        )}
        {netBenefit !== undefined && threshold !== undefined && (
          <div className="glass g-saved bob slow">
            <span>Estimated money saved</span>
            <b className="mono ink-green">{eur(netBenefit)}</b>
            <span>test period · threshold {thr(threshold)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
