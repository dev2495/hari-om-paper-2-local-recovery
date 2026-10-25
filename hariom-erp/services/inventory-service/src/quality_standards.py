"""Inward QC standards (client rule 2026-10-18).

QC keeps one parameter list per material type (Quality > Material standards): which checks
exist, their unit and input type, and whether each is switched on. Masters set the tolerance
band for each measured parameter, per material line (item) or per group of lines (paper
variety, parchment company or company + colour, ...). The item's incoming QC profile is
derived from both, so it is always complete and approved: a lot is flagged and held only when a
reading falls outside its band. Every receipt still pins the profile in force on its date.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from .models import (
    InventoryQualityStandardEvent,
    InventoryQualityTemplate,
    InventoryQualityTolerance,
    ItemMaster,
)

# Material types with inward QC standards; FINISHED_GOOD (customer returns) keeps its own form.
MATERIAL_TYPES: dict[str, dict[str, Optional[str]]] = {
    "RAW_PAPER": {"label": "Paper", "group": "Paper variety", "subgroup": None, "master": "/masters/papers"},
    "PARCHMENT": {"label": "Parchment", "group": "Company", "subgroup": "Colour", "master": "/masters/parchments"},
    "ADHESIVE": {"label": "Adhesive", "group": "Adhesive variety", "subgroup": None, "master": "/masters/adhesives"},
    "PACKAGING": {"label": "Packing material", "group": "Packing kind", "subgroup": None, "master": "/masters/packaging"},
    "TOOL": {"label": "Tools", "group": "Tool category", "subgroup": None, "master": "/masters/tools"},
    "OTHER": {"label": "Other material", "group": "Group", "subgroup": None, "master": None},
}
SCOPES = ("ITEM", "SUBGROUP", "GROUP", "TYPE")
# RANGE: min-max. PLUS_MINUS / PERCENT: around the line's master value. AT_LEAST / AT_MOST: not
# below / not above the line's master value, less / plus an optional allowance (client QC sheet
# 2026-10-18: "GSM, BF, polybond >= required").
MODES = ("RANGE", "PLUS_MINUS", "PERCENT", "AT_LEAST", "AT_MOST")
NUMERIC_INPUTS = frozenset({"number", "numeric", "measured", ""})
SUBGROUP_SEPARATOR = "||"


def item_type(item: ItemMaster) -> str:
    value = item.type.value if hasattr(item.type, "value") else str(item.type)
    return str(value or "OTHER").upper()


def is_numeric(input_type: Any) -> bool:
    return str(input_type or "number").strip().lower() in NUMERIC_INPUTS


def line_key(code: Any) -> str:
    """A material line is identified by its code (the paper / adhesive / packing master code),
    so the band set on a master row applies to that material in every plant."""
    return str(code or "").strip().upper()


def subgroup_key(group: Optional[str], subgroup: Optional[str]) -> str:
    return f"{(group or '').strip()}{SUBGROUP_SEPARATOR}{(subgroup or '').strip()}"


def _number(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def parameters_for(db: Session, material_type: str, *, include_inactive: bool = False) -> list[InventoryQualityTemplate]:
    query = db.query(InventoryQualityTemplate).filter(
        InventoryQualityTemplate.material_type == material_type,
        InventoryQualityTemplate.plant_id == "GLOBAL",
    )
    if not include_inactive:
        query = query.filter(InventoryQualityTemplate.active == "true")
    return query.order_by(InventoryQualityTemplate.sort_order.asc(), InventoryQualityTemplate.label.asc()).all()


def tolerance_index(db: Session, material_type: str) -> dict[tuple[str, str, str], InventoryQualityTolerance]:
    rows = db.query(InventoryQualityTolerance).filter(InventoryQualityTolerance.material_type == material_type).all()
    return {(row.scope, row.scope_key or "", row.parameter_key): row for row in rows}


def scope_chain(item: ItemMaster) -> list[tuple[str, str]]:
    chain: list[tuple[str, str]] = [("ITEM", line_key(item.item_code))]
    group = (item.material_group or "").strip()
    subgroup = (item.material_subgroup or "").strip()
    if group and subgroup:
        chain.append(("SUBGROUP", subgroup_key(group, subgroup)))
    if group:
        chain.append(("GROUP", group))
    chain.append(("TYPE", ""))
    return chain


def band_from_row(row: InventoryQualityTolerance, nominal: Optional[float]) -> Optional[tuple[Optional[float], Optional[float]]]:
    """(min, max) for a tolerance row, or None when a +/- row has no nominal to centre on."""
    mode = str(row.mode or "RANGE").upper()
    if mode == "RANGE":
        lower, upper = _number(row.min_value), _number(row.max_value)
        return None if lower is None and upper is None else (lower, upper)
    if mode in ("AT_LEAST", "AT_MOST"):
        if nominal is None:
            return None
        allowance = abs(_number(row.tolerance_value) or 0.0)
        return (round(nominal - allowance, 6), None) if mode == "AT_LEAST" else (None, round(nominal + allowance, 6))
    spread = _number(row.tolerance_value)
    if spread is None or nominal is None:
        return None
    if mode == "PERCENT":
        spread = abs(nominal) * spread / 100.0
    return (round(nominal - spread, 6), round(nominal + spread, 6))


def resolve_band(item: ItemMaster, code: str, index: dict) -> dict[str, Any]:
    """Most specific band for one parameter of one item: ITEM > SUBGROUP > GROUP > TYPE."""
    nominal = _number((item.qc_nominals or {}).get(code)) if isinstance(item.qc_nominals, dict) else None
    for scope, key in scope_chain(item):
        row = index.get((scope, key, code))
        if row is None:
            continue
        band = band_from_row(row, nominal)
        if band is None:
            # A +/- band without the line's nominal cannot centre; keep looking upward.
            continue
        return {
            "min": band[0],
            "max": band[1],
            "source": scope,
            "source_key": key,
            "mode": row.mode,
            "tolerance_value": row.tolerance_value,
            "nominal": nominal,
        }
    return {"min": None, "max": None, "source": None, "source_key": None, "mode": None, "tolerance_value": None, "nominal": nominal}


def build_parameters(item: ItemMaster, parameters: Iterable[InventoryQualityTemplate], index: dict) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for parameter in parameters:
        row: dict[str, Any] = {
            "code": parameter.parameter_key,
            "label": parameter.label,
            "unit": parameter.unit or "",
            "input_type": parameter.input_type or "number",
            "options": list(parameter.options or []),
            "required": bool(parameter.required),
            "applicable": True,
            "min": None,
            "max": None,
        }
        if is_numeric(parameter.input_type):
            band = resolve_band(item, parameter.parameter_key, index)
            row.update(min=band["min"], max=band["max"], nominal=band["nominal"], tolerance_source=band["source"])
            if band["min"] is None and band["max"] is None:
                # No band set in Masters: the reading is recorded, never decides the lot.
                row["record_only"] = True
        rows.append(row)
    return rows


def fingerprint(parameters: list[dict[str, Any]]) -> str:
    return hashlib.sha256(json.dumps(parameters, sort_keys=True, default=str).encode()).hexdigest()


def materialize_item(db: Session, item: ItemMaster, *, actor: str = "standards", reason: str = "Standards updated",
                     parameters: Optional[list[InventoryQualityTemplate]] = None, index: Optional[dict] = None) -> bool:
    """Write the item's derived incoming QC profile when it changed. Returns True when written."""
    material = item_type(item)
    if material not in MATERIAL_TYPES:
        return False
    parameters = parameters if parameters is not None else parameters_for(db, material)
    index = index if index is not None else tolerance_index(db, material)
    rows = build_parameters(item, parameters, index)
    digest = fingerprint(rows)
    current = item.quality_profile if isinstance(item.quality_profile, dict) else {}
    if current.get("standards_fingerprint") == digest and str(current.get("status") or "").lower() == "approved":
        return False
    revision = int(current.get("revision") or 0) + 1
    now = datetime.utcnow().isoformat()
    profile: dict[str, Any] = {
        "parameters": rows,
        "status": "approved",
        "setup_status": "approved",
        "inspection_required": True,
        "revision": revision,
        "source": "STANDARDS",
        "standards_fingerprint": digest,
        "approved_by": actor,
        "approved_at": now,
    }
    profile["approved_snapshot"] = {key: value for key, value in profile.items()}
    history = list(current.get("history") or [])[-49:]
    history.append({
        "action": "STANDARDS_APPLIED", "actor": actor, "at": now + "Z", "revision": revision, "status": "approved",
        "reason": reason, "before_parameters": current.get("parameters") or [], "parameters": rows,
    })
    profile["history"] = history
    item.quality_profile = profile
    return True


