"""Doc Vault service (6 Nov 2026): the one place other code saves, links and finds documents.

Use these from any router or service (the Gate module, dispatch, QC …). None of them commits; the
caller's transaction commits or rolls back. Files are written to storage first, so a rolled-back
request can leave an unreferenced file behind, never a row without a file.

    create_document(db, plant_id=..., data=..., filename=..., kind=..., actor=..., source=...,
                    link=("GRN", grn_id), request_id=...)          -> (Document, created)
    attach_page(db, document, data=..., filename=..., actor=..., request_id=...)  -> (DocumentPage, created)
    link_document(db, document_or_id, entity_type, entity_id, actor, plant_id=...) -> (DocumentLink, created)
    unlink_document(db, document, entity_type, entity_id, actor)                  -> bool
    void_document(db, document, reason=ReasonChoice, actor=..., expected_version=...) -> Document
    update_document(db, document, changes={...}, actor=..., expected_version=...)  -> Document
    documents_for(db, plant_id, entity_type, entity_id, include_void=False)        -> list[Document]
    save_system_pdf(db, plant_id=..., kind=..., pdf_bytes=..., filename=..., entity_type=..., entity_id=...,
                    actor=...)                                                     -> Document (idempotent)
    register_entity_resolver(entity_type, fn)   # teach the vault a new link target (label, href, search words)
    access_for(current_user)                    # who may see / upload which kinds
    document_payload(db, document, access=...) # the JSON shape the API and UI use

Rules kept here (not in the router) so every caller gets them:
- Files: JPEG, PNG, WebP or PDF by magic bytes, at most 10 MB each, at most 20 pages a document.
- Images over 2400 px or 1.5 MB are re-saved as JPEG (2000 px, quality 80); a 480 px JPEG thumbnail is made.
- The same file (sha256 of the bytes as uploaded) in the same plant returns the existing active document.
- A retried request (same request_id) returns what the first one made.
- Nothing is deleted; void keeps the file. Every change is written to document_events.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Iterable, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from ..models import DocumentSeries
from ..models_vault import DOCUMENT_KINDS, DOCUMENT_SOURCES, LINK_ENTITY_TYPES, Document, DocumentEvent, DocumentLink, DocumentPage
from .doc_storage import StorageObjectMissing, StorageUnavailable, document_key, get_storage, thumb_key_for

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PAGES = 20
IMAGE_LONG_EDGE = 2000
IMAGE_RECOMPRESS_EDGE = 2400
IMAGE_RECOMPRESS_BYTES = 1_500_000
IMAGE_QUALITY = 80
THUMB_EDGE = 480
THUMB_QUALITY = 72
MAX_IMAGE_PIXELS = 60_000_000

# ── Who sees what (plan §3) ────────────────────────────────────────────────────────────────────
FULL_ACCESS_ROLES = frozenset({"Owner", "Admin", "PlantManager", "Accounts"})
MATERIAL_KINDS = frozenset({"VENDOR_BILL", "VENDOR_CHALLAN"})
OUTWARD_KINDS = frozenset({"TALLY_BILL", "OUR_CHALLAN"})
GATE_UPLOAD_KINDS = frozenset({"VENDOR_BILL", "VENDOR_CHALLAN", "EXPENSE_BILL", "TALLY_BILL", "OUR_CHALLAN", "VISITOR_PHOTO", "OTHER"})
ROLE_KINDS: dict[str, frozenset[str]] = {
    # Store links the watchman's goods-out photos (Tally bill, our challan) to the challans (8 Nov 2026).
    "Store": MATERIAL_KINDS | OUTWARD_KINDS,
    "GRN": MATERIAL_KINDS,
    "InwardQC": MATERIAL_KINDS,
    "QC": MATERIAL_KINDS,
    "Dispatch": OUTWARD_KINDS,
}
WATCHMAN_ROLE = "Watchman"
VAULT_ROLES = sorted(FULL_ACCESS_ROLES | set(ROLE_KINDS) | {WATCHMAN_ROLE})
VOID_ROLES = frozenset({"Owner", "Admin"})
PRIVATE_PHOTO_ROLES = frozenset({"Owner", "Admin", "PlantManager"})
KIND_SOURCES = {"VENDOR_BILL": "STORE", "VENDOR_CHALLAN": "STORE", "EXPENSE_BILL": "STORE", "TALLY_BILL": "DISPATCH",
                "OUR_CHALLAN": "DISPATCH", "DEBIT_NOTE": "SYSTEM", "VISITOR_PHOTO": "GATE", "OTHER": "STORE"}

KIND_WORDS = {"VENDOR_BILL": "Vendor bill", "VENDOR_CHALLAN": "Vendor challan", "EXPENSE_BILL": "Expense bill",
              "TALLY_BILL": "Tally bill", "OUR_CHALLAN": "Our challan", "DEBIT_NOTE": "Debit note",
              "VISITOR_PHOTO": "Visitor photo", "OTHER": "Other"}

EDITABLE_FIELDS = ("kind", "category", "party_type", "party_id", "party_name", "ref_no", "ref_date", "amount", "note")


def plant_today_start_utc(now: Optional[datetime] = None) -> datetime:
    """Midnight today in the plant's time zone, as the naive UTC the tables store."""
    zone = ZoneInfo(os.getenv("PLANT_TIMEZONE", "Asia/Kolkata") or "Asia/Kolkata")
    local_now = (now.replace(tzinfo=timezone.utc) if now else datetime.now(timezone.utc)).astimezone(zone)
    start = datetime.combine(local_now.date(), time.min, tzinfo=zone)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def actor_of(current_user: dict) -> str:
    return str(current_user.get("actor_identity") or current_user.get("actual_sub") or current_user.get("sub") or "system")


