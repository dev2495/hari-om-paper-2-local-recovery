import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/inventorydb")
    
    # JWT
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change_me_in_production")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
    
    # Service
    SERVICE_NAME: str = "inventory-service"
    SERVICE_PORT: int = 8005
    # Once enabled, purchase receipts can only enter stock through the
    # revision-aware procurement service. Non-purchase opening/adjustment
    # routes remain available under their existing controls.
    PROCUREMENT_V2_ENFORCED: bool = os.getenv("PROCUREMENT_V2_ENFORCED", "true").strip().lower() in {"1", "true", "yes", "on"}
    
@lru_cache()
def get_settings():
    return Settings()
