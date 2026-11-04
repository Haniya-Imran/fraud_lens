"""Train, compare, tune and save the FraudLens model.

    python -m ml.train

Design choices
* Time-ordered split (60% train / 20% validation / 20% test by `Time`): fraud
  patterns drift, and a model is always used on transactions that come after
  the data it learned from. A random split would leak future patterns.
* Exact duplicate rows (1,081) are dropped before splitting so the same record
  cannot appear in both training and evaluation.
* Imbalance strategies compared on the validation split: none, class weights,
  SMOTE (applied inside the training pipeline only), and boosted trees.
* Model chosen by validation PR-AUC (accuracy is meaningless at 0.17% fraud).
* Threshold chosen on validation by maximum estimated net benefit. The test
  split is used once, at the end, for reporting only.
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline as ImbPipeline
from lightgbm import LGBMClassifier
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, precision_recall_curve, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from . import business
from .explain import FraudExplainer
from .features import CURRENCY, FEATURE_ORDER, TARGET, add_hour, load_raw

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "raw" / "creditcard.csv"
MODELS = ROOT / "models"
SEED = 42

DATASET = {
    "name": "Credit Card Fraud Detection (ULB Machine Learning Group / Worldline)",
    "description": "Card transactions by European cardholders over two days in September 2013. V1–V28 are PCA components released for confidentiality.",
    "original_source": "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud",
    "download_mirror": "https://github.com/stat432/credit-analysis/raw/main/data-raw/creditcard.csv.zip",
    "other_mirror": "https://zenodo.org/records/7395559 (CC BY 4.0 copy)",
    "license": "Kaggle lists the Database Contents License (DbCL) v1.0; the Zenodo copy is CC BY 4.0.",
    "citation": "A. Dal Pozzolo, O. Caelen, R. A. Johnson, G. Bontempi. Calibrating Probability with Undersampling for Unbalanced Classification. IEEE SSCI, 2015.",
}


def identity() -> FunctionTransformer:
    return FunctionTransformer(feature_names_out="one-to-one")


def candidates() -> dict:
    """name -> (pipeline factory, complexity rank)."""
    return {
        "Baseline (class prior)": (lambda: Pipeline([("prep", identity()), ("model", DummyClassifier(strategy="prior"))]), 0),
        "Logistic Regression": (lambda: Pipeline([("prep", StandardScaler()), ("model", LogisticRegression(max_iter=3000))]), 1),
        "Logistic Regression + class weights": (
            lambda: Pipeline([("prep", StandardScaler()), ("model", LogisticRegression(max_iter=3000, class_weight="balanced"))]), 1),
        "Logistic Regression + SMOTE": (
            lambda: ImbPipeline([("prep", StandardScaler()), ("smote", SMOTE(random_state=SEED, sampling_strategy=0.1)),
                                 ("model", LogisticRegression(max_iter=3000))]), 2),
        "Random Forest + class weights": (
            lambda: Pipeline([("prep", identity()), ("model", RandomForestClassifier(
                n_estimators=300, min_samples_leaf=2, class_weight="balanced_subsample", n_jobs=-1, random_state=SEED))]), 3),
        "LightGBM": (
            lambda: Pipeline([("prep", identity()), ("model", LGBMClassifier(
                n_estimators=500, learning_rate=0.03, num_leaves=31, min_child_samples=50, subsample=0.8, subsample_freq=1,
                colsample_bytree=0.8, reg_lambda=1.0, random_state=SEED, verbose=-1))]), 3),
        "LightGBM + class weights": (
            lambda: Pipeline([("prep", identity()), ("model", LGBMClassifier(
                n_estimators=500, learning_rate=0.03, num_leaves=31, min_child_samples=50, subsample=0.8, subsample_freq=1,
                colsample_bytree=0.8, reg_lambda=1.0, scale_pos_weight=25, random_state=SEED, verbose=-1))]), 3),
    }


def ranking_metrics(y, p) -> dict:
    return {
        "pr_auc": round(float(average_precision_score(y, p)), 4),
        "roc_auc": round(float(roc_auc_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 6),
    }


def as_sklearn(pipe) -> Pipeline:
    """Serve without the resampler: SMOTE only matters during fitting."""
    if isinstance(pipe, ImbPipeline):
        return Pipeline([("prep", pipe.named_steps["prep"]), ("model", pipe.named_steps["model"])])
    return pipe


def latency_ms(pipe, X: pd.DataFrame) -> float:
    row = X.iloc[[0]]
    for _ in range(5):
        pipe.predict_proba(row)
    t = time.perf_counter()
    for _ in range(50):
        pipe.predict_proba(row)
    return round((time.perf_counter() - t) / 50 * 1000, 3)


def main() -> None:
    t0 = time.time()
    MODELS.mkdir(exist_ok=True)
    raw = load_raw(DATA)
    sha = hashlib.sha256(DATA.read_bytes()).hexdigest()
    quality = {
        "rows": int(len(raw)),
        "columns": int(raw.shape[1]),
        "fraud": int(raw[TARGET].sum()),
        "legitimate": int((raw[TARGET] == 0).sum()),
        "fraud_rate": round(float(raw[TARGET].mean()), 6),
        "missing_values": int(raw.isna().sum().sum()),
        "exact_duplicate_rows_removed": int(raw.duplicated().sum()),
        "fraud_rows_among_removed_duplicates": int(raw[raw.duplicated()][TARGET].sum()),
        "zero_amount_rows": int((raw["Amount"] == 0).sum()),
        "amount_max": float(raw["Amount"].max()),
        "amount_mean_fraud": round(float(raw.loc[raw[TARGET] == 1, "Amount"].mean()), 2),
        "amount_mean_legitimate": round(float(raw.loc[raw[TARGET] == 0, "Amount"].mean()), 2),
        "leakage_review": "No post-transaction fields exist. Raw Time (position inside the 2-day window) is replaced by hour of day; the split itself is by time.",
    }
    print(json.dumps(quality, indent=1))

    df = add_hour(raw.drop_duplicates()).sort_values("Time", kind="stable").reset_index(drop=True)
    n = len(df)
    a, b = int(n * 0.6), int(n * 0.8)
    train, val, test = df.iloc[:a], df.iloc[a:b], df.iloc[b:]
    Xtr, ytr = train[FEATURE_ORDER], train[TARGET].to_numpy()
    Xva, yva = val[FEATURE_ORDER], val[TARGET].to_numpy()
    Xte, yte = test[FEATURE_ORDER], test[TARGET].to_numpy()
    split = {
        "method": "time-ordered (by Time), 60/20/20",
        "train": {"rows": len(train), "fraud": int(ytr.sum()), "time_range_s": [float(train.Time.min()), float(train.Time.max())]},
        "validation": {"rows": len(val), "fraud": int(yva.sum()), "time_range_s": [float(val.Time.min()), float(val.Time.max())]},
        "test": {"rows": len(test), "fraud": int(yte.sum()), "time_range_s": [float(test.Time.min()), float(test.Time.max())]},
    }
    print(split)

    comparison, fitted = [], {}
    for name, (factory, rank) in candidates().items():
        t = time.time()
        pipe = factory().fit(Xtr, ytr)
        p = pipe.predict_proba(Xva)[:, 1]
        m = ranking_metrics(yva, p)
        thr = business.best_threshold(yva, p, val["Amount"].to_numpy()) if rank else 0.5
        biz = business.evaluate(yva, p, val["Amount"].to_numpy(), thr)
        comparison.append({"model": name, "complexity_rank": rank, "validation": m, "fit_seconds": round(time.time() - t, 1),
                           "validation_at_best_threshold": {k: biz[k] for k in ("threshold", "precision", "recall", "net_benefit")}})
        fitted[name] = pipe
        print(f"{name:38s} PR-AUC {m['pr_auc']:.4f} ROC-AUC {m['roc_auc']:.4f} Brier {m['brier']:.5f} "
              f"| thr {thr:.2f} P {biz['precision']:.3f} R {biz['recall']:.3f} net {biz['net_benefit']:.0f} ({time.time()-t:.0f}s)")

    real = [c for c in comparison if c["complexity_rank"] > 0]
    best_pr = max(c["validation"]["pr_auc"] for c in real)
    eligible = [c for c in real if c["validation"]["pr_auc"] >= best_pr - 0.01]
    # Scores are shown to users and the threshold must be tunable, so among models
    # with equivalent PR-AUC prefer the best-calibrated one (lowest Brier score).
    chosen = min(eligible, key=lambda c: (c["validation"]["brier"], c["complexity_rank"]))
    name = chosen["model"]
    pipe = as_sklearn(fitted[name])
    print("Selected:", name)

    p_val = pipe.predict_proba(Xva)[:, 1]
    threshold = business.best_threshold(yva, p_val, val["Amount"].to_numpy())
    p_test = pipe.predict_proba(Xte)[:, 1]
    p_train = pipe.predict_proba(Xtr)[:, 1]

    test_rank = ranking_metrics(yte, p_test)
    test_biz = business.evaluate(yte, p_test, test["Amount"].to_numpy(), threshold)
    test_at_05 = business.evaluate(yte, p_test, test["Amount"].to_numpy(), 0.5)
    f1_thr_val = None
    pr, rc, th = precision_recall_curve(yva, p_val)
    f1 = 2 * pr * rc / np.clip(pr + rc, 1e-12, None)
    f1_thr_val = round(float(th[int(np.nanargmax(f1[:-1]))]), 4)
    print("threshold", threshold, "test", test_rank, {k: test_biz[k] for k in ("precision", "recall", "net_benefit", "confusion_matrix")})

    # Reference ranges for readable explanations (training data only).
    reference = {f: {"p05": float(Xtr[f].quantile(0.05)), "median": float(Xtr[f].median()), "p95": float(Xtr[f].quantile(0.95))} for f in FEATURE_ORDER}
    background = Xtr.sample(300, random_state=SEED)
    explainer = FraudExplainer(pipe, background, reference)
    explainer.explain(Xte.iloc[:20])  # raises if additivity fails
    fraud_idx = np.where(yte == 1)[0]
    imp_rows = pd.concat([Xte.iloc[fraud_idx], Xte.sample(2000, random_state=SEED)])
    importance = explainer.global_importance(imp_rows)

    # Real held-out samples for demo & batch CSV (no labels sent to the model).
    order = np.argsort(-p_test)
    def sample_row(i, label):
        r = test.iloc[i]
        return {"label": label, "row_id": int(r.name), "known_class": int(r[TARGET]), "score": round(float(p_test[i]), 6),
                "features": {f: round(float(r[f]), 6) for f in FEATURE_ORDER}}
    fraud_sorted = [i for i in order if yte[i] == 1]
    legit = [i for i in order[::-1] if yte[i] == 0]
    border = min(range(len(p_test)), key=lambda i: abs(p_test[i] - threshold) + (0 if yte[i] == 1 else 0.001))
    samples = [sample_row(fraud_sorted[0], "Fraud example"), sample_row(legit[len(legit) // 2], "Legitimate example"),
               sample_row(border, "Borderline example")]
    top_risk = [sample_row(i, "") | {"amount": round(float(test.iloc[i]["Amount"]), 2), "hour": round(float(test.iloc[i]["Hour"]), 2)}
                for i in order[:15]]
    rng = np.random.default_rng(SEED)
    csv_idx = list(order[:5]) + list(rng.choice(np.where(yte == 0)[0], 15, replace=False))
    csv_rows = test.iloc[csv_idx][FEATURE_ORDER].copy()
    csv_rows.insert(0, "transaction_id", [f"T{int(i)}" for i in test.iloc[csv_idx].index])

    np.savez_compressed(MODELS / "test_eval.npz", y=yte.astype(np.int8), score=p_test.astype(np.float32),
                        amount=test["Amount"].to_numpy().astype(np.float32))
    np.savez_compressed(MODELS / "validation_eval.npz", y=yva.astype(np.int8), score=p_val.astype(np.float32),
                        amount=val["Amount"].to_numpy().astype(np.float32))
    joblib.dump(pipe, MODELS / "fraud_pipeline.joblib")
    joblib.dump(background, MODELS / "shap_background.joblib")
    csv_rows.to_csv(MODELS / "sample_batch.csv", index=False, float_format="%.6f")

    hours = pd.cut(df["Hour"], bins=range(0, 25, 3), right=False, labels=[f"{h:02d}–{h+3:02d}" for h in range(0, 24, 3)])
    by_hour = df.groupby(hours, observed=False)[TARGET].agg(["mean", "sum", "count"])
    amount_bins = pd.cut(df["Amount"], bins=[-0.01, 1, 10, 50, 100, 500, 1e9], labels=["0–1", "1–10", "10–50", "50–100", "100–500", "500+"])
    by_amount = df.groupby(amount_bins, observed=False)[TARGET].agg(["mean", "sum", "count"])

    metadata = {
        "model_name": name,
        "model_version": "1.0.0",
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "training_seconds": round(time.time() - t0, 1),
        "dataset": {**DATASET, "sha256": sha, "quality": quality},
        "currency": CURRENCY,
        "currency_note": "The dataset does not state a currency; EUR is assumed because cardholders are European.",
        "split": split,
        "imbalance_handling": "Compared no weighting, class weights, SMOTE inside the training pipeline (never before splitting) and boosted trees; selected by validation PR-AUC.",
        "selection_rule": "Models within 0.01 of the best validation PR-AUC are treated as equivalent; among them the best-calibrated (lowest validation Brier score) is chosen, because scores are shown to users and the decision threshold must be adjustable.",
        "comparison": comparison,
        "threshold": {
            "value": threshold,
            "method": f"Maximises estimated net benefit on the validation split with default assumptions (prevention effectiveness {business.DEFAULT_EFFECTIVENESS:.0%}, review cost {business.DEFAULT_REVIEW_COST:.0f} per false alarm). Test data was not used.",
            "f1_optimal_on_validation": f1_thr_val,
            "validation_fraud_cases": int(yva.sum()),
            "limitation": "The validation split contains only a few dozen frauds, so the selected threshold is a reasonable starting point rather than a precise optimum.",
            "bounds": [0.01, 0.99],
        },
        "test_metrics": {**test_rank, **test_biz},
        "test_metrics_at_0_5": test_at_05,
        "train_metrics": ranking_metrics(ytr, p_train),
        "overfitting_check": {
            "train_pr_auc": ranking_metrics(ytr, p_train)["pr_auc"],
            "validation_pr_auc": chosen["validation"]["pr_auc"],
            "test_pr_auc": test_rank["pr_auc"],
            "note": "Boosted trees fit the 342 training frauds almost perfectly; the meaningful numbers are the validation and test scores, which are what the model achieves on unseen, later transactions.",
        },
        "calibration_note": "Scores are model outputs between 0 and 1. With very few frauds they are not guaranteed to be calibrated real-world probabilities; compare Brier scores and treat them as risk scores.",
        "latency_ms_single_prediction": latency_ms(pipe, Xte),
        "shap": {"method": explainer.method, "output_space": explainer.space, "background_rows": len(background),
                 "note": "SHAP shows how the model used each input for this prediction; it is not proof of cause."},
        "global_importance": importance,
        "reference_ranges": reference,
        "assumption_defaults": {"prevention_effectiveness": business.DEFAULT_EFFECTIVENESS, "review_cost_per_false_alarm": business.DEFAULT_REVIEW_COST},
        "features": {"order": FEATURE_ORDER},
    }
    analytics = {
        "dataset_totals": {k: quality[k] for k in ("rows", "fraud", "legitimate", "fraud_rate", "amount_mean_fraud", "amount_mean_legitimate")},
        "fraud_rate_by_hour": [{"group": str(k), "fraud_rate": round(float(v["mean"]), 5), "fraud": int(v["sum"]), "rows": int(v["count"])} for k, v in by_hour.iterrows()],
        "fraud_rate_by_amount": [{"group": str(k), "fraud_rate": round(float(v["mean"]), 5), "fraud": int(v["sum"]), "rows": int(v["count"])} for k, v in by_amount.iterrows()],
        "top_risk_test": top_risk,
        "validation_curve": business.curve(yva, p_val, val["Amount"].to_numpy()),
    }
    (MODELS / "model_metadata.json").write_text(json.dumps(metadata, indent=1, ensure_ascii=False), encoding="utf-8")
    (MODELS / "analytics.json").write_text(json.dumps(analytics, indent=1, ensure_ascii=False), encoding="utf-8")
    (MODELS / "samples.json").write_text(json.dumps(samples, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
