import unittest
import uuid
from datetime import date
from types import SimpleNamespace

from src.routers.inward import InwardCreate
from src.routers.purchase import PurchaseOrderCreate
from src.routers.reels import ReelInwardCreate
from src.services.labels import batch_label_payload, reel_label_payload


class PurchaseInwardMetadataContractTests(unittest.TestCase):
    def test_purchase_order_accepts_printable_po_fields(self):
        supplier_id = uuid.uuid4()
        item_id = uuid.uuid4()

        payload = PurchaseOrderCreate(
            po_no="45",
            po_date=date(2026, 2, 15),
            supplier_id=supplier_id,
            supplier_name="URVASHI PAPER & PULP MILLS PVT LTD",
            supplier_contact="Mr. Sundeepji",
            supplier_address="Ankleshwar",
            supplier_gst_no="24AAAAA0000A1Z5",
            payment_terms="60 days from invoice date.",
            test_report_terms="Attach PB/GSM/RCT/COBB test report.",
            special_instruction="FOR AMIGO INDUSTRIES UNIT-2",
            lines=[
                {
                    "item_id": item_id,
                    "qty_ordered": 1000,
                    "unit_cost": 30,
                    "description": "KRAFT BOARD",
                    "width_mm": 102,
                    "gsm": 230,
                    "plybond": 18,
                    "bulk": 1.4,
                    "cobb": "170 COBB",
                }
            ],
        )

        self.assertEqual(payload.po_no, "45")
        self.assertEqual(payload.supplier_contact, "Mr. Sundeepji")
        self.assertEqual(payload.lines[0].description, "KRAFT BOARD")
        self.assertEqual(payload.lines[0].gsm, 230)

    def test_reel_inward_uses_amigo_no_and_master_snapshot(self):
        payload = ReelInwardCreate(
            amigo_no="AIT 00001",
            paper_id=uuid.uuid4(),
            supplier_id=uuid.uuid4(),
            supplier_name="VATSALYA",
            inward_weight_kg=715,
            inward_date=date(2026, 4, 1),
            mill="VATSALYA",
            source_reel_no="175016",
            slitting_status="REGULAR",
            po_no="44",
            bill_no="VPI/1/2026-27",
            rate=30,
            paper_master_snapshot={
                "code": "KRAFT-230-18BF",
                "variety": "230",
                "gsm": 230,
                "bf": 18,
                "ply_bond": 18,
                "bulk_factor": 1.4,
            },
        )

        self.assertEqual(payload.amigo_no, "AIT 00001")
        self.assertEqual(payload.paper_master_snapshot["gsm"], 230)
        self.assertEqual(payload.source_reel_no, "175016")

    def test_bulk_inward_accepts_adhesive_and_parchment_client_fields(self):
        payload = InwardCreate(
            item_id=uuid.uuid4(),
            amigo_no="AIT 00001",
            qty=1000,
            supplier_id=uuid.uuid4(),
            supplier_name="Poonam Corporation",
            unit_cost=24,
            location_id=uuid.uuid4(),
            material_form="ADHESIVE",
            product="ADHESIVE",
            item_name_snapshot="Wellcol EM30100",
            tank_no="1",
            bill_no="2026-2027/0004",
            bill_date=date(2026, 4, 2),
            weight_out=0,
            wastage=0,
            color="Blue",
            thickness="12 micron",
            pattern_code="PC-01",
        )

        self.assertEqual(payload.amigo_no, "AIT 00001")
        self.assertEqual(payload.tank_no, "1")
        self.assertEqual(payload.pattern_code, "PC-01")

    def test_qr_labels_use_amigo_number_as_human_label(self):
        batch_id = uuid.uuid4()
        item_id = uuid.uuid4()
        batch = SimpleNamespace(
            id=batch_id,
            plant_id="PLANT_A",
            item_id=item_id,
            batch_no="AIT 00010",
            received_qty=250,
            stock_status="QC_HOLD",
            supplier_name_snapshot="Poonam Corporation",
            location_id=uuid.uuid4(),
            inward_metadata={"amigo_no": "AIT 00010", "po_no": "44", "bill_no": "B-1", "location_code": "RM-A-01"},
        )
        item = SimpleNamespace(item_code="ADH-EM30100", name="Wellcol EM30100", uom="KG")
        label = batch_label_payload(batch, item, inward_date=date(2026, 4, 2))
        self.assertEqual(label["code"], "AIT 00010")
        self.assertIn("AIT 00010", label["qr_value"])
        self.assertEqual(label["po_no"], "44")

        reel = SimpleNamespace(
            id=uuid.uuid4(),
            plant_id=uuid.uuid4(),
            paper_id=item_id,
            reel_code="AIT 00011",
            gsm=230,
            bf=18,
            current_weight_kg=700,
            inward_weight_kg=715,
            stock_status="QC_HOLD",
            supplier_name_snapshot="VATSALYA",
            supplier_name="VATSALYA",
            location_id=uuid.uuid4(),
            inward_date=date(2026, 4, 1),
            inward_metadata={"amigo_no": "AIT 00011", "source_reel_no": "175016", "paper_master_snapshot": {"ply_bond": 18}},
        )
        reel_label = reel_label_payload(reel, item)
        self.assertEqual(reel_label["code"], "AIT 00011")
        self.assertIn("AIT 00011", reel_label["qr_value"])
        self.assertEqual(reel_label["source_reel_no"], "175016")


if __name__ == "__main__":
    unittest.main()
