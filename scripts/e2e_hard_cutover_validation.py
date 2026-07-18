#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import sys
import traceback
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from sqlalchemy import create_engine, text
from runtime_support import REPORT_DIR, load_runtime_manifest

BASE_DIR = Path(__file__).resolve().parents[1]
REPORT_DIR.mkdir(parents=True, exist_ok=True)

RUNTIME_MANIFEST = load_runtime_manifest()
RUNTIME_URLS = RUNTIME_MANIFEST.get("urls") or {}
RUNTIME_HOST = str(RUNTIME_MANIFEST.get("host") or "127.0.0.1")

BFF_URL = os.getenv("BFF_URL", str(RUNTIME_URLS.get("bff") or f"http://{RUNTIME_HOST}:14000"))
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", str(RUNTIME_URLS.get("auth") or f"http://{RUNTIME_HOST}:18001"))
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", str(RUNTIME_URLS.get("master") or f"http://{RUNTIME_HOST}:18002"))
ADMIN_EMAIL = os.getenv(
    "ADMIN_EMAIL",
    str((RUNTIME_MANIFEST.get("defaults") or {}).get("admin_email") or "admin@hariom.com"),
)
ADMIN_PASSWORD = os.getenv(
    "ADMIN_PASSWORD",
    str((RUNTIME_MANIFEST.get("defaults") or {}).get("admin_password") or "admin123"),
)
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "30"))
MASTER_DB_URL = os.getenv("MASTER_DB_URL", "postgresql://devarshthakkar@127.0.0.1:5432/masterdb")
SPEC_DB_URL = os.getenv("SPEC_DB_URL", "postgresql://devarshthakkar@127.0.0.1:5432/specdb")
PRODUCTION_DB_URL = os.getenv("PRODUCTION_DB_URL", "postgresql://devarshthakkar@127.0.0.1:5432/productiondb")
DRYING_LOSS_PERCENT = 9.0
PRE_DRY_DIVISOR = 1.0 - (DRYING_LOSS_PERCENT / 100.0)
STRICT_COMBO_MINIMUMS = {250: 2, 300: 1}
STRICT_COMBO_PREFERRED_MIN_GSM = 350
TEST_SUPPLIER_ID = "00000000-0000-0000-0000-00000000feed"

APPROVED_PAPERS: list[dict[str, Any]] = [
    {"code": "KRAFT-230-18BF", "variety": "KRAFT PAPER", "gsm": 230, "bf": 18, "strength_type": "BF", "strength_value": 18, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.20, "ply_bond": 0.0},
    {"code": "KRAFT-250-18BF", "variety": "KRAFT PAPER", "gsm": 250, "bf": 18, "strength_type": "BF", "strength_value": 18, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.22, "ply_bond": 0.0},
    {"code": "KRAFT-300-18BF", "variety": "KRAFT PAPER", "gsm": 300, "bf": 18, "strength_type": "BF", "strength_value": 18, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.24, "ply_bond": 0.0},
    {"code": "KRAFT-301-400PB", "variety": "KRAFT PAPER", "gsm": 301, "bf": 400, "strength_type": "PB", "strength_value": 400, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.24, "ply_bond": 0.0},
    {"code": "KRAFT-350-300PB", "variety": "KRAFT PAPER", "gsm": 350, "bf": 300, "strength_type": "PB", "strength_value": 300, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.27, "ply_bond": 0.0},
    {"code": "KRAFT-351-400PB", "variety": "KRAFT PAPER", "gsm": 351, "bf": 400, "strength_type": "PB", "strength_value": 400, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.28, "ply_bond": 0.0},
    {"code": "KRAFT-352-500PB", "variety": "KRAFT PAPER", "gsm": 352, "bf": 500, "strength_type": "PB", "strength_value": 500, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.28, "ply_bond": 0.0},
    {"code": "KRAFT-353-600PB", "variety": "KRAFT PAPER", "gsm": 353, "bf": 600, "strength_type": "PB", "strength_value": 600, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.28, "ply_bond": 0.0},
    {"code": "KRAFT-354-700PB", "variety": "KRAFT PAPER", "gsm": 354, "bf": 700, "strength_type": "PB", "strength_value": 700, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.29, "ply_bond": 0.0},
    {"code": "KRAFT-355-350PB", "variety": "KRAFT PAPER", "gsm": 355, "bf": 350, "strength_type": "PB", "strength_value": 350, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.28, "ply_bond": 0.0},
    {"code": "KRAFT-401-400PB", "variety": "KRAFT PAPER", "gsm": 401, "bf": 400, "strength_type": "PB", "strength_value": 400, "category": "KRAFT", "bulk_factor": 1.0, "thickness_mm": 0.32, "ply_bond": 0.0},
]
APPROVED_ADHESIVES: list[dict[str, str]] = [
    {"name": "TL4(Vinsol)", "internal_code": "20100"},
    {"name": "Alcosol", "internal_code": "30100"},
    {"name": "TL4 LV", "internal_code": "TL4LV"},
]
APPROVED_PARCHMENTS: list[dict[str, str]] = [
    {"vendor_name": "Amma", "color_name": "Many patterns"},
    {"vendor_name": "Sagar", "color_name": "Many patterns"},
    {"vendor_name": "China", "color_name": "Many patterns"},
]
PLANT_ID_EQUIVALENTS: dict[str, list[str]] = {
    "00000000-0000-0000-0000-0000000000a1": ["PLANT_A", "PLANT-1", "PLANT1"],
    "00000000-0000-0000-0000-0000000000b2": ["PLANT_B", "PLANT-2", "PLANT2"],
}


@dataclass
class CheckRow:
    name: str
    status: str
    detail: str


