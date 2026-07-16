from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException

from src.services.approval import ApprovalService


class _RecipeQuery:
    def __init__(self, recipe):
        self.recipe = recipe

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.recipe


class _RecipeDb:
    def __init__(self, recipe):
        self.recipe = recipe

    def query(self, _model):
        return _RecipeQuery(self.recipe)


def _recipe(paper_ids):
    return SimpleNamespace(
        id=uuid.uuid4(),
        spec_id=uuid.uuid4(),
        status="trial",
        specification=SimpleNamespace(id=uuid.uuid4()),
        layers=[SimpleNamespace(paper_id=paper_id) for paper_id in paper_ids],
    )


def test_recipe_approval_rejects_more_than_nine_plies():
    papers = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    recipe = _recipe([papers[index % 3] for index in range(10)])
    service = ApprovalService(_RecipeDb(recipe))

    with pytest.raises(HTTPException) as exc_info:
        service.approve_recipe(str(recipe.id), approved_by="owner")
    assert "at most 9 plies" in str(exc_info.value.detail)


def test_recipe_approval_requires_three_to_five_distinct_papers():
    first = uuid.uuid4()
    second = uuid.uuid4()
    recipe = _recipe([first, first, second, second])
    service = ApprovalService(_RecipeDb(recipe))

    with pytest.raises(HTTPException) as exc_info:
        service.approve_recipe(str(recipe.id), approved_by="owner")
    assert "3-5 distinct papers" in str(exc_info.value.detail)
