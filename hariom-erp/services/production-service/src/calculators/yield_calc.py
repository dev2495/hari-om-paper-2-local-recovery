from __future__ import annotations

from importlib import import_module

calculate_yield_ratio = import_module(".yield", __package__).calculate_yield_ratio

__all__ = ["calculate_yield_ratio"]
