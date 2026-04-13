"""initial_schema

Revision ID: 001
Revises: 
Create Date: 2025-01-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid
from datetime import datetime

revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # Create item_master table
    item_type_enum = sa.Enum('RAW_PAPER', 'ADHESIVE', 'PARCHMENT', 'FINISHED_GOOD', name='itemtype')
    uom_enum = sa.Enum('KG', 'PCS', name='uom')
    txn_type_enum = sa.Enum('INWARD', 'ISSUE_PRODUCTION', 'PRODUCTION_RETURN', 'FG_INWARD', 'DISPATCH', name='transactiontype')
    ref_type_enum = sa.Enum('PURCHASE', 'PRODUCTION_JOB', 'DISPATCH', name='referencetype')
    
    op.create_table(
        'item_master',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('item_code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('type', item_type_enum, nullable=False),
        sa.Column('uom', uom_enum, nullable=False),
        sa.Column('active', sa.Enum('true', 'false', name='boolean_enum'), default='true'),
        sa.Column('created_at', sa.DateTime, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('item_code')
    )
    
    # Create stock_batch table
    op.create_table(
        'stock_batch',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('item_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('batch_no', sa.String(100), nullable=False),
        sa.Column('received_qty', sa.Float, nullable=False),
        sa.Column('location', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['item_id'], ['item_master.id'])
    )
    
    # Create stock_transaction table
    op.create_table(
        'stock_transaction',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('item_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('batch_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('transaction_type', txn_type_enum, nullable=False),
        sa.Column('qty_change', sa.Float, nullable=False),
        sa.Column('reference_type', ref_type_enum, nullable=False),
        sa.Column('reference_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['item_id'], ['item_master.id']),
        sa.ForeignKeyConstraint(['batch_id'], ['stock_batch.id'])
    )
    
    # Insert seed data - Items from masterdata
    item_table = sa.table(
        'item_master',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('item_code', sa.String),
        sa.column('name', sa.String),
        sa.column('type', sa.Enum('RAW_PAPER', 'ADHESIVE', 'PARCHMENT', 'FINISHED_GOOD', name='itemtype')),
        sa.column('uom', sa.Enum('KG', 'PCS', name='uom')),
        sa.column('active', sa.Enum('true', 'false', name='boolean_enum')),
        sa.column('created_at', sa.DateTime)
    )
    
    # Papers
    paper_230_id = uuid.uuid4()
    paper_301_id = uuid.uuid4()
    paper_351_id = uuid.uuid4()
    
    # Adhesives
    adhesive_tl4_id = uuid.uuid4()
    adhesive_alcosol_id = uuid.uuid4()
    
    # FG
    fg_tube_id = uuid.uuid4()
    
    op.bulk_insert(
        item_table,
        [
            # Papers
            {
                "id": paper_230_id,
                "item_code": "PAPER-230",
                "name": "230 GSM Paper (18 BF)",
                "type": "RAW_PAPER",
                "uom": "KG",
                "active": "true",
                "created_at": datetime.utcnow()
            },
            {
                "id": paper_301_id,
                "item_code": "PAPER-301",
                "name": "301 GSM Paper (400 PB)",
                "type": "RAW_PAPER",
                "uom": "KG",
                "active": "true",
                "created_at": datetime.utcnow()
            },
            {
                "id": paper_351_id,
                "item_code": "PAPER-351",
                "name": "351 GSM Paper (400 PB)",
                "type": "RAW_PAPER",
                "uom": "KG",
                "active": "true",
                "created_at": datetime.utcnow()
            },
            # Adhesives
            {
                "id": adhesive_tl4_id,
                "item_code": "ADH-TL4",
                "name": "TL4 Adhesive (20100)",
                "type": "ADHESIVE",
                "uom": "KG",
                "active": "true",
                "created_at": datetime.utcnow()
            },
            {
                "id": adhesive_alcosol_id,
                "item_code": "ADH-ALC",
                "name": "Alcosol Adhesive (30100)",
                "type": "ADHESIVE",
                "uom": "KG",
                "active": "true",
                "created_at": datetime.utcnow()
            },
            # Finished Good
            {
                "id": fg_tube_id,
                "item_code": "FG-TUBE-110",
                "name": "Paper Tube 110x122x150",
                "type": "FINISHED_GOOD",
                "uom": "PCS",
                "active": "true",
                "created_at": datetime.utcnow()
            }
        ]
    )
    
    # Create sample batch and inward transaction
    batch_id = uuid.uuid4()
    batch_table = sa.table(
        'stock_batch',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('item_id', postgresql.UUID(as_uuid=True)),
        sa.column('batch_no', sa.String),
        sa.column('received_qty', sa.Float),
        sa.column('location', sa.String),
        sa.column('created_at', sa.DateTime)
    )
    
    op.bulk_insert(
        batch_table,
        [{
            "id": batch_id,
            "item_id": paper_230_id,
            "batch_no": "REEL-230-001",
            "received_qty": 500.0,
            "location": "Store A",
            "created_at": datetime.utcnow()
        }]
    )
    
    # Create inward transaction
    txn_table = sa.table(
        'stock_transaction',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('item_id', postgresql.UUID(as_uuid=True)),
        sa.column('batch_id', postgresql.UUID(as_uuid=True)),
        sa.column('transaction_type', sa.Enum('INWARD', 'ISSUE_PRODUCTION', 'PRODUCTION_RETURN', 'FG_INWARD', 'DISPATCH', name='transactiontype')),
        sa.column('qty_change', sa.Float),
        sa.column('reference_type', sa.Enum('PURCHASE', 'PRODUCTION_JOB', 'DISPATCH', name='referencetype')),
        sa.column('reference_id', postgresql.UUID(as_uuid=True)),
        sa.column('created_at', sa.DateTime)
    )
    
    op.bulk_insert(
        txn_table,
        [{
            "id": uuid.uuid4(),
            "item_id": paper_230_id,
            "batch_id": batch_id,
            "transaction_type": "INWARD",
            "qty_change": 500.0,
            "reference_type": "PURCHASE",
            "reference_id": uuid.uuid4(),
            "created_at": datetime.utcnow()
        }]
    )


def downgrade():
    op.drop_table('stock_transaction')
    op.drop_table('stock_batch')
    op.drop_table('item_master')
