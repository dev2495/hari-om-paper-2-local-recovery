"""Find a lot, reel or coil by the number a person types (client 2026-10-30, issue desks).

A typed number must work as well as a scan: the Amigo inward / lot number, the AT number, the vendor reel
number, an opening-stock old mark or a GRN number, in any case, with or without spaces, slashes or dashes,
or a unique part of one. Read only; the caller scopes the plants and checks the role.

Matching, best first (only the best level is returned):
  0. the same text (case and spaces ignored);
  1. the same letters and digits (``in 26 028 b002`` = ``IN/26/028-B002``);
  2. the GRN number (one GRN can hold several lots, so this may give several);
  3. part of a number (at least 3 letters / digits). Used-up stock is left out when live stock also matches.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Iterable, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models import InventoryLocation, ItemMaster, PaperReel, StockBatch
from .stock_lots import _enum, _unwrap, batch_balances, lot_row

KINDS = {"ALL", "LOT", "REEL"}
MIN_PART = 3
SAME_TEXT, SAME_CHARS, SAME_GRN, PART = 0, 1, 2, 3
LEVEL_WORDS = {SAME_TEXT: "EXACT", SAME_CHARS: "EXACT", SAME_GRN: "EXACT", PART: "PARTIAL"}
_NOT_ALNUM = re.compile(r"[^A-Za-z0-9]")
_SPACE = re.compile(r"\s+")


def spaced(value: Any) -> str:
    """Upper case, spaces removed: ``in/26/028 - b002`` -> ``IN/26/028-B002``."""
    return _SPACE.sub("", str(value or "")).upper()


def compact(value: Any) -> str:
    """Letters and digits only, upper case: ``IN/26/028-B002`` -> ``IN26028B002``."""
    return _NOT_ALNUM.sub("", str(value or "")).upper()


def typed_number(code: Any) -> str:
    """The number inside whatever was typed or pasted: a /scan link or a ``HARIOM|…|<number>`` payload gives its number."""
    text = _unwrap(str(code or "")).strip()
    parts = text.split("|")
    if len(parts) >= 5 and parts[0].strip().upper() == "HARIOM":
        text = "|".join(parts[4:]).strip()
    return text


def match_level(typed: str, keys: Iterable[tuple[str, Any]]) -> Optional[tuple[int, str, str]]:
    """Best (level, matched_on, value) of one record's numbers against the typed text, or None."""
    wanted_text, wanted_chars = spaced(typed), compact(typed)
    if not wanted_chars:
        return None
    best: Optional[tuple[int, str, str]] = None
    for matched_on, value in keys:
        if value is None or not str(value).strip():
            continue
        chars = compact(value)
        if not chars:
            continue
        if matched_on == "GRN":
            level = SAME_GRN if chars == wanted_chars else (PART if len(wanted_chars) >= MIN_PART and wanted_chars in chars else None)
        elif spaced(value) == wanted_text:
            level = SAME_TEXT
        elif chars == wanted_chars:
            level = SAME_CHARS
        elif len(wanted_chars) >= MIN_PART and wanted_chars in chars:
            level = PART
        else:
            level = None
        if level is not None and (best is None or level < best[0]):
            best = (level, matched_on, str(value).strip())
    return best


def batch_keys(batch: StockBatch) -> list[tuple[str, Any]]:
    meta = batch.inward_metadata if isinstance(batch.inward_metadata, dict) else {}
    saved = meta.get("saved_label") if isinstance(meta.get("saved_label"), dict) else {}
    return [
        ("LOT_NO", meta.get("amigo_no")), ("LOT_NO", saved.get("code")), ("LOT_NO", meta.get("label_code")),
        ("LOT_NO", saved.get("label_code")), ("LOT_NO", batch.batch_no), ("OLD_MARK", meta.get("old_mark")),
        ("GRN", meta.get("grn_no")),
    ]


def reel_keys(reel: PaperReel) -> list[tuple[str, Any]]:
    meta = reel.inward_metadata if isinstance(reel.inward_metadata, dict) else {}
    opening = str((reel.genealogy_metadata or {}).get("source_document_type") or "").upper() == "OPENING_LOAD"
    return [
        ("AT_NO", reel.reel_code), ("AT_NO", meta.get("amigo_no")),
        ("OLD_MARK" if opening else "VENDOR_REEL", reel.source_reel_no), ("OLD_MARK", meta.get("old_mark")),
    ]


def _sql_chars(expr):
    return func.upper(func.regexp_replace(func.coalesce(expr, ""), "[^A-Za-z0-9]", "", "g"))


