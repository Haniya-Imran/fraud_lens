"""Settings from environment variables (prefix FRAUDLENS_) or a local .env file."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_prefix="FRAUDLENS_", extra="ignore")

    app_env: str = "development"
    models_dir: Path = PROJECT_ROOT / "models"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
    max_body_bytes: int = 1_048_576  # 1 MB: enough for a 1,000-row batch
    max_batch_rows: int = 1000
    log_level: str = "INFO"

    @field_validator("cors_origins")
    @classmethod
    def _clean(cls, v: str) -> str:
        return ",".join(o.strip() for o in v.split(",") if o.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [o for o in self.cors_origins.split(",") if o]


@lru_cache
def get_settings() -> Settings:
    return Settings()
