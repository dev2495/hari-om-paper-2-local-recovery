"""Plant "label heading" printed at the top of reel / coil labels (owner decision 6, 1 Nov 2026)."""
from types import SimpleNamespace

from src.routers import plants


def _plant(**values):
    base = {"id": "p", "code": "A", "name": "Plant A", "legal_name": None, "label_heading": None, "address": None,
            "gstin": None, "is_active": True, "users": []}
    return SimpleNamespace(**{**base, **values})


def test_heading_defaults_to_the_legal_name_then_the_plant_name():
    assert plants.label_heading_for(_plant(legal_name="Amigo Industries Unit II")) == "AMIGO INDUSTRIES UNIT II"
    assert plants.label_heading_for(_plant()) == "PLANT A"


def test_a_set_heading_wins_and_is_upper_cased_with_single_spaces():
    plant = _plant(legal_name="Amigo Industries Pvt Ltd", label_heading="  amigo  industries unit ii ")
    assert plants.label_heading_for(plant) == "AMIGO INDUSTRIES UNIT II"


def test_plant_rows_carry_the_heading_and_what_labels_print():
    row = plants._serialize_plant(_plant(legal_name="Amigo Industries Unit II"), privileged=True)
    assert row["label_heading"] is None
    assert row["label_heading_effective"] == "AMIGO INDUSTRIES UNIT II"


def test_create_and_update_accept_the_heading():
    assert plants.PlantCreate(code="B", name="Plant B", label_heading="Amigo II").label_heading == "Amigo II"
    assert plants.PlantUpdate(label_heading="").model_dump(exclude_unset=True) == {"label_heading": ""}
