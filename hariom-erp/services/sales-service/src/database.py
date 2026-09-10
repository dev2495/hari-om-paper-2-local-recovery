import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://devarshthakkar@localhost:5432/salesdb")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# Shared transaction-coupled history; schema is part of the service metadata.
import sys
from pathlib import Path
from fastapi import Request
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared"))
from audit_outbox import attach_actor, install_outbox
install_outbox(Base, SessionLocal, "sales-service")


def get_db(request: Request = None):
    db = SessionLocal()
    attach_actor(db, request)
    try:
        yield db
    finally:
        db.close()
