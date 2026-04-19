import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/productiondb")

    JWT_SECRET: str = os.getenv("JWT_SECRET", "change_me_in_production")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

    DEFAULT_BAMBOO_WEIGHT_KG: float = 15.0
    BAMBOO_WARNING_PERCENT: float = 2.0
    BAMBOO_CRITICAL_PERCENT: float = 5.0

    MASTERDATA_SERVICE_URL: str = os.getenv(
        "MASTERDATA_SERVICE_URL",
        os.getenv("MASTER_DATA_SERVICE_URL", "http://masterdata-service:8002"),
    )
    SPEC_SERVICE_URL: str = os.getenv("SPEC_SERVICE_URL", "http://spec-service:8003")
    INVENTORY_SERVICE_URL: str = os.getenv("INVENTORY_SERVICE_URL", "http://inventory-service:8005")
    SALES_SERVICE_URL: str = os.getenv("SALES_SERVICE_URL", "http://sales-service:8008")

    SERVICE_NAME: str = "production-service"
    SERVICE_PORT: int = 8004

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()
