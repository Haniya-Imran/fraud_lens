import { useEffect, useMemo, useRef, useState } from "react";
import { eur, score, thr } from "../../lib/format";
import { supports3D, usePrefersReducedMotion, useTilt } from "./useTilt";

const REST = { x: 10, y: -26 };
const DESIGN_WIDTH = 560;

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
  blocked?: { amount: number; score: number };
};

/**
 * Landing-page 3D vault door built from stacked CSS layers (preserve-3d).
 * Drag to rotate; it springs back on release. Floating cards show real values
 * from the API: the test-period net benefit and a real blocked test transaction.
 */
export function Vault({ netBenefit, threshold, blocked }: Props) {
  const reduced = usePrefersReducedMotion();
  const has3D = useMemo(supports3D, []);
  const { rot, dragging, handlers } = useTilt(REST, { disabled: reduced || !has3D, maxX: 14, maxY: 26 });
  const { ref, fit } = useFit();
  const bolts = [
    [186, 8],
    [186, 364],
    [8, 186],
    [364, 186],
  ];
  return (
    <div className="vault-fit" ref={ref} style={{ ["--fit" as string]: fit }}>
      <div
        className={`vault-stage ${has3D ? "" : "flat"} ${reduced ? "still" : ""} ${dragging ? "dragging" : ""}`}
        role="img"
        aria-label="3D vault door illustration. Drag to rotate."
        {...handlers}
      >
        <div
          className="vault"
          style={{
            transform: `rotateY(${rot.y}deg) rotateX(${rot.x}deg)`,
            transition: dragging ? "transform 0.05s linear" : "transform 0.9s var(--ease-spring)",
          }}
        >
          <div className="v-layer v-frame-back" />
          <div className="v-layer v-frame" />
          <div className="v-layer v-disc v-d1" />
          <div className="v-layer v-disc v-d2" />
          <div className="v-layer v-disc v-d3" />
          <div className="v-layer v-disc v-face" />
          <div className="v-layer v-ring" />
          {bolts.map(([l, t]) => (
            <div key={`${l}-${t}`} className="v-layer v-bolt" style={{ left: l, top: t }} />
          ))}
          {[0, 60, 120].map((d) => (
            <div key={d} className="v-layer v-spoke" style={{ ["--r" as string]: `${d}deg` }} />
          ))}
          <div className="v-layer v-hub">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </div>
        </div>
        <div className="v-shadow" />
        {netBenefit !== undefined && threshold !== undefined && (
          <div className="float-card fc-saved bob">
            <span className="fc-k">Estimated money saved</span>
            <span className="fc-v mono">{eur(netBenefit, 0)}</span>
            <span className="fc-s">test period · threshold {thr(threshold)}</span>
          </div>
        )}
        {blocked && (
          <div className="float-card fc-tx bob slow">
            <div className="fc-row">
              <span className="mono fc-s">Real test transaction</span>
              <span className="badge badge-block">Blocked</span>
            </div>
            <span className="fc-v mono">{eur(blocked.amount)}</span>
            <span className="fc-s">fraud score {score(blocked.score)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
