import pytest
from fastapi import HTTPException

from src.routers.specs import SpecUpdate, _validate_recipe_profile_limits


def _payload(*, components=None, rows=None):
    return SpecUpdate(
        profile={
            "recipe": {
                "adhesive_components": components or [],
                "recipe_rows": rows or [],
            }
        }
    )


def test_profile_accepts_six_adhesives_at_exactly_one_hundred_percent():
    components = [{"name": f"A{index}", "ratio_percent": 100 / 6} for index in range(6)]
    _validate_recipe_profile_limits(_payload(components=components))


def test_profile_rejects_more_than_six_adhesives():
    with pytest.raises(HTTPException) as exc_info:
        _validate_recipe_profile_limits(
            _payload(components=[{"name": f"A{index}", "ratio_percent": 100 / 7} for index in range(7)])
        )
    assert "at most 6 adhesive components" in str(exc_info.value.detail)


def test_profile_allows_incomplete_adhesive_ratio_while_saving_draft():
    _validate_recipe_profile_limits(
        _payload(components=[{"name": "A", "ratio_percent": 60}, {"name": "B", "ratio_percent": 30}])
    )


def test_profile_rejects_more_than_ten_distinct_papers():
    with pytest.raises(HTTPException) as exc_info:
        _validate_recipe_profile_limits(
            _payload(rows=[{"paper_id": str(index), "plyCount": 1} for index in range(11)])
        )
    assert "at most 10 distinct paper masters" in str(exc_info.value.detail)


def test_profile_rejects_more_than_twenty_five_total_plies():
    with pytest.raises(HTTPException) as exc_info:
        _validate_recipe_profile_limits(_payload(rows=[{"paper_id": "paper-a", "plyCount": 26}]))
    assert "at most 25 total plies" in str(exc_info.value.detail)
