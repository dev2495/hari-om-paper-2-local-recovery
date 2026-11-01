"""Small fakes for the reason-code router tests (owner decision 4, 1 Nov 2026): a session that hands back
prepared rows per model, and a spy on the router's ``resolve_reason`` that records the category asked for
and then runs the real check (answered by the fake master in conftest.py)."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from src import reasons

OWNER = {"sub": "owner@hariom.com", "roles": ["Owner"], "actual_roles": ["Owner"], "token": "t"}
PLANT = "00000000-0000-0000-0000-0000000000a1"


class FakeQuery:
    _CHAIN = {"filter", "filter_by", "order_by", "with_for_update", "populate_existing", "join", "options", "limit", "offset"}

    def __init__(self, rows: list[Any]):
        self.rows = list(rows)

    def __getattr__(self, name: str):
        if name in self._CHAIN:
            return lambda *args, **kwargs: self
        raise AttributeError(name)

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)

    def count(self):
        return len(self.rows)

    def scalar(self):
        return self.rows[0] if self.rows else None


class FakeDB:
    def __init__(self, rows_by_model: dict[Any, list[Any]] | None = None):
        self.rows_by_model = rows_by_model or {}
        self.added: list[Any] = []
        self.commits = 0

    def query(self, model: Any, *rest: Any) -> FakeQuery:
        return FakeQuery(self.rows_by_model.get(model, []))

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.commits += 1

    def refresh(self, obj: Any) -> None:
        pass

    def flush(self) -> None:
        pass

    def execute(self, *args: Any, **kwargs: Any) -> None:
        pass

    def get(self, model: Any, key: Any) -> Any:
        return None


class ReasonSpy:
    """Replaces a router module's imported ``resolve_reason``; ``categories`` lists what was asked."""

    def __init__(self):
        self.categories: list[str] = []

    def __call__(self, **kwargs: Any):
        self.categories.append(kwargs.get("category"))
        return reasons.resolve_reason(**kwargs)


def spy_on(monkeypatch, module) -> ReasonSpy:
    spy = ReasonSpy()
    monkeypatch.setattr(module, "resolve_reason", spy)
    return spy


def refused(call, status: int = 422, words: str | None = None) -> HTTPException:
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, (exc.status_code, exc.detail)
        if words:
            assert words in str(exc.detail), exc.detail
        return exc
    raise AssertionError("expected an HTTPException")
