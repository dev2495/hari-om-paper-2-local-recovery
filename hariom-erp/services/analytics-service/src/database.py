from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from src.config import DATABASE_URL


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    # Shop-floor entry is concurrent (many supervisors/operators at shift end);
    # the old 3+1 pool queued requests behind each other. Tunable per host.
    pool_size=int(os.getenv("DB_POOL_SIZE", "4")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "2")),
    pool_recycle=1800,
    future=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
