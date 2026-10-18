"""Masters are the materials: each active master becomes a stock item line (client 2026-10-18)."""
from src.services.master_items import master_lines, parchment_item_code


def test_master_lines_cover_every_master_with_its_qc_values():
    lines = master_lines(
        papers=[{"code": "351", "variety": "Kraft", "gsm": 350, "bf": 20, "thickness_mm": 0.525, "ply_bond": 400, "bulk_factor": 1.5, "active": True},
                {"code": "OLD", "variety": "Kraft", "gsm": 300, "active": False}],
        adhesives=[{"internal_code": "20100", "name": "PVA", "variety": "Glue", "viscosity": 1800, "active": True}],
        colors=[{"color_name": "Blue / Black strip", "vendor_id": "v1", "active": True}],
        vendors=[{"id": "v1", "name": "Ahlstrom"}],
        boxes=[{"code": "R-150", "size_label": "400x300", "active": True}],
        sheets=[{"sku": "PS-1", "size_label": "1 m", "active": True}],
        faddas=[{"sku": "FD-3", "active": True}],
    )
    by_code = {line["item_code"]: line for line in lines}
    assert set(by_code) == {"351", "20100", "PARCHMENT-BLUE-BLACK-STRIP", "R-150", "PS-1", "FD-3"}
    assert by_code["351"]["type"] == "RAW_PAPER" and by_code["351"]["uom"] == "KG" and by_code["351"]["group"] == "Kraft"
    assert by_code["351"]["nominals"] == {"gsm": 350.0, "bf": 20.0, "caliper_mm": 0.525, "ply_bond": 400.0, "bulk": 1.5}
    assert by_code["R-150"]["type"] == "PACKAGING" and by_code["R-150"]["uom"] == "PCS"
    assert parchment_item_code("Red") == "PARCHMENT-RED"
