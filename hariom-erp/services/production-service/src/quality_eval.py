"""Service-local import shim for the shared QC evaluator.

The canonical implementation lives at ``hariom-erp/shared/hariom_quality_eval.py``.
Search the repo layout, service image (``/app/shared``), and tinypod layout
(``/app/hariom-erp/shared``) so the deployed artifact actually ships the module.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_shared_evaluator():
    here = Path(__file__).resolve()
    candidates: list[Path] = []
    for parent in [here.parent, *list(here.parents)]:
        candidates.append(parent / "shared" / "hariom_quality_eval.py")
        candidates.append(parent / "hariom-erp" / "shared" / "hariom_quality_eval.py")
        candidates.append(parent / "hariom_quality_eval.py")
    candidates.extend(
        [
            Path("/app/shared/hariom_quality_eval.py"),
            Path("/app/hariom-erp/shared/hariom_quality_eval.py"),
        ]
    )
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve() if path.exists() else path
        if resolved in seen:
            continue
        seen.add(resolved)
        if not path.is_file():
            continue
        spec = importlib.util.spec_from_file_location("hariom_quality_eval", path)
        if spec is None or spec.loader is None:
            continue
        module = importlib.util.module_from_spec(spec)
        sys.modules.setdefault("hariom_quality_eval", module)
        spec.loader.exec_module(module)
        return module
    raise ImportError(
        "hariom_quality_eval.py was not packaged with this service. "
        "Expected hariom-erp/shared or /app/shared in the deployment artifact."
    )


_shared = _load_shared_evaluator()
globals().update({name: getattr(_shared, name) for name in dir(_shared) if not name.startswith("_")})
IncomingQualityEvaluation = _shared.IncomingQualityEvaluation
InspectionEvaluation = _shared.InspectionEvaluation
QualityEvaluation = _shared.QualityEvaluation
evaluate_incoming = _shared.evaluate_incoming
evaluate_incoming_quality = _shared.evaluate_incoming_quality
evaluate_job_stage = _shared.evaluate_job_stage
evaluate_stage_quality = _shared.evaluate_stage_quality
submission_error = _shared.submission_error
