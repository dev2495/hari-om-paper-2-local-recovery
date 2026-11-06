"""Doc Vault (6 Nov 2026): documents, their pages, links to records and history.

On live the service creates these tables itself at startup (Base.metadata.create_all in src/main.py);
this file creates the same tables for alembic-managed databases. Idempotent (IF NOT EXISTS).
"""
from alembic import op

revision = "014_doc_vault"
down_revision = "013_incoming_bill_qc"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE TABLE IF NOT EXISTS documents (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	doc_no VARCHAR(30) NOT NULL, 
	request_id UUID, 
	kind VARCHAR(20) NOT NULL, 
	category VARCHAR(60), 
	party_type VARCHAR(20), 
	party_id VARCHAR(64), 
	party_name VARCHAR(200), 
	ref_no VARCHAR(120), 
	ref_date DATE, 
	amount NUMERIC(18, 2), 
	note TEXT, 
	pages INTEGER NOT NULL, 
	storage_key VARCHAR(300) NOT NULL, 
	thumb_key VARCHAR(300), 
	mime VARCHAR(60) NOT NULL, 
	bytes INTEGER NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	source VARCHAR(20) NOT NULL, 
	uploaded_by VARCHAR(200) NOT NULL, 
	uploaded_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	status VARCHAR(10) NOT NULL, 
	void_reason TEXT, 
	void_reason_code VARCHAR(80), 
	void_reason_label VARCHAR(200), 
	void_reason_note TEXT, 
	voided_by VARCHAR(200), 
	voided_at TIMESTAMP WITHOUT TIME ZONE, 
	search_text TEXT NOT NULL, 
	version INTEGER NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_documents_plant_doc_no UNIQUE (plant_id, doc_no), 
	CONSTRAINT uq_documents_plant_request UNIQUE (plant_id, request_id), 
	CONSTRAINT ck_documents_kind CHECK (kind IN ('VENDOR_BILL','VENDOR_CHALLAN','EXPENSE_BILL','TALLY_BILL','OUR_CHALLAN','DEBIT_NOTE','VISITOR_PHOTO','OTHER')), 
	CONSTRAINT ck_documents_source CHECK (source IN ('GATE','STORE','QC','DISPATCH','SYSTEM')), 
	CONSTRAINT ck_documents_status CHECK (status IN ('ACTIVE','VOID')), 
	CONSTRAINT ck_documents_pages_positive CHECK (pages > 0)
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_documents_plant_id ON documents (plant_id)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_documents_plant_uploaded ON documents (plant_id, uploaded_at)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_documents_plant_sha ON documents (plant_id, sha256)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS document_pages (
	id UUID NOT NULL, 
	document_id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	page_no INTEGER NOT NULL, 
	request_id UUID, 
	storage_backend VARCHAR(10) NOT NULL, 
	storage_key VARCHAR(300) NOT NULL, 
	thumb_key VARCHAR(300), 
	mime VARCHAR(60) NOT NULL, 
	bytes INTEGER NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	width INTEGER, 
	height INTEGER, 
	pdf_pages INTEGER, 
	original_name VARCHAR(200), 
	uploaded_by VARCHAR(200) NOT NULL, 
	uploaded_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_document_pages_doc_page UNIQUE (document_id, page_no), 
	CONSTRAINT uq_document_pages_doc_request UNIQUE (document_id, request_id), 
	CONSTRAINT ck_document_pages_page_positive CHECK (page_no > 0), 
	FOREIGN KEY(document_id) REFERENCES documents (id)
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_document_pages_plant_sha ON document_pages (plant_id, sha256)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_document_pages_document_id ON document_pages (document_id)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS document_links (
	id UUID NOT NULL, 
	document_id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	entity_type VARCHAR(20) NOT NULL, 
	entity_id VARCHAR(100) NOT NULL, 
	entity_label VARCHAR(200), 
	linked_by VARCHAR(200) NOT NULL, 
	linked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_document_links_doc_entity UNIQUE (document_id, entity_type, entity_id), 
	CONSTRAINT ck_document_links_entity_type CHECK (entity_type IN ('GRN','REEL','BATCH','GATE_ENTRY','VISIT','DISPATCH','DEBIT_NOTE','PO','WEIGHT_VARIANCE')), 
	FOREIGN KEY(document_id) REFERENCES documents (id)
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_document_links_document_id ON document_links (document_id)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_document_links_entity ON document_links (plant_id, entity_type, entity_id)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS document_events (
	id UUID NOT NULL, 
	document_id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	action VARCHAR(20) NOT NULL, 
	actor VARCHAR(200) NOT NULL, 
	at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	detail JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(document_id) REFERENCES documents (id)
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_document_events_document_id ON document_events (document_id)
""")


def downgrade():
    raise RuntimeError("Documents are never deleted; forward recovery only")
