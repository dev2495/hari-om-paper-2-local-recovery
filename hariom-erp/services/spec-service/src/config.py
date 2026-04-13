import os
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/specdb")
    
    # JWT
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change_me_in_production")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
    
    # Manufacturing Constants (ENFORCED)
    BAMBOO_MAX_LENGTH: int = 1560  # mm - STRICT MAXIMUM
    CUT_LOSS_MM: int = 40  # mm - STRICT CUT LOSS
    DEFAULT_PARCHMENT_PERCENT: float = 1.5
    DEFAULT_SHRINK_PERCENT: float = 10
    
    # Service
    SERVICE_NAME: str = "spec-service"
    SERVICE_PORT: int = 8003
    
    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()
