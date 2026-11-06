"""Inward QC by bill and the bill weight check (6 Nov 2026), on live PostgreSQL.

Stock stays on the bill weight; the actual weight drives the weight check only. Bands at 20 / 50 kg,
rejected lots excluded, non-kg OWNER_INFO, pending invoice drafts the DN on attach, no double claim,
idempotent rows, plant isolation, Accept needs the weight, re-weigh rules.
"""
import json
import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from sqlalchemy import text

from src.main import ensure_runtime_schema
from src.database import Base, SessionLocal, engine
from src.models import ItemMaster, PaperReel, PurchaseDebitNote, PurchaseDiscrepancy, PurchaseOrderRevision, StockBatch, StockTransaction
from src.models_weight import PlantSetting, PurchaseWeightVariance
from src.routers.incoming_bills import (
    BillEntries, PlantSettingsUpdate, ReweighRequest, VarianceDecision, decide_weight_variance, get_incoming_bill,
    list_incoming_bills, reweigh_lot, save_incoming_bill_entries, update_plant_settings,
)
from src.routers.procurement import (
    AttachInvoiceRequest, DebitNoteAction, GovernedReceiptCreate, act_on_debit_note, attach_invoice_to_receipt,
    get_governed_receipt, post_governed_receipt,
)
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.services.weight_variance import band_for

PLANT = str(uuid.uuid4())
OTHER_PLANT = str(uuid.uuid4())
MAKER = {"sub": "kiran.po@example.com", "roles": ["Store"], "token": ""}
STORE = {"sub": "store.grn@example.com", "roles": ["Store"], "token": ""}
QC = {"sub": "ramesh.qc@example.com", "roles": ["QC"], "actual_roles": ["QC"], "token": ""}
OWNER = {"sub": "owner@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "token": ""}
HEAD = {"sub": "plant.head@example.com", "roles": ["PlantManager"], "token": ""}
ACCOUNTS = {"sub": "accounts@example.com", "roles": ["Accounts"], "token": ""}
PROFILE = {"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "label": "GSM", "min": 200, "max": 260, "required": True},
                                                               {"code": "reel_weight_kg", "label": "Reel weight", "required": True}]}


def scope(plant=PLANT):
    return {"selected_plant_id": plant, "scope_all": False, "allowed_plants": [plant], "is_owner": False}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _item(db, kind="RAW_PAPER", *, tracking="REEL", uom="KG", plant=PLANT):
    item = ItemMaster(item_code=f"{kind[:4]}-{uuid.uuid4().hex[:8]}", name=f"{kind.title()} weigh test", type=kind,
                      tracking_mode=tracking, uom=uom, plant_id=plant, active="true", quality_profile=PROFILE)
    db.add(item)
    db.commit()
    return item


def _po(db, item, *, qty=50000, rate=30, uom="KG", plant=PLANT):
    created = create_purchase_order(PurchaseOrderCreate(
        request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Sample Paper Mills",
        expected_date=date(2026, 11, 6), lines=[{"item_id": item.id, "qty_ordered": qty, "unit_cost": rate, "uom": uom}],
    ), db, plant, MAKER)
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, plant, MAKER)
    return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, plant, OWNER)


def _grn(db, po, weights, *, pending=False, rate=30.0, invoice_qty=None, plant=PLANT, bulk_qty=None):
    line = {"po_line_id": uuid.UUID(po["lines"][0]["id"])}
    if bulk_qty is not None:
        line["quantity"] = bulk_qty
    else:
        line["lots"] = [{"source_reel_no": f"R-{uuid.uuid4().hex[:6]}", "net_weight_kg": kg, "width_mm": 1000, "physical_form": "REEL"} for kg in weights]
    if not pending:
        line["invoice_rate"] = rate
        if invoice_qty is not None:
            line["invoice_quantity"] = invoice_qty
    payload = GovernedReceiptCreate(
        request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date(2026, 11, 6),
        supplier_challan_no=f"CH-{uuid.uuid4().hex[:5]}", invoice_pending=pending,
        invoice_no=None if pending else f"B-{uuid.uuid4().hex[:5]}", invoice_date=None if pending else date(2026, 11, 6), lines=[line])
    return post_governed_receipt(payload, db, plant, STORE)


def _key(receipt):
    return f"R:{receipt['id']}"


