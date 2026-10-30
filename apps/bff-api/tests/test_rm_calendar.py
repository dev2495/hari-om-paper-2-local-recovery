"""RM inward calendar maths (spec 3): projected balance, cover rules, shortage and suggestions."""
from datetime import date

from src.services.rm_calendar import build_calendar, round_order_qty, suggest


START, END = date(2026, 10, 28), date(2026, 11, 3)


def supply(arrivals=(), usable=100.0, qc=0.0, policy=None, item_type="RAW_PAPER", vendor=None):
    return {"items": [{"item_id": "p1", "item_code": "KR-230", "item_name": "Kraft 230", "item_type": item_type,
                       "material_class": "PAPER", "uom": "KG", "usable_qty": usable, "qc_pending_qty": qc,
                       "policy": policy, "last_vendor": vendor, "rate": {"rate": 0, "source": "RATE_NEEDED"}}],
            "arrivals": list(arrivals)}


def need(day, qty, overdue=False, **extra):
    return {"item_id": "p1", "date": day, "qty_kg": qty, "mapped": True, "overdue": overdue, "order_no": "SO-1", **extra}


def arrival(day, qty, state, counted, **extra):
    return {"item_id": "p1", "date": day, "qty": qty, "counted_qty": counted, "state": state, "entry_id": extra.pop("entry_id", None), **extra}


def material(cal):
    return cal["materials"][0]


def test_balance_is_previous_plus_counted_arrivals_minus_need():
    demand = {"requirements": [need("2026-10-29", 60), need("2026-10-31", 80)]}
    cal = build_calendar(demand, supply([arrival("2026-10-30", 50, "SENT", 50)]), start=START, end=END)
    row = material(cal)
    assert cal["days"][0] == "2026-10-28" and len(cal["days"]) == 7
    assert row["balance"][:4] == [100, 40, 90, 10]
    assert row["first_short"] is None and row["days_of_cover"] is None


def test_overdue_need_is_late_on_today_and_shortage_is_first_day_below_zero():
    demand = {"requirements": [need("2026-10-28", 30, overdue=True, due_date="2026-10-20"), need("2026-10-30", 90)]}
    row = material(build_calendar(demand, supply(), start=START, end=END))
    assert row["late_need"][0] == 30 and row["need"][0] == 30
    assert row["first_short"] == {"date": "2026-10-30", "qty": 20, "kind": "BELOW_ZERO", "balance": -20}
    assert row["days_of_cover"] == 2


def test_minimum_stock_policy_moves_the_shortage_earlier():
    demand = {"requirements": [need("2026-10-29", 70)]}
    row = material(build_calendar(demand, supply(policy={"min_stock": 50}), start=START, end=END))
    assert row["first_short"]["kind"] == "BELOW_MIN" and row["first_short"]["date"] == "2026-10-29" and row["first_short"]["qty"] == 20


def test_proposals_and_received_rows_add_nothing_qc_pending_counts_from_tomorrow():
    demand = {"requirements": [need("2026-10-28", 100), need("2026-10-29", 40)]}
    arrivals = [arrival("2026-10-28", 500, "RECEIVED", 0), arrival("2026-10-29", 999, "PROPOSED", 0, entry_id="e1", supplier_name="Mill")]
    cal = build_calendar(demand, supply(arrivals, qc=40), start=START, end=END)
    row = material(cal)
    assert row["balance"][:2] == [0, 0]  # 100 - 100; + 40 QC pending tomorrow - 40
    assert row["balance_with_proposals"][1] == 999
    assert row["proposed"][1] == 999 and row["first_short"] is None
    assert cal["pending_approval"]["count"] == 1 and cal["pending_approval"]["qty_by_uom"] == {"KG": 999}


def test_overdue_open_arrival_is_shown_and_counted_on_today():
    row = material(build_calendar({"requirements": [need("2026-10-28", 150)]},
                                  supply([arrival("2026-10-20", 80, "CONFIRMED", 80, overdue=True)]), start=START, end=END))
    assert row["arrivals"][0]["shown_date"] == "2026-10-28" and row["arrivals"][0]["date"] == "2026-10-20"
    assert row["balance"][0] == 30


