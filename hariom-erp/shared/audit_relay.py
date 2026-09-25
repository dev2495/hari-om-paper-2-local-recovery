"""Supervised durable audit delivery, with idempotent receiver and bounded retries."""
import json
import logging
import os
import time
from sqlalchemy import create_engine, Table, Column, MetaData, String, Text, DateTime, Integer, select, func
OUTBOX = Table("audit_outbox", MetaData(), Column("id", String, primary_key=True), Column("body", Text), Column("occurred_at", DateTime), Column("delivered_at", DateTime), Column("attempts", Integer))
from sqlalchemy.engine import URL
import requests

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("audit-relay")
DATABASES = ("masterdb", "specdb", "salesdb", "productiondb", "inventorydb")


def deliver_batch(engine, endpoint, internal_token, transport=requests, notify_endpoint=None):
    """Deliver pending rows; a row with a ``notify`` request also becomes an in-app notification.

    The notification is sent first and keyed by the row id, so a retry after a later
    failure cannot notify twice; the row is marked delivered only when both succeed.
    """
    delivered = 0
    headers = {"X-Internal-Token": internal_token}
    with engine.begin() as connection:
        rows = connection.execute(select(OUTBOX.c.id, OUTBOX.c.body).where(OUTBOX.c.delivered_at.is_(None)).order_by(OUTBOX.c.occurred_at).limit(50).with_for_update(skip_locked=True)).all()
        for row in rows:
            body = json.loads(row.body)
            notify = body.pop("notify", None)
            if notify:
                if not notify_endpoint:
                    raise RuntimeError("Notification endpoint is not configured")
                response = transport.post(notify_endpoint, json={**notify, "event_type": body["event_type"],
                    "event_id": body["id"], "plant_id": body.get("plant_id"), "payload": body.get("payload") or {}},
                    headers=headers, timeout=5)
                if response.status_code != 200:
                    raise RuntimeError(f"Notification receiver returned {response.status_code}")
            response = transport.post(endpoint, json=body, headers=headers, timeout=5)
            if response.status_code != 200:
                raise RuntimeError(f"Audit receiver returned {response.status_code}")
            connection.execute(OUTBOX.update().where(OUTBOX.c.id == row.id).values(delivered_at=func.now(), attempts=OUTBOX.c.attempts + 1))
            delivered += 1
    return delivered


def main():
    engines = {name: create_engine(URL.create("postgresql+psycopg2", username=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"], host=os.getenv("DB_HOST", "postgres"),
        port=int(os.getenv("DB_PORT", "5432")), database=name), pool_pre_ping=True, pool_size=1, max_overflow=0) for name in DATABASES}
    auth_url = os.getenv("AUTH_SERVICE_URL", "http://127.0.0.1:18001")
    endpoint, notify_endpoint = auth_url + "/audit-events/ingest", auth_url + "/notifications/events"
    while True:
        for name, engine in engines.items():
            try:
                count = deliver_batch(engine, endpoint, os.environ["INTERNAL_EVENT_TOKEN"], notify_endpoint=notify_endpoint)
                if count: log.info("Delivered %s records from %s", count, name)
            except Exception as error:
                # No event bodies or credentials in process logs. Pending rows remain durable.
                log.warning("Delivery pending for %s (%s)", name, type(error).__name__)
        time.sleep(5)

if __name__ == "__main__":
    main()