def _roles(current_user: dict) -> set[str]:
    return {str(role) for role in (current_user.get("roles") or [])} | ({str(current_user["role"])} if current_user.get("role") else set())


@dataclass(frozen=True)
class DocumentAccess:
    """What one login may do in the vault. ``kinds=None`` means every kind."""
    actor: str
    kinds: Optional[frozenset[str]]
    upload_kinds: Optional[frozenset[str]]
    own_today: bool = False
    can_void: bool = False
    can_unlink: bool = False
    can_edit: bool = False

    @property
    def any_access(self) -> bool:
        return self.kinds is None or bool(self.kinds) or self.own_today

    def sees(self, document: Document, *, now: Optional[datetime] = None) -> bool:
        if self.kinds is None or document.kind in self.kinds:
            return True
        return bool(self.own_today and document.uploaded_by == self.actor
                    and document.uploaded_at and document.uploaded_at >= plant_today_start_utc(now))

    def may_upload(self, kind: str) -> bool:
        return self.upload_kinds is None or kind in self.upload_kinds


def access_for(current_user: dict) -> DocumentAccess:
    roles = _roles(current_user)
    actor = actor_of(current_user)
    if roles & FULL_ACCESS_ROLES:
        # Visitor photos are for the gate, the plant head, the Owner and the Admin only (gate privacy rule,
        # 6 Nov 2026): Accounts sees every other kind.
        if not roles & PRIVATE_PHOTO_ROLES:
            return DocumentAccess(actor=actor, kinds=frozenset(DOCUMENT_KINDS) - {"VISITOR_PHOTO"},
                                  upload_kinds=frozenset(DOCUMENT_KINDS) - {"VISITOR_PHOTO"}, can_edit=True)
        return DocumentAccess(actor=actor, kinds=None, upload_kinds=None, can_void=bool(roles & VOID_ROLES),
                              can_unlink=bool(roles & VOID_ROLES), can_edit=True)
    kinds: set[str] = set()
    for role in roles:
        kinds |= ROLE_KINDS.get(role, frozenset())
    watchman = WATCHMAN_ROLE in roles
    upload = set(kinds) | (set(GATE_UPLOAD_KINDS) if watchman else set())
    return DocumentAccess(actor=actor, kinds=frozenset(kinds), upload_kinds=frozenset(upload), own_today=watchman,
                          can_edit=bool(kinds))


def visible_filter(query, access: DocumentAccess, *, now: Optional[datetime] = None):
    """Restrict a ``db.query(Document)`` to what ``access`` may see."""
    if access.kinds is None:
        return query
    clauses = []
    if access.kinds:
        clauses.append(Document.kind.in_(sorted(access.kinds)))
    if access.own_today:
        clauses.append((Document.uploaded_by == access.actor) & (Document.uploaded_at >= plant_today_start_utc(now)))
    if not clauses:
        return query.filter(text("false"))
    return query.filter(or_(*clauses))


# ── Files ──────────────────────────────────────────────────────────────────────────────────────
MIME_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}


def sniff_mime(data: bytes) -> Optional[str]:
    """The file type from its first bytes (never from the name or the browser's claim)."""
    head = data[:16]
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if data[:1024].lstrip().startswith(b"%PDF-"):
        return "application/pdf"
    return None


@dataclass
class PreparedFile:
    data: bytes
    mime: str
    ext: str
    sha256: str
    original_bytes: int
    width: Optional[int] = None
    height: Optional[int] = None
    thumb: Optional[bytes] = None
    pdf_pages: Optional[int] = None


def _pdf_page_count(data: bytes) -> Optional[int]:
    count = len(re.findall(rb"/Type\s*/Page(?![s\w])", data))
    return count or None


