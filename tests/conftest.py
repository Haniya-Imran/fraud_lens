import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import Settings  # noqa: E402
from backend.app.main import create_app  # noqa: E402

SAMPLES = json.loads((ROOT / "models" / "samples.json").read_text(encoding="utf-8"))


def sample(label: str) -> dict:
    return dict(next(s for s in SAMPLES if s["label"] == label)["features"])


@pytest.fixture
def fraud_tx():
    return sample("Fraud example")


@pytest.fixture
def legit_tx():
    return sample("Legitimate example")


@pytest.fixture(scope="session")
def client():
    with TestClient(create_app(Settings())) as c:
        yield c


@pytest.fixture
def broken_client(tmp_path):
    with TestClient(create_app(Settings(models_dir=tmp_path))) as c:
        yield c
