"""Consumption expectation service.

Gap 8 fix — one canonical place where the math
``released_qty → theoretical_consumption_kg → per-item-type tolerance``
is computed. Both the reconciliation router and the planning router
should depend on this module.

Inputs are kept dumb (raw dicts / model rows). Outputs are dumb dicts so
the caller can mold them into whatever Pydantic shape it needs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Iterable, Optional

# ──────────────────────────────────────────────────────────────────────────
# Tolerance + factor constants (single source of truth)
# ──────────────────────────────────────────────────────────────────────────

PAPER_EXPECTED_CONSUMPTION_FACTOR: float = 1.07
PAPER_STANDARD_WASTAGE_PERCENT: float = 7.0

VARIANCE_TOLERANCE_KG_BY_TYPE: dict[str, float] = {
    "RAW_PAPER": 5.0,
    "ADHESIVE": 0.5,
    "PARCHMENT": 1.0,
    "PACKAGING": 10.0,
}
VARIANCE_TOLERANCE_DEFAULT_KG: float = 5.0


def tolerance_for_item_type(item_type: Optional[str]) -> float:
    """Per-item-type variance tolerance (kg). Falls back to default if unknown."""
    if not item_type:
        return VARIANCE_TOLERANCE_DEFAULT_KG
    return VARIANCE_TOLERANCE_KG_BY_TYPE.get(item_type.upper(), VARIANCE_TOLERANCE_DEFAULT_KG)


def tolerance_for_item_type_with_overrides(
    item_type: Optional[str],
    overrides: Optional[dict[str, Any]] = None,
) -> float:
    """Plant-aware variant of ``tolerance_for_item_type``.

    Accepts a dict of overrides (typically read from ``PlantToleranceSetting``)
    of shape::

        {
            "default_kg": 5.0,
            "raw_paper_kg": 4.0,        # optional
            "adhesive_kg": 0.5,         # optional
            "parchment_kg": 1.0,        # optional
            "packaging_kg": 10.0,       # optional
        }

    Returns the override if present, otherwise falls through to the global
    default. Keeping this as a pure function makes it easy to call from both
    request handlers and tests.
    """
    if not overrides:
        return tolerance_for_item_type(item_type)
    key_for_type = {
        "RAW_PAPER": "raw_paper_kg",
        "ADHESIVE": "adhesive_kg",
        "PARCHMENT": "parchment_kg",
        "PACKAGING": "packaging_kg",
    }
    if item_type:
        column = key_for_type.get(item_type.upper())
        if column and overrides.get(column) is not None:
            try:
                return float(overrides[column])
            except (TypeError, ValueError):
                pass
    default_override = overrides.get("default_kg")
    if default_override is not None:
        try:
            return float(default_override)
        except (TypeError, ValueError):
            pass
    return tolerance_for_item_type(item_type)


def paper_expected_factor_with_overrides(
    *,
    is_paper: bool,
    provisional_kg: float,
    overrides: Optional[dict[str, Any]] = None,
) -> float:
    """Plant-aware paper expected-consumption factor.

    Factor wins when explicitly set. If only standard wastage percent is set,
    convert that to the equivalent multiplier. Falls back to the global factor.
    """
    if not is_paper or provisional_kg <= 0:
        return 1.0
    if overrides:
        factor = overrides.get("paper_expected_consumption_factor")
        if factor is not None:
            try:
                return float(factor)
            except (TypeError, ValueError):
                pass
        wastage_percent = overrides.get("paper_standard_wastage_percent")
        if wastage_percent is not None:
            try:
                return 1.0 + (float(wastage_percent) / 100.0)
            except (TypeError, ValueError):
                pass
    return PAPER_EXPECTED_CONSUMPTION_FACTOR


def is_raw_paper_item(
    item_code: str,
    item_name: Optional[str],
    inventory_item: dict[str, Any],
    paper_codes: set[str],
) -> bool:
    item_type = str(inventory_item.get("type") or "").strip().upper()
    code = str(item_code or "").strip().upper()
    name = str(item_name or inventory_item.get("name") or "").strip().upper()
    return item_type == "RAW_PAPER" or code in paper_codes or code.startswith("KRAFT") or "PAPER" in name


def paper_catalog_codes(paper_catalog: dict[str, dict[str, Any]]) -> set[str]:
    codes: set[str] = set()
    for paper_id, row in (paper_catalog or {}).items():
        for value in (paper_id, row.get("code")):
            code = str(value or "").strip().upper()
            if code:
                codes.add(code)
    return codes


# ──────────────────────────────────────────────────────────────────────────
# Provisional / theoretical computation from a single job-card snapshot
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class ProvisionalRow:
    """One BOM row's theoretical consumption for a given job card."""
    item_code: str
    item_name: Optional[str]
    theoretical_consumption_kg: float
    advisory_allocated_order_qty: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "item_code": self.item_code,
            "item_name": self.item_name,
            "theoretical_consumption_kg": round(self.theoretical_consumption_kg, 6),
            "advisory_allocated_order_qty": round(self.advisory_allocated_order_qty, 4),
        }