def prepare_file(data: bytes, filename: Optional[str] = None) -> PreparedFile:
    """Check and (for big photos) shrink one uploaded file, and make its thumbnail."""
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty. Take the photo again or pick another file.")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"The file is {len(data) / 1048576:.1f} MB. Each file can be at most 10 MB; send a smaller photo or split the PDF.")
    mime = sniff_mime(data)
    if not mime:
        raise HTTPException(status_code=415, detail="Only photos (JPEG, PNG, WebP) and PDF files can be saved. This file is not one of them.")
    sha = hashlib.sha256(data).hexdigest()
    prepared = PreparedFile(data=data, mime=mime, ext=MIME_EXT[mime], sha256=sha, original_bytes=len(data))
    if mime == "application/pdf":
        prepared.pdf_pages = _pdf_page_count(data)
        return prepared
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover - Pillow is in requirements; keep the original without a thumbnail
        log.warning("Pillow is not installed; document photos are kept as sent, without thumbnails")
        return prepared
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:  # Pillow raises many types for broken or hostile images
        raise HTTPException(status_code=415, detail="This photo could not be read. Take it again or send a PDF.") from exc
    upright = ImageOps.exif_transpose(image)
    prepared.width, prepared.height = upright.size
    if max(upright.size) > IMAGE_RECOMPRESS_EDGE or len(data) > IMAGE_RECOMPRESS_BYTES:
        shrunk = _rgb(upright)
        shrunk.thumbnail((IMAGE_LONG_EDGE, IMAGE_LONG_EDGE))
        buffer = io.BytesIO()
        shrunk.save(buffer, "JPEG", quality=IMAGE_QUALITY, optimize=True, progressive=True)
        prepared.data, prepared.mime, prepared.ext = buffer.getvalue(), "image/jpeg", "jpg"
        prepared.width, prepared.height = shrunk.size
    thumb = _rgb(upright)
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE))
    buffer = io.BytesIO()
    thumb.save(buffer, "JPEG", quality=THUMB_QUALITY, optimize=True)
    prepared.thumb = buffer.getvalue()
    return prepared


def _rgb(image):
    if image.mode in ("RGB", "L"):
        return image.copy()
    from PIL import Image
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.split()[-1])
        return canvas
    return image.convert("RGB")


def _store(plant_id: str, doc_id: uuid.UUID, page_no: int, prepared: PreparedFile, when: datetime) -> tuple[str, str, Optional[str]]:
    storage = get_storage()
    key = document_key(plant_id, str(doc_id), prepared.ext, when, page_no=page_no)
    try:
        storage.put(key, prepared.data, prepared.mime)
        thumb_key = None
        if prepared.thumb:
            thumb_key = thumb_key_for(key)
            storage.put(thumb_key, prepared.thumb, "image/jpeg")
    except StorageUnavailable as exc:
        log.error("doc vault storage failed: %s", exc)
        raise HTTPException(status_code=503, detail="Document storage is not set up or not reachable. The photo is not saved; try again, or ask the Admin to check document storage.") from exc
    return storage.name, key, thumb_key


# ── Numbers ────────────────────────────────────────────────────────────────────────────────────
def next_doc_no(db: Session, plant_id: str, on: Optional[datetime] = None) -> str:
    """DV-YYMM-NNNN, one series per plant and month (the document_series pattern)."""
    zone = ZoneInfo(os.getenv("PLANT_TIMEZONE", "Asia/Kolkata") or "Asia/Kolkata")
    local = (on.replace(tzinfo=timezone.utc) if on else datetime.now(timezone.utc)).astimezone(zone)
    category = f"DV-{local:%y%m}"
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"doc-series:{plant_id}:{category}"})
    counter = db.query(DocumentSeries).filter(
        DocumentSeries.plant_id == str(plant_id), DocumentSeries.document_type == "DOC_VAULT",
        DocumentSeries.category == category,
    ).with_for_update().first()
    if not counter:
        counter = DocumentSeries(plant_id=str(plant_id), document_type="DOC_VAULT", category=category, prefix="DV", next_value=1)
        db.add(counter)
        db.flush()
    sequence = int(counter.next_value or 1)
    candidate = f"DV-{local:%y%m}-{sequence:04d}"
    while db.query(Document.id).filter(Document.plant_id == str(plant_id), Document.doc_no == candidate).first():
        sequence += 1
        candidate = f"DV-{local:%y%m}-{sequence:04d}"
    counter.next_value = sequence + 1
    counter.version = int(counter.version or 1) + 1
    return candidate


# ── Link targets ───────────────────────────────────────────────────────────────────────────────
@dataclass
class EntityRef:
    label: str
    href: Optional[str] = None
    search: list[str] = field(default_factory=list)


EntityResolver = Callable[[Session, str, str], Optional[EntityRef]]
_RESOLVERS: dict[str, EntityResolver] = {}


def register_entity_resolver(entity_type: str, resolver: EntityResolver) -> None:
    """Teach the vault a link target: ``resolver(db, plant_id, entity_id)`` returns an EntityRef, or None
    when the record is not in that plant (the link is then refused). Types without a resolver are
    linked as given (the caller is trusted to have checked the record)."""
    if entity_type not in LINK_ENTITY_TYPES:
        raise ValueError(f"unknown document link type {entity_type}")
    _RESOLVERS[entity_type] = resolver


def _uuid_or_none(value: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _resolve_grn(db: Session, plant_id: str, entity_id: str) -> Optional[EntityRef]:
    from ..models import PurchaseReceipt, SupplierInvoice
    key = _uuid_or_none(entity_id)
    if not key:
        return None
    receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.id == key, PurchaseReceipt.plant_id == str(plant_id)).first()
    if not receipt:
        return None
    words = [receipt.grn_no, receipt.supplier_challan_no or "", receipt.supplier_name_snapshot or ""]
    if receipt.supplier_invoice_id:
        invoice = db.get(SupplierInvoice, receipt.supplier_invoice_id)
        if invoice and not str(invoice.invoice_no or "").startswith("PENDING:"):
            words.append(invoice.invoice_no)
    return EntityRef(label=f"GRN {receipt.grn_no}", href=f"/purchase/receipts/{receipt.id}", search=[w for w in words if w])


