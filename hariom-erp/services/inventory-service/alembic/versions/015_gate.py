"""Gate module (6 Nov 2026): gates, gate entries (bills in, goods out), visitors and visits, the dispatch
gate-out record with the Tally bill number, gate settings per plant and the once-a-day notice log.

On live the service creates these tables itself at startup (Base.metadata.create_all in src/main.py);
this file creates the same tables for alembic-managed databases. Idempotent (IF NOT EXISTS). No existing
table changes: a GRN's gate link lives on gate_entries.receipt_id.
"""
from alembic import op

revision = "015_gate"
down_revision = "014_doc_vault"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE TABLE IF NOT EXISTS gates (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	code VARCHAR(20) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	direction VARCHAR(5) NOT NULL, 
	active BOOLEAN NOT NULL, 
	qr_token VARCHAR(64) NOT NULL, 
	token_rotated_at TIMESTAMP WITHOUT TIME ZONE, 
	token_rotated_by VARCHAR(200), 
	created_by VARCHAR(200) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	version INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_gates_plant_code UNIQUE (plant_id, code), 
	CONSTRAINT ck_gates_direction CHECK (direction IN ('IN','OUT','BOTH')), 
	UNIQUE (qr_token)
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gates_plant_id ON gates (plant_id)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS gate_entries (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	entry_no VARCHAR(30) NOT NULL, 
	request_id UUID, 
	gate_id UUID, 
	direction VARCHAR(5) NOT NULL, 
	kind VARCHAR(12) NOT NULL, 
	category_code VARCHAR(60), 
	category_label VARCHAR(200), 
	route VARCHAR(10) NOT NULL, 
	vehicle_no VARCHAR(30), 
	party_id VARCHAR(64), 
	party_text VARCHAR(200), 
	status VARCHAR(15) NOT NULL, 
	receipt_id UUID, 
	dispatch_ref VARCHAR(100), 
	bill_no VARCHAR(120), 
	bill_date DATE, 
	bill_amount NUMERIC(18, 2), 
	cost_head_code VARCHAR(60), 
	cost_head_label VARCHAR(200), 
	filed_by VARCHAR(200), 
	filed_at TIMESTAMP WITHOUT TIME ZONE, 
	linked_by VARCHAR(200), 
	linked_at TIMESTAMP WITHOUT TIME ZONE, 
	reminded_at TIMESTAMP WITHOUT TIME ZONE, 
	note TEXT, 
	history JSONB NOT NULL, 
	created_by VARCHAR(200) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	version INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_gate_entries_plant_no UNIQUE (plant_id, entry_no), 
	CONSTRAINT uq_gate_entries_plant_request UNIQUE (plant_id, request_id), 
	CONSTRAINT ck_gate_entries_kind CHECK (kind IN ('BILL_IN','GOODS_OUT')), 
	CONSTRAINT ck_gate_entries_route CHECK (route IN ('STORES','ACCOUNTS','DISPATCH')), 
	CONSTRAINT ck_gate_entries_status CHECK (status IN ('AT_GATE','WITH_STORES','WITH_ACCOUNTS','LINKED','FILED','OUT','VOID')), 
	CONSTRAINT ck_gate_entries_direction CHECK (direction IN ('IN','OUT'))
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_entries_plant_status ON gate_entries (plant_id, status)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_entries_receipt_id ON gate_entries (receipt_id)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_entries_plant_id ON gate_entries (plant_id)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_entries_plant_created ON gate_entries (plant_id, created_at)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_entries_gate_id ON gate_entries (gate_id)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_entries_dispatch_ref ON gate_entries (dispatch_ref)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS gate_visitors (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	mobile VARCHAR(10) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	company VARCHAR(160), 
	visits_count INTEGER NOT NULL, 
	last_visit_at TIMESTAMP WITHOUT TIME ZONE, 
	blocked BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_gate_visitors_plant_mobile UNIQUE (plant_id, mobile), 
	CONSTRAINT ck_gate_visitors_mobile CHECK (mobile ~ '^[6-9][0-9]{9}$')
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_visitors_plant_id ON gate_visitors (plant_id)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS gate_visits (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	visit_no VARCHAR(30) NOT NULL, 
	request_id UUID, 
	pass_token VARCHAR(64) NOT NULL, 
	gate_id UUID NOT NULL, 
	visitor_id UUID NOT NULL, 
	visitor_name VARCHAR(120) NOT NULL, 
	company VARCHAR(160), 
	purpose_code VARCHAR(60) NOT NULL, 
	purpose_label VARCHAR(200) NOT NULL, 
	purpose_note TEXT, 
	host_user_id VARCHAR(64), 
	host_name VARCHAR(160), 
	host_email VARCHAR(200), 
	host_department VARCHAR(40), 
	people INTEGER NOT NULL, 
	vehicle_no VARCHAR(30), 
	photo_doc_id UUID, 
	photo_purged_at TIMESTAMP WITHOUT TIME ZONE, 
	source VARCHAR(10) NOT NULL, 
	status VARCHAR(10) NOT NULL, 
	arrived_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	in_at TIMESTAMP WITHOUT TIME ZONE, 
	in_by VARCHAR(200), 
	out_at TIMESTAMP WITHOUT TIME ZONE, 
	out_by VARCHAR(200), 
	denied_by VARCHAR(200), 
	deny_code VARCHAR(60), 
	deny_label VARCHAR(200), 
	deny_note TEXT, 
	host_reply VARCHAR(15), 
	host_reply_by VARCHAR(200), 
	host_reply_at TIMESTAMP WITHOUT TIME ZONE, 
	created_by VARCHAR(200) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	version INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_gate_visits_plant_no UNIQUE (plant_id, visit_no), 
	CONSTRAINT uq_gate_visits_plant_request UNIQUE (plant_id, request_id), 
	CONSTRAINT ck_gate_visits_status CHECK (status IN ('ARRIVED','IN','OUT','DENIED','NO_SHOW')), 
	CONSTRAINT ck_gate_visits_reply CHECK (host_reply IS NULL OR host_reply IN ('SEND_IN','WAIT','NOT_AVAILABLE')), 
	CONSTRAINT ck_gate_visits_people CHECK (people BETWEEN 1 AND 50), 
	CONSTRAINT ck_gate_visits_source CHECK (source IN ('SELF','DESK')), 
	UNIQUE (pass_token)
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_visits_plant_status ON gate_visits (plant_id, status)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_visits_plant_arrived ON gate_visits (plant_id, arrived_at)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_visits_plant_id ON gate_visits (plant_id)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_visits_visitor_id ON gate_visits (visitor_id)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_gate_visits_gate_id ON gate_visits (gate_id)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS dispatch_gate_out (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	dispatch_ref VARCHAR(100) NOT NULL, 
	tally_bill_no VARCHAR(60), 
	tally_bill_date DATE, 
	tally_by VARCHAR(200), 
	tally_at TIMESTAMP WITHOUT TIME ZONE, 
	vehicle_no VARCHAR(30), 
	gate_entry_id UUID, 
	out_at TIMESTAMP WITHOUT TIME ZONE, 
	out_by VARCHAR(200), 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	version INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_dispatch_gate_out_plant_ref UNIQUE (plant_id, dispatch_ref), 
	CONSTRAINT uq_dispatch_gate_out_entry UNIQUE (gate_entry_id), 
	CONSTRAINT ck_dispatch_gate_out_complete CHECK (out_at IS NULL OR (tally_bill_no IS NOT NULL AND gate_entry_id IS NOT NULL))
)
""")
    op.execute("""
CREATE INDEX IF NOT EXISTS ix_dispatch_gate_out_plant_id ON dispatch_gate_out (plant_id)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS gate_plant_settings (
	plant_id VARCHAR(50) NOT NULL, 
	gate_close_time TIME WITHOUT TIME ZONE NOT NULL, 
	visitor_retention_days INTEGER NOT NULL, 
	updated_by VARCHAR(200), 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	version INTEGER NOT NULL, 
	PRIMARY KEY (plant_id), 
	CONSTRAINT ck_gate_settings_retention CHECK (visitor_retention_days BETWEEN 30 AND 3650)
)
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS gate_notice_log (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	kind VARCHAR(30) NOT NULL, 
	day DATE NOT NULL, 
	key VARCHAR(100) NOT NULL, 
	sent_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_gate_notice_log UNIQUE (plant_id, kind, day, key)
)
""")


def downgrade():
    raise RuntimeError("Gate registers are kept; forward recovery only")
