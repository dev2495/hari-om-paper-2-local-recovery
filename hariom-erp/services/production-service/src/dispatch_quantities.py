"""Physical accepted FG and the commercial quantity allocated to one card."""
import math


def _quantity(value):
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, number) if math.isfinite(number) else 0.0


def dispatchable_quantity(job, packing, qc_stage):
    gross = _quantity(getattr(packing, "total_packed_qty", None))
    if (getattr(job, "spec_snapshot", None) or {}).get("entry_model") != "V2":
        return gross
    if not qc_stage or qc_stage.status != "COMPLETED":
        return 0.0
    return min(gross, _quantity(qc_stage.output_qty))


def qc_excluded_quantities(job, packing, qc_stage):
    """Keep final-QC rejects separate from packed input never inspected/consumed."""
    if ((getattr(job, "spec_snapshot", None) or {}).get("entry_model") != "V2"
            or not qc_stage or qc_stage.status != "COMPLETED"):
        return {"qc_rejected_qty": 0.0, "qc_uninspected_qty": 0.0}
    gross = _quantity(getattr(packing, "total_packed_qty", None))
    excluded = max(0.0, gross - dispatchable_quantity(job, packing, qc_stage))
    snapshot = getattr(qc_stage, "actuals_snapshot", None) or {}
    if snapshot.get("produced_total") is not None or snapshot.get("rejected_total") is not None:
        rejected = _quantity(snapshot["rejected_total"] if snapshot.get("rejected_total") is not None
                             else getattr(qc_stage, "scrap_qty", None))
        rejected = min(excluded, rejected)
    else:
        # Older completed records have no entry totals to distinguish residual
        # input, so preserve their historical packed-minus-accepted interpretation.
        rejected = excluded
    return {"qc_rejected_qty": rejected, "qc_uninspected_qty": max(0.0, excluded - rejected)}


def shipping_allowance(job, dispatchable, dispatch_stage):
    accepted = _quantity(dispatchable)
    if (getattr(job, "spec_snapshot", None) or {}).get("entry_model") != "V2":
        return accepted
    released = _quantity(getattr(job, "released_qty", None))
    allocated = released if released > 0 else _quantity(getattr(job, "planned_qty", None))
    allowance = min(accepted, allocated)
    snapshot = getattr(dispatch_stage, "actuals_snapshot", None) or {}
    if snapshot.get("effective_target") is not None:
        allowance = min(allowance, _quantity(snapshot["effective_target"]))
    return allowance
