from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import get_settings


settings = get_settings()
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    # Shop-floor entry is concurrent (many supervisors/operators at shift end);
    # the old 3+1 pool queued requests behind each other. Tunable per host.
    pool_size=int(os.getenv("DB_POOL_SIZE", "8")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "4")),
    pool_recycle=1800,
    future=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# Shared transaction-coupled history; schema is part of the service metadata.
import sys
from pathlib import Path
from fastapi import Request


def _shared_on_sys_path() -> None:
    here = Path(__file__).resolve()
    candidates = [
        Path("/app/shared"),
        here.parent.parent / "shared",
    ]
    try:
        candidates.append(here.parents[3] / "shared")
    except IndexError:
        pass
    for candidate in candidates:
        if (candidate / "audit_outbox.py").is_file():
            sys.path.insert(0, str(candidate))
            return
    raise ImportError("audit_outbox.py was not packaged with this service")


_shared_on_sys_path()
from audit_outbox import attach_actor, install_outbox
install_outbox(Base, SessionLocal, "inventory-service")


def get_db(request: Request = None):
    db = SessionLocal()
    attach_actor(db, request)
    try:
        yield db
    finally:
        db.close()
