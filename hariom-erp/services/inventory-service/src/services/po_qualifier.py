"""Retain supplier PO quality strings without guessing inclusive/exclusive bounds."""

from __future__ import annotations

import re
from typing import Any, Optional


_PLUS = re.compile(
    r"^(?P<token>[A-Za-z]+)[\s:=-]*(?P<value>\d+(?:\.\d+)?)(?P<plus>\+)?\s*$"
)
_RANGE = re.compile(
    r"^(?P<token>[A-Za-z]+)[\s:=-]*(?P<low>\d+(?:\.\d+)?)\s*[-–to]+\s*(?P<high>\d+(?:\.\d+)?)\s*$"
)

TOKEN_TO_PROFILE_CODE = {
    "PB": "ply_bond",
    "PLYBOND": "ply_bond",
    "PLY_BOND": "ply_bond",
    "BF": "bf",
    "GSM": "gsm",
    "BS": "bs",
    "COBB": "cobb",
    "BULK": "bulk",
}


def parse_po_qualifier(raw: str) -> dict[str, Any]:
    text = str(raw or "").strip()
    payload: dict[str, Any] = {
        "raw": text,
        "plus_retained": False,
        "comparator_status": "UNCONFIRMED",
        "inclusive_min": None,
        "inclusive_max": None,
        "inclusive_guessed": False,
        "mapping_flagged": True,
        "parse_status": "UNPARSED",
        "token": None,
        "value": None,
        "profile_code": None,
    }
    if not text:
        payload["parse_status"] = "EMPTY"
        return payload
    plus_match = _PLUS.match(text)
    if plus_match:
        token = plus_match.group("token").upper()
        plus = bool(plus_match.group("plus"))
        payload.update(
            {
                "parse_status": "PARSED",
                "token": token,
                "value": float(plus_match.group("value")),
                "plus_retained": plus,
                "profile_code": TOKEN_TO_PROFILE_CODE.get(token),
                "mapping_flagged": True,
                "comparator_status": "UNCONFIRMED",
            }
        )
        return payload
    range_match = _RANGE.match(text)
    if range_match:
        token = range_match.group("token").upper()
        payload.update(
            {
                "parse_status": "PARSED",
                "token": token,
                "lower": float(range_match.group("low")),
                "upper": float(range_match.group("high")),
                "profile_code": TOKEN_TO_PROFILE_CODE.get(token),
                "mapping_flagged": True,
                "comparator_status": "UNCONFIRMED",
            }
        )
        return payload
    payload["token"] = text.split()[0].upper() if text.split() else None
    return payload


def qualifier_conflicts_item(parsed: dict[str, Any], profile: Any) -> Optional[dict[str, Any]]:
    if not isinstance(parsed, dict) or parsed.get("parse_status") in {"EMPTY", None}:
        return None
    if not isinstance(profile, dict) or not profile:
        return None
    params = profile.get("parameters") or []
    if not isinstance(params, list) or not params:
        return None
    code = parsed.get("profile_code")
    if not code:
        if parsed.get("token"):
            return {
                "code": "MISMATCHED_BASIS",
                "message": f"PO qualifier {parsed.get('raw')} does not share a confirmed basis with the item profile.",
                "qualifier": parsed,
            }
        return None
    match = None
    for row in params:
        if not isinstance(row, dict):
            continue
        key = str(row.get("code") or row.get("parameter_key") or "").strip().lower()
        if key == str(code).strip().lower():
            match = row
            break
    if match is None:
        return {
            "code": "MISMATCHED_BASIS",
            "message": f"PO qualifier {parsed.get('raw')} has no matching item parameter {code}.",
            "qualifier": parsed,
        }
    item_min = match.get("min") if match.get("min") is not None else match.get("lower")
    value = parsed.get("value")
    lower = parsed.get("lower")
    try:
        if value is not None and item_min is not None and float(value) < float(item_min) - 1e-9:
            return {
                "code": "QUALIFIER_WEAKER_THAN_ITEM",
                "message": "Supplier qualifier is weaker than the item/contract requirement and cannot be applied silently.",
                "qualifier": parsed,
                "item_min": item_min,
            }
        if lower is not None and item_min is not None and float(lower) < float(item_min) - 1e-9:
            return {
                "code": "QUALIFIER_WEAKER_THAN_ITEM",
                "message": "Supplier qualifier is weaker than the item/contract requirement and cannot be applied silently.",
                "qualifier": parsed,
                "item_min": item_min,
            }
    except (TypeError, ValueError):
        return {
            "code": "MISMATCHED_BASIS",
            "message": "Qualifier numeric basis could not be compared to the item profile.",
            "qualifier": parsed,
        }
    return None
