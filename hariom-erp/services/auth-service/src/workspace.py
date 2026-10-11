from __future__ import annotations

from typing import Iterable

LANDING_PRIORITY = [
    "Owner",
    "Admin",
    "PlantManager",
    "QC",
    "Planner",
    "Store",
    "Dispatch",
    "Sales",
    # Narrow desk roles (client request 2026-10-11): each owns one store/quality desk.
    "InwardQC",
    "GRN",
    "RMIssue",
    "Operator",
]

BUSINESS_ROLE_ORDER = LANDING_PRIORITY.copy()
BUSINESS_ROLE_SET = set(BUSINESS_ROLE_ORDER)

ROLE_TO_LANDING = {
    "Owner": "Owner",
    "Admin": "Admin",
    "PlantManager": "PlantManager",
    "Planner": "Planner",
    "SpecMaker": "Planner",
    "SpecApprover": "Planner",
    "Production": "PlantManager",
    "Operator": "Operator",
    "SupervisorEntry": "PlantManager",
    "Store": "Store",
    "Dispatch": "Dispatch",
    "DispatchMaker": "Dispatch",
    "DispatchApprover": "Dispatch",
    "Sales": "Sales",
    "SOMaker": "Sales",
    "SOApprover": "Sales",
    "QC": "QC",
    "InwardQC": "InwardQC",
    "GRN": "GRN",
    "RMIssue": "RMIssue",
}

LEGACY_ROLE_NAMES = sorted({role for role in ROLE_TO_LANDING if role not in BUSINESS_ROLE_SET})

LANDING_LABELS = {
    "Owner": "Owner",
    "Admin": "Admin",
    "PlantManager": "Plant Manager",
    "QC": "Quality Control",
    "Planner": "Planner",
    "Store": "Store",
    "Dispatch": "Dispatch",
    "Sales": "Sales",
    "InwardQC": "Inward QC",
    "GRN": "GRN / Goods Receipt",
    "RMIssue": "Raw Material Issue",
    "Operator": "Operator",
}

ROLE_CAPABILITIES = {
    "Owner": {
        "summary": "Full company visibility, dashboards, approvals, specs, stock close, and system oversight.",
        "permissions": [
            "analytics:view",
            "reports:view",
            "spec:create",
            "so:create",
            "so:approve",
            "planning:schedule",
            "production:entry",
            "production:close",
            "inventory:inward",
            "inventory:reserve",
            "inventory:close",
            "dispatch:create",
            "dispatch:approve",
            "dispatch:validate",
            "master:manage",
            "supplier:manage",
            "location:manage",
            "system:manage",
            "qc:disposition:approve",
        ],
    },
    "Admin": {
        "summary": "System setup, users, plants, machines, locations, masters, and role governance.",
        "permissions": [
            "analytics:view",
            "reports:view",
            "spec:create",
            "so:create",
            "so:approve",
            "planning:schedule",
            "production:entry",
            "production:close",
            "inventory:inward",
            "inventory:reserve",
            "inventory:close",
            "dispatch:create",
            "dispatch:approve",
            "dispatch:validate",
            "master:manage",
            "supplier:manage",
            "location:manage",
            "system:manage",
            "qc:disposition:approve",
        ],
    },
    "Sales": {
        "summary": "Customer PO, sales orders, release requests, and commercial tracking.",
        "permissions": ["so:create", "so:approve", "reports:view"],
    },
    "Planner": {
        "summary": "Release queue, three-day machine planning, tracker, MRP signals, and schedule reports.",
        "permissions": ["planning:schedule", "so:approve", "analytics:view", "reports:view"],
    },
    "PlantManager": {
        "summary": "Supervisor entry, machine execution, stage completion, QC holds, and reconciliation.",
        "permissions": ["production:entry", "production:close", "inventory:reserve", "analytics:view", "reports:view"],
    },
    "QC": {
        "summary": "Assigned item, spec, job, and receipt quality context; inspections; holds; proposed dispositions; and permitted quality reports.",
        "permissions": [
            "qc:inspect",
            "qc:hold:create",
            "qc:disposition:propose",
            "reports:view",
        ],
    },
    "Store": {
        "summary": "RM inward, reel issue, locations, stock risk, opening load, and stock close support.",
        "permissions": ["inventory:inward", "inventory:reserve", "inventory:close", "supplier:manage", "reports:view"],
    },
    "Dispatch": {
        "summary": "Finished-goods readiness, challans, dispatch validation, and customer handoff.",
        "permissions": ["dispatch:create", "dispatch:approve", "dispatch:validate", "reports:view"],
    },
    "InwardQC": {
        "summary": "Incoming (inward) QC only: inspect received reels and lots against the approved material standards, release or reject them.",
        "permissions": ["qc:inspect:incoming", "qc:hold:create", "reports:view"],
    },
    "GRN": {
        "summary": "Goods receipt only: receive supplier deliveries against approved POs, weigh reels/coils, print labels and keep the GRN register.",
        "permissions": ["inventory:inward", "inventory:grn", "reports:view"],
    },
    "RMIssue": {
        "summary": "Raw material issue only: issue reels and materials to job cards and machines, take returns, and trace issued stock.",
        "permissions": ["inventory:issue", "inventory:reserve", "reports:view"],
    },
    "Operator": {
        "summary": "QR scan, assigned job card, and simple floor input only.",
        "permissions": ["operator:scan", "production:entry"],
    },
}

OVERRIDE_RIGHTS = [
    {"key": "sales", "label": "Sales order rights", "roles": ["Sales"]},
    {"key": "planner", "label": "Planner board rights", "roles": ["Planner"]},
    {"key": "plant_floor", "label": "Supervisor / plant floor rights", "roles": ["PlantManager"]},
    {"key": "qc", "label": "Quality control rights", "roles": ["QC"]},
    {"key": "store", "label": "Inventory and stock-close rights", "roles": ["Store"]},
    {"key": "dispatch", "label": "Dispatch rights", "roles": ["Dispatch"]},
    {"key": "inward_qc", "label": "Inward QC rights", "roles": ["InwardQC"]},
    {"key": "grn", "label": "Goods receipt (GRN) rights", "roles": ["GRN"]},
    {"key": "rm_issue", "label": "Raw material issue rights", "roles": ["RMIssue"]},
    {"key": "operator", "label": "QR operator rights", "roles": ["Operator"]},
    {"key": "reports", "label": "Reports and analytics visibility", "roles": ["Owner"]},
    {"key": "system", "label": "System setup rights", "roles": ["Admin"]},
]


def canonical_role_name(role: str | None) -> str | None:
    if not role:
        return None
    text = str(role).strip()
    return ROLE_TO_LANDING.get(text, text if text in BUSINESS_ROLE_SET else None)


def resolve_landing_role(role_names: Iterable[str]) -> str | None:
    normalized = {canonical_role_name(role) for role in role_names if canonical_role_name(role)}
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
        grouped.append(
            {
                "landing_role": landing_role,
                "landing_label": landing_label(landing_role),
                "roles": [landing_role],
                "summary": ROLE_CAPABILITIES[landing_role]["summary"],
                "permissions": ROLE_CAPABILITIES[landing_role]["permissions"],
            }
        )
    return grouped
