"""Service-local import shim for the shared QC evaluator.

The canonical implementation lives at ``hariom-erp/shared/hariom_quality_eval.py``.
Both production-service and inventory-service import through this shim so
pytest (``from src.quality_eval import ...``) and package imports stay stable.
Do not add service-specific evaluation logic here.
"""

from __future__ import annotations

import sys
from pathlib import Path

_shared_dir = str(Path(__file__).resolve().parents[3] / "shared")
if _shared_dir not in sys.path:
    sys.path.insert(0, _shared_dir)

from hariom_quality_eval import *  # noqa: F401,F403
from hariom_quality_eval import (  # noqa: F401
    IncomingQualityEvaluation,
    InspectionEvaluation,
    QualityEvaluation,
    evaluate_incoming,
    evaluate_incoming_quality,
    evaluate_job_stage,
    evaluate_stage_quality,
    submission_error,
)
