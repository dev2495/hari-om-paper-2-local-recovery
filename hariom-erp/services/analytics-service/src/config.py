import os
import redis
from typing import Optional

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8001")
MASTER_DATA_SERVICE_URL = os.getenv("MASTER_DATA_SERVICE_URL", "http://masterdata-service:8002")
SPEC_SERVICE_URL = os.getenv("SPEC_SERVICE_URL", "http://spec-service:8003")
SALES_SERVICE_URL = os.getenv("SALES_SERVICE_URL", "http://sales-service:8008")
PRODUCTION_SERVICE_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://production-service:8004")
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://inventory-service:8005")
DISPATCH_SERVICE_URL = os.getenv("DISPATCH_SERVICE_URL", "http://dispatch-service:8006")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/analyticsdb")
JWT_SECRET = os.getenv("JWT_SECRET", "change_me_in_production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/1")
ANALYTICS_CACHE_TTL_SECONDS = int(os.getenv("ANALYTICS_CACHE_TTL_SECONDS", "120"))

SUPER_ROLES = {"Owner", "Admin"}
PLANT_ALIASES = {
    "PLANT_A": "00000000-0000-0000-0000-0000000000a1",
    "PLANT-1": "00000000-0000-0000-0000-0000000000a1",
    "PLANT1": "00000000-0000-0000-0000-0000000000a1",
    "PLANT_B": "00000000-0000-0000-0000-0000000000b2",
    "PLANT-2": "00000000-0000-0000-0000-0000000000b2",
    "PLANT2": "00000000-0000-0000-0000-0000000000b2",
}

_redis_client: Optional[redis.Redis] = None
_redis_available: Optional[bool] = None

def get_redis_client() -> Optional[redis.Redis]:
    global _redis_client, _redis_available
    if _redis_available is False:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        client.ping()
        _redis_client = client
        _redis_available = True
        return _redis_client
    except Exception:
        _redis_available = False
        return None
