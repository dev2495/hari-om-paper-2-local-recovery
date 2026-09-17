"""Server-side verdict computation for incoming (inventory) quality inspections.

Audit finding Q04: the inspected incoming-QC command trusted the client-supplied
``status`` and ``failures`` fields, so a caller could assert ``PASS`` (and unlock
stock) for a lot with a missing, non-numeric, out-of-option or explicitly failing
reading.

This module recomputes the verdict from the *owned lot's* frozen quality template
rules and the recorded readings. The template rows are the frozen rules
(``required`` flag, ``input_type`` and ``options``); the readings are the recorded
evidence. The verdict is never taken from the request body.

The ``inventory_quality_inspections.status`` column is constrained to
``PENDING/PASS/FAIL/SKIPPED``. To respect that contract without a migration, any
missing / invalid / failing evidence resolves to ``FAIL`` while the precise reason
(``MISSING`` / ``INVALID`` / ``FAIL``) is preserved per-parameter in ``failures``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# Select-option values that mean the material did NOT pass. These are conservative:
# they only push a lot toward FAIL/BLOCK, never toward a false PASS.
FAILING_SELECT_TOKENS = {"FAIL", "FAILED", "REJECT", "REJECTED", "HOLD", "NO", "NG", "NOT_OK", "NOTOK"}


@dataclass
class IncomingQualityEvaluation:
    status: str
    failures: list[dict[str, Any]] = field(default_factory=list)

    def summary(self) -> str:
        return "; ".join(
            f"{item.get('label') or item.get('parameter')}: {item.get('reason')}"
            for item in self.failures
        )


def _reading_present(raw: Any) -> bool:
    if raw is None:
        return False
    if isinstance(raw, str):
        return raw.strip() != ""
    return True


def _is_finite_number(raw: Any) -> bool:
    if isinstance(raw, bool):
        return False
    try:
        value = float(str(raw).strip()) if isinstance(raw, str) else float(raw)
    except (TypeError, ValueError):
        return False
    return math.isfinite(value)


def evaluate_incoming_quality(template_rows: Iterable[Any], readings: dict[str, Any]) -> IncomingQualityEvaluation:
    """Compute PASS/FAIL from frozen template rules and recorded readings.

    ``template_rows`` are ``InventoryQualityTemplate`` objects (or any object with
    ``parameter_key``, ``label``, ``input_type``, ``options`` and ``required``).
    """
    values = readings or {}
    failures: list[dict[str, Any]] = []

    for row in template_rows:
        key = getattr(row, "parameter_key", None)
        if not key:
            continue
        label = getattr(row, "label", None) or key
        required = bool(getattr(row, "required", False))
        input_type = str(getattr(row, "input_type", "number") or "number").strip().lower()
        options = [str(opt).strip().upper() for opt in (getattr(row, "options", None) or [])]

        raw = values.get(key)
        present = _reading_present(raw)

        if not present:
            if required:
                failures.append(
                    {"parameter": key, "label": label, "reason": "MISSING", "detail": "required reading is missing"}
                )
            continue

        if input_type == "number":
            if not _is_finite_number(raw):
                failures.append(
                    {"parameter": key, "label": label, "reason": "INVALID", "value": raw, "detail": "reading is not a finite number"}
                )
                continue
        elif input_type == "select":
            token = str(raw).strip().upper()
            if options and token not in options:
                failures.append(
                    {"parameter": key, "label": label, "reason": "INVALID", "value": raw, "detail": f"value not in {options}"}
                )
                continue
            if token in FAILING_SELECT_TOKENS:
                failures.append(
                    {"parameter": key, "label": label, "reason": "FAIL", "value": raw, "detail": "failing selection"}
                )
                continue
        elif input_type == "boolean":
            token = str(raw).strip().upper()
            if token in {"FALSE", "NO", "0", "FAIL"}:
                failures.append(
                    {"parameter": key, "label": label, "reason": "FAIL", "value": raw, "detail": "failing boolean"}
                )
                continue
        # text inputs: presence already satisfied above; nothing else to validate.

    status = "FAIL" if failures else "PASS"
    return IncomingQualityEvaluation(status=status, failures=failures)
