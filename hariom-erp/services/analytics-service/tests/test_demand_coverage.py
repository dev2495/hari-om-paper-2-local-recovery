from src.demand_coverage import build_coverage, expand_bom_for_qty, iso_week_bucket, match_inventory_item


def test_iso_week_bucket_is_date_not_timestamp_shifted():
    assert iso_week_bucket("2026-09-17") == "2026-W38"
    assert iso_week_bucket(None) == "UNSCHEDULED"


def test_expand_bom_uses_canonical_bamboo_weights_not_client_math():
    bom = {
        "expected_output": {"tubes_per_bamboo": 10},
        "raw_materials": {
            "papers": [{"paper_id": "paper-1", "gsm": 350, "bf": 18, "weight_kg": 2.0, "ply_count": 3}],
            "adhesives": {"components": [{"name": "20100", "weight_kg": 0.1}]},
            "parchment": {"color": "WHITE", "weight_kg": 0.05},
        },
    }
    rows = expand_bom_for_qty(bom, 20)
    by_kind = {row["kind"]: row for row in rows}
    assert by_kind["PAPER"]["required_qty"] == 4.0
    assert by_kind["ADHESIVE"]["required_qty"] == 0.2
    assert by_kind["PARCHMENT"]["required_qty"] == 0.1
    assert "350" in by_kind["PAPER"]["material_key"]


def test_gsm_in_description_is_not_a_substitute_match():
    need = {"kind": "PAPER", "paper_id": "paper-unknown", "label": "Kraft 350"}
    item, state = match_inventory_item(
        need,
        papers_by_id={},
        items_by_code={"KRAFT-350": {"item_id": "inv-1", "item_code": "KRAFT-350"}},
        items_by_id={},
    )
    assert item is None
    assert state == "UNKNOWN"


def test_coverage_keeps_demand_available_and_reorder_separate():
    paper_id = "paper-1"
    item_id = "item-1"
    result = build_coverage(
        demand_payload={
            "coverage": "all_open_lines",
            "total_orders": 2,
            "total_open_lines": 3,
            "lines": [
                {
                    "order_id": "o1",
                    "order_no": "SO-1",
                    "line_id": "l1",
                    "approved_spec_id": "spec-1",
                    "remaining_qty": 10,
                    "due_date": "2026-09-17",
                    "product_code": "TUBE-A",
                },
                {
                    "order_id": "o2",
                    "order_no": "SO-2",
                    "line_id": "l2",
                    "approved_spec_id": "spec-1",
                    "remaining_qty": 10,
                    "due_date": "2026-09-24",
                    "product_code": "TUBE-B",
                },
                {
                    "order_id": "o3",
                    "order_no": "SO-3",
                    "line_id": "l3",
                    "approved_spec_id": "spec-1",
                    "remaining_qty": 5,
                    "due_date": "2026-10-01",
                    "product_code": "TUBE-C",
                },
            ],
        },
        boms_by_spec={
            "spec-1": {
                "completeness": "OK",
                "bom": {
                    "expected_output": {"tubes_per_bamboo": 5},
                    "raw_materials": {
                        "papers": [{"paper_id": paper_id, "gsm": 351, "bf": 18, "weight_kg": 1.0}],
                        "adhesives": {"components": []},
                        "parchment": {},
                    },
                },
                "source_revision": {"spec_id": "spec-1", "recipe_id": "recipe-1", "recipe_version": 2},
            }
        },
        balances=[
            {
                "item_id": item_id,
                "item_code": "KRAFT-351",
                "name": "Kraft 351",
                "uom": "KG",
                "usable_qty": 2.0,
                "balance": 9.0,
                "qc_held_qty": 7.0,
                "reserved_qty": 0,
                "reorder_level": 50.0,
                "safety_stock": 20.0,
                "lead_time_days": 14,
            }
        ],
        papers=[{"id": paper_id, "code": "KRAFT-351"}],
        open_purchase_lines=[{"item_id": item_id, "qty_ordered": 3, "qty_received": 1}],
        plant_id="plant-a",
    )

    assert result["demand_source"]["total_open_lines"] == 3
    assert result["ledger"] is False
    row = result["materials"][0]
    # 25 remaining pieces / 5 tubes per bamboo * 1 kg = 5 kg demand
    assert row["gross_demand_qty"] == 5.0
    assert row["usable_qty"] == 2.0
    assert row["shortfall_qty"] == 3.0
    assert row["qc_held_qty"] == 7.0
    assert row["reorder_policy"]["reorder_level"] == 50.0
    assert row["shortfall_qty"] != row["reorder_policy"]["reorder_level"]
    assert row["supply_due_qty"] == 2.0
    assert row["first_shortage_bucket"] == "2026-W39"
    assert len(row["contributing_lines"]) == 3
    assert result["completeness"] in {"OK", "PARTIAL"}
