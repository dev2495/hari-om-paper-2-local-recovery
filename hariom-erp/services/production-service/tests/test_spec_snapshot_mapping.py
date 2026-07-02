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
                    "notch_type": "Bottom RHS - 7mm Step 55deg",
                    "notch_distance_mm": "10.5",
                    "notch_depth_mm": "3.7",
                    "notching_holder": "Holder BAR 01 POY",
                    "notching_blade": "Plain Blade 1.1mm BAR 01 POY 140/130/20",
                    "v_flat": "V+Flat 70+30 x 4.0",
                    "punch": "Double",
                    "wider_tool": "NOT REQUIRED",
                    "tochha": "RHS - STEP NOTCH 7mm 50 degree",
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
        self.assertEqual(snapshot["notching_blade"], "Plain Blade 1.1mm BAR 01 POY 140/130/20")
        self.assertEqual(snapshot["notching_holder"], "Holder BAR 01 POY")
        self.assertEqual(snapshot["v_flat"], "V+Flat 70+30 x 4.0")
        self.assertEqual(snapshot["punch"], "Double")
        self.assertNotIn("wider_tool", snapshot)
        self.assertNotIn("tochha", snapshot)
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
            "notch_type": "Top RHS - 6mm Plain 50deg",
            "notch_distance_mm": "10.5",
            "notch_depth_mm": "3.5",
            "notching_blade": "Full Serration Blade 0.9mm 150/100/100",
            "notching_holder": "Holder BAR 04 FDY",
            "v_flat": "V+Flat 90+80 x 3.5",
            "punch": "Double",
            "wider_tool": "140 / 4.6mm",
            "tochha": "Round Z notch 7mm 55 degree",
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
        self.assertEqual(setup["notching_holder"], "Holder BAR 04 FDY")
        self.assertEqual(setup["blade"], "Full Serration Blade 0.9mm 150/100/100")
        self.assertEqual(setup["v_flat"], "V+Flat 90+80 x 3.5")
        self.assertEqual(setup["punch"], "Double")
        self.assertNotIn("wider_tool", setup)
        self.assertNotIn("tochha", setup)
        self.assertEqual(setup["bundle_code"], "BDL-02")
        self.assertEqual(setup["box_code"], "G-120")
        self.assertEqual(setup["plastic_required"], "Yes")
        self.assertEqual(setup["plastic_sku"], "PL-560")
        self.assertEqual(setup["special_instructions"], "QC sampling each batch")

    def test_merge_spec_snapshot_preserves_new_fields(self):
        base = {"notch_type": None, "v_flat": None}
        merged = _merge_spec_snapshot(
            base,
            {
                "dynamic_fields": _dynamic_field_rows(
                    {
                        "notch_type": "RHS - FORWARD",
                        "v_flat": "V+Flat 90+80 x 3.5",
                        "wider_tool": "NOT REQUIRED",
                        "plastic_required": "true",
                        "box_code": "R-150",
                        "plastic_sku": "PL-680",
                    }
                )
            },
        )
        self.assertEqual(merged["notch_type"], "RHS - FORWARD")
        self.assertEqual(merged["v_flat"], "V+Flat 90+80 x 3.5")
        self.assertNotIn("wider_tool", merged)
        self.assertEqual(merged["plastic_required"], "Yes")
        self.assertEqual(merged["box"], "R-150")
        self.assertEqual(merged["box_code"], "R-150")
        self.assertEqual(merged["plastic_sku"], "PL-680")


if __name__ == "__main__":
    unittest.main()