def _uuid(value: Any) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _candidates(db: Session, plants: list[str], wanted_chars: str, kind: str) -> tuple[list[StockBatch], list[PaperReel]]:
    """Records whose numbers contain the typed letters / digits (PostgreSQL narrows it; the levels decide)."""
    postgres = db.get_bind().dialect.name == "postgresql"
    like = f"%{wanted_chars}%"
    batches: list[StockBatch] = []
    reels: list[PaperReel] = []
    if kind in {"ALL", "LOT"}:
        query = db.query(StockBatch).filter(StockBatch.plant_id.in_([str(plant) for plant in plants]))
        if postgres:
            meta = StockBatch.inward_metadata
            query = query.filter(or_(*[
                _sql_chars(expr).like(like) for expr in (
                    StockBatch.batch_no, meta["amigo_no"].as_string(), meta["label_code"].as_string(),
                    meta[("saved_label", "code")].as_string(), meta[("saved_label", "label_code")].as_string(),
                    meta["old_mark"].as_string(), meta["grn_no"].as_string(),
                )
            ]))
        batches = query.all()
    reel_plants = [value for value in (_uuid(plant) for plant in plants) if value is not None]
    if kind in {"ALL", "REEL"} and reel_plants:
        query = db.query(PaperReel).filter(PaperReel.plant_id.in_(reel_plants))
        if postgres:
            meta = PaperReel.inward_metadata
            query = query.filter(or_(*[
                _sql_chars(expr).like(like) for expr in (
                    PaperReel.reel_code, PaperReel.source_reel_no, meta["amigo_no"].as_string(), meta["old_mark"].as_string(),
                )
            ]))
        reels = query.all()
    return batches, reels


def find_by_number(db: Session, plants: list[str], code: Any, *, kind: str = "ALL", limit: int = 12) -> dict[str, Any]:
    """Lots and reels / coils in these plants whose number matches the typed text, oldest first."""
    kind = str(kind or "ALL").upper()
    kind = kind if kind in KINDS else "ALL"
    typed = typed_number(code)
    wanted_chars = compact(typed)
    empty = {"code": typed, "match": "NONE", "count": 0, "truncated": False, "rows": []}
    if not wanted_chars or not plants:
        return empty
    batches, reels = _candidates(db, plants, wanted_chars, kind)
    scored: list[tuple[int, str, str, Any]] = []
    for record in [*batches, *reels]:
        found = match_level(typed, batch_keys(record) if isinstance(record, StockBatch) else reel_keys(record))
        if found is not None:
            scored.append((found[0], found[1], found[2], record))
    if not scored:
        return empty
    best = min(level for level, *_ in scored)
    chosen = [row for row in scored if row[0] == best]
    balances = batch_balances(db, [record.id for *_, record in chosen if isinstance(record, StockBatch)])

    def qty(record: Any) -> float:
        if isinstance(record, StockBatch):
            return float(balances.get(str(record.id), 0.0))
        return round(float(record.current_weight_kg or 0.0), 3) if _enum(record.status) == "IN_STOCK" else 0.0

    if best == PART and any(qty(record) > 1e-9 for *_, record in chosen):
        # A part of a number points at live stock: lots and reels already used up drop out of the list.
        chosen = [row for row in chosen if qty(row[3]) > 1e-9]
    chosen.sort(key=lambda row: (str(getattr(row[3], "created_at", "") or ""), str(row[3].id)))
    shown = chosen[:limit]
    item_ids = {record.item_id if isinstance(record, StockBatch) else record.paper_id for *_, record in shown}
    items = {str(item.id): item for item in db.query(ItemMaster).filter(ItemMaster.id.in_(item_ids)).all()} if item_ids else {}
    location_ids = {record.location_id for *_, record in shown if record.location_id}
    locations = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.id.in_(location_ids)).all()} if location_ids else {}
    rows = []
    for _, matched_on, value, record in shown:
        is_reel = isinstance(record, PaperReel)
        item = items.get(str(record.paper_id if is_reel else record.item_id))
        meta = record.inward_metadata if isinstance(record.inward_metadata, dict) else {}
        row = lot_row(record, item, qty(record), locations=locations)
        row.update({
            "kind": "REEL" if is_reel else "LOT",
            "plant_id": str(record.plant_id),
            "status": _enum(record.status) if is_reel else None,
            "tracking_mode": _enum(getattr(item, "tracking_mode", None)) or None,
            "batch_no": None if is_reel else record.batch_no,
            "grn_no": meta.get("grn_no"),
            "vendor_reel_no": record.source_reel_no if is_reel else None,
            "old_mark": meta.get("old_mark"),
            "matched_on": matched_on,
            "matched_value": value,
        })
        rows.append(row)
    return {"code": typed, "match": LEVEL_WORDS[best], "count": len(chosen), "truncated": len(chosen) > len(shown), "rows": rows}