def _resolve_reel(db: Session, plant_id: str, entity_id: str) -> Optional[EntityRef]:
    from ..models import PaperReel
    key = _uuid_or_none(entity_id)
    if not key:
        return None
    reel = db.query(PaperReel).filter(PaperReel.id == key).first()
    if not reel or str(reel.plant_id) != str(plant_id):
        return None
    return EntityRef(label=f"Reel {reel.reel_code}", href=f"/inventory/genealogy?reel={reel.id}",
                     search=[w for w in (reel.reel_code, reel.source_reel_no) if w])


def _resolve_batch(db: Session, plant_id: str, entity_id: str) -> Optional[EntityRef]:
    from ..models import StockBatch
    key = _uuid_or_none(entity_id)
    if not key:
        return None
    batch = db.query(StockBatch).filter(StockBatch.id == key).first()
    if not batch or str(getattr(batch, "plant_id", plant_id)) != str(plant_id):
        return None
    return EntityRef(label=f"Lot {batch.batch_no}", href=None, search=[batch.batch_no])


def _resolve_debit_note(db: Session, plant_id: str, entity_id: str) -> Optional[EntityRef]:
    from ..models import PurchaseDebitNote
    key = _uuid_or_none(entity_id)
    if not key:
        return None
    note = db.query(PurchaseDebitNote).filter(PurchaseDebitNote.id == key, PurchaseDebitNote.plant_id == str(plant_id)).first()
    if not note:
        return None
    return EntityRef(label=f"Debit note {note.debit_note_no}", href=f"/purchase/debit-notes?note={note.id}",
                     search=[note.debit_note_no, note.supplier_name_snapshot or ""])


def _resolve_po(db: Session, plant_id: str, entity_id: str) -> Optional[EntityRef]:
    from ..models import PurchaseOrder
    key = _uuid_or_none(entity_id)
    if not key:
        return None
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == key, PurchaseOrder.plant_id == str(plant_id)).first()
    if not order:
        return None
    return EntityRef(label=f"PO {order.po_no}", href=f"/purchase/{order.id}", search=[order.po_no])


def _resolve_dispatch(db: Session, plant_id: str, entity_id: str) -> Optional[EntityRef]:
    return EntityRef(label=f"Dispatch {entity_id}", href="/logistics/dispatch", search=[entity_id])


for _type, _fn in (("GRN", _resolve_grn), ("REEL", _resolve_reel), ("BATCH", _resolve_batch),
                   ("DEBIT_NOTE", _resolve_debit_note), ("PO", _resolve_po), ("DISPATCH", _resolve_dispatch)):
    register_entity_resolver(_type, _fn)


def resolve_entity(db: Session, plant_id: str, entity_type: str, entity_id: str) -> EntityRef:
    entity_type = str(entity_type or "").strip().upper()
    if entity_type not in LINK_ENTITY_TYPES:
        raise HTTPException(status_code=422, detail=f"A document cannot be linked to {entity_type or 'nothing'}.")
    resolver = _RESOLVERS.get(entity_type)
    if not resolver:
        return EntityRef(label=f"{entity_type.replace('_', ' ').title()} {entity_id}", search=[str(entity_id)])
    ref = resolver(db, str(plant_id), str(entity_id))
    if ref is None:
        raise HTTPException(status_code=404, detail=f"That {entity_type.replace('_', ' ').lower()} is not in this plant. Open it from its own page and try again.")
    return ref


# ── History ────────────────────────────────────────────────────────────────────────────────────
def _event(db: Session, document: Document, action: str, actor: str, **detail: Any) -> None:
    db.add(DocumentEvent(document_id=document.id, plant_id=document.plant_id, action=action, actor=actor,
                         at=datetime.utcnow(), detail={k: v for k, v in detail.items() if v is not None}))


def _refresh_search(document: Document, extra: Iterable[str] = ()) -> None:
    words = [document.doc_no, document.ref_no or "", document.party_name or "", document.category or "",
             KIND_WORDS.get(document.kind, document.kind)]
    for link in document.links or []:
        words.append(link.entity_label or "")
    words.extend(extra)
    seen: list[str] = []
    for word in words:
        word = str(word or "").strip()
        if word and word.lower() not in {w.lower() for w in seen}:
            seen.append(word)
    document.search_text = " · ".join(seen)[:4000]


def _clean_kind(kind: Optional[str]) -> str:
    value = str(kind or "OTHER").strip().upper()
    if value not in DOCUMENT_KINDS:
        raise HTTPException(status_code=422, detail=f"Pick a document type: {', '.join(KIND_WORDS.values())}.")
    return value


def _clean_source(source: Optional[str], kind: str) -> str:
    value = str(source or KIND_SOURCES.get(kind, "STORE")).strip().upper()
    if value not in DOCUMENT_SOURCES:
        raise HTTPException(status_code=422, detail="Unknown document source.")
    return value