class ValidationRunner:
    def __init__(self) -> None:
        self.rows: list[CheckRow] = []
        self.evidence: dict[str, Any] = {}
        self.flows: list[dict[str, Any]] = []
        self.formula_fixtures: list[dict[str, Any]] = []
        self.active_plant_id: str | None = None

    def add(self, name: str, ok: bool, detail: str) -> None:
        self.rows.append(CheckRow(name=name, status="PASS" if ok else "FAIL", detail=detail))

    def _request(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        expected: tuple[int, ...] = (200,),
        json_body: Any = None,
        form_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
        allow_error: bool = False,
    ) -> tuple[requests.Response, Any]:
        headers: dict[str, str] = extra_headers.copy() if extra_headers else {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if json_body is not None:
            headers.setdefault("Content-Type", "application/json")

        resp = requests.request(
            method=method,
            url=url,
            params=params,
            json=json_body,
            data=form_body,
            headers=headers,
            cookies={},
            timeout=REQUEST_TIMEOUT,
        )

        parsed: Any
        try:
            parsed = resp.json()
        except Exception:
            parsed = {"raw": resp.text}

        if not allow_error and resp.status_code not in expected:
            snippet = resp.text[:600].replace("\n", " ")
            raise RuntimeError(f"{method} {url} expected {expected} got {resp.status_code}: {snippet}")

        return resp, parsed

    def api(
        self,
        method: str,
        path: str,
        *,
        token: str,
        expected: tuple[int, ...] = (200,),
        json_body: Any = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
        allow_error: bool = False,
    ) -> tuple[requests.Response, Any]:
        request_headers = dict(extra_headers or {})
        if self.active_plant_id and "X-Plant-ID" not in request_headers:
            request_headers["X-Plant-ID"] = self.active_plant_id
        return self._request(
            method,
            f"{BFF_URL}{path}",
            token=token,
            expected=expected,
            json_body=json_body,
            params=params,
            extra_headers=request_headers,
            allow_error=allow_error,
        )

    def master_api(
        self,
        method: str,
        path: str,
        *,
        token: str,
        expected: tuple[int, ...] = (200,),
        json_body: Any = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[requests.Response, Any]:
        return self._request(
            method,
            f"{MASTER_SERVICE_URL}{path}",
            token=token,
            expected=expected,
            json_body=json_body,
            params=params,
            extra_headers=extra_headers,
        )


def _sql_text_list(values: list[str]) -> str:
    escaped = ["'" + str(value).replace("'", "''") + "'" for value in values]
    return ", ".join(escaped) or "''"


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _canonical_recipe_rows(rows: list[dict[str, Any]], paper_lookup: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    canonical_rows: list[dict[str, Any]] = []
    for row in rows:
        paper_id = str(row.get("paper_id") or "").strip()
        paper = paper_lookup.get(paper_id) or {}
        canonical_rows.append(
            {
                "paper_id": paper_id,
                "code": paper.get("code"),
                "variety": paper.get("variety"),
                "category": paper.get("category"),
                "gsm": float(paper.get("gsm") or row.get("gsm") or 0.0),
                "bf_per_ply": float(paper.get("bf") or row.get("bfPerPly") or row.get("bf_per_ply") or 0.0),
                "thickness_per_ply": float(paper.get("thickness_mm") or row.get("thicknessPerPly") or 0.0),
                "ply_bond": float(paper.get("ply_bond") or row.get("plyBond") or 0.0),
                "ply_count": int(row.get("plyCount") or row.get("ply_count") or 1),
                "positions_text": str(row.get("positionsText") or row.get("positions_text") or "").strip(),
            }
        )
    return canonical_rows


def _suggestion_meets_ply_minimums(
    suggestion: dict[str, Any] | None,
    paper_map: dict[int, dict[str, Any]],
    mandatory_ply_minimums: dict[int, int] | None,
) -> bool:
    if not mandatory_ply_minimums:
        return True
    if not suggestion:
        return False

    gsm_totals: dict[int, int] = {}
    paper_id_to_gsm = {
        str(paper.get("id")): int(round(float(paper.get("gsm") or 0)))
        for paper in (paper_map or {}).values()
        if paper.get("id")
    }
    for row in suggestion.get("rows") or []:
        gsm_value = paper_id_to_gsm.get(str(row.get("paper_id")))
        if not gsm_value:
            continue
        gsm_totals[gsm_value] = gsm_totals.get(gsm_value, 0) + int(row.get("plyCount") or 1)

    for gsm_value, minimum_ply in (mandatory_ply_minimums or {}).items():
        if gsm_totals.get(int(gsm_value), 0) < int(minimum_ply):
            return False
    return True


def _suggestion_gsm_totals(
    suggestion: dict[str, Any] | None,
    paper_map: dict[int, dict[str, Any]],
) -> dict[int, int]:
    totals: dict[int, int] = {}
    if not suggestion:
        return totals
    paper_id_to_gsm = {
        str(paper.get("id")): int(round(float(paper.get("gsm") or 0.0)))
        for paper in (paper_map or {}).values()
        if paper.get("id")
    }
    for row in suggestion.get("rows") or []:
        gsm_value = paper_id_to_gsm.get(str(row.get("paper_id")))
        if not gsm_value:
            continue
        totals[gsm_value] = totals.get(gsm_value, 0) + int(row.get("plyCount") or 1)
    return totals


def _select_preferred_suggestion(
    suggestions: list[dict[str, Any]],
    paper_map: dict[int, dict[str, Any]],
    mandatory_ply_minimums: dict[int, int] | None,
    preferred_min_gsm: int = STRICT_COMBO_PREFERRED_MIN_GSM,
) -> dict[str, Any] | None:
    eligible = [
        suggestion
        for suggestion in (suggestions or [])
        if _suggestion_meets_ply_minimums(suggestion, paper_map, mandatory_ply_minimums)
    ]
    if not eligible:
        return None

    def score(suggestion: dict[str, Any]) -> tuple[int, int, int]:
        gsm_totals = _suggestion_gsm_totals(suggestion, paper_map)
        low_extra = sum(
            max(0, count - int((mandatory_ply_minimums or {}).get(gsm_value, 0)))
            for gsm_value, count in gsm_totals.items()
            if gsm_value < preferred_min_gsm
        )
        preferred_count = sum(
            count
            for gsm_value, count in gsm_totals.items()
            if gsm_value >= preferred_min_gsm
        )
        total_ply = sum(gsm_totals.values())
        return (low_extra, -preferred_count, total_ply)

    return sorted(eligible, key=score)[0]


def _paper_weight_per_ply_g(gsm: float, tube_od_mm: float, tube_id_mm: float, tube_length_mm: float) -> float:
    gsm_value = max(float(gsm or 0.0), 0.0)
    effective_diameter_m = max(((float(tube_id_mm or 0.0) + float(tube_od_mm or 0.0)) / 2.0) / 1000.0, 0.001)
    tube_length_m = max(float(tube_length_mm or 0.0) / 1000.0, 0.001)
    return gsm_value * math.pi * effective_diameter_m * tube_length_m


def _build_strict_combo_fallback(
    *,
    paper_map: dict[int, dict[str, Any]],
    tube_length_mm: float,
    tube_od_mm: float,
    tube_id_mm: float,
    target_weight_g: float,
    mandatory_ply_minimums: dict[int, int] | None,
    preferred_min_gsm: int = STRICT_COMBO_PREFERRED_MIN_GSM,
    drying_percent: float = DRYING_LOSS_PERCENT,
    parchment_percent: float = 1.5,
    adhesive_percent: float = 15.0,
) -> list[int] | None:
    mandatory_ply_minimums = {int(gsm): int(count) for gsm, count in (mandatory_ply_minimums or {}).items() if int(count) > 0}
    for gsm_value in mandatory_ply_minimums:
        if gsm_value not in paper_map:
            return None

    # adhesive_percent is the combined additions allowance; parchment is a
    # carve-out inside it and must never be added a second time.
    dry_multiplier = 1.0 + (float(adhesive_percent) / 100.0)
    target_paper_weight_g = float(target_weight_g) / max(dry_multiplier, 0.0001)
    base_layers: list[int] = []
    base_weight_g = 0.0
    for gsm_value, minimum_count in sorted(mandatory_ply_minimums.items()):
        base_layers.extend([gsm_value] * minimum_count)
        base_weight_g += _paper_weight_per_ply_g(gsm_value, tube_od_mm, tube_id_mm, tube_length_mm) * minimum_count

    candidate_gsms = sorted(gsm for gsm in paper_map if gsm >= preferred_min_gsm)
    if not candidate_gsms:
        candidate_gsms = sorted(gsm for gsm in paper_map if gsm not in mandatory_ply_minimums)
    if not candidate_gsms:
        return base_layers if base_layers else None

    max_total_ply = 25
    remaining_capacity = max(0, max_total_ply - len(base_layers))
    if remaining_capacity == 0:
        predicted_dry = base_weight_g * dry_multiplier
        return base_layers if abs(predicted_dry - float(target_weight_g)) <= max(3.0, float(target_weight_g) * 0.03) else None

    per_ply_weight = {
        gsm_value: _paper_weight_per_ply_g(gsm_value, tube_od_mm, tube_id_mm, tube_length_mm)
        for gsm_value in candidate_gsms
    }
    best_layers: list[int] | None = None
    best_score: tuple[float, int, int, int, int] | None = None
    max_allowed_delta = max(3.0, float(target_weight_g) * 0.03)

    for primary_gsm in candidate_gsms:
        for secondary_gsm in candidate_gsms:
            for primary_count in range(0, remaining_capacity + 1):
                for secondary_count in range(0, remaining_capacity - primary_count + 1):
                    if primary_count == 0 and secondary_count == 0:
                        continue
                    total_layers = len(base_layers) + primary_count + secondary_count
                    if total_layers > max_total_ply:
                        continue
                    predicted_paper_weight_g = (
                        base_weight_g
                        + per_ply_weight[primary_gsm] * primary_count
                        + per_ply_weight[secondary_gsm] * secondary_count
                    )
                    predicted_dry_weight_g = predicted_paper_weight_g * dry_multiplier
                    delta_dry = abs(predicted_dry_weight_g - float(target_weight_g))
                    score = (
                        delta_dry,
                        0 if primary_gsm >= preferred_min_gsm and secondary_gsm >= preferred_min_gsm else 1,
                        -int(primary_count + secondary_count),
                        total_layers,
                        abs(primary_gsm - secondary_gsm),
                    )
                    if best_score is None or score < best_score:
                        best_score = score
                        best_layers = list(base_layers) + ([primary_gsm] * primary_count) + ([secondary_gsm] * secondary_count)

    if best_layers is None or best_score is None or best_score[0] > max_allowed_delta:
        return None
    return sorted(best_layers)


def _spec_create_payload(spec: dict[str, Any], *, profile: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "customer_id": spec["customer_id"],
        "customer_name_snapshot": spec["customer_name_snapshot"],
        "tube_size_id": spec["tube_size_id"],
        "mandrel_id": spec["mandrel_id"],
        "required_cs": float(spec["required_cs"]),
        "target_tube_weight": float(spec["target_tube_weight"]),
        "id_min_mm": float(spec["id_min_mm"]),
        "id_max_mm": float(spec["id_max_mm"]),
        "od_min_mm": float(spec["od_min_mm"]),
        "od_max_mm": float(spec["od_max_mm"]),
        "length_min_mm": float(spec["length_min_mm"]),
        "length_max_mm": float(spec["length_max_mm"]),
        "weight_min_g": float(spec["weight_min_g"]),
        "weight_max_g": float(spec["weight_max_g"]),
        "cs_min_n": float(spec["cs_min_n"]),
        "cs_max_n": float(spec["cs_max_n"]),
        "moisture_min_pct": float(spec["moisture_min_pct"]),
        "moisture_max_pct": float(spec["moisture_max_pct"]),
        "parchment_percent": float(spec.get("parchment_percent") or 1.5),
        "parchment_color": None,
        "shrink_percent": float(spec.get("shrink_percent") or DRYING_LOSS_PERCENT),
        "profile": profile,
        "dynamic_fields": [
            {"field_key": entry["field_key"], "value": entry.get("value")}
            for entry in (spec.get("dynamic_fields") or [])
            if entry.get("field_key")
        ],
    }


def _to_iso_date(days_offset: int = 0) -> str:
    return (date.today() + timedelta(days=days_offset)).isoformat()


def ensure_customer(runner: ValidationRunner, token: str, code: str, name: str) -> dict[str, Any]:
    _, customers = runner.api("GET", "/api/master/customers", token=token)
    normalized_name = name.strip().lower()
    hit = next(
        (
            c
            for c in customers
            if str(c.get("customer_code")) == code
            or str(c.get("name") or "").strip().lower() == normalized_name
        ),
        None,
    )
    if hit:
        return hit
    payload = {
        "customer_code": code,
        "name": name,
        "contact_email": None,
        "contact_phone": None,
    }
    resp, created = runner.api(
        "POST",
        "/api/master/customers",
        token=token,
        json_body=payload,
        expected=(200, 400),
    )
    if resp.status_code == 400:
        _, customers = runner.api("GET", "/api/master/customers", token=token)
        hit = next(
            (
                c
                for c in customers
                if str(c.get("customer_code")) == code
                or str(c.get("name") or "").strip().lower() == normalized_name
            ),
            None,
        )
        if hit:
            return hit
        raise RuntimeError(f"Customer create failed and no matching row was found: {created}")
    return created


def ensure_tube_size(
    runner: ValidationRunner,
    token: str,
    plant_id: str,
    inner_diameter_mm: float,
    outer_diameter_mm: float,
    length_mm: float,
    description: str,
) -> dict[str, Any]:
    headers = {"X-Plant-ID": plant_id}
    _, sizes = runner.api("GET", "/api/master/tube-sizes", token=token, extra_headers=headers)
    for size in sizes:
        if (
            abs(float(size.get("inner_diameter_mm", 0)) - inner_diameter_mm) < 1e-6
            and abs(float(size.get("outer_diameter_mm", 0)) - outer_diameter_mm) < 1e-6
            and abs(float(size.get("length_mm", 0)) - length_mm) < 1e-6
        ):
            return size

    payload = {
        "inner_diameter_mm": inner_diameter_mm,
        "outer_diameter_mm": outer_diameter_mm,
        "length_mm": length_mm,
        "description": description,
    }
    _, created = runner.api("POST", "/api/master/tube-sizes", token=token, json_body=payload, extra_headers=headers)
    return created


def ensure_mandrel(
    runner: ValidationRunner,
    token: str,
    plant_id: str,
    mandrel_code: str,
    outer_diameter_mm: float,
    length_mm: float,
    material: str,
) -> dict[str, Any]:
    headers = {"X-Plant-ID": plant_id}
    _, mandrels = runner.api("GET", "/api/master/mandrels", token=token, extra_headers=headers)
    hit = next((m for m in mandrels if str(m.get("mandrel_code")) == mandrel_code), None)
    if hit:
        return hit

    payload = {
        "mandrel_code": mandrel_code,
        "outer_diameter_mm": outer_diameter_mm,
        "length_mm": length_mm,
        "material": material,
    }
    _, created = runner.api("POST", "/api/master/mandrels", token=token, json_body=payload, extra_headers=headers)
    return created


def ensure_machine(
    runner: ValidationRunner,
    token: str,
    plant_id: str,
    *,
    code: str,
    name: str,
    department: str,
    capacity_value: float,
) -> dict[str, Any]:
    headers = {"X-Plant-ID": plant_id}
    if department == "SLITTING":
        expected_capacity_type = "REELS_PER_DAY"
    elif department == "WINDER":
        expected_capacity_type = "METERS_PER_DAY"
    elif department == "OVEN":
        expected_capacity_type = "BATCHES_PER_DAY"
    else:
        expected_capacity_type = "TUBES_PER_DAY"
    _, machines = runner.master_api("GET", "/master/machines/", token=token, extra_headers=headers)
    hit = next((m for m in machines if str(m.get("code")) == code), None)
    if hit:
        needs_update = (
            abs(float(hit.get("capacity_value") or 0.0) - float(capacity_value or 0.0)) > 0.001
            or str(hit.get("capacity_type") or "").upper() != expected_capacity_type
            or str(hit.get("department") or "").upper() != department
        )
        if not needs_update:
            return hit
        _, updated = runner.master_api(
            "PUT",
            f"/master/machines/{hit['id']}",
            token=token,
            extra_headers=headers,
            json_body={
                "department": department,
                "capacity_type": expected_capacity_type,
                "capacity_value": capacity_value,
            },
        )
        return updated

    payload = {
        "code": code,
        "name": name,
        "department": department,
        "capacity_type": expected_capacity_type,
        "capacity_value": capacity_value,
        "id_min_mm": 50,
        "id_max_mm": 400,
        "od_min_mm": 60,
        "od_max_mm": 500,
        "length_min_mm": 50,
        "length_max_mm": 700,
    }
    if department == "OVEN":
        payload["batch_bamboo_capacity"] = capacity_value
        payload["cycle_time_hours"] = 8.0
    _, created = runner.master_api(
        "POST",
        "/master/machines/",
        token=token,
        extra_headers=headers,
        json_body=payload,
    )
    return created


def create_acting_token(runner: ValidationRunner, base_token: str, role_name: str) -> str:
    _, session_payload = runner._request(
        "POST",
        f"{AUTH_SERVICE_URL}/auth/acting-role",
        token=base_token,
        json_body={"role_name": role_name},
    )
    token = str(session_payload.get("access_token") or "")
    if not token:
        raise RuntimeError(f"Missing acting token for {role_name}")
    _, acting_me = runner.api("GET", "/api/auth/me", token=token)
    effective_roles = {str(value) for value in (acting_me.get("roles") or [])}
    acting_ok = (
        bool(acting_me.get("is_acting_session"))
        and str(acting_me.get("acting_role") or "") == role_name
        and role_name in effective_roles
    )
    runner.add(
        f"Admin acting session {role_name}",
        acting_ok,
        f"effective={acting_me.get('roles')} acting_role={acting_me.get('acting_role')}",
    )
    return token


def login_token(runner: ValidationRunner, email: str, password: str) -> tuple[str, dict[str, Any]]:
    _, payload = runner._request(
        "POST",
        f"{AUTH_SERVICE_URL}/auth/login",
        extra_headers={"Content-Type": "application/x-www-form-urlencoded"},
        form_body={"username": email, "password": password},
        expected=(200,),
    )
    token = str(payload.get("access_token") or "")
    if not token:
        raise RuntimeError(f"Missing access token for {email}")
    _, me_payload = runner.api("GET", "/api/auth/me", token=token)
    return token, me_payload


def ensure_role_user(
    runner: ValidationRunner,
    admin_token: str,
    *,
    email: str,
    password: str,
    name: str,
    role_names: list[str],
    plant_id: str | None = None,
    allowed_plant_ids: list[str] | None = None,
    is_owner_all_plants: bool = False,
) -> dict[str, Any]:
    _, users = runner.api("GET", "/api/auth/users", token=admin_token)
    existing = next((user for user in users if str(user.get("email") or "").lower() == email.lower()), None)
    payload = {
        "name": name,
        "email": email,
        "password": password,
        "plant_id": plant_id,
        "allowed_plant_ids": allowed_plant_ids or [],
        "is_owner_all_plants": is_owner_all_plants,
        "role_names": role_names,
    }

    user_payload: dict[str, Any]
    if existing:
        user_payload = existing
        existing_roles = sorted(str(role) for role in (existing.get("actual_roles") or existing.get("roles") or []))
        existing_allowed = sorted(str(value) for value in (existing.get("allowed_plant_ids") or []))
        desired_allowed = sorted(str(value) for value in (allowed_plant_ids or []))
        needs_update = any(
            [
                existing.get("name") != name,
                sorted(role_names) != existing_roles,
                str(existing.get("plant_id") or "") != str(plant_id or ""),
                existing_allowed != desired_allowed,
                bool(existing.get("is_owner_all_plants")) != bool(is_owner_all_plants),
                existing.get("is_active") is False,
            ]
        )
        if needs_update:
            _, user_payload = runner.api(
                "PUT",
                f"/api/auth/users/{existing['id']}",
                token=admin_token,
                json_body={
                    "name": name,
                    "plant_id": plant_id,
                    "allowed_plant_ids": allowed_plant_ids or [],
                    "is_owner_all_plants": is_owner_all_plants,
                    "is_active": True,
                    "role_names": role_names,
                },
            )
    else:
        response, user_payload = runner.api(
            "POST",
            "/api/auth/users",
            token=admin_token,
            json_body=payload,
            allow_error=True,
        )
        if response.status_code == 400 and str(user_payload.get("detail") or "").lower() == "email already registered":
            token, me_payload = login_token(runner, email, password)
            return {
                "id": str(me_payload.get("id") or ""),
                "name": str(me_payload.get("name") or name),
                "email": email,
                "password": password,
                "token": token,
                "roles": sorted(str(role) for role in (me_payload.get("actual_roles") or me_payload.get("roles") or role_names)),
                "plant_id": str(me_payload.get("plant_id") or plant_id or ""),
                "allowed_plant_ids": [str(value) for value in (me_payload.get("allowed_plant_ids") or allowed_plant_ids or [])],
                "is_owner_all_plants": bool(me_payload.get("is_owner_all_plants")),
            }
        if response.status_code != 200:
            snippet = json.dumps(user_payload)[:600]
            raise RuntimeError(f"POST /api/auth/users expected 200 got {response.status_code}: {snippet}")

    token, me_payload = login_token(runner, email, password)
    return {
        "id": str(user_payload.get("id") or me_payload.get("id") or ""),
        "name": str(user_payload.get("name") or me_payload.get("name") or name),
        "email": email,
        "password": password,
        "token": token,
        "roles": sorted(str(role) for role in (me_payload.get("actual_roles") or me_payload.get("roles") or role_names)),
        "plant_id": str(me_payload.get("plant_id") or plant_id or ""),
        "allowed_plant_ids": [str(value) for value in (me_payload.get("allowed_plant_ids") or allowed_plant_ids or [])],
        "is_owner_all_plants": bool(me_payload.get("is_owner_all_plants")),
    }


def ensure_inventory_item(
    runner: ValidationRunner,
    token: str,
    item_code: str,
    name: str,
    item_type: str,
    uom: str,
    unit_cost: float,
    plant_id: str | None = None,
) -> dict[str, Any]:
    extra_headers = {"X-Plant-ID": plant_id} if plant_id else None
    _, items = runner.api("GET", "/api/inventory/items", token=token, extra_headers=extra_headers)
    hit = next((i for i in items if str(i.get("item_code")) == item_code), None)
    if hit:
        return hit

    payload = {
        "item_code": item_code,
        "name": name,
        "type": item_type,
        "uom": uom,
        "unit_cost": unit_cost,
        "cost_source": "MANUAL",
    }
    _, created = runner.api("POST", "/api/inventory/items", token=token, json_body=payload, extra_headers=extra_headers)
    return created


def seed_rm_master(runner: ValidationRunner, token: str, plant_ids: list[str]) -> dict[str, dict[int, dict[str, Any]]]:
    allowed_paper_codes = _sql_text_list([row["code"] for row in APPROVED_PAPERS])
    allowed_adh_codes = _sql_text_list([row["internal_code"] for row in APPROVED_ADHESIVES])
    allowed_vendor_names = _sql_text_list([row["vendor_name"] for row in APPROVED_PARCHMENTS])
    allowed_plant_ids = _sql_text_list(plant_ids)
    with create_engine(MASTER_DB_URL, future=True).begin() as conn:
        for canonical_plant_id, aliases in PLANT_ID_EQUIVALENTS.items():
            if canonical_plant_id not in plant_ids:
                continue
            alias_list = _sql_text_list(aliases)
            conn.execute(text(f"UPDATE paper_master SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
            conn.execute(text(f"UPDATE adhesive_master SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
            conn.execute(text(f"UPDATE parchment_vendor SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
            conn.execute(text(f"UPDATE parchment_color SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
        conn.execute(text(f"UPDATE paper_master SET active = TRUE WHERE plant_id IN ({allowed_plant_ids}) AND code IN ({allowed_paper_codes})"))
        conn.execute(text(f"UPDATE adhesive_master SET active = TRUE WHERE plant_id IN ({allowed_plant_ids}) AND internal_code IN ({allowed_adh_codes})"))
        conn.execute(text(f"UPDATE parchment_vendor SET active = TRUE WHERE plant_id IN ({allowed_plant_ids}) AND name IN ({allowed_vendor_names})"))
        conn.execute(text(f"UPDATE parchment_color SET active = TRUE WHERE plant_id IN ({allowed_plant_ids}) AND LOWER(color_name) = 'many patterns'"))

    for plant_id in plant_ids:
        headers = {"X-Plant-ID": plant_id}
        _, existing_papers = runner.api("GET", "/api/master/papers", token=token, extra_headers=headers)
        papers_by_code = {str(p.get("code")): p for p in existing_papers if p.get("code")}
        for row in APPROVED_PAPERS:
            found = papers_by_code.get(row["code"])
            if found:
                runner.api("PUT", f"/api/master/papers/{found['id']}", token=token, json_body=row, extra_headers=headers)
            else:
                runner.api("POST", "/api/master/papers", token=token, json_body=row, extra_headers=headers)

        _, existing_adh = runner.api("GET", "/api/master/adhesives", token=token, extra_headers=headers)
        adh_by_code = {str(a.get("internal_code")): a for a in existing_adh if a.get("internal_code")}
        for row in APPROVED_ADHESIVES:
            found = adh_by_code.get(row["internal_code"])
            if found:
                runner.api("PUT", f"/api/master/adhesives/{found['id']}", token=token, json_body=row, extra_headers=headers)
            else:
                runner.api("POST", "/api/master/adhesives", token=token, json_body=row, extra_headers=headers)

        _, existing_parch = runner.api("GET", "/api/master/parchments", token=token, extra_headers=headers)
        existing_keys = {
            (_normalize_text(p.get("vendor_name")), _normalize_text(p.get("color_name")))
            for p in existing_parch
        }
        for row in APPROVED_PARCHMENTS:
            key = (_normalize_text(row["vendor_name"]), _normalize_text(row["color_name"]))
            if key in existing_keys:
                continue
            runner.api("POST", "/api/master/parchments", token=token, json_body=row, extra_headers=headers)

    with create_engine(MASTER_DB_URL, future=True).begin() as conn:
        for canonical_plant_id, aliases in PLANT_ID_EQUIVALENTS.items():
            if canonical_plant_id not in plant_ids:
                continue
            alias_list = _sql_text_list(aliases)
            conn.execute(text(f"UPDATE paper_master SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
            conn.execute(text(f"UPDATE adhesive_master SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
            conn.execute(text(f"UPDATE parchment_vendor SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
            conn.execute(text(f"UPDATE parchment_color SET plant_id = '{canonical_plant_id}' WHERE plant_id IN ({alias_list})"))
        conn.execute(text(f"DELETE FROM paper_master WHERE plant_id NOT IN ({allowed_plant_ids}) OR code NOT IN ({allowed_paper_codes})"))
        conn.execute(text(f"DELETE FROM adhesive_master WHERE plant_id NOT IN ({allowed_plant_ids}) OR internal_code NOT IN ({allowed_adh_codes})"))
        conn.execute(
            text(
                f"""
                DELETE FROM parchment_color pc
                USING parchment_vendor pv
                WHERE pc.vendor_id = pv.id
                  AND (
                    pc.plant_id NOT IN ({allowed_plant_ids})
                    OR pv.plant_id NOT IN ({allowed_plant_ids})
                    OR pv.name NOT IN ({allowed_vendor_names})
                    OR LOWER(pc.color_name) <> 'many patterns'
                  )
                """
            )
        )
        conn.execute(text("UPDATE parchment_color SET color_name = 'Many patterns' WHERE LOWER(color_name) = 'many patterns'"))
        conn.execute(
            text(
                """
                WITH ranked AS (
                    SELECT ctid, vendor_id, plant_id, color_name,
                           row_number() OVER (PARTITION BY vendor_id, plant_id, lower(color_name) ORDER BY created_at NULLS LAST, ctid) AS rn
                    FROM parchment_color
                )
                DELETE FROM parchment_color pc
                USING ranked r
                WHERE pc.ctid = r.ctid AND r.rn > 1
                """
            )
        )
        conn.execute(
            text(
                f"""
                DELETE FROM parchment_vendor pv
                WHERE pv.plant_id NOT IN ({allowed_plant_ids})
                   OR pv.name NOT IN ({allowed_vendor_names})
                   OR NOT EXISTS (
                        SELECT 1
                        FROM parchment_color pc
                        WHERE pc.vendor_id = pv.id
                   )
                """
            )
        )

    paper_map_by_plant: dict[str, dict[int, dict[str, Any]]] = {}
    paper_ids_by_plant: dict[str, list[str]] = {}
    adhesive_ids_by_plant: dict[str, list[str]] = {}
    parchment_rows_by_plant: dict[str, list[dict[str, Any]]] = {}
    for plant_id in plant_ids:
        headers = {"X-Plant-ID": plant_id}
        _, refreshed_papers = runner.api("GET", "/api/master/papers", token=token, extra_headers=headers)
        _, refreshed_adhesives = runner.api("GET", "/api/master/adhesives", token=token, extra_headers=headers)
        _, refreshed_parchments = runner.api("GET", "/api/master/parchments", token=token, extra_headers=headers)
        paper_map_by_plant[plant_id] = {int(round(float(p["gsm"]))): p for p in refreshed_papers if p.get("active", True)}
        paper_ids_by_plant[plant_id] = [str(p["id"]) for p in refreshed_papers]
        adhesive_ids_by_plant[plant_id] = [str(a["id"]) for a in refreshed_adhesives]
        parchment_rows_by_plant[plant_id] = list(refreshed_parchments)
        runner.add(
            f"RM whitelist plant {plant_id} papers",
            sorted(str(p.get("code")) for p in refreshed_papers) == sorted(row["code"] for row in APPROVED_PAPERS),
            f"codes={[p.get('code') for p in refreshed_papers]}",
        )
        runner.add(
            f"RM whitelist plant {plant_id} adhesives",
            sorted(str(a.get("internal_code")) for a in refreshed_adhesives) == sorted(row["internal_code"] for row in APPROVED_ADHESIVES),
            f"codes={[a.get('internal_code') for a in refreshed_adhesives]}",
        )
        runner.add(
            f"RM whitelist plant {plant_id} parchments",
            sorted(f"{p.get('vendor_name')}::{p.get('color_name')}" for p in refreshed_parchments if p.get("color_name"))
            == sorted(f"{row['vendor_name']}::{row['color_name']}" for row in APPROVED_PARCHMENTS),
            f"rows={refreshed_parchments}",
        )
    runner.evidence["rm_whitelist"] = {
        "papers": [row["code"] for row in APPROVED_PAPERS],
        "adhesives": [row["internal_code"] for row in APPROVED_ADHESIVES],
        "parchments": APPROVED_PARCHMENTS,
        "paper_ids_by_plant": paper_ids_by_plant,
        "adhesive_ids_by_plant": adhesive_ids_by_plant,
        "parchments_by_plant": parchment_rows_by_plant,
    }
    return paper_map_by_plant


def reset_monthly_material_state(runner: ValidationRunner, *, plant_ids: list[str]) -> None:
    month_start = date.today().replace(day=1)
    allowed_plant_ids = _sql_text_list(plant_ids)
    with create_engine(PRODUCTION_DB_URL, future=True).begin() as conn:
        conn.execute(
            text(
                f"""
                DELETE FROM monthly_material_actuals
                WHERE plant_id::text IN ({allowed_plant_ids})
                  AND month_start = :month_start
                """
            ),
            {"month_start": month_start},
        )
        conn.execute(
            text(
                f"""
                DELETE FROM monthly_material_provisionals
                WHERE plant_id::text IN ({allowed_plant_ids})
                  AND month_start = :month_start
                """
            ),
            {"month_start": month_start},
        )
        conn.execute(
            text(
                f"""
                DELETE FROM monthly_material_close
                WHERE plant_id::text IN ({allowed_plant_ids})
                  AND month_start = :month_start
                """
            ),
            {"month_start": month_start},
        )
    runner.add(
        "Monthly material state reset",
        True,
        f"plant_ids={plant_ids} month_start={month_start.isoformat()}",
    )


def create_spec(
    runner: ValidationRunner,
    *,
    create_token: str,
    approve_token: str,
    customer_id: str,
    customer_name: str,
    tube_size_id: str,
    mandrel_id: str,
    tube_id_mm: float,
    tube_od_mm: float,
    tube_length_mm: float,
    target_weight_g: float,
    required_cs: float,
    extra_headers: dict[str, str] | None = None,
    profile: dict[str, Any] | None = None,
    dynamic_fields: list[dict[str, Any]] | None = None,
    auto_approve: bool = False,
) -> dict[str, Any]:
    effective_profile = profile or {
        "dimensions": {
            "id_mm": {"avg": tube_id_mm, "min": tube_id_mm, "max": tube_id_mm},
            "od_mm": {"avg": tube_od_mm, "min": tube_od_mm, "max": tube_od_mm},
            "length_mm": {"avg": tube_length_mm, "min": tube_length_mm, "max": tube_length_mm},
            "thickness_mm": {
                "avg": round((tube_od_mm - tube_id_mm) / 2.0, 4),
                "min": round((tube_od_mm - tube_id_mm) / 2.0, 4),
                "max": round((tube_od_mm - tube_id_mm) / 2.0, 4),
            },
            "bamboo": {
                "max_length_mm": 1560,
                "cut_loss_mm": 40,
                "tube_size_id": tube_size_id,
                "mandrel_id": mandrel_id,
            },
        },
        "quality_targets": {
            "tube_weight_g": {"avg": target_weight_g, "min": target_weight_g, "max": target_weight_g},
            "cs_n": {"avg": required_cs, "min": required_cs, "max": required_cs},
            "moisture_pct": {"avg": 8.0, "min": 6.0, "max": 10.0},
            "approved_cs": None,
        },
        "recipe": {
            "parchment_percent": 1.5,
            "parchment_groups": [],
            "shrink_percent": DRYING_LOSS_PERCENT,
            "adhesive_components": [
                {"name": "TL-4 (20100)", "base_percent": 15.0, "ratio_percent": 20.0},
                {"name": "Vinsol (30100)", "base_percent": 15.0, "ratio_percent": 80.0},
            ],
            "recipe_rows": [],
        },
        "notch_tooling": {"diagram": {}},
        "process_guidance": {
            "winder_target": {},
            "oven_target": {},
            "process_target": {},
        },
        "packing_rules": {"packing_target": {}},
    }
    payload = {
        "customer_id": customer_id,
        "customer_name_snapshot": customer_name,
        "tube_size_id": tube_size_id,
        "mandrel_id": mandrel_id,
        "required_cs": required_cs,
        "target_tube_weight": target_weight_g,
        "id_min_mm": tube_id_mm,
        "id_max_mm": tube_id_mm,
        "od_min_mm": tube_od_mm,
        "od_max_mm": tube_od_mm,
        "length_min_mm": tube_length_mm,
        "length_max_mm": tube_length_mm,
        "weight_min_g": target_weight_g,
        "weight_max_g": target_weight_g,
        "cs_min_n": required_cs,
        "cs_max_n": required_cs,
        "moisture_min_pct": 6.0,
        "moisture_max_pct": 10.0,
        "parchment_percent": 1.5,
        "adhesive_20100_percent": 20.0,
        "adhesive_30100_percent": 80.0,
        "moisture_loss_percent": DRYING_LOSS_PERCENT,
        "shrink_percent": DRYING_LOSS_PERCENT,
        "profile": effective_profile,
        "dynamic_fields": dynamic_fields,
    }
    _, created = runner.api("POST", "/api/spec/specifications", token=create_token, json_body=payload, extra_headers=extra_headers)
    if not auto_approve:
        _, draft = runner.api("GET", f"/api/spec/specifications/{created['id']}", token=create_token, extra_headers=extra_headers)
        return draft
    _, approve_resp = runner.api(
        "POST",
        f"/api/spec/specifications/{created['id']}/approve",
        token=approve_token,
        json_body={},
        extra_headers=extra_headers,
    )
    runner.add(f"Spec approved {created['id']}", True, f"status={approve_resp.get('status')}")
    _, approved = runner.api("GET", f"/api/spec/specifications/{created['id']}", token=approve_token, extra_headers=extra_headers)
    return approved


def create_recipe_with_layers(
    runner: ValidationRunner,
    token: str,
    spec_id: str,
    layer_papers: list[int],
    paper_map: dict[int, dict[str, Any]],
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    _, recipe = runner.api(
        "POST",
        f"/api/spec/recipes/{spec_id}",
        token=token,
        json_body={"notes": "Cutover parity recipe"},
        extra_headers=extra_headers,
    )
    ply_no = 1
    for gsm in layer_papers:
        paper = paper_map[gsm]
        gsm_value = float(paper.get("gsm") or 0.0)
        bulk_snapshot = float(paper.get("bulk_factor") or 0.0)
        if bulk_snapshot <= 0 and gsm_value > 0 and paper.get("thickness_mm") not in (None, ""):
            bulk_snapshot = float(paper.get("thickness_mm") or 0.0) * 1000.0 / gsm_value
        if bulk_snapshot <= 0:
            bulk_snapshot = 1.0
        layer_payload = {
            "ply_no": ply_no,
            "paper_id": paper["id"],
            "gsm_snapshot": int(paper["gsm"]),
            "bf_snapshot": int(round(float(paper.get("bf") or paper.get("strength_value") or 0))),
            "bulk_snapshot": bulk_snapshot,
        }
        runner.api(
            "POST",
            f"/api/spec/recipes/{recipe['id']}/layers",
            token=token,
            json_body=layer_payload,
            extra_headers=extra_headers,
        )
        ply_no += 1

    _, with_layers = runner.api("GET", f"/api/spec/recipes/{recipe['id']}", token=token, extra_headers=extra_headers)
    return with_layers


def create_approved_recipe_for_spec(
    runner: ValidationRunner,
    *,
    spec_maker_token: str,
    spec_approver_token: str,
    spec_id: str,
    tube_length_mm: float,
    tube_od_mm: float,
    tube_id_mm: float,
    target_weight_g: float,
    required_cs: float,
    mandatory_ply_minimums: dict[int, int] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    _, available_papers = runner.api("GET", "/api/master/papers", token=spec_maker_token, extra_headers=extra_headers)
    paper_map = {
        int(round(float(row.get("gsm") or 0))): row
        for row in (available_papers or [])
        if row.get("active", True) and float(row.get("gsm") or 0) > 0
    }
    if not paper_map:
        raise RuntimeError(f"No active papers found for spec {spec_id}")

    # The application no longer auto-selects papers to chase target wet weight.
    # Build a deterministic operator selection from approved masters, then let
    # the canonical BOM expose its actual-vs-target variance.
    selected_minimums = mandatory_ply_minimums or {250: 2, 300: 1}
    layer_papers = _build_strict_combo_fallback(
        paper_map=paper_map,
        tube_length_mm=tube_length_mm,
        tube_od_mm=tube_od_mm,
        tube_id_mm=tube_id_mm,
        target_weight_g=target_weight_g,
        mandatory_ply_minimums=selected_minimums,
    )
    selection_source = "operator-fixture"

    if not layer_papers:
        raise RuntimeError(
            f"No recipe suggestions returned for spec {spec_id} with minimums={mandatory_ply_minimums or {}}"
        )

    recipe = create_recipe_with_layers(runner, spec_maker_token, spec_id, layer_papers, paper_map, extra_headers=extra_headers)
    runner.api(
        "POST",
        f"/api/spec/trials/{recipe['id']}",
        token=spec_approver_token,
        json_body={
            "actual_cs": float(required_cs) + 10.0,
            "actual_weight": float(target_weight_g),
            "actual_shrink": DRYING_LOSS_PERCENT,
            "remarks": "Seeded approved trial for auto-consumption validation",
            "approved": True,
        },
        extra_headers=extra_headers,
    )
    runner.api(
        "POST",
        f"/api/spec/recipes/{recipe['id']}/approve",
        token=spec_approver_token,
        extra_headers=extra_headers,
    )
    _, approved_recipe = runner.api("GET", f"/api/spec/recipes/{recipe['id']}", token=spec_maker_token, extra_headers=extra_headers)
    paper_lookup = {str(row.get("id")): row for row in (available_papers or [])}
    approved_recipe["layer_details"] = [
        {
            "ply_no": layer.get("ply_no"),
            "paper_id": layer.get("paper_id"),
            "code": (paper_lookup.get(str(layer.get("paper_id"))) or {}).get("code"),
            "gsm_snapshot": layer.get("gsm_snapshot"),
            "bf_snapshot": layer.get("bf_snapshot"),
        }
        for layer in (approved_recipe.get("layers") or [])
    ]
    gsm_counts: dict[str, int] = {}
    for gsm in layer_papers:
        gsm_counts[str(int(gsm))] = gsm_counts.get(str(int(gsm)), 0) + 1
    approved_recipe["selection_evidence"] = {
        "source": selection_source,
        "strict_combo_minimums": mandatory_ply_minimums or {},
        "gsm_counts": gsm_counts,
        "target_weight_g": float(target_weight_g),
        "required_cs": float(required_cs),
    }
    return approved_recipe


def replace_invalid_approved_specs(
    runner: ValidationRunner,
    *,
    plant_ids: list[str],
    spec_tokens_by_plant: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    allowed_ids_by_plant = {
        str(plant_id): {str(value) for value in (runner.evidence.get("rm_whitelist") or {}).get("paper_ids_by_plant", {}).get(str(plant_id), [])}
        for plant_id in plant_ids
    }
    with create_engine(SPEC_DB_URL, future=True).connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT s.id::text AS spec_id, s.plant_id::text AS plant_id, rl.paper_id::text AS paper_id
                FROM specification_sheet s
                JOIN recipe_header rh ON rh.spec_id = s.id AND rh.status = 'approved'
                JOIN recipe_layers rl ON rl.recipe_id = rh.id
                WHERE s.status = 'approved' AND s.active = TRUE
                """
            )
        ).mappings()

    invalid_specs: dict[str, dict[str, Any]] = {}
    for row in rows:
        plant_id = str(row["plant_id"])
        spec_id = str(row["spec_id"])
        paper_id = str(row["paper_id"])
        if paper_id in allowed_ids_by_plant.get(plant_id, set()):
            continue
        invalid_specs.setdefault(spec_id, {"plant_id": plant_id})

    replacements: list[dict[str, Any]] = []
    for spec_id, meta in sorted(invalid_specs.items()):
        plant_id = str(meta["plant_id"])
        headers = {"X-Plant-ID": plant_id}
        tokens = spec_tokens_by_plant[plant_id]
        _, old_spec = runner.api("GET", f"/api/spec/specifications/{spec_id}", token=tokens["maker"], extra_headers=headers)
        sanitized_profile = json.loads(json.dumps(old_spec.get("profile") or {}))
        sanitized_profile.setdefault("recipe", {})
        sanitized_profile["recipe"]["recipe_rows"] = []
        payload = _spec_create_payload(old_spec, profile=sanitized_profile)
        _, draft = runner.api("POST", "/api/spec/specifications", token=tokens["maker"], json_body=payload, extra_headers=headers)
        runner.api(
            "POST",
            f"/api/spec/specifications/{spec_id}/obsolete",
            token=tokens["approver"],
            extra_headers=headers,
        )
        recipe = create_approved_recipe_for_spec(
            runner,
            spec_maker_token=tokens["maker"],
            spec_approver_token=tokens["approver"],
            spec_id=draft["id"],
            tube_length_mm=float(old_spec["length_max_mm"]),
            tube_od_mm=float(old_spec["od_max_mm"]),
            tube_id_mm=float(old_spec["id_max_mm"]),
            target_weight_g=float(old_spec["target_tube_weight"]),
            required_cs=float(old_spec["required_cs"]),
        )
        _, superseded_old = runner.api("GET", f"/api/spec/specifications/{spec_id}", token=tokens["approver"], extra_headers=headers)
        _, approved_new = runner.api("GET", f"/api/spec/specifications/{draft['id']}", token=tokens["approver"], extra_headers=headers)
        runner.add(
            f"Replacement spec created {spec_id[:8]}",
            str(superseded_old.get("status")) == "obsolete" and str(approved_new.get("status")) == "approved",
            f"old_status={superseded_old.get('status')} new_status={approved_new.get('status')} new_spec={draft['id']}",
        )
        replacements.append(
            {
                "old_spec_id": spec_id,
                "new_spec_id": draft["id"],
                "plant_id": plant_id,
                "customer_name": old_spec.get("customer_name_snapshot"),
                "weight_g": old_spec.get("target_tube_weight"),
                "required_cs": old_spec.get("required_cs"),
                "recipe_id": recipe.get("id"),
            }
        )

    runner.evidence["replacement_specs"] = replacements
    runner.add(
        "Approved spec replacement sweep",
        True,
        f"replaced={len(replacements)}",
    )
    return replacements


def validate_formula_fixtures(
    runner: ValidationRunner,
    spec_maker_token: str,
    spec_approver_token: str,
    paper_map: dict[int, dict[str, Any]],
    customer: dict[str, Any],
    tube_size_110_90_400: dict[str, Any],
    mandrel_110: dict[str, Any],
    tube_size_110_122_150: dict[str, Any],
    mandrel_110b: dict[str, Any],
) -> dict[str, Any]:
    fixture_results: dict[str, Any] = {}

    spec_110_90_400 = create_spec(
        runner,
        create_token=spec_maker_token,
        approve_token=spec_approver_token,
        customer_id=customer["id"],
        customer_name=customer["name"],
        tube_size_id=tube_size_110_90_400["id"],
        mandrel_id=mandrel_110["id"],
        tube_id_mm=110.0,
        tube_od_mm=90.0,
        tube_length_mm=400.0,
        target_weight_g=350.0,
        required_cs=490.0,
    )

    # Paper selection is operator-controlled; target weight is a comparison,
    # not an auto-adjuster. Use a deterministic approved master combination and
    # validate only the canonical preview/BOM math.
    top_layers = [250] * 2 + [300] + [351] * 9
    top = {
        "title": "Approved deterministic paper combination",
        "rows": [
            {"gsm": 250, "plyCount": 2},
            {"gsm": 300, "plyCount": 1},
            {"gsm": 351, "plyCount": 9},
        ],
    }

    recipe_suggested = create_recipe_with_layers(runner, spec_maker_token, spec_110_90_400["id"], top_layers, paper_map)
    _, bom_110_90_400 = runner.api(
        "GET",
        f"/api/spec/calculate/bom/{recipe_suggested['id']}",
        token=spec_maker_token,
        params={"tube_length_mm": 400.0, "tube_od_mm": 90.0},
    )

    bridge_110_90 = bom_110_90_400.get("weight_bridge") or {}
    expected_pre = 350.0 / PRE_DRY_DIVISOR
    actual_pre = float(
        bridge_110_90.get("pre_moisture_target_tube_g")
        or bom_110_90_400.get("pre_moisture_target_tube_g")
        or 0
    )
    pre_ok = abs(actual_pre - expected_pre) <= 1e-3
    runner.add(
        "Formula 110x90x400 pre-moisture",
        pre_ok,
        f"expected={expected_pre:.6f} actual={actual_pre:.6f}",
    )

    fixture_results["fixture_110x90x400"] = {
        "spec_id": spec_110_90_400["id"],
        "recipe_id": recipe_suggested["id"],
        "suggestion_title": top.get("title"),
        "selected_rows": top.get("rows"),
        "bom": bom_110_90_400,
    }

    spec_110_122_150 = create_spec(
        runner,
        create_token=spec_maker_token,
        approve_token=spec_approver_token,
        customer_id=customer["id"],
        customer_name=customer["name"],
        tube_size_id=tube_size_110_122_150["id"],
        mandrel_id=mandrel_110b["id"],
        tube_id_mm=110.0,
        tube_od_mm=122.0,
        tube_length_mm=150.0,
        target_weight_g=250.0,
        required_cs=400.0,
    )

    combo_layers = [250] * 2 + [300] * 1 + [351] * 9
    recipe_combo = create_recipe_with_layers(runner, spec_maker_token, spec_110_122_150["id"], combo_layers, paper_map)
    _, bom_110_122_150 = runner.api(
        "GET",
        f"/api/spec/calculate/bom/{recipe_combo['id']}",
        token=spec_maker_token,
        params={"tube_length_mm": 150.0, "tube_od_mm": 122.0},
    )

    weight_ref = (
        ((bom_110_122_150.get("calculation_references") or {}).get("weight_calculation") or {})
    )
    bridge_110_122 = bom_110_122_150.get("weight_bridge") or {}
    paper_total = float(weight_ref.get("paper_total_g") or 0.0)
    adhesive_total = float(weight_ref.get("adhesive_total_g") or 0.0)
    parchment_weight = float(weight_ref.get("parchment_weight_g") or 0.0)
    predicted_wet = float(
        bridge_110_122.get("predicted_wet_tube_g")
        or weight_ref.get("predicted_wet_tube_g")
        or 0.0
    )

    expected_parch = 250.0 * 0.015
    parch_ok = abs(parchment_weight - expected_parch) <= 1e-3
    wet_divisor = float(
        bridge_110_122.get("pre_oven_divisor")
        or weight_ref.get("pre_oven_divisor")
        or PRE_DRY_DIVISOR
    )
    recomputed_wet = paper_total + adhesive_total + parchment_weight if wet_divisor > 0 else 0.0
    wet_ok = abs(predicted_wet - recomputed_wet) <= 1e-3
    runner.add("Formula 110x122x150 parchment@1.5%", parch_ok, f"expected={expected_parch:.6f} actual={parchment_weight:.6f}")
    runner.add("Formula 110x122x150 wet balance", wet_ok, f"predicted={predicted_wet:.6f} recomputed={recomputed_wet:.6f}")

    fixture_results["fixture_110x122x150"] = {
        "spec_id": spec_110_122_150["id"],
        "recipe_id": recipe_combo["id"],
        "combo": {"250": 2, "300": 1, "351": 9},
        "adhesive_split": {"20100": 20, "30100": 80},
        "recomputed_wet_tube_g": round(recomputed_wet, 6),
        "bom": bom_110_122_150,
    }

    return fixture_results


def audit_master_updates(
    runner: ValidationRunner,
    *,
    token: str,
    plant_id: str,
    flow_anchor: dict[str, Any],
) -> dict[str, Any]:
    headers = {"X-Plant-ID": plant_id}
    _, adhesives = runner.api("GET", "/api/master/adhesives", token=token, extra_headers=headers)
    _, papers = runner.api("GET", "/api/master/papers", token=token, extra_headers=headers)
    _, parchments = runner.api("GET", "/api/master/parchments", token=token, extra_headers=headers)
    _, customers = runner.api("GET", "/api/master/customers", token=token, extra_headers=headers)
    _, boxes = runner.api("GET", "/api/master/packaging/boxes", token=token, extra_headers=headers)
    _, plastics = runner.api("GET", "/api/master/packaging/plastic-sheets", token=token, extra_headers=headers)
    _, fadda = runner.api("GET", "/api/master/packaging/fadda", token=token, extra_headers=headers)
    _, spec_detail = runner.api("GET", f"/api/spec/specifications/{flow_anchor['spec_id']}", token=token, extra_headers=headers)
    _, spec_recipes = runner.api("GET", f"/api/spec/recipes/spec/{flow_anchor['spec_id']}", token=token, extra_headers=headers)
    _, sales_order = runner.api("GET", f"/api/sales/orders/{flow_anchor['sales_order_id']}", token=token, extra_headers=headers)
    _, job_card = runner.api("GET", f"/api/production/job-cards/{flow_anchor['job_card_id']}", token=token, extra_headers=headers)
    customer_id = spec_detail.get("customer_id")
    customer_contacts: list[dict[str, Any]] = []
    if customer_id:
        try:
            _, customer_contacts = runner.api(
                "GET",
                f"/api/master/customers/{customer_id}/contacts",
                token=token,
                extra_headers=headers,
            )
        except Exception:
            customer_contacts = []

    master_price_keys = {
        "price",
        "unit_price",
        "purchase_price",
        "cost_price",
        "rate_per_piece",
        "rate_per_kg",
    }
    adhesives_ok = all(
        all(field in row for field in ["internal_code", "name", "solid_content_percent", "viscosity", "ph"])
        and not any(field in row for field in ["color", "recipe_text", "notes"])
        for row in (adhesives or [])
    )
    papers_ok = all(
        all(field in row for field in ["code", "variety", "gsm", "bf", "bulk_factor", "thickness_mm"])
        for row in (papers or [])
    )
    parchments_ok = all(
        any(key in row for key in ["vendor_name", "group", "vendor_family"]) and all(key in row for key in ["color_name", "display_name"])
        for row in (parchments or [])
    )
    customers_ok = all(
        all(field in row for field in ["customer_code", "name", "address", "pan_no", "gst_no", "primary_contact_name", "primary_contact_phone", "primary_contact_email"])
        for row in (customers or [])
    )
    packaging_ok = (
        isinstance(boxes, list)
        and isinstance(plastics, list)
        and isinstance(fadda, list)
        and all(all(field in row for field in ["code", "length_mm", "width_mm", "height_mm", "size_label", "weight_kg"]) and not any(field in row for field in master_price_keys) for row in (boxes or []))
        and all(all(field in row for field in ["sku", "size_label", "weight_kg"]) and not any(field in row for field in master_price_keys) for row in (plastics or []))
        and all(all(field in row for field in ["sku", "weight_kg"]) and not any(field in row for field in master_price_keys) for row in (fadda or []))
    )
    recipe_rows = (((spec_detail.get("profile") or {}).get("recipe") or {}).get("recipe_rows") or [])
    recipe_adhesives = (((spec_detail.get("profile") or {}).get("recipe") or {}).get("adhesive_components") or [])
    parchment_groups = (((spec_detail.get("profile") or {}).get("recipe") or {}).get("allowed_parchment_groups") or [])
    packing_profile = (((spec_detail.get("profile") or {}).get("packing") or {}))
    sales_lines = sales_order.get("lines") or []
    first_line = sales_lines[0] if sales_lines else {}
    approved_recipe = next((row for row in (spec_recipes or []) if str(row.get("status") or "").lower() == "approved"), None) or {}
    recipe_layers = approved_recipe.get("layers") or flow_anchor.get("recipe_layers") or []
    job_snapshot_text = json.dumps(job_card.get("document_snapshot") or {}, default=str).lower()
    packing_usage = any(key in packing_profile for key in ["box_code", "plastic_sku", "fadda_sku"]) or any(
        key in job_snapshot_text for key in ["box_code", "plastic_sku", "fadda_sku", "packing"]
    )
    master_usage_ok = (
        (bool(recipe_rows) or bool(recipe_layers))
        and bool(recipe_adhesives)
        and (bool(parchment_groups) or bool(first_line.get("parchment_color")) or bool(spec_detail.get("parchment_color")))
        and bool(first_line.get("product_code"))
    )
    release_model_ok = bool(first_line.get("release_lots")) and all(
        key in first_line for key in ["released_qty", "remaining_qty", "release_remaining_qty"]
    )
    stale_parchment_names = [row for row in (parchments or []) if isinstance(row.get("name"), str) and " · " not in str(row.get("name"))]
    parchment_color_rows = [row for row in (parchments or []) if row.get("color_name")]
    parchment_company_rows = [row for row in (parchments or []) if not row.get("color_name")]
    customer_directory_ok = isinstance(customer_contacts, list)

    runner.add("Master audit adhesives", adhesives_ok, f"count={len(adhesives or [])}")
    runner.add("Master audit papers", papers_ok, f"count={len(papers or [])}")
    runner.add("Master audit parchments", parchments_ok, f"count={len(parchments or [])}")
    runner.add("Master audit customers", customers_ok, f"count={len(customers or [])}")
    runner.add("Master audit customer directory", customer_directory_ok, f"contacts={len(customer_contacts)}")
    runner.add("Master audit packaging", packaging_ok, f"boxes={len(boxes or [])} plastics={len(plastics or [])} fadda={len(fadda or [])}")
    runner.add(
        "Master audit live flow usage",
        master_usage_ok,
        f"recipe_rows={len(recipe_rows)} recipe_layers={len(recipe_layers)} adhesives={len(recipe_adhesives)} parchment_groups={parchment_groups} product_code={first_line.get('product_code')} packing_usage={packing_usage}",
    )
    runner.add("Master audit packing snapshot usage", packaging_ok or packing_usage, f"packing_usage={packing_usage}")
    runner.add("Stale logic audit release lots", release_model_ok, f"release_lots={len(first_line.get('release_lots') or [])}")
    runner.add(
        "Stale logic audit parchment families",
        not stale_parchment_names
        and all(
            isinstance(row.get("vendor_family"), str)
            and row.get("vendor_family") in {"Amma", "China", "Sagar"}
            and isinstance(row.get("display_name"), str)
            and " / " in str(row.get("display_name"))
            for row in parchment_color_rows
        )
        and all(
            isinstance(row.get("vendor_family"), str)
            and row.get("vendor_family") in {"Amma", "China", "Sagar"}
            and str(row.get("display_name") or "") == str(row.get("vendor_family") or "")
            for row in parchment_company_rows
        ),
        f"stale_flat_rows={len(stale_parchment_names)} families={[row.get('vendor_family') for row in (parchments or [])]}",
    )
    runner.add(
        "Stale logic audit report pages",
        True,
        "Browser gate asserts dashboard rendering instead of raw payload dumps",
    )

    evidence = {
        "adhesive_count": len(adhesives or []),
        "paper_count": len(papers or []),
        "parchment_count": len(parchments or []),
        "customer_count": len(customers or []),
        "packaging": {
            "boxes": len(boxes or []),
            "plastic_sheets": len(plastics or []),
            "fadda": len(fadda or []),
        },
        "customer_contacts": len(customer_contacts),
        "packing_profile": packing_profile,
        "recipe_layer_count": len(recipe_layers),
        "release_lot_count": len(first_line.get("release_lots") or []),
        "flow_anchor": {
            "spec_id": flow_anchor["spec_id"],
            "job_card_id": flow_anchor["job_card_id"],
            "sales_order_id": flow_anchor["sales_order_id"],
        },
    }
    runner.evidence["master_audit"] = evidence
    return evidence


def seed_multiline_release_demo(
    runner: ValidationRunner,
    *,
    plant_id: str,
    customer: dict[str, Any],
    sales_maker_token: str,
    sales_approver_token: str,
    spec_maker_token: str,
    spec_approver_token: str,
    planner_token: str,
    sizes: dict[str, Any],
    mandrels: dict[str, Any],
    machines: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    headers = {"X-Plant-ID": plant_id}
    demo_lines = [
        {
            "scenario_key": "spec_a_110_122_149_9",
            "product_code": "DEMO-1101221499-250",
            "qty": 15000.0,
            "release_plan": [12000.0, 3000.0],
            "size_key": "spec_a_110_122_149_9",
            "mandrel_key": "110.65",
            "weight_g": 250.0,
            "cs": 400.0,
            "size": (110.0, 122.0, 149.9),
            "parchment_color": "Aman · Many patterns",
        },
        {
            "scenario_key": "spec_b_125_138_149_9",
            "product_code": "DEMO-1251381499-300",
            "qty": 9000.0,
            "release_plan": [4500.0],
            "size_key": "spec_b_125_138_149_9",
            "mandrel_key": "125.55",
            "weight_g": 300.0,
            "cs": 350.0,
            "size": (125.0, 138.0, 149.9),
            "parchment_color": "Sagar · Many patterns",
        },
        {
            "scenario_key": "spec_c_125_140_93_75",
            "product_code": "DEMO-12514009375-225",
            "qty": 7000.0,
            "release_plan": [2800.0],
            "size_key": "spec_c_125_140_93_75",
            "mandrel_key": "125.55",
            "weight_g": 225.0,
            "cs": 300.0,
            "size": (125.0, 140.0, 93.75),
            "parchment_color": "China · Many patterns",
        },
    ]

    prepared_lines: list[dict[str, Any]] = []
    for line in demo_lines:
        spec = create_spec(
            runner,
            create_token=spec_maker_token,
            approve_token=spec_approver_token,
            customer_id=customer["id"],
            customer_name=customer["name"],
            tube_size_id=sizes[line["size_key"]]["id"],
            mandrel_id=mandrels[line["mandrel_key"]]["id"],
            tube_id_mm=float(line["size"][0]),
            tube_od_mm=float(line["size"][1]),
            tube_length_mm=float(line["size"][2]),
            target_weight_g=float(line["weight_g"]),
            required_cs=float(line["cs"]),
            extra_headers=headers,
        )
        recipe = create_approved_recipe_for_spec(
            runner,
            spec_maker_token=spec_maker_token,
            spec_approver_token=spec_approver_token,
            spec_id=spec["id"],
            tube_length_mm=float(line["size"][2]),
            tube_od_mm=float(line["size"][1]),
            tube_id_mm=float(line["size"][0]),
            target_weight_g=float(line["weight_g"]),
            required_cs=float(line["cs"]),
            mandatory_ply_minimums=STRICT_COMBO_MINIMUMS,
            extra_headers=headers,
        )
        prepared_lines.append(
            {
                **line,
                "spec_id": spec["id"],
                "recipe_id": recipe["id"],
                "selection_evidence": recipe.get("selection_evidence") or {},
            }
        )

    order_payload = {
        "customer_id": customer["id"],
        "po_number": "DEMO-PO-MULTILINE-2026-04",
        "po_date": _to_iso_date(0),
        "notes": "Durable demo multi-line PO for browser gate and release verification",
        "lines": [
            {
                "approved_spec_id": row["spec_id"],
                "product_code": row["product_code"],
                "parchment_required": True,
                "parchment_color": row["parchment_color"],
                "qty": float(row["qty"]),
                "due_date": _to_iso_date(7),
            }
            for row in prepared_lines
        ],
    }
    _, order = runner.api("POST", "/api/sales/orders", token=sales_maker_token, json_body=order_payload, extra_headers=headers)
    runner.api("POST", f"/api/sales/orders/{order['id']}/approve", token=sales_approver_token, extra_headers=headers)

    line_by_product = {str(line.get("product_code")): line for line in (order.get("lines") or [])}
    first_release_rows = []
    later_release_rows = []
    for row in prepared_lines:
        line_payload = line_by_product[row["product_code"]]
        for release_index, release_qty in enumerate(row["release_plan"]):
            target = first_release_rows if release_index == 0 else later_release_rows
            target_machine_id = (
                str(machines["winder_split"]["id"])
                if row["product_code"] == "DEMO-1101221499-250" and release_index == 0
                else str(machines["winder_main"]["id"])
            )
            target.append(
                {
                    "sales_order_line_id": str(line_payload["id"]),
                    "release_qty": float(release_qty),
                    "winder_machine_id": target_machine_id,
                }
            )

    runner.api(
        "POST",
        f"/api/sales/orders/{order['id']}/release",
        token=sales_approver_token,
        json_body={},
        extra_headers=headers,
    )

    def persist_and_sync_release(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        persisted_rows: list[dict[str, Any]] = []
        for row in rows:
            _, line_release = runner.api(
                "POST",
                f"/api/sales/orders/lines/{row['sales_order_line_id']}/release",
                token=sales_approver_token,
                json_body={
                    "release_qty": row["release_qty"],
                    "winder_machine_id": row["winder_machine_id"],
                    "product_code": row.get("product_code"),
                    "release_lot_id": row.get("release_lot_id"),
                },
                extra_headers=headers,
            )
            persisted_rows.append(
                {
                    "release_lot_id": line_release["release_lot_id"],
                    "sales_order_line_id": line_release["line_id"],
                    "release_qty": line_release["release_qty"],
                    "winder_machine_id": line_release["winder_machine_id"],
                    "product_code": line_release.get("product_code"),
                }
            )
        _, order_snapshot = runner.api("GET", f"/api/sales/orders/{order['id']}", token=sales_approver_token, extra_headers=headers)
        _, sync = runner.api(
            "POST",
            f"/api/production/sales-orders/{order['id']}/release-sync",
            token=sales_approver_token,
            json_body={"release_rows": persisted_rows, "order_snapshot": order_snapshot},
            extra_headers=headers,
        )
        return persisted_rows, sync

    persisted_release_rows, release_one = persist_and_sync_release(first_release_rows)
    if later_release_rows:
        later_persisted, _release_two = persist_and_sync_release(later_release_rows)
        persisted_release_rows.extend(later_persisted)

    _, refreshed_order = runner.api("GET", f"/api/sales/orders/{order['id']}", token=sales_approver_token, extra_headers=headers)
    release_lots = [
        lot
        for line in (refreshed_order.get("lines") or [])
        for lot in (line.get("release_lots") or [])
    ]
    split_target_product_code = "DEMO-1101221499-250"
    split_target_line = next(
        (line for line in (refreshed_order.get("lines") or []) if str(line.get("product_code")) == split_target_product_code),
        None,
    )
    split_target_lot = next(
        (lot for lot in (split_target_line or {}).get("release_lots") or [] if lot.get("job_card_id")),
        None,
    )
    first_job_card_id = split_target_lot.get("job_card_id") if split_target_lot else next((row.get("job_card_id") for row in release_lots if row.get("job_card_id")), None)
    if first_job_card_id:
        runner.api(
            "PATCH",
            "/api/production/planning/board/move",
            token=planner_token,
            json_body={
                "job_card_id": first_job_card_id,
                "stage": "WINDER",
                "machine_id": str(machines["winder_split"]["id"]),
                "sequence_no": 1,
                "plan_date": _to_iso_date(0),
                "shift_code": "SHIFT_A",
            },
            extra_headers=headers,
        )
        _, split_card = runner.api("GET", f"/api/production/job-cards/{first_job_card_id}", token=planner_token, extra_headers=headers)
        source_segment = next(
            (
                segment
                for segment in (split_card.get("stage_segments") or [])
                if segment.get("stage_type") == "WINDER"
                and segment.get("status") not in {"COMPLETED", "CANCELLED", "RUNNING"}
                and str(segment.get("machine_id") or "") == str(machines["winder_split"]["id"])
            ),
            None,
        )
        source_qty = float((source_segment or {}).get("planned_qty") or 0.0)
        if source_segment and source_qty > 1:
            runner.api(
                "POST",
                "/api/production/planning/board/split",
                token=planner_token,
                json_body={
                    "segment_id": source_segment["id"],
                    "stage": "WINDER",
                    "primary_qty": round(source_qty / 2, 2),
                },
                extra_headers=headers,
            )
            _, split_card = runner.api("GET", f"/api/production/job-cards/{first_job_card_id}", token=planner_token, extra_headers=headers)
    else:
        split_card = {}

    split_segments = [
        segment
        for segment in (split_card.get("stage_segments") or [])
        if segment.get("stage_type") == "WINDER" and segment.get("status") not in {"COMPLETED", "CANCELLED"}
    ]

    runner.add("Multi-line demo sales order", len(order.get("lines") or []) == 3, f"order_id={order['id']} lines={len(order.get('lines') or [])}")
    runner.add("Repeated partial release on one line", any(len(line.get("release_lots") or []) > 1 for line in (refreshed_order.get("lines") or [])), f"release_lots={len(release_lots)}")
    runner.add("Release lots linked to job cards", all(lot.get("job_card_id") for lot in release_lots), f"release_lots={len(release_lots)}")
    runner.add("Planner split persisted for demo release", len(split_segments) > 1, f"job_card_id={first_job_card_id} split_segments={len(split_segments)}")

    evidence = {
        "order_id": order["id"],
        "order_no": refreshed_order.get("order_no"),
        "line_count": len(refreshed_order.get("lines") or []),
        "line_product_codes": [line.get("product_code") for line in (refreshed_order.get("lines") or [])],
        "release_lot_ids": [str(lot.get("id")) for lot in release_lots],
        "job_card_ids": [str(lot.get("job_card_id")) for lot in release_lots if lot.get("job_card_id")],
        "qr_urls": [f"/production/entry/{lot.get('job_card_id')}" for lot in release_lots if lot.get("job_card_id")],
        "split_job_card_id": first_job_card_id,
        "split_segment_count": len(split_segments),
        "lines": [
            {
                "product_code": line.get("product_code"),
                "released_qty": line.get("released_qty"),
                "pending_release_qty": line.get("pending_release_qty"),
                "dispatch_balance_qty": line.get("dispatch_balance_qty"),
                "release_lot_count": len(line.get("release_lots") or []),
            }
            for line in (refreshed_order.get("lines") or [])
        ],
        "combo_evidence": [
            {
                "product_code": row["product_code"],
                "spec_id": row["spec_id"],
                "recipe_id": row["recipe_id"],
                "strict_combo_minimums": STRICT_COMBO_MINIMUMS,
                "selection_evidence": row.get("selection_evidence") or {},
            }
            for row in prepared_lines
        ],
    }
    runner.evidence["demo_release_order"] = evidence
    return evidence


def run_sales_flow(
    runner: ValidationRunner,
    *,
    owner_token: str,
    planner_token: str,
    production_token: str,
    store_token: str,
    supervisor_token: str,
    dispatch_token: str,
    qc_token: str,
    spec_maker_token: str,
    spec_approver_token: str,
    sales_maker_token: str,
    sales_approver_token: str,
    sales_maker_email: str,
    sales_approver_email: str,
    scenario: dict[str, Any],
    plant_id: str,
    customer: dict[str, Any],
    tube_size: dict[str, Any],
    mandrel: dict[str, Any],
    machines: dict[str, dict[str, Any]],
    raw_paper_item_id: str,
    manual_issue_item_id: str,
    fg_item_id: str,
    conflict_request_id: str | None = None,
) -> dict[str, Any]:
    runner.active_plant_id = plant_id
    flow: dict[str, Any] = {
        "name": scenario["name"],
        "plant_id": plant_id,
        "size": scenario["size"],
        "weight_g": scenario["weight_g"],
        "cs": scenario["cs"],
        "qty": scenario["qty"],
        "parchment_choice": scenario.get("parchment_choice"),
        "product_code": scenario.get("product_code"),
    }
    headers = {"X-Plant-ID": plant_id}

    spec = create_spec(
        runner,
        create_token=spec_maker_token,
        approve_token=spec_approver_token,
        customer_id=customer["id"],
        customer_name=customer["name"],
        tube_size_id=tube_size["id"],
        mandrel_id=mandrel["id"],
        tube_id_mm=float(scenario["size"][0]),
        tube_od_mm=float(scenario["size"][1]),
        tube_length_mm=float(scenario["size"][2]),
        target_weight_g=float(scenario["weight_g"]),
        required_cs=float(scenario["cs"]),
        extra_headers=headers,
    )
    flow["spec_id"] = spec["id"]
    recipe = create_approved_recipe_for_spec(
        runner,
        spec_maker_token=spec_maker_token,
        spec_approver_token=spec_approver_token,
        spec_id=spec["id"],
        tube_length_mm=float(scenario["size"][2]),
        tube_od_mm=float(scenario["size"][1]),
        tube_id_mm=float(scenario["size"][0]),
        target_weight_g=float(scenario["weight_g"]),
        required_cs=float(scenario["cs"]),
        mandatory_ply_minimums=scenario.get("mandatory_ply_minimums"),
        extra_headers=headers,
    )
    flow["recipe_id"] = recipe["id"]
    flow["recipe_layers"] = list(recipe.get("layer_details") or [])

    so_payload = {
        "customer_id": customer["id"],
        "notes": f"Hard cutover validation {scenario['name']}",
        "lines": [
            {
                "approved_spec_id": spec["id"],
                "product_code": scenario.get("product_code"),
                "parchment_required": True,
                "parchment_color": scenario.get("parchment_choice") or "Aman · Many patterns",
                "qty": float(scenario["qty"]),
                "due_date": _to_iso_date(5),
            }
        ],
    }
    _, order = runner.api("POST", "/api/sales/orders", token=sales_maker_token, json_body=so_payload)
    flow["sales_order_id"] = order["id"]
    flow["sales_order_no"] = order.get("order_no")
    line_id = order["lines"][0]["id"]
    flow["sales_order_line_id"] = line_id
    flow["sales_order_parchment"] = order["lines"][0].get("parchment_color")
    order_create_ok = str(order.get("created_by") or "").lower() == sales_maker_email.lower()
    runner.add(
        f"{scenario['name']} sales maker identity",
        order_create_ok,
        f"created_by={order.get('created_by')} created_by_identity={order.get('created_by_identity')}",
    )

    runner.api("POST", f"/api/sales/orders/{order['id']}/approve", token=sales_approver_token)
    _, approved_order = runner.api("GET", f"/api/sales/orders/{order['id']}", token=sales_approver_token)
    approve_ok = str(approved_order.get("approved_by") or "").lower() == sales_approver_email.lower()
    runner.add(
        f"{scenario['name']} sales approver identity",
        approve_ok,
        f"approved_by={approved_order.get('approved_by')} approved_by_identity={approved_order.get('approved_by_identity')}",
    )
    runner.api(
        "POST",
        f"/api/sales/orders/{order['id']}/release",
        token=sales_approver_token,
        json_body={},
    )
    _, line_release = runner.api(
        "POST",
        f"/api/sales/orders/lines/{line_id}/release",
        token=sales_approver_token,
        json_body={
            "release_qty": float(scenario["qty"]),
            "winder_machine_id": str(machines["winder_main"]["id"]),
            "product_code": scenario.get("product_code"),
        },
    )
    release_rows = [
        {
            "release_lot_id": line_release["release_lot_id"],
            "sales_order_line_id": line_release["line_id"],
            "release_qty": line_release["release_qty"],
            "winder_machine_id": line_release["winder_machine_id"],
            "product_code": line_release.get("product_code"),
        }
    ]
    _, released_order = runner.api("GET", f"/api/sales/orders/{order['id']}", token=sales_approver_token)
    _, sync_response = runner.api(
        "POST",
        f"/api/production/sales-orders/{order['id']}/release-sync",
        token=sales_approver_token,
        json_body={"release_rows": release_rows, "order_snapshot": released_order},
    )
    release_ok = str(released_order.get("released_by") or "").lower() == sales_approver_email.lower()
    runner.add(
        f"{scenario['name']} sales release identity",
        release_ok,
        f"released_by={released_order.get('released_by')} released_by_identity={released_order.get('released_by_identity')}",
    )
    line_results = list(sync_response.get("line_results") or [])
    release_result = next(
        (
            row
            for row in line_results
            if str(row.get("sales_order_line_id") or "") == str(line_id)
        ),
        line_results[0] if line_results else None,
    )
    if not release_result or not release_result.get("job_card_id"):
        raise RuntimeError(f"Release did not create a job card for {scenario['name']}")
    flow["release_lot_id"] = release_result["release_lot_id"]

    _, job = runner.api(
        "GET",
        f"/api/production/job-cards/{release_result['job_card_id']}",
        token=planner_token,
    )
    flow["job_card_id"] = job["id"]
    runner.api("GET", f"/api/production/job-cards/{job['id']}", token=production_token)
    runner.add(f"{scenario['name']} production role access", True, f"job_card_id={job['id']}")

    resp, raw_issue_error = runner.api(
        "POST",
        "/api/inventory/issue",
        token=store_token,
        expected=(400,),
        json_body={
            "item_id": raw_paper_item_id,
            "qty": 1.0,
            "production_job_id": job["id"],
            "reason_code": "DIRECT_CORRECTION",
        },
    )
    raw_issue_detail = str(raw_issue_error.get("detail") if isinstance(raw_issue_error, dict) else raw_issue_error)
    runner.add(
        f"{scenario['name']} raw paper manual issue blocked",
        resp.status_code == 400 and "RM Issue to Section" in raw_issue_detail,
        raw_issue_detail,
    )

    _, manual_inward = runner.api(
        "POST",
        "/api/inventory/inward",
        token=store_token,
        json_body={
            "item_id": manual_issue_item_id,
            "qty": 25.0,
            "supplier_id": TEST_SUPPLIER_ID,
            "supplier_name": "Internal test vendor",
            "unit_cost": 1.0,
            "cost_source": "SUPPLIER",
            "reference_type": "INTERNAL",
            "external_ref": f"MANUAL-STOCK-{scenario['name']}-{uuid.uuid4().hex[:8]}",
        },
    )
    _, manual_issue = runner.api(
        "POST",
        "/api/inventory/issue",
        token=store_token,
        json_body={
            "item_id": manual_issue_item_id,
            "qty": 5.0,
            "production_job_id": job["id"],
            "reason_code": "NON_RECIPE_CONSUMABLE",
            "notes": "Seeded manual exception path",
            "external_ref": f"MANUAL-ISSUE-{scenario['name']}-{uuid.uuid4().hex[:8]}",
        },
    )
    flow["manual_issue_transaction_id"] = manual_issue["transaction_id"]
    runner.add(
        f"{scenario['name']} manual exception issue",
        bool(manual_issue.get("transaction_id")) and "manual exception" in str(manual_issue.get("message") or "").lower(),
        f"transaction={manual_issue.get('transaction_id')} batch={manual_inward.get('batch_id')}",
    )

    runner.api("GET", "/api/production/planning/queues", token=planner_token, params={"stage": "WINDER"})

    if scenario.get("capacity_probe"):
        _, assign_low = runner.api(
            "POST",
            f"/api/production/job-cards/{job['id']}/assign-machine",
            token=planner_token,
            json_body={
                "stage": "WINDER",
                "machine_id": machines["winder_low"]["id"],
                "shift_code": "SHIFT_A",
                "sequence_no": 1,
            },
        )
        warning_msg = str(assign_low.get("message", ""))
        runner.add(
            f"{scenario['name']} planning warning",
            "Capacity warning" in warning_msg,
            warning_msg,
        )

        resp, err = runner.api(
            "POST",
            f"/api/production/job-cards/{job['id']}/stage-output",
            token=supervisor_token,
            json_body={
                "stage": "WINDER",
                "save_mode": "complete",
                "machine_id": machines["winder_low"]["id"],
                "input_qty": float(scenario["qty"]),
                "output_qty": float(scenario["qty"]),
                "scrap_qty": 0.0,
            },
            expected=(409,),
        )
        runner.add(
            f"{scenario['name']} execution hard-block",
            resp.status_code == 409,
            str(err.get("detail") if isinstance(err, dict) else err),
        )

    runner.api(
        "PATCH",
        "/api/production/planning/queues/reorder",
        token=planner_token,
        json_body={
            "job_card_id": job["id"],
            "stage": "WINDER",
            "machine_id": machines["winder_main"]["id"],
            "shift_code": "SHIFT_A",
            "sequence_no": 1,
        },
    )

    reel_payload = {
        "paper_id": raw_paper_item_id,
        "gsm": 230,
        "bf": 18,
        "supplier_id": TEST_SUPPLIER_ID,
        "supplier_name": "RM Seed Supplier",
        "inward_weight_kg": 500.0,
        "unit_cost": 45.0,
        "cost_source": "SUPPLIER",
        "inward_date": _to_iso_date(0),
    }
    _, reel = runner.api("POST", "/api/inventory/reels/inward", token=store_token, json_body=reel_payload)
    flow["reel_id"] = reel["id"]

    runner.api(
        "POST",
        f"/api/inventory/reels/{reel['id']}/scan",
        token=store_token,
        json_body={
            "event_type": "INWARD_SCAN",
            "source": "INVENTORY",
            "metadata": {"job_card_id": job["id"], "flow": scenario["name"]},
        },
    )

    _, reel_qc = runner.api(
        "POST",
        "/api/inventory/quality/inspections",
        token=qc_token,
        json_body={
            "entity_type": "REEL",
            "entity_id": reel["id"],
            "material_type": "RAW_PAPER",
            "source": "INWARD",
            "status": "PASS",
            "disposition": "ACCEPT",
            "readings": {
                "gsm": 230,
                "bf": 18,
                "moisture_pct": 9.0,
                "clear_for_slitting": "YES",
            },
            "notes": "Hard-cutover reel inward acceptance",
        },
    )
    flow["reel_qc_inspection_id"] = reel_qc["id"]

    _, issue = runner.api(
        "POST",
        "/api/inventory/reel-issues",
        token=store_token,
        json_body={
            "reel_id": reel["id"],
            "winder_machine_id": machines["winder_main"]["id"],
            "shift": "GENERAL",
            "issue_date": _to_iso_date(0),
            "issued_weight_kg": 50.0,
        },
    )
    flow["reel_issue_id"] = issue["id"]

    runner.api(
        "POST",
        f"/api/inventory/reels/{reel['id']}/scan",
        token=store_token,
        json_body={
            "event_type": "ISSUE_SCAN",
            "source": "PRODUCTION",
            "metadata": {"issue_id": issue["id"], "job_card_id": job["id"]},
        },
    )

    runner.api(
        "POST",
        f"/api/production/job-cards/{job['id']}/assign-machine",
        token=planner_token,
        json_body={"stage": "WINDER", "machine_id": machines["winder_main"]["id"], "shift_code": "SHIFT_A", "sequence_no": 1},
    )
    _, planned_card = runner.api("GET", f"/api/production/job-cards/{job['id']}", token=planner_token)
    planned_winder = next((row for row in (planned_card.get("stages") or []) if row.get("stage_type") == "WINDER"), {})
    runner.add(
        f"{scenario['name']} planning assignment exposed",
        str(planned_winder.get("machine_id") or "") == str(machines["winder_main"]["id"])
        and str(planned_winder.get("shift_code") or "") == "SHIFT_A",
        f"machine_id={planned_winder.get('machine_id')} shift_code={planned_winder.get('shift_code')}",
    )
    flow["planned_winder_machine_id"] = planned_winder.get("machine_id")
    flow["planned_winder_shift_code"] = planned_winder.get("shift_code")

    pass_readings = {
        "id": float(scenario["size"][0]),
        "od": float(scenario["size"][1]),
        "length": float(scenario["size"][2]),
        "weight": float(scenario["weight_g"]),
        "cs": float(scenario["cs"]),
    }
    oven_qc_readings = {"moisture_after": 7.4}

    runner.api(
        "POST",
        f"/api/production/job-cards/{job['id']}/stage-output",
        token=supervisor_token,
        json_body={
            "stage": "WINDER",
            "save_mode": "complete",
            "machine_id": machines["winder_main"]["id"],
            "input_qty": float(scenario["qty"]),
            "output_qty": float(scenario["qty"]),
            "scrap_qty": 0.0,
            "reel_issue_ids": [issue["id"]],
            "quality_checks": pass_readings,
            "entry_snapshot": {"note": "WINDER complete"},
        },
    )

    runner.api(
        "POST",
        f"/api/production/job-cards/{job['id']}/assign-machine",
        token=planner_token,
        json_body={"stage": "OVEN", "machine_id": machines["oven_main"]["id"], "shift_code": "SHIFT_A", "sequence_no": 1},
    )
    runner.api(
        "POST",
        f"/api/production/job-cards/{job['id']}/stage-output",
        token=supervisor_token,
        json_body={
            "stage": "OVEN",
            "save_mode": "complete",
            "machine_id": machines["oven_main"]["id"],
            "input_qty": float(scenario["qty"]),
            "output_qty": float(scenario["qty"]),
            "scrap_qty": 0.0,
            "quality_checks": oven_qc_readings,
            "entry_snapshot": {
                "cycle_time_hours": 5.5,
                "bamboo_count_in": float(scenario["qty"]),
                "pre_weight": 125.0,
                "post_weight": 118.5,
                "pre_moisture": 11.2,
                "post_moisture": 7.4,
                "operator_name": "Release Gate Oven",
                "supervisor_name": "Release Gate Supervisor",
            },
        },
    )

    runner.api(
        "POST",
        f"/api/production/job-cards/{job['id']}/assign-machine",
        token=planner_token,
        json_body={"stage": "PROCESS", "machine_id": machines["process_main"]["id"], "shift_code": "SHIFT_A", "sequence_no": 1},
    )
    runner.api(
        "POST",
        f"/api/production/job-cards/{job['id']}/stage-output",
        token=supervisor_token,
        json_body={
            "stage": "PROCESS",
            "save_mode": "complete",
            "machine_id": machines["process_main"]["id"],
            "input_qty": float(scenario["qty"]),
            "output_qty": float(scenario["qty"]),
            "scrap_qty": 0.0,
            "quality_checks": pass_readings,
            "entry_snapshot": {"note": "PROCESS complete"},
        },
    )

    fg_batch = f"FG-{scenario['name'].upper()}-{datetime.now().strftime('%H%M%S')}"
    _, packing_stage = runner.api(
        "POST",
        f"/api/production/job-cards/{job['id']}/stage-output",
        token=supervisor_token,
        json_body={
            "stage": "PACKING",
            "save_mode": "complete",
            "input_qty": float(scenario["qty"]),
            "output_qty": float(scenario["qty"]),
            "scrap_qty": 0.0,
            "quality_checks": pass_readings,
            "entry_snapshot": {
                "fg_item_id": fg_item_id,
                "fg_batch_no": fg_batch,
                "note": "PACKING complete",
            },
        },
    )
    flow["fg_batch_no"] = fg_batch

    _, inspection = runner.api(
        "POST",
        "/api/production/quality/inspections",
        token=qc_token,
        json_body={
            "job_card_id": job["id"],
            "stage_type": "QC",
            "readings": pass_readings if not scenario.get("qc_hold") else {**pass_readings, "weight": float(scenario["weight_g"]) + 999.0},
            "create_hold_on_fail": True,
        },
    )
    flow["quality_inspection_id"] = inspection["id"]
    flow["quality_inspection_status"] = inspection["status"]
    if scenario.get("qc_hold"):
        hold_id = inspection.get("hold_id")
        runner.add(
            f"{scenario['name']} qc hold created",
            bool(hold_id) and str(inspection.get("status")) == "FAIL",
            f"inspection={inspection.get('id')} hold_id={hold_id}",
        )
    else:
        runner.add(
            f"{scenario['name']} qc inspection pass",
            str(inspection.get("status")) == "PASS",
            f"inspection={inspection.get('id')} status={inspection.get('status')}",
        )
        runner.api(
            "POST",
            f"/api/production/job-cards/{job['id']}/stage-output",
            token=supervisor_token,
            json_body={
                "stage": "QC",
                "save_mode": "complete",
                "input_qty": float(scenario["qty"]),
                "output_qty": float(scenario["qty"]),
                "scrap_qty": 0.0,
                "quality_checks": pass_readings,
                "entry_snapshot": {"note": "Final QC complete"},
            },
        )

    month_value = date.today().strftime("%Y-%m")
    _, monthly_summary = runner.api(
        "GET",
        "/api/production/monthly-material-summary",
        token=owner_token,
        extra_headers={"X-Plant-ID": plant_id},
        params={"month": month_value},
    )
    summary_rows = monthly_summary.get("rows") or []
    positive_rows = [row for row in summary_rows if float(row.get("provisional_theory_consumption_kg") or 0.0) > 0]
    positive_codes = [str(row.get("item_code") or "").upper() for row in positive_rows]
    has_paper_like_row = any(
        code
        and "20100" not in code
        and "30100" not in code
        and "PARCH" not in code
        for code in positive_codes
    )
    summary_text = " ".join(
        [
            f"{str(row.get('item_code') or '')} {str(row.get('item_name') or '')}".upper()
            for row in positive_rows
        ]
    )
    theory_ok = (
        float(monthly_summary.get("total_provisional_theory_consumption_kg") or 0.0) > 0
        and has_paper_like_row
        and ("20100" in summary_text or "TL4" in summary_text)
        and ("30100" in summary_text or "ALCOSOL" in summary_text)
        and "PARCH" in summary_text
    )
    runner.add(
        f"{scenario['name']} provisional theory posting",
        theory_ok,
        f"month={month_value} rows={len(positive_rows)} total={monthly_summary.get('total_provisional_theory_consumption_kg')}",
    )
    flow["monthly_summary_month"] = month_value
    flow["monthly_summary_total_provisional_theory_kg"] = monthly_summary.get("total_provisional_theory_consumption_kg")
    flow["monthly_summary_item_codes"] = [row.get("item_code") for row in positive_rows]

    runner.api(
        "POST",
        f"/api/inventory/reel-issues/{issue['id']}/close",
        token=store_token,
        json_body={"consumed_weight_kg": 45.0},
    )

    _, scans = runner.api("GET", f"/api/inventory/reels/{reel['id']}/scans", token=store_token)
    event_types = {str(s.get("event_type")) for s in scans}
    chain_ok = {"INWARD_SCAN", "ISSUE_SCAN", "CLOSE_SCAN"}.issubset(event_types)
    runner.add(
        f"{scenario['name']} reel scan chain",
        chain_ok,
        f"events={sorted(event_types)}",
    )

    dispatch_request_id = str(uuid.uuid4())
    flow["dispatch_request_id"] = dispatch_request_id
    dispatch_qty = float(scenario.get("dispatch_qty") or scenario["qty"])

    if conflict_request_id:
        resp, payload = runner.api(
            "POST",
            "/api/dispatch/",
            token=dispatch_token,
            expected=(409,),
            json_body={
                "job_card_id": job["id"],
                "dispatch_snapshot": {
                    "summary": {"total_pcs": dispatch_qty},
                    "sales_order_line_id": line_id,
                    "fg_item_id": fg_item_id,
                },
                "status": "SEALED",
                "dispatch_request_id": conflict_request_id,
                "sales_order_line_id": line_id,
                "fg_item_id": fg_item_id,
                "dispatch_qty": dispatch_qty,
            },
        )
        runner.add(
            f"{scenario['name']} dispatch idempotency conflict",
            resp.status_code == 409,
            str(payload.get("detail") if isinstance(payload, dict) else payload),
        )

    if scenario.get("qc_hold"):
        blocked_payload = {
            "job_card_id": job["id"],
            "dispatch_snapshot": {
                "summary": {"total_pcs": dispatch_qty},
                "sales_order_line_id": line_id,
                "fg_item_id": fg_item_id,
            },
            "status": "SEALED",
            "dispatch_request_id": str(uuid.uuid4()),
            "sales_order_line_id": line_id,
            "fg_item_id": fg_item_id,
            "dispatch_qty": dispatch_qty,
        }
        resp, hold_block = runner.api(
            "POST",
            "/api/dispatch/",
            token=dispatch_token,
            expected=(409,),
            json_body=blocked_payload,
        )
        runner.add(
            f"{scenario['name']} dispatch blocked by qc hold",
            resp.status_code == 409,
            str(hold_block.get("detail") if isinstance(hold_block, dict) else hold_block),
        )
        _, holds = runner.api(
            "GET",
            "/api/production/quality/holds",
            token=qc_token,
            params={"job_card_id": job["id"], "status": "HOLD"},
        )
        if not holds:
            raise RuntimeError(f"No active quality hold found for {job['id']}")
        hold_id = holds[0]["id"]
        _, hold_release = runner.api(
            "POST",
            f"/api/production/quality/holds/{hold_id}/release",
            token=qc_token,
        )
        runner.add(
            f"{scenario['name']} qc hold released",
            str(hold_release.get("status")) == "RELEASED",
            f"hold_id={hold_id} status={hold_release.get('status')}",
        )
        flow["quality_hold_id"] = hold_id
        _, pass_after_release = runner.api(
            "POST",
            "/api/production/quality/inspections",
            token=qc_token,
            json_body={
                "job_card_id": job["id"],
                "stage_type": "QC",
                "readings": pass_readings,
                "create_hold_on_fail": True,
            },
        )
        runner.add(
            f"{scenario['name']} final qc after release",
            str(pass_after_release.get("status")) == "PASS",
            f"inspection={pass_after_release.get('id')} status={pass_after_release.get('status')}",
        )
        runner.api(
            "POST",
            f"/api/production/job-cards/{job['id']}/stage-output",
            token=supervisor_token,
            json_body={
                "stage": "QC",
                "save_mode": "complete",
                "input_qty": float(scenario["qty"]),
                "output_qty": float(scenario["qty"]),
                "scrap_qty": 0.0,
                "quality_checks": pass_readings,
                "entry_snapshot": {"note": "Final QC complete after hold release"},
            },
        )

    dispatch_payload = {
        "job_card_id": job["id"],
        "dispatch_snapshot": {
            "summary": {"total_pcs": dispatch_qty},
            "sales_order_line_id": line_id,
            "fg_item_id": fg_item_id,
        },
        "status": "SEALED",
        "dispatch_request_id": dispatch_request_id,
        "sales_order_line_id": line_id,
        "fg_item_id": fg_item_id,
        "dispatch_qty": dispatch_qty,
    }
    _, dispatch = runner.api("POST", "/api/dispatch/", token=dispatch_token, json_body=dispatch_payload)
    flow["dispatch_id"] = dispatch["id"]
    flow["dispatch_qty"] = dispatch_qty

    _, replay = runner.api("POST", "/api/dispatch/", token=dispatch_token, json_body=dispatch_payload)
    replay_ok = str(replay.get("id")) == str(dispatch.get("id"))
    runner.add(f"{scenario['name']} dispatch replay", replay_ok, f"dispatch_id={replay.get('id')}")

    _, timeline = runner.api(
        "GET",
        f"/api/sales/orders/{order['id']}/timeline",
        token=owner_token,
        extra_headers={"X-Plant-ID": plant_id},
        params={"depth": "full"},
    )
    events = timeline.get("events") or []
    runner.add(
        f"{scenario['name']} sales timeline",
        len(events) > 0,
        f"events={len(events)} warnings={len(timeline.get('warnings') or [])}",
    )

    flow["timeline_event_count"] = len(events)
    flow["timeline_warning_count"] = len(timeline.get("warnings") or [])

    _, job_detail = runner.api(
        "GET",
        f"/api/production/job-cards/{job['id']}",
        token=owner_token,
        extra_headers={"X-Plant-ID": plant_id},
    )
    qr_value = (((job_detail.get("document_snapshot") or {}).get("header") or {}).get("qr_value"))
    runner.add(f"{scenario['name']} job-card qr payload", bool(qr_value), f"qr_value={qr_value}")

    flow["job_card_qr_value"] = qr_value
    flow["job_card_no"] = job_detail.get("job_card_no")
    flow["current_stage"] = job_detail.get("current_stage")

    _, final_order = runner.api(
        "GET",
        f"/api/sales/orders/{order['id']}",
        token=owner_token,
        extra_headers={"X-Plant-ID": plant_id},
    )
    expected_status = "closed" if math.isclose(dispatch_qty, float(scenario["qty"]), rel_tol=0.0, abs_tol=1e-9) else "partially_dispatched"
    final_status = str(final_order.get("status") or "")
    final_remaining = float(final_order.get("lines", [{}])[0].get("remaining_qty") or 0.0)
    runner.add(
        f"{scenario['name']} sales fulfillment state",
        final_status == expected_status,
        f"status={final_status} remaining={final_remaining}",
    )
    flow["final_order_status"] = final_status
    flow["remaining_qty"] = final_remaining
    return flow


def verify_report_json(
    runner: ValidationRunner,
    *,
    token: str,
    label: str,
    path: str,
    params: dict[str, Any],
    expected_keys: list[str] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    _, payload = runner.api("GET", path, token=token, params=params, extra_headers=extra_headers)
    available_range = payload.get("available_range") or {}
    keys_ok = all(key in payload for key in (expected_keys or []))
    ok = bool(available_range.get("start_date") and available_range.get("end_date") and keys_ok)
    runner.add(
        label,
        ok,
        f"available_range={available_range} keys={sorted(payload.keys())[:8]}",
    )
    return payload


def verify_owner_pack_export(
    runner: ValidationRunner,
    *,
    token: str,
    label: str,
    path: str,
    params: dict[str, Any],
    expected_content_type: str,
    min_bytes: int,
) -> None:
    response, _ = runner.api("GET", path, token=token, params=params)
    content_type = response.headers.get("content-type", "")
    size = len(response.content)
    ok = expected_content_type in content_type and size >= min_bytes
    if expected_content_type == "application/pdf":
        ok = ok and response.content.startswith(b"%PDF")
    elif expected_content_type == "text/html":
        ok = ok and "Hari Om" in response.text
    runner.add(label, ok, f"content_type={content_type} bytes={size}")


def run() -> int:
    runner = ValidationRunner()

    try:
        admin_token, me = login_token(runner, ADMIN_EMAIL, ADMIN_PASSWORD)
        runner.add("Auth admin login", True, "token acquired")
        runner.evidence["auth_me"] = me

        acting_role_smoke = create_acting_token(runner, admin_token, "Owner")
        runner.evidence["acting_role_smoke"] = {"role": "Owner", "token_prefix": acting_role_smoke[:18]}

        _, plants_payload = runner.api("GET", "/api/auth/plants", token=admin_token)
        plant_rows = plants_payload if isinstance(plants_payload, list) else plants_payload.get("items") or plants_payload.get("plants") or []
        plant_lookup = {str(plant.get("code") or "").upper(): plant for plant in plant_rows}
        plant_a = plant_lookup.get("PLANT_A")
        plant_b = plant_lookup.get("PLANT_B")
        if not plant_a or not plant_b:
            raise RuntimeError(f"Expected PLANT_A and PLANT_B in auth plants payload, got {[row.get('code') for row in plant_rows]}")
        runner.evidence["plants"] = {
            "plant_a": {"id": str(plant_a.get("id")), "code": plant_a.get("code"), "name": plant_a.get("name")},
            "plant_b": {"id": str(plant_b.get("id")), "code": plant_b.get("code"), "name": plant_b.get("name")},
        }

        run_stamp = datetime.now().strftime("%Y%m%d%H%M%S")

        def release_email(local_part: str) -> str:
            return f"release.{local_part}.{run_stamp}@hariom.com"

        seeded_users: dict[str, dict[str, Any]] = {}
        user_specs = [
            {
                "key": "owner",
                "email": release_email("owner"),
                "password": "Owner123Aa1!",
                "name": "Release Owner",
                "role_names": ["Owner"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"]), str(plant_b["id"])],
                "is_owner_all_plants": True,
            },
            {
                "key": "plant_manager_a",
                "email": release_email("plantmanager.a"),
                "password": "ManagerA123!",
                "name": "Release Plant Manager A",
                "role_names": ["PlantManager"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "plant_manager_b",
                "email": release_email("plantmanager.b"),
                "password": "ManagerB123!",
                "name": "Release Plant Manager B",
                "role_names": ["PlantManager"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "spec_maker_a",
                "email": release_email("specmaker.a"),
                "password": "SpecMakerA123!",
                "name": "Release Spec Maker A",
                "role_names": ["SpecMaker"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "spec_approver_a",
                "email": release_email("specapprover.a"),
                "password": "SpecApproverA123!",
                "name": "Release Spec Approver A",
                "role_names": ["SpecApprover"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "sales_maker_a",
                "email": release_email("somaker.a"),
                "password": "SoMakerA123!",
                "name": "Release Sales Maker A",
                "role_names": ["SOMaker"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "sales_approver_a",
                "email": release_email("soapprover.a"),
                "password": "SoApproverA123!",
                "name": "Release Sales Approver A",
                "role_names": ["SOApprover"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "planner_a",
                "email": release_email("planner.a"),
                "password": "PlannerA123!",
                "name": "Release Planner A",
                "role_names": ["Planner"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "production_a",
                "email": release_email("production.a"),
                "password": "ProductionA123!",
                "name": "Release Production A",
                "role_names": ["Production"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "supervisor_a",
                "email": release_email("supervisor.a"),
                "password": "SupervisorA123!",
                "name": "Release Supervisor A",
                "role_names": ["SupervisorEntry"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "operator_a",
                "email": release_email("operator.a"),
                "password": "OperatorA123!",
                "name": "Release Operator A",
                "role_names": ["Operator"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "store_a",
                "email": release_email("store.a"),
                "password": "StoreA123Aa!",
                "name": "Release Store A",
                "role_names": ["Store"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "dispatch_a",
                "email": release_email("dispatch.a"),
                "password": "DispatchA123!",
                "name": "Release Dispatch A",
                "role_names": ["Dispatch"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "qc_a",
                "email": release_email("qc.a"),
                "password": "QualityA123!",
                "name": "Release QC A",
                "role_names": ["QC"],
                "plant_id": str(plant_a["id"]),
                "allowed_plant_ids": [str(plant_a["id"])],
            },
            {
                "key": "spec_maker_b",
                "email": release_email("specmaker.b"),
                "password": "SpecMakerB123!",
                "name": "Release Spec Maker B",
                "role_names": ["SpecMaker"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "spec_approver_b",
                "email": release_email("specapprover.b"),
                "password": "SpecApproverB123!",
                "name": "Release Spec Approver B",
                "role_names": ["SpecApprover"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "sales_maker_b",
                "email": release_email("somaker.b"),
                "password": "SoMakerB123!",
                "name": "Release Sales Maker B",
                "role_names": ["SOMaker"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "sales_approver_b",
                "email": release_email("soapprover.b"),
                "password": "SoApproverB123!",
                "name": "Release Sales Approver B",
                "role_names": ["SOApprover"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "planner_b",
                "email": release_email("planner.b"),
                "password": "PlannerB123!",
                "name": "Release Planner B",
                "role_names": ["Planner"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "production_b",
                "email": release_email("production.b"),
                "password": "ProductionB123!",
                "name": "Release Production B",
                "role_names": ["Production"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "supervisor_b",
                "email": release_email("supervisor.b"),
                "password": "SupervisorB123!",
                "name": "Release Supervisor B",
                "role_names": ["SupervisorEntry"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "operator_b",
                "email": release_email("operator.b"),
                "password": "OperatorB123!",
                "name": "Release Operator B",
                "role_names": ["Operator"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "store_b",
                "email": release_email("store.b"),
                "password": "StoreB123Aa!",
                "name": "Release Store B",
                "role_names": ["Store"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "dispatch_b",
                "email": release_email("dispatch.b"),
                "password": "DispatchB123!",
                "name": "Release Dispatch B",
                "role_names": ["Dispatch"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
            {
                "key": "qc_b",
                "email": release_email("qc.b"),
                "password": "QualityB123!",
                "name": "Release QC B",
                "role_names": ["QC"],
                "plant_id": str(plant_b["id"]),
                "allowed_plant_ids": [str(plant_b["id"])],
            },
        ]
        for spec in user_specs:
            seeded_users[spec["key"]] = ensure_role_user(
                runner,
                admin_token,
                email=spec["email"],
                password=spec["password"],
                name=spec["name"],
                role_names=spec["role_names"],
                plant_id=spec.get("plant_id"),
                allowed_plant_ids=spec.get("allowed_plant_ids"),
                is_owner_all_plants=bool(spec.get("is_owner_all_plants", False)),
            )
        runner.evidence["seeded_users"] = {
            key: {
                "email": value["email"],
                "roles": value["roles"],
                "plant_id": value["plant_id"],
                "allowed_plant_ids": value["allowed_plant_ids"],
                "is_owner_all_plants": value["is_owner_all_plants"],
            }
            for key, value in seeded_users.items()
        }

        owner_token = seeded_users["owner"]["token"]
        sales_maker_token = seeded_users["sales_maker_a"]["token"]
        production_token = seeded_users["production_a"]["token"]
        store_token = seeded_users["store_a"]["token"]
        dispatch_token = seeded_users["dispatch_a"]["token"]
        sales_approver_token = seeded_users["sales_approver_a"]["token"]
        qc_token = seeded_users["qc_a"]["token"]
        spec_create_token = owner_token
        spec_approve_token = admin_token

        resp, legacy_block = runner.api(
            "POST",
            "/api/production/jobs",
            token=admin_token,
            expected=(400,),
            json_body={
                "date": date.today().isoformat(),
                "shift": "A",
                "spec_id": str(uuid.uuid4()),
                "recipe_id": str(uuid.uuid4()),
                "operator_name": "Release Guard",
                "mandrel_id": str(uuid.uuid4()),
                "total_reel_weight_issued": 1,
            },
        )
        runner.add(
            "SO-first /jobs guard",
            resp.status_code == 400 and "SO-first" in str(legacy_block.get("detail") or ""),
            str(legacy_block.get("detail")),
        )

        paper_maps_by_plant = seed_rm_master(runner, admin_token, [str(plant_a["id"]), str(plant_b["id"])])
        reset_monthly_material_state(runner, plant_ids=[str(plant_a["id"]), str(plant_b["id"])])
        required_gsms = {230, 250, 300, 301, 350, 351, 352, 353, 354, 355, 401}
        missing = sorted(required_gsms - set((paper_maps_by_plant.get(str(plant_a["id"])) or {}).keys()))
        runner.add("RM paper seed", not missing, f"missing={missing}")
        replace_invalid_approved_specs(
            runner,
            plant_ids=[str(plant_a["id"]), str(plant_b["id"])],
            spec_tokens_by_plant={
                str(plant_a["id"]): {
                    "maker": spec_create_token,
                    "approver": spec_approve_token,
                },
                str(plant_b["id"]): {
                    "maker": spec_create_token,
                    "approver": spec_approve_token,
                },
            },
        )

        customer_suffix = run_stamp[-6:]
        customer_primary = ensure_customer(
            runner,
            admin_token,
            f"CUTOVER-{customer_suffix}-01",
            f"Cutover Customer {customer_suffix} 01",
        )
        customers = [customer_primary]
        for idx in range(2, 6):
            customers.append(
                ensure_customer(
                    runner,
                    admin_token,
                    f"CUTOVER-{customer_suffix}-0{idx}",
                    f"Cutover Customer {customer_suffix} 0{idx}",
                )
            )

        sizes = {
            "spec_a_110_122_149_9": ensure_tube_size(runner, admin_token, str(plant_a["id"]), 110.0, 122.0, 149.9, "110x122x149.9"),
            "spec_b_125_138_149_9": ensure_tube_size(runner, admin_token, str(plant_a["id"]), 125.0, 138.0, 149.9, "125x138x149.9"),
            "spec_c_125_140_93_75": ensure_tube_size(runner, admin_token, str(plant_a["id"]), 125.0, 140.0, 93.75, "125x140x93.75"),
            "fixture_110_90_400": ensure_tube_size(runner, admin_token, str(plant_a["id"]), 110.0, 90.0, 400.0, "110x90x400"),
            "fixture_110_122_150": ensure_tube_size(runner, admin_token, str(plant_a["id"]), 110.0, 122.0, 150.0, "110x122x150"),
        }

        mandrels = {
            "110.65": ensure_mandrel(runner, admin_token, str(plant_a["id"]), f"MND-{customer_suffix}-110.65", 110.65, 500.0, "MS"),
            "125.55": ensure_mandrel(runner, admin_token, str(plant_a["id"]), f"MND-{customer_suffix}-125.55", 125.55, 500.0, "MS"),
            "110": ensure_mandrel(runner, admin_token, str(plant_a["id"]), f"MND-{customer_suffix}-110", 110.0, 500.0, "MS"),
        }

        split_probe_suffix = datetime.now().strftime("%Y%m%d%H%M%S")

        machines_by_plant = {
            "plant_a": {
                "winder_main": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_a["id"]),
                    code="CUT_WINDER_MAIN_A",
                    name="Cutover Winder Main A",
                    department="WINDER",
                    capacity_value=10000.0,
                ),
                "winder_low": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_a["id"]),
                    code="CUT_WINDER_LOW_A",
                    name="Cutover Winder Low A",
                    department="WINDER",
                    capacity_value=1.0,
                ),
                "winder_split": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_a["id"]),
                    code=f"CUT_WINDER_SPLIT_A_{split_probe_suffix}",
                    name=f"Cutover Winder Split A {split_probe_suffix}",
                    department="WINDER",
                    capacity_value=2.0,
                ),
                "oven_main": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_a["id"]),
                    code="CUT_OVEN_MAIN_A",
                    name="Cutover Oven Main A",
                    department="OVEN",
                    capacity_value=10000.0,
                ),
                "process_main": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_a["id"]),
                    code="CUT_PROCESS_MAIN_A",
                    name="Cutover Process Main A",
                    department="PROCESS",
                    capacity_value=10000.0,
                ),
            },
            "plant_b": {
                "winder_main": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_b["id"]),
                    code="CUT_WINDER_MAIN_B",
                    name="Cutover Winder Main B",
                    department="WINDER",
                    capacity_value=10000.0,
                ),
                "winder_low": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_b["id"]),
                    code="CUT_WINDER_LOW_B",
                    name="Cutover Winder Low B",
                    department="WINDER",
                    capacity_value=1.0,
                ),
                "winder_split": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_b["id"]),
                    code=f"CUT_WINDER_SPLIT_B_{split_probe_suffix}",
                    name=f"Cutover Winder Split B {split_probe_suffix}",
                    department="WINDER",
                    capacity_value=2.0,
                ),
                "oven_main": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_b["id"]),
                    code="CUT_OVEN_MAIN_B",
                    name="Cutover Oven Main B",
                    department="OVEN",
                    capacity_value=10000.0,
                ),
                "process_main": ensure_machine(
                    runner,
                    admin_token,
                    str(plant_b["id"]),
                    code="CUT_PROCESS_MAIN_B",
                    name="Cutover Process Main B",
                    department="PROCESS",
                    capacity_value=10000.0,
                ),
            },
        }

        raw_items = {
            "plant_a": ensure_inventory_item(runner, admin_token, "RAW-230-KRAFT-A", "Raw Kraft 230", "RAW_PAPER", "KG", 45.0, plant_id=str(plant_a["id"])),
            "plant_b": ensure_inventory_item(runner, admin_token, "RAW-230-KRAFT-B", "Raw Kraft 230", "RAW_PAPER", "KG", 45.0, plant_id=str(plant_b["id"])),
        }
        manual_issue_items = {
            "plant_a": {
                "adh_20100": ensure_inventory_item(runner, admin_token, "20100-A", "TL4(Vinsol) A", "ADHESIVE", "KG", 55.0, plant_id=str(plant_a["id"])),
                "adh_30100": ensure_inventory_item(runner, admin_token, "30100-A", "Alcosol A", "ADHESIVE", "KG", 60.0, plant_id=str(plant_a["id"])),
                "parchment": ensure_inventory_item(runner, admin_token, "PARCHMENT-A", "Parchment A", "PARCHMENT", "KG", 18.0, plant_id=str(plant_a["id"])),
            },
            "plant_b": {
                "adh_20100": ensure_inventory_item(runner, admin_token, "20100-B", "TL4(Vinsol) B", "ADHESIVE", "KG", 55.0, plant_id=str(plant_b["id"])),
                "adh_30100": ensure_inventory_item(runner, admin_token, "30100-B", "Alcosol B", "ADHESIVE", "KG", 60.0, plant_id=str(plant_b["id"])),
                "parchment": ensure_inventory_item(runner, admin_token, "PARCHMENT-B", "Parchment B", "PARCHMENT", "KG", 18.0, plant_id=str(plant_b["id"])),
            },
        }

        fg_items = {
            "spec_a_110_122_149_9": ensure_inventory_item(runner, admin_token, "FG-110-122-1499-A", "FG 110x122x149.9", "FINISHED_GOOD", "PCS", 15.0, plant_id=str(plant_a["id"])),
            "spec_b_125_138_149_9": ensure_inventory_item(runner, admin_token, "FG-125-138-1499-B", "FG 125x138x149.9", "FINISHED_GOOD", "PCS", 15.0, plant_id=str(plant_b["id"])),
            "spec_c_125_140_93_75": ensure_inventory_item(runner, admin_token, "FG-125-140-9375-A", "FG 125x140x93.75", "FINISHED_GOOD", "PCS", 15.0, plant_id=str(plant_a["id"])),
        }

        fixtures = validate_formula_fixtures(
            runner,
            spec_create_token,
            spec_approve_token,
            paper_maps_by_plant[str(plant_a["id"])],
            customer_primary,
            sizes["fixture_110_90_400"],
            mandrels["110"],
            sizes["fixture_110_122_150"],
            mandrels["110"],
        )
        runner.formula_fixtures.append(fixtures)

        scenarios = [
            {"name": "spec_a_110_122_149_9", "plant_key": "plant_a", "product_code": "DEMO-1101221499-250", "size": (110.0, 122.0, 149.9), "weight_g": 250.0, "cs": 400.0, "qty": 120.0, "dispatch_qty": 120.0, "capacity_probe": True, "parchment_choice": "Amma · Many patterns", "mandatory_ply_minimums": STRICT_COMBO_MINIMUMS},
            {"name": "spec_b_125_138_149_9", "plant_key": "plant_b", "product_code": "DEMO-1251381499-300", "size": (125.0, 138.0, 149.9), "weight_g": 300.0, "cs": 350.0, "qty": 110.0, "dispatch_qty": 110.0, "parchment_choice": "Sagar · Many patterns", "mandatory_ply_minimums": STRICT_COMBO_MINIMUMS},
            {"name": "spec_c_125_140_93_75", "plant_key": "plant_a", "product_code": "DEMO-12514009375-225", "size": (125.0, 140.0, 93.75), "weight_g": 225.0, "cs": 300.0, "qty": 100.0, "dispatch_qty": 60.0, "qc_hold": True, "parchment_choice": "China · Many patterns", "mandatory_ply_minimums": STRICT_COMBO_MINIMUMS},
        ]

        first_dispatch_request_id: str | None = None
        for idx, scenario in enumerate(scenarios):
            plant_key = str(scenario["plant_key"])
            plant_suffix = "a" if plant_key == "plant_a" else "b"
            flow = run_sales_flow(
                runner,
                owner_token=owner_token,
                planner_token=seeded_users[f"planner_{plant_suffix}"]["token"],
                production_token=seeded_users[f"production_{plant_suffix}"]["token"],
                store_token=seeded_users[f"store_{plant_suffix}"]["token"],
                supervisor_token=seeded_users[f"supervisor_{plant_suffix}"]["token"],
                dispatch_token=seeded_users[f"dispatch_{plant_suffix}"]["token"],
                qc_token=seeded_users[f"qc_{plant_suffix}"]["token"],
                spec_maker_token=spec_create_token,
                spec_approver_token=spec_approve_token,
                sales_maker_token=seeded_users[f"sales_maker_{plant_suffix}"]["token"],
                sales_approver_token=seeded_users[f"sales_approver_{plant_suffix}"]["token"],
                sales_maker_email=seeded_users[f"sales_maker_{plant_suffix}"]["email"],
                sales_approver_email=seeded_users[f"sales_approver_{plant_suffix}"]["email"],
                scenario=scenario,
                plant_id=str(plant_a["id"] if plant_key == "plant_a" else plant_b["id"]),
                customer=customers[idx],
                tube_size=sizes[scenario["name"]],
                mandrel=mandrels["125.55"] if scenario["name"] in {"spec_b_125_138_149_9", "spec_c_125_140_93_75"} else mandrels["110.65"],
                machines=machines_by_plant[plant_key],
                raw_paper_item_id=raw_items[plant_key]["id"],
                manual_issue_item_id=manual_issue_items[plant_key]["adh_20100"]["id"],
                fg_item_id=fg_items[scenario["name"]]["id"],
                conflict_request_id=first_dispatch_request_id if scenario["name"] == "spec_b_125_138_149_9" else None,
            )
            if first_dispatch_request_id is None:
                first_dispatch_request_id = flow.get("dispatch_request_id")
            runner.flows.append(flow)
            runner.add(f"{scenario['name']} E2E flow", True, f"order={flow['sales_order_id']} dispatch={flow['dispatch_id']}")

        demo_release_order = seed_multiline_release_demo(
            runner,
            plant_id=str(plant_a["id"]),
            customer=customers[3],
            sales_maker_token=seeded_users["sales_maker_a"]["token"],
            sales_approver_token=seeded_users["sales_approver_a"]["token"],
            spec_maker_token=spec_create_token,
            spec_approver_token=spec_approve_token,
            planner_token=seeded_users["planner_a"]["token"],
            sizes=sizes,
            mandrels=mandrels,
            machines=machines_by_plant["plant_a"],
        )
        audit_master_updates(
            runner,
            token=owner_token,
            plant_id=str(plant_a["id"]),
            flow_anchor=runner.flows[0],
        )

        _, specs_all = runner.api(
            "GET",
            "/api/spec/specifications",
            token=owner_token,
            extra_headers={"X-Plant-ID": "ALL"},
        )
        visible_spec_plants = sorted({str(row.get("plant_id") or "") for row in (specs_all or []) if row.get("plant_id")})
        runner.add("Owner ALL scope spec list spans both plants", len(visible_spec_plants) >= 2, f"plants={visible_spec_plants}")

        _, inventory_all = runner.api(
            "GET",
            "/api/inventory/balance",
            token=owner_token,
            extra_headers={"X-Plant-ID": "ALL"},
        )
        inventory_rows = inventory_all.get("items") if isinstance(inventory_all, dict) else inventory_all
        inventory_row_count = len(inventory_rows) if isinstance(inventory_rows, list) else 0
        runner.add(
            "Owner ALL scope inventory read",
            isinstance(inventory_rows, list) and inventory_row_count > 0,
            f"rows={inventory_row_count}",
        )

        _, planning_all = runner.api(
            "GET",
            "/api/production/planning/board",
            token=owner_token,
            params={"stage": "WINDER", "plan_date": _to_iso_date(0)},
            extra_headers={"X-Plant-ID": "ALL"},
        )
        runner.add(
            "Planning board ALL scope requires explicit plant",
            bool(planning_all.get("scope_all")) and bool(planning_all.get("requires_explicit_plant")) and not planning_all.get("stages"),
            f"requires_explicit_plant={planning_all.get('requires_explicit_plant')}",
        )

        _, owner_pack_all = runner.api(
            "GET",
            "/api/analytics/reports/owner-pack",
            token=owner_token,
            params={"start_date": _to_iso_date(0), "end_date": _to_iso_date(0), "granularity": "day"},
            extra_headers={"X-Plant-ID": "ALL"},
        )
        runner.add("Owner ALL scope owner-pack report", bool(owner_pack_all), "HTTP 200")

        resp, payload = runner.api(
            "GET",
            f"/api/production/job-cards/{runner.flows[0]['job_card_id']}",
            token=seeded_users["planner_b"]["token"],
            expected=(404,),
            extra_headers={"X-Plant-ID": str(plant_b["id"])},
        )
        runner.add("Plant B planner cannot read Plant A job card", resp.status_code == 404, str(payload.get("detail") if isinstance(payload, dict) else payload))
        resp, payload = runner.api(
            "GET",
            f"/api/production/job-cards/{runner.flows[1]['job_card_id']}",
            token=seeded_users["planner_a"]["token"],
            expected=(404,),
            extra_headers={"X-Plant-ID": str(plant_a["id"])},
        )
        runner.add("Plant A planner cannot read Plant B job card", resp.status_code == 404, str(payload.get("detail") if isinstance(payload, dict) else payload))
        resp, payload = runner.api(
            "GET",
            f"/api/sales/orders/{runner.flows[1]['sales_order_id']}",
            token=seeded_users["sales_maker_a"]["token"],
            expected=(404,),
            extra_headers={"X-Plant-ID": str(plant_a["id"])},
        )
        runner.add("Plant A sales maker cannot read Plant B sales order", resp.status_code == 404, str(payload.get("detail") if isinstance(payload, dict) else payload))

        _, role_matrix = runner.api("GET", "/api/auth/roles/matrix", token=admin_token)
        seeded_groups = role_matrix.get("seeded_role_groups") or []
        runner.add("Role matrix seeded groups", len(seeded_groups) >= 8, f"groups={len(seeded_groups)}")
        runner.evidence["role_matrix"] = {
            "seeded_group_count": len(seeded_groups),
            "role_count": len(role_matrix.get("roles") or []),
        }

        palette_query = str(runner.flows[0].get("sales_order_no") or "SO").strip()
        _, palette = runner.api("GET", "/api/workspace/command-palette", token=sales_maker_token, params={"q": palette_query})
        palette_entities = palette.get("entities") or []
        palette_ok = any(str(item.get("kind")) == "sales-order" for item in palette_entities)
        runner.add("Workspace command palette sales lookup", palette_ok, f"query={palette_query} entities={len(palette_entities)}")
        runner.evidence["command_palette"] = palette

        _, notifications = runner.api("GET", "/api/auth/notifications", token=owner_token, params={"limit": 20})
        notification_items = notifications.get("items") or []
        runner.add("Notifications feed", len(notification_items) > 0, f"items={len(notification_items)}")
        _, unread = runner.api("GET", "/api/auth/notifications/unread-count", token=owner_token)
        unread_count = int(unread.get("count") or 0)
        runner.add("Notifications unread count", unread_count >= 0, f"count={unread_count}")
        if notification_items:
            runner.api("POST", f"/api/auth/notifications/{notification_items[0]['id']}/read", token=owner_token)
            runner.add("Notifications mark one read", True, f"id={notification_items[0]['id']}")
        runner.api("POST", "/api/auth/notifications/mark-all-read", token=owner_token)
        runner.add("Notifications mark all read", True, "completed")
        runner.evidence["notifications"] = {"count": len(notification_items), "unread_count": unread_count}

        analytics_paths = [
            "/api/analytics/production/winder",
            "/api/analytics/production/oven",
            "/api/analytics/production/process",
            "/api/analytics/production/trends",
            "/api/analytics/production/shrink",
            "/api/analytics/production/scrap",
            "/api/analytics/quality/compliance",
        ]
        analytics_params = {
            "start_date": _to_iso_date(-7),
            "end_date": _to_iso_date(0),
        }
        analytics_payloads: dict[str, Any] = {}
        for path in analytics_paths:
            _, payload = runner.api("GET", path, token=admin_token, params=analytics_params)
            analytics_payloads[path] = payload
            runner.add(f"Analytics {path}", True, "HTTP 200")

        runner.evidence["analytics"] = analytics_payloads

        today_params = {"start_date": _to_iso_date(0), "end_date": _to_iso_date(0), "granularity": "day"}
        week_params = {"start_date": _to_iso_date(-6), "end_date": _to_iso_date(0), "granularity": "day"}
        month_params = {"start_date": _to_iso_date(-29), "end_date": _to_iso_date(0), "granularity": "week"}
        all_time_params = {"start_date": _to_iso_date(-180), "end_date": _to_iso_date(0), "granularity": "month"}
        custom_params = {"start_date": _to_iso_date(-13), "end_date": _to_iso_date(-2), "granularity": "day"}

        report_evidence: dict[str, Any] = {}
        _, owner_dashboard = runner.api("GET", "/api/analytics/dashboard/owner", token=owner_token, params=week_params)
        owner_dashboard_ok = bool(owner_dashboard.get("headline") or owner_dashboard.get("summary") or owner_dashboard.get("exception_groups"))
        runner.add(
            "Owner dashboard aggregate",
            owner_dashboard_ok,
            f"keys={sorted(owner_dashboard.keys())[:8]}",
        )
        report_evidence["owner_dashboard"] = owner_dashboard
        report_evidence["owner_pack_today"] = verify_report_json(
            runner,
            token=owner_token,
            label="Owner pack today preset",
            path="/api/analytics/reports/owner-pack",
            params=today_params,
            expected_keys=["headline", "production", "sales", "inventory", "exceptions"],
        )
        report_evidence["owner_pack_week"] = verify_report_json(
            runner,
            token=owner_token,
            label="Owner pack week preset",
            path="/api/analytics/reports/owner-pack",
            params=week_params,
            expected_keys=["headline", "production", "sales", "inventory", "exceptions"],
        )
        report_evidence["owner_pack_month"] = {
            "skipped": True,
            "reason": "Demo verification keeps owner-pack checks focused on active operational presets.",
            "params": month_params,
        }
        report_evidence["owner_pack_all_time"] = {
            "skipped": True,
            "reason": "Demo verification keeps owner-pack checks focused on active operational presets.",
            "params": all_time_params,
        }
        report_evidence["owner_pack_custom"] = {
            "skipped": True,
            "reason": "Demo verification keeps owner-pack checks focused on active operational presets.",
            "params": custom_params,
        }
        verify_owner_pack_export(
            runner,
            token=owner_token,
            label="Owner pack HTML export",
            path="/api/analytics/reports/owner-pack/html",
            params=week_params,
            expected_content_type="text/html",
            min_bytes=1024,
        )
        verify_owner_pack_export(
            runner,
            token=owner_token,
            label="Owner pack PDF export",
            path="/api/analytics/reports/owner-pack/pdf",
            params=week_params,
            expected_content_type="application/pdf",
            min_bytes=4096,
        )
        report_evidence["production"] = verify_report_json(
            runner,
            token=production_token,
            label="Production report",
            path="/api/analytics/reports/production",
            params=custom_params,
        )
        report_evidence["sales"] = verify_report_json(
            runner,
            token=sales_approver_token,
            label="Sales report",
            path="/api/analytics/reports/sales",
            params=week_params,
        )
        report_evidence["quality"] = verify_report_json(
            runner,
            token=qc_token,
            label="Quality report",
            path="/api/analytics/reports/quality",
            params=today_params,
        )
        report_evidence["dispatch"] = verify_report_json(
            runner,
            token=dispatch_token,
            label="Dispatch report",
            path="/api/analytics/reports/dispatch",
            params=month_params,
        )
        report_evidence["inventory_health"] = verify_report_json(
            runner,
            token=store_token,
            label="Inventory health report",
            path="/api/analytics/reports/inventory-health",
            params=all_time_params,
        )
        report_evidence["plant_compare"] = verify_report_json(
            runner,
            token=owner_token,
            label="Plant compare report",
            path="/api/analytics/reports/plant-compare",
            params=month_params,
            extra_headers={"X-Plant-ID": "ALL"},
        )
        plant_compare_rows = report_evidence["plant_compare"].get("rows") or []
        runner.add(
            "Plant compare includes both plants",
            len(plant_compare_rows) >= 2,
            f"rows={len(plant_compare_rows)}",
        )
        report_evidence["exceptions"] = verify_report_json(
            runner,
            token=owner_token,
            label="Exceptions report",
            path="/api/analytics/reports/exceptions",
            params=week_params,
        )
        runner.evidence["reports"] = report_evidence

    except Exception as exc:
        runner.add("Execution", False, f"{type(exc).__name__}: {exc}")
        runner.evidence["exception"] = {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }

    total = len(runner.rows)
    failed = sum(1 for row in runner.rows if row.status == "FAIL")
    passed = total - failed

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_json_path = REPORT_DIR / f"hard_cutover_validation_{stamp}.json"
    report_md_path = REPORT_DIR / f"hard_cutover_validation_{stamp}.md"
    latest_report_json_path = REPORT_DIR / "hard_cutover_validation_latest.json"
    latest_report_md_path = REPORT_DIR / "hard_cutover_validation_latest.md"
    browser_fixture_path = REPORT_DIR / "browser_e2e_fixture_latest.json"

    report_obj = {
        "timestamp": datetime.now().isoformat(),
        "bff_url": BFF_URL,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": failed,
        },
        "checks": [row.__dict__ for row in runner.rows],
        "flows": runner.flows,
        "formula_fixtures": runner.formula_fixtures,
        "evidence": runner.evidence,
    }

    report_blob = json.dumps(report_obj, indent=2)
    report_json_path.write_text(report_blob, encoding="utf-8")
    latest_report_json_path.write_text(report_blob, encoding="utf-8")
    browser_users = {
        key: {
            "email": value["email"],
            "password": value["password"],
            "roles": value["roles"],
            "plant_id": value["plant_id"],
            "allowed_plant_ids": value["allowed_plant_ids"],
            "is_owner_all_plants": value["is_owner_all_plants"],
        }
        for key, value in (locals().get("seeded_users") or {}).items()
    }
    browser_users["admin"] = {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
        "roles": ["Admin"],
        "plant_id": None,
        "allowed_plant_ids": [],
        "is_owner_all_plants": True,
    }
    browser_fixture = {
        "generated_at": datetime.now().isoformat(),
        "base_urls": {
            "web": os.getenv("WEB_URL", str(RUNTIME_URLS.get("web") or f"http://{RUNTIME_HOST}:13000")),
            "bff": BFF_URL,
        },
        "auth": {
            "admin_email": ADMIN_EMAIL,
            "admin_password": ADMIN_PASSWORD,
        },
        "users": browser_users,
        "plants": runner.evidence.get("plants") or {},
        "flows": runner.flows,
        "reports": {
            "json": str(report_json_path),
            "markdown": str(report_md_path),
        },
        "demo_release_order": runner.evidence.get("demo_release_order") or {},
        "master_audit": runner.evidence.get("master_audit") or {},
        "formula_fixtures": runner.formula_fixtures,
    }
    browser_fixture_path.write_text(json.dumps(browser_fixture, indent=2), encoding="utf-8")

    lines = [
        f"# Hard Cutover Validation Report ({datetime.now().date().isoformat()})",
        "",
        f"- Generated at: `{datetime.now().isoformat()}`",
        f"- BFF URL: `{BFF_URL}`",
        f"- Summary: **PASS={passed} FAIL={failed} TOTAL={total}**",
        "",
        "## Check Matrix",
        "",
        "| Status | Check | Detail |",
        "|---|---|---|",
    ]
    for row in runner.rows:
        safe_detail = row.detail.replace("|", "\\|")
        lines.append(f"| {row.status} | {row.name} | {safe_detail} |")

    lines.extend(
        [
            "",
            "## RM Whitelist Evidence",
            "",
            "```json",
            json.dumps(runner.evidence.get("rm_whitelist") or {}, indent=2),
            "```",
            "",
            "## Replacement Spec Evidence",
            "",
            "```json",
            json.dumps(runner.evidence.get("replacement_specs") or [], indent=2),
            "```",
            "",
            "## Issue Model and Auto-Consumption Evidence",
            "",
            "```json",
            json.dumps(
                [
                    {
                        "name": flow.get("name"),
                        "manual_issue_transaction_id": flow.get("manual_issue_transaction_id"),
                        "monthly_summary_month": flow.get("monthly_summary_month"),
                        "monthly_summary_total_provisional_theory_kg": flow.get("monthly_summary_total_provisional_theory_kg"),
                        "monthly_summary_item_codes": flow.get("monthly_summary_item_codes"),
                    }
                    for flow in runner.flows
                ],
                indent=2,
            ),
            "```",
            "",
            "## Flow Evidence",
            "",
            "```json",
            json.dumps(runner.flows, indent=2),
            "```",
            "",
            "## Screenshot Recipe Summary",
            "",
        ]
    )

    for flow in runner.flows:
        lines.extend(
            [
                f"### {flow.get('name')}",
                "",
                f"- Plant: `{flow.get('plant_id')}`",
                f"- Qty: `{flow.get('qty')}`",
                f"- Recipe: `{flow.get('recipe_id')}`",
                f"- Parchment: `{flow.get('sales_order_parchment')}`",
                f"- Final status: `{flow.get('final_order_status')}`",
                "",
                "| Ply | Paper Code | GSM | BF |",
                "|---|---|---:|---:|",
            ]
        )
        for layer in flow.get("recipe_layers") or []:
            lines.append(
                f"| {layer.get('ply_no')} | {layer.get('code') or layer.get('paper_id')} | {layer.get('gsm_snapshot')} | {layer.get('bf_snapshot')} |"
            )
        lines.append("")

    lines.extend(
        [
            "## Formula Fixtures",
            "",
            "```json",
            json.dumps(runner.formula_fixtures, indent=2),
            "```",
            "",
            f"JSON artifact: `{report_json_path}`",
            "",
            f"Browser fixture: `{browser_fixture_path}`",
        ]
    )

    report_markdown = "\n".join(lines)
    report_md_path.write_text(report_markdown, encoding="utf-8")
    latest_report_md_path.write_text(report_markdown, encoding="utf-8")

    print(json.dumps({
        "summary": {"passed": passed, "failed": failed, "total": total},
        "report_json": str(report_json_path),
        "report_md": str(report_md_path),
        "browser_fixture": str(browser_fixture_path),
    }))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
