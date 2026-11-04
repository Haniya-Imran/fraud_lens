"""SHAP explanations for the saved pipeline (prep -> model).

Every explanation is checked: base value + sum of contributions must equal
the model's raw output for that row, otherwise ExplanationError is raised and
no explanation is shown.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from .features import FEATURE_ORDER, LABELS

TOLERANCE = 1e-3


class ExplanationError(RuntimeError):
    pass


def _logit(p):
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return np.log(p / (1 - p))


def _sigmoid(x):
    return 1 / (1 + np.exp(-x))


class FraudExplainer:
    def __init__(self, pipeline: Pipeline, background: pd.DataFrame, reference: dict):
        self.pipeline = pipeline
        self.prep = pipeline[:-1]
        self.model = pipeline[-1]
        self.reference = reference  # per-feature p05 / median / p95 from training data
        bg = np.asarray(self.prep.transform(background[FEATURE_ORDER]), dtype=float)
        if isinstance(self.model, LogisticRegression):
            self.space = "log-odds"
            self.method = "shap.LinearExplainer (independent masker)"
            self._exp = shap.LinearExplainer(self.model, shap.maskers.Independent(bg, max_samples=len(bg)))
            self._fast, self.fast_method = self._exp, self.method
        else:
            forest = isinstance(self.model, (RandomForestClassifier, ExtraTreesClassifier))
            self.space = "probability" if forest else "log-odds"
            self.method = f"shap.TreeExplainer (interventional, {self.space} output)"
            self._exp = shap.TreeExplainer(self.model, data=bg, feature_perturbation="interventional", model_output="raw")
            # Batch scoring uses path-dependent TreeSHAP: also exact and additive, but ~100x faster
            # because it needs no background loop. (Forests stay on the interventional explainer.)
            if forest:
                self._fast, self.fast_method = self._exp, self.method
            else:
                self._fast = shap.TreeExplainer(self.model, feature_perturbation="tree_path_dependent")
                self.fast_method = "shap.TreeExplainer (tree path-dependent, log-odds output)"

    def _class1(self, values):
        if isinstance(values, list):
            values = values[1]
        values = np.asarray(values, dtype=float)
        return values[:, :, 1] if values.ndim == 3 else values

    def _base(self, exp=None) -> float:
        ev = np.atleast_1d(np.asarray((exp or self._exp).expected_value, dtype=float))
        return float(ev[1] if ev.size == 2 else ev[0])

    def shap_matrix(self, X: pd.DataFrame, fast: bool = False) -> tuple[np.ndarray, float]:
        exp = self._fast if fast else self._exp
        Xt = np.asarray(self.prep.transform(X[FEATURE_ORDER]), dtype=float)
        return self._class1(exp.shap_values(Xt)), self._base(exp)

    def describe_value(self, feature: str, value: float) -> str:
        ref = self.reference.get(feature)
        if not ref:
            return "typical"
        if value < ref["p05"]:
            return "unusually low"
        if value > ref["p95"]:
            return "unusually high"
        return "typical"

    def explain(self, X: pd.DataFrame, top_n: int | None = None, fast: bool = False) -> list[dict]:
        try:
            values, base = self.shap_matrix(X, fast) if fast else self.shap_matrix(X)
        except Exception as exc:  # pragma: no cover
            raise ExplanationError(f"SHAP failed: {type(exc).__name__}") from exc
        proba = self.pipeline.predict_proba(X[FEATURE_ORDER])[:, 1]
        out_raw = _logit(proba) if self.space == "log-odds" else proba
        if not np.allclose(base + values.sum(axis=1), out_raw, atol=TOLERANCE):
            raise ExplanationError("SHAP values do not add up to the model output.")
        results = []
        for i in range(len(X)):
            row = X.iloc[i]
            contribs = []
            for j, f in enumerate(FEATURE_ORDER):
                phi = float(values[i, j])
                v = float(row[f])
                contribs.append({
                    "feature": f,
                    "label": LABELS[f],
                    "value": round(v, 4),
                    "shap_value": round(phi, 5),
                    "direction": "raises_risk" if phi > 0 else "lowers_risk",
                    "value_note": self.describe_value(f, v),
                })
            contribs.sort(key=lambda c: abs(c["shap_value"]), reverse=True)
            results.append({
                "method": self.fast_method if fast else self.method,
                "output_space": self.space,
                "base_value": round(base, 5),
                "base_score": round(float(_sigmoid(base) if self.space == "log-odds" else base), 6),
                "model_output": round(float(out_raw[i]), 5),
                "contributions": contribs[:top_n] if top_n else contribs,
            })
        return results

    def global_importance(self, X: pd.DataFrame) -> list[dict]:
        values, _ = self.shap_matrix(X)
        mean_abs = np.abs(values).mean(axis=0)
        order = np.argsort(-mean_abs)
        return [{"feature": FEATURE_ORDER[k], "label": LABELS[FEATURE_ORDER[k]], "mean_abs_shap": round(float(mean_abs[k]), 6)} for k in order]
