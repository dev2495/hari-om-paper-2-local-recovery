from types import SimpleNamespace
import uuid

from src.notification_service import (
    user_can_receive_for_plant,
    user_has_required_capability,
    user_allowed_plant_ids,
    resolve_event_plant_id,
)


PLANT_A = "00000000-0000-0000-0000-0000000000a1"
PLANT_B = "00000000-0000-0000-0000-0000000000b2"


def _user(*, roles, plant_id, extra_plants=None, active=True, permissions=None, all_plants=False):
    role_objs = []
    for name in roles:
        perms = [SimpleNamespace(name=item) for item in (permissions or [])]
        role_objs.append(SimpleNamespace(name=name, permissions=perms))
    plants = [SimpleNamespace(id=uuid.UUID(plant_id))]
    for extra in extra_plants or []:
        plants.append(SimpleNamespace(id=uuid.UUID(extra)))
    return SimpleNamespace(
        is_active=active,
        roles=role_objs,
        plant_id=uuid.UUID(plant_id),
        allowed_plants=plants,
        is_owner_all_plants=all_plants,
    )


def test_qc_plant_a_does_not_receive_plant_b_role_broadcast():
    user = _user(roles=["QC"], plant_id=PLANT_A)
    assert user_can_receive_for_plant(user, PLANT_A, "QC") is True
    assert user_can_receive_for_plant(user, PLANT_B, "QC") is False


def test_qc_role_broadcast_without_plant_is_suppressed():
    user = _user(roles=["QC"], plant_id=PLANT_A)
    assert user_can_receive_for_plant(user, None, "QC") is False


def test_inactive_qc_user_is_skipped():
    user = _user(roles=["QC"], plant_id=PLANT_A, active=False)
    assert user_can_receive_for_plant(user, PLANT_A, "QC") is False


def test_owner_can_receive_plant_scoped_event():
    user = _user(roles=["Owner"], plant_id=PLANT_A, extra_plants=[PLANT_B], all_plants=True)
    assert user_can_receive_for_plant(user, PLANT_B, "Owner") is True


def test_qc_without_disposition_capability_is_filtered():
    user = _user(roles=["QC"], plant_id=PLANT_A, permissions=["qc:inspect"])
    assert user_has_required_capability(user, required_permissions=["qc:disposition:approve"]) is False


def test_event_plant_resolves_from_payload_alias():
    assert resolve_event_plant_id(plant_id=None, payload={"plant_id": "PLANT_A"}) == PLANT_A


def test_limited_admin_without_all_plants_stays_on_assigned_plants():
    user = _user(roles=["Admin"], plant_id=PLANT_A, all_plants=False)
    assert user_can_receive_for_plant(user, PLANT_A, "Admin") is True
    assert user_can_receive_for_plant(user, PLANT_B, "Admin") is False


def test_explicit_user_without_plant_does_not_bypass_scope():
    user = _user(roles=["QC"], plant_id=PLANT_A)
    assert user_can_receive_for_plant(user, None, "QC", explicit_user=True) is False
