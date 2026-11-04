"""HTTP routes."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from ml import business
from ml.features import BOUNDS

from ..schemas import THRESHOLD_MAX, THRESHOLD_MIN, BatchRequest, PredictRequest
from ..services.model_service import ModelService

logger = logging.getLogger("fraudlens.api")
router = APIRouter()

Split = Literal["test", "validation"]


def svc(request: Request) -> ModelService:
    return request.app.state.model_service


@router.get("/health", tags=["system"])
def health(request: Request):
    s = svc(request)
    if s.ready:
        return {"status": "ok", "model_loaded": True, "model_version": s.metadata.get("model_version")}
    return JSONResponse(status_code=503, content={"status": "degraded", "model_loaded": False, "detail": s.load_error})


@router.get("/model-info", tags=["model"])
def model_info(request: Request):
    s = svc(request)
    s.require_ready()
    m = s.metadata
    keys = ["model_name", "model_version", "trained_at", "dataset", "currency", "currency_note", "split", "imbalance_handling",
            "selection_rule", "comparison", "threshold", "test_metrics", "test_metrics_at_0_5", "overfitting_check",
            "calibration_note", "latency_ms_single_prediction", "shap", "global_importance", "assumption_defaults", "features"]
    out = {k: m[k] for k in keys if k in m}
    out["feature_bounds"] = {f: {"min": lo, "max": hi} for f, (lo, hi) in BOUNDS.items()}
    out["limitations"] = [
        "Trained on two days of 2013 European card data; fraud patterns change over time and differ between banks.",
        "V1–V28 are anonymised PCA components, so explanations name components rather than real-world causes.",
        "The validation and test periods contain only 57 and 74 frauds, so metrics have wide uncertainty.",
        "Money figures are estimates under stated assumptions, not guaranteed savings.",
        "Scores are model risk scores; they are not guaranteed to be calibrated real-world probabilities.",
    ]
    return out


@router.post("/predict", tags=["model"])
def predict(body: PredictRequest, request: Request):
    s = svc(request)
    t0 = time.perf_counter()
    out = s.predict(body.transaction.model_dump(), body.threshold, body.assumptions.prevention_effectiveness, body.assumptions.review_cost)
    logger.info("predict decision=%s latency_ms=%.1f", out["prediction"]["decision"], (time.perf_counter() - t0) * 1000)
    out["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return out


@router.post("/predict/batch", tags=["model"])
def predict_batch(body: BatchRequest, request: Request):
    s = svc(request)
    limit = request.app.state.settings.max_batch_rows
    if len(body.transactions) > limit:
        raise HTTPException(status_code=422, detail=f"A batch can contain at most {limit} transactions.")
    t0 = time.perf_counter()
    out = s.predict_batch([t.model_dump() for t in body.transactions], body.threshold)
    logger.info("batch rows=%d flagged=%d latency_ms=%.1f", out["rows"], out["flagged"], (time.perf_counter() - t0) * 1000)
    return out


@router.get("/analytics/overview", tags=["analytics"])
def overview(request: Request):
    s = svc(request)
    s.require_ready()
    a = s.analytics
    return {
        "dataset_totals": a["dataset_totals"],
        "fraud_rate_by_hour": a["fraud_rate_by_hour"],
        "fraud_rate_by_amount": a["fraud_rate_by_amount"],
        "top_risk_test": a["top_risk_test"],
        "global_importance": s.metadata["global_importance"][:10],
        "default_threshold": s.default_threshold,
        "assumption_defaults": s.metadata["assumption_defaults"],
        "currency": s.metadata["currency"],
        "test_period": s.metadata["split"]["test"],
    }


@router.get("/analytics/threshold", tags=["analytics"])
def threshold_metrics(request: Request, threshold: float = Query(..., ge=THRESHOLD_MIN, le=THRESHOLD_MAX),
                      split: Split = "test", effectiveness: float = Query(business.DEFAULT_EFFECTIVENESS, ge=0, le=1),
                      review_cost: float = Query(business.DEFAULT_REVIEW_COST, ge=0, le=500)):
    s = svc(request)
    return {"split": split, **s.threshold_metrics(split, threshold, effectiveness, review_cost)}


@router.get("/analytics/curve", tags=["analytics"])
def threshold_curve(request: Request, split: Split = "test", effectiveness: float = Query(business.DEFAULT_EFFECTIVENESS, ge=0, le=1),
                    review_cost: float = Query(business.DEFAULT_REVIEW_COST, ge=0, le=500)):
    s = svc(request)
    return {"split": split, "assumptions": {"prevention_effectiveness": effectiveness, "review_cost_per_false_alarm": review_cost},
            "points": s.threshold_curve(split, effectiveness, review_cost)}


@router.get("/samples", tags=["analytics"])
def samples(request: Request):
    s = svc(request)
    s.require_ready()
    return {"note": "Real transactions from the held-out test period (demonstration data). known_class is the dataset label, shown for comparison only.",
            "samples": s.samples}


@router.get("/samples/batch.csv", tags=["analytics"], response_class=PlainTextResponse)
def sample_csv(request: Request):
    s = svc(request)
    s.require_ready()
    return PlainTextResponse(s.sample_csv, media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="fraudlens-sample-batch.csv"'})
