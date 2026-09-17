from src.workspace import (
    BUSINESS_ROLE_ORDER,
    LANDING_PRIORITY,
    ROLE_CAPABILITIES,
    ROLE_TO_LANDING,
    canonical_role_name,
    resolve_landing_role,
)


def test_qc_is_a_canonical_business_role():
    assert "QC" in BUSINESS_ROLE_ORDER
    assert "QC" in LANDING_PRIORITY
    assert ROLE_TO_LANDING["QC"] == "QC"
    assert canonical_role_name("QC") == "QC"
    assert resolve_landing_role(["QC"]) == "QC"


def test_qc_is_not_aliased_to_plant_manager():
    assert canonical_role_name("QC") != "PlantManager"
    assert resolve_landing_role(["QC"]) != "PlantManager"


def test_qc_capabilities_exclude_admin_sales_and_stock_adjust():
    permissions = set(ROLE_CAPABILITIES["QC"]["permissions"])
    assert "qc:inspect" in permissions
    assert "qc:hold:create" in permissions
    assert "qc:disposition:propose" in permissions
    assert "reports:view" in permissions
    assert "qc:disposition:approve" not in permissions
    assert "system:manage" not in permissions
    assert "so:approve" not in permissions
    assert "inventory:close" not in permissions
    assert "inventory:inward" not in permissions


def test_concession_capability_is_owner_admin_not_qc():
    assert "qc:disposition:approve" in ROLE_CAPABILITIES["Owner"]["permissions"]
    assert "qc:disposition:approve" in ROLE_CAPABILITIES["Admin"]["permissions"]
    assert "qc:disposition:approve" not in ROLE_CAPABILITIES["PlantManager"]["permissions"]
    assert "qc:disposition:approve" not in ROLE_CAPABILITIES["QC"]["permissions"]


def test_legacy_supervisor_still_lands_on_plant_manager():
    assert canonical_role_name("SupervisorEntry") == "PlantManager"
    assert canonical_role_name("Production") == "PlantManager"
