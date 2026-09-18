"""Transaction-coupled operational audit records, retained until delivered.

All writes through a service's SessionLocal enqueue history in the same DB
transaction. The relay never needs a user's password, cookie or bearer token.
"""
import json
import os
import uuid
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String, Table, Text, event, inspect
import jwt

SENSITIVE = {"password", "hashed_password", "token", "access_token", "secret", "api_key"}


def redact(value):
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()
                if not any(secret in str(key).lower() for secret in SENSITIVE)}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


def attach_actor(db, request):
    if request is None:
        return
    header = request.headers.get("authorization", "")
    claims = {}
    if header.startswith("Bearer "):
        try:
            claims = jwt.decode(header[7:], os.getenv("JWT_SECRET", "hariom-secret-key-123"), algorithms=["HS256"])
        except jwt.InvalidTokenError:
            pass
    db.info["audit_actor"] = {"actor_user_id": claims.get("actual_user_id") or claims.get("user_id"),
        "actor_email": claims.get("actual_sub") or claims.get("sub"),
        "actor_role": ",".join(claims.get("effective_roles") or claims.get("roles") or []),
        "request_path": request.url.path}


def install_outbox(base, session_factory, service):
    table = Table("audit_outbox", base.metadata,
        Column("id", String(36), primary_key=True),
        Column("occurred_at", DateTime, nullable=False),
        Column("body", Text, nullable=False),
        Column("delivered_at", DateTime, nullable=True, index=True),
        Column("attempts", Integer, nullable=False, default=0),
    )

    @event.listens_for(session_factory, "after_flush")
    def capture(session, flush_context):
        connection = session.connection()
        for operation, records in (("CREATED", session.new), ("UPDATED", session.dirty), ("DELETED", session.deleted)):
            for record in records:
                state = inspect(record)
                if operation == "UPDATED" and not session.is_modified(record, include_collections=True):
                    continue
                before, after = {}, {}
                for column in state.mapper.column_attrs:
                    name = column.key
                    if any(secret in name.lower() for secret in SENSITIVE):
                        continue
                    value = getattr(record, name)
                    history = state.attrs[name].history
                    if operation != "UPDATED" or history.has_changes():
                        after[name] = redact(value)
                        if history.deleted:
                            before[name] = redact(history.deleted[0])
                if not after and operation == "UPDATED":
                    continue
                event_id = str(uuid.uuid4())
                occurred = datetime.utcnow()
                entity = state.mapper.local_table.name
                entity_id = str(getattr(record, "id", ""))
                body = {"id": event_id, "occurred_at": occurred.isoformat(), "source_service": service,
                    "event_type": f"{entity.upper()}_{operation}", "entity_type": entity, "entity_id": entity_id,
                    "plant_id": str(getattr(record, "plant_id", "")) or None,
                    "summary": f"{entity} {operation.lower()}: {entity_id}",
                    **session.info.get("audit_actor", {}),
                    "payload": {"before": before, "after": after, "capture": "transactional"}}
                connection.execute(table.insert().values(id=event_id, occurred_at=occurred,
                    body=json.dumps(body, default=str), attempts=0))
    return table
