"""Shared quality pass-rate math. An empty inspection set is never 100%."""

from __future__ import annotations

from typing import Optional


def quality_pass_rate(passed: int, total: int) -> Optional[float]:
    if total <= 0:
        return None
    return round((passed / total) * 100.0, 2)


def quality_pass_rate_or_zero(passed: int, total: int) -> float:
    rate = quality_pass_rate(passed, total)
    return 0.0 if rate is None else rate
