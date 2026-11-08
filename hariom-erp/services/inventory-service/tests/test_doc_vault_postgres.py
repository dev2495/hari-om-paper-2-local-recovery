"""Doc Vault (6 Nov 2026) on live PostgreSQL: upload checks, dedupe, pages, plant isolation, who sees what,
void (never delete), link uniqueness and the frozen debit note copy on ISSUE."""
import io
import os
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from PIL import Image
from sqlalchemy.exc import IntegrityError

from src.database import Base, SessionLocal, engine
from src.main import ensure_runtime_schema
from src.models import PurchaseDebitNote
from src.models_vault import Document, DocumentEvent, DocumentLink, DocumentPage
from src.reasons import ReasonChoice
from src.routers import documents as api
from src.routers.procurement import DebitNoteAction, act_on_debit_note
from src.services import doc_storage
from src.services import doc_vault as vault
from src.utils.auth import require_role

PLANT = str(uuid.uuid4())
OTHER_PLANT = str(uuid.uuid4())
OWNER = {"sub": "owner@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "token": ""}
HEAD = {"sub": "plant.head@example.com", "roles": ["PlantManager"], "token": ""}
STORE = {"sub": "store@example.com", "roles": ["Store"], "token": ""}
DISPATCH = {"sub": "dispatch@example.com", "roles": ["Dispatch"], "token": ""}
WATCHMAN = {"sub": "gate1@example.com", "roles": ["Watchman"], "token": ""}
PLANNER = {"sub": "planner@example.com", "roles": ["Planner"], "token": ""}
REASON = ReasonChoice(category="DOC_VOID", code="DV-DUPLICATE", label="Uploaded twice", note=None)


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


def _jpeg(size=(320, 200), colour=None) -> bytes:
    colour = colour or tuple(uuid.uuid4().bytes[:3])
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "JPEG", quality=85)
    return buffer.getvalue()


def _pdf() -> bytes:
    marker = uuid.uuid4().hex.encode()
    return (b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
            b"3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n% " + marker + b"\ntrailer << /Root 1 0 R >>\n%%EOF\n")


def _make(db, *, kind="VENDOR_BILL", actor="store@example.com", plant=PLANT, data=None, **extra):
    document, created = vault.create_document(db, plant_id=plant, data=data or _jpeg(), filename="bill.jpg", kind=kind,
                                              actor=actor, **extra)
    db.commit()
    return document, created


def _list(db, user, plants=(PLANT,), **filters):
    params = dict(q=None, tab="ALL", kind=None, category=None, party=None, date_from=None, date_to=None, linked=None,
                  uploaded_by=None, source=None, status="ACTIVE", limit=200, offset=0)
    params.update(filters)
    scope = {"selected_plant_id": plants[0] if len(plants) == 1 else None, "scope_all": len(plants) > 1, "allowed_plants": list(plants)}
    return api.list_documents(**params, db=db, plant_scope=scope, current_user=user)


def test_bad_magic_bytes_size_limit_and_empty_files_are_refused():
    with SessionLocal() as db:
        with pytest.raises(HTTPException) as bad:
            vault.create_document(db, plant_id=PLANT, data=b"MZ\x90\x00 this is an exe" * 10, filename="bill.jpg",
                                  kind="VENDOR_BILL", actor="store@example.com")
        assert bad.value.status_code == 415
        # A text file renamed .pdf is refused too: the bytes decide, not the name.
        with pytest.raises(HTTPException) as renamed:
            vault.create_document(db, plant_id=PLANT, data=b"hello world", filename="bill.pdf", kind="VENDOR_BILL", actor="x")
        assert renamed.value.status_code == 415
        with pytest.raises(HTTPException) as big:
            vault.create_document(db, plant_id=PLANT, data=b"%PDF-1.4\n" + b"0" * (10 * 1024 * 1024), filename="big.pdf",
                                  kind="VENDOR_BILL", actor="x")
        assert big.value.status_code == 413
        with pytest.raises(HTTPException) as empty:
            vault.create_document(db, plant_id=PLANT, data=b"", filename="x.jpg", kind="VENDOR_BILL", actor="x")
        assert empty.value.status_code == 422
        db.rollback()
        assert db.query(Document).filter(Document.plant_id == PLANT, Document.uploaded_by == "x").count() == 0


