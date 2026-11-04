"""Download the public Credit Card Fraud dataset (ULB / Worldline) and verify it.

Usage:  python -m ml.download_data

The CSV is not committed to Git (150 MB). This script fetches a public zip mirror,
extracts creditcard.csv and checks its SHA-256 so training is reproducible.
If the mirror is unavailable, download it manually from either official page and
place creditcard.csv in data/raw/:
  * Kaggle:  https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud  (DbCL v1.0)
  * Zenodo:  https://zenodo.org/records/7395559                       (CC BY 4.0)
"""
from __future__ import annotations

import hashlib
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CSV = RAW / "creditcard.csv"
ZIP = RAW / "creditcard.csv.zip"
MIRROR = "https://raw.githubusercontent.com/stat432/credit-analysis/main/data-raw/creditcard.csv.zip"
CSV_SHA256 = "76274b691b16a6c49d3f159c883398e03ccd6d1ee12d9d8ee38f4b4b98551a89"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    if CSV.exists() and sha256(CSV) == CSV_SHA256:
        print(f"Dataset already present and verified: {CSV}")
        return 0
    try:
        print(f"Downloading {MIRROR} ...")
        urllib.request.urlretrieve(MIRROR, ZIP)
        with zipfile.ZipFile(ZIP) as z:
            member = next(n for n in z.namelist() if n.endswith("creditcard.csv"))
            with z.open(member) as src, CSV.open("wb") as dst:
                dst.write(src.read())
    except Exception as exc:  # network or archive problem
        print(f"Download failed ({exc}). Please download creditcard.csv manually (see module docstring).", file=sys.stderr)
        return 1
    digest = sha256(CSV)
    if digest != CSV_SHA256:
        print(f"Checksum mismatch: got {digest}, expected {CSV_SHA256}.", file=sys.stderr)
        return 1
    print(f"Verified {CSV} (sha256 {digest[:12]}...)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
