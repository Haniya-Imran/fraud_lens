"""API tests against the real trained model."""
import pytest

from .conftest import ROOT


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["model_loaded"] is True


def test_model_info(client):
    b = client.get("/model-info").json()
    assert b["model_name"] and 0 < b["threshold"]["value"] < 1
    assert b["features"]["order"][:2] == ["Hour", "Amount"]
    assert b["limitations"] and "DbCL" in b["dataset"]["license"]
    assert str(ROOT) not in str(b)


def test_predict_fraud_sample(client, fraud_tx):
    b = client.post("/predict", json={"transaction": fraud_tx}).json()
    p = b["prediction"]
    assert p["flagged"] is True and p["decision"] == "Block"
    assert p["threshold"] == b["model"]["default_threshold"]
    exp = b["explanation"]
    assert len(exp["contributions"]) == 30
    total = exp["base_value"] + sum(c["shap_value"] for c in exp["contributions"])
    assert abs(total - exp["model_output"]) < 1e-3
    assert b["financial_impact"]["amount"] == round(fraud_tx["Amount"], 2)


def test_predict_legit_sample(client, legit_tx):
    p = client.post("/predict", json={"transaction": legit_tx}).json()["prediction"]
    assert p["flagged"] is False and p["decision"] == "Approve"


def test_custom_threshold_changes_decision(client, fraud_tx):
    score = client.post("/predict", json={"transaction": fraud_tx}).json()["prediction"]["score"]
    if score < 0.99:
        p = client.post("/predict", json={"transaction": fraud_tx, "threshold": 0.99}).json()["prediction"]
        assert p["flagged"] is False and p["score"] == score


@pytest.mark.parametrize("field,value", [("Amount", -1), ("Hour", 24), ("V14", 999), ("Amount", "abc"), ("V3", None)])
def test_invalid_values(client, fraud_tx, field, value):
    fraud_tx[field] = value
    r = client.post("/predict", json={"transaction": fraud_tx})
    assert r.status_code == 422
    assert any(field in (d["field"] or "") for d in r.json()["details"])


def test_missing_and_unexpected_fields(client, fraud_tx):
    tx = dict(fraud_tx)
    tx.pop("V7")
    assert client.post("/predict", json={"transaction": tx}).status_code == 422
    fraud_tx["Class"] = 1
    assert client.post("/predict", json={"transaction": fraud_tx}).status_code == 422


def test_threshold_bounds(client, fraud_tx):
    assert client.post("/predict", json={"transaction": fraud_tx, "threshold": 0}).status_code == 422
    assert client.get("/analytics/threshold?threshold=1.5").status_code == 422


def test_batch(client, fraud_tx, legit_tx):
    body = {"transactions": [{"transaction_id": "a1", **fraud_tx}, {"transaction_id": "b2", **legit_tx}]}
    b = client.post("/predict/batch", json=body).json()
    assert b["rows"] == 2 and b["flagged"] == 1
    assert [r["transaction_id"] for r in b["results"]] == ["a1", "b2"]
    assert len(b["results"][0]["top_factors"]) == 3


def test_batch_limit(client, legit_tx):
    r = client.post("/predict/batch", json={"transactions": [legit_tx] * 1001})
    assert r.status_code == 422


def test_threshold_analytics_and_curve(client):
    info = client.get("/model-info").json()
    t = info["threshold"]["value"]
    m = client.get(f"/analytics/threshold?threshold={t}").json()
    assert m["confusion_matrix"] == info["test_metrics"]["confusion_matrix"]
    assert m["net_benefit"] == round(m["prevented_loss"] - m["false_alarm_cost"], 2)
    m2 = client.get(f"/analytics/threshold?threshold={t}&effectiveness=0.5&review_cost=20").json()
    assert m2["prevented_loss"] == round(m["caught_fraud_value"] * 0.5, 2)
    c = client.get("/analytics/curve?split=validation").json()
    assert c["split"] == "validation" and len(c["points"]) == 99


def test_samples_and_csv(client):
    s = client.get("/samples").json()
    assert len(s["samples"]) == 3
    r = client.get("/samples/batch.csv")
    assert r.status_code == 200 and r.text.startswith("transaction_id,Hour,Amount,V1")


def test_overview(client):
    o = client.get("/analytics/overview").json()
    assert o["dataset_totals"]["fraud"] == 492 and o["top_risk_test"]


def test_payload_too_large(client):
    assert client.post("/predict", content=b"x" * 1_100_000, headers={"content-type": "application/json"}).status_code == 413


def test_cors(client):
    ok = client.options("/predict", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/predict", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_unavailable_model(broken_client, fraud_tx):
    assert broken_client.get("/health").status_code == 503
    r = broken_client.post("/predict", json={"transaction": fraud_tx})
    assert r.status_code == 503 and "Traceback" not in r.text
