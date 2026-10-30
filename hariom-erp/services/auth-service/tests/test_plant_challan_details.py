"""Plant legal name, address and GSTIN print on the delivery challan (client 2026-10-28)."""
import pytest
from fastapi import HTTPException

from src.routers import plants


def test_gstin_is_trimmed_upper_cased_and_blank_clears_it():
    assert plants._validated_gstin(" 24aaaaa0000a1z5 ") == "24AAAAA0000A1Z5"
    assert plants._validated_gstin("26 AAACR5055K 1ZS") == "26AAACR5055K1ZS"
    assert plants._validated_gstin("") is None
    assert plants._validated_gstin(None) is None


@pytest.mark.parametrize("value, words", [
    ("24AAAAA0000A1Z", "15 characters"),
    ("24AAAA00000A1Z5", "2-digit state code"),
    ("25AAAAA0000A1Z5", "not a GST state code"),
])
def test_bad_gstin_is_refused_in_plain_words(value, words):
    with pytest.raises(HTTPException) as error:
        plants._validated_gstin(value)
    assert error.value.status_code == 422
    assert words in error.value.detail


def test_blank_text_is_stored_as_empty():
    assert plants._blank_to_none("  ") is None
    assert plants._blank_to_none(" Plot 4, GIDC ") == "Plot 4, GIDC"


@pytest.mark.parametrize("field, words", [
    ("name", "Plant name is required"),
    ("code", "Plant code is required"),
    ("is_active", "Active / inactive is required"),
])
def test_null_for_a_required_column_is_a_plain_422_not_a_crash(field, words):
    class Plant:
        id = "plant-a"
        code = "A"
        name = "Plant A"

    class Db:
        def commit(self):  # never reached: the null is refused first
            raise AssertionError("must not save")

    original = plants._plant_lookup
    plants._plant_lookup = lambda db, plant_id: Plant()
    try:
        with pytest.raises(HTTPException) as error:
            plants.update_plant("plant-a", plants.PlantUpdate(**{field: None}), Db(), None)
    finally:
        plants._plant_lookup = original
    assert error.value.status_code == 422
    assert error.value.detail == words


def test_create_refuses_a_name_made_only_of_spaces():
    class Db:
        def query(self, *_args):  # never reached: the blank name is refused first
            raise AssertionError("must not look up the code")

        def add(self, _row):
            raise AssertionError("must not save")

    with pytest.raises(HTTPException) as error:
        plants.create_plant(plants.PlantCreate(code="ZZ", name="   "), Db(), None)
    assert error.value.status_code == 422
    assert error.value.detail == "Plant name is required"