def _job_card_produced_qty(job_card: Any) -> float:
    """Pull produced-qty from a JobCard or dict — best of several signals."""
    candidates: list[float] = []
    for attr in ("produced_qty", "fg_qty", "completed_qty", "finished_qty"):
        value = getattr(job_card, attr, None) if not isinstance(job_card, dict) else job_card.get(attr)
        if value is not None:
            try:
                candidates.append(float(value))
            except (TypeError, ValueError):
                pass
    packing = getattr(job_card, "packing_record", None) if not isinstance(job_card, dict) else None
    if packing is not None:
        for attr in ("packed_qty", "fg_qty"):
            value = getattr(packing, attr, None)
            if value is not None:
                try:
                    candidates.append(float(value))
                except (TypeError, ValueError):
                    pass
    best_qty = max([q for q in candidates if q > 0], default=0.0)
    if best_qty > 0:
        return best_qty
    # Fallback for COMPLETED jobs: assume produced == planned
    status = str(getattr(job_card, "status", "") if not isinstance(job_card, dict) else job_card.get("status") or "").upper()
    if status == "COMPLETED":
        planned = getattr(job_card, "planned_qty", 0.0) if not isinstance(job_card, dict) else job_card.get("planned_qty", 0.0)
        try:
            return float(planned or 0.0)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def provisional_rows_for_job_card(
    job_card: Any,
    paper_catalog: dict[str, dict[str, Any]],
) -> list[ProvisionalRow]:
    """Given a job card with a BOM snapshot, return one ProvisionalRow per paper."""
    if isinstance(job_card, dict):
        material_snapshot = dict(job_card.get("material_plan_snapshot") or {})
    else:
        material_snapshot = dict(getattr(job_card, "material_plan_snapshot", {}) or {})

    bom_snapshot = dict(material_snapshot.get("bom_snapshot") or material_snapshot.get("theoretical_consumption") or {})
    paper_rows = list((((bom_snapshot.get("raw_materials") or {}).get("papers")) or []))
    if not paper_rows:
        return []

    planned_output_qty = float(
        material_snapshot.get("planned_output_qty")
        or (job_card.get("planned_qty") if isinstance(job_card, dict) else getattr(job_card, "planned_qty", 0.0))
        or 0.0
    )
    produced_qty = _job_card_produced_qty(job_card)
    if produced_qty <= 0 or planned_output_qty <= 0:
        return []

    ratio = max(0.0, min(1.5, produced_qty / planned_output_qty))
    target_bamboo_count = material_snapshot.get("target_bamboo_count")
    pcs_per_bamboo = material_snapshot.get("pcs_per_bamboo")
    provisional_bamboo_count: Optional[float] = None
    try:
        if target_bamboo_count:
            provisional_bamboo_count = float(target_bamboo_count) * ratio
        elif pcs_per_bamboo:
            provisional_bamboo_count = produced_qty / max(float(pcs_per_bamboo), 1.0)
    except (TypeError, ValueError):
        provisional_bamboo_count = None
    if not provisional_bamboo_count or provisional_bamboo_count <= 0:
        return []

    advisory_allocated_order_qty = produced_qty
    rows: list[ProvisionalRow] = []
    for paper_row in paper_rows:
        paper_id = str(paper_row.get("paper_id") or "")
        catalog_row = paper_catalog.get(paper_id, {})
        code = str(catalog_row.get("code") or paper_id or "UNKNOWN").strip().upper() or "UNKNOWN"
        name_parts = [
            str(catalog_row.get("variety") or "").strip(),
            f"GSM {catalog_row.get('gsm')}" if catalog_row.get("gsm") is not None else "",
        ]
        item_name = " · ".join([part for part in name_parts if part]) or None
        theoretical_kg = float(paper_row.get("weight_kg") or 0.0) * provisional_bamboo_count
        rows.append(
            ProvisionalRow(
                item_code=code,
                item_name=item_name,
                theoretical_consumption_kg=theoretical_kg,
                advisory_allocated_order_qty=advisory_allocated_order_qty,
            )
        )
    return rows


