#!/usr/bin/env python3
"""Compare Python and TypeScript spec math for five representative fixtures."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SPEC_SERVICE = ROOT / "hariom-erp/services/spec-service"
WEB_UI = ROOT / "apps/web-ui"

sys.path.insert(0, str(SPEC_SERVICE))

from src.spec_math import RecipePaper, compute_preview, preview_to_dict  # noqa: E402


FIXTURES = [
    {
        "name": "default_four_ply",
        "mandrel_od_mm": 62,
        "tube_length_mm": 150,
        "target_dry_g": 250,
        "papers": [
            {"paper_id": "a", "code": "250-18BF", "gsm": 250, "bulk": 1.3, "ply_count": 2},
            {"paper_id": "b", "code": "300-20BF", "gsm": 300, "bulk": 1.25, "ply_count": 1},
            {"paper_id": "c", "code": "350-24BF", "gsm": 350, "bulk": 1.2, "ply_count": 1},
        ],
    },
    {
        "name": "decimal_gsm_long_tube",
        "mandrel_od_mm": 48.5,
        "tube_length_mm": 205,
        "target_dry_g": 185.5,
        "papers": [
            {"paper_id": "p221", "code": "221", "gsm": 220, "bulk": 1.5, "ply_count": 2},
            {"paper_id": "p231", "code": "231", "gsm": 230.5, "bulk": 1.48, "ply_count": 1},
            {"paper_id": "p301", "code": "301", "gsm": 300, "bulk": 1.5, "ply_count": 2},
        ],
    },
    {
        "name": "parchment_off",
        "mandrel_od_mm": 55,
        "tube_length_mm": 180,
        "target_dry_g": 210,
        "parchment_allowed": False,
        "papers": [
            {"paper_id": "p350", "code": "350", "gsm": 350, "bulk": 1.55, "ply_count": 1},
            {"paper_id": "p351", "code": "351", "gsm": 350, "bulk": 1.5, "ply_count": 1},
            {"paper_id": "p352", "code": "352", "gsm": 350, "bulk": 1.45, "ply_count": 2},
        ],
    },
    {
        "name": "custom_globals",
        "mandrel_od_mm": 70.25,
        "tube_length_mm": 125,
        "target_dry_g": 325,
        "adhesive_percent": 18,
        "parchment_percent": 2,
        "moisture_loss_percent": 10,
        "papers": [
            {"paper_id": "p250", "code": "250", "gsm": 250, "bulk": 1.3, "ply_count": 3},
            {"paper_id": "p300", "code": "300", "gsm": 300, "bulk": 1.25, "ply_count": 2},
            {"paper_id": "p355", "code": "355", "gsm": 350, "bulk": 1.55, "ply_count": 1},
        ],
    },
    {
        "name": "max_valid_papers",
        "mandrel_od_mm": 38,
        "tube_length_mm": 95,
        "target_dry_g": 120,
        "papers": [
            {"paper_id": "p221", "code": "221", "gsm": 220, "bulk": 1.5, "ply_count": 1},
            {"paper_id": "p231", "code": "231", "gsm": 230, "bulk": 1.5, "ply_count": 1},
            {"paper_id": "p301", "code": "301", "gsm": 300, "bulk": 1.5, "ply_count": 1},
            {"paper_id": "p351", "code": "351", "gsm": 350, "bulk": 1.5, "ply_count": 1},
            {"paper_id": "p354", "code": "354", "gsm": 350, "bulk": 1.4, "ply_count": 1},
        ],
    },
]


def compact_python_preview(fixture: dict[str, Any]) -> dict[str, Any]:
    preview = compute_preview(
        mandrel_od_mm=fixture["mandrel_od_mm"],
        tube_length_mm=fixture["tube_length_mm"],
        target_dry_g=fixture["target_dry_g"],
        adhesive_percent=fixture.get("adhesive_percent", 15.0),
        parchment_percent=fixture.get("parchment_percent", 1.5),
        moisture_loss_percent=fixture.get("moisture_loss_percent", 9.0),
        parchment_allowed=fixture.get("parchment_allowed", True),
        papers=[RecipePaper(**paper) for paper in fixture["papers"]],
    )
    payload = preview_to_dict(preview)
    return {
        "name": fixture["name"],
        "id_mm": payload["id_mm"],
        "od_mm": payload["od_mm"],
        "wall_mm": payload["wall_mm"],
        "paper_weight_per_mm_g": payload["paper_weight_per_mm_g"],
        "paper_required_g": payload["paper_required_g"],
        "per_ply_thickness_mm": payload["per_ply_thickness_mm"],
        "per_ply_avg_dia_mm": payload["per_ply_avg_dia_mm"],
        "per_ply_weight_per_mm_g": payload["per_ply_weight_per_mm_g"],
        "tube": payload["tube"],
        "bamboo": payload["bamboo"],
        "bamboo_plan": payload["bamboo_plan"],
        "validation": payload["validation"],
    }


def round_for_compare(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 3)
    if isinstance(value, list):
        return [round_for_compare(item) for item in value]
    if isinstance(value, dict):
        return {key: round_for_compare(item) for key, item in sorted(value.items())}
    return value


def main() -> int:
    node_result = subprocess.run(
        ["node", "-r", "./node_modules/sucrase/register", "__tests__/spec-math-parity.ts"],
        cwd=WEB_UI,
        text=True,
        capture_output=True,
        check=True,
    )
    ts_payload = json.loads(node_result.stdout)
    py_payload = [compact_python_preview(fixture) for fixture in FIXTURES]

    failures: list[str] = []
    for py_item, ts_item in zip(py_payload, ts_payload):
        py_rounded = round_for_compare(py_item)
        ts_rounded = round_for_compare(ts_item)
        if py_rounded != ts_rounded:
            failures.append(
                json.dumps(
                    {
                        "fixture": py_item["name"],
                        "python": py_rounded,
                        "typescript": ts_rounded,
                    },
                    indent=2,
                    sort_keys=True,
                )
            )

    if failures:
        print("Spec math parity failed for Python vs TypeScript:", file=sys.stderr)
        print("\n\n".join(failures), file=sys.stderr)
        return 1

    print(f"PASS spec math Python/TypeScript parity: {len(py_payload)} fixtures <= 3 dp")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