def test_unmapped_demand_is_listed_apart_and_never_mixes_into_a_material():
    demand = {"requirements": [need("2026-10-29", 10)], "material_requirements": [
        {"item_id": "adhesive:GLUE", "item_code": "GLUE", "item_name": "Glue (no stock item)", "material_class": "ADHESIVE",
         "uom": "KG", "qty": 4.5, "mapped": False, "date": "2026-10-29", "order_no": "SO-9"}]}
    cal = build_calendar(demand, supply(), start=START, end=END)
    assert [row["item_id"] for row in cal["materials"]] == ["p1"]
    assert cal["unmapped"][0]["code"] == "GLUE" and cal["unmapped"][0]["qty"] == 4.5 and cal["unmapped"][0]["order_nos"] == ["SO-9"]


def test_other_type_items_show_only_with_need_or_arrivals():
    assert build_calendar({}, supply(item_type="OTHER"), start=START, end=END)["materials"] == []


def test_suggest_arrives_the_day_before_the_shortage_rounded_to_policy():
    assert round_order_qty(120.2, 0, 0) == 121
    assert round_order_qty(120, 500, 0) == 500 and round_order_qty(620, 500, 250) == 750
    demand = {"requirements": [need("2026-10-31", 130), need("2026-11-01", 20)]}
    policy = {"min_stock": 0, "minimum_order": 0, "order_multiple": 25, "lead_time_days": 5}
    cal = build_calendar(demand, supply(policy=policy, vendor={"supplier_id": "v1", "supplier_name": "Shree Kraft"}), start=START, end=END)
    rows = suggest(cal)
    assert len(rows) == 1
    proposal = rows[0]
    assert proposal["entry_date"] == "2026-10-30" and proposal["short_date"] == "2026-10-31"
    assert proposal["qty"] == 50 and proposal["supplier_name"] == "Shree Kraft"  # 50 kg short over the week, multiple of 25
    assert proposal["order_by"] == "2026-10-25" and proposal["late_to_order"] is True


def test_suggest_today_when_already_short_and_skips_covered_by_proposals():
    demand = {"requirements": [need("2026-10-28", 160)]}
    rows = suggest(build_calendar(demand, supply(), start=START, end=END))
    assert rows[0]["entry_date"] == "2026-10-28" and rows[0]["qty"] == 60
    covered = build_calendar(demand, supply([arrival("2026-10-28", 60, "PROPOSED", 0, entry_id="e1")]), start=START, end=END)
    assert suggest(covered) == []


def test_qc_pending_is_cover_but_never_an_arrival():
    # "Arriving" totals and the arrive[] row hold counted arrivals only; QC-pending stock is already
    # in the store, kept in qc_in on the day it counts (checker 2026-10-28: 5x the real inbound).
    demand = {"requirements": [need("2026-10-30", 120)]}
    row = material(build_calendar(demand, supply([arrival("2026-10-29", 30, "SENT", 30)], qc=50), start=START, end=END))
    assert row["arrive"][:3] == [0, 30, 0] and row["qc_in"][:3] == [0, 50, 0]
    assert row["totals"]["arriving"] == 30 and row["balance"][:3] == [100, 180, 60]


def test_waiting_arrivals_carry_rate_value_and_late_flag_and_suggestions_use_plain_dates():
    late = arrival("2026-10-25", 40, "PROPOSED", 0, entry_id="e9", supplier_id="v1", supplier_name="Mill", rate=44.5, rate_source="VENDOR_LAST_PO")
    cal = build_calendar({"requirements": [need("2026-10-29", 500)]}, supply([late]), start=START, end=END)
    pending = cal["pending_approval"]["entries"][0]
    assert pending["late"] is True and pending["rate"] == 44.5 and pending["value"] == 1780 and pending["rate_source"] == "VENDOR_LAST_PO"
    proposals = suggest(cal)
    assert proposals and proposals[0]["reason"] == "Runs out on 29 Oct 2026"


def test_every_waiting_proposal_counts_whatever_the_window():
    """Checker 2026-10-28: a proposal after the window end was missing from the Owner's count."""
    inside = arrival("2026-10-30", 40, "PROPOSED", 0, entry_id="e1", supplier_id="v1", supplier_name="Mill", rate=40)
    after = arrival("2026-12-10", 60, "PROPOSED", 0, entry_id="e2", supplier_id="v1", supplier_name="Mill", rate=40)
    cal = build_calendar({"requirements": [need("2026-10-29", 500)]}, supply([inside, after]), start=START, end=END)
    pending = cal["pending_approval"]
    assert pending["count"] == 2 and pending["qty_by_uom"] == {"KG": 100}
    assert [row["outside_window"] for row in pending["entries"]] == [False, True]
    # The proposal outside the window is not drawn and adds nothing to the projected balance.
    assert [row["entry_id"] for row in material(cal)["arrivals"]] == ["e1"] and sum(material(cal)["proposed"]) == 40


