import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/dispatchdb")

    JWT_SECRET: str = os.getenv("JWT_SECRET", "hariom-secret-key-123")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

    INVENTORY_SERVICE_URL: str = os.getenv("INVENTORY_SERVICE_URL", "http://inventory-service:8005")
    SALES_SERVICE_URL: str = os.getenv("SALES_SERVICE_URL", "http://sales-service:8008")

    SERVICE_NAME: str = "dispatch-service"
    SERVICE_PORT: int = 8006

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()
