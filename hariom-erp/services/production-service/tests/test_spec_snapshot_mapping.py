from datetime import datetime
from types import SimpleNamespace
import unittest
import uuid

from src.routers.planning import _build_document_snapshot, _build_spec_snapshot, _merge_spec_snapshot


def _dynamic_field_rows(values: dict[str, str]):
    return [{"field_key": key, "value": value} for key, value in values.items()]


class SpecSnapshotMappingTests(unittest.TestCase):
    def test_build_spec_snapshot_includes_workbook_tool_fields(self):
        spec = {
            "id": str(uuid.uuid4()),
            "customer_id": str(uuid.uuid4()),
            "customer_name_snapshot": "Demo Customer",
            "tube_size_id": str(uuid.uuid4()),
            "mandrel_id": str(uuid.uuid4()),
            "target_tube_weight": 230.0,
            "required_cs": 450.0,
            "approved_cs": 460.0,
            "id_min_mm": 109.5,
            "id_max_mm": 110.5,
            "od_min_mm": 123.5,
            "od_max_mm": 124.5,
            "length_min_mm": 114.0,
            "length_max_mm": 116.0,
            "weight_min_g": 220.0,
            "weight_max_g": 240.0,
            "cs_min_n": 430.0,
            "cs_max_n": 470.0,
            "moisture_min_pct": 6.0,
            "moisture_max_pct": 10.0,
            "parchment_color": "Natural",
            "shrink_percent": 8.5,
            "bamboo_max_length": 1560,
            "cut_loss_mm": 40,
            "status": "approved",
            "version": 3,
            "dynamic_fields": _dynamic_field_rows(
                {
                    "tube_direction": "Opposite of the Notch",
                    "notch_type": "RHS - FORWARD",
                    "notch_position": "RHS",
                    "notch_distance_mm": "10.5",
                    "notch_depth_mm": "3.7",
                    "notching_holder": "BAR 01 POY (135-310 [4.5 without])",
                    "notching_blade": "BAR 01 POY (140-130-40 [1.1]) Plain",
                    "groove": "140mm [70mm flat and v shape]",
                    "punch": "Double Punch 5x10mm[center dist. 30mm]",
                    "wider_tool": "NOT REQUIRED",
                    "tochha": "RHS - STEP NOTCH 7mm 50 degree",
                    "tochha_type": "Lower",
                    "height_gauge_go": "115.20",
                    "height_gauge_no_go": "126.70",
                    "die": "115.20x127.0 / 115.40x126.70",
                    "bundle_type": "Standard Bundle",
                    "bundle_code": "BDL-01",
                    "packing_ply": "3",
                    "qty_per_box": "12",
                    "packing_pcs": "48",
                    "box_code": "R-150",
                    "box_size": "680X370X460",
                    "plastic_sku": "PL-680",
                    "plastic_per_box": "2",
                    "plastic_required": "true",
                    "fadda_sku": "FAD-01",
                    "fadda_per_box": "1",
                    "bopp_required": "true",
                    "special_instructions": "Floor check",
                }
            ),
        }

        snapshot = _build_spec_snapshot(spec, priority="HIGH")
        self.assertEqual(snapshot["tube_direction"], "Opposite of the Notch")
        self.assertEqual(snapshot["notching_holder"], "BAR 01 POY (135-310 [4.5 without])")
        self.assertEqual(snapshot["wider_tool"], "NOT REQUIRED")
        self.assertEqual(snapshot["bundle_type"], "Standard Bundle")
        self.assertEqual(snapshot["qty_per_box"], "12")
        self.assertEqual(snapshot["packing_pcs"], "48")
        self.assertEqual(snapshot["box_code"], "R-150")
        self.assertEqual(snapshot["box"], "R-150")
        self.assertEqual(snapshot["plastic_sku"], "PL-680")
        self.assertEqual(snapshot["plastic_required"], "Yes")
        self.assertEqual(snapshot["fadda_sku"], "FAD-01")
        self.assertEqual(snapshot["special_instructions"], "Floor check")

    def test_document_snapshot_carries_setup_tooling_fields(self):
        job_card = SimpleNamespace(
            id=uuid.uuid4(),
            created_at=datetime(2026, 3, 5, 12, 0, 0),
            plant_id=uuid.uuid4(),
            planned_qty=960.0,
        )
        stage = SimpleNamespace(machine_id=uuid.uuid4())
        spec_snapshot = {
            "customer_name_snapshot": "Demo Customer",
            "mandrel_id": str(uuid.uuid4()),
            "required_cs": 450.0,
            "id_min_mm": 109.5,
            "id_max_mm": 110.5,
            "od_min_mm": 123.5,
            "od_max_mm": 124.5,
            "length_min_mm": 114.0,
            "length_max_mm": 116.0,
            "weight_min_g": 220.0,
            "weight_max_g": 240.0,
            "target_tube_weight": 230.0,
            "cs_min_n": 430.0,
            "cs_max_n": 470.0,
            "moisture_min_pct": 6.0,
            "moisture_max_pct": 10.0,
            "bamboo_max_length": 1560,
            "cut_loss_mm": 40,
            "tube_direction": "Opposite of the Notch",
            "notch_type": "TOP - Forword Notch",
            "notch_position": "TOP",
            "notch_distance_mm": "10.5",
            "notch_depth_mm": "3.5",
            "notching_holder": "BAR 04 FDY (140-320 [3.2mm without])",
            "notching_blade": "BAR 01 FDY (140-150-30 [0.9]) Plain",
            "groove": "166mm [83mm flat and v shape]",
            "punch": "Double Punch 5X10mm[center dist. 30mm]",
            "wider_tool": "140 / 4.6mm",
            "tochha": "Round Z notch 7mm 55 degree",
            "tochha_type": "Upper",
            "height_gauge_go": "126.10",
            "height_gauge_no_go": "137.70",
            "die": "126.10 X 137.70",
            "bundle_type": "Standard Bundle",
            "bundle_code": "BDL-02",
            "packing_ply": "3",
            "qty_per_box": "12",
            "packing_pcs": "48",
            "box_code": "G-120",
            "box_size": "560X420X490",
            "plastic_required": "Yes",
            "plastic_sku": "PL-560",
            "plastic_per_box": "2",
            "fadda_sku": "FAD-09",
            "fadda_per_box": "1",
            "bopp_required": "Yes",
            "special_instructions": "QC sampling each batch",
            "packing_instructions": "Bundle Standard Bundle | Bundle Code BDL-02 | Packing Ply 3 | Qty/Box 12 | Packing Pcs 48 | Box G-120 | Box Size 560X420X490 | Plastic Yes (PL-560) | Plastic/Box 2 | Fadda FAD-09 | Fadda/Box 1 | BOPP Yes | QC sampling each batch",
        }

        document = _build_document_snapshot(
            job_card=job_card,
            sales_order=None,
            spec_snapshot=spec_snapshot,
            stages=[stage],
            snapshot_mode="stored",
        )

        setup = document["setup_tooling"]
        self.assertEqual(setup["tube_direction"], "Opposite of the Notch")
        self.assertEqual(setup["notching_holder"], "BAR 04 FDY (140-320 [3.2mm without])")
        self.assertEqual(setup["wider_tool"], "140 / 4.6mm")
        self.assertEqual(setup["bundle_code"], "BDL-02")
        self.assertEqual(setup["box_code"], "G-120")
        self.assertEqual(setup["plastic_required"], "Yes")
        self.assertEqual(setup["plastic_sku"], "PL-560")
        self.assertEqual(setup["special_instructions"], "QC sampling each batch")

    def test_merge_spec_snapshot_preserves_new_fields(self):
        base = {"notch_type": None, "wider_tool": None}
        merged = _merge_spec_snapshot(
            base,
            {
                "dynamic_fields": _dynamic_field_rows(
                    {
                        "notch_type": "RHS - FORWARD",
                        "wider_tool": "NOT REQUIRED",
                        "plastic_required": "true",
                        "box_code": "R-150",
                        "plastic_sku": "PL-680",
                    }
                )
            },
        )
        self.assertEqual(merged["notch_type"], "RHS - FORWARD")
        self.assertEqual(merged["wider_tool"], "NOT REQUIRED")
        self.assertEqual(merged["plastic_required"], "Yes")
        self.assertEqual(merged["box"], "R-150")
        self.assertEqual(merged["box_code"], "R-150")
        self.assertEqual(merged["plastic_sku"], "PL-680")


if __name__ == "__main__":
    unittest.main()
