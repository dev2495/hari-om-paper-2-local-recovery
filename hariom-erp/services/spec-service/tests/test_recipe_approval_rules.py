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


def test_recipe_approval_rejects_more_than_twenty_five_plies():
    papers = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    recipe = _recipe([papers[index % 3] for index in range(26)])
    service = ApprovalService(_RecipeDb(recipe))

    with pytest.raises(HTTPException) as exc_info:
        service.approve_recipe(str(recipe.id), approved_by="owner")
    assert "at most 25 plies" in str(exc_info.value.detail)


def test_recipe_approval_rejects_more_than_ten_distinct_papers():
    recipe = _recipe([uuid.uuid4() for _ in range(11)])
    service = ApprovalService(_RecipeDb(recipe))

    with pytest.raises(HTTPException) as exc_info:
        service.approve_recipe(str(recipe.id), approved_by="owner")
    assert "1-10 distinct papers" in str(exc_info.value.detail)