# ── Create, pages, links ───────────────────────────────────────────────────────────────────────
def create_document(
    db: Session,
    *,
    plant_id: str,
    data: bytes,
    filename: Optional[str],
    kind: str,
    actor: str,
    source: Optional[str] = None,
    category: Optional[str] = None,
    party_type: Optional[str] = None,
    party_id: Optional[str] = None,
    party_name: Optional[str] = None,
    ref_no: Optional[str] = None,
    ref_date: Optional[date] = None,
    amount: Optional[Decimal] = None,
    note: Optional[str] = None,
    request_id: Optional[uuid.UUID] = None,
    link: Optional[tuple[str, str]] = None,
    dedupe: bool = True,
) -> tuple[Document, bool]:
    """Save one file as a new document (page 1). Returns (document, created).

    created is False when the same request_id was seen before, or when the same file is already an
    active document of this plant (then ``link`` is still added to that document)."""
    plant_id = str(plant_id)
    kind = _clean_kind(kind)
    source = _clean_source(source, kind)
    if request_id:
        existing = db.query(Document).filter(Document.plant_id == plant_id, Document.request_id == request_id).first()
        if existing:
            return existing, False
    prepared = prepare_file(data, filename)
    link_ref = resolve_entity(db, plant_id, link[0], link[1]) if link else None
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"doc-sha:{plant_id}:{prepared.sha256}"})
    if dedupe:
        same = (db.query(Document).join(DocumentPage, DocumentPage.document_id == Document.id)
                .filter(DocumentPage.plant_id == plant_id, DocumentPage.sha256 == prepared.sha256, Document.status == "ACTIVE")
                .first())
        if same:
            if link:
                link_document(db, same, link[0], link[1], actor, ref=link_ref)
            return same, False
    now = datetime.utcnow()
    doc_id = uuid.uuid4()
    backend, key, thumb_key = _store(plant_id, doc_id, 1, prepared, now)
    document = Document(
        id=doc_id, plant_id=plant_id, doc_no=next_doc_no(db, plant_id, now), request_id=request_id, kind=kind,
        category=(category or None), party_type=(party_type or None), party_id=(str(party_id) if party_id else None),
        party_name=(party_name or None), ref_no=(ref_no or None), ref_date=ref_date,
        amount=(Decimal(str(amount)) if amount is not None else None), note=(note or None), pages=1,
        storage_key=key, thumb_key=thumb_key, mime=prepared.mime, bytes=len(prepared.data), sha256=prepared.sha256,
        source=source, uploaded_by=actor, uploaded_at=now, status="ACTIVE", version=1, search_text="",
    )
    db.add(document)
    db.add(DocumentPage(document_id=doc_id, plant_id=plant_id, page_no=1, request_id=request_id, storage_backend=backend,
                        storage_key=key, thumb_key=thumb_key, mime=prepared.mime, bytes=len(prepared.data),
                        sha256=prepared.sha256, width=prepared.width, height=prepared.height, pdf_pages=prepared.pdf_pages,
                        original_name=(filename or None) and str(filename)[:200], uploaded_by=actor, uploaded_at=now))
    db.flush()
    _event(db, document, "UPLOAD", actor, kind=kind, source=source, bytes=len(prepared.data),
           original_bytes=prepared.original_bytes, file=(filename or None))
    if link:
        link_document(db, document, link[0], link[1], actor, ref=link_ref)
    else:
        _refresh_search(document)
    db.flush()
    return document, True


def attach_page(
    db: Session,
    document: Document,
    *,
    data: bytes,
    filename: Optional[str],
    actor: str,
    request_id: Optional[uuid.UUID] = None,
) -> tuple[DocumentPage, bool]:
    """Add one more page (photo or PDF) to a document. Returns (page, created)."""
    if request_id:
        replay = db.query(DocumentPage).filter(DocumentPage.document_id == document.id, DocumentPage.request_id == request_id).first()
        if replay:
            return replay, False
    if document.status != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"{document.doc_no} is void; pages cannot be added.")
    prepared = prepare_file(data, filename)
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"doc-sha:{document.plant_id}:{prepared.sha256}"})
    locked = db.query(Document).filter(Document.id == document.id).with_for_update().populate_existing().one()
    same = (db.query(DocumentPage, Document.doc_no).join(Document, Document.id == DocumentPage.document_id)
            .filter(DocumentPage.plant_id == locked.plant_id, DocumentPage.sha256 == prepared.sha256, Document.status == "ACTIVE")
            .first())
    if same:
        page, doc_no = same
        if page.document_id == locked.id:
            return page, False
        raise HTTPException(status_code=409, detail=f"This file is already saved as {doc_no}. Open that document instead.")
    if int(locked.pages or 0) >= MAX_PAGES:
        raise HTTPException(status_code=409, detail=f"A document can have at most {MAX_PAGES} pages. Save the rest as a new document.")
    last = db.query(DocumentPage.page_no).filter(DocumentPage.document_id == locked.id).order_by(DocumentPage.page_no.desc()).first()
    page_no = int(last[0]) + 1 if last else 1
    now = datetime.utcnow()
    backend, key, thumb_key = _store(locked.plant_id, locked.id, page_no, prepared, now)
    page = DocumentPage(document_id=locked.id, plant_id=locked.plant_id, page_no=page_no, request_id=request_id,
                        storage_backend=backend, storage_key=key, thumb_key=thumb_key, mime=prepared.mime,
                        bytes=len(prepared.data), sha256=prepared.sha256, width=prepared.width, height=prepared.height,
                        pdf_pages=prepared.pdf_pages, original_name=(filename or None) and str(filename)[:200],
                        uploaded_by=actor, uploaded_at=now)
    db.add(page)
    locked.pages = page_no
    locked.version = int(locked.version or 1) + 1
    _event(db, locked, "ADD_PAGE", actor, page_no=page_no, bytes=len(prepared.data), file=(filename or None))
    db.flush()
    return page, True


