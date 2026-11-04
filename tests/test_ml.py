"""Data, model, threshold, money-metric and SHAP tests."""
import json

import joblib
import numpy as np
import pandas as pd
import pytest

from ml import business
from ml.explain import ExplanationError, FraudExplainer
from ml.features import FEATURE_ORDER, add_hour, load_raw, to_frame

from .conftest import ROOT, SAMPLES

MODELS = ROOT / "models"
DATA = ROOT / "data" / "raw" / "creditcard.csv"
META = json.loads((MODELS / "model_metadata.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def pipeline():
    return joblib.load(MODELS / "fraud_pipeline.joblib")


@pytest.fixture(scope="module")
def explainer(pipeline):
    return FraudExplainer(pipeline, joblib.load(MODELS / "shap_background.joblib"), META["reference_ranges"])


@pytest.mark.skipif(not DATA.exists(), reason="dataset not downloaded")
def test_dataset_schema_and_known_statistics():
    df = load_raw(DATA)
    assert df.shape == (284807, 31)
    assert int(df["Class"].sum()) == 492
    assert abs(df["Amount"].mean() - 88.3496) < 1e-3
    assert df.isna().sum().sum() == 0


def test_hour_feature():
    df = add_hour(pd.DataFrame({"Time": [0, 3600, 86400 + 7200, 172792]}))
    assert list(df["Hour"].round(3)) == [0.0, 1.0, 2.0, round((172792 % 86400) / 3600, 3)]


def test_time_split_is_ordered_and_disjoint():
    s = META["split"]
    assert s["train"]["time_range_s"][1] < s["validation"]["time_range_s"][0]
    assert s["validation"]["time_range_s"][1] < s["test"]["time_range_s"][0]
    assert s["train"]["rows"] + s["validation"]["rows"] + s["test"]["rows"] == 284807 - META["dataset"]["quality"]["exact_duplicate_rows_removed"]


def test_feature_order_and_frame(pipeline):
    tx = SAMPLES[0]["features"]
    frame = to_frame([dict(reversed(list(tx.items())))])
    assert list(frame.columns) == FEATURE_ORDER
    p = pipeline.predict_proba(frame)
    assert p.shape == (1, 2) and np.isclose(p.sum(), 1)


def test_model_reload_reproduces_stored_scores(pipeline):
    for s in SAMPLES:
        p = pipeline.predict_proba(to_frame([s["features"]]))[0, 1]
        assert abs(p - s["score"]) < 1e-5


def test_fraud_scores_higher_than_legit(pipeline):
    by = {s["label"]: s for s in SAMPLES}
    assert by["Fraud example"]["score"] > by["Legitimate example"]["score"]
    assert by["Fraud example"]["known_class"] == 1 and by["Legitimate example"]["known_class"] == 0


def test_business_metrics_hand_example():
    y = np.array([1, 1, 0, 0, 1])
    s = np.array([0.9, 0.2, 0.8, 0.1, 0.6])
    a = np.array([100.0, 50.0, 10.0, 5.0, 20.0])
    e = business.evaluate(y, s, a, 0.5, effectiveness=0.5, review_cost=3)
    assert e["confusion_matrix"] == {"tp": 2, "fp": 1, "fn": 1, "tn": 1}
    assert e["caught_fraud_value"] == 120.0
    assert e["prevented_loss"] == 60.0
    assert e["missed_fraud_loss"] == 50.0
    assert e["false_alarm_cost"] == 3.0
    assert e["net_benefit"] == 57.0
    assert e["precision"] == round(2 / 3, 4) and e["recall"] == round(2 / 3, 4)


def test_threshold_monotonic_tradeoff():
    d = np.load(MODELS / "test_eval.npz")
    rows = business.curve(d["y"], d["score"], d["amount"])
    alerts = [r["tp"] + r["fp"] for r in rows]
    assert all(a >= b for a, b in zip(alerts, alerts[1:]))  # stricter threshold => fewer alerts
    assert rows[0]["recall"] >= rows[-1]["recall"]


def test_threshold_selected_on_validation_not_test():
    d = np.load(MODELS / "validation_eval.npz")
    assert business.best_threshold(d["y"], d["score"], d["amount"]) == META["threshold"]["value"]
    assert 0.01 <= META["threshold"]["value"] <= 0.99


def test_reported_test_metrics_match_stored_scores():
    d = np.load(MODELS / "test_eval.npz")
    e = business.evaluate(d["y"], d["score"], d["amount"], META["threshold"]["value"])
    for k in ("precision", "recall", "net_benefit", "confusion_matrix"):
        assert e[k] == META["test_metrics"][k]
    assert int(d["y"].sum()) == META["split"]["test"]["fraud"]


def test_model_beats_baseline():
    base = next(c for c in META["comparison"] if c["complexity_rank"] == 0)
    assert META["test_metrics"]["pr_auc"] > base["validation"]["pr_auc"] * 50


def test_shap_additivity_and_directions(explainer, pipeline):
    frame = to_frame([s["features"] for s in SAMPLES])
    res = explainer.explain(frame)
    p = pipeline.predict_proba(frame)[:, 1]
    for r, pi in zip(res, p):
        total = r["base_value"] + sum(c["shap_value"] for c in r["contributions"])
        target = np.log(pi / (1 - pi)) if r["output_space"] == "log-odds" else pi
        assert abs(total - target) < 1e-3
        assert {c["feature"] for c in r["contributions"]} == set(FEATURE_ORDER)
    fraud = res[[s["label"] for s in SAMPLES].index("Fraud example")]
    assert sum(c["shap_value"] for c in fraud["contributions"]) > 0


def test_explainer_rejects_corrupted_values(explainer, monkeypatch):
    orig = explainer.shap_matrix
    monkeypatch.setattr(explainer, "shap_matrix", lambda X: (orig(X)[0] + 0.3, orig(X)[1]))
    with pytest.raises(ExplanationError):
        explainer.explain(to_frame([SAMPLES[0]["features"]]))


def test_fast_batch_explanations_are_additive(explainer):
    frame = to_frame([s["features"] for s in SAMPLES])
    slow = explainer.explain(frame)
    fast = explainer.explain(frame, top_n=3, fast=True)
    for s, f in zip(slow, fast):
        assert len(f["contributions"]) == 3
        assert abs(f["model_output"] - s["model_output"]) < 1e-6