def test_calendar_refuses_roles_outside_spec_2_8():
    import jwt
    import pytest
    from fastapi import HTTPException

    from src.services.rm_calendar import assert_calendar_viewer

    def token(**claims):
        return jwt.encode({"sub": "x", **claims}, "test-signing-key-for-claims-only-32", algorithm="HS256")

    for roles in (["GRN"], ["Planner"], ["Admin"], ["Owner"], ["PlantManager"], ["Store"]):
        assert_calendar_viewer(token(roles=roles))
    for roles in (["Sales"], ["RMIssue"], ["Operator"], ["QC"]):
        with pytest.raises(HTTPException) as refused:
            assert_calendar_viewer(token(roles=roles))
        assert refused.value.status_code == 403


def test_arrival_vendor_must_be_an_active_vendor_of_this_plant_and_takes_the_master_name():
    """Checker 2026-10-29: a random id, another plant's vendor or a mismatched name were all saved."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock, patch

    import pytest
    from fastapi import HTTPException

    from src.services import rm_calendar

    umiya = "bf8ba9fe-69b4-4279-8744-d4c307d677a6"
    listed = MagicMock(status_code=200)
    listed.json.return_value = [{"id": umiya, "name": "Umiya Paper Mills", "active": True, "gst_no": "24AAA"},
                                {"id": "off", "name": "Old Mill", "active": False}]
    with patch.object(rm_calendar.http_client, "get", AsyncMock(return_value=listed)) as get:
        vendors = asyncio.run(rm_calendar.master_vendors("t", "plant-a"))
        # The master scopes the list by the plant header; switched-off vendors never count.
        assert get.call_args.kwargs["headers"]["X-Plant-ID"] == "plant-a" and set(vendors) == {umiya}
        details = asyncio.run(rm_calendar.vendor_details("t", "plant-a"))
    assert details[umiya]["supplier_name"] == "Umiya Paper Mills" and details[umiya]["supplier_gst_no"] == "24AAA"

    fixed = rm_calendar.apply_master_vendor({"supplier_id": umiya, "supplier_name": "Totally Different Name", "qty": 5}, vendors)
    assert fixed == {"supplier_id": umiya, "supplier_name": "Umiya Paper Mills", "qty": 5}
    for unknown in ("00000000-0000-0000-0000-00000000b101", "off", "4c1d6c38-0000-4000-8000-000000000000"):
        with pytest.raises(HTTPException) as refused:
            rm_calendar.apply_master_vendor({"supplier_id": unknown, "supplier_name": "Ghost Vendor"}, vendors, label="Arrival 2: ")
        assert refused.value.status_code == 422 and refused.value.detail.startswith("Arrival 2: pick a vendor")
    # A typed name with no vendor id is dropped; clearing the vendor clears the name.
    assert rm_calendar.apply_master_vendor({"supplier_name": "Ghost Vendor", "qty": 1}, vendors) == {"qty": 1}
    assert rm_calendar.apply_master_vendor({"supplier_id": None, "supplier_name": "x"}, vendors) == {"supplier_id": None, "supplier_name": None}

    broken = MagicMock(status_code=503)
    with patch.object(rm_calendar.http_client, "get", AsyncMock(return_value=broken)):
        with pytest.raises(HTTPException) as down:
            asyncio.run(rm_calendar.master_vendors("t", "plant-a"))
    assert down.value.status_code == 503


def test_an_order_with_no_delivery_date_keeps_its_no_date_flag_on_the_need_row():
    # SPEC2 answer 6: the day sheet says "no delivery date", never "Order line due" (checker r1).
    demand = {"requirements": [need("2026-10-28", 40, source="LINE_DUE", due_date=None, no_date=True),
                               need("2026-10-30", 10, source="LINE_DUE", due_date="2026-10-30")]}
    data = build_calendar(demand, supply(), start=START, end=END)
    needs = {row["date"]: row for row in data["materials"][0]["needs"]}
    assert needs["2026-10-28"]["no_date"] is True and needs["2026-10-28"]["late"] is False
    assert needs["2026-10-30"]["no_date"] is False and needs["2026-10-30"]["due_date"] == "2026-10-30"
