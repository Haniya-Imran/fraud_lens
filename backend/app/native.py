"""Make LightGBM's OpenMP runtime available on hosts that lack it.

LightGBM's compiled library needs `libgomp.so.1`. Serverless images such as
Vercel's Python runtime don't ship it, so importing lightgbm fails there.
`backend/vendor/libgomp.so.1` is the portable (manylinux, glibc 2.17) GNU
OpenMP runtime redistributed in scikit-learn's wheels (GCC Runtime Library
Exception), with its SONAME set to `libgomp.so.1`. It is preloaded only when
the system copy can't be found.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import logging
import sys
from pathlib import Path

VENDORED = Path(__file__).resolve().parents[1] / "vendor" / "libgomp.so.1"
logger = logging.getLogger("fraudlens.native")


def ensure_openmp() -> None:
    if not sys.platform.startswith("linux"):
        return
    try:
        ctypes.CDLL("libgomp.so.1", mode=ctypes.RTLD_GLOBAL)
        return
    except OSError:
        pass
    if VENDORED.exists():
        ctypes.CDLL(str(VENDORED), mode=ctypes.RTLD_GLOBAL)
        logger.info("Loaded vendored OpenMP runtime for LightGBM.")