def get_document(db: Session, document_id: Any, plant_ids: Iterable[str], *, for_update: bool = False) -> Document:
    key = document_id if isinstance(document_id, uuid.UUID) else _uuid_or_none(document_id)
    if not key:
        raise HTTPException(status_code=404, detail="Document not found")
    query = db.query(Document).filter(Document.id == key, Document.plant_id.in_([str(p) for p in plant_ids]))
    if for_update:
        query = query.with_for_update()
    document = query.first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


def link_document(
    db: Session,
    document: Any,
    entity_type: str,
    entity_id: Any,
    actor: str,
    *,
    plant_id: Optional[str] = None,
    ref: Optional[EntityRef] = None,
) -> tuple[DocumentLink, bool]:
    """Tie a document to a record. Same document + type + id twice returns the first link (created False)."""
    if not isinstance(document, Document):
        document = get_document(db, document, [plant_id] if plant_id else [])
    if plant_id and str(document.plant_id) != str(plant_id):
        raise HTTPException(status_code=404, detail="Document not found")
    entity_type = str(entity_type or "").strip().upper()
    entity_id = str(entity_id or "").strip()
    if not entity_id:
        raise HTTPException(status_code=422, detail="Say which record the document belongs to.")
    existing = db.query(DocumentLink).filter(DocumentLink.document_id == document.id, DocumentLink.entity_type == entity_type,
                                             DocumentLink.entity_id == entity_id).first()
    if existing:
        return existing, False
    if document.status != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"{document.doc_no} is void; it cannot be linked.")
    ref = ref or resolve_entity(db, document.plant_id, entity_type, entity_id)
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"doc-link:{document.id}:{entity_type}:{entity_id}"})
    existing = db.query(DocumentLink).filter(DocumentLink.document_id == document.id, DocumentLink.entity_type == entity_type,
                                             DocumentLink.entity_id == entity_id).first()
    if existing:
        return existing, False
    link = DocumentLink(document_id=document.id, plant_id=document.plant_id, entity_type=entity_type, entity_id=entity_id,
                        entity_label=ref.label[:200], linked_by=actor, linked_at=datetime.utcnow())
    db.add(link)
    db.flush()
    db.refresh(document, attribute_names=["links"])
    _refresh_search(document, ref.search)
    document.version = int(document.version or 1) + 1
    _event(db, document, "LINK", actor, entity_type=entity_type, entity_id=entity_id, label=ref.label)
    return link, True


def unlink_document(db: Session, document: Document, entity_type: str, entity_id: Any, actor: str) -> bool:
    """Remove a link (Owner/Admin only, checked by the caller). The removal is kept in the history."""
    entity_type = str(entity_type or "").strip().upper()
    link = db.query(DocumentLink).filter(DocumentLink.document_id == document.id, DocumentLink.entity_type == entity_type,
                                         DocumentLink.entity_id == str(entity_id)).first()
    if not link:
        return False
    label = link.entity_label
    db.delete(link)
    db.flush()
    db.refresh(document, attribute_names=["links"])
    _refresh_search(document)
    document.version = int(document.version or 1) + 1
    _event(db, document, "UNLINK", actor, entity_type=entity_type, entity_id=str(entity_id), label=label)
    return True


def void_document(db: Session, document: Document, *, reason: Any, actor: str, expected_version: Optional[int] = None) -> Document:
    """Mark void with a DOC_VOID reason (a ReasonChoice). The file and links stay. Voiding twice is a no-op."""
    if document.status == "VOID":
        return document
    if expected_version is not None and int(document.version) != int(expected_version):
        raise HTTPException(status_code=409, detail=f"{document.doc_no} changed since you opened it. Reload and try again.")
    document.status = "VOID"
    document.void_reason, document.void_reason_code = reason.text, reason.code
    document.void_reason_label, document.void_reason_note = reason.label, reason.note
    document.voided_by, document.voided_at = actor, datetime.utcnow()
    document.version = int(document.version or 1) + 1
    _event(db, document, "VOID", actor, reason_code=reason.code, reason=reason.text)
    db.flush()
    return document


