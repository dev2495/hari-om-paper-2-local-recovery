"""Printed QR codes open the app (client 2026-10-27) and the scan desks' role rules."""
import inspect
import uuid
from datetime import date
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from src.services.labels import batch_label_payload, reel_label_payload, scan_url

ORIGIN = "https://erp.example.test"


def _batch():
    return SimpleNamespace(
        id=uuid.uuid4(), plant_id="00000000-0000-0000-0000-0000000000a1", item_id=uuid.uuid4(), batch_no="A/26/001-B001",
        received_qty=100, stock_status="QC_HOLD", supplier_name_snapshot="Poonam", location_id=None,
        inward_metadata={"amigo_no": "A/26/001-B001"},
    )


def _reel():
    return SimpleNamespace(
        id=uuid.uuid4(), plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"), paper_id=uuid.uuid4(), reel_code="AT-261027-003",
        gsm=230, bf=18, current_weight_kg=700, inward_weight_kg=715, stock_status="UNRESTRICTED", supplier_name_snapshot="VATSALYA",
        supplier_name="VATSALYA", location_id=None, inward_date=date(2026, 10, 27), inward_metadata={},
    )


def _inner(url: str) -> str:
    parsed = urlparse(url)
    assert parsed.path == "/scan"
    return parse_qs(parsed.query)["c"][0]


def test_scan_url_wraps_the_payload_and_is_off_without_an_origin(monkeypatch):
    monkeypatch.delenv("PUBLIC_APP_ORIGIN", raising=False)
    assert scan_url("HARIOM|REEL|p|id|AT-1") is None
    monkeypatch.setenv("PUBLIC_APP_ORIGIN", ORIGIN + "/")
    url = scan_url("HARIOM|REEL|p|id|AT 1/2")
    assert url.startswith(ORIGIN + "/scan?c=")
    # Fully encoded: no raw separators survive, so phone cameras keep the whole value.
    assert "|" not in url and " " not in url and url.count("/") == 3
    assert _inner(url) == "HARIOM|REEL|p|id|AT 1/2"
    assert scan_url("") is None


def test_lot_label_payloads_keep_qr_value_and_never_store_the_link(monkeypatch):
    # These dicts are saved as label snapshots at receipt: a link inside would keep an old site address.
    monkeypatch.setenv("PUBLIC_APP_ORIGIN", ORIGIN)
    batch = batch_label_payload(_batch(), SimpleNamespace(item_code="ADH-1", name="Glue", uom="KG"))
    assert batch["qr_value"].startswith("HARIOM|BATCH|")
    reel = reel_label_payload(_reel(), SimpleNamespace(item_code="PAPER", name="Kraft"))
    assert reel["qr_value"].startswith("HARIOM|REEL|00000000-0000-0000-0000-0000000000a1|")
    for payload in (batch, reel):
        assert "scan_url" not in payload
        assert ORIGIN not in repr(payload)


def _printed(monkeypatch, labels, profile="PAPER_LOT_A4"):
    """QR values and text lines drawn on a label sheet."""
    import reportlab.graphics.barcode.qr as qr_module
    from reportlab.pdfgen.canvas import Canvas
    from src.services.procurement_documents import build_lot_label_pdf
    seen, lines = [], []
    original = qr_module.QrCodeWidget

    class Recording(original):
        def __init__(self, value="", *args, **kwargs):
            seen.append(value)
            super().__init__(value, *args, **kwargs)

    draw = Canvas.drawString

    def recording_draw(self, x, y, text, *args, **kwargs):
        lines.append(str(text))
        return draw(self, x, y, text, *args, **kwargs)

    monkeypatch.setattr(qr_module, "QrCodeWidget", Recording)
    monkeypatch.setattr(Canvas, "drawString", recording_draw)
    pdf = build_lot_label_pdf(labels, 1, profile)
    assert pdf.startswith(b"%PDF")
    return seen, lines


def _qr_values(monkeypatch, labels):
    return _printed(monkeypatch, labels)[0]


