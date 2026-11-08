"""Gate sweep (6 Nov 2026), the same in-process timer pattern as the weight reminder sweep.

Every 5 minutes (GATE_SWEEP_SECONDS):
- material bills at the gate for more than 24 h without a GRN → one reminder to Store and the plant head;
- visitors still waiting (ARRIVED) after 12 h → NO_SHOW;
- after the plant's gate close time, once a day: Owner digest of visitors still inside (GATE_OVERSTAY_DIGEST)
  and Dispatch + Store notice of today's challans with no linked gate-out photo (DISPATCH_NOT_OUT), and a
  Store + plant head reminder of goods-out photos still not linked to a challan (GATE_GOODS_OUT_UNLINKED);
- photos of a linked gate entry that uploaded after the link get the GRN / reel links;
- visitor photos older than the plant's retention are purged (the visit log stays).

Lists compute "overstay" and "waiting since" on read, so nothing on screen depends on this thread.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from typing import Optional

from .database import SessionLocal

log = logging.getLogger(__name__)
INTERVAL_SECONDS = int(os.getenv("GATE_SWEEP_SECONDS", "300"))
_stop = threading.Event()


def sweep_once(now: Optional[datetime] = None) -> dict[str, int]:
    from .services import gate as svc

    counts: dict[str, int] = {}
    db = SessionLocal()
    try:
        counts["unlinked_reminders"] = svc.remind_unlinked_material(db, now)
        counts["no_shows"] = svc.mark_no_shows(db, now)
        counts["links"] = svc.sync_recent_links(db, now)
        db.commit()
        for plant_id in svc.gate_plants(db):
            try:
                counts["overstay"] = counts.get("overstay", 0) + svc.overstay_digest(db, plant_id, now)
                counts["not_out"] = counts.get("not_out", 0) + svc.dispatch_not_out(db, plant_id, now)
                counts["goods_out_unlinked"] = counts.get("goods_out_unlinked", 0) + svc.goods_out_unlinked(db, plant_id, now)
                counts["purged"] = counts.get("purged", 0) + svc.purge_visitor_photos(db, plant_id, now)
                db.commit()
            except Exception:
                db.rollback()
                log.exception("gate sweep failed for plant %s", plant_id)
        return counts
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run() -> None:
    while not _stop.wait(INTERVAL_SECONDS):
        if os.getenv("ERP_MAINTENANCE", "0") == "1":
            continue
        try:
            counts = sweep_once()
            if any(counts.values()):
                log.info("gate sweep: %s", counts)
        except Exception:
            log.exception("gate sweep failed")


def start() -> None:
    if os.getenv("GATE_WORKER_ENABLED", "1") == "1":
        _stop.clear()
        threading.Thread(target=run, daemon=True, name="gate-sweep").start()


def stop() -> None:
    _stop.set()
