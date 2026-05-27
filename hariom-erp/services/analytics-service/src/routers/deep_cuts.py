"""Deep-cut reports endpoints introduced by the reports-suite redesign.

These endpoints reshape the existing service data into the new screenshot-grade
report formats. Each route follows the same plant-scope + token pattern as the
rest of analytics-service and degrades gracefully when an upstream service is
unavailable.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query

from src.config import (
    INVENTORY_SERVICE_URL,
    PRODUCTION_SERVICE_URL,
    SALES_SERVICE_URL,
)
from src.date_utils import parse_date_range
from src.dependencies import get_plant_scope, get_token
from src.utils import scope_plant_ids, service_get

router = APIRouter(prefix="/deep", tags=["Deep Cuts"])


def _parse_dt(value: Any) -> Optional[datetime]:
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    if result != result:  # NaN check
        return fallback
    return result


# ---------------------------------------------------------------------------
# /deep/machine-utilization — 7×24 heatmap of stage-hour utilization
# ---------------------------------------------------------------------------


@router.get("/machine-utilization")
def machine_utilization(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = date.today()
    start, end = parse_date_range(start_date or (today - timedelta(days=6)).isoformat(), end_date or today.isoformat())

    machines: dict[str, dict[str, Any]] = {}
    # rows[machine_key][day_of_week_0_to_6][hour_0_to_23] = entries
    grid: dict[str, list[list[float]]] = {}

    for plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=plant_id,
        ) or []
        cards = cards if isinstance(cards, list) else cards.get("items") or []
        for card in cards:
            for stage in card.get("stages") or []:
                entered = _parse_dt(stage.get("entered_at")) or _parse_dt(stage.get("actual_start"))
                completed = _parse_dt(stage.get("actual_end")) or _parse_dt(stage.get("completed_at"))
                if not entered:
                    continue
                if entered.date() < start or entered.date() > end:
                    continue
                stage_type = (stage.get("stage_type") or "STAGE").upper()
                machine = stage.get("machine_code") or stage.get("machine") or stage_type
                key = f"{stage_type}·{machine}"
                if key not in grid:
                    grid[key] = [[0.0 for _ in range(24)] for _ in range(7)]
                    machines[key] = {
                        "stage": stage_type,
                        "machine": machine,
                        "label": f"{stage_type[:1]}-{machine}",
                    }
                dow = entered.weekday()
                hour = entered.hour
                # If we have completed timestamp, fill the whole window
                end_dt = completed or entered
                duration_hours = max(1.0, (end_dt - entered).total_seconds() / 3600.0)
                consumed = duration_hours
                cur = entered
                while consumed > 0 and cur <= end_dt:
                    d_idx = cur.weekday()
                    h_idx = cur.hour
                    if 0 <= d_idx < 7 and 0 <= h_idx < 24:
                        grid[key][d_idx][h_idx] += min(1.0, consumed)
                    consumed -= 1.0
                    cur = cur + timedelta(hours=1)

    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    hours = [f"{h:02d}" for h in range(24)]
    machine_list = [
        {
            "key": k,
            "stage": v["stage"],
            "machine": v["machine"],
            "label": v["label"],
            "heatmap": grid[k],  # 7×24 matrix
            "total_hours": round(sum(sum(row) for row in grid[k]), 1),
            "peak_hour_load": round(max((max(row) for row in grid[k]), default=0.0), 1),
        }
        for k, v in machines.items()
    ]
    machine_list.sort(key=lambda m: m["total_hours"], reverse=True)
    return {
        "available_range": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "day_labels": days,
        "hour_labels": hours,
        "machines": machine_list[:12],
    }


# ---------------------------------------------------------------------------
# /deep/customer-360 — per-customer P&L view across sales + dispatch
# ---------------------------------------------------------------------------


@router.get("/customer-360")
def customer_360(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = date.today()
    start, end = parse_date_range(start_date or (today - timedelta(days=30)).isoformat(), end_date or today.isoformat())

    customers: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "customer_id": None,
        "customer_name": "",
        "orders_open": 0,
        "orders_closed": 0,
        "orders_delayed": 0,
        "dispatched_qty": 0.0,
        "dispatched_value": 0.0,
        "open_value": 0.0,
        "on_time_count": 0,
        "completed_count": 0,
        "last_dispatch_at": None,
    })

    for plant_id in scope_plant_ids(plant_scope):
        orders = service_get(
            f"{SALES_SERVICE_URL}/orders",
            token,
            params={"limit": 500},
            plant_id=plant_id,
        ) or []
        orders = orders if isinstance(orders, list) else orders.get("items") or []
        for order in orders:
            cust_id = str(order.get("customer_id") or order.get("customer_name") or "UNKNOWN")
            row = customers[cust_id]
            row["customer_id"] = cust_id
            row["customer_name"] = order.get("customer_name") or row["customer_name"] or "Unknown"
            status = str(order.get("status") or "").upper()
            value = _safe_float(order.get("total_value"))
            created = _parse_dt(order.get("created_at"))
            promise = _parse_dt(order.get("promise_date") or order.get("delivery_date"))
            dispatched = _parse_dt(order.get("dispatched_at") or order.get("closed_at"))
            if status in {"CLOSED", "COMPLETED", "DISPATCHED"}:
                row["orders_closed"] += 1
                row["dispatched_value"] += value
                if dispatched:
                    row["last_dispatch_at"] = max(filter(None, [dispatched.isoformat(), row.get("last_dispatch_at")]))
                row["completed_count"] += 1
                if promise and dispatched and dispatched.date() <= promise.date():
                    row["on_time_count"] += 1
            elif status in {"OPEN", "RELEASED", "IN_PROGRESS", "PLANNED", "CONFIRMED"}:
                row["orders_open"] += 1
                row["open_value"] += value
                if promise and promise.date() < today:
                    row["orders_delayed"] += 1

            # dispatched_qty roll-up
            for item in order.get("items") or []:
                row["dispatched_qty"] += _safe_float(item.get("dispatched_qty"))

    rows: list[dict[str, Any]] = []
    for cust in customers.values():
        otif = (
            round((cust["on_time_count"] / cust["completed_count"] * 100.0), 1)
            if cust["completed_count"]
            else 0.0
        )
        risk = "ok"
        if cust["orders_delayed"] >= 3 or (cust["orders_delayed"] >= 1 and otif < 75.0):
            risk = "critical"
        elif cust["orders_delayed"] >= 1 or otif < 90.0:
            risk = "watch"
        rows.append(
            {
                **cust,
                "dispatched_value": round(cust["dispatched_value"], 2),
                "open_value": round(cust["open_value"], 2),
                "dispatched_qty": round(cust["dispatched_qty"], 2),
                "otif_percent": otif,
                "risk": risk,
            }
        )
    rows.sort(key=lambda r: r["dispatched_value"] + r["open_value"], reverse=True)
    summary = {
        "active_customers": sum(1 for r in rows if r["orders_open"] > 0),
        "at_risk_customers": sum(1 for r in rows if r["risk"] in {"watch", "critical"}),
        "total_open_value": round(sum(r["open_value"] for r in rows), 2),
        "total_dispatched_value": round(sum(r["dispatched_value"] for r in rows), 2),
    }
    return {
        "available_range": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": summary,
        "rows": rows[:50],
    }


# ---------------------------------------------------------------------------
# /deep/operator-productivity — real operator roll-up from stage entries
# ---------------------------------------------------------------------------


@router.get("/operator-productivity")
def operator_productivity(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = date.today()
    start, end = parse_date_range(start_date or (today - timedelta(days=7)).isoformat(), end_date or today.isoformat())

    operators: dict[str, dict[str, Any]] = {}

    for plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=plant_id,
        ) or []
        cards = cards if isinstance(cards, list) else cards.get("items") or []
        for card in cards:
            card_no = card.get("job_card_no") or card.get("card_no") or card.get("id")
            for stage in card.get("stages") or []:
                entered = _parse_dt(stage.get("entered_at") or stage.get("actual_start") or stage.get("started_at"))
                completed = _parse_dt(stage.get("actual_end") or stage.get("completed_at"))
                event_dt = completed or entered
                if not event_dt or event_dt.date() < start or event_dt.date() > end:
                    continue

                operator = (
                    stage.get("operator_name")
                    or stage.get("operator")
                    or stage.get("entered_by")
                    or stage.get("completed_by")
                    or stage.get("updated_by")
                )
                if not operator:
                    continue

                stage_type = str(stage.get("stage_type") or stage.get("stage") or "Stage")
                key = str(operator)
                row = operators.setdefault(
                    key,
                    {
                        "operator": key,
                        "primary_stage": stage_type,
                        "stage_counts": defaultdict(int),
                        "cards": set(),
                        "completed_stages": 0,
                        "active_stages": 0,
                        "blocked_stages": 0,
                        "output_qty": 0.0,
                        "on_time_count": 0,
                        "timed_count": 0,
                        "last_activity_at": None,
                    },
                )
                row["stage_counts"][stage_type] += 1
                if card_no:
                    row["cards"].add(str(card_no))
                status = str(stage.get("status") or "").upper()
                if completed or status in {"COMPLETED", "DONE", "CLOSED"}:
                    row["completed_stages"] += 1
                else:
                    row["active_stages"] += 1
                if status in {"BLOCKED", "HOLD", "QC_HOLD"} or stage.get("blocker_reason"):
                    row["blocked_stages"] += 1

                row["output_qty"] += _safe_float(
                    stage.get("accepted_qty")
                    or stage.get("output_qty")
                    or stage.get("produced_qty")
                    or stage.get("finished_qty")
                    or stage.get("qty")
                )

                planned_end = _parse_dt(stage.get("planned_end") or stage.get("scheduled_end"))
                if planned_end and completed:
                    row["timed_count"] += 1
                    if completed <= planned_end:
                        row["on_time_count"] += 1
                if event_dt:
                    iso_value = event_dt.isoformat()
                    row["last_activity_at"] = max(filter(None, [row.get("last_activity_at"), iso_value]))

    rows: list[dict[str, Any]] = []
    for row in operators.values():
        stage_counts = dict(row["stage_counts"])
        primary_stage = max(stage_counts.items(), key=lambda item: item[1])[0] if stage_counts else row["primary_stage"]
        timed = int(row["timed_count"])
        on_time_pct = round((row["on_time_count"] / timed * 100.0), 1) if timed else None
        rows.append(
            {
                "operator": row["operator"],
                "primary_stage": primary_stage,
                "cards": len(row["cards"]),
                "completed_stages": int(row["completed_stages"]),
                "active_stages": int(row["active_stages"]),
                "blocked_stages": int(row["blocked_stages"]),
                "output_qty": round(row["output_qty"], 2),
                "on_time_percent": on_time_pct,
                "last_activity_at": row["last_activity_at"],
            }
        )

    rows.sort(key=lambda r: (r["blocked_stages"], r["completed_stages"], r["output_qty"]), reverse=True)
    return {
        "available_range": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "operators": len(rows),
            "completed_stages": sum(row["completed_stages"] for row in rows),
            "active_stages": sum(row["active_stages"] for row in rows),
            "blocked_stages": sum(row["blocked_stages"] for row in rows),
            "output_qty": round(sum(row["output_qty"] for row in rows), 2),
        },
        "rows": rows[:50],
    }


# ---------------------------------------------------------------------------
# /deep/leadtime-anatomy — average lead time breakdown by stage
# ---------------------------------------------------------------------------


@router.get("/leadtime-anatomy")
def leadtime_anatomy(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = date.today()
    start, end = parse_date_range(start_date or (today - timedelta(days=30)).isoformat(), end_date or today.isoformat())

    stage_buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"days": 0.0, "samples": 0})
    overall_samples: list[float] = []

    for plant_id in scope_plant_ids(plant_scope):
        orders = service_get(
            f"{SALES_SERVICE_URL}/orders",
            token,
            params={"limit": 500, "status": "CLOSED"},
            plant_id=plant_id,
        ) or []
        orders = orders if isinstance(orders, list) else orders.get("items") or []
        for order in orders:
            created = _parse_dt(order.get("created_at"))
            released = _parse_dt(order.get("released_at")) or _parse_dt(order.get("released_on"))
            dispatched = _parse_dt(order.get("dispatched_at") or order.get("closed_at"))
            if not created or not dispatched:
                continue
            if dispatched.date() < start or dispatched.date() > end:
                continue
            total_days = (dispatched - created).total_seconds() / 86400.0
            if total_days <= 0 or total_days > 365:
                continue
            overall_samples.append(total_days)
            if released:
                t1 = (released - created).total_seconds() / 86400.0
                t2 = (dispatched - released).total_seconds() / 86400.0
                if t1 >= 0 and t2 >= 0:
                    stage_buckets["1. Order → released"]["days"] += t1
                    stage_buckets["1. Order → released"]["samples"] += 1
                    stage_buckets["4. Released → dispatched"]["days"] += t2
                    stage_buckets["4. Released → dispatched"]["samples"] += 1
            stage_buckets["__total__"]["days"] += total_days
            stage_buckets["__total__"]["samples"] += 1

        # Sample stage details from job_cards for production stage anatomy
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 200},
            plant_id=plant_id,
        ) or []
        cards = cards if isinstance(cards, list) else cards.get("items") or []
        for card in cards:
            stages = card.get("stages") or []
            for stage in stages:
                stage_type = (stage.get("stage_type") or "").upper()
                entered = _parse_dt(stage.get("entered_at"))
                completed = _parse_dt(stage.get("actual_end")) or _parse_dt(stage.get("completed_at"))
                if not entered or not completed or stage_type == "":
                    continue
                dur = (completed - entered).total_seconds() / 86400.0
                if dur <= 0 or dur > 90:
                    continue
                bucket_label = {
                    "WINDER": "2. Winder",
                    "OVEN": "2. Oven",
                    "PROCESS": "3. Process",
                    "PACKING": "3. Packing",
                    "QC": "3b. QC hold",
                    "DISPATCH": "4. Released → dispatched",
                }.get(stage_type, f"3. {stage_type.title()}")
                stage_buckets[bucket_label]["days"] += dur
                stage_buckets[bucket_label]["samples"] += 1

    stages: list[dict[str, Any]] = []
    for label in sorted(k for k in stage_buckets.keys() if k != "__total__"):
        bucket = stage_buckets[label]
        if not bucket["samples"]:
            continue
        stages.append({"label": label, "days": round(bucket["days"] / bucket["samples"], 2), "samples": int(bucket["samples"])})

    total = stage_buckets.get("__total__", {"days": 0.0, "samples": 0})
    total_avg = round(total["days"] / total["samples"], 2) if total["samples"] else 0.0
    return {
        "available_range": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "stages": stages,
        "total_average_days": total_avg,
        "samples": int(total["samples"]),
        "p50": _percentile(overall_samples, 50),
        "p90": _percentile(overall_samples, 90),
    }


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return round(s[int(k)], 2)
    d0 = s[f] * (c - k)
    d1 = s[c] * (k - f)
    return round(d0 + d1, 2)


# ---------------------------------------------------------------------------
# /deep/scrap-cost-ladder — per-reason scrap cost roll-up
# ---------------------------------------------------------------------------


@router.get("/scrap-cost-ladder")
def scrap_cost_ladder(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    today = date.today()
    start, end = parse_date_range(start_date or (today - timedelta(days=30)).isoformat(), end_date or today.isoformat())

    buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"qty": 0.0, "value": 0.0, "events": 0})

    for plant_id in scope_plant_ids(plant_scope):
        cards = service_get(
            f"{PRODUCTION_SERVICE_URL}/job-cards",
            token,
            params={"limit": 500},
            plant_id=plant_id,
        ) or []
        cards = cards if isinstance(cards, list) else cards.get("items") or []
        for card in cards:
            for stage in card.get("stages") or []:
                entered = _parse_dt(stage.get("entered_at"))
                if not entered or entered.date() < start or entered.date() > end:
                    continue
                scrap_entries = stage.get("scrap_entries") or stage.get("scrap") or []
                if isinstance(scrap_entries, dict):
                    scrap_entries = [scrap_entries]
                for entry in scrap_entries or []:
                    reason = (entry.get("reason") or entry.get("category") or "Unspecified").strip() or "Unspecified"
                    qty = _safe_float(entry.get("qty") or entry.get("weight_kg"))
                    rate = _safe_float(entry.get("rate_inr") or entry.get("rate"))
                    value = _safe_float(entry.get("value_inr") or entry.get("value")) or (qty * rate)
                    bucket = buckets[reason]
                    bucket["qty"] += qty
                    bucket["value"] += value
                    bucket["events"] += 1
        # also dip into reconciliation/scrap rows
        scrap_rows = service_get(
            f"{PRODUCTION_SERVICE_URL}/scrap",
            token,
            params={"start_date": start.isoformat(), "end_date": end.isoformat()},
            plant_id=plant_id,
        ) or []
        scrap_rows = scrap_rows if isinstance(scrap_rows, list) else scrap_rows.get("items") or []
        for entry in scrap_rows:
            reason = (entry.get("reason") or entry.get("category") or "Unspecified").strip() or "Unspecified"
            qty = _safe_float(entry.get("qty") or entry.get("weight_kg"))
            value = _safe_float(entry.get("value_inr") or entry.get("value"))
            bucket = buckets[reason]
            bucket["qty"] += qty
            bucket["value"] += value
            bucket["events"] += 1

    rows = [
        {
            "reason": k,
            "qty_kg": round(v["qty"], 2),
            "value_inr": round(v["value"], 2),
            "events": int(v["events"]),
        }
        for k, v in buckets.items()
    ]
    rows.sort(key=lambda r: r["value_inr"], reverse=True)
    total_value = round(sum(r["value_inr"] for r in rows), 2)
    total_qty = round(sum(r["qty_kg"] for r in rows), 2)
    running = 0.0
    for row in rows:
        running += row["value_inr"]
        row["cumulative_pct"] = round((running / total_value * 100.0) if total_value > 0 else 0.0, 1)
    return {
        "available_range": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "summary": {
            "total_value_inr": total_value,
            "total_qty_kg": total_qty,
            "reason_count": len(rows),
        },
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# /deep/item-velocity — velocity matrix (days-on-hand × value × burn)
# ---------------------------------------------------------------------------


@router.get("/item-velocity")
def item_velocity(
    horizon_days: int = Query(30, ge=7, le=90),
    token: str = Depends(get_token),
    plant_scope: dict = Depends(get_plant_scope),
):
    items_by_code: dict[str, dict[str, Any]] = {}

    for plant_id in scope_plant_ids(plant_scope):
        balances = service_get(
            f"{INVENTORY_SERVICE_URL}/all-balances",
            token,
            plant_id=plant_id,
        ) or {}
        items = balances.get("items") if isinstance(balances, dict) else balances
        items = items or []
        for item in items:
            code = item.get("item_code") or item.get("code") or item.get("name")
            if not code:
                continue
            existing = items_by_code.setdefault(
                code,
                {
                    "item_code": code,
                    "name": item.get("name") or code,
                    "type": item.get("type") or "ITEM",
                    "available_qty": 0.0,
                    "value_inr": 0.0,
                    "issued_30d": 0.0,
                },
            )
            existing["available_qty"] += _safe_float(item.get("available_qty"))
            existing["value_inr"] += _safe_float(item.get("value_inr") or item.get("total_value") or 0.0)

        # try to derive 30d issued qty from inventory ledger
        ledger = service_get(
            f"{INVENTORY_SERVICE_URL}/ledger",
            token,
            params={"limit": 2000},
            plant_id=plant_id,
        ) or {}
        rows = ledger.get("ledger") if isinstance(ledger, dict) else ledger
        rows = rows or []
        cutoff = datetime.utcnow() - timedelta(days=horizon_days)
        for row in rows:
            code = row.get("item_code")
            if not code or code not in items_by_code:
                continue
            ts = _parse_dt(row.get("created_at") or row.get("ledger_date"))
            if ts and ts < cutoff:
                continue
            qty_change = _safe_float(row.get("qty_change"))
            if qty_change < 0:  # issues are negative
                items_by_code[code]["issued_30d"] += abs(qty_change)

    out: list[dict[str, Any]] = []
    for row in items_by_code.values():
        issued = row["issued_30d"]
        available = row["available_qty"]
        burn_per_day = (issued / horizon_days) if horizon_days > 0 else 0.0
        days_on_hand = (available / burn_per_day) if burn_per_day > 0 else (180.0 if available > 0 else 0.0)
        tone = "ok-rm" if row["type"] != "FG" else "ok-fg"
        if days_on_hand <= 5:
            tone = "critical"
        elif days_on_hand <= 12:
            tone = "warn"
        elif days_on_hand >= 60:
            tone = "dead"
        out.append(
            {
                "item_code": row["item_code"],
                "name": row["name"],
                "type": row["type"],
                "available_qty": round(available, 2),
                "value_inr": round(row["value_inr"], 2),
                "issued_30d": round(issued, 2),
                "burn_per_day": round(burn_per_day, 2),
                "days_on_hand": round(min(180.0, days_on_hand), 1),
                "tone": tone,
            }
        )
    out.sort(key=lambda r: (r["tone"] != "critical", r["tone"] != "warn", -r["value_inr"]))

    summary = {
        "critical": sum(1 for r in out if r["tone"] == "critical"),
        "watch": sum(1 for r in out if r["tone"] == "warn"),
        "dead": sum(1 for r in out if r["tone"] == "dead"),
        "healthy": sum(1 for r in out if r["tone"] in {"ok-rm", "ok-fg"}),
        "horizon_days": horizon_days,
    }
    return {"summary": summary, "rows": out[:80]}
