"""Typed numbers on the issue desks find their lot / reel like a scan (client 2026-10-30), live PostgreSQL.

GET /inventory/labels/find: plant-scoped, role-checked, read only. The Amigo inward / lot number, AT number,
vendor reel number, opening-stock old mark or GRN number, in any case, with spaces or without separators, or a
unique part of one; several matches come back oldest first so the desk can show a short pick list.
"""
import os
import uuid

import pytest

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.models import ReelStatus, StockTransaction
from src.database import SessionLocal
from src.routers.labels import FIND_ROLES, find_label_by_number
from src.utils.auth import require_role

from test_stock_count_flow_postgres import OPERATOR, STORE, _item, _lot, _rack, _reel, _refused, setup_module  # noqa: F401

RMISSUE = {"sub": "rmissue@example.com", "roles": ["RMIssue"], "actual_roles": ["RMIssue"], "role": "RMIssue", "token": ""}


def _scope(*plants):
    if len(plants) == 1:
        return {"scope_all": False, "selected_plant_id": plants[0], "allowed_plants": list(plants)}
    return {"scope_all": True, "selected_plant_id": None, "allowed_plants": list(plants)}


def _find(db, scope, code, kind="ALL", limit=12):
    return find_label_by_number(code=code, kind=kind, limit=limit, db=db, plant_scope=scope, current_user=RMISSUE)


def _numbered(batch, number, grn):
    batch.batch_no = number
    batch.inward_metadata = {"grn_no": grn, "saved_label": {"code": number}}
    return batch


def test_a_typed_lot_number_in_any_form_finds_its_lot_and_a_grn_gives_a_pick_list():
    plant, other = str(uuid.uuid4()), str(uuid.uuid4())
    tag = uuid.uuid4().hex[:5].upper()
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        box = _item(db, plant, "PACKAGING", tracking="BULK", uom="PCS")
        rack = _rack(db, plant, f"R-{tag}")
        first = _numbered(_lot(db, plant, glue, 60, at=rack), f"IN/26/{tag}-B001", f"IN/26/{tag}")
        second = _numbered(_lot(db, plant, box, 40), f"IN/26/{tag}-B002", f"IN/26/{tag}")
        held = _numbered(_lot(db, plant, glue, 25, status="QC_HOLD"), f"IN/26/{tag}9-1", f"IN/26/{tag}9")
        used = _numbered(_lot(db, plant, glue, 10), f"IN/26/{tag}8-1", f"IN/26/{tag}8")
        db.add(StockTransaction(item_id=glue.id, batch_id=used.id, transaction_type="ISSUE_PRODUCTION", qty_change=-10, reference_type="INTERNAL",
                                reference_id=used.id, plant_id=plant))
        # The same number in another plant is never shown in this one.
        _numbered(_lot(db, other, _item(db, other, "ADHESIVE", tracking="BULK"), 99), f"IN/26/{tag}-B001", f"IN/26/{tag}")
        db.commit()

        scope = _scope(plant)
        for typed in (f"in/26/{tag.lower()}-b001", f" IN / 26 / {tag} - B001 ", f"in 26 {tag.lower()} b001", f"IN26{tag}B001"):
            found = _find(db, scope, typed)
            assert (found["match"], found["count"]) == ("EXACT", 1), typed
            row = found["rows"][0]
            assert (row["kind"], row["id"], row["code"], row["item_id"], row["qty"], row["stock_status"]) == ("LOT", str(first.id), f"IN/26/{tag}-B001", str(glue.id), 60.0, "UNRESTRICTED")
            assert (row["matched_on"], row["location_code"], row["plant_id"], row["uom"]) == ("LOT_NO", f"R-{tag}", plant, "KG")

        # A GRN number holds two lots: both, oldest first, for the desk's pick list.
        grn = _find(db, scope, f"in/26/{tag.lower()}")
        assert (grn["match"], grn["count"], [row["id"] for row in grn["rows"]]) == ("EXACT", 2, [str(first.id), str(second.id)])
        assert {row["matched_on"] for row in grn["rows"]} == {"GRN"} and grn["rows"][1]["uom"] == "PCS"

        # A unique part of a number; a held lot is found with its status (the desk refuses it in plain words).
        part = _find(db, scope, f"{tag}-b002")
        assert (part["match"], part["count"], part["rows"][0]["id"]) == ("PARTIAL", 1, str(second.id))
        hold = _find(db, scope, f"{tag}9-1")
        assert (hold["rows"][0]["id"], hold["rows"][0]["stock_status"], hold["rows"][0]["held"], hold["rows"][0]["qty"]) == (str(held.id), "QC_HOLD", True, 25.0)
        # A used-up lot typed in full is found (the desk says it was issued); as a part it drops out behind live stock.
        exact_used = _find(db, scope, f"IN/26/{tag}8-1")
        assert (exact_used["count"], exact_used["rows"][0]["qty"]) == (1, 0.0)
        live_only = _find(db, scope, f"/{tag}")
        assert str(used.id) not in {row["id"] for row in live_only["rows"]} and live_only["match"] == "PARTIAL"
        assert {str(first.id), str(second.id), str(held.id)} <= {row["id"] for row in live_only["rows"]}

        # Too short to be a part, or nothing like it: nothing, never a guess.
        assert _find(db, scope, "B0")["count"] == 0 and _find(db, scope, "ZZ-NOPE-1")["match"] == "NONE"
        assert _find(db, scope, f"IN/26/{tag}-B001", kind="REEL")["count"] == 0
        # All plants (the login's): the same number in both plants comes back from both.
        both = _find(db, _scope(plant, other), f"IN/26/{tag}-B001")
        assert sorted(row["plant_id"] for row in both["rows"]) == sorted([plant, other])
        # Read only: nothing was written.
        assert db.query(StockTransaction).filter(StockTransaction.plant_id == plant).count() == 5


