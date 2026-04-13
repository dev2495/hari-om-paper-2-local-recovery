from __future__ import annotations


def calculate_bamboo_loss(input_weight_kg: float, output_weight_kg: float) -> dict:
    input_weight = float(input_weight_kg or 0.0)
    output_weight = float(output_weight_kg or 0.0)
    loss = max(input_weight - output_weight, 0.0)
    percent = (loss / input_weight * 100.0) if input_weight > 0 else 0.0
    return {"input_weight_kg": input_weight, "output_weight_kg": output_weight, "loss_weight_kg": loss, "loss_percent": round(percent, 2)}
