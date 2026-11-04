# FraudLens — Credit Card Fraud Detection with explainable AI

FraudLens finds the rare fraudulent card payments hidden among normal ones, lets you choose how strict the alarm should be (the **decision threshold**), and estimates how much money that choice saves. Every number in the app comes from a real model trained on a real public dataset.

- **Imbalanced data:** only 0.17% of transactions are fraud, so models are compared by PR-AUC, precision and recall — never accuracy.
- **Threshold tuning:** the threshold is chosen on a validation period by a business objective and can be changed live in the UI (0.01–0.99).
- **Money-saved analytics:** a transparent, editable estimate — not the gross value of flagged payments.
- **Explanations:** SHAP shows which inputs pushed each score up or down.

No login or sign-up — the app opens straight to the landing page.

## Pages

| Page | What it does |
| --- | --- |
| `/` Landing | 3D vault hero (drag to rotate), real headline figures, how it works |
| `/dashboard` Overview | KPIs, imbalance bar, threshold gauge + slider, fraud caught / missed / false alarms, money breakdown, editable assumptions, precision/recall and net-benefit curves, confusion matrix, fraud rate by hour/amount, highest-risk test transactions. Switch between the test and validation periods. |
| `/check` | Score one transaction (3 real test samples or manual values incl. V1–V28), 3D risk dial, Block/Approve with a human-review warning near the threshold, SHAP reasons, financial impact, downloadable HTML report, session history (this browser tab only), clear/reset |
| `/batch` | Upload a CSV (≤1,000 rows, validated in the browser), score it, filter, download results CSV; sample CSV provided |
| `/model` | Model comparison, threshold method, overfitting check, global SHAP importance, split, dataset source/license, limitations |

## Dataset

**Credit Card Fraud Detection** — ULB Machine Learning Group & Worldline. 284,807 card transactions by European cardholders over two days in September 2013; 492 frauds (0.1727%). `V1–V28` are PCA components released for confidentiality; `Time` and `Amount` are raw.

- Original: <https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud> — Database Contents License (DbCL) v1.0
- Also on Zenodo: <https://zenodo.org/records/7395559> — CC BY 4.0
- Citation: A. Dal Pozzolo, O. Caelen, R. A. Johnson, G. Bontempi. *Calibrating Probability with Undersampling for Unbalanced Classification.* IEEE SSCI, 2015.
- The CSV (150 MB) is **not committed**. `python -m ml.download_data` fetches a public mirror and verifies SHA-256 `76274b69…8a89`.
- Currency: the dataset does not state one. EUR is assumed (European cardholders) and labelled as an assumption in the UI.

Quality checks (see `models/model_metadata.json`): no missing values; 1,081 exact duplicate rows removed before splitting; `Time` converted to hour of day (raw `Time` is a position inside the 2-day capture, not meaningful for new transactions); no post-transaction fields, so no target leakage.

## Method

1. **Time-ordered split 60/20/20** — earlier transactions train, later ones validate and test (train 342 frauds, validation 57, test 74). The test period is used once, for final numbers.
2. **Imbalance strategies compared** on validation: no weighting, class weights, SMOTE (inside an `imblearn` pipeline, so only training data is oversampled), Random Forest with balanced class weights, LightGBM with and without `scale_pos_weight`.
3. **Selection:** models within 0.01 of the best validation PR-AUC are treated as equivalent; among them the lowest Brier score wins (scores are shown to users and the threshold must be adjustable). → **LightGBM**.
4. **Threshold:** the value on a 0.01–0.99 grid that maximises estimated validation net benefit with default assumptions → **0.26** (F1-optimal would be 0.54).
5. **SHAP:** `TreeExplainer` (interventional, log-odds, 300 training rows as background) for single predictions; exact path-dependent TreeSHAP for batches (much faster). Every explanation is checked to add up to the model output, otherwise no explanation is shown.

### Validation results (real, from `python -m ml.train`)