def _lots(db, receipt, plant=PLANT):
    return get_incoming_bill(_key(receipt), db, scope(plant), QC)["lots"]


def _row(lot, actual=None, decision="ACCEPT", **extra):
    return {"entity_type": lot["entity_type"], "entity_id": lot["entity_id"], "actual_qty": actual, "decision": decision,
            "idempotency_key": extra.pop("key", f"k-{uuid.uuid4().hex}"), **extra}


def _save(db, receipt, rows, plant=PLANT, user=QC):
    return save_incoming_bill_entries(_key(receipt), BillEntries(rows=rows), db, plant, user)


def _variance(db, receipt):
    db.expire_all()
    return db.query(PurchaseWeightVariance).filter_by(plant_id=PLANT, bill_key=_key(receipt)).first()


def _outbox_events(db, variance_id):
    rows = db.execute(text("SELECT body FROM audit_outbox WHERE body LIKE :needle"), {"needle": f"%{variance_id}%"}).all()
    return [json.loads(row[0]) for row in rows if '"notify"' in row[0]]


def test_band_edges_pure():
    notify, auto = Decimal("20"), Decimal("50")
    assert band_for(Decimal("20"), kg=True, notify_kg=notify, auto_kg=auto) == "WITHIN"
    assert band_for(Decimal("20.001"), kg=True, notify_kg=notify, auto_kg=auto) == "OWNER_DECIDES"
    assert band_for(Decimal("50"), kg=True, notify_kg=notify, auto_kg=auto) == "OWNER_DECIDES"
    assert band_for(Decimal("50.001"), kg=True, notify_kg=notify, auto_kg=auto) == "AUTO_DEBIT"
    assert band_for(Decimal("-3"), kg=True, notify_kg=notify, auto_kg=auto) == "EXCESS"
    assert band_for(Decimal("0.5"), kg=False, notify_kg=notify, auto_kg=auto) == "OWNER_INFO"


@pytest.mark.parametrize("actual,band,status", [
    (980, "WITHIN", "WITHIN"), (979.999, "OWNER_DECIDES", "AWAITING_OWNER"),
    (950, "OWNER_DECIDES", "AWAITING_OWNER"), (949.999, "AUTO_DEBIT", "DN_DRAFTED"),
])
def test_band_edges_on_a_bill(actual, band, status):
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000])
        lot = _lots(db, receipt)[0]
        result = _save(db, receipt, [_row(lot, actual)])
        assert result["rows"][0]["ok"], result["rows"][0]
        variance = _variance(db, receipt)
        assert (variance.band, variance.status) == (band, status)
        assert variance.short_qty == Decimal("1000") - Decimal(str(actual))