def materialize_type(db: Session, material_type: str, *, actor: str, reason: str, item_ids: Optional[set] = None) -> int:
    parameters = parameters_for(db, material_type)
    index = tolerance_index(db, material_type)
    count = 0
    for item in db.query(ItemMaster).filter(ItemMaster.type == material_type).all():
        if item_ids is not None and item.id not in item_ids:
            continue
        if materialize_item(db, item, actor=actor, reason=reason, parameters=parameters, index=index):
            count += 1
    return count


def record_event(db: Session, *, material_type: str, kind: str, actor: Optional[str], before: Any = None, after: Any = None,
                 scope: Optional[str] = None, scope_key: Optional[str] = None, parameter_key: Optional[str] = None,
                 note: Optional[str] = None, version: Optional[int] = None) -> None:
    db.add(InventoryQualityStandardEvent(
        material_type=material_type, kind=kind, scope=scope, scope_key=scope_key, parameter_key=parameter_key,
        before=before, after=after, note=note, actor=actor, version=version,
    ))


def next_scope_version(db: Session, material_type: str, scope: str, scope_key: str) -> int:
    """Each save of a scope's bands is one new version; earlier versions stay in the audit trail."""
    from sqlalchemy import func

    current = db.query(func.max(InventoryQualityStandardEvent.version)).filter(
        InventoryQualityStandardEvent.material_type == material_type,
        InventoryQualityStandardEvent.scope == scope,
        InventoryQualityStandardEvent.scope_key == scope_key,
    ).scalar()
    return int(current or 0) + 1


