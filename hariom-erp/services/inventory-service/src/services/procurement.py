"""Deterministic procurement calculations shared by API, exports and tests.

All public functions use ``Decimal`` and reject non-finite values.  The browser
never supplies an approved price, a stock total, or a calculated claim amount.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
import re
from typing import Any, Iterable


QTY_QUANT = Decimal("0.001")
RATE_QUANT = Decimal("0.000001")
MONEY_QUANT = Decimal("0.01")


class ProcurementRuleError(ValueError):
    pass


def decimal_value(value: Any, field: str, *, positive: bool = False, nonnegative: bool = False) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ProcurementRuleError(f"{field} must be a valid number") from exc
    if not result.is_finite():
        raise ProcurementRuleError(f"{field} must be finite")
    if positive and result <= 0:
        raise ProcurementRuleError(f"{field} must be greater than zero")
    if nonnegative and result < 0:
        raise ProcurementRuleError(f"{field} cannot be negative")
    return result


def quantity(value: Any, field: str = "quantity") -> Decimal:
    return decimal_value(value, field, positive=True).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)


def rate(value: Any, field: str = "rate") -> Decimal:
    return decimal_value(value, field, nonnegative=True).quantize(RATE_QUANT, rounding=ROUND_HALF_UP)


def money(value: Any) -> Decimal:
    return decimal_value(value, "amount").quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def canonical_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def normalize_invoice_number(value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if not cleaned:
        raise ProcurementRuleError("invoice number is required")
    return cleaned


def po_number(prefix: str, sequence: int) -> str:
    if sequence <= 0:
        raise ProcurementRuleError("document sequence must be positive")
    clean_prefix = str(prefix or "").strip().upper()
    if clean_prefix not in {"RP-PM", "OT"}:
        raise ProcurementRuleError("unsupported purchase order series")
    return f"{clean_prefix}/{sequence:02d}"


def physical_form(width_mm: Any, configured_min: Any = 50, configured_max: Any = 150) -> str:
    width = decimal_value(width_mm, "width_mm", positive=True)
    lower = decimal_value(configured_min, "configured_min", nonnegative=True)
    upper = decimal_value(configured_max, "configured_max", positive=True)
    if lower > upper:
        raise ProcurementRuleError("coil-width minimum cannot exceed maximum")
    return "COIL" if lower <= width <= upper else "REEL"


@dataclass(frozen=True)
class RateComparison:
    quantity_kg: Decimal
    po_rate: Decimal
    invoice_rate: Decimal
    delta_per_kg: Decimal
    signed_difference: Decimal
    claimable_amount: Decimal
    requires_review: bool


def compare_rates(qty_kg: Any, po_rate: Any, invoice_rate: Any, tolerance: Any = 0) -> RateComparison:
    qty = quantity(qty_kg, "quantity_kg")
    approved = rate(po_rate, "po_rate")
    invoiced = rate(invoice_rate, "invoice_rate")
    allowed = decimal_value(tolerance, "tolerance", nonnegative=True)
    delta = (invoiced - approved).quantize(RATE_QUANT, rounding=ROUND_HALF_UP)
    difference = (qty * delta).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    claimable = max(difference, Decimal("0.00"))
    return RateComparison(qty, approved, invoiced, delta, difference, claimable, abs(delta) > allowed)


def calculate_landed_cost(base_cost: Any, components: Iterable[dict[str, Any]]) -> tuple[Decimal, list[dict[str, str]]]:
    """Return landed cost/kg and normalized components.

    Modes: ``PER_KG``, ``PERCENT_BASE``, and ``FIXED_PER_LOT``.  A fixed
    component requires ``reference_qty_kg``.  ``DISCOUNT`` subtracts; every
    other type adds.  This bounded vocabulary deliberately avoids arbitrary
    formulas and dependency cycles.
    """
    base = rate(base_cost, "base_cost")
    total = base
    normalized: list[dict[str, str]] = []
    for index, raw in enumerate(components):
        mode = str(raw.get("calculation_mode") or "PER_KG").upper()
        component_type = str(raw.get("component_type") or "OTHER").upper()
        entered = decimal_value(raw.get("entered_value", 0), f"components[{index}].entered_value", nonnegative=True)
        if mode == "PER_KG":
            per_kg = entered
        elif mode == "PERCENT_BASE":
            per_kg = base * entered / Decimal("100")
        elif mode == "FIXED_PER_LOT":
            reference_qty = decimal_value(raw.get("reference_qty_kg"), f"components[{index}].reference_qty_kg", positive=True)
            per_kg = entered / reference_qty
        else:
            raise ProcurementRuleError(f"components[{index}].calculation_mode is unsupported")
        per_kg = per_kg.quantize(RATE_QUANT, rounding=ROUND_HALF_UP)
        total = total - per_kg if component_type == "DISCOUNT" else total + per_kg
        normalized.append({
            "component_type": component_type,
            "label": str(raw.get("label") or component_type.title()),
            "calculation_mode": mode,
            "entered_value": str(entered),
            "normalized_per_kg": str(per_kg),
        })
    if total < 0:
        raise ProcurementRuleError("landed cost cannot be negative")
    return total.quantize(RATE_QUANT, rounding=ROUND_HALF_UP), normalized


def allocate_fixed_charge(total_charge: Any, weights: Iterable[Any]) -> list[Decimal]:
    charge = money(total_charge)
    values = [quantity(value, f"weights[{index}]") for index, value in enumerate(weights)]
    total_weight = sum(values, Decimal("0"))
    if not values or total_weight <= 0:
        raise ProcurementRuleError("at least one positive lot weight is required")
    allocations: list[Decimal] = []
    running = Decimal("0")
    for index, value in enumerate(values):
        if index == len(values) - 1:
            allocation = charge - running
        else:
            allocation = (charge * value / total_weight).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
            running += allocation
        allocations.append(allocation)
    return allocations


def mrp_suggestion(
    *,
    opening_stock_kg: Any,
    demand_kg: Any,
    committed_supply_kg: Any,
    target_stock_kg: Any,
    minimum_order_kg: Any = 0,
    order_multiple_kg: Any = 0,
) -> dict[str, Decimal]:
    opening = decimal_value(opening_stock_kg, "opening_stock_kg", nonnegative=True)
    demand = decimal_value(demand_kg, "demand_kg", nonnegative=True)
    committed = decimal_value(committed_supply_kg, "committed_supply_kg", nonnegative=True)
    target = decimal_value(target_stock_kg, "target_stock_kg", nonnegative=True)
    minimum = decimal_value(minimum_order_kg, "minimum_order_kg", nonnegative=True)
    multiple = decimal_value(order_multiple_kg, "order_multiple_kg", nonnegative=True)
    net_need = max(demand + target - opening - committed, Decimal("0"))
    suggested = net_need
    if suggested > 0 and minimum > suggested:
        suggested = minimum
    if suggested > 0 and multiple > 0:
        quotient = (suggested / multiple).to_integral_value(rounding="ROUND_CEILING")
        suggested = quotient * multiple
    return {
        "opening_stock_kg": opening.quantize(QTY_QUANT),
        "demand_kg": demand.quantize(QTY_QUANT),
        "committed_supply_kg": committed.quantize(QTY_QUANT),
        "target_stock_kg": target.quantize(QTY_QUANT),
        "net_need_kg": net_need.quantize(QTY_QUANT),
        "suggested_order_kg": suggested.quantize(QTY_QUANT),
        "overage_kg": (suggested - net_need).quantize(QTY_QUANT),
    }


def alert_severity(stock_qty_kg: Any, *, safety_stock_kg: Any, reorder_point_kg: Any) -> str | None:
    stock = decimal_value(stock_qty_kg, "stock_qty_kg", nonnegative=True)
    safety = decimal_value(safety_stock_kg, "safety_stock_kg", nonnegative=True)
    reorder = decimal_value(reorder_point_kg, "reorder_point_kg", nonnegative=True)
    if reorder < safety:
        raise ProcurementRuleError("reorder point cannot be below safety stock")
    if stock <= safety:
        return "CRITICAL"
    if stock <= reorder:
        return "WARNING"
    return None


def month_start(value: date) -> date:
    return date(value.year, value.month, 1)