def test_auto_debit_flow_stock_unchanged_and_notifications():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000, 1000])
        lots = _lots(db, receipt)
        reel_ids = [uuid.UUID(lot["entity_id"]) for lot in lots]
        before = [(r.inward_weight_kg, r.net_weight_kg, r.current_weight_kg) for r in db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).order_by(PaperReel.reel_code)]
        txn_before = db.query(StockTransaction).count()
        first = _save(db, receipt, [_row(lots[0], 1000)])
        assert first["bill"]["weight_check"]["status"] == "PROVISIONAL"  # not final: nothing fires
        result = _save(db, receipt, [_row(lots[1], 940)])
        assert result["rows"][0]["ok"] and result["rows"][0]["released"] is True
        variance = _variance(db, receipt)
        assert (variance.band, variance.status, variance.decision) == ("AUTO_DEBIT", "DN_DRAFTED", "AUTO")
        assert variance.short_qty == Decimal("60.000") and variance.claim_amount == Decimal("1800.00")
        case = db.get(PurchaseDiscrepancy, variance.discrepancy_id)
        assert (case.discrepancy_type, case.case_source, case.status, case.assignee) == ("QUANTITY", "QC_WEIGH", "CLAIM_DRAFTED", MAKER["sub"])
        assert case.evidence_json["source"] == "QC_WEIGH" and len(case.evidence_json["lots"]) == 2
        assert case.claimable_amount == Decimal("1800.00")
        note = db.get(PurchaseDebitNote, variance.debit_note_id)
        assert (note.status, note.created_by, note.reason_code, note.total_amount) == ("DRAFT", "system:weight-check", "DN-WEIGHT-SHORT", Decimal("1800.00"))
        # Stock stays on the bill weight: no reel weight moved, no ledger row added.
        after = [(r.inward_weight_kg, r.net_weight_kg, r.current_weight_kg) for r in db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).order_by(PaperReel.reel_code)]
        assert after == before and db.query(StockTransaction).count() == txn_before
        events = {event["event_type"]: event for event in _outbox_events(db, variance.id)}
        assert set(events) >= {"PURCHASE_WEIGHT_SHORT_AUTO"}
        assert events["PURCHASE_WEIGHT_SHORT_AUTO"]["notify"]["recipient_roles"] == ["Owner", "PlantManager"]
        follow = [event for event in _outbox_events(db, note.id) if event["event_type"] == "PURCHASE_WEIGHT_SHORT_FOLLOW_UP"]
        assert follow and follow[0]["notify"]["recipient_user_emails"] == [MAKER["sub"]]
        # The DN still follows the existing approvals: approver is not the creator.
        submitted = act_on_debit_note(note.id, DebitNoteAction(action="SUBMIT", expected_version=note.version), db, PLANT, HEAD)
        approved = act_on_debit_note(note.id, DebitNoteAction(action="APPROVE", expected_version=submitted["version"]), db, PLANT, ACCOUNTS)
        assert approved["status"] == "APPROVED"
        # Weights are frozen once the DN is submitted or later.
        with pytest.raises(HTTPException) as frozen:
            reweigh_lot("REEL", reel_ids[1], ReweighRequest(request_id=uuid.uuid4(), actual_qty=Decimal("990"), reason_code="WC-TYPO"), db, PLANT, QC)
        assert frozen.value.status_code == 409


def test_owner_decides_make_then_idempotent_and_skip_refused():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000])
        lot = _lots(db, receipt)[0]
        _save(db, receipt, [_row(lot, 970)])
        variance = _variance(db, receipt)
        assert variance.status == "AWAITING_OWNER"
        decide_event = [event for event in _outbox_events(db, variance.id) if event["event_type"] == "PURCHASE_WEIGHT_SHORT_DECIDE"]
        assert decide_event and decide_event[0]["notify"]["recipient_roles"] == ["Owner"]
        buttons = decide_event[0]["payload"]["action"]["buttons"]
        assert [button["key"] for button in buttons] == ["make", "skip", "open"]
        assert buttons[1]["reason_category"] == "WEIGHT_SHORT_SKIP" and buttons[0]["path"].endswith(f"/weight-variances/{variance.id}/decide")
        with pytest.raises(HTTPException) as not_owner:
            from src.utils.auth import require_role
            require_role(["Owner"])(HEAD)
        assert not_owner.value.status_code == 403
        made = decide_weight_variance(variance.id, VarianceDecision(decision="MAKE_DEBIT_NOTE"), db, PLANT, OWNER)
        assert made["status"] == "DN_DRAFTED" and made["debit_note_no"] and made["claim_amount"] == 900.0
        again = decide_weight_variance(variance.id, VarianceDecision(decision="MAKE_DEBIT_NOTE"), db, PLANT, OWNER)
        assert again["idempotent"] is True and again["debit_note_id"] == made["debit_note_id"]
        with pytest.raises(HTTPException) as skip:
            decide_weight_variance(variance.id, VarianceDecision(decision="SKIP", reason_code="WS-SCALE-DOUBT"), db, PLANT, OWNER)
        assert skip.value.status_code == 409


def test_owner_skips_with_a_reason():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000])
        _save(db, receipt, [_row(_lots(db, receipt)[0], 960)])
        variance = _variance(db, receipt)
        with pytest.raises(HTTPException):
            decide_weight_variance(variance.id, VarianceDecision(decision="SKIP"), db, PLANT, OWNER)  # a reason is needed
        skipped = decide_weight_variance(variance.id, VarianceDecision(decision="SKIP", reason_code="WS-VENDOR-CREDIT"), db, PLANT, OWNER)
        assert skipped["status"] == "SKIPPED" and skipped["reason_code"] == "WS-VENDOR-CREDIT" and skipped["debit_note_id"] is None
        assert decide_weight_variance(variance.id, VarianceDecision(decision="SKIP", reason_code="WS-VENDOR-CREDIT"), db, PLANT, OWNER)["idempotent"] is True


