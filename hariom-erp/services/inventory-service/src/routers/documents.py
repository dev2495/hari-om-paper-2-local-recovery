"""Doc Vault API (6 Nov 2026). BFF: /api/documents/* → here (/inventory/documents/*).

POST   /inventory/documents                      multipart upload (file + metadata [+ link]); dedupes per plant
POST   /inventory/documents/{id}/pages           multipart: one more page
GET    /inventory/documents                      search / list (filters below), newest first
GET    /inventory/documents/for/{type}/{id}      documents linked to one record (the DocumentsPanel)
GET    /inventory/documents/{id}                 one document with its pages, links and history
GET    /inventory/documents/{id}/file?page=N     the file (streamed, or a 5-minute S3 link when set up)
GET    /inventory/documents/{id}/thumb?page=N    the JPEG thumbnail
POST   /inventory/documents/{id}/links           link to a GRN, reel, gate entry …
DELETE /inventory/documents/{id}/links/{type}/{entity_id}   unlink (Owner/Admin; logged)
PATCH  /inventory/documents/{id}                 correct type / party / number / date / amount
POST   /inventory/documents/{id}/void            void with a DOC_VOID reason (Owner/Admin; never deleted)

The rules live in services/doc_vault.py so other code (Gate, dispatch) gets the same behaviour.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models_vault import LINK_ENTITY_TYPES, Document
from ..reasons import reason_input, resolve_reason, token_of
from ..services import doc_vault as vault
from ..services.doc_storage import StorageObjectMissing, StorageUnavailable
from ..utils.auth import authorized_plant_ids, get_current_plant, get_current_plant_scope, require_role

router = APIRouter(prefix="/inventory/documents", tags=["doc-vault"])
vault_user = require_role(list(vault.VAULT_ROLES))

TAB_FILTERS = {
    "VENDOR": ("VENDOR_BILL", "VENDOR_CHALLAN"),
    "EXPENSE": ("EXPENSE_BILL",),
    "OUTWARD": ("TALLY_BILL", "OUR_CHALLAN"),
}


def _access(current_user: dict) -> vault.DocumentAccess:
    access = vault.access_for(current_user)
    if not access.any_access:
        raise HTTPException(status_code=403, detail="Your role cannot open the Doc Vault.")
    return access


def _read_upload(file: UploadFile) -> bytes:
    data = file.file.read(vault.MAX_FILE_BYTES + 1)
    if len(data) > vault.MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 10 MB. Send a smaller photo or split the PDF.")
    return data


def _optional_uuid(value: Optional[str], what: str) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{what} is not a valid key.") from exc


def _optional_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Enter the document date as a date.") from exc


def _optional_amount(value: Optional[str]) -> Optional[Decimal]:
    if value in (None, ""):
        return None
    try:
        amount = Decimal(str(value).replace(",", ""))
    except InvalidOperation as exc:
        raise HTTPException(status_code=422, detail="Enter the amount as a number.") from exc
    if amount < 0 or amount > Decimal("999999999999"):
        raise HTTPException(status_code=422, detail="The amount must be zero or more.")
    return amount.quantize(Decimal("0.01"))


# What a login without edit rights (the watchman) may link its own uploads to.
GATE_DESK_LINKS = frozenset({"GATE_ENTRY", "VISIT"})


@router.post("")
def upload_document(
    file: UploadFile = File(...),
    kind: str = Form("OTHER"),
    source: Optional[str] = Form(None),
    category: Optional[str] = Form(None, max_length=60),
    party_type: Optional[str] = Form(None, max_length=20),
    party_id: Optional[str] = Form(None, max_length=64),
    party_name: Optional[str] = Form(None, max_length=200),
    ref_no: Optional[str] = Form(None, max_length=120),
    ref_date: Optional[str] = Form(None),
    amount: Optional[str] = Form(None),
    note: Optional[str] = Form(None, max_length=1000),
    request_id: Optional[str] = Form(None),
    link_entity_type: Optional[str] = Form(None),
    link_entity_id: Optional[str] = Form(None, max_length=100),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(vault_user),
):
    access = _access(current_user)
    kind_value = str(kind or "OTHER").strip().upper()
    if not access.may_upload(kind_value):
        raise HTTPException(status_code=403, detail=f"Your role cannot save a {vault.KIND_WORDS.get(kind_value, kind_value).lower()}.")
    if bool(link_entity_type) != bool(link_entity_id):
        raise HTTPException(status_code=422, detail="Say both the record type and the record to link the document to.")
    if link_entity_type and not access.can_edit and link_entity_type.strip().upper() not in GATE_DESK_LINKS:
        # The gate desk only photographs (owner rule, 8 Nov 2026): its photos go to its own gate entry or visit;
        # Store / Accounts link them to the GRN, the challan or the bill.
        raise HTTPException(status_code=403, detail="The gate desk saves photos on its own gate entry. Stores or Accounts link them to the record.")
    data = _read_upload(file)
    document, created = vault.create_document(
        db, plant_id=plant_id, data=data, filename=file.filename, kind=kind_value, actor=access.actor, source=source,
        category=category, party_type=party_type, party_id=party_id, party_name=party_name, ref_no=ref_no,
        ref_date=_optional_date(ref_date), amount=_optional_amount(amount), note=note,
        request_id=_optional_uuid(request_id, "request_id"),
        link=(link_entity_type.strip().upper(), link_entity_id.strip()) if link_entity_type and link_entity_id else None,
    )
    if not access.sees(document):
        if not created and link_entity_type and link_entity_id:
            # The same file is already in the vault (e.g. a watchman photographs a bill that was saved on an
            # earlier day). create_document linked that document to the record asked for (the gate entry), so
            # the record is not left without its photo; the uploader only learns the document number.
            db.commit()
            return {"created": False, "deduped": True, "linked": True,
                    "document": {"id": str(document.id), "doc_no": document.doc_no, "kind": document.kind,
                                 "kind_label": vault.KIND_WORDS.get(document.kind, document.kind)}}
        db.rollback()
        raise HTTPException(status_code=409, detail="This file is already saved in the Doc Vault. Ask the Store or Accounts to link it.")
    db.commit()
    db.refresh(document)
    return {"created": created, "deduped": not created, "document": vault.document_payload(db, document, access=access, detail=True)}


@router.post("/{document_id}/pages")
def add_page(
    document_id: str,
    file: UploadFile = File(...),
    request_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(vault_user),
):
    access = _access(current_user)
    document = vault.get_document(db, document_id, [plant_id])
    if not access.sees(document):
        raise HTTPException(status_code=404, detail="Document not found")
    if not (access.kinds is None or document.kind in (access.kinds or ()) or document.uploaded_by == access.actor):
        raise HTTPException(status_code=403, detail="Only the person who saved it, or the Store / Accounts, can add pages.")
    page, created = vault.attach_page(db, document, data=_read_upload(file), filename=file.filename, actor=access.actor,
                                      request_id=_optional_uuid(request_id, "request_id"))
    db.commit()
    db.refresh(document)
    return {"created": created, "page_no": page.page_no, "document": vault.document_payload(db, document, access=access, detail=True)}


@router.get("")
def list_documents(
    q: Optional[str] = Query(None, max_length=120),
    tab: str = Query("ALL", pattern="^(ALL|VENDOR|EXPENSE|OUTWARD|UNLINKED)$"),
    kind: Optional[str] = Query(None, description="Comma-separated kinds"),
    category: Optional[str] = Query(None, max_length=60),
    party: Optional[str] = Query(None, max_length=200),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    linked: Optional[bool] = Query(None),
    uploaded_by: Optional[str] = Query(None, max_length=200),
    source: Optional[str] = Query(None, max_length=20),
    status: str = Query("ACTIVE", pattern="^(ACTIVE|VOID|ALL)$"),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(vault_user),
):
    access = _access(current_user)
    plants = authorized_plant_ids(plant_scope)
    base = vault.visible_filter(db.query(Document).filter(Document.plant_id.in_(plants)), access)
    if status != "ALL":
        base = base.filter(Document.status == status)
    if kind:
        kinds = [value.strip().upper() for value in kind.split(",") if value.strip()]
        base = base.filter(Document.kind.in_(kinds))
    if category:
        base = base.filter(Document.category.ilike(category.strip()))
    if party:
        base = base.filter(or_(Document.party_name.ilike(f"%{party.strip()}%"), Document.party_id == party.strip()))
    if date_from:
        base = base.filter(func.coalesce(Document.ref_date, func.date(Document.uploaded_at)) >= date_from)
    if date_to:
        base = base.filter(func.coalesce(Document.ref_date, func.date(Document.uploaded_at)) <= date_to)
    if linked is not None:
        base = base.filter(vault.db_exists_link() if linked else ~vault.db_exists_link())
    if uploaded_by:
        base = base.filter(Document.uploaded_by.ilike(f"%{uploaded_by.strip()}%"))
    if source:
        base = base.filter(Document.source == source.strip().upper())
    if q and q.strip():
        words = [word for word in q.strip().split() if word][:6]
        for word in words:
            base = base.filter(Document.search_text.ilike(f"%{word}%"))
    counts = {"ALL": base.count()}
    for name, kinds in TAB_FILTERS.items():
        counts[name] = base.filter(Document.kind.in_(kinds)).count()
    counts["UNLINKED"] = vault.unlinked_material_filter(base).count()
    query = base
    if tab in TAB_FILTERS:
        query = query.filter(Document.kind.in_(TAB_FILTERS[tab]))
    elif tab == "UNLINKED":
        query = vault.unlinked_material_filter(query)
    total = query.count()
    rows = query.order_by(Document.uploaded_at.desc(), Document.doc_no.desc()).offset(offset).limit(limit).all()
    return {"items": [vault.document_payload(db, row, access=access) for row in rows], "total": total, "counts": counts,
            "limit": limit, "offset": offset,
            "can_upload": sorted(access.upload_kinds) if access.upload_kinds is not None else None}


@router.get("/for/{entity_type}/{entity_id}")
def documents_for_entity(
    entity_type: str,
    entity_id: str,
    include_void: bool = Query(False),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(vault_user),
):
    access = _access(current_user)
    entity = entity_type.strip().upper()
    if entity not in LINK_ENTITY_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown record type {entity_type}.")
    items = []
    for plant in authorized_plant_ids(plant_scope):
        items.extend(vault.documents_for(db, plant, entity, entity_id, include_void=include_void, access=access))
    return {"items": [vault.document_payload(db, row, access=access, detail=True) for row in items],
            "can_upload": sorted(access.upload_kinds) if access.upload_kinds is not None else None}


def _visible(db: Session, document_id: str, plant_scope: dict, current_user: dict) -> tuple[Document, vault.DocumentAccess]:
    access = _access(current_user)
    document = vault.get_document(db, document_id, authorized_plant_ids(plant_scope))
    if not access.sees(document):
        raise HTTPException(status_code=404, detail="Document not found")
    return document, access


@router.get("/{document_id}")
def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(vault_user),
):
    document, access = _visible(db, document_id, plant_scope, current_user)
    payload = vault.document_payload(db, document, access=access, detail=True)
    payload["history"] = vault.history_payload(db, document)
    return payload


@router.get("/{document_id}/history")
def document_history(
    document_id: str,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(vault_user),
):
    document, _ = _visible(db, document_id, plant_scope, current_user)
    return {"items": vault.history_payload(db, document)}


def _file_response(db: Session, document: Document, page_no: int, *, thumb: bool, download: bool):
    page = vault.page_of(db, document, page_no)
    storage, key, mime = vault.open_page_file(page, thumb=thumb)
    ext = "jpg" if thumb else key.rsplit(".", 1)[-1]
    filename = f"{document.doc_no}{'-thumb' if thumb else ''}{'' if page_no == 1 else f'-p{page_no}'}.{ext}"
    disposition = f'{"attachment" if download else "inline"}; filename="{filename}"'
    try:
        url = storage.presigned_get(key, filename=filename, content_type=mime)
        if url:
            return RedirectResponse(url, status_code=307, headers={"Cache-Control": "private, max-age=60"})
        chunks = storage.stream(key)
    except StorageObjectMissing as exc:
        raise HTTPException(status_code=404, detail="The file of this page is missing from storage. Ask the Admin to restore it.") from exc
    except StorageUnavailable as exc:
        raise HTTPException(status_code=503, detail="Document storage is not reachable right now. Try again.") from exc
    return StreamingResponse(chunks, media_type=mime, headers={
        "Content-Disposition": disposition, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff",
    })


@router.get("/{document_id}/file")
def document_file(
    document_id: str,
    page: int = Query(1, ge=1, le=vault.MAX_PAGES),
    download: bool = Query(False),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(vault_user),
):
    document, _ = _visible(db, document_id, plant_scope, current_user)
    return _file_response(db, document, page, thumb=False, download=download)


@router.get("/{document_id}/thumb")
def document_thumb(
    document_id: str,
    page: int = Query(1, ge=1, le=vault.MAX_PAGES),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(vault_user),
):
    document, _ = _visible(db, document_id, plant_scope, current_user)
    return _file_response(db, document, page, thumb=True, download=False)


class LinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entity_type: str = Field(min_length=2, max_length=20)
    entity_id: str = Field(min_length=1, max_length=100)


@router.post("/{document_id}/links")
def add_link(
    document_id: str,
    payload: LinkRequest,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(vault_user),
):
    access = _access(current_user)
    if not access.can_edit:
        raise HTTPException(status_code=403, detail="The gate desk only takes photos. Stores or Accounts link them to the record.")
    document = vault.get_document(db, document_id, [plant_id])
    if not access.sees(document):
        raise HTTPException(status_code=404, detail="Document not found")
    link, created = vault.link_document(db, document, payload.entity_type, payload.entity_id, access.actor)
    db.commit()
    db.refresh(document)
    return {"created": created, "document": vault.document_payload(db, document, access=access, detail=True)}


@router.delete("/{document_id}/links/{entity_type}/{entity_id}")
def remove_link(
    document_id: str,
    entity_type: str,
    entity_id: str,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin"])),
):
    access = _access(current_user)
    document = vault.get_document(db, document_id, [plant_id], for_update=True)
    removed = vault.unlink_document(db, document, entity_type, entity_id, access.actor)
    if not removed:
        raise HTTPException(status_code=404, detail="That link is not on this document.")
    db.commit()
    db.refresh(document)
    return {"removed": True, "document": vault.document_payload(db, document, access=access, detail=True)}


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(gt=0)
    kind: Optional[str] = Field(default=None, max_length=20)
    category: Optional[str] = Field(default=None, max_length=60)
    party_type: Optional[str] = Field(default=None, max_length=20)
    party_id: Optional[str] = Field(default=None, max_length=64)
    party_name: Optional[str] = Field(default=None, max_length=200)
    ref_no: Optional[str] = Field(default=None, max_length=120)
    ref_date: Optional[date] = None
    amount: Optional[Decimal] = Field(default=None, ge=0)
    note: Optional[str] = Field(default=None, max_length=1000)


@router.patch("/{document_id}")
def edit_document(
    document_id: str,
    payload: DocumentUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(vault_user),
):
    access = _access(current_user)
    if not access.can_edit:
        raise HTTPException(status_code=403, detail="Store or Accounts correct document details; ask them.")
    document = vault.get_document(db, document_id, [plant_id], for_update=True)
    if not access.sees(document):
        raise HTTPException(status_code=404, detail="Document not found")
    changes = payload.model_dump(exclude_unset=True)
    changes.pop("expected_version", None)
    vault.update_document(db, document, changes=changes, actor=access.actor, expected_version=payload.expected_version, access=access)
    db.commit()
    db.refresh(document)
    return vault.document_payload(db, document, access=access, detail=True)


class VoidRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: Optional[int] = Field(default=None, gt=0)
    reason_code: Optional[str] = Field(default=None, max_length=80)
    reason_note: Optional[str] = Field(default=None, max_length=1000)


@router.post("/{document_id}/void")
def void_document(
    document_id: str,
    payload: VoidRequest,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin"])),
):
    access = _access(current_user)
    document = vault.get_document(db, document_id, [plant_id], for_update=True)
    if document.status != "VOID":
        code, note = reason_input(payload)
        reason = resolve_reason(category="DOC_VOID", code=code, note=note, plant_id=plant_id,
                                token=token_of(current_user), what="voiding the document")
        vault.void_document(db, document, reason=reason, actor=access.actor, expected_version=payload.expected_version)
        db.commit()
        db.refresh(document)
    return vault.document_payload(db, document, access=access, detail=True)