def test_a_typed_at_vendor_reel_or_old_mark_finds_the_reel_and_the_role_is_checked():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        reel = _reel(db, plant, paper, 500)
        reel.source_reel_no = f"C-{uuid.uuid4().hex[:6].upper()}"
        mark = f"OLD-{uuid.uuid4().hex[:6].upper()}"
        opening = _reel(db, plant, paper, 300)
        opening.source_reel_no = mark
        opening.genealogy_metadata = {"source_document_type": "OPENING_LOAD"}
        opening.inward_metadata = {"old_mark": mark}
        gone = _reel(db, plant, paper, 0)
        gone.source_reel_no = mark
        gone.status = ReelStatus.CONSUMED
        db.commit()
        scope = _scope(plant)

        at = _find(db, scope, reel.reel_code.lower().replace("-", " "), kind="REEL")
        assert (at["match"], at["count"], at["rows"][0]["id"], at["rows"][0]["matched_on"], at["rows"][0]["qty"]) == ("EXACT", 1, str(reel.id), "AT_NO", 500.0)
        vendor = _find(db, scope, reel.source_reel_no.lower())
        assert (vendor["rows"][0]["id"], vendor["rows"][0]["matched_on"], vendor["rows"][0]["vendor_reel_no"], vendor["rows"][0]["status"]) == (str(reel.id), "VENDOR_REEL", reel.source_reel_no, "IN_STOCK")
        # The same mark on an opening-stock reel in stock and (as its vendor number) on a used-up reel: both, so the
        # desk picks the one in stock.
        marked = _find(db, scope, f" {mark.lower()} ")
        assert {row["id"]: (row["matched_on"], row["qty"]) for row in marked["rows"]} == {str(opening.id): ("OLD_MARK", 300.0), str(gone.id): ("VENDOR_REEL", 0.0)}
        assert _find(db, scope, reel.reel_code, kind="LOT")["count"] == 0

        # Issue-desk and stock roles may look; an operator may not (Owner / Admin pass as super roles).
        assert {"Store", "RMIssue", "PlantManager"} <= set(FIND_ROLES)
        assert require_role(FIND_ROLES)(current_user=RMISSUE) is RMISSUE and require_role(FIND_ROLES)(current_user=STORE) is STORE
        _refused(lambda: require_role(FIND_ROLES)(current_user=OPERATOR), 403)