def test_upload_numbers_thumbnails_and_dedupes_per_plant(local_storage):
    with SessionLocal() as db:
        data = _jpeg()
        first, created = _make(db, data=data, ref_no="INV-7781", party_name="Sample Paper Mills")
        assert created and first.doc_no.startswith("DV-") and len(first.doc_no) == len("DV-2611-0001")
        assert first.thumb_key and first.thumb_key.startswith("thumbs/") and first.storage_key.startswith(f"{PLANT}/")
        assert (local_storage / first.storage_key).is_file() and (local_storage / first.thumb_key).is_file()
        assert "INV-7781" in first.search_text and "Sample Paper Mills" in first.search_text

        again, created_again = _make(db, data=data)
        assert again.id == first.id and created_again is False
        # Another plant keeps its own copy and number series.
        other, created_other = _make(db, data=data, plant=OTHER_PLANT)
        assert created_other and other.id != first.id

        # A retried request returns what the first one made, whatever file it carries.
        key = uuid.uuid4()
        made, _ = _make(db, request_id=key)
        replay, replay_created = _make(db, request_id=key)
        assert replay.id == made.id and replay_created is False

        # A void document no longer blocks the same file.
        vault.void_document(db, first, reason=REASON, actor="owner@example.com")
        db.commit()
        fresh, fresh_created = _make(db, data=data)
        assert fresh_created and fresh.id != first.id


def test_big_photo_is_shrunk_and_pdf_passes_through(local_storage):
    with SessionLocal() as db:
        buffer = io.BytesIO()
        Image.new("RGB", (3600, 2400), (200, 120, 40)).save(buffer, "PNG")
        photo, _ = _make(db, data=buffer.getvalue())
        page = db.query(DocumentPage).filter(DocumentPage.document_id == photo.id).one()
        assert page.mime == "image/jpeg" and max(page.width, page.height) == 2000 and photo.storage_key.endswith(".jpg")
        assert page.bytes < len(buffer.getvalue())

        pdf_bytes = _pdf()
        pdf, _ = _make(db, data=pdf_bytes)
        pdf_page = db.query(DocumentPage).filter(DocumentPage.document_id == pdf.id).one()
        assert pdf.mime == "application/pdf" and pdf.thumb_key is None and pdf_page.pdf_pages == 1
        assert (local_storage / pdf.storage_key).read_bytes() == pdf_bytes


def test_a_bill_photographed_as_two_pages_is_one_document():
    with SessionLocal() as db:
        document, _ = _make(db)
        second = _jpeg()
        page, created = vault.attach_page(db, document, data=second, filename="p2.jpg", actor="store@example.com")
        db.commit()
        assert created and page.page_no == 2
        db.refresh(document)
        assert document.pages == 2 and document.version == 2
        same, created_same = vault.attach_page(db, document, data=second, filename="p2.jpg", actor="store@example.com")
        assert created_same is False and same.id == page.id
        other, _ = _make(db)
        with pytest.raises(HTTPException) as clash:
            vault.attach_page(db, other, data=second, filename="p2.jpg", actor="store@example.com")
        assert clash.value.status_code == 409 and document.doc_no in clash.value.detail
        db.rollback()
        payload = vault.document_payload(db, document, detail=True)
        assert [row["page_no"] for row in payload["page_list"]] == [1, 2]


def test_plant_isolation_on_get_list_and_files():
    with SessionLocal() as db:
        document, _ = _make(db)
        with pytest.raises(HTTPException) as missing:
            vault.get_document(db, document.id, [OTHER_PLANT])
        assert missing.value.status_code == 404
        scope = {"selected_plant_id": OTHER_PLANT, "scope_all": False, "allowed_plants": [OTHER_PLANT]}
        with pytest.raises(HTTPException):
            api.document_file(str(document.id), page=1, download=False, db=db, plant_scope=scope, current_user=OWNER)
        ids = {row["id"] for row in _list(db, OWNER, plants=(OTHER_PLANT,))["items"]}
        assert str(document.id) not in ids
        assert str(document.id) in {row["id"] for row in _list(db, OWNER)["items"]}


