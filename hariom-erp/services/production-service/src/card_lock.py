"""A card lease shared by ledger writers, QC and external dispatch posting."""
from contextlib import contextmanager
from fastapi import HTTPException
from sqlalchemy import text
from .database import engine


def lock_card_transaction(db,card_id):
    if not db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"),{"key":"production-effect:"+str(card_id)}).scalar():
        raise HTTPException(409,"This card is being posted or updated; refresh and retry")


@contextmanager
def card_posting_lease(card_id):
    # Dispatch deliberately checkpoints before remote requests. A session lease
    # survives those commits, while transaction locks protect other card writers.
    with engine.connect() as connection:
        key={"key":"production-effect:"+str(card_id)}
        locked=connection.execute(text("SELECT pg_try_advisory_lock(hashtext(:key))"),key).scalar()
        connection.commit()
        if not locked:raise HTTPException(409,"This card is being posted or updated; refresh and retry")
        try:yield
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"),key)
            connection.commit()
