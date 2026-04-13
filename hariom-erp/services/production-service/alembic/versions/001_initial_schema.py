"""initial_schema

Revision ID: 001
Revises: 
Create Date: 2025-01-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid
from datetime import date, datetime

revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # Create production_job table
    op.create_table(
        'production_job',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('date', sa.Date, nullable=False),
        sa.Column('shift', sa.String(20), nullable=False),
        sa.Column('spec_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('recipe_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('operator_name', sa.String(100), nullable=False),
        sa.Column('supervisor_name', sa.String(100), nullable=True),
        sa.Column('mandrel_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('total_reel_weight_issued', sa.Float, nullable=False),
        sa.Column('bamboo_produced_qty', sa.Integer, nullable=False, default=0),
        sa.Column('bamboo_scrap_qty', sa.Integer, nullable=False, default=0),
        sa.Column('bamboo_weight_total', sa.Float, nullable=False, default=0.0),
        sa.Column('oven_input_weight', sa.Float, nullable=False, default=0.0),
        sa.Column('oven_output_weight', sa.Float, nullable=False, default=0.0),
        sa.Column('tubes_produced_qty', sa.Integer, nullable=False, default=0),
        sa.Column('tube_scrap_qty', sa.Integer, nullable=False, default=0),
        sa.Column('finished_weight', sa.Float, nullable=False, default=0.0),
        sa.Column('actual_cs', sa.Float, nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create reel_issues table
    op.create_table(
        'reel_issues',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reel_barcode', sa.String(100), nullable=False),
        sa.Column('weight_used', sa.Float, nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['job_id'], ['production_job.id'])
    )
    
    # Insert sample job data
    job_id = uuid.uuid4()
    job_table = sa.table(
        'production_job',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('date', sa.Date),
        sa.column('shift', sa.String),
        sa.column('spec_id', postgresql.UUID(as_uuid=True)),
        sa.column('recipe_id', postgresql.UUID(as_uuid=True)),
        sa.column('operator_name', sa.String),
        sa.column('supervisor_name', sa.String),
        sa.column('mandrel_id', postgresql.UUID(as_uuid=True)),
        sa.column('total_reel_weight_issued', sa.Float),
        sa.column('bamboo_produced_qty', sa.Integer),
        sa.column('bamboo_scrap_qty', sa.Integer),
        sa.column('bamboo_weight_total', sa.Float),
        sa.column('oven_input_weight', sa.Float),
        sa.Column('oven_output_weight', sa.Float),
        sa.column('tubes_produced_qty', sa.Integer),
        sa.column('tube_scrap_qty', sa.Integer),
        sa.column('finished_weight', sa.Float),
        sa.column('actual_cs', sa.Float),
        sa.column('notes', sa.Text),
        sa.column('created_at', sa.DateTime)
    )
    
    op.bulk_insert(
        job_table,
        [{
            "id": job_id,
            "date": date.today(),
            "shift": "day",
            "spec_id": uuid.uuid4(),  # Would match spec-service
            "recipe_id": uuid.uuid4(),  # Would match spec-service
            "operator_name": "John Doe",
            "supervisor_name": "Jane Smith",
            "mandrel_id": uuid.uuid4(),  # Would match masterdata
            "total_reel_weight_issued": 1800.0,
            "bamboo_produced_qty": 120,
            "bamboo_scrap_qty": 2,
            "bamboo_weight_total": 1800.0,
            "oven_input_weight": 1780.0,
            "oven_output_weight": 1600.0,
            "tubes_produced_qty": 1000,
            "tube_scrap_qty": 10,
            "finished_weight": 1580.0,
            "actual_cs": 520.0,
            "notes": "Sample job for testing - normal production",
            "created_at": datetime.utcnow()
        }]
    )
    
    # Add sample reel issues
    reel_table = sa.table(
        'reel_issues',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('job_id', postgresql.UUID(as_uuid=True)),
        sa.column('reel_barcode', sa.String),
        sa.column('weight_used', sa.Float),
        sa.column('created_at', sa.DateTime)
    )
    
    op.bulk_insert(
        reel_table,
        [
            {
                "id": uuid.uuid4(),
                "job_id": job_id,
                "reel_barcode": "REEL001",
                "weight_used": 450.0,
                "created_at": datetime.utcnow()
            },
            {
                "id": uuid.uuid4(),
                "job_id": job_id,
                "reel_barcode": "REEL002",
                "weight_used": 450.0,
                "created_at": datetime.utcnow()
            },
            {
                "id": uuid.uuid4(),
                "job_id": job_id,
                "reel_barcode": "REEL003",
                "weight_used": 450.0,
                "created_at": datetime.utcnow()
            },
            {
                "id": uuid.uuid4(),
                "job_id": job_id,
                "reel_barcode": "REEL004",
                "weight_used": 450.0,
                "created_at": datetime.utcnow()
            }
        ]
    )


def downgrade():
    op.drop_table('reel_issues')
    op.drop_table('production_job')
