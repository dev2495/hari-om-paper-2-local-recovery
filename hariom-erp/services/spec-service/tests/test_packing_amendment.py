"""Packing setup: approval needs packing, and a packing amendment keeps the approved spec honest.

Disposable PostgreSQL only (DATABASE_URL must name a *_test_* hariom_nverify database).
"""
import os
import uuid

import pytest
from fastapi import HTTPException

URL = os.getenv("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not ("hariom_nverify" in URL and "test" in URL), reason="disposable PostgreSQL required")

PLANT = "00000000-0000-0000-0000-0000000000a1"
USER = {"sub": "packing-test-owner", "roles": ["Owner"], "allowed_plants": [PLANT], "token": "t"}
MASTERS = {
    "R-150": {"kind": "BOX", "code": "R-150", "size_label": "400x300x200", "weight_kg": 0.45},
    "R.125": {"kind": "BOX", "code": "R.125", "size_label": "350x300x200", "weight_kg": 0.4},
    "PS-150": {"kind": "PLASTIC", "code": "PS-150", "size_label": "1x1 m", "weight_kg": 0.05},
    "FD-3": {"kind": "FADDA", "code": "FD-3", "size_label": None, "weight_kg": 0.02},
}


@pytest.fixture
def env(monkeypatch):
    from src.main import app  # noqa: F401  (creates the tables)
    from src.database import SessionLocal
    from src import spec_math
    from src.routers import packing_setup, seasonal as a

    db = SessionLocal()
    paper = str(uuid.uuid4())
    monkeypatch.setattr(a, "master_mandrel", lambda *args: 76.3)

    class Papers:
        def raise_for_status(self):
            pass

        def json(self):
            return [{"id": paper, "active": True}]

    monkeypatch.setattr(a.httpx, "get", lambda *args, **kw: Papers())
    monkeypatch.setattr(packing_setup, "fetch_packaging_masters", lambda **kw: MASTERS)
    pushes = []

    def push(**kw):
        pushes.append(kw)
        return {"updated": 2, "updated_cards": [{"job_card_no": "26/11/01"}, {"job_card_no": "26/11/02"}], "skipped_packed": 1}

    monkeypatch.setattr(packing_setup, "push_packing_to_job_cards", push)
    a.bootstrap(a.Command(request_id=str(uuid.uuid4())), db, USER)
    preview = spec_math.compute_preview(mandrel_od_mm=76.3, tube_length_mm=150, papers=[spec_math.RecipePaper(paper_id=paper, gsm=300, bulk=1, ply_count=3)], target_dry_g=35, adhesive_percent=12.5, parchment_percent=0, parchment_allowed=False)
    layers = [{"paper_id": paper, "ply_no": i, "gsm_snapshot": 300, "bf_snapshot": 20, "bulk_snapshot": 1} for i in (1, 2, 3)]

    def create(packing: dict):
        customer = str(uuid.uuid4())
        fields = {"valid_upto": "2027-10-03", "prepared_by": "Test owner", "prepared_date": "2026-10-03", "sign_off_note": "Reviewed",
                  "adhesive_components_json": '[{"name":"Glue","ratio_percent":100}]', **packing}
        spec = {"customer_id": customer, "customer_name": "Packing " + customer[:8], "customer_name_snapshot": "Packing customer", "tube_size_id": str(uuid.uuid4()),
                "mandrel_id": str(uuid.uuid4()), "id_min_mm": 76.2, "id_max_mm": 76.6, "od_min_mm": 81, "od_max_mm": 81, "length_min_mm": 149.8, "length_max_mm": 150.2,
                "target_tube_weight": round(preview.nominal_tube.dry_g, 4), "required_cs": 400, "cs_min_n": 400, "adhesive_percent": 12.5, "moisture_loss_percent": 9,
                "parchment_percent": 0, "parchment_allowed": False, "dynamic_fields": [{"field_key": k, "value": v} for k, v in fields.items()]}
        body = a.Document(request_id=str(uuid.uuid4()), spec=spec, recipes={"ROY": {"layers": layers, "notes": "r"}, "MONSOON": {"layers": layers, "notes": "r", "confirm": True}})
        return a.create_document(body, db, PLANT, USER)["spec"]

    yield a, packing_setup, db, create, pushes
    db.rollback()
    db.close()


def cmd(a, rev):
    return a.Command(request_id=str(uuid.uuid4()), expected_version=rev)


def amend(api, spec_id, rev, **changes):
    body = dict(request_id=str(uuid.uuid4()), expected_version=rev, box_code="R.125", qty_per_box=45, plastic_sku="PS-150", plastic_per_box=1, fadda_sku="FD-3", fadda_per_box=3)
    return api.PackingAmendmentInput(**{**body, **changes})


def test_new_spec_cannot_go_to_review_or_approval_without_box_and_qty(env):
    a, api, db, create, pushes = env
    spec = create({})
    sid, rev = uuid.UUID(spec["id"]), spec["write_revision"]
    with pytest.raises(HTTPException) as error:
        a.review_spec(sid, cmd(a, rev), db, PLANT, USER)
    assert error.value.status_code == 409
    assert "Packing: choose the box from the Packaging master" in error.value.detail["blockers"]
    assert "Packing: enter the quantity per box (whole pieces)" in error.value.detail["blockers"]
    db.rollback()
    assert "Packing: choose the box from the Packaging master" in a.read_blockers(sid, db, PLANT, USER)["blockers"]
    ready = create({"box_code": "R-150", "qty_per_box": "48"})
    rid, rrev = uuid.UUID(ready["id"]), ready["write_revision"]
    a.review_spec(rid, cmd(a, rrev), db, PLANT, USER)
    assert a.approve_spec(rid, cmd(a, rrev), db, PLANT, USER)["spec"]["status"] == "approved"


def test_packing_amendment_is_audited_and_keeps_approval_and_recipe(env):
    a, api, db, create, pushes = env
    from src.models import SpecPackingAmendment, SpecificationSheet
    from src.season_models import SeasonEvent, SpecReadiness
    from src.routers.specs import _dynamic_field_map

    spec = create({"box_code": "R-150", "qty_per_box": "48"})
    sid, rev = uuid.UUID(spec["id"]), spec["write_revision"]
    a.review_spec(sid, cmd(a, rev), db, PLANT, USER)
    a.approve_spec(sid, cmd(a, rev), db, PLANT, USER)
    db.expire_all()
    live = db.get(SpecificationSheet, sid)
    version, revision = live.version, live.write_revision

    body = amend(api, sid, revision, note="Harish: correct box")
    result = api.amend_spec_packing(sid, body, db, PLANT, USER)
    assert result["amended"] and set(result["changed_keys"]) >= {"box_code", "qty_per_box", "plastic_sku", "fadda_sku"}
    assert result["job_cards"]["updated"] == 2
    db.expire_all()
    live = db.get(SpecificationSheet, sid)
    assert live.status == "approved" and live.active and live.version == version
    assert live.write_revision == revision + 1
    dynamic = _dynamic_field_map(live)
    assert dynamic["box_code"] == "R.125" and dynamic["qty_per_box"] == "45" and dynamic["box_unit_weight_kg"] == "0.4"
    assert dynamic["plastic_weight_per_box_kg"] == "0.05" and dynamic["fadda_weight_per_box_kg"] == "0.06"
    row = db.query(SpecPackingAmendment).filter_by(spec_id=sid).one()
    assert row.before["box_code"] == "R-150" and row.after["box_code"] == "R.125" and row.spec_version == version
    assert row.write_revision_before == revision and row.job_cards_updated == 2 and row.note == "Harish: correct box"
    assert db.query(SeasonEvent).filter_by(action="spec_packing_amended").count() >= 1
    # The recipe stays approved for the amended spec: release readiness is not knocked back.
    for season in ("ROY", "MONSOON"):
        details = db.get(SpecReadiness, (sid, season)).details
        assert "Approve the selected recipe for the current specification" not in details["blockers"]
        assert details["recipe_approved"]
    # The open job cards of every version of the spec get the packing.
    assert pushes[-1]["spec_ids"] == [str(sid)] and pushes[-1]["values"]["box_code"] == "R.125"
    # Exact retry replays; a save with nothing new records no amendment but re-pushes to job cards.
    assert api.amend_spec_packing(sid, body, db, PLANT, USER)["replayed"]
    same = api.amend_spec_packing(sid, amend(api, sid, live.write_revision), db, PLANT, USER)
    assert not same["amended"] and same["amendment"] is None and len(pushes) == 2
    assert db.query(SpecPackingAmendment).filter_by(spec_id=sid).count() == 1
    history = api.packing_amendments(sid, db, {"selected_plant_id": PLANT, "scope_all": False, "allowed_plants": [PLANT]}, USER)
    assert history["items"][0]["summary"].startswith("Box R.125 × 45 pcs")


def test_packing_amendment_guards(env):
    a, api, db, create, pushes = env
    spec = create({"box_code": "R-150", "qty_per_box": "48"})
    sid, rev = uuid.UUID(spec["id"]), spec["write_revision"]
    with pytest.raises(HTTPException) as stale:
        api.amend_spec_packing(sid, amend(api, sid, rev + 5), db, PLANT, USER)
    assert stale.value.status_code == 409
    db.rollback()
    with pytest.raises(HTTPException) as missing:
        api.amend_spec_packing(sid, amend(api, sid, rev, box_code="EXPORT"), db, PLANT, USER)
    assert missing.value.status_code == 422 and missing.value.detail["missing_code"] == "EXPORT"
    db.rollback()
    assert not pushes


def test_packing_setup_lists_specs_with_progress(env):
    a, api, db, create, pushes = env
    done = create({"box_code": "R-150", "qty_per_box": "48", "plastic_sku": "PS-150", "plastic_per_box": "1"})
    unknown_box = create({"box_code": "N-225", "qty_per_box": "40"})
    no_sku = create({"box_code": "R-150", "qty_per_box": "40", "plastic_per_box": "1"})
    scope = {"selected_plant_id": PLANT, "scope_all": False, "allowed_plants": [PLANT]}
    rows = {row["id"]: row for row in api.packing_setup_rows(db, scope, USER)["items"]}
    assert rows[done["id"]]["complete"] and rows[done["id"]]["packing"]["plastic_sku"] == "PS-150"
    assert rows[unknown_box["id"]]["blockers"] == ["Box N-225 is not in the Packaging master"]
    assert rows[no_sku["id"]]["blockers"] == ["Plastic per box is 1 but no plastic is chosen"]
