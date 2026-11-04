"""Threshold and money-impact calculations on LABELLED evaluation data.

Definitions (all amounts in the dataset currency, EUR):
* caught fraud value  = sum(Amount) of real frauds the model flagged (true positives)
* prevented loss      = caught fraud value x prevention_effectiveness   (assumption)
* missed fraud loss   = sum(Amount) of real frauds the model did NOT flag (false negatives)
* false-alarm cost    = number of legitimate payments flagged (false positives) x review_cost (assumption)
* net benefit         = prevented loss - false-alarm cost

These are estimates for a historical, labelled test period. They are not
guaranteed savings: a flagged fraud is not proof a loss would have occurred
or that blocking it prevented one.
"""
from __future__ import annotations

import numpy as np

DEFAULT_EFFECTIVENESS = 0.90
DEFAULT_REVIEW_COST = 5.0
THRESHOLD_GRID = np.round(np.arange(0.01, 1.00, 0.01), 2)


def evaluate(y: np.ndarray, score: np.ndarray, amount: np.ndarray, threshold: float,
             effectiveness: float = DEFAULT_EFFECTIVENESS, review_cost: float = DEFAULT_REVIEW_COST) -> dict:
    y = np.asarray(y).astype(int)
    flagged = np.asarray(score) >= threshold
    amount = np.asarray(amount, dtype=float)
    tp = flagged & (y == 1)
    fp = flagged & (y == 0)
    fn = ~flagged & (y == 1)
    tn = ~flagged & (y == 0)
    n_tp, n_fp, n_fn, n_tn = int(tp.sum()), int(fp.sum()), int(fn.sum()), int(tn.sum())
    caught = float(amount[tp].sum())
    missed = float(amount[fn].sum())
    prevented = caught * effectiveness
    fa_cost = n_fp * review_cost
    precision = n_tp / (n_tp + n_fp) if (n_tp + n_fp) else 0.0
    recall = n_tp / (n_tp + n_fn) if (n_tp + n_fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    fpr = n_fp / (n_fp + n_tn) if (n_fp + n_tn) else 0.0
    return {
        "threshold": round(float(threshold), 4),
        "confusion_matrix": {"tp": n_tp, "fp": n_fp, "fn": n_fn, "tn": n_tn},
        "alerts": n_tp + n_fp,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_positive_rate": round(fpr, 6),
        "caught_fraud_value": round(caught, 2),
        "prevented_loss": round(prevented, 2),
        "missed_fraud_loss": round(missed, 2),
        "false_alarm_cost": round(fa_cost, 2),
        "net_benefit": round(prevented - fa_cost, 2),
        "total_fraud_value": round(caught + missed, 2),
        "assumptions": {"prevention_effectiveness": effectiveness, "review_cost_per_false_alarm": review_cost},
    }


def curve(y, score, amount, effectiveness=DEFAULT_EFFECTIVENESS, review_cost=DEFAULT_REVIEW_COST) -> list[dict]:
    rows = []
    for t in THRESHOLD_GRID:
        e = evaluate(y, score, amount, float(t), effectiveness, review_cost)
        rows.append({
            "threshold": e["threshold"],
            "precision": e["precision"],
            "recall": e["recall"],
            "f1": e["f1"],
            "tp": e["confusion_matrix"]["tp"],
            "fp": e["confusion_matrix"]["fp"],
            "fn": e["confusion_matrix"]["fn"],
            "net_benefit": e["net_benefit"],
            "prevented_loss": e["prevented_loss"],
            "missed_fraud_loss": e["missed_fraud_loss"],
            "false_alarm_cost": e["false_alarm_cost"],
        })
    return rows


def best_threshold(y, score, amount, effectiveness=DEFAULT_EFFECTIVENESS, review_cost=DEFAULT_REVIEW_COST) -> float:
    """Threshold with the highest net benefit; ties go to the higher (stricter) threshold."""
    rows = curve(y, score, amount, effectiveness, review_cost)
    best = max(rows, key=lambda r: (r["net_benefit"], r["threshold"]))
    return float(best["threshold"])
