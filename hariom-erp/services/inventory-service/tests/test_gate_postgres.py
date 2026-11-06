"""Gate module (6 Nov 2026) on live PostgreSQL: public check-in and its limits, the pass, let in / out / deny,
host reply, bill-in routing and re-categorise, the GRN link that carries the gate photos to every reel,
goods out with the Tally bill number, the Accounts filing, history, sweeps, role and plant isolation."""
import io
import json
import uuid
from datetime import date, datetime, time, timedelta

import pytest
import os
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from PIL import Image
from sqlalchemy import text

from src.database import Base, SessionLocal, engine
from src.main import ensure_runtime_schema
from src.models import ItemMaster, PurchaseOrderRevision, ReferenceType, StockTransaction, TransactionType
from src.models_gate import DispatchGateOut, GateEntry, GatePlantSetting, GateVisit
from src.models_vault import Document, DocumentLink
from src.routers import gate as api
from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.services import doc_storage
from src.services import doc_vault as vault
from src.services import gate as svc
from src.utils.auth import require_owner, require_role

PLANT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
OWNER = {"sub": "owner@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "token": ""}
HEAD = {"sub": "plant.head@example.com", "roles": ["PlantManager"], "token": ""}
STORE = {"sub": "store@example.com", "roles": ["Store"], "token": ""}
ACCOUNTS = {"sub": "accounts@example.com", "roles": ["Accounts"], "token": ""}
WATCHMAN = {"sub": "gate1@example.com", "roles": ["Watchman"], "token": ""}
DISPATCH = {"sub": "dispatch@example.com", "roles": ["Dispatch"], "token": ""}
HOST = {"sub": "harish@example.com", "user_id": str(uuid.uuid4()), "roles": ["Store"], "token": ""}
PLANNER = {"sub": "planner@example.com", "roles": ["Planner"], "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


@pytest.fixture(autouse=True)
def local_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCS_STORAGE_BACKEND", "local")
    monkeypatch.setenv("DOCS_STORAGE_DIR", str(tmp_path / "vault"))
    doc_storage.reset_storage_cache()
    yield tmp_path / "vault"
    doc_storage.reset_storage_cache()


def _jpeg() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (320, 200), tuple(uuid.uuid4().bytes[:3])).save(buffer, "JPEG", quality=85)
    return buffer.getvalue()


def _gate(db, plant=PLANT, direction="BOTH"):
    gate = svc.create_gate(db, plant, code=f"G{uuid.uuid4().hex[:4].upper()}", name="Main gate", direction=direction, actor="owner@example.com")
    db.commit()
    return gate


def _outbox(db, event_type, entity_id=None):
    rows = db.execute(text("SELECT body FROM audit_outbox ORDER BY occurred_at")).fetchall()
    bodies = [json.loads(row[0]) if isinstance(row[0], str) else row[0] for row in rows]
    return [body for body in bodies if body.get("event_type") == event_type and (entity_id is None or body.get("entity_id") == str(entity_id))]


def _bill(db, gate, code="GB-MATERIAL", user=WATCHMAN, plant=PLANT, **extra):
    body = api.BillIn(request_id=uuid.uuid4(), gate_id=gate.id, category_code=code, **extra)
    return api.create_bill_in(body, db=db, plant_id=plant, current_user=user)


def _photo(db, entry_id, plant=PLANT, kind="VENDOR_BILL", actor="gate1@example.com"):
    document, _ = vault.create_document(db, plant_id=plant, data=_jpeg(), filename="bill.jpg", kind=kind, actor=actor, source="GATE",
                                        link=("GATE_ENTRY", str(entry_id)))
    db.commit()
    return document


def _visit(db, gate, mobile="9876543210", **extra):
    body = api.PublicVisitIn(request_id=uuid.uuid4(), mobile=mobile, name="Suresh Patel", company="Sample Engineering",
                             purpose_code="VP-SERVICE", purpose_label="Service / repair", host_user_id=HOST["user_id"],
                             host_name="Harish", host_email=HOST["sub"], host_department_key="STORES", **extra)
    return api.public_check_in(gate.qr_token, body, db=db)


# ── Visitors ───────────────────────────────────────────────────────────────────────────────────
def test_public_check_in_pass_status_known_mobile_and_three_open_visits():
    with SessionLocal() as db:
        gate = _gate(db)
        mobile = f"9{uuid.uuid4().int % 10**9:09d}"
        first = _visit(db, gate, mobile=mobile)
        assert first["created"] and first["pass"]["status"] == "ARRIVED" and first["pass"]["visit_no"].startswith("V-")
        assert "mobile" not in json.dumps(first["pass"]) and "harish@example.com" not in json.dumps(first)
        assert first["pass"]["pass_code"] == f"HARIOM|VISIT|{first['pass_token']}"
        status = api.public_pass(first["pass_token"], db=db)
        assert status["status_label"] == "Waiting at gate" and status["host_words"] == "Harish · Stores"
        # Known mobile: name and company only.
        assert api.public_lookup(gate.qr_token, api.Lookup(mobile=mobile), db=db) == {"known": True, "name": "Suresh Patel", "company": "Sample Engineering"}
        assert api.public_lookup(gate.qr_token, api.Lookup(mobile="9000000001"), db=db) == {"known": False}
        _visit(db, gate, mobile=mobile)
        _visit(db, gate, mobile=mobile)
        with pytest.raises(HTTPException) as fourth:
            _visit(db, gate, mobile=mobile)
        assert fourth.value.status_code == 429
        db.rollback()
        # Bad numbers and a rotated (dead) token are refused.
        with pytest.raises(HTTPException) as bad:
            _visit(db, gate, mobile="1234567890")
        assert bad.value.status_code == 422
        db.rollback()
        old = gate.qr_token
        svc.rotate_token(db, gate, actor="owner@example.com", expected_version=gate.version)
        db.commit()
        with pytest.raises(HTTPException) as dead:
            api.public_gate(old, db=db)
        assert dead.value.status_code == 404


def test_check_in_is_idempotent_per_request_key():
    with SessionLocal() as db:
        gate = _gate(db)
        key = uuid.uuid4()
        body = api.PublicVisitIn(request_id=key, mobile="9811122233", name="Rohit", purpose_code="VP-INTERVIEW", purpose_label="Interview",
                                 host_department_key="PLANT")
        one = api.public_check_in(gate.qr_token, body, db=db)
        two = api.public_check_in(gate.qr_token, body, db=db)
        assert one["pass_token"] == two["pass_token"] and two["created"] is False


def test_let_in_notifies_the_host_with_reply_buttons_then_out_and_deny():
    with SessionLocal() as db:
        gate = _gate(db)
        made = _visit(db, gate, mobile="9822233344")
        visit = db.query(GateVisit).filter(GateVisit.pass_token == made["pass_token"]).one()
        inside = api.let_in(str(visit.id), api.VisitAction(expected_version=visit.version), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert inside["status"] == "IN" and inside["mobile"] == "9822233344"  # the watchman sees the phone
        [note] = _outbox(db, "GATE_VISITOR_ARRIVED", visit.id)
        assert note["notify"]["recipient_user_emails"] == [HOST["sub"]] and note["notify"]["recipient_roles"] == []
        keys = [button["key"] for button in note["payload"]["action"]["buttons"]]
        assert keys == ["send_in", "wait", "not_available"]
        assert note["payload"]["action"]["buttons"][0]["path"] == f"/api/gate/visits/{visit.id}/reply"
        # Let in twice is a no-op (no second notification).
        api.let_in(str(visit.id), api.VisitAction(), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert len(_outbox(db, "GATE_VISITOR_ARRIVED", visit.id)) == 1
        # Host reply: only the host (or department / plant head) may answer.
        with pytest.raises(HTTPException) as stranger:
            api.reply_to_visit(str(visit.id), api.ReplyIn(reply="SEND_IN"), db=db, plant_id=PLANT, current_user=PLANNER)
        assert stranger.value.status_code == 403
        db.rollback()
        answered = api.reply_to_visit(str(visit.id), api.ReplyIn(reply="WAIT"), db=db, plant_id=PLANT, current_user=HOST)
        assert answered["ok"] and "Ask to wait" in answered["message"]
        desk = api.get_desk(str(gate.id), db=db, plant_id=PLANT, current_user=WATCHMAN)
        row = next(row for row in desk["inside"] if row["id"] == str(visit.id))
        assert row["host_reply_label"] == "Ask to wait"
        # Out by the pass scan.
        scanned = api.scan_out(api.ScanOut(code=f"HARIOM|VISIT|{visit.pass_token}"), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert scanned["action"] == "OUT" and scanned["visit"]["status"] == "OUT"
        with pytest.raises(HTTPException) as late:
            api.reply_to_visit(str(visit.id), api.ReplyIn(reply="SEND_IN"), db=db, plant_id=PLANT, current_user=HOST)
        assert late.value.status_code == 409
        db.rollback()
        # Deny needs a GATE_DENY code and works only while waiting.
        other = db.query(GateVisit).filter(GateVisit.pass_token == _visit(db, gate, mobile="9833344455")["pass_token"]).one()
        denied = api.deny_visit(str(other.id), api.DenyIn(reason_code="GD-NO-ID"), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert denied["status"] == "DENIED" and denied["deny_code"] == "GD-NO-ID"
        with pytest.raises(HTTPException) as again:
            api.let_in(str(other.id), api.VisitAction(), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert again.value.status_code == 409
        db.rollback()


def test_department_host_is_notified_by_role_and_phone_is_private():
    with SessionLocal() as db:
        gate = _gate(db)
        body = api.PublicVisitIn(request_id=uuid.uuid4(), mobile="9844455566", name="Anil", purpose_code="VP-VENDOR", purpose_label="Vendor visit",
                                 host_department_key="ACCOUNTS")
        made = api.public_check_in(gate.qr_token, body, db=db)
        visit = db.query(GateVisit).filter(GateVisit.pass_token == made["pass_token"]).one()
        svc.let_in(db, visit, actor="gate1@example.com")
        db.commit()
        [note] = _outbox(db, "GATE_VISITOR_ARRIVED", visit.id)
        assert note["notify"]["recipient_roles"] == ["Accounts"] and note["notify"]["recipient_user_emails"] == []
        assert svc.may_reply(visit, ACCOUNTS) and not svc.may_reply(visit, STORE)
        # Accounts sees the visit through history? No: history is plant head and above. A non-private payload masks the phone.
        masked = svc.visits_payload(db, [visit], private=False)[0]
        assert masked["mobile"] == "98xxxxxx66" and masked["photo_url"] is None


def test_public_photo_is_a_visitor_photo_hidden_from_accounts():
    with SessionLocal() as db:
        gate = _gate(db)
        made = _visit(db, gate, mobile="9855566677")
        result = api.public_photo(made["pass_token"], file=_upload(_jpeg()), db=db)
        assert result["has_photo"] and not result["photo_allowed"]
        visit = db.query(GateVisit).filter(GateVisit.pass_token == made["pass_token"]).one()
        document = db.get(Document, visit.photo_doc_id)
        assert document.kind == "VISITOR_PHOTO" and document.uploaded_by.startswith("visitor:")
        assert not vault.access_for(ACCOUNTS).sees(document) and vault.access_for(HEAD).sees(document)
        with pytest.raises(HTTPException) as twice:
            api.public_photo(made["pass_token"], file=_upload(_jpeg()), db=db)
        assert twice.value.status_code == 409
        db.rollback()
        with pytest.raises(HTTPException) as nosy:
            api.get_visit_photo(str(visit.id), db=db, plant_id=PLANT, current_user=ACCOUNTS)
        assert nosy.value.status_code == 403
        photo = api.get_visit_photo(str(visit.id), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert photo.media_type == "image/jpeg"


def _upload(data: bytes):
    from fastapi import UploadFile
    return UploadFile(file=io.BytesIO(data), filename="selfie.jpg")


# ── Bills in ───────────────────────────────────────────────────────────────────────────────────
def test_bill_in_routes_material_to_stores_and_others_to_accounts():
    with SessionLocal() as db:
        gate = _gate(db)
        material = _bill(db, gate, "GB-MATERIAL", vendor_name="Sample Paper Mills", vehicle_no="gj 01 ab 1234")
        entry = material["entry"]
        assert entry["entry_no"].startswith("GE-") and entry["status"] == "WITH_STORES" and entry["route"] == "STORES"
        assert entry["vehicle_no"] == "GJ 01 AB 1234" and material["document_kind"] == "VENDOR_BILL"
        [note] = _outbox(db, "GATE_MATERIAL_ARRIVED", entry["id"])
        assert set(note["notify"]["recipient_roles"]) == {"Store", "GRN"} and note["payload"]["action"]["buttons"][0]["label"] == "Make GRN"
        power = _bill(db, gate, "GB-ELECTRICITY")["entry"]
        assert power["status"] == "WITH_ACCOUNTS" and power["route"] == "ACCOUNTS"
        [bill_note] = _outbox(db, "GATE_BILL_TO_FILE", power["id"])
        assert set(bill_note["notify"]["recipient_roles"]) == {"Accounts", "PlantManager"}
        # Idempotent: the same request key returns the same entry.
        key = uuid.uuid4()
        one = api.create_bill_in(api.BillIn(request_id=key, gate_id=gate.id, category_code="GB-COURIER"), db=db, plant_id=PLANT, current_user=WATCHMAN)
        two = api.create_bill_in(api.BillIn(request_id=key, gate_id=gate.id, category_code="GB-COURIER"), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert one["entry"]["id"] == two["entry"]["id"] and two["created"] is False
        # The strip lists material only.
        strip = api.get_at_the_gate(db=db, plant_id=PLANT, current_user=STORE)["items"]
        assert entry["id"] in {row["id"] for row in strip} and power["id"] not in {row["id"] for row in strip}


def test_recategorise_moves_the_queue_and_the_document_type():
    with SessionLocal() as db:
        gate = _gate(db)
        entry = _bill(db, gate, "GB-MATERIAL")["entry"]
        photo = _photo(db, entry["id"])
        moved = api.recategorise_entry(entry["id"], api.Recategorise(category_code="GB-MAINTENANCE", expected_version=entry["version"]),
                                       db=db, plant_id=PLANT, current_user=STORE)
        db.refresh(photo)
        # The photo becomes an expense bill (Store no longer sees it; Accounts and the plant head do).
        assert moved["status"] == "WITH_ACCOUNTS" and photo.kind == "EXPENSE_BILL" and photo.category == "GB-MAINTENANCE"
        assert moved["documents"] == [] and vault.access_for(ACCOUNTS).sees(photo)
        assert moved["history"][-1]["action"] == "RECATEGORISED" and moved["history"][-1]["by"] == "store@example.com"
        assert _outbox(db, "GATE_BILL_TO_FILE", entry["id"])
        with pytest.raises(HTTPException) as stale:
            api.recategorise_entry(entry["id"], api.Recategorise(category_code="GB-MATERIAL", expected_version=entry["version"]),
                                   db=db, plant_id=PLANT, current_user=ACCOUNTS)
        assert stale.value.status_code == 409
        db.rollback()
        # Accounts files it: party, bill no., date, amount, cost head. No stock moves.
        filed = api.file_entry(entry["id"], api.FileBill(expected_version=moved["version"], party_name="Sample Electricals", bill_no="SE-778",
                                                          bill_date=date.today(), amount="4250.50", cost_head_code="CO-ELECTRICAL"),
                               db=db, plant_id=PLANT, current_user=ACCOUNTS)
        assert filed["status"] == "FILED" and filed["bill_amount"] == 4250.5 and filed["cost_head_code"] == "CO-ELECTRICAL"
        assert filed["documents"][0]["ref_no"] == "SE-778" and filed["documents"][0]["party_name"] == "Sample Electricals"
        with pytest.raises(HTTPException) as late:
            api.recategorise_entry(entry["id"], api.Recategorise(category_code="GB-MATERIAL", expected_version=filed["version"]),
                                   db=db, plant_id=PLANT, current_user=ACCOUNTS)
        assert late.value.status_code == 409
        db.rollback()


def _paper_po(db):
    item = ItemMaster(item_code=f"KRAF-{uuid.uuid4().hex[:8]}", name="Kraft gate test", type="RAW_PAPER", tracking_mode="REEL", uom="KG",
                      plant_id=PLANT, active="true",
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "min": 100, "max": 140}]})
    db.add(item)
    db.commit()
    maker = {"sub": "kiran@example.com", "roles": ["Store"], "token": ""}
    created = create_purchase_order(PurchaseOrderCreate(
        request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Sample Paper Mills",
        expected_date=date(2026, 11, 6), lines=[{"item_id": item.id, "qty_ordered": 5000, "unit_cost": 60, "uom": "KG"}],
    ), db, PLANT, maker)
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, PLANT, maker)
    return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, PLANT, OWNER)


def _grn(po, gate_entry_id=None, reels=2):
    lots = [{"source_reel_no": f"R-{uuid.uuid4().hex[:6]}", "net_weight_kg": 600, "width_mm": 1000, "physical_form": "REEL"} for _ in range(reels)]
    return GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date.today(), supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}",
                                 invoice_pending=True, lines=[{"po_line_id": uuid.UUID(po["lines"][0]["id"]), "lots": lots}], gate_entry_id=gate_entry_id)


def test_grn_with_gate_entry_links_the_photos_to_the_grn_and_every_reel():
    with SessionLocal() as db:
        gate = _gate(db)
        po = _paper_po(db)
        entry = _bill(db, gate, "GB-MATERIAL", vendor_name="Sample Paper Mills")["entry"]
        first = _photo(db, entry["id"])
        receipt = post_governed_receipt(_grn(po, uuid.UUID(entry["id"]), reels=3), db=db, plant_id=PLANT, current_user=STORE)
        saved = db.get(GateEntry, uuid.UUID(entry["id"]))
        assert saved.status == "LINKED" and str(saved.receipt_id) == receipt["id"]
        links = {(link.entity_type, link.entity_id) for link in db.query(DocumentLink).filter(DocumentLink.document_id == first.id).all()}
        assert ("GRN", receipt["id"]) in links
        reel_links = [link for link in links if link[0] == "REEL"]
        assert len(reel_links) == 3
        # A photo that uploads after the link gets the same links on the next read / sweep.
        late = _photo(db, entry["id"])
        api.get_entry(entry["id"], db=db, plant_id=PLANT, current_user=STORE)
        late_links = {link.entity_type for link in db.query(DocumentLink).filter(DocumentLink.document_id == late.id).all()}
        assert {"GATE_ENTRY", "GRN", "REEL"} <= late_links
        # The GRN register knows it has a gate photo; one without has none.
        plain = post_governed_receipt(_grn(po), db=db, plant_id=PLANT, current_user=STORE)
        found = api.get_receipt_entries(receipt_ids=f"{receipt['id']},{plain['id']}", db=db, plant_id=PLANT, current_user=STORE)["items"]
        assert found[receipt["id"]][0]["entry_no"] == entry["entry_no"] and plain["id"] not in found
        # Link a gate entry to an already-posted GRN.
        second = _bill(db, gate, "GB-MATERIAL")["entry"]
        _photo(db, second["id"])
        linked = api.link_entry_to_receipt(second["id"], api.LinkReceipt(receipt_id=uuid.UUID(plain["id"])), db=db, plant_id=PLANT, current_user=STORE)
        assert linked["status"] == "LINKED" and linked["grn_no"] == plain["grn_no"]
        # An expense bill cannot be posted as a GRN's gate entry.
        expense = _bill(db, gate, "GB-ELECTRICITY")["entry"]
        with pytest.raises(HTTPException) as wrong:
            post_governed_receipt(_grn(po, uuid.UUID(expense["id"])), db=db, plant_id=PLANT, current_user=STORE)
        assert wrong.value.status_code == 409
        db.rollback()


# ── Goods out ──────────────────────────────────────────────────────────────────────────────────
def _dispatch(db, plant=PLANT, ref=None):
    ref = ref or f"DC/26/{uuid.uuid4().hex[:6].upper()}"
    item = ItemMaster(item_code=f"FG-{uuid.uuid4().hex[:8]}", name="Tube 76 x 3", type="FINISHED_GOOD", tracking_mode="BULK", uom="PCS",
                      plant_id=plant, active="true")
    db.add(item)
    db.flush()
    db.add(StockTransaction(item_id=item.id, transaction_type=TransactionType.DISPATCH, qty_change=-500, reference_type=ReferenceType.DISPATCH,
                            reference_id=uuid.uuid5(uuid.NAMESPACE_URL, ref), plant_id=plant, external_ref=f"T-{uuid.uuid4()}",
                            effective_date=svc.plant_today(), movement_metadata={"dispatch_ref": ref}))
    db.commit()
    return ref


def test_goods_out_needs_the_tally_number_and_happens_once_per_dispatch():
    with SessionLocal() as db:
        gate = _gate(db)
        ref = _dispatch(db)
        assert ref in {row["dispatch_ref"] for row in api.get_leaving_today(db=db, plant_id=PLANT, current_user=WATCHMAN)["items"]}
        with pytest.raises(HTTPException) as blank:
            svc.goods_out(db, plant_id=PLANT, gate=gate, dispatch_ref=ref, tally_bill_no="  ", tally_bill_date=None, vehicle_no=None,
                          actor="gate1@example.com", request_id=uuid.uuid4())
        assert blank.value.status_code == 422
        db.rollback()
        # The dispatch desk types the Tally number first; the watchman's form is prefilled.
        tally = api.put_tally(api.TallyIn(dispatch_ref=ref, tally_bill_no="t-1189"), db=db, plant_id=PLANT, current_user=DISPATCH)
        assert tally["tally_bill_no"] == "T-1189" and tally["out"] is False
        row = next(row for row in api.get_leaving_today(db=db, plant_id=PLANT, current_user=WATCHMAN)["items"] if row["dispatch_ref"] == ref)
        assert row["tally_bill_no"] == "T-1189"
        key = uuid.uuid4()
        out = api.post_goods_out(api.GoodsOut(request_id=key, gate_id=gate.id, dispatch_ref=ref, tally_bill_no="T-1189", vehicle_no="GJ 05 CD 9876"),
                                 db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert out["created"] and out["entry"]["kind"] == "GOODS_OUT" and out["dispatch"]["out"] is True
        replay = api.post_goods_out(api.GoodsOut(request_id=key, gate_id=gate.id, dispatch_ref=ref, tally_bill_no="T-1189"),
                                    db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert replay["created"] is False and replay["entry"]["id"] == out["entry"]["id"]
        with pytest.raises(HTTPException) as twice:
            api.post_goods_out(api.GoodsOut(request_id=uuid.uuid4(), gate_id=gate.id, dispatch_ref=ref, tally_bill_no="T-1190"),
                               db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert twice.value.status_code == 409 and "already went out" in twice.value.detail
        db.rollback()
        assert db.query(DispatchGateOut).filter(DispatchGateOut.plant_id == PLANT, DispatchGateOut.dispatch_ref == ref).count() == 1
        status = api.get_dispatch_status(refs=ref, db=db, plant_id=PLANT, current_user=DISPATCH)["items"][ref]
        assert status["out"] and status["vehicle_no"] == "GJ 05 CD 9876"
        # An unknown or other-plant dispatch cannot go out from here.
        other_ref = _dispatch(db, plant=OTHER)
        with pytest.raises(HTTPException) as foreign:
            api.post_goods_out(api.GoodsOut(request_id=uuid.uuid4(), gate_id=gate.id, dispatch_ref=other_ref, tally_bill_no="T-1"),
                               db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert foreign.value.status_code == 404
        db.rollback()


def test_end_of_day_dispatch_not_out_and_overstay_digest_send_once():
    with SessionLocal() as db:
        plant = str(uuid.uuid4())
        gate = _gate(db, plant=plant)
        _dispatch(db, plant=plant)
        visit, _ = svc.create_visit(db, plant_id=plant, gate=gate, mobile="9866677788", name="Late Visitor", company=None, purpose_code="VP-MEETING",
                                    purpose_label="Meeting", purpose_note=None, host=svc.HostChoice(department_key="PLANT"), people=1, vehicle_no=None,
                                    source="DESK", actor="gate1@example.com", request_id=uuid.uuid4())
        svc.let_in(db, visit, actor="gate1@example.com")
        db.add(GatePlantSetting(plant_id=plant, gate_close_time=time(0, 0), visitor_retention_days=365, version=1))
        db.commit()
        assert svc.dispatch_not_out(db, plant) == 1 and svc.dispatch_not_out(db, plant) == 0
        assert svc.overstay_digest(db, plant) == 1 and svc.overstay_digest(db, plant) == 0
        db.commit()
        [digest] = [row for row in _outbox(db, "GATE_OVERSTAY_DIGEST") if row["plant_id"] == plant]
        assert digest["notify"]["recipient_roles"] == ["Owner"]
        [notice] = [row for row in _outbox(db, "DISPATCH_NOT_OUT") if row["plant_id"] == plant]
        assert notice["notify"]["recipient_roles"] == ["Dispatch"]
        desk = svc.desk(db, plant, gate, WATCHMAN)
        assert desk["counts"]["overstay"] == 1 and desk["inside"][0]["overstay"] is True


def test_unlinked_material_reminder_after_24h_and_photo_purge_after_retention(local_storage):
    with SessionLocal() as db:
        gate = _gate(db)
        entry = _bill(db, gate, "GB-MATERIAL")["entry"]
        row = db.get(GateEntry, uuid.UUID(entry["id"]))
        row.created_at = datetime.utcnow() - timedelta(hours=25)
        db.commit()
        assert svc.remind_unlinked_material(db) >= 1
        db.commit()
        [reminder] = _outbox(db, "GATE_MATERIAL_UNLINKED_24H", entry["id"])
        assert "PlantManager" in reminder["notify"]["recipient_roles"]
        assert not _outbox(db, "GATE_MATERIAL_UNLINKED_24H", entry["id"])[1:]
        # Retention: an old visitor photo is blanked and voided; the visit log stays.
        made = _visit(db, gate, mobile="9877788899")
        api.public_photo(made["pass_token"], file=_upload(_jpeg()), db=db)
        visit = db.query(GateVisit).filter(GateVisit.pass_token == made["pass_token"]).one()
        visit.arrived_at = datetime.utcnow() - timedelta(days=400)
        db.commit()
        assert svc.purge_visitor_photos(db, PLANT) >= 1
        db.commit()
        db.refresh(visit)
        document = db.get(Document, visit.photo_doc_id)
        assert visit.photo_purged_at and document.status == "VOID" and document.void_reason_code == "DV-RETENTION"
        assert (local_storage / document.storage_key).stat().st_size < 2000
        assert svc.visits_payload(db, [visit], private=True)[0]["photo_url"] is None


# ── History, roles, plants ─────────────────────────────────────────────────────────────────────
def test_history_lists_all_three_types_and_exports_csv():
    with SessionLocal() as db:
        plant = str(uuid.uuid4())
        gate = _gate(db, plant=plant)
        _bill(db, gate, "GB-MATERIAL", plant=plant, vehicle_no="MH 12 XY 4455")
        visit, _ = svc.create_visit(db, plant_id=plant, gate=gate, mobile="9888899900", name="Meera", company="Box Co", purpose_code="VP-MEETING",
                                    purpose_label="Meeting", purpose_note=None, host=svc.HostChoice(department_key="SALES"), people=2, vehicle_no=None,
                                    source="DESK", actor="gate1@example.com", request_id=uuid.uuid4())
        ref = _dispatch(db, plant=plant)
        api.post_goods_out(api.GoodsOut(request_id=uuid.uuid4(), gate_id=gate.id, dispatch_ref=ref, tally_bill_no="T-55"), db=db, plant_id=plant, current_user=WATCHMAN)
        db.commit()
        result = api.get_history(date_from=None, date_to=None, gate_id=None, type=None, status=None, q=None, limit=100, offset=0, db=db, plant_id=plant, current_user=HEAD)
        assert result["counts"] == {"VISITOR": 1, "BILL_IN": 1, "GOODS_OUT": 1}
        assert next(row for row in result["items"] if row["type"] == "VISITOR")["mobile"] == "9888899900"
        searched = api.get_history(date_from=None, date_to=None, gate_id=None, type=None, status=None, q="T-55", limit=100, offset=0, db=db, plant_id=plant, current_user=HEAD)
        assert [row["type"] for row in searched["items"]] == ["GOODS_OUT"]
        by_phone = api.get_history(date_from=None, date_to=None, gate_id=None, type="VISITOR", status=None, q="98888", limit=100, offset=0, db=db, plant_id=plant, current_user=HEAD)
        assert len(by_phone["items"]) == 1
        csv_response = api.export_history(date_from=None, date_to=None, gate_id=None, type=None, status=None, q=None, db=db, plant_id=plant, current_user=HEAD)
        assert csv_response.media_type.startswith("text/csv")


def test_watchman_is_refused_outside_the_gate_desk_and_only_sees_own_entries():
    refused = [require_role(svc.STORE_LINK_ROLES), require_role(svc.ACCOUNTS_ROLES), require_role(svc.HISTORY_ROLES),
               require_role(svc.DISPATCH_DESK_ROLES), require_role(["Store", "PlantManager", "GRN"]), require_role([])]
    for checker in refused:
        with pytest.raises(HTTPException) as denied:
            checker(current_user=WATCHMAN)
        assert denied.value.status_code == 403
    with pytest.raises(HTTPException):
        require_owner(current_user=WATCHMAN)
    assert require_role(svc.DESK_ROLES)(current_user=WATCHMAN) is WATCHMAN
    with SessionLocal() as db:
        gate = _gate(db)
        mine = _bill(db, gate, "GB-COURIER")["entry"]
        theirs = _bill(db, gate, "GB-COURIER", user={"sub": "gate2@example.com", "roles": ["Watchman"], "token": ""})["entry"]
        listed = {row["id"] for row in api.list_entries(kind=None, status=None, route=None, limit=100, db=db, plant_id=PLANT, current_user=WATCHMAN)["items"]}
        assert mine["id"] in listed and theirs["id"] not in listed
        with pytest.raises(HTTPException) as other:
            api.get_entry(theirs["id"], db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert other.value.status_code == 403
        with pytest.raises(HTTPException) as chip:
            api.get_receipt_entries(receipt_ids=str(uuid.uuid4()), db=db, plant_id=PLANT, current_user=WATCHMAN)
        assert chip.value.status_code == 403


def test_plants_are_isolated():
    with SessionLocal() as db:
        gate = _gate(db)
        entry = _bill(db, gate, "GB-MATERIAL")["entry"]
        with pytest.raises(HTTPException) as cross:
            api.get_entry(entry["id"], db=db, plant_id=OTHER, current_user=HEAD)
        assert cross.value.status_code == 404
        # Another plant's gate cannot be used, and a document of another plant cannot link to this entry.
        with pytest.raises(HTTPException) as foreign_gate:
            _bill(db, gate, "GB-MATERIAL", plant=OTHER)
        assert foreign_gate.value.status_code == 404
        db.rollback()
        with pytest.raises(HTTPException) as foreign_link:
            vault.create_document(db, plant_id=OTHER, data=_jpeg(), filename="x.jpg", kind="VENDOR_BILL", actor="x", link=("GATE_ENTRY", entry["id"]))
        assert foreign_link.value.status_code == 404
        db.rollback()
        assert entry["id"] not in {row["id"] for row in api.get_at_the_gate(db=db, plant_id=OTHER, current_user=STORE)["items"]}
        made = _visit(db, gate, mobile="9899900011")
        visit = db.query(GateVisit).filter(GateVisit.pass_token == made["pass_token"]).one()
        with pytest.raises(HTTPException) as cross_visit:
            api.let_in(str(visit.id), api.VisitAction(), db=db, plant_id=OTHER, current_user=WATCHMAN)
        assert cross_visit.value.status_code == 404
        db.rollback()
        with pytest.raises(HTTPException) as cross_scan:
            api.scan_out(api.ScanOut(code=f"HARIOM|VISIT|{visit.pass_token}"), db=db, plant_id=OTHER, current_user=WATCHMAN)
        assert cross_scan.value.status_code == 404
        db.rollback()


def test_settings_are_owner_edited_and_versioned():
    with SessionLocal() as db:
        plant = str(uuid.uuid4())
        assert api.get_settings(db=db, plant_id=plant, current_user=WATCHMAN)["gate_close_time"] == "19:00"
        saved = api.put_settings(api.SettingsUpdate(gate_close_time="20:30", visitor_retention_days=180, expected_version=0), db=db, plant_id=plant, current_user=OWNER)
        assert saved["gate_close_time"] == "20:30" and saved["version"] == 1
        with pytest.raises(HTTPException) as stale:
            api.put_settings(api.SettingsUpdate(gate_close_time="21:00", visitor_retention_days=180, expected_version=0), db=db, plant_id=plant, current_user=OWNER)
        assert stale.value.status_code == 409
        db.rollback()


def test_goods_out_photos_missing_is_shown_not_blocking_and_a_known_file_still_links():
    """Verify pass (6 Nov 2026): the truck goes out without photos; the register, the gate history and the desk
    say which photo is missing until the Tally bill and challan photos are in the vault. A file already in the
    vault (saved earlier by someone else) uploaded by the watchman links to the entry instead of a 409."""
    from starlette.datastructures import UploadFile as StarletteUpload
    from src.routers.documents import upload_document

    with SessionLocal() as db:
        gate = _gate(db)
        ref = _dispatch(db)
        out = api.post_goods_out(api.GoodsOut(request_id=uuid.uuid4(), gate_id=gate.id, dispatch_ref=ref, tally_bill_no="T-77"),
                                 db=db, plant_id=PLANT, current_user=WATCHMAN)
        entry_id = out["entry"]["id"]
        status = api.get_dispatch_status(refs=ref, db=db, plant_id=PLANT, current_user=DISPATCH)["items"][ref]
        assert status["out"] and status["photos_missing"] == ["Tally bill", "Challan"]
        rows = svc.history(db, PLANT, date_from=svc.plant_today(), date_to=svc.plant_today(), gate_id=None, kind="GOODS_OUT",
                           status=None, q=ref, private=True)["items"]
        assert rows and rows[0]["photos_missing"] == ["Tally bill", "Challan"]
        desk = svc.desk(db, PLANT, gate, WATCHMAN)
        assert any(row["entry_id"] == entry_id for row in desk["photos_pending"])

        def upload(data, kind, user):
            return upload_document(file=StarletteUpload(io.BytesIO(data), filename="p.jpg"), kind=kind, source=None, category=None,
                                   party_type=None, party_id=None, party_name=None, ref_no=None, ref_date=None, amount=None, note=None,
                                   request_id=str(uuid.uuid4()), link_entity_type="GATE_ENTRY", link_entity_id=entry_id,
                                   db=db, plant_id=PLANT, current_user=user)

        upload(_jpeg(), "TALLY_BILL", WATCHMAN)
        status = api.get_dispatch_status(refs=ref, db=db, plant_id=PLANT, current_user=DISPATCH)["items"][ref]
        assert status["photos_missing"] == ["Challan"]
        # The challan photo was saved earlier by the dispatch desk (not visible to the watchman): still linked.
        challan = _jpeg()
        vault.create_document(db, plant_id=PLANT, data=challan, filename="c.jpg", kind="OUR_CHALLAN", actor="dispatch@example.com")
        db.commit()
        result = upload(challan, "OUR_CHALLAN", WATCHMAN)
        assert result["deduped"] and result["linked"] and set(result["document"]) == {"id", "doc_no", "kind", "kind_label"}
        status = api.get_dispatch_status(refs=ref, db=db, plant_id=PLANT, current_user=DISPATCH)["items"][ref]
        assert status["photos_missing"] == []
        entry = svc.entries_payload(db, [db.get(GateEntry, uuid.UUID(entry_id))], vault.access_for(WATCHMAN))[0]
        assert entry["photo_count"] == 2