def test_rejected_lot_is_excluded_and_hold_needs_no_weight():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000, 1000, 1000])
        lots = _lots(db, receipt)
        rejected = _save(db, receipt, [_row(lots[0], None, "REJECT", reason_code="IQ-DAMAGED")])
        assert rejected["rows"][0]["ok"], rejected["rows"][0]
        held = _save(db, receipt, [_row(lots[1], None, "HOLD", reason_code="IQ-MOISTURE")])
        assert held["rows"][0]["ok"] and held["rows"][0]["stock_status"] == "QC_HOLD"
        assert held["bill"]["weight_check"] is None or held["bill"]["weight_check"]["status"] == "PROVISIONAL"
        # The held reel is weighed later (weight only): now every lot not rejected is weighed.
        _save(db, receipt, [_row(lots[1], 995, "NONE"), _row(lots[2], 1000)])
        variance = _variance(db, receipt)
        assert variance.lots_excluded == 1 and variance.bill_total == Decimal("2000.000")
        assert (variance.status, variance.short_qty) == ("WITHIN", Decimal("5.000"))


def test_accept_without_weight_refused_typo_guard_and_idempotent_resave():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000, 1000, 1000])
        lots = _lots(db, receipt)
        refused = _save(db, receipt, [_row(lots[0], None, "ACCEPT")])
        assert refused["rows"][0]["ok"] is False and "Accept needs the actual weight" in refused["rows"][0]["message"]
        typo = _save(db, receipt, [_row(lots[0], 11750)])
        assert typo["rows"][0]["ok"] is False and "Check: 11,750 kg vs bill 1,000 kg" in typo["rows"][0]["message"]
        row = _row(lots[0], 998, key="same-key-123")
        first = _save(db, receipt, [row])
        second = _save(db, receipt, [dict(row)])
        assert first["rows"][0]["ok"] and second["rows"][0]["idempotent"] is True
        from src.models import InventoryQualityInspection
        assert db.query(InventoryQualityInspection).filter_by(entity_id=uuid.UUID(lots[0]["entity_id"])).count() == 1
        # A second QC user typing another weight for the same reel is told who weighed it.
        clash = _save(db, receipt, [_row(lots[0], 990, "NONE")])
        assert clash["rows"][0]["ok"] is False and "Already weighed by ramesh.qc@example.com" in clash["rows"][0]["message"]
        # One bad row never undoes the good one.
        mixed = _save(db, receipt, [_row(lots[1], 1001), _row(lots[2], None, "ACCEPT", key="bad-row-123")])
        assert [item["ok"] for item in mixed["rows"]] == [True, False]


def test_non_kg_shortage_is_owner_info_only():
    with SessionLocal() as db:
        item = _item(db, "PACKAGING", tracking="BULK", uom="PCS")
        po = _po(db, item, qty=1000, rate=4, uom="PCS")
        receipt = _grn(db, po, [], bulk_qty=100)
        lot = _lots(db, receipt)[0]
        assert lot["bill_qty"] == 100 and lot["uom"] == "PCS"
        _save(db, receipt, [_row(lot, 95)])
        variance = _variance(db, receipt)
        assert (variance.band, variance.status, variance.debit_note_id) == ("OWNER_INFO", "INFO_SENT", None)
        assert [event["event_type"] for event in _outbox_events(db, variance.id)] == ["PURCHASE_WEIGHT_SHORT_INFO"]
        batch = db.get(StockBatch, uuid.UUID(lot["entity_id"]))
        assert float(batch.received_qty) == 100 and batch.actual_qty == Decimal("95.000")


def test_pending_invoice_drafts_the_debit_note_on_attach():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000], pending=True)
        _save(db, receipt, [_row(_lots(db, receipt)[0], 930)])
        variance = _variance(db, receipt)
        assert (variance.status, variance.debit_note_id, variance.discrepancy_ids) == ("WAITING_INVOICE", None, [])
        saved = get_governed_receipt(uuid.UUID(receipt["id"]), db, PLANT, STORE)
        attach_invoice_to_receipt(uuid.UUID(receipt["id"]), AttachInvoiceRequest(
            expected_version=saved["posting_version"], invoice_no=f"INV-{uuid.uuid4().hex[:5]}", invoice_date=date(2026, 11, 7),
            lines=[{"receipt_line_id": line["id"], "invoice_rate": 32} for line in saved["lines"]]), db, PLANT, STORE)
        variance = _variance(db, receipt)
        assert variance.status == "DN_DRAFTED" and variance.claim_amount == Decimal("2240.00")  # 70 kg x invoice rate 32
        note = db.get(PurchaseDebitNote, variance.debit_note_id)
        assert note.status == "DRAFT" and note.total_amount == Decimal("2240.00")