def update_document(db: Session, document: Document, *, changes: dict[str, Any], actor: str, expected_version: int,
                    access: Optional[DocumentAccess] = None) -> Document:
    """Correct the type, party, number, date, amount or note (e.g. the watchman tapped the wrong type)."""
    if document.status != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"{document.doc_no} is void and cannot be changed.")
    if int(document.version) != int(expected_version):
        raise HTTPException(status_code=409, detail=f"{document.doc_no} changed since you opened it. Reload and try again.")
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for name in EDITABLE_FIELDS:
        if name not in changes:
            continue
        value = changes[name]
        if name == "kind":
            value = _clean_kind(value)
            if access and not access.may_upload(value):
                raise HTTPException(status_code=403, detail="You cannot file documents of that type.")
        elif name == "amount":
            value = Decimal(str(value)) if value not in (None, "") else None
        elif isinstance(value, str):
            value = value.strip() or None
        old = getattr(document, name)
        if old != value:
            before[name] = None if old is None else str(old)
            after[name] = None if value is None else str(value)
            setattr(document, name, value)
    if after:
        _refresh_search(document)
        document.version = int(document.version or 1) + 1
        _event(db, document, "EDIT", actor, before=before, after=after)
        db.flush()
    return document


def documents_for(db: Session, plant_id: str, entity_type: str, entity_id: Any, *, include_void: bool = False,
                  access: Optional[DocumentAccess] = None) -> list[Document]:
    """Every document linked to one record, newest first."""
    query = (db.query(Document).join(DocumentLink, DocumentLink.document_id == Document.id)
             .filter(Document.plant_id == str(plant_id), DocumentLink.entity_type == str(entity_type).upper(),
                     DocumentLink.entity_id == str(entity_id)))
    if not include_void:
        query = query.filter(Document.status == "ACTIVE")
    if access is not None:
        query = visible_filter(query, access)
    return query.order_by(Document.uploaded_at.desc()).all()


def save_system_pdf(
    db: Session,
    *,
    plant_id: str,
    kind: str,
    pdf_bytes: bytes,
    filename: str,
    entity_type: str,
    entity_id: Any,
    actor: str,
    ref_no: Optional[str] = None,
    ref_date: Optional[date] = None,
    amount: Optional[Decimal] = None,
    party_type: Optional[str] = None,
    party_id: Optional[str] = None,
    party_name: Optional[str] = None,
    category: Optional[str] = None,
) -> Document:
    """Keep a frozen copy of a PDF the system made (issued debit note, PO, GRN). Idempotent per record:
    if an active SYSTEM document of this kind is already linked to the record, that one is returned."""
    existing = [doc for doc in documents_for(db, plant_id, entity_type, entity_id) if doc.source == "SYSTEM" and doc.kind == kind]
    if existing:
        return existing[0]
    document, _ = create_document(
        db, plant_id=plant_id, data=pdf_bytes, filename=filename, kind=kind, actor=actor, source="SYSTEM",
        category=category, party_type=party_type, party_id=party_id, party_name=party_name, ref_no=ref_no,
        ref_date=ref_date, amount=amount, link=(entity_type, str(entity_id)), dedupe=False,
    )
    return document


def snapshot_debit_note(db: Session, note: Any, *, actor: str, describe: Callable[[Any], dict[str, Any]]) -> Optional[Document]:
    """Save the issued debit note's PDF as a SYSTEM DEBIT_NOTE document linked to the note.

    Called from the ISSUE action. Never blocks the issue: on any failure it logs, rolls back only its
    own savepoint and returns None (the note's PDF can still be printed from the register)."""
    from ..models import PurchaseDiscrepancy
    from .procurement_documents import render_debit_note_pdf

    savepoint = db.begin_nested()
    try:
        rows = []
        for line in note.lines or []:
            row = db.query(PurchaseDiscrepancy).filter(PurchaseDiscrepancy.id == line.discrepancy_id).first()
            if row:
                rows.append(describe(row))
        pdf = render_debit_note_pdf(note, rows)
        document = save_system_pdf(
            db, plant_id=note.plant_id, kind="DEBIT_NOTE", pdf_bytes=pdf,
            filename=f"{str(note.debit_note_no).replace('/', '-')}.pdf", entity_type="DEBIT_NOTE", entity_id=note.id,
            actor=actor, ref_no=note.debit_note_no, ref_date=note.note_date, amount=note.total_amount,
            party_type="SUPPLIER", party_id=str(note.supplier_id), party_name=note.supplier_name_snapshot,
        )
        savepoint.commit()
        return document
    except Exception as exc:  # the issue must not fail because the copy could not be kept
        savepoint.rollback()
        log.error("Doc Vault: could not keep the issued debit note %s: %s", getattr(note, "debit_note_no", "?"), exc)
        return None


# ── Reading files ──────────────────────────────────────────────────────────────────────────────
def page_of(db: Session, document: Document, page_no: int = 1) -> DocumentPage:
    page = db.query(DocumentPage).filter(DocumentPage.document_id == document.id, DocumentPage.page_no == int(page_no)).first()
    if not page:
        raise HTTPException(status_code=404, detail=f"{document.doc_no} has no page {page_no}.")
    return page


