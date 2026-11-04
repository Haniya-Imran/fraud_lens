import { eur, hhmm, pct, score, signed, thr } from "./format";
import type { Assumptions, PredictResponse, Transaction } from "./types";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function reportFileName(label: string): string {
  const safe = label.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "transaction";
  return `fraudlens-${safe}-${new Date().toISOString().slice(0, 10)}.html`;
}

/** A self-contained HTML report built only from the real API response. */
export function buildReportHtml(label: string, input: Transaction, r: PredictResponse, a: Assumptions): string {
  const p = r.prediction;
  const f = r.financial_impact;
  const contribs = r.explanation.contributions
    .map(
      (c) =>
        `<tr><td>${esc(c.label)}</td><td>${esc(c.feature === "Amount" ? eur(c.value) : c.feature === "Hour" ? hhmm(c.value) : c.value)}</td><td>${esc(
          c.value_note,
        )}</td><td class="${c.shap_value > 0 ? "up" : "down"}">${esc(signed(c.shap_value, 4))}</td></tr>`,
    )
    .join("");
  const inputs = Object.entries(input)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FraudLens report — ${esc(label)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#1C2026;line-height:1.5}
table{border-collapse:collapse;width:100%;margin:8px 0 24px}td,th{border-bottom:1px solid #D5DAE0;padding:6px 8px;text-align:left;font-size:14px}
.big{font-size:40px;font-weight:700;margin:8px 0}.up{color:#A3242A}.down{color:#0B7A5A}.muted{color:#4B5462;font-size:13px}
.warn{background:#FFF1D6;padding:10px 14px;border-radius:8px}</style></head><body>
<h1>FraudLens transaction report</h1>
<p class="muted">Transaction: ${esc(label)} · Generated ${esc(new Date(r.generated_at).toLocaleString())} · Model: ${esc(r.model.name)} v${esc(r.model.version)}</p>
<p class="big">Fraud score ${esc(score(p.score))} → ${esc(p.decision)}</p>
<p>Threshold ${esc(thr(p.threshold))} (model default ${esc(thr(r.model.default_threshold))}). A transaction is blocked when its score is at or above the threshold.</p>
${p.review_recommended ? `<p class="warn"><strong>Human review recommended.</strong> ${esc(p.review_reason)}</p>` : ""}
<h2>Why</h2><p>${esc(r.explanation.summary)}</p>
<table><thead><tr><th>Input</th><th>Value</th><th>Compared with training data</th><th>SHAP (${esc(r.explanation.output_space)})</th></tr></thead><tbody>${contribs}</tbody></table>
<p class="muted">${esc(r.explanation.note)} Base value ${esc(r.explanation.base_value)}; model output ${esc(r.explanation.model_output)}. Method: ${esc(r.explanation.method)}.</p>
<h2>Estimated financial impact (${esc(f.currency)})</h2>
<table><tbody>
<tr><td>Transaction amount</td><td>${esc(eur(f.amount))}</td></tr>
<tr><td>Loss if this is fraud and it is approved</td><td>${esc(eur(f.potential_loss_if_fraud_and_approved))}</td></tr>
<tr><td>Loss prevented if this is fraud and it is blocked (× ${esc(pct(a.prevention_effectiveness))} effectiveness)</td><td>${esc(eur(f.loss_prevented_if_fraud_and_blocked))}</td></tr>
<tr><td>Review cost if this is legitimate and it is blocked</td><td>${esc(eur(f.review_cost_if_legitimate_and_blocked))}</td></tr>
<tr><td>Expected loss if approved (score × amount)</td><td>${esc(eur(f.expected_loss_if_approved))}</td></tr>
</tbody></table><p class="muted">${esc(f.note)} The currency is assumed: the dataset does not state one.</p>
<h2>Inputs</h2><table><tbody>${inputs}</tbody></table>
<p class="muted">Decision support only — a person should confirm before a customer is affected. Trained on the public Credit Card Fraud Detection dataset (European cardholders, September 2013).</p></body></html>`;
}
