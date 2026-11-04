import { MAX_BATCH_ROWS } from "./config";
import type { BatchResult, Transaction } from "./types";

export type Bounds = Record<string, { min: number; max: number }>;
export type ParsedBatch = {
  rows: (Transaction & { transaction_id?: string })[];
  errors: string[];
  warnings: string[];
};

const ID_RE = /^[A-Za-z0-9_.:-]{0,64}$/;

/** Split one CSV line, honouring simple double-quoted fields. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse and validate a batch CSV in the browser before anything is sent.
 * Required columns: Hour (or the dataset's raw Time), Amount, V1..V28.
 * Optional: transaction_id. A Class label column is ignored, never sent.
 */
export function parseBatchCsv(text: string, order: string[], bounds: Bounds): ParsedBatch {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: [], errors: ["The file needs a header row and at least one transaction."], warnings };

  const header = splitLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const idx = (name: string) => header.indexOf(name);
  const useTime = idx("Hour") < 0 && idx("Time") >= 0;
  if (useTime) warnings.push("No Hour column found, so Hour was calculated from the dataset's Time column.");
  const missing = order.filter((f) => (f === "Hour" ? idx("Hour") < 0 && !useTime : idx(f) < 0));
  if (missing.length) return { rows: [], errors: [`Missing required column(s): ${missing.join(", ")}.`], warnings };
  if (idx("Class") >= 0) warnings.push("The Class column was ignored — labels are never sent to the model.");
  const known = new Set([...order, "transaction_id", "Class", "Time"]);
  const extra = header.filter((h) => !known.has(h));
  if (extra.length) warnings.push(`Ignored unknown column(s): ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? "…" : ""}.`);

  const body = lines.slice(1);
  if (body.length > MAX_BATCH_ROWS) {
    return { rows: [], errors: [`The file has ${body.length} rows; the limit is ${MAX_BATCH_ROWS} per batch.`], warnings };
  }

  const rows: ParsedBatch["rows"] = [];
  body.forEach((line, i) => {
    const cells = splitLine(line);
    const rowNo = i + 2;
    const tx: Transaction & { transaction_id?: string } = {};
    const rowErrors: string[] = [];
    for (const f of order) {
      const raw = f === "Hour" && useTime ? cells[idx("Time")] : cells[idx(f)];
      const v = raw === undefined || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(v)) {
        rowErrors.push(`${f} is not a number`);
        continue;
      }
      const value = f === "Hour" && useTime ? (v % 86400) / 3600 : v;
      const b = bounds[f];
      if (b && (value < b.min || (f === "Hour" ? value >= b.max : value > b.max))) {
        rowErrors.push(`${f} must be between ${b.min} and ${b.max}`);
        continue;
      }
      tx[f] = value;
    }
    const idCol = idx("transaction_id");
    if (idCol >= 0) {
      const id = cells[idCol] ?? "";
      if (!ID_RE.test(id)) rowErrors.push("transaction_id may only use letters, digits and _ . : - (max 64)");
      else if (id) tx.transaction_id = id;
    }
    if (rowErrors.length) errors.push(`Row ${rowNo}: ${rowErrors.slice(0, 3).join("; ")}.`);
    else rows.push(tx);
  });
  return { rows: errors.length ? [] : rows, errors: errors.slice(0, 20), warnings };
}

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function resultsToCsv(results: BatchResult[]): string {
  const head = ["transaction_id", "amount_eur", "hour", "fraud_score", "threshold", "decision", "review_recommended", "top_factor_1", "top_factor_2", "top_factor_3"];
  const lines = results.map((r, i) =>
    [
      r.transaction_id ?? `row-${i + 1}`,
      r.amount.toFixed(2),
      r.hour.toFixed(2),
      r.score.toFixed(6),
      r.threshold.toFixed(2),
      r.decision,
      r.review_recommended ? "yes" : "no",
      ...[0, 1, 2].map((k) => (r.top_factors[k] ? `${r.top_factors[k].feature} (${r.top_factors[k].shap_value > 0 ? "+" : ""}${r.top_factors[k].shap_value.toFixed(3)})` : "")),
    ]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Validate one transaction against the server-provided bounds. */
export function validateTransaction(values: Record<string, string>, order: string[], bounds: Bounds) {
  const errors: Record<string, string> = {};
  const tx: Transaction = {};
  for (const f of order) {
    const raw = (values[f] ?? "").trim();
    const v = raw === "" ? NaN : Number(raw);
    const b = bounds[f];
    if (!Number.isFinite(v)) errors[f] = "Enter a number.";
    else if (b && (v < b.min || (f === "Hour" ? v >= b.max : v > b.max)))
      errors[f] = f === "Hour" ? "Use 0 to 23.99." : `Use ${b.min} to ${b.max.toLocaleString("en-US")}.`;
    else tx[f] = v;
  }
  return { tx, errors };
}