def test_who_sees_what_by_role():
    with SessionLocal() as db:
        bill, _ = _make(db, kind="VENDOR_BILL")
        tally, _ = _make(db, kind="TALLY_BILL", actor="dispatch@example.com")
        expense, _ = _make(db, kind="EXPENSE_BILL", actor="accounts@example.com")
        own, _ = _make(db, kind="VISITOR_PHOTO", actor="gate1@example.com")
        old, _ = _make(db, kind="VENDOR_CHALLAN", actor="gate1@example.com")
        old.uploaded_at = datetime.utcnow() - timedelta(days=2)
        db.commit()

        def seen(user):
            return {row["id"] for row in _list(db, user)["items"]}

        mine = {str(d.id) for d in (bill, tally, expense, own, old)}
        assert mine <= seen(HEAD) and mine <= seen(OWNER)
        store = seen(STORE) & mine
        # Store links the goods-out photos to challans (8 Nov 2026), so it sees the Tally bill too; not expenses.
        assert str(bill.id) in store and str(old.id) in store and str(tally.id) in store and str(expense.id) not in store
        assert seen(DISPATCH) & mine == {str(tally.id)}
        # The watchman sees only what they saved today.
        assert seen(WATCHMAN) & mine == {str(own.id)}
        with pytest.raises(HTTPException) as denied:
            api._access(PLANNER)
        assert denied.value.status_code == 403
        assert vault.access_for(WATCHMAN).may_upload("VENDOR_BILL") and not vault.access_for(WATCHMAN).may_upload("DEBIT_NOTE")
        assert not vault.access_for(DISPATCH).may_upload("VENDOR_BILL")
        scope = {"selected_plant_id": PLANT, "scope_all": False, "allowed_plants": [PLANT]}
        with pytest.raises(HTTPException) as hidden:
            api.get_document(str(expense.id), db=db, plant_scope=scope, current_user=STORE)
        assert hidden.value.status_code == 404


def test_void_keeps_the_row_and_file_and_is_hidden_by_default(local_storage):
    with SessionLocal() as db:
        document, _ = _make(db)
        with pytest.raises(HTTPException) as stale:
            vault.void_document(db, document, reason=REASON, actor="owner@example.com", expected_version=99)
        assert stale.value.status_code == 409
        vault.void_document(db, document, reason=REASON, actor="owner@example.com", expected_version=document.version)
        db.commit()
        db.refresh(document)
        assert document.status == "VOID" and document.void_reason_code == "DV-DUPLICATE" and document.voided_by == "owner@example.com"
        assert (local_storage / document.storage_key).is_file()
        assert db.get(Document, document.id) is not None
        assert str(document.id) not in {row["id"] for row in _list(db, OWNER)["items"]}
        assert str(document.id) in {row["id"] for row in _list(db, OWNER, status="VOID")["items"]}
        actions = [row.action for row in db.query(DocumentEvent).filter(DocumentEvent.document_id == document.id).order_by(DocumentEvent.at)]
        assert actions == ["UPLOAD", "VOID"]
        # Only Owner / Admin pass the void and unlink routes' role check.
        with pytest.raises(HTTPException):
            require_role(["Owner", "Admin"])(current_user=HEAD)
        with pytest.raises(HTTPException):
            vault.attach_page(db, document, data=_jpeg(), filename="x.jpg", actor="owner@example.com")