def test_printed_lot_label_encodes_the_link_worked_out_at_print_time(monkeypatch):
    # A saved snapshot from before the link existed (or with a stale origin) still prints the current link.
    old_snapshot = {"amigo_no": "AT-1", "qr_value": "HARIOM|REEL|plant|lot|AT-1", "scan_url": "https://old.example/scan?c=x"}
    monkeypatch.setenv("PUBLIC_APP_ORIGIN", ORIGIN)
    [value] = _qr_values(monkeypatch, [old_snapshot])
    assert value.startswith(ORIGIN + "/scan?c=") and _inner(value) == old_snapshot["qr_value"]
    monkeypatch.delenv("PUBLIC_APP_ORIGIN")
    assert _qr_values(monkeypatch, [old_snapshot]) == [old_snapshot["qr_value"]]


@pytest.mark.parametrize("profile", ["PAPER_LOT_A4", "PAPER_LOT_4X2"])
def test_printed_lot_label_has_no_stale_status_and_an_indian_date(monkeypatch, profile):
    # A snapshot saved at receipt says BLOCKED / QC_HOLD; QC may have cleared the lot since.
    snapshot = {"amigo_no": "AT-261027-026", "qr_value": "HARIOM|REEL|plant|lot|AT-261027-026", "stock_status": "BLOCKED",
                "inward_date": "2026-10-27", "supplier_name": "RM Seed Supplier", "physical_form": "REEL", "width_mm": 1100}
    batch = {**snapshot, "entity_type": "BATCH", "amigo_no": "IN/26/004-2", "stock_status": "QC_HOLD", "inward_date": "2026-10-03"}
    _, lines = _printed(monkeypatch, [snapshot, batch], profile)
    for code in ("BLOCKED", "QC_HOLD", "UNRESTRICTED", "2026-10-27", "2026-10-03"):
        assert not any(code in line for line in lines), code
    assert "27 Oct 2026" in lines and "03 Oct 2026" in lines
    if profile == "PAPER_LOT_A4":
        assert "QC status: scan the QR" in lines


def test_tool_payload_carries_the_link(monkeypatch):
    from src.routers.tool_assets import _asset_payload
    monkeypatch.setenv("PUBLIC_APP_ORIGIN", ORIGIN)
    row = SimpleNamespace(
        id=uuid.uuid4(), asset_no="TA-261027-AB12", qr_value="hariom://tool/TA-261027-AB12", tool_definition_id=None, category="DIE",
        definition_name="Die 76", attribute_snapshot={}, status="AVAILABLE", location=None, location_id=None, receipt_id=None,
        grind_version=0, usage_count=0, produced_qty=0, scrap_qty=0, current_job_card_id=None, assignments=[],
        received_at=None, created_at=None, updated_at=None,
    )
    payload = _asset_payload(row)
    assert payload["qr_value"] == "hariom://tool/TA-261027-AB12"
    assert _inner(payload["scan_url"]) == "hariom://tool/TA-261027-AB12"


def _role_check(endpoint):
    return inspect.signature(endpoint).parameters["current_user"].default.dependency


def test_plant_manager_may_issue_material_like_reels_and_parchment():
    from src.routers import issue
    check = _role_check(issue.create_issue)
    for role in ("PlantManager", "Store", "RMIssue"):
        assert check({"roles": [role]})["roles"] == [role]
    with pytest.raises(HTTPException) as refused:
        check({"roles": ["QC"]})
    assert refused.value.status_code == 403


@pytest.mark.parametrize("name", ["list_returnable_issues", "return_from_production"])
def test_production_returns_stay_with_stores(name):
    # Only material issue was opened to PlantManager; putting stock back is unchanged.
    from src.routers import issue
    check = _role_check(getattr(issue, name))
    for role in ("Store", "RMIssue"):
        assert check({"roles": [role]})["roles"] == [role]
    for role in ("PlantManager", "QC"):
        with pytest.raises(HTTPException) as refused:
            check({"roles": [role]})
        assert refused.value.status_code == 403


def test_rm_issue_reads_the_pending_qc_queue_but_cannot_write_it():
    from src.routers import quality
    assert _role_check(quality.list_pending_quality)({"roles": ["RMIssue"]})
    with pytest.raises(HTTPException):
        _role_check(quality.list_pending_quality)({"roles": ["Sales"]})
    with pytest.raises(HTTPException):
        _role_check(quality.upsert_quality_template)({"roles": ["RMIssue"]})
