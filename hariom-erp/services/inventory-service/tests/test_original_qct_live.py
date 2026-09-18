"""Original QCT-017..026 against isolated hariom_nverify inventory."""
from __future__ import annotations

import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified

URL = os.environ.get("HARI_OM_INVENTORY_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify inventory Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import (
    InventoryLocation,
    InventoryQualityInspection,
    ItemMaster,
    ItemType,
    StockBatch,
    StockTransaction,
    TrackingMode,
    UOM,
)
from src.quality_templates import PAPER_MANDATORY_KEYS, QC_TEMPLATE_PRESETS, RETURN_DEFECT_KEYS
from src.routers.items import (
    ItemQualityProfileApprove,
    ItemQualityProfileCopyTemplate,
    ItemQualityProfileUpdate,
    approve_item_quality_profile,
    copy_item_quality_template,
    upsert_item_quality_profile,
)
from src.routers.purchase import (
    GrnCreate,
    GrnLineCreate,
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
    approve_purchase_order,
    create_purchase_order,
    post_grn,
    retry_incoming_qc_tasks,
)
from src.routers.quality import QualityInspectionCreate, consume_destructive_sample, create_quality_inspection, list_quality_templates, DestructiveSampleConsume
from src.services.stock_calc import get_usable_item_qty

