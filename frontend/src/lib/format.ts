export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const num = (x: number) => x.toLocaleString("en-US");

/** Euro amounts. The dataset does not state a currency; EUR is assumed (European cardholders). */
export const eur = (x: number, digits = 2) =>
  x.toLocaleString("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const thr = (x: number) => x.toFixed(2);
export const score = (x: number) => (x >= 0.9995 ? ">0.999" : x < 0.0005 ? "<0.001" : x.toFixed(3));

/** Hour of day (0–23.99) → "HH:MM". */
export function hhmm(hour: number): string {
  const total = Math.floor(hour * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const signed = (x: number, digits = 2) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const round2 = (x: number) => Math.round(x * 100) / 100;
