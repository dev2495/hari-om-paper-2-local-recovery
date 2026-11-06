"""Doc Vault tables (6 Nov 2026): every bill, challan, photo and system PDF the plant keeps.

A document is one paper thing (a vendor bill, our challan, a visitor photo). It can have several
pages: a bill photographed as two photos is ONE document with two ``document_pages`` rows. Files
live in the storage backend (``services/doc_storage.py``); the rows keep the keys, size and sha256.

Nothing is ever deleted. Owner or Admin can void a document with a DOC_VOID reason code; the file
stays and every upload, link, unlink, edit and void is written to ``document_events``.

Links tie a document to the records it belongs to (GRN, reel, gate entry, dispatch, debit note …).
``entity_id`` is text so references such as a dispatch_ref fit as well as UUIDs.

Imported by ``models.py`` so ``Base.metadata.create_all`` at startup creates the tables on live.
Alembic: ``014_doc_vault``.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from .database import Base

DOCUMENT_KINDS = (
    "VENDOR_BILL",
    "VENDOR_CHALLAN",
    "EXPENSE_BILL",
    "TALLY_BILL",
    "OUR_CHALLAN",
    "DEBIT_NOTE",
    "VISITOR_PHOTO",
    "OTHER",
)
DOCUMENT_SOURCES = ("GATE", "STORE", "QC", "DISPATCH", "SYSTEM")
DOCUMENT_STATUSES = ("ACTIVE", "VOID")
LINK_ENTITY_TYPES = (
    "GRN",
    "REEL",
    "BATCH",
    "GATE_ENTRY",
    "VISIT",
    "DISPATCH",
    "DEBIT_NOTE",
    "PO",
    "WEIGHT_VARIANCE",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ",".join(f"'{value}'" for value in values) + ")"


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plant_id = Column(String(50), nullable=False, index=True)
    doc_no = Column(String(30), nullable=False)
    # The uploader's request key: a retried upload (weak gate network) returns the same document.
    request_id = Column(UUID(as_uuid=True), nullable=True)
    kind = Column(String(20), nullable=False, default="OTHER")
    category = Column(String(60), nullable=True)
    party_type = Column(String(20), nullable=True)  # SUPPLIER, CUSTOMER, VISITOR, OTHER
    party_id = Column(String(64), nullable=True)
    party_name = Column(String(200), nullable=True)
    ref_no = Column(String(120), nullable=True)
    ref_date = Column(Date, nullable=True)
    amount = Column(Numeric(18, 2), nullable=True)
    note = Column(Text, nullable=True)
    pages = Column(Integer, nullable=False, default=1)
    # Page 1 (the cover), repeated here so lists need no join.
    storage_key = Column(String(300), nullable=False)
    thumb_key = Column(String(300), nullable=True)
    mime = Column(String(60), nullable=False)
    bytes = Column(Integer, nullable=False, default=0)
    sha256 = Column(String(64), nullable=False)
    source = Column(String(20), nullable=False, default="STORE")
    uploaded_by = Column(String(200), nullable=False)
    uploaded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    status = Column(String(10), nullable=False, default="ACTIVE")
    void_reason = Column(Text, nullable=True)
    void_reason_code = Column(String(80), nullable=True)
    void_reason_label = Column(String(200), nullable=True)
    void_reason_note = Column(Text, nullable=True)
    voided_by = Column(String(200), nullable=True)
    voided_at = Column(DateTime, nullable=True)
    # doc_no, ref_no, party and the labels of linked records (GRN no., AIT no., challan) for the vault search.
    search_text = Column(Text, nullable=False, default="")
    version = Column(Integer, nullable=False, default=1)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    page_rows = relationship("DocumentPage", back_populates="document", order_by="DocumentPage.page_no",
                             cascade="save-update, merge")
    links = relationship("DocumentLink", back_populates="document", cascade="save-update, merge")

    __table_args__ = (
        UniqueConstraint("plant_id", "doc_no", name="uq_documents_plant_doc_no"),
        UniqueConstraint("plant_id", "request_id", name="uq_documents_plant_request"),
        CheckConstraint(_in("kind", DOCUMENT_KINDS), name="ck_documents_kind"),
        CheckConstraint(_in("source", DOCUMENT_SOURCES), name="ck_documents_source"),
        CheckConstraint(_in("status", DOCUMENT_STATUSES), name="ck_documents_status"),
        CheckConstraint("pages > 0", name="ck_documents_pages_positive"),
        Index("ix_documents_plant_uploaded", "plant_id", "uploaded_at"),
        Index("ix_documents_plant_sha", "plant_id", "sha256"),
    )


class DocumentPage(Base):
    """One file of a document (page 1 is the cover)."""
    __tablename__ = "document_pages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False, index=True)
    plant_id = Column(String(50), nullable=False)
    page_no = Column(Integer, nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=True)
    storage_backend = Column(String(10), nullable=False, default="local")
    storage_key = Column(String(300), nullable=False)
    thumb_key = Column(String(300), nullable=True)
    mime = Column(String(60), nullable=False)
    bytes = Column(Integer, nullable=False, default=0)
    # sha256 of the file as uploaded (before any server re-compression), the dedupe key.
    sha256 = Column(String(64), nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    pdf_pages = Column(Integer, nullable=True)
    original_name = Column(String(200), nullable=True)
    uploaded_by = Column(String(200), nullable=False)
    uploaded_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    document = relationship("Document", back_populates="page_rows")

    __table_args__ = (
        UniqueConstraint("document_id", "page_no", name="uq_document_pages_doc_page"),
        UniqueConstraint("document_id", "request_id", name="uq_document_pages_doc_request"),
        Index("ix_document_pages_plant_sha", "plant_id", "sha256"),
        CheckConstraint("page_no > 0", name="ck_document_pages_page_positive"),
    )


class DocumentLink(Base):
    __tablename__ = "document_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False, index=True)
    plant_id = Column(String(50), nullable=False)
    entity_type = Column(String(20), nullable=False)
    entity_id = Column(String(100), nullable=False)
    # What the chip says ("GRN P/26/0318") at the time of linking.
    entity_label = Column(String(200), nullable=True)
    linked_by = Column(String(200), nullable=False)
    linked_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    document = relationship("Document", back_populates="links")

    __table_args__ = (
        UniqueConstraint("document_id", "entity_type", "entity_id", name="uq_document_links_doc_entity"),
        CheckConstraint(_in("entity_type", LINK_ENTITY_TYPES), name="ck_document_links_entity_type"),
        Index("ix_document_links_entity", "plant_id", "entity_type", "entity_id"),
    )


class DocumentEvent(Base):
    """Who uploaded, added a page, linked, unlinked, edited or voided a document, and when."""
    __tablename__ = "document_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False, index=True)
    plant_id = Column(String(50), nullable=False)
    action = Column(String(20), nullable=False)  # UPLOAD, ADD_PAGE, LINK, UNLINK, EDIT, VOID
    actor = Column(String(200), nullable=False)
    at = Column(DateTime, nullable=False, default=datetime.utcnow)
    detail = Column(JSONB, nullable=False, default=dict)