def aggregate_provisional_rows(rows: Iterable[ProvisionalRow]) -> dict[str, dict[str, Any]]:
    """Aggregate rows by item_code. Returns map { ITEM_CODE: { item_code, item_name, theoretical_consumption_kg, advisory_allocated_order_qty } }."""
    bucket: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = (row.item_code or "").strip().upper()
        if not code:
            continue
        cur = bucket.setdefault(
            code,
            {
                "item_code": code,
                "item_name": row.item_name,
                "theoretical_consumption_kg": 0.0,
                "advisory_allocated_order_qty": 0.0,
            },
        )
        cur["theoretical_consumption_kg"] = float(cur["theoretical_consumption_kg"]) + float(row.theoretical_consumption_kg or 0.0)
        cur["advisory_allocated_order_qty"] = float(cur["advisory_allocated_order_qty"]) + float(row.advisory_allocated_order_qty or 0.0)
        if not cur.get("item_name") and row.item_name:
            cur["item_name"] = row.item_name
    return bucket


# ──────────────────────────────────────────────────────────────────────────
# Window helpers
# ──────────────────────────────────────────────────────────────────────────


def next_month_start(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


def window_end_exclusive(start: date, days: int) -> date:
    return start + timedelta(days=days)


# ──────────────────────────────────────────────────────────────────────────
# Variance row composition (used by both monthly and weekly summaries)
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class ConsumptionStreams:
    """Pack of the three streams for a single item over a period."""
    item_code: str
    item_name: Optional[str] = None
    item_type: Optional[str] = None
    item_uom: Optional[str] = None
    item_id: Optional[str] = None
    unit_cost: float = 0.0
    theoretical_kg: float = 0.0
    provisional_theory_kg: float = 0.0
    ledger_issued_kg: float = 0.0
    actual_kg: float = 0.0
    actual_cost: float = 0.0
    notes: Optional[str] = None
    advisory_allocated_order_qty: float = 0.0
    is_paper: bool = False
    plant_overrides: Optional[dict[str, Any]] = field(default=None, repr=False)

    @property
    def expected_factor(self) -> float:
        return paper_expected_factor_with_overrides(
            is_paper=self.is_paper,
            provisional_kg=self.provisional_theory_kg,
            overrides=self.plant_overrides,
        )

    @property
    def standard_wastage_kg(self) -> Optional[float]:
        if self.is_paper and self.provisional_theory_kg > 0:
            return round(self.theoretical_kg - self.provisional_theory_kg, 6)
        return None

    @property
    def variance_kg(self) -> float:
        return round(self.actual_kg - self.theoretical_kg, 4)

    @property
    def ledger_vs_theoretical_kg(self) -> float:
        return round(self.ledger_issued_kg - self.theoretical_kg, 4)

    @property
    def ledger_vs_actual_kg(self) -> float:
        return round(self.ledger_issued_kg - self.actual_kg, 4)

    @property
    def theoretical_cost(self) -> float:
        return round(self.theoretical_kg * self.unit_cost, 4)

    @property
    def variance_cost(self) -> float:
        return round(self.actual_cost - self.theoretical_cost, 4)

    @property
    def variance_percent(self) -> float:
        if self.theoretical_kg > 0:
            return round((self.variance_kg / self.theoretical_kg) * 100.0, 2)
        return 0.0 if self.actual_kg == 0 else 100.0

    @property
    def tolerance_kg(self) -> float:
        return tolerance_for_item_type_with_overrides(self.item_type, self.plant_overrides)

    @property
    def over_tolerance(self) -> bool:
        return abs(self.variance_kg) > self.tolerance_kg

    @property
    def needs_explanation(self) -> bool:
        return self.over_tolerance and not (self.notes and self.notes.strip())

    def to_actual_row_dict(self) -> dict[str, Any]:
        """Shape that matches the MonthlyMaterialActualRow Pydantic model."""
        return {
            "item_code": self.item_code,
            "item_id": self.item_id,
            "item_name": self.item_name,
            "item_type": self.item_type,
            "item_uom": self.item_uom,
            "unit_cost": round(self.unit_cost, 4),
            "exact_output_paper_kg": round(self.provisional_theory_kg, 4) if self.is_paper and self.provisional_theory_kg > 0 else None,
            "standard_wastage_kg": self.standard_wastage_kg,
            "expected_consumption_factor": round(self.expected_factor, 4),
            "theoretical_consumption_kg": round(self.theoretical_kg, 4),
            "provisional_theory_consumption_kg": round(self.provisional_theory_kg, 4),
            "ledger_issued_kg": round(self.ledger_issued_kg, 4),
            "actual_consumption_kg": round(self.actual_kg, 4),
            "actual_month_end_consumption_kg": round(self.actual_kg, 4),
            "variance_kg": self.variance_kg,
            "variance_percent": self.variance_percent,
            "ledger_vs_theoretical_kg": self.ledger_vs_theoretical_kg,
            "ledger_vs_actual_kg": self.ledger_vs_actual_kg,
            "theoretical_cost": round(self.theoretical_cost, 2),
            "actual_cost": round(self.actual_cost, 2),
            "variance_cost": self.variance_cost,
            "advisory_allocated_order_qty": round(self.advisory_allocated_order_qty, 4),
            "notes": self.notes,
            "tolerance_kg": round(self.tolerance_kg, 4),
            "over_tolerance": self.over_tolerance,
            "needs_explanation": self.needs_explanation,
        }


def compose_streams_for_period(
    *,
    provisional_map: dict[str, dict[str, Any]],
    actual_map: dict[str, dict[str, Any]],
    ledger_map: dict[str, dict[str, Any]],
    inventory_catalog: dict[str, dict[str, Any]],
    paper_codes: set[str],
    plant_overrides: Optional[dict[str, Any]] = None,
) -> list[ConsumptionStreams]:
    """Merge the three sources into ConsumptionStreams rows, one per item.

    Inventory item codes are unioned in so empty-issue items still appear
    if they're tracked in the master.
    """
    inventory_codes_excl_fg = {
        code
        for code, item in inventory_catalog.items()
        if str(item.get("type") or "").strip().upper() != "FINISHED_GOOD"
    }
    keys = sorted(set(provisional_map.keys()) | set(actual_map.keys()) | inventory_codes_excl_fg | set(ledger_map.keys()))

    out: list[ConsumptionStreams] = []
    for code in keys:
        prov = provisional_map.get(code, {}) or {}
        actual = actual_map.get(code, {}) or {}
        ledger = ledger_map.get(code, {}) or {}
        inventory_item = inventory_catalog.get(code, {}) or {}

        provisional_kg = float(prov.get("theoretical_consumption_kg") or 0.0)
        if inventory_item.get("uom") == "L" and provisional_kg:
            density = float(inventory_item.get("density_kg_per_litre") or 0)
            if density <= 0:
                raise ValueError(f"Material {code} requires kg/litre density before reconciliation")
            provisional_kg /= density
        actual_kg = float(actual.get("actual_consumption_kg") or 0.0)
        ledger_kg = float(ledger.get("ledger_issued_kg") or 0.0)

        item_name = actual.get("item_name") or prov.get("item_name") or inventory_item.get("name")
        item_type = str(inventory_item.get("type") or "").strip().upper() or None
        paper_flag = is_raw_paper_item(code, str(item_name or ""), inventory_item, paper_codes)

        unit_cost = float(inventory_item.get("unit_cost") or 0.0)
        expected_factor = paper_expected_factor_with_overrides(
            is_paper=paper_flag,
            provisional_kg=provisional_kg,
            overrides=plant_overrides,
        )
        theoretical_kg = round(provisional_kg * expected_factor, 6)

        notes = actual.get("notes") if isinstance(actual.get("notes"), str) else None

        out.append(
            ConsumptionStreams(
                item_code=code,
                item_id=str(ledger.get("item_id") or inventory_item.get("id") or "") or None,
                item_name=item_name,
                item_type=item_type,
                item_uom=str(inventory_item.get("uom") or "").strip().upper() or None,
                unit_cost=unit_cost,
                theoretical_kg=theoretical_kg,
                provisional_theory_kg=provisional_kg,
                ledger_issued_kg=ledger_kg,
                actual_kg=actual_kg,
                actual_cost=float(actual.get("actual_cost") or 0.0),
                notes=notes,
                advisory_allocated_order_qty=float(prov.get("advisory_allocated_order_qty") or 0.0),
                is_paper=paper_flag,
                plant_overrides=plant_overrides,
            )
        )

    return out


def summarize_streams(rows: list[ConsumptionStreams]) -> dict[str, Any]:
    """Aggregate stream rows into a totals + flag summary."""
    totals = {
        "total_theoretical_consumption_kg": 0.0,
        "total_provisional_theory_consumption_kg": 0.0,
        "total_ledger_issued_kg": 0.0,
        "total_actual_consumption_kg": 0.0,
        "total_theoretical_cost": 0.0,
        "total_actual_cost": 0.0,
        "rows_over_tolerance": 0,
        "rows_needing_explanation": 0,
    }
    for row in rows:
        totals["total_theoretical_consumption_kg"] += row.theoretical_kg if row.item_uom in {None, "KG"} else 0
        totals["total_provisional_theory_consumption_kg"] += row.provisional_theory_kg if row.item_uom in {None, "KG"} else 0
        totals["total_ledger_issued_kg"] += row.ledger_issued_kg if row.item_uom in {None, "KG"} else 0
        totals["total_actual_consumption_kg"] += row.actual_kg if row.item_uom in {None, "KG"} else 0
        totals["total_theoretical_cost"] += row.theoretical_cost
        totals["total_actual_cost"] += row.actual_cost
        if row.over_tolerance:
            totals["rows_over_tolerance"] += 1
        if row.needs_explanation:
            totals["rows_needing_explanation"] += 1
    totals["total_variance_kg"] = round(totals["total_actual_consumption_kg"] - totals["total_theoretical_consumption_kg"], 4)
    totals["total_variance_cost"] = round(totals["total_actual_cost"] - totals["total_theoretical_cost"], 2)
    for k in (
        "total_theoretical_consumption_kg",
        "total_provisional_theory_consumption_kg",
        "total_ledger_issued_kg",
        "total_actual_consumption_kg",
        "total_theoretical_cost",
        "total_actual_cost",
    ):
        totals[k] = round(totals[k], 4 if "cost" not in k else 2)
    return totals


# ──────────────────────────────────────────────────────────────────────────
# Month-end close maths (spec 2.1 / 2.2, client 2026-10-28)
#
# Store figures come from inventory month-figures (every number in the item's own stock unit):
#   Closing = Opening + Received − Sent back − Issued + Corrections   (Received includes opening loads)
#   Actual used = Opening + Received − Sent back − Closing = Issued − Corrections
# Spec is BOM × good output posted at the card's final close; Expected = Spec × (1 + normal wastage %).
#   Floor gap = Issued − Expected     (the floor used more / less than spec + wastage)
#   Store gap = Actual used − Issued  (= −Corrections: shortage / excess found by counts)
#   Total gap = Actual used − Expected = Floor gap + Store gap
# Status is NOT_KNOWN until the month-end count is approved; the running month shows the floor gap only.
# Totals group by unit: a kg total never includes pieces.
# ──────────────────────────────────────────────────────────────────────────

from datetime import datetime, timezone  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
STORE_FIGURE_KEYS = ("opening", "received", "opening_loads", "sent_back", "issued", "corrections", "count_variance", "closing")
UNIT_TOTAL_KEYS = (
    "opening", "received", "opening_loads", "sent_back", "issued", "corrections", "count_variance", "closing",
    "actual_used", "spec", "expected", "floor_gap", "store_gap", "total_gap",
)
_UNIT_ALIASES = {
    "KGS": "KG", "KILOGRAM": "KG", "KILOGRAMS": "KG", "KG.": "KG",
    "PC": "PCS", "PCE": "PCS", "PIECE": "PCS", "PIECES": "PCS", "NOS": "PCS", "NO": "PCS", "NO.": "PCS", "EA": "PCS",
    "LTR": "L", "LTRS": "L", "LITRE": "L", "LITRES": "L", "LITER": "L", "LITERS": "L",
    "MTR": "M", "MTRS": "M", "METRE": "M", "METRES": "M",
}
_UNIT_LABELS = {"KG": "kg", "PCS": "pcs", "L": "litre", "M": "m", "G": "g", "TON": "tonne", "MT": "tonne"}


def ist_today() -> date:
    return datetime.now(IST).date()


def ist_day(value: Any) -> date:
    """IST calendar day of a naive-UTC server timestamp (a plain date is already a business day)."""
    if value is None:
        return ist_today()
    if isinstance(value, datetime):
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(IST).date()
    return value


def month_key(month: date) -> str:
    return f"{month.year:04d}-{month.month:02d}"


def month_label(month: date) -> str:
    """"October 2026"."""
    return f"{MONTH_NAMES[month.month - 1]} {month.year}"


def last_day_of_month(month: date) -> date:
    return next_month_start(month.replace(day=1)) - timedelta(days=1)


def financial_year_start(month: date) -> date:
    """1 April of the financial year a month belongs to (Jan–Mar belong to the year that began last April)."""
    return date(month.year if month.month >= 4 else month.year - 1, 4, 1)


def financial_year_label(month: date) -> str:
    """"2026-27" for any month from April 2026 to March 2027."""
    start = financial_year_start(month)
    return f"{start.year}-{(start.year + 1) % 100:02d}"


def parse_financial_year(value: str) -> date:
    """1 April of a "2026-27" (or "2026") label; ValueError otherwise."""
    text = str(value or "").strip()
    head = text.split("-")[0]
    if len(head) != 4 or not head.isdigit():
        raise ValueError("Give the financial year as 2026-27.")
    year = int(head)
    if "-" in text:
        tail = text.split("-", 1)[1]
        if not tail.isdigit() or int(tail) % 100 != (year + 1) % 100:
            raise ValueError("Give the financial year as 2026-27.")
    return date(year, 4, 1)


def normalize_uom(value: Any) -> str:
    """The stock unit key used for grouping ("KG", "PCS", "L" …); blank means kg (paper and adhesive)."""
    key = str(value or "").strip().upper()
    if not key:
        return "KG"
    return _UNIT_ALIASES.get(key, key)


def unit_label(uom: Any) -> str:
    key = normalize_uom(uom)
    return _UNIT_LABELS.get(key, key.lower())


def _num(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number else 0.0  # NaN → 0


def _r3(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    rounded = round(float(value), 3)
    return 0.0 if rounded == 0 else rounded


def store_identity_ok(figures: dict[str, Any], tolerance: float = 0.0005) -> bool:
    """Closing = Opening + Received − Sent back − Issued + Corrections, to 3 decimals."""
    expected_closing = (
        _num(figures.get("opening")) + _num(figures.get("received")) - _num(figures.get("sent_back"))
        - _num(figures.get("issued")) + _num(figures.get("corrections"))
    )
    return abs(round(expected_closing, 3) - round(_num(figures.get("closing")), 3)) <= tolerance


def store_actual_used(figures: dict[str, Any]) -> float:
    """Opening + Received − Sent back − Closing (equal to Issued − Corrections when the books hold)."""
    if figures.get("actual_used") is not None:
        return _num(figures.get("actual_used"))
    return (
        _num(figures.get("opening")) + _num(figures.get("received")) - _num(figures.get("sent_back"))
        - _num(figures.get("closing"))
    )


def month_end_item_row(
    *,
    figures: Optional[dict[str, Any]],
    spec_qty: float,
    limits: dict[str, Any],
    actual_known: bool,
) -> dict[str, Any]:
    """Every derived number for one item and month, in the item's own unit (spec 2.1).

    ``figures`` are the inventory month-figures of the item (None = no store movement or stock);
    ``limits`` the effective usage limits of its material type; ``actual_known`` is True only when the
    month has ended and its month-end count is approved. Before that, Actual / Store gap / Total gap are
    None, status is NOT_KNOWN and only the floor gap ("so far") is given.
    """
    from .usage_limits import allowed_gap as _allowed_gap, expected_use as _expected_use, gap_status as _gap_status

    figures = figures or {}
    store = {key: _num(figures.get(key)) for key in STORE_FIGURE_KEYS}
    spec = _num(spec_qty)
    expected = _expected_use(spec, limits)
    issued = store["issued"]
    actual_used = store_actual_used(figures) if figures else 0.0
    floor_gap = issued - expected
    allowed = _allowed_gap(expected, limits)
    store_gap = (actual_used - issued) if actual_known else None
    total_gap = (actual_used - expected) if actual_known else None
    status = _gap_status(_r3(total_gap) if total_gap is not None else None, allowed)
    floor_status = _gap_status(_r3(floor_gap), allowed)
    has_use = any(abs(value) > 0.0005 for value in (spec, issued, store["corrections"])) or (
        actual_known and abs(actual_used) > 0.0005
    )
    row = {key: _r3(value) for key, value in store.items()}
    row.update(
        {
            "actual_used": _r3(actual_used) if actual_known else None,
            "book_used": _r3(actual_used),
            "identity_ok": bool(figures.get("identity_ok", store_identity_ok(store))) if figures else True,
            "spec": _r3(spec),
            "normal_wastage_pct": _r3(_num(limits.get("normal_wastage_pct"))),
            "allowed_gap_pct": _r3(_num(limits.get("allowed_gap_pct"))),
            "min_gap": _r3(_num(limits.get("min_gap"))),
            "expected": _r3(expected),
            "wastage_allowance": _r3(expected - spec),
            "floor_gap": _r3(floor_gap),
            "store_gap": _r3(store_gap),
            "total_gap": _r3(total_gap),
            "allowed_gap": _r3(allowed),
            "status": status,
            "floor_status": floor_status,
            "has_use": bool(has_use),
        }
    )
    return row


FLOOR_SPLIT_KEYS = ("floor_over_items", "floor_over", "floor_under_items", "floor_under")


def floor_split_by_unit(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per unit: how many items the floor took more / less than spec + wastage for, beyond their own
    allowed gap, and by how much in total. The signed unit total nets these out (one item 200 pcs over
    and another 200 pcs under add up to 0), so a summary must never call such a unit "exactly"."""
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        uom = normalize_uom(row.get("uom"))
        bucket = out.setdefault(uom, {"floor_over_items": 0, "floor_over": 0.0, "floor_under_items": 0, "floor_under": 0.0})
        gap = _num(row.get("floor_gap"))
        status = str(row.get("floor_status") or "")
        if status == "OVER":
            bucket["floor_over_items"] += 1
            bucket["floor_over"] += gap
        elif status == "UNDER":
            bucket["floor_under_items"] += 1
            bucket["floor_under"] += abs(gap)
    for bucket in out.values():
        bucket["floor_over"] = _r3(bucket["floor_over"])
        bucket["floor_under"] = _r3(bucket["floor_under"])
    return out


def with_floor_split(units: Iterable[dict[str, Any]], rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Unit totals with the floor split filled in from the item rows (frozen snapshots taken before the
    split existed get it from their own items)."""
    split = floor_split_by_unit(rows)
    empty = {"floor_over_items": 0, "floor_over": 0.0, "floor_under_items": 0, "floor_under": 0.0}
    return [{**unit, **split.get(normalize_uom(unit.get("uom")), empty)} for unit in units]


def year_floor_split(month_rows: Iterable[Iterable[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Financial-year floor split per unit: each item's issued and expected are added over the months, and
    the item is over / under when its year gap is beyond max(allowed gap % x year expected, minimum gap)
    (the limits of its latest month)."""
    from .usage_limits import allowed_gap as _allowed_gap, gap_status as _gap_status

    items: dict[tuple[str, str], dict[str, Any]] = {}
    for rows in month_rows:
        for row in rows or []:
            code = str(row.get("item_code") or "").strip().upper()
            if not code:
                continue
            uom = normalize_uom(row.get("uom"))
            item = items.setdefault((uom, code), {"uom": uom, "issued": 0.0, "expected": 0.0})
            item["issued"] += _num(row.get("issued"))
            item["expected"] += _num(row.get("expected"))
            item["limits"] = {"allowed_gap_pct": row.get("allowed_gap_pct"), "min_gap": row.get("min_gap")}
    rows_out = []
    for item in items.values():
        gap = item["issued"] - item["expected"]
        rows_out.append({
            "uom": item["uom"],
            "floor_gap": gap,
            "floor_status": _gap_status(_r3(gap), _allowed_gap(item["expected"], item.get("limits") or {})),
        })
    return floor_split_by_unit(rows_out)


def month_end_unit_totals(rows: Iterable[dict[str, Any]], *, actual_known: bool) -> list[dict[str, Any]]:
    """Totals per stock unit (kg, pcs, litre …). Pieces never enter a kg total."""
    rows = list(rows)
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        uom = normalize_uom(row.get("uom"))
        bucket = buckets.setdefault(
            uom,
            {
                "uom": uom,
                "unit_label": unit_label(uom),
                "items": 0,
                "items_with_use": 0,
                "status_counts": {"OK": 0, "OVER": 0, "UNDER": 0, "NOT_KNOWN": 0},
                **{key: 0.0 for key in UNIT_TOTAL_KEYS},
            },
        )
        bucket["items"] += 1
        if row.get("has_use"):
            bucket["items_with_use"] += 1
        status = str(row.get("status") or "NOT_KNOWN")
        bucket["status_counts"][status] = bucket["status_counts"].get(status, 0) + 1
        for key in UNIT_TOTAL_KEYS:
            value = row.get(key)
            if value is not None:
                bucket[key] += _num(value)
    out: list[dict[str, Any]] = []
    order = {"KG": 0, "PCS": 1, "L": 2}
    for uom in sorted(buckets, key=lambda key: (order.get(key, 9), key)):
        bucket = buckets[uom]
        for key in UNIT_TOTAL_KEYS:
            bucket[key] = _r3(bucket[key])
        if not actual_known:
            for key in ("actual_used", "store_gap", "total_gap"):
                bucket[key] = None
        out.append(bucket)
    return with_floor_split(out, rows)
