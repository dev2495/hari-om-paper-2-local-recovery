-- Additive procurement release: no historical quantities or physical forms are rewritten.
ALTER TYPE uom ADD VALUE IF NOT EXISTS 'L';
ALTER TABLE item_master ADD COLUMN IF NOT EXISTS density_kg_per_litre NUMERIC(12,6);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
	id UUID NOT NULL, 
	plant_id VARCHAR(50) NOT NULL, 
	pr_no VARCHAR(80) NOT NULL, 
	request_id UUID NOT NULL, 
	request_fingerprint VARCHAR(64) NOT NULL, 
	pr_date DATE NOT NULL, 
	item_id UUID NOT NULL, 
	item_name VARCHAR(200) NOT NULL, 
	quantity NUMERIC(18, 3) NOT NULL, 
	uom VARCHAR(12) NOT NULL, 
	reason TEXT NOT NULL, 
	requested_by VARCHAR(200) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	version INTEGER NOT NULL, 
	decided_by VARCHAR(200), 
	decided_at TIMESTAMP WITHOUT TIME ZONE, 
	decision_reason TEXT, 
	purchase_order_id UUID, 
	history JSONB NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_pr_plant_number UNIQUE (plant_id, pr_no), 
	CONSTRAINT uq_pr_plant_request UNIQUE (plant_id, request_id), 
	CONSTRAINT ck_pr_positive_quantity CHECK (quantity > 0), 
	CONSTRAINT ck_pr_status CHECK (status IN ('SUBMITTED','APPROVED','REJECTED','CONVERTED')), 
	FOREIGN KEY(item_id) REFERENCES item_master (id), 
	UNIQUE (purchase_order_id), 
	FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders (id)
)

;
CREATE INDEX IF NOT EXISTS ix_purchase_requisitions_plant_id ON purchase_requisitions (plant_id);