def open_page_file(page: DocumentPage, *, thumb: bool = False):
    """(storage, key, mime) for a page or its thumbnail; raises 404 when the file is not there."""
    key = page.thumb_key if thumb else page.storage_key
    if not key:
        raise HTTPException(status_code=404, detail="This page has no preview.")
    storage = get_storage(page.storage_backend)
    return storage, key, ("image/jpeg" if thumb else page.mime)


def read_page_bytes(page: DocumentPage, *, thumb: bool = False) -> bytes:
    storage, key, _ = open_page_file(page, thumb=thumb)
    try:
        return storage.get(key)
    except StorageObjectMissing as exc:
        raise HTTPException(status_code=404, detail="The file of this page is missing from storage. Ask the Admin to restore it.") from exc
    except StorageUnavailable as exc:
        raise HTTPException(status_code=503, detail="Document storage is not reachable right now. Try again.") from exc


# ── API shape ──────────────────────────────────────────────────────────────────────────────────
def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def document_payload(db: Session, document: Document, *, access: Optional[DocumentAccess] = None, detail: bool = False) -> dict[str, Any]:
    base = f"/api/documents/{document.id}"
    payload: dict[str, Any] = {
        "id": str(document.id), "plant_id": document.plant_id, "doc_no": document.doc_no, "kind": document.kind,
        "kind_label": KIND_WORDS.get(document.kind, document.kind), "category": document.category,
        "party_type": document.party_type, "party_id": document.party_id, "party_name": document.party_name,
        "ref_no": document.ref_no, "ref_date": document.ref_date.isoformat() if document.ref_date else None,
        "amount": float(document.amount) if document.amount is not None else None, "note": document.note,
        "pages": int(document.pages or 1), "mime": document.mime, "bytes": int(document.bytes or 0),
        "source": document.source, "uploaded_by": document.uploaded_by, "uploaded_at": _iso(document.uploaded_at),
        "status": document.status, "void_reason": document.void_reason, "void_reason_code": document.void_reason_code,
        "voided_by": document.voided_by, "voided_at": _iso(document.voided_at), "version": int(document.version or 1),
        "file_url": f"{base}/file?page=1", "thumb_url": f"{base}/thumb?page=1" if document.thumb_key else None,
        "links": [
            {"entity_type": link.entity_type, "entity_id": link.entity_id, "label": link.entity_label,
             "href": _link_href(link), "linked_by": link.linked_by, "linked_at": _iso(link.linked_at)}
            for link in sorted(document.links or [], key=lambda row: row.linked_at or datetime.min)
        ],
    }
    if access is not None:
        payload["can"] = {"void": access.can_void and document.status == "ACTIVE", "unlink": access.can_unlink,
                          "edit": access.can_edit and document.status == "ACTIVE", "add_page": document.status == "ACTIVE"
                          and (access.kinds is None or document.kind in (access.kinds or ()) or document.uploaded_by == access.actor)}
    if detail:
        pages = db.query(DocumentPage).filter(DocumentPage.document_id == document.id).order_by(DocumentPage.page_no).all()
        payload["page_list"] = [
            {"page_no": page.page_no, "mime": page.mime, "bytes": int(page.bytes or 0), "width": page.width, "height": page.height,
             "pdf_pages": page.pdf_pages, "file_url": f"{base}/file?page={page.page_no}",
             "thumb_url": f"{base}/thumb?page={page.page_no}" if page.thumb_key else None,
             "uploaded_by": page.uploaded_by, "uploaded_at": _iso(page.uploaded_at)}
            for page in pages
        ]
    return payload


_HREFS = {"GRN": "/purchase/receipts/{id}", "REEL": "/inventory/genealogy?reel={id}", "DEBIT_NOTE": "/purchase/debit-notes?note={id}",
          "PO": "/purchase/{id}", "DISPATCH": "/logistics/dispatch", "GATE_ENTRY": "/gate?entry={id}", "VISIT": "/gate?visit={id}"}


def _link_href(link: DocumentLink) -> Optional[str]:
    template = _HREFS.get(link.entity_type)
    return template.format(id=link.entity_id) if template else None


def history_payload(db: Session, document: Document) -> list[dict[str, Any]]:
    rows = db.query(DocumentEvent).filter(DocumentEvent.document_id == document.id).order_by(DocumentEvent.at.asc()).all()
    return [{"action": row.action, "actor": row.actor, "at": _iso(row.at), "detail": row.detail or {}} for row in rows]


def unlinked_material_filter(query):
    """Material bills and challans not tied to any GRN yet (the vault's Unlinked tab)."""
    linked = db_exists_link("GRN")
    return query.filter(Document.kind.in_(sorted(MATERIAL_KINDS)), ~linked)


def db_exists_link(entity_type: Optional[str] = None):
    from sqlalchemy import exists, and_
    condition = DocumentLink.document_id == Document.id
    if entity_type:
        condition = and_(condition, DocumentLink.entity_type == entity_type)
    return exists().where(condition)


def today_window(days: int = 1) -> tuple[datetime, datetime]:
    start = plant_today_start_utc()
    return start, start + timedelta(days=days)
