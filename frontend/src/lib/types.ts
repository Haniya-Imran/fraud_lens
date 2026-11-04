export type Transaction = Record<string, number>;

export type Confusion = { tp: number; fp: number; fn: number; tn: number };

export type ThresholdMetrics = {
  split?: "test" | "validation";
  threshold: number;
  confusion_matrix: Confusion;
  alerts: number;
  precision: number;
  recall: number;
  f1: number;
  false_positive_rate: number;
  caught_fraud_value: number;
  prevented_loss: number;
  missed_fraud_loss: number;
  false_alarm_cost: number;
  net_benefit: number;
  total_fraud_value: number;
  assumptions: { prevention_effectiveness: number; review_cost_per_false_alarm: number };
};

export type CurvePoint = {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  net_benefit: number;
  prevented_loss: number;
  missed_fraud_loss: number;
  false_alarm_cost: number;
};

export type CurveResponse = { split: string; points: CurvePoint[] };

export type Importance = { feature: string; label: string; mean_abs_shap: number };

export type RiskRow = { row_id: number; known_class: number; score: number; amount: number; hour: number };

export type GroupRate = { group: string; fraud_rate: number; fraud: number; rows: number };

export type Overview = {
  dataset_totals: {
    rows: number;
    fraud: number;
    legitimate: number;
    fraud_rate: number;
    amount_mean_fraud: number;
    amount_mean_legitimate: number;
  };
  fraud_rate_by_hour: GroupRate[];
  fraud_rate_by_amount: GroupRate[];
  top_risk_test: RiskRow[];
  global_importance: Importance[];
  default_threshold: number;
  assumption_defaults: { prevention_effectiveness: number; review_cost_per_false_alarm: number };
  currency: string;
  test_period: { rows: number; fraud: number; time_range_s: [number, number] };
};

export type SplitInfo = { rows: number; fraud: number; time_range_s: [number, number] };

export type Comparison = {
  model: string;
  complexity_rank: number;
  validation: { pr_auc: number; roc_auc: number; brier: number };
  fit_seconds: number;
  validation_at_best_threshold: { threshold: number; precision: number; recall: number; net_benefit: number };
};

export type ModelInfo = {
  model_name: string;
  model_version: string;
  trained_at: string;
  dataset: {
    name: string;
    description: string;
    original_source: string;
    download_mirror: string;
    other_mirror: string;
    license: string;
    citation: string;
    sha256: string;
    quality: Record<string, number | string>;
  };
  currency: string;
  currency_note: string;
  split: { method: string; train: SplitInfo; validation: SplitInfo; test: SplitInfo };
  imbalance_handling: string;
  selection_rule: string;
  comparison: Comparison[];
  threshold: { value: number; method: string; f1_optimal_on_validation: number; limitation: string; bounds: [number, number] };
  test_metrics: ThresholdMetrics & { pr_auc: number; roc_auc: number; brier: number };
  test_metrics_at_0_5: ThresholdMetrics;
  overfitting_check: { train_pr_auc: number; validation_pr_auc: number; test_pr_auc: number; note: string };
  calibration_note: string;
  latency_ms_single_prediction: number;
  shap: { method: string; output_space: string; background_rows: number; note: string };
  global_importance: Importance[];
  assumption_defaults: { prevention_effectiveness: number; review_cost_per_false_alarm: number };
  features: { order: string[] };
  feature_bounds: Record<string, { min: number; max: number }>;
  limitations: string[];
};

export type Sample = { label: string; row_id: number; known_class: number; score: number; features: Transaction };
export type SamplesResponse = { note: string; samples: Sample[] };

export type Contribution = {
  feature: string;
  label: string;
  value: number;
  shap_value: number;
  direction: "raises_risk" | "lowers_risk";
  value_note: string;
};

export type Decision = {
  score: number;
  threshold: number;
  flagged: boolean;
  decision: "Block" | "Approve";
  review_recommended: boolean;
  review_reason: string | null;
};

export type PredictResponse = {
  prediction: Decision;
  explanation: {
    method: string;
    output_space: string;
    base_value: number;
    base_score: number;
    model_output: number;
    summary: string;
    contributions: Contribution[];
    top_raising: Contribution[];
    top_lowering: Contribution[];
    note: string;
  };
  financial_impact: {
    currency: string;
    amount: number;
    potential_loss_if_fraud_and_approved: number;
    loss_prevented_if_fraud_and_blocked: number;
    review_cost_if_legitimate_and_blocked: number;
    expected_loss_if_approved: number;
    note: string;
  };
  model: { name: string; version: string; default_threshold: number };
  generated_at: string;
};

export type BatchResult = Decision & {
  transaction_id: string | null;
  amount: number;
  hour: number;
  top_factors: { feature: string; label: string; shap_value: number }[];
};

export type BatchResponse = { threshold: number; rows: number; flagged: number; flagged_amount: number; results: BatchResult[] };

export type Assumptions = { prevention_effectiveness: number; review_cost: number };
