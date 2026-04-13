from __future__ import annotations


def calculate_yield_ratio(input_qty: float, output_qty: float) -> dict:
    input_value = float(input_qty or 0.0)
    output_value = float(output_qty or 0.0)
    ratio = (output_value / input_value * 100.0) if input_value > 0 else 0.0
    return {"input_qty": input_value, "output_qty": output_value, "yield_percent": round(ratio, 2)}