PLANT = "PLANT_A"
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def setup_module() -> None:
    from sqlalchemy import text

    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE IF EXISTS item_master DROP CONSTRAINT IF EXISTS item_master_item_code_key"))
        connection.execute(text("DROP INDEX IF EXISTS item_master_item_code_key"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_item_master_plant_code ON item_master (plant_id, item_code)"))
        for value in ("PACKAGING", "TOOL", "OTHER"):
            connection.execute(
                text(
                    "DO $$ BEGIN "
                    f"ALTER TYPE itemtype ADD VALUE IF NOT EXISTS '{value}'; "
                    "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
                )
            )
        connection.execute(text("ALTER TABLE IF EXISTS purchase_receipt_lines DROP CONSTRAINT IF EXISTS ck_purchase_receipt_lines_qc_status"))
        connection.execute(
            text(
                "ALTER TABLE IF EXISTS purchase_receipt_lines "
                "ADD CONSTRAINT ck_purchase_receipt_lines_qc_status "
                "CHECK (qc_status IN ('PENDING','PASS','HOLD','NOT_REQUIRED'))"
            )
        )
        connection.execute(text("ALTER TABLE IF EXISTS purchase_order_lines ADD COLUMN IF NOT EXISTS qty_rejected DOUBLE PRECISION DEFAULT 0"))
        for preset in QC_TEMPLATE_PRESETS:
            connection.execute(
                text(
                    "INSERT INTO inventory_quality_templates ("
                    "id, plant_id, material_type, parameter_key, label, input_type, options, required, sort_order, active, created_at"
                    ") VALUES ("
                    ":id, 'GLOBAL', :material_type, :parameter_key, :label, :input_type, CAST(:options AS JSON), :required, :sort_order, 'true', NOW()"
                    ") ON CONFLICT (plant_id, material_type, parameter_key) DO UPDATE SET "
                    "required = EXCLUDED.required, label = EXCLUDED.label, options = EXCLUDED.options, sort_order = EXCLUDED.sort_order, active = 'true'"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "material_type": preset["material_type"],
                    "parameter_key": preset["parameter_key"],
                    "label": preset["label"],
                    "input_type": preset["input_type"],
                    "options": __import__("json").dumps(preset.get("options") or []),
                    "required": bool(preset.get("required")),
                    "sort_order": preset.get("sort_order") or 0,
                },
            )


def _user(sub: str, roles=("Store",)) -> dict:
    return {"sub": sub, "actual_sub": sub, "roles": list(roles), "token": ""}


def _scope() -> dict:
    return {"scope_all": False, "selected_plant_id": PLANT, "allowed_plants": [PLANT]}


def _item(db, suffix: str, item_type: ItemType, uom=UOM.KG) -> ItemMaster:
    item = ItemMaster(
        item_code=f"NV-QCT-{suffix}-{item_type.value[:6]}",
        name=f"Verify {item_type.value} {suffix}",
        type=item_type,
        tracking_mode=TrackingMode.BULK,
        uom=uom,
        plant_id=PLANT,
        active="true",
    )
    db.add(item)
    db.flush()
    return item


def _location(db, suffix: str) -> InventoryLocation:
    loc = InventoryLocation(code=f"NV-QCT-{suffix}", warehouse="WH", plant_id=PLANT, active="true")
    db.add(loc)
    db.flush()
    return loc


def _approved_gsm(low=180, high=200) -> dict:
    return {
        "status": "approved",
        "setup_status": "approved",
        "revision": 1,
        "inspection_required": True,
        "parameters": [{"code": "gsm", "label": "GSM", "min": low, "max": high, "unit": "gsm", "required": True}],
    }


def test_qct017_every_inward_category_has_type_appropriate_fields_not_paper_or_return_defect():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        created = []
        for item_type in (
            ItemType.RAW_PAPER,
            ItemType.ADHESIVE,
            ItemType.PARCHMENT,
            ItemType.PACKAGING,
            ItemType.FINISHED_GOOD,
            ItemType.TOOL,
            ItemType.OTHER,
        ):
            created.append(_item(db, suffix, item_type, UOM.PCS if item_type in {ItemType.TOOL, ItemType.PACKAGING, ItemType.FINISHED_GOOD, ItemType.OTHER} else UOM.KG))
        db.commit()
        rows = list_quality_templates(material_type=None, db=db, plant_scope=_scope(), current_user=_user("qc", roles=("QC",)))
        by_type: dict[str, list] = {}
        for row in rows:
            by_type.setdefault(row.material_type, []).append(row)
        for material in ("RAW_PAPER", "ADHESIVE", "PARCHMENT", "PACKAGING", "FINISHED_GOOD", "TOOL", "OTHER"):
            assert by_type.get(material), material
        for material in ("ADHESIVE", "PACKAGING", "TOOL", "OTHER"):
            required = {row.parameter_key for row in by_type[material] if row.required}
            assert not (required & PAPER_MANDATORY_KEYS), (material, required)
            assert not (required & RETURN_DEFECT_KEYS), (material, required)
        fg_required = {row.parameter_key for row in by_type["FINISHED_GOOD"] if row.required}
        assert "reject_reason" not in fg_required
        assert "rework_possible" not in fg_required
        assert "gsm" not in fg_required
        paper_required = {row.parameter_key for row in by_type["RAW_PAPER"] if row.required}
        assert "gsm" in paper_required
        assert {item.type.value if hasattr(item.type, "value") else str(item.type) for item in created} == {
            "RAW_PAPER",
            "ADHESIVE",
            "PARCHMENT",
            "PACKAGING",
            "FINISHED_GOOD",
            "TOOL",
            "OTHER",
        }
    finally:
        db.close()


def test_qct019_exemption_inside_scope_is_not_required_outside_stays_restricted():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item = _item(db, suffix, ItemType.RAW_PAPER)
        loc = _location(db, suffix)
        upsert_item_quality_profile(
            item.id,
            ItemQualityProfileUpdate(quality_profile={"parameters": [{"code": "gsm", "min": 180, "max": 200}]}, setup_status="draft"),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        db.refresh(item)
        with pytest.raises(HTTPException) as forbidden:
            upsert_item_quality_profile(
                item.id,
                ItemQualityProfileUpdate(quality_profile=dict(item.quality_profile or {}), setup_status="exemption"),
                db=db,
                plant_id=PLANT,
                current_user=_user("qc", roles=("QC",)),
            )
        assert forbidden.value.status_code == 403
        db.refresh(item)
        approve_item_quality_profile(
            item.id,
            ItemQualityProfileApprove(
                expected_revision=int((item.quality_profile or {}).get("revision") or 1),
                exemption=True,
                effective_from=date(2026, 9, 1),
                effective_to=date(2026, 9, 30),
                scope_plant_id=PLANT,
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("owner", roles=("Owner",)),
        )
        db.refresh(item)
        assert (item.quality_profile or {}).get("status") == "approved_exemption"

        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-EX-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Exempt Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=100, unit_cost=10, incoming_qc_required=True)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner", roles=("Owner",)))
        po_line_id = uuid.UUID(str(created["lines"][0]["id"]))

        inside = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-IN-{suffix}",
                received_date=date(2026, 9, 10),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=40, location_id=loc.id, batch_no=f"LOT-IN-{suffix}")],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        assert inside["lines"][0]["qc_status"] == "NOT_REQUIRED"
        assert inside["lines"][0]["stock_status"] == "UNRESTRICTED"
        inside_batch = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(str(inside["lines"][0]["batch_id"]))).one()
        inspect_inside = create_quality_inspection(
            QualityInspectionCreate(
                entity_type="BATCH",
                entity_id=inside_batch.id,
                source="INWARD",
                readings={"gsm": 190},
                status="PASS",
                disposition="ACCEPT",
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        assert inspect_inside.status == "NOT_REQUIRED"
        assert inspect_inside.status != "PASS"

        outside = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-OUT-{suffix}",
                received_date=date(2026, 8, 1),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=40, location_id=loc.id, batch_no=f"LOT-OUT-{suffix}")],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        assert outside["lines"][0]["qc_status"] == "PENDING"
        assert outside["lines"][0]["stock_status"] == "QC_HOLD"
        outside_batch = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(str(outside["lines"][0]["batch_id"]))).one()
        inspect_out = create_quality_inspection(
            QualityInspectionCreate(
                entity_type="BATCH",
                entity_id=outside_batch.id,
                source="INWARD",
                readings={"gsm": 190},
                status="PASS",
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        assert inspect_out.status == "INCOMPLETE"
        assert inspect_out.status != "PASS"
        assert get_usable_item_qty(str(item.id), db) >= 40
    finally:
        db.close()


def test_qct020_copy_template_stays_draft_with_provenance_until_approve():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item = _item(db, suffix, ItemType.ADHESIVE)
        copied = copy_item_quality_template(
            item.id,
            ItemQualityProfileCopyTemplate(material_type="ADHESIVE"),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        profile = copied.quality_profile if hasattr(copied, "quality_profile") else copied["quality_profile"]
        if not isinstance(profile, dict):
            db.refresh(item)
            profile = item.quality_profile
        assert profile["status"] == "draft"
        assert profile["setup_status"] == "draft"
        assert profile["copied_from"]["source"] == "inventory_quality_templates"
        assert profile["copied_from"]["material_type"] == "ADHESIVE"
        assert "viscosity" in profile["copied_from"]["template_keys"]
        with pytest.raises(HTTPException) as forbidden:
            upsert_item_quality_profile(
                item.id,
                ItemQualityProfileUpdate(quality_profile=profile, setup_status="approved"),
                db=db,
                plant_id=PLANT,
                current_user=_user("qc", roles=("QC",)),
            )
        assert forbidden.value.status_code == 403
        db.refresh(item)
        approved = approve_item_quality_profile(
            item.id,
            ItemQualityProfileApprove(expected_revision=int((item.quality_profile or {}).get("revision") or 1)),
            db=db,
            plant_id=PLANT,
            current_user=_user("owner", roles=("Owner",)),
        )
        live = approved.quality_profile if hasattr(approved, "quality_profile") else item.quality_profile
        db.refresh(item)
        live = item.quality_profile
        assert live["status"] == "approved"
        assert live["copied_from"]["material_type"] == "ADHESIVE"
    finally:
        db.close()


def test_qct021_022_po_qualifier_retained_and_conflict_does_not_weaken_item():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item = _item(db, suffix, ItemType.RAW_PAPER)
        item.quality_profile = {
            "status": "approved",
            "setup_status": "approved",
            "revision": 1,
            "inspection_required": True,
            "parameters": [{"code": "ply_bond", "min": 20, "max": 40, "required": True}],
        }
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-PB-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Qualifier Mills",
                lines=[
                    PurchaseOrderLineCreate(
                        item_id=item.id,
                        qty_ordered=50,
                        unit_cost=11,
                        qualifiers=["PB 18+"],
                    )
                ],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        line = created["lines"][0]
        parsed = line["qualifiers"][0]
        assert parsed["raw"] == "PB 18+"
        assert parsed["plus_retained"] is True
        assert parsed["inclusive_guessed"] is False
        assert parsed["inclusive_min"] is None
        assert line["requires_review"] is True
        assert line["qualifier_conflicts"][0]["code"] == "QUALIFIER_WEAKER_THAN_ITEM"
        db.refresh(item)
        assert item.quality_profile["parameters"][0]["min"] == 20
    finally:
        db.close()


def test_qct023_supplier_certificate_stays_separate_from_local_reading():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item = _item(db, suffix, ItemType.RAW_PAPER)
        loc = _location(db, suffix)
        item.quality_profile = _approved_gsm(180, 200)
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-CERT-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Cert Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=20, unit_cost=9)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner", roles=("Owner",)))
        posted = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-CERT-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=uuid.UUID(str(created["lines"][0]["id"])), qty_received=20, location_id=loc.id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        inspection = create_quality_inspection(
            QualityInspectionCreate(
                entity_type="BATCH",
                entity_id=uuid.UUID(str(posted["lines"][0]["batch_id"])),
                source="INWARD",
                readings={"gsm": 210},
                supplier_certificate={"gsm": 190, "document": "MILL-TC-1"},
                status="PASS",
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        assert inspection.status == "FAIL"
        assert inspection.readings["gsm"] == 210
        assert inspection.evaluation["supplier_certificate"]["gsm"] == 190
        assert inspection.evaluation["evidence_sources"]["local_readings"]["gsm"] == 210
        batch = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(str(posted["lines"][0]["batch_id"]))).one()
        assert batch.stock_status == "QC_HOLD"
    finally:
        db.close()


def test_qct024_two_receipts_keep_independent_lots_and_sample_count_is_not_qty():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item = _item(db, suffix, ItemType.RAW_PAPER)
        loc = _location(db, suffix)
        item.quality_profile = _approved_gsm()
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-2R-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Two Lot Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=150, unit_cost=8)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner", roles=("Owner",)))
        po_line_id = uuid.UUID(str(created["lines"][0]["id"]))
        first = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-A-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=80, location_id=loc.id, batch_no=f"LOT-A-{suffix}", sample_count=2)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        second = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-B-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=70, location_id=loc.id, batch_no=f"LOT-B-{suffix}", sample_count=3)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        batch_a = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(str(first["lines"][0]["batch_id"]))).one()
        batch_b = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(str(second["lines"][0]["batch_id"]))).one()
        assert batch_a.id != batch_b.id
        assert batch_a.batch_no != batch_b.batch_no
        assert float(batch_a.received_qty) == 80
        assert float(batch_b.received_qty) == 70
        assert batch_a.inward_metadata["sample_count"] == 2
        assert batch_b.inward_metadata["sample_count"] == 3
        assert batch_a.inward_metadata["sample_count"] != batch_a.received_qty
        assert batch_a.inward_metadata["quality_profile"]["parameters"][0]["min"] == 180
        inspect_a = create_quality_inspection(
            QualityInspectionCreate(
                entity_type="BATCH",
                entity_id=batch_a.id,
                source="INWARD",
                readings={"gsm": 190},
                sample_count=2,
                sample_ids=["S1", "S2"],
                status="PASS",
                disposition="ACCEPT",
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        assert inspect_a.evaluation["sample_count"] == 2
        assert inspect_a.evaluation["sample_count"] != 80
    finally:
        db.close()


def test_qct025_026_grn_replay_one_task_and_notification_failure_keeps_hold(monkeypatch):
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item = _item(db, suffix, ItemType.RAW_PAPER)
        loc = _location(db, suffix)
        item.quality_profile = _approved_gsm()
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-RP-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Replay Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=30, unit_cost=7, incoming_qc_required=True)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner", roles=("Owner",)))
        po_line_id = uuid.UUID(str(created["lines"][0]["id"]))

        def boom(**_kwargs):
            raise RuntimeError("task notification interrupted")

        monkeypatch.setattr("src.routers.purchase.emit_audit_event", boom)
        payload = GrnCreate(
            grn_no=f"GRN-RP-{suffix}",
            received_date=date(2026, 9, 18),
            lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=30, location_id=loc.id, batch_no=f"LOT-RP-{suffix}")],
        )
        first = post_grn(po_id, payload, db=db, plant_id=PLANT, current_user=_user("store-a", roles=("Store",)))
        replay = post_grn(po_id, payload, db=db, plant_id=PLANT, current_user=_user("store-a", roles=("Store",)))
        assert replay.get("idempotent") is True
        assert replay["id"] == first["id"]
        batches = db.query(StockBatch).filter(StockBatch.item_id == item.id).all()
        assert len(batches) == 1
        assert batches[0].stock_status == "QC_HOLD"
        assert batches[0].inward_metadata["incoming_qc_task"]["status"] == "PENDING"
        assert batches[0].inward_metadata["incoming_qc_task"]["delivery_status"] == "PENDING"
        assert batches[0].inward_metadata["incoming_qc_task"].get("outbox_event_id")
        assert get_usable_item_qty(str(item.id), db) == 0
        inspections = db.query(InventoryQualityInspection).filter(InventoryQualityInspection.entity_id == batches[0].id).all()
        assert inspections == []
        first_retry = retry_incoming_qc_tasks(db=db, plant_id=PLANT, current_user=_user("qc", roles=("QC",)))
        assert first_retry["delivered"] >= 1
        db.refresh(batches[0])
        assert batches[0].inward_metadata["incoming_qc_task"]["delivery_status"] == "DELIVERED"
        assert batches[0].stock_status == "QC_HOLD"
        event_id = batches[0].inward_metadata["incoming_qc_task"].get("outbox_event_id")
        second_retry = retry_incoming_qc_tasks(db=db, plant_id=PLANT, current_user=_user("qc", roles=("QC",)))
        assert event_id
        assert event_id not in (second_retry.get("delivered_ids") or [])
        assert db.query(StockBatch).filter(StockBatch.item_id == item.id).count() == 1
    finally:
        db.close()