def rekey_item_tolerances(db: Session) -> int:
    """Line bands are keyed by the material code; rows saved against an item id move to its code."""
    moved = 0
    for row in db.query(InventoryQualityTolerance).filter(InventoryQualityTolerance.scope == "ITEM").all():
        key = row.scope_key or ""
        if len(key) != 36 or key.count("-") != 4:
            continue
        try:
            item = db.query(ItemMaster).filter(ItemMaster.id == uuid.UUID(key)).first()
        except ValueError:
            continue
        if item is None:
            continue
        code = line_key(item.item_code)
        clash = db.query(InventoryQualityTolerance).filter_by(material_type=row.material_type, scope="ITEM", scope_key=code, parameter_key=row.parameter_key).first()
        if clash:
            db.delete(row)
        else:
            row.scope_key = code
        moved += 1
    db.flush()
    return moved


def tolerance_dict(row: InventoryQualityTolerance) -> dict[str, Any]:
    return {
        "id": str(row.id), "material_type": row.material_type, "scope": row.scope, "scope_key": row.scope_key or "",
        "parameter_key": row.parameter_key, "mode": row.mode, "min_value": row.min_value, "max_value": row.max_value,
        "tolerance_value": row.tolerance_value, "version": row.version, "note": row.note, "updated_by": row.updated_by,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def adopt_existing_profile_bands(db: Session) -> int:
    """One-time carry-over: bands QC already approved per item become ITEM tolerances, so the
    switch to derived profiles never loosens or drops a live check."""
    created = 0
    for item in db.query(ItemMaster).all():
        material = item_type(item)
        profile = item.quality_profile if isinstance(item.quality_profile, dict) else {}
        if material not in MATERIAL_TYPES or not profile or profile.get("source") == "STANDARDS":
            continue
        approved = profile if str(profile.get("status") or "").lower() == "approved" else (profile.get("approved_snapshot") or {})
        if str(approved.get("status") or "").lower() != "approved":
            continue
        for parameter in approved.get("parameters") or []:
            if not isinstance(parameter, dict) or not is_numeric(parameter.get("input_type")):
                continue
            code = str(parameter.get("code") or parameter.get("parameter_key") or "").strip()
            lower, upper = _number(parameter.get("min")), _number(parameter.get("max"))
            if not code or (lower is None and upper is None):
                continue
            exists = db.query(InventoryQualityTolerance).filter_by(material_type=material, scope="ITEM", scope_key=line_key(item.item_code), parameter_key=code).first()
            if exists:
                continue
            db.add(InventoryQualityTolerance(material_type=material, scope="ITEM", scope_key=line_key(item.item_code), parameter_key=code,
                                             mode="RANGE", min_value=lower, max_value=upper,
                                             note="Carried over from the approved item QC profile", updated_by="migration"))
            created += 1
    db.flush()
    return created


# Client QC sheet (2026-10-18), as typed on the live Material standards page: these paper checks
# are measured, and their acceptance rule applies to every paper line unless Masters set another.
CLIENT_PAPER_RULES: dict[str, dict[str, Any]] = {
    "gsm": {"mode": "AT_LEAST", "tolerance_value": 0.0, "label": "GSM", "unit": "g/m²", "rule": "at least the line's GSM"},
    "moisture_pct": {"mode": "RANGE", "min_value": 6.0, "max_value": 9.0, "label": "Moisture", "unit": "%", "rule": "6 to 9 %"},
    "caliper_mm": {"mode": "PLUS_MINUS", "tolerance_value": 0.025, "label": "Thickness", "unit": "mm", "rule": "± 0.025 mm of the line's thickness"},
    "bf": {"mode": "AT_LEAST", "tolerance_value": 0.0, "label": "BF", "unit": "", "rule": "at least the line's BF"},
    "ply_bond": {"mode": "AT_LEAST", "tolerance_value": 0.0, "label": "Polybond", "unit": "", "rule": "at least the line's polybond"},
    "bulk": {"mode": "AT_LEAST", "tolerance_value": 0.0, "label": "Bulk", "unit": "", "rule": "at least the line's bulk"},
}
_RULE_WORDS = re.compile(r"GREATER|LESS|REQUIRED|>=|<=|>|<|\+/-|±|FROM_THE|MM_FROM|ALWAYS|%")


def convert_rule_text_checks(db: Session) -> int:
    """A measured paper check that was set up as pass / fail with its acceptance rule typed as the
    outcomes (live 2026-10-18: "IF GREATER THAN REQUIRED PASS / OK IF LESS THAN REQUIRED FAILED")
    can never be judged. Turn it back into a measured check; its rule becomes a band (below).
    The typed text is kept in the change history."""
    converted = 0
    rows = db.query(InventoryQualityTemplate).filter_by(plant_id="GLOBAL", material_type="RAW_PAPER").all()
    for row in rows:
        rule = CLIENT_PAPER_RULES.get(row.parameter_key)
        if rule is None or is_numeric(row.input_type):
            continue
        options = [str(option) for option in (row.options or [])]
        if not options or not any(_RULE_WORDS.search(option.upper()) for option in options):
            continue
        before = {"input_type": row.input_type, "options": options, "unit": row.unit}
        row.input_type, row.options = "number", []
        if not (row.unit or "").strip():
            row.unit = rule["unit"] or None
        row.updated_by, row.updated_at = "standards", datetime.utcnow()
        record_event(db, material_type="RAW_PAPER", kind="PARAMETER_UPDATED", actor="standards", before=before,
                     after={"input_type": "number", "options": [], "unit": row.unit},
                     parameter_key=row.parameter_key,
                     note=f"Rule typed as pass / fail outcomes; check made measurable, rule kept as the band: {rule['rule']}")
        converted += 1
    db.flush()
    return converted


_NOTE_KEYS = re.compile(r"^(remarks?|notes?|comments?|observations?)$")


def note_checks_as_text(db: Session) -> int:
    """A remark / note check is written in words (client 2026-10-25: "format of remark is number,
    need to change as word"). Any such check set up as a number becomes a text note again."""
    converted = 0
    for row in db.query(InventoryQualityTemplate).all():
        key = str(row.parameter_key or "").strip().lower()
        label = str(row.label or "").strip().lower()
        if not (_NOTE_KEYS.match(key) or _NOTE_KEYS.match(label)) or str(row.input_type or "").lower() == "text":
            continue
        before = {"input_type": row.input_type, "options": list(row.options or []), "unit": row.unit}
        row.input_type, row.options, row.unit = "text", [], None
        row.updated_by, row.updated_at = "standards", datetime.utcnow()
        record_event(db, material_type=row.material_type, kind="PARAMETER_UPDATED", actor="standards", before=before,
                     after={"input_type": "text", "options": [], "unit": None}, parameter_key=row.parameter_key,
                     note="A remark is written in words, not a number")
        converted += 1
    db.flush()
    return converted


def seed_client_paper_rules(db: Session) -> int:
    """All-paper default bands from the client's QC sheet, only where none was ever set."""
    created = 0
    for code, rule in CLIENT_PAPER_RULES.items():
        exists = db.query(InventoryQualityTolerance).filter_by(material_type="RAW_PAPER", scope="TYPE", scope_key="", parameter_key=code).first()
        history = db.query(InventoryQualityStandardEvent).filter_by(material_type="RAW_PAPER", scope="TYPE", scope_key="", parameter_key=code).first()
        if exists or history:
            continue
        version = next_scope_version(db, "RAW_PAPER", "TYPE", "")
        row = InventoryQualityTolerance(material_type="RAW_PAPER", scope="TYPE", scope_key="", parameter_key=code, mode=rule["mode"],
                                        min_value=rule.get("min_value"), max_value=rule.get("max_value"), tolerance_value=rule.get("tolerance_value"),
                                        version=version, note="Client QC sheet rule", updated_by="standards", updated_at=datetime.utcnow())
        db.add(row)
        db.flush()
        record_event(db, material_type="RAW_PAPER", kind="TOLERANCE_SET", actor="standards", after=tolerance_dict(row), scope="TYPE", scope_key="",
                     parameter_key=code, note=f"Client QC sheet rule: {rule['rule']}", version=version)
        created += 1
    db.flush()
    return created

