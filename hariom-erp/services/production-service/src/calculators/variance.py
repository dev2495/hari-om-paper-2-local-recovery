from __future__ import annotations


def calculate_variance(expected: float, actual: float) -> dict:
    expected_value = float(expected or 0.0)
    actual_value = float(actual or 0.0)
    delta = actual_value - expected_value
    percent = (delta / expected_value * 100.0) if expected_value else 0.0
    return {"expected": expected_value, "actual": actual_value, "delta": round(delta, 4), "percent": round(percent, 2)}