def test_no_double_claim_with_the_grn_quantity_case():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000], invoice_qty=1100)  # billed 100 kg more than the GRN: GRN-time QUANTITY case
        _save(db, receipt, [_row(_lots(db, receipt)[0], 940)])
        variance = _variance(db, receipt)
        cases = db.query(PurchaseDiscrepancy).filter(PurchaseDiscrepancy.plant_id == PLANT, PurchaseDiscrepancy.discrepancy_type == "QUANTITY",
                                                    PurchaseDiscrepancy.allocation_id == db.get(PurchaseDiscrepancy, variance.discrepancy_id).allocation_id).all()
        by_source = {case.case_source: case for case in cases}
        assert set(by_source) == {"GRN", "QC_WEIGH"}
        assert variance.lines_json[0]["grn_claimed_qty"] == "100.000"
        # Every kg claimed once: 100 kg on the GRN case + 60 kg weighed short = invoice 1100 - scale 940.
        assert by_source["GRN"].claimable_amount + by_source["QC_WEIGH"].claimable_amount == Decimal("160") * 30


def test_reweigh_updates_or_withdraws_the_draft_claim():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000])
        lot = _lots(db, receipt)[0]
        _save(db, receipt, [_row(lot, 920)])
        variance = _variance(db, receipt)
        note_id = variance.debit_note_id
        assert variance.status == "DN_DRAFTED"
        updated = reweigh_lot("REEL", uuid.UUID(lot["entity_id"]), ReweighRequest(request_id=uuid.uuid4(), actual_qty=Decimal("930"),
                              expected_actual_qty=Decimal("920"), reason_code="WC-TYPO"), db, PLANT, QC)
        assert updated["bill"]["weight_check"]["claim_amount"] == 2100.0
        assert db.get(PurchaseDebitNote, note_id).total_amount == Decimal("2100.00")
        withdrawn = reweigh_lot("REEL", uuid.UUID(lot["entity_id"]), ReweighRequest(request_id=uuid.uuid4(), actual_qty=Decimal("995"),
                                reason_code="WC-REWEIGHED"), db, PLANT, QC)
        assert withdrawn["bill"]["weight_check"]["status"] == "WITHIN"
        db.expire_all()
        assert db.get(PurchaseDebitNote, note_id).status == "VOID"
        assert db.get(PaperReel, uuid.UUID(lot["entity_id"])).current_weight_kg == 1000  # still the bill weight


def test_plant_isolation_and_limits_snapshot():
    with SessionLocal() as db:
        po = _po(db, _item(db))
        receipt = _grn(db, po, [1000])
        assert any(item["key"] == _key(receipt) for item in list_incoming_bills(None, None, None, db, scope(), QC)["items"])
        assert not any(item["key"] == _key(receipt) for item in list_incoming_bills(None, None, None, db, scope(OTHER_PLANT), QC)["items"])
        with pytest.raises(HTTPException) as missing:
            get_incoming_bill(_key(receipt), db, scope(OTHER_PLANT), QC)
        assert missing.value.status_code == 404
        with pytest.raises(HTTPException):
            _save(db, receipt, [_row(_lots(db, receipt)[0], 1000)], plant=OTHER_PLANT)
        # Owner raises the limits on another plant; this plant's case keeps 20 / 50.
        current = db.get(PlantSetting, OTHER_PLANT)
        update_plant_settings(PlantSettingsUpdate(weight_short_notify_kg=Decimal("5"), weight_short_auto_kg=Decimal("10"),
                                                  expected_version=current.version if current else 0), db, OTHER_PLANT, OWNER)
        _save(db, receipt, [_row(_lots(db, receipt)[0], 970)])
        variance = _variance(db, receipt)
        assert (variance.notify_kg, variance.auto_kg, variance.status) == (Decimal("20.000"), Decimal("50.000"), "AWAITING_OWNER")
