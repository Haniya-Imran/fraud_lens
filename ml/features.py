"""Single source of truth for the model's input schema.

Raw dataset columns: Time, V1..V28, Amount, Class.
* `Time` is "seconds since the first transaction in the 2-day capture window".
  It is not meaningful for a new live transaction, so it is converted to
  `Hour` (hour of day, 0–23.99) and the raw value is dropped.
* V1..V28 are PCA components released by the data owner for confidentiality.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

TARGET = "Class"
V_FEATURES = [f"V{i}" for i in range(1, 29)]
FEATURE_ORDER: list[str] = ["Hour", "Amount", *V_FEATURES]

# Validation bounds: generous but finite. The PCA components in the dataset
# range roughly from -114 to +121, so ±200 rejects garbage without clipping data.
BOUNDS = {
    "Hour": (0.0, 24.0),
    "Amount": (0.0, 100_000.0),
    **{v: (-200.0, 200.0) for v in V_FEATURES},
}

LABELS = {
    "Hour": "Hour of day",
    "Amount": "Amount",
    **{v: f"{v} (anonymised)" for v in V_FEATURES},
}

HELP = {
    "Hour": "Hour of day the payment happened (0–23.99). Derived from the dataset's Time column.",
    "Amount": "Transaction amount. The dataset does not state the currency; it covers European cardholders, so EUR is assumed.",
    **{v: "Anonymised PCA component released by the bank for privacy. Original meaning is not public." for v in V_FEATURES},
}

CURRENCY = "EUR"


def load_raw(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    expected = {"Time", "Amount", TARGET, *V_FEATURES}
    missing = expected - set(df.columns)
    if missing:
        raise ValueError(f"Dataset is missing columns: {sorted(missing)}")
    if not set(df[TARGET].unique()) <= {0, 1}:
        raise ValueError("Target column must be binary 0/1.")
    return df


def add_hour(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["Hour"] = (out["Time"] % 86_400) / 3_600
    return out


def to_frame(records: list[dict]) -> pd.DataFrame:
    frame = pd.DataFrame.from_records(records)
    return frame[FEATURE_ORDER].astype(float)
