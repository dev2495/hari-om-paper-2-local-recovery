from __future__ import annotations

from typing import Iterable

LANDING_PRIORITY = [
    "Owner",
    "Admin",
    "PlantManager",
    "Planner",
    "Production",
    "Store",
    "Sales",
    "QC",
]

ROLE_TO_LANDING = {
    "Owner": "Owner",
    "Admin": "Admin",
    "PlantManager": "PlantManager",
    "Planner": "Planner",
    "SpecMaker": "Planner",
    "SpecApprover": "Planner",
    "Production": "Production",
    "Operator": "Production",
    "SupervisorEntry": "Production",
    "Store": "Store",
    "Dispatch": "Store",
    "DispatchMaker": "Store",
    "DispatchApprover": "Store",
    "Sales": "Sales",
    "SOMaker": "Sales",
    "SOApprover": "Sales",
    "QC": "QC",
}

LANDING_LABELS = {
    "Owner": "Owner",
    "Admin": "Admin",
    "PlantManager": "Plant Manager",
    "Planner": "Planner",
    "Production": "Production",
    "Store": "Store",
    "Sales": "Sales",
    "QC": "QC",
}

SEEDED_ROLE_ORDER = [
    "Owner",
    "Admin",
    "PlantManager",
    "Planner",
    "SpecMaker",
    "SpecApprover",
    "Production",
    "Operator",
    "SupervisorEntry",
    "Store",
    "Dispatch",
    "DispatchMaker",
    "DispatchApprover",
    "Sales",
    "SOMaker",
    "SOApprover",
    "QC",
]


def resolve_landing_role(role_names: Iterable[str]) -> str | None:
    normalized = {ROLE_TO_LANDING.get(role) for role in role_names if ROLE_TO_LANDING.get(role)}
    for landing in LANDING_PRIORITY:
        if landing in normalized:
            return landing
    return None


def landing_label(landing_role: str | None) -> str | None:
    if not landing_role:
        return None
    return LANDING_LABELS.get(landing_role, landing_role)


def seeded_role_groups() -> list[dict[str, object]]:
    grouped: list[dict[str, object]] = []
    for landing_role in LANDING_PRIORITY:
        roles = [role for role in SEEDED_ROLE_ORDER if ROLE_TO_LANDING.get(role) == landing_role]
        grouped.append(
            {
                "landing_role": landing_role,
                "landing_label": landing_label(landing_role),
                "roles": roles,
            }
        )
    return grouped