def test_links_are_unique_and_unlink_is_logged():
    from src.models import PurchaseReceipt
    with SessionLocal() as db:
        receipt = PurchaseReceipt(plant_id=PLANT, grn_no=f"P/26/{uuid.uuid4().hex[:5]}", received_date=date(2026, 11, 6),
                                  supplier_name_snapshot="Sample Paper Mills", supplier_challan_no="CH-4411", created_by="store@example.com")
        db.add(receipt)
        db.commit()
        document, _ = _make(db, link=("GRN", str(receipt.id)))
        first = db.query(DocumentLink).filter(DocumentLink.document_id == document.id).one()
        assert first.entity_label == f"GRN {receipt.grn_no}" and "CH-4411" in document.search_text
        link, created = vault.link_document(db, document, "GRN", str(receipt.id), "store@example.com")
        assert created is False and link.id == first.id
        db.add(DocumentLink(document_id=document.id, plant_id=PLANT, entity_type="GRN", entity_id=str(receipt.id), linked_by="x"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        # A GRN of another plant cannot be linked.
        with pytest.raises(HTTPException) as foreign:
            vault.create_document(db, plant_id=OTHER_PLANT, data=_jpeg(), filename="b.jpg", kind="VENDOR_BILL", actor="x",
                                  link=("GRN", str(receipt.id)))
        assert foreign.value.status_code == 404
        db.rollback()
        # The vault finds it by GRN number and by challan; the panel lists it for the GRN.
        assert str(document.id) in {row["id"] for row in _list(db, STORE, q=receipt.grn_no)["items"]}
        assert str(document.id) in {row["id"] for row in _list(db, STORE, q="ch-4411")["items"]}
        assert [d.id for d in vault.documents_for(db, PLANT, "GRN", str(receipt.id))] == [document.id]
        assert str(document.id) not in {row["id"] for row in _list(db, STORE, tab="UNLINKED")["items"]}

        assert vault.unlink_document(db, document, "GRN", str(receipt.id), "owner@example.com") is True
        db.commit()
        assert vault.documents_for(db, PLANT, "GRN", str(receipt.id)) == []
        assert str(document.id) in {row["id"] for row in _list(db, STORE, tab="UNLINKED")["items"]}
        events = db.query(DocumentEvent).filter(DocumentEvent.document_id == document.id, DocumentEvent.action == "UNLINK").all()
        assert len(events) == 1 and events[0].actor == "owner@example.com" and events[0].detail["label"] == f"GRN {receipt.grn_no}"


def test_issuing_a_debit_note_keeps_one_frozen_pdf():
    with SessionLocal() as db:
        note = PurchaseDebitNote(plant_id=PLANT, debit_note_no=f"DN/26/{uuid.uuid4().hex[:5]}", request_id=uuid.uuid4(),
                                 request_fingerprint="x" * 64, supplier_id=uuid.uuid4(), supplier_name_snapshot="Sample Paper Mills",
                                 note_date=date(2026, 11, 6), reason="Short supply", status="APPROVED", total_amount=1500,
                                 created_by="accounts@example.com", approved_by="plant.head@example.com", version=1)
        db.add(note)
        db.commit()
        issued = act_on_debit_note(note.id, DebitNoteAction(action="ISSUE", expected_version=1), db, PLANT, HEAD)
        assert issued["status"] == "ISSUED"
        copies = vault.documents_for(db, PLANT, "DEBIT_NOTE", str(note.id))
        assert len(copies) == 1
        copy = copies[0]
        assert copy.kind == "DEBIT_NOTE" and copy.source == "SYSTEM" and copy.mime == "application/pdf"
        assert copy.ref_no == note.debit_note_no and float(copy.amount) == 1500
        assert vault.read_page_bytes(vault.page_of(db, copy, 1)).startswith(b"%PDF")
        again = vault.snapshot_debit_note(db, db.get(PurchaseDebitNote, note.id), actor="x", describe=lambda row: {})
        db.commit()
        assert again.id == copy.id and len(vault.documents_for(db, PLANT, "DEBIT_NOTE", str(note.id))) == 1


def test_s3_backend_puts_with_sse_and_presigns_only_in_redirect_mode():
    calls = {}

    class FakeS3:
        def put_object(self, **kwargs):
            calls["put"] = kwargs

        def generate_presigned_url(self, operation, Params, ExpiresIn):
            calls["presign"] = (operation, Params, ExpiresIn)
            return "https://bucket.s3.amazonaws.com/signed"

    proxy = doc_storage.S3Storage("hariom-docs", "ap-south-1", "live", client=FakeS3())
    proxy.put("p/2026/11/x.jpg", b"abc", "image/jpeg")
    assert calls["put"]["Key"] == "live/p/2026/11/x.jpg" and calls["put"]["ServerSideEncryption"] == "AES256"
    assert proxy.presigned_get("p/2026/11/x.jpg", filename="x.jpg", content_type="image/jpeg") is None
    redirect = doc_storage.S3Storage("hariom-docs", "ap-south-1", "", client=FakeS3(), delivery="redirect")
    assert redirect.presigned_get("k.jpg", filename="x.jpg", content_type="image/jpeg").startswith("https://")
    assert calls["presign"][2] == 300
    with pytest.raises(doc_storage.StorageUnavailable):
        doc_storage.S3Storage("", None)
