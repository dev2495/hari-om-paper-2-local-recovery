import json
import unittest
import uuid

from fastapi import HTTPException

from src import models
from src.routers import tool as tool_router


class _ToolQuery:
    def __init__(self, db):
        self._db = db

    def filter(self, *_criteria):
        return self

    def first(self):
        return self._db.target

    def all(self):
        return self._db.option_rows


class _ToolSession:
    """Small unit-test double for the repository calls used by tooling endpoints."""

    def __init__(self):
        self.tools = []
        self.logs = []
        self.target = None
        self.option_rows = []
        self.commits = 0

    def add(self, record):
        if isinstance(record, models.ToolMaster):
            if record.id is None:
                record.id = uuid.uuid4()
            if record.active is None:
                record.active = True
            if record.usage_count is None:
                record.usage_count = 0
            self.tools.append(record)
            return
        self.logs.append(record)

    def flush(self):
        pass

    def commit(self):
        self.commits += 1

    def refresh(self, _record):
        pass

    def query(self, _model):
        return _ToolQuery(self)


class ToolMasterContractTests(unittest.TestCase):
    def setUp(self):
        self.db = _ToolSession()
        self.actor = {"name": "Tooling QA"}
        self.plant_id = "PLANT_TOOL_QA"

    def test_categories_are_fixed_and_unknown_categories_are_rejected(self):
        self.assertEqual(
            [row["value"] for row in tool_router.get_tool_categories()],
            ["NOTCH", "BLADE", "HOLDER", "V_FLAT", "PUNCH"],
        )
        with self.assertRaises(HTTPException) as caught:
            tool_router._normalize_category("DIE")
        self.assertEqual(caught.exception.status_code, 400)

    def test_client_master_roles_can_maintain_tools_and_dropdown_values(self):
        self.assertEqual(
            tool_router.TOOL_MASTER_WRITE_ROLES,
            ["Admin", "Owner", "PlantManager"],
        )
        checker = tool_router.require_role(tool_router.TOOL_MASTER_WRITE_ROLES)
        self.assertEqual(checker({"roles": ["Owner"]})["roles"], ["Owner"])
        self.assertEqual(checker({"roles": ["PlantManager"]})["roles"], ["PlantManager"])
        with self.assertRaises(HTTPException) as denied:
            checker({"roles": ["Operator"]})
        self.assertEqual(denied.exception.status_code, 403)

    def test_option_updates_apply_to_legacy_plant_alias_rows(self):
        first = models.ToolAttributeOption(
            id=uuid.uuid4(),
            category="NOTCH",
            field_key="degree",
            value="50",
            plant_id="PLANT_A",
            active=True,
        )
        alias = models.ToolAttributeOption(
            id=uuid.uuid4(),
            category="NOTCH",
            field_key="degree",
            value="50",
            plant_id="00000000-0000-0000-0000-0000000000a1",
            active=True,
        )
        self.db.target = first
        self.db.option_rows = [first, alias]

        updated = tool_router.update_tool_option(
            first.id,
            tool_router.ToolOptionUpdate(value="50", active=False),
            db=self.db,
            plant_id="PLANT_A",
            current_user={"roles": ["Owner"]},
        )

        self.assertEqual(updated.value, "50")
        self.assertFalse(first.active)
        self.assertFalse(alias.active)

    def test_multiple_tools_can_be_created_and_edited_under_every_fixed_category(self):
        categories = ["NOTCH", "BLADE", "HOLDER", "V_FLAT", "PUNCH"]
        created = []

        for category in categories:
            for sequence in (1, 2):
                points = {"thickness": f"{sequence} mm"}
                if category in {"NOTCH", "BLADE"}:
                    points["type"] = "Plain"
                if category == "NOTCH":
                    points.update({"design": "Plain", "degree": "50"})
                if category == "BLADE":
                    points["length"] = "140/130/20"
                if category == "HOLDER":
                    points["length"] = "140/130/20"
                if category == "V_FLAT":
                    points["length"] = "70+30"
                if category == "PUNCH":
                    points = {"punch": "Single"}
                payload = tool_router.ToolCreate(
                    category=category,
                    name=f"{category} QA Tool {sequence}",
                    spec_text=json.dumps({"version": 1, "points": points}),
                    attribute_values=points,
                    department="PROCESS",
                    status="ACTIVE",
                )
                created.append(
                    tool_router.create_tool(
                        payload,
                        db=self.db,
                        plant_id=self.plant_id,
                        current_user=self.actor,
                    )
                )

        self.assertEqual(len(self.db.tools), 10)
        self.assertEqual([record.category for record in self.db.tools].count("NOTCH"), 2)
        self.assertEqual([record.category for record in self.db.tools].count("BLADE"), 2)
        self.assertEqual([record.category for record in self.db.tools].count("HOLDER"), 2)
        self.assertEqual([record.category for record in self.db.tools].count("V_FLAT"), 2)
        self.assertEqual([record.category for record in self.db.tools].count("PUNCH"), 2)
        self.assertEqual(len(self.db.logs), 10)

        for record in created:
            self.db.target = record
            edited_points = dict(record.attribute_values or {})
            edited_key = next(iter(edited_points))
            edited_points[edited_key] = f"{edited_points[edited_key]} revised"
            edited = tool_router.update_tool(
                record.id,
                tool_router.ToolUpdate(
                    name=f"{record.name} revised",
                    attribute_values=edited_points,
                    spec_text=record.spec_text,
                ),
                db=self.db,
                plant_id=self.plant_id,
                current_user=self.actor,
            )
            self.assertTrue(edited.name.endswith("revised"))
            self.assertEqual(edited.attribute_values.get(edited_key), edited_points[edited_key])
            self.assertEqual(edited.category, record.category)
            self.assertEqual(edited.spec_text, record.spec_text)

        self.assertEqual(self.db.commits, 20)

    def test_only_editable_attribute_fields_are_allowed(self):
        with self.assertRaises(HTTPException):
            tool_router._validate_option_key("NOTCH", "location")
        with self.assertRaises(HTTPException):
            tool_router._validate_option_key("NOTCH", "notch_distance_mm")
        with self.assertRaises(HTTPException):
            tool_router._validate_option_key("NOTCH", "notch_depth_mm")
        self.assertEqual(
            tool_router._validate_option_key("NOTCH", "notch_direction"),
            ("NOTCH", "notch_direction"),
        )
        self.assertEqual(tool_router._validate_option_key("PUNCH", "punch"), ("PUNCH", "punch"))

    def test_tool_attributes_are_scoped_to_category_and_required_fields(self):
        with self.assertRaises(HTTPException) as unknown:
            tool_router._normalize_tool_attributes("PUNCH", {"punch": "Single", "code": "P-1"})
        self.assertEqual(unknown.exception.status_code, 400)

        with self.assertRaises(HTTPException) as missing:
            tool_router._normalize_tool_attributes("BLADE", {"type": "Plain", "thickness": "1.1 mm"})
        self.assertEqual(missing.exception.status_code, 400)

        self.assertEqual(
            tool_router._normalize_tool_attributes(
                "HOLDER",
                {"thickness": "6 mm", "height": "20 mm", "length": "140 mm"},
            ),
            {"thickness": "6 mm", "height": "20 mm", "length": "140 mm"},
        )

    def test_tool_category_cannot_be_changed_after_creation(self):
        payload = tool_router.ToolCreate(
            category="PUNCH",
            name="Punch QA",
            attribute_values={"punch": "Single"},
            department="PROCESS",
        )
        record = tool_router.create_tool(payload, db=self.db, plant_id=self.plant_id, current_user=self.actor)
        self.db.target = record
        with self.assertRaises(HTTPException) as caught:
            tool_router.update_tool(
                record.id,
                tool_router.ToolUpdate(category="BLADE"),
                db=self.db,
                plant_id=self.plant_id,
                current_user=self.actor,
            )
        self.assertEqual(caught.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
