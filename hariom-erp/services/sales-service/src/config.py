import os
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/salesdb")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "hariom-secret-key-123")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

    SERVICE_NAME: str = "sales-service"
    SERVICE_PORT: int = 8008

@lru_cache()
def get_settings() -> Settings:
    return Settings()