def test_qct028_destructive_sample_coverage_is_not_consumption_and_replays_once():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:8]
        item = _item(db, suffix, ItemType.RAW_PAPER)
        loc = _location(db, suffix)
        profile = _approved_gsm()
        profile["destructive_sample"] = {"enabled": True, "qty": 1}
        item.quality_profile = profile
        flag_modified(item, "quality_profile")
        db.flush()
        created = create_purchase_order(
            PurchaseOrderCreate(
                po_no=f"PO-DS-{suffix}",
                supplier_id=uuid.uuid4(),
                supplier_name="Sample Mills",
                lines=[PurchaseOrderLineCreate(item_id=item.id, qty_ordered=20, unit_cost=5, incoming_qc_required=False)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        po_id = uuid.UUID(str(created["id"]))
        approve_purchase_order(po_id, db=db, plant_id=PLANT, current_user=_user("owner", roles=("Owner",)))
        po_line_id = uuid.UUID(str(created["lines"][0]["id"]))
        grn = post_grn(
            po_id,
            GrnCreate(
                grn_no=f"GRN-DS-{suffix}",
                received_date=date(2026, 9, 18),
                lines=[GrnLineCreate(po_line_id=po_line_id, qty_received=20, location_id=loc.id, sample_count=3)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("store-a", roles=("Store",)),
        )
        batch_id = uuid.UUID(grn["lines"][0]["batch_id"])
        inspection = create_quality_inspection(
            QualityInspectionCreate(
                entity_type="BATCH",
                entity_id=batch_id,
                source="INWARD",
                readings={"gsm": 190},
                sample_count=3,
                status="PASS",
                disposition="ACCEPT",
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        inspection_id = inspection.id if hasattr(inspection, "id") else uuid.UUID(str(inspection["id"]))
        coverage = (getattr(inspection, "evaluation", None) or {}).get("sample_count") or 3
        first = consume_destructive_sample(
            inspection_id,
            DestructiveSampleConsume(qty=1),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        assert first["idempotent"] is False
        assert first["consumed_qty"] == 1
        assert first["sample_coverage"] == coverage or first["sample_coverage"] == 3
        assert first["consumed_qty"] != first["sample_coverage"]
        replay = consume_destructive_sample(
            inspection_id,
            DestructiveSampleConsume(qty=1),
            db=db,
            plant_id=PLANT,
            current_user=_user("qc", roles=("QC",)),
        )
        assert replay["idempotent"] is True
        assert replay["transaction_id"] == first["transaction_id"]
        tx_count = (
            db.query(StockTransaction)
            .filter(StockTransaction.external_ref == f"SAMPLE:{inspection_id}")
            .count()
        )
        assert tx_count == 1
    finally:
        db.close()

