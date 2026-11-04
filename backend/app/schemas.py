"""Request schemas generated from ml.features so the API matches the model exactly."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, create_model

from ml.features import BOUNDS, FEATURE_ORDER, HELP

THRESHOLD_MIN, THRESHOLD_MAX = 0.01, 0.99


class _TxBase(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


def _fields() -> dict:
    defs = {}
    for f in FEATURE_ORDER:
        lo, hi = BOUNDS[f]
        if f == "Hour":
            defs[f] = (float, Field(..., ge=lo, lt=hi, description=HELP[f]))
        else:
            defs[f] = (float, Field(..., ge=lo, le=hi, description=HELP[f]))
    return defs


Transaction = create_model("Transaction", __base__=_TxBase, **_fields())

BatchTransaction = create_model(
    "BatchTransaction",
    __base__=_TxBase,
    transaction_id=(str | None, Field(None, max_length=64, pattern=r"^[A-Za-z0-9_.:-]*$")),
    **_fields(),
)


class Assumptions(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    prevention_effectiveness: float = Field(0.9, ge=0, le=1, description="Share of a caught fraud's amount that blocking actually prevents.")
    review_cost: float = Field(5.0, ge=0, le=500, description="Cost of reviewing one false alarm (EUR).")


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    transaction: Transaction
    threshold: float | None = Field(None, ge=THRESHOLD_MIN, le=THRESHOLD_MAX)
    assumptions: Assumptions = Assumptions()


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    transactions: list[BatchTransaction] = Field(..., min_length=1)
    threshold: float | None = Field(None, ge=THRESHOLD_MIN, le=THRESHOLD_MAX)
