import { useCallback, useEffect, useRef, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export function supports3D(): boolean {
  try {
    return typeof CSS !== "undefined" && CSS.supports("transform-style", "preserve-3d") && CSS.supports("perspective", "1000px");
  } catch {
    return false;
  }
}

type Rot = { x: number; y: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Drag-to-rotate with spring-back. While dragging the scene follows the pointer;
 * on release it springs back to its resting angle. Hover adds a gentle parallax.
 */
export function useTilt(rest: Rot, { maxX = 18, maxY = 32, disabled = false } = {}) {
  const [rot, setRot] = useState<Rot>(rest);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; rot: Rot } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      start.current = { px: e.clientX, py: e.clientY, rot };
      setDragging(true);
    },
    [disabled, rot],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      if (start.current) {
        const dx = e.clientX - start.current.px;
        const dy = e.clientY - start.current.py;
        setRot({
          x: clamp(start.current.rot.x - dy * 0.25, rest.x - maxX, rest.x + maxX),
          y: clamp(start.current.rot.y + dx * 0.35, rest.y - maxY, rest.y + maxY),
        });
      } else if (e.pointerType === "mouse") {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        setRot({ x: rest.x - ny * 6, y: rest.y + nx * 8 });
      }
    },
    [disabled, maxX, maxY, rest.x, rest.y],
  );

  const release = useCallback(() => {
    start.current = null;
    setDragging(false);
    setRot(rest);
  }, [rest]);

  return {
    rot,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release, onPointerLeave: release },
  };
}
