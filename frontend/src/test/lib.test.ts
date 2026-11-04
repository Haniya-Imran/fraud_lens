import modelInfo from "./fixtures/model-info.json";
import predict from "./fixtures/predict-fraud.json";
import samples from "./fixtures/samples.json";
import { ApiError, api, isPredictResponse, isThresholdMetrics } from "../lib/api";
import { parseBatchCsv, resultsToCsv, validateTransaction } from "../lib/csv";
import { eur, hhmm, score } from "../lib/format";
import { addEntry, MAX_HISTORY, type HistoryEntry } from "../lib/history";
import { buildReportHtml } from "../lib/report";
import batch from "./fixtures/batch.json";
import type { BatchResult } from "../lib/types";

const order = modelInfo.features.order;
const bounds = modelInfo.feature_bounds as Record<string, { min: number; max: number }>;
const tx = samples.samples[0].features as Record<string, number>;
const header = ["transaction_id", ...order].join(",");
const line = (id: string, t: Record<string, number>) => [id, ...order.map((f) => t[f])].join(",");

describe("formatting", () => {
  it("formats euros, hours and scores", () => {
    expect(eur(4495.14)).toBe("€4,495.14");
    expect(hhmm(22.482778)).toBe("22:28");
    expect(score(0.999652)).toBe(">0.999");
    expect(score(0.000005)).toBe("<0.001");
    expect(score(0.2566)).toBe("0.257");
  });
});

describe("response validation", () => {
  it("accepts a real predict response and rejects malformed ones", () => {
    expect(isPredictResponse(predict)).toBe(true);
    expect(isPredictResponse({ ...predict, prediction: { ...predict.prediction, score: 1.4 } })).toBe(false);
    expect(isPredictResponse({ ...predict, explanation: { ...predict.explanation, contributions: [] } })).toBe(false);
    expect(isThresholdMetrics({ threshold: 0.3 })).toBe(false);
  });

  it("maps HTTP errors to friendly ApiErrors", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    f.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Model missing" }), { status: 503 }));
    await expect(api.modelInfo()).rejects.toMatchObject({ kind: "unavailable", message: "Model missing" });
    f.mockResolvedValueOnce(new Response(JSON.stringify({ message: "bad", details: [{ field: "transaction.Amount", message: "x" }] }), { status: 422 }));
    await expect(api.predict(tx, 0.3, { prevention_effectiveness: 0.9, review_cost: 5 })).rejects.toMatchObject({ kind: "validation", status: 422 });
    f.mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    await expect(api.predict(tx, 0.3, { prevention_effectiveness: 0.9, review_cost: 5 })).rejects.toMatchObject({ kind: "invalid_response" });
    f.mockRejectedValueOnce(new TypeError("fail"));
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
    f.mockRestore();
  });

  it("sends threshold and assumptions in the predict body", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(predict), { status: 200 }));
    await api.predict(tx, 0.4, { prevention_effectiveness: 0.5, review_cost: 9 });
    const body = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ threshold: 0.4, assumptions: { prevention_effectiveness: 0.5, review_cost: 9 } });
    expect(body.transaction.Amount).toBe(tx.Amount);
    f.mockRestore();
  });
});

describe("single transaction validation", () => {
  const strings = Object.fromEntries(order.map((f) => [f, String(tx[f])]));
  it("accepts valid values", () => {
    const r = validateTransaction(strings, order, bounds);
    expect(r.errors).toEqual({});
    expect(r.tx.Amount).toBe(tx.Amount);
  });
  it("rejects empty, non-numeric and out-of-range values", () => {
    const r = validateTransaction({ ...strings, Amount: "-3", Hour: "24", V1: "abc", V2: "" }, order, bounds);
    expect(Object.keys(r.errors).sort()).toEqual(["Amount", "Hour", "V1", "V2"]);
  });
});

describe("batch CSV", () => {
  it("parses a valid file", () => {
    const r = parseBatchCsv(`${header}\n${line("a1", tx)}\n${line("b2", tx)}\n`, order, bounds);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].transaction_id).toBe("a1");
  });
  it("reports missing columns and bad rows", () => {
    expect(parseBatchCsv("Amount,V1\n1,2", order, bounds).errors[0]).toMatch(/Missing required column/);
    const bad = parseBatchCsv(`${header}\n${line("a1", { ...tx, Amount: -5 })}`, order, bounds);
    expect(bad.rows).toHaveLength(0);
    expect(bad.errors[0]).toMatch(/Row 2: Amount/);
  });
  it("converts the raw Time column and ignores the Class label", () => {
    const cols = ["Time", ...order.filter((f) => f !== "Hour"), "Class"];
    const vals = [86400 + 3600 * 5, ...order.filter((f) => f !== "Hour").map((f) => tx[f]), 1];
    const r = parseBatchCsv(`${cols.join(",")}\n${vals.join(",")}`, order, bounds);
    expect(r.rows[0].Hour).toBe(5);
    expect("Class" in r.rows[0]).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/Class column was ignored/);
  });
  it("enforces the row limit", () => {
    const rows = Array.from({ length: 1001 }, (_, i) => line(`r${i}`, tx)).join("\n");
    expect(parseBatchCsv(`${header}\n${rows}`, order, bounds).errors[0]).toMatch(/limit is 1000/);
  });
  it("writes a results CSV", () => {
    const csv = resultsToCsv(batch.results as BatchResult[]);
    expect(csv.split("\n")[0]).toContain("fraud_score");
    expect(csv).toContain("a1,349.08");
  });
});

describe("history and report", () => {
  it("keeps only the most recent entries", () => {
    const e = (i: number): HistoryEntry => ({ id: `${i}`, at: "", label: `t${i}`, input: tx, score: 0.1, threshold: 0.26, decision: "Approve", review: false });
    let h: HistoryEntry[] = [];
    for (let i = 0; i < 20; i++) h = addEntry(h, e(i));
    expect(h).toHaveLength(MAX_HISTORY);
    expect(h[0].id).toBe("19");
  });
  it("builds an escaped HTML report from the real response", () => {
    const html = buildReportHtml("<script>x</script>", tx, predict as never, { prevention_effectiveness: 0.9, review_cost: 5 });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("Block");
    expect(html).toContain("€349.08");
  });
});
