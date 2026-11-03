"""Plant isolation audit (3 Nov 2026): a reason check for another plant is refused before that plant's
reason lists are seeded, and the tool back-fill run by a plant head fills only their own plant."""
import os
import uuid

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401,E402  create_all + start-up seed
from src import models, reason_seed, tool_backfill  # noqa: E402
from src.database import SessionLocal  # noqa: E402
from src.routers import shop_floor, tool  # noqa: E402


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _scope(plant, owner=False):
    return {"selected_plant_id": plant, "scope_all": False, "allowed_plants": [plant], "is_owner": owner}


def test_reason_check_for_another_plant_is_refused_and_seeds_nothing(db):
    mine, other = f"PLANT-MINE-{uuid.uuid4().hex[:6]}", f"PLANT-OTHER-{uuid.uuid4().hex[:6]}"
    payload = shop_floor.ReasonValidate(category="STAGE_SHORT_CLOSE", reason_code="SS-MATERIAL-SHORT", plant_id=other)
    with pytest.raises(HTTPException) as error:
        shop_floor.validate_reason_choice(payload, db=db, plant_scope=_scope(mine), current_user={"sub": "u", "roles": ["Store"]})
    assert error.value.status_code == 403
    assert db.query(models.ReasonCode).filter(models.ReasonCode.plant_id == other).count() == 0
    # The caller's own plant still works and is seeded on first use.
    own = shop_floor.ReasonValidate(category="STAGE_SHORT_CLOSE", reason_code="SS-MATERIAL-SHORT", plant_id=mine)
    assert shop_floor.validate_reason_choice(own, db=db, plant_scope=_scope(mine), current_user={"sub": "u", "roles": ["Store"]})["code"] == "SS-MATERIAL-SHORT"


class _FakeSpecEngine:
    """Stands in for the spec database: two plants' specs name a notch tool."""

    def __init__(self, rows):
        self.rows = rows

    def connect(self):
        engine = self

        class _Connection:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, *args, **kwargs):
                class _Result:
                    def all(self_inner):
                        return engine.rows
                return _Result()

        return _Connection()

    def dispose(self):
        pass


def test_tool_backfill_by_plant_head_touches_only_their_plant(db, monkeypatch):
    mine, other = f"PLANT-MINE-{uuid.uuid4().hex[:6]}", f"PLANT-OTHER-{uuid.uuid4().hex[:6]}"
    name = f"NOTCH-{uuid.uuid4().hex[:6]}"
    rows = [("notch_type", name, mine), ("notch_type", name, other)]
    monkeypatch.setattr(tool_backfill, "spec_database_url", lambda: "postgresql://fake/specdb")
    monkeypatch.setattr(tool_backfill, "create_engine", lambda *a, **k: _FakeSpecEngine(rows))
    result = tool.backfill_from_specs(plant_scope=_scope(mine), current_user={"sub": "pm", "roles": ["PlantManager"]})
    assert result == {"created": 1}
    plants = {row.plant_id for row in db.query(models.ToolMaster).filter(models.ToolMaster.name == name).all()}
    assert plants == {mine}
    # Owner/Admin fill every plant.
    assert tool.backfill_from_specs(plant_scope=_scope(mine, owner=True), current_user={"sub": "o", "roles": ["Owner"]}) == {"created": 1}
    db.expire_all()
    assert {row.plant_id for row in db.query(models.ToolMaster).filter(models.ToolMaster.name == name).all()} == {mine, other}