| Model | PR-AUC | ROC-AUC | Brier | Best thr. | Precision | Recall | Net benefit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (class prior) | 0.0010 | 0.5000 | 0.00100 | 0.50 | 0.000 | 0.000 | €0 |
| Logistic Regression | 0.6373 | 0.9697 | 0.00057 | 0.10 | 0.627 | 0.737 | €6,789 |
| Logistic Regression + class weights | 0.7764 | 0.9738 | 0.03260 | 0.99 | 0.459 | 0.789 | €6,717 |
| Logistic Regression + SMOTE | 0.7016 | 0.9645 | 0.00246 | 0.88 | 0.647 | 0.772 | €6,861 |
| Random Forest + class weights | 0.7767 | 0.9401 | 0.00034 | 0.34 | 0.956 | 0.754 | €6,971 |
| **LightGBM (selected)** | 0.7744 | 0.9814 | 0.00033 | 0.26 | 0.782 | 0.754 | €6,921 |
| LightGBM + class weights | 0.7721 | 0.9789 | 0.00041 | 0.26 | 0.741 | 0.754 | €6,906 |

### Test period (56,746 transactions, 74 frauds), threshold 0.26

PR-AUC **0.803** · ROC-AUC 0.987 · precision **85.7%** · recall **73.0%** · F1 0.788 · TP 54, FP 9, FN 20, TN 56,663 · ~1 ms per prediction.

Train PR-AUC is 1.0 — boosted trees fit the 342 training frauds almost perfectly — so only the validation/test numbers describe real performance.

## Money metric (estimates)

```
prevented loss   = fraud amount caught × prevention effectiveness   (default 90%)
false-alarm cost = false positives × review cost per alarm           (default €5)
net benefit      = prevented loss − false-alarm cost                 ("estimated money saved")
missed loss      = fraud amount not caught                            (shown separately)
```

On the test period at 0.26: caught €5,044.60 → prevented €4,540.14 − €45.00 false-alarm cost = **€4,495.14 estimated net benefit**; €2,683.07 of fraud was still missed. Both assumptions are editable in the UI and API. Gross flagged value is never called "money saved".

## Run locally

Requirements: Python 3.11–3.13, Node 20+.

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m ml.download_data      # fetch + verify the dataset
python -m ml.train              # ~4 min; writes models/ (already committed, so optional)
uvicorn backend.app.main:app --port 8000
```

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173 (uses http://localhost:8000 by default)
```

Configuration: copy `.env.example` → `.env` (backend, prefix `FRAUDLENS_`) and `frontend/.env.example` → `frontend/.env` (`VITE_API_BASE_URL`). No secrets are needed.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Model loaded? (503 if not) |
| GET | `/model-info` | Metadata, metrics, threshold, comparison, bounds, limitations |
| POST | `/predict` | `{transaction, threshold?, assumptions?}` → score, decision, review flag, SHAP, financial impact |
| POST | `/predict/batch` | `{transactions[≤1000], threshold?}` → per-row decisions + top 3 factors |
| GET | `/analytics/overview` | Dataset totals, fraud rate by hour/amount, top-risk test rows |
| GET | `/analytics/threshold` | Confusion matrix and money metrics at any threshold (`split=test|validation`, `effectiveness`, `review_cost`) |
| GET | `/analytics/curve` | The same for every threshold 0.01–0.99 |
| GET | `/samples`, `/samples/batch.csv` | Real held-out test rows for demos |

Inputs are validated (finite numbers, bounds, no extra fields — a `Class` label is rejected); request bodies over 1 MB return 413; errors are JSON without stack traces; CORS is limited to configured origins. Nothing is stored server-side; session history lives only in the browser tab (`sessionStorage`).

## Tests

```bash
pytest                                   # 34 ML + API tests on the real model
cd frontend && npm test                  # 21 unit/component tests (Vitest)
node tests/e2e/e2e.cjs                   # 9 Playwright checks against the running app
```

## Deployment (Vercel)

Two Vercel projects from this repository:

- **API** — root `/`, framework FastAPI, entrypoint `app.py`, Python 3.13 (`.python-version`). `vercel.json` excludes the frontend, tests and data from the function bundle. Env: `FRAUDLENS_CORS_ORIGINS=https://<frontend-domain>`.
- **Frontend** — root `frontend/`, framework Vite. Env: `VITE_API_BASE_URL=https://<api-domain>`. `frontend/vercel.json` rewrites routes to `index.html`.

## Limitations

- Two days of 2013 European data; real fraud patterns drift and differ between banks.
- V1–V28 are anonymised, so explanations name components, not real-world causes.
- Only 57 validation and 74 test frauds — metrics and the chosen threshold carry wide uncertainty.
- Scores are risk scores, not guaranteed calibrated probabilities; money figures are estimates under stated assumptions.
- This is decision support. A person should review blocks before customers are affected.

Built by Nimra Imran.
