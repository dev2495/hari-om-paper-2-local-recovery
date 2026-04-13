from __future__ import annotations


def calculate_shrinkage(before_weight_kg: float, after_weight_kg: float) -> dict:
    before = float(before_weight_kg or 0.0)
    after = float(after_weight_kg or 0.0)
    shrink = max(before - after, 0.0)
    percent = (shrink / before * 100.0) if before > 0 else 0.0
    return {"before_weight_kg": before, "after_weight_kg": after, "shrink_weight_kg": shrink, "shrink_percent": round(percent, 2)}
