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
    # Issue units (client 2026-10-26): plastic in kg, boxes and fadda in pieces.
    assert by_code["PS-1"]["type"] == "PACKAGING" and by_code["PS-1"]["uom"] == "KG"
    assert by_code["FD-3"]["uom"] == "PCS"
    assert parchment_item_code("Red") == "PARCHMENT-RED"


def test_roles_that_do_not_keep_the_material_list_skip_the_sync_quietly():
    """Operators, QC and sales open rack and count pages too: the catch-up sync is skipped for them
    (no master reads, no inventory 403 turned into a 502 on every visit)."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    import jwt

    from src.services import master_items

    def token(**claims):
        return jwt.encode({"sub": "someone@hariom.com", **claims}, "test-secret-for-the-master-item-sync-roles", algorithm="HS256")

    assert master_items.can_sync(token(roles=["Store"]))
    assert master_items.can_sync(token(roles=["Operator"], acting_role="Owner"))
    assert master_items.can_sync(token(effective_roles=["RMIssue"]))
    assert not master_items.can_sync(token(roles=["Operator"]))
    assert not master_items.can_sync(token(roles=["QC", "Sales"]))

    with patch.object(master_items.http_client, "get", new=AsyncMock()) as reads, patch.object(master_items.http_client, "post", new=AsyncMock()) as writes:
        result = asyncio.run(master_items.sync_master_items(token(roles=["Operator"], plant_id="plant-a"), "plant-a"))
    assert result == {"plants": [], "created": [], "conflicts": [], "skipped": "ROLE"}
    reads.assert_not_called()
    writes.assert_not_called()
