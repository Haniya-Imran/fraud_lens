"""Loads model artifacts once; serves predictions, explanations and threshold analytics."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np

from ml import business
from ml.explain import FraudExplainer
from ml.features import CURRENCY, FEATURE_ORDER, LABELS, to_frame

logger = logging.getLogger("fraudlens.model")

REQUIRED = ["fraud_pipeline.joblib", "shap_background.joblib", "model_metadata.json", "analytics.json",
            "samples.json", "test_eval.npz", "validation_eval.npz", "sample_batch.csv"]
REVIEW_BAND = 0.15


class ModelUnavailableError(RuntimeError):
    pass


@dataclass
class ModelService:
    models_dir: Path
    pipeline: object | None = None
    explainer: FraudExplainer | None = None
    metadata: dict = field(default_factory=dict)
    analytics: dict = field(default_factory=dict)
    samples: list = field(default_factory=list)
    evals: dict = field(default_factory=dict)
    sample_csv: str = ""
    load_error: str | None = None

    def load(self) -> None:
        try:
            missing = [f for f in REQUIRED if not (self.models_dir / f).exists()]
            if missing:
                raise ModelUnavailableError(f"Missing model artifacts: {', '.join(missing)}. Run `python -m ml.train`.")
            read = lambda n: json.loads((self.models_dir / n).read_text(encoding="utf-8"))  # noqa: E731
            self.pipeline = joblib.load(self.models_dir / "fraud_pipeline.joblib")
            background = joblib.load(self.models_dir / "shap_background.joblib")
            self.metadata = read("model_metadata.json")
            self.analytics = read("analytics.json")
            self.samples = read("samples.json")
            self.sample_csv = (self.models_dir / "sample_batch.csv").read_text(encoding="utf-8")
            for split in ("test", "validation"):
                d = np.load(self.models_dir / f"{split}_eval.npz")
                self.evals[split] = {"y": d["y"], "score": d["score"].astype(float), "amount": d["amount"].astype(float)}
            if self.metadata["features"]["order"] != FEATURE_ORDER:
                raise ModelUnavailableError("Saved model feature order does not match the API schema.")
            self.explainer = FraudExplainer(self.pipeline, background, self.metadata["reference_ranges"])
            self.load_error = None
            logger.info("Model loaded: %s v%s", self.metadata["model_name"], self.metadata["model_version"])
        except ModelUnavailableError as exc:
            self._fail(str(exc))
        except Exception as exc:
            logger.exception("Model load failed: %s", exc)  # full detail in server logs only
            self._fail(f"Model artifacts could not be loaded ({type(exc).__name__}).")

    def _fail(self, msg: str) -> None:
        self.pipeline = None
        self.explainer = None
        self.load_error = msg
        logger.error("Model unavailable: %s", msg)

    @property
    def ready(self) -> bool:
        return self.pipeline is not None and self.explainer is not None

    def require_ready(self) -> None:
        if not self.ready:
            raise ModelUnavailableError(self.load_error or "Model is not loaded.")

    @property
    def default_threshold(self) -> float:
        return float(self.metadata["threshold"]["value"])

    # -- decisions ---------------------------------------------------------
    def decide(self, score: float, threshold: float) -> dict:
        flagged = score >= threshold
        near = abs(score - threshold) <= REVIEW_BAND
        return {
            "score": round(score, 6),
            "threshold": threshold,
            "flagged": flagged,
            "decision": "Block" if flagged else "Approve",
            "review_recommended": near,
            "review_reason": "The score is close to the threshold, so a human should double-check this decision." if near else None,
        }

    def summarise(self, explanation: dict, flagged: bool) -> str:
        ups = [c for c in explanation["contributions"] if c["shap_value"] > 0][:3]
        downs = [c for c in explanation["contributions"] if c["shap_value"] < 0][:2]
        fmt = lambda c: f"{c['label']} ({c['value_note']}, {c['value']:g})"  # noqa: E731
        parts = [f"The model {'flagged' if flagged else 'did not flag'} this transaction."]
        if ups:
            parts.append("Signals pushing the risk up: " + "; ".join(fmt(c) for c in ups) + ".")
        if downs:
            parts.append("Signals pulling it down: " + "; ".join(fmt(c) for c in downs) + ".")
        return " ".join(parts)

    def money_for_transaction(self, amount: float, score: float, flagged: bool, eff: float, review_cost: float) -> dict:
        return {
            "currency": CURRENCY,
            "amount": round(amount, 2),
            "potential_loss_if_fraud_and_approved": round(amount, 2),
            "loss_prevented_if_fraud_and_blocked": round(amount * eff, 2),
            "review_cost_if_legitimate_and_blocked": round(review_cost, 2),
            "expected_loss_if_approved": round(score * amount, 2),
            "note": "Estimates for a live transaction whose true outcome is unknown. Expected loss treats the score as a probability, which is an approximation.",
        }

    def predict(self, tx: dict, threshold: float | None, eff: float, review_cost: float) -> dict:
        self.require_ready()
        t = threshold if threshold is not None else self.default_threshold
        frame = to_frame([tx])
        score = float(self.pipeline.predict_proba(frame)[:, 1][0])
        exp = self.explainer.explain(frame)[0]
        decision = self.decide(score, t)
        return {
            "prediction": decision,
            "explanation": {**exp, "summary": self.summarise(exp, decision["flagged"]),
                            "top_raising": [c for c in exp["contributions"] if c["shap_value"] > 0][:5],
                            "top_lowering": [c for c in exp["contributions"] if c["shap_value"] < 0][:5],
                            "note": self.metadata["shap"]["note"]},
            "financial_impact": self.money_for_transaction(tx["Amount"], score, decision["flagged"], eff, review_cost),
            "model": {"name": self.metadata["model_name"], "version": self.metadata["model_version"], "default_threshold": self.default_threshold},
        }

    def predict_batch(self, rows: list[dict], threshold: float | None) -> dict:
        self.require_ready()
        t = threshold if threshold is not None else self.default_threshold
        frame = to_frame(rows)
        scores = self.pipeline.predict_proba(frame)[:, 1]
        exps = self.explainer.explain(frame, top_n=3, fast=True)
        results = []
        for row, s, e in zip(rows, scores, exps):
            d = self.decide(float(s), t)
            results.append({
                "transaction_id": row.get("transaction_id"),
                "amount": round(float(row["Amount"]), 2),
                "hour": round(float(row["Hour"]), 2),
                **d,
                "top_factors": [{"feature": c["feature"], "label": LABELS[c["feature"]], "shap_value": c["shap_value"]} for c in e["contributions"]],
            })
        flagged = sum(r["flagged"] for r in results)
        return {"threshold": t, "rows": len(results), "explanation_method": exps[0]["method"] if exps else None, "flagged": flagged,
                "flagged_amount": round(sum(r["amount"] for r in results if r["flagged"]), 2), "results": results}

    def threshold_metrics(self, split: str, threshold: float, eff: float, review_cost: float) -> dict:
        self.require_ready()
        e = self.evals[split]
        return business.evaluate(e["y"], e["score"], e["amount"], threshold, eff, review_cost)

    def threshold_curve(self, split: str, eff: float, review_cost: float) -> list[dict]:
        self.require_ready()
        e = self.evals[split]
        return business.curve(e["y"], e["score"], e["amount"], eff, review_cost)
