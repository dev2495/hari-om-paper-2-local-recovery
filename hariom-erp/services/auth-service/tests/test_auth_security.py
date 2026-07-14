from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request
from pydantic import ValidationError

from src.routers import auth
from src.utils.deps import get_session_claims, require_role


@pytest.mark.parametrize(
    "password",
    [
        "Short1!",
        "alllowercase1!",
        "ALLUPPERCASE1!",
        "NoDigitsHere!",
        "NoSymbolsHere1",
    ],
)
def test_user_password_policy_rejects_weak_passwords(password):
    with pytest.raises(ValidationError):
        auth.UserCreate(name="User", email="user@example.com", password=password)


def test_user_password_policy_accepts_strong_password():
    payload = auth.UserCreate(name="User", email="user@example.com", password="Production1!Safe")
    assert payload.password == "Production1!Safe"


class _NoUserQuery:
    def filter(self, *_args):
        return self

    def first(self):
        return None


class _NoUserDb:
    def query(self, *_args):
        return _NoUserQuery()


def test_failed_login_rate_limit_blocks_sixth_attempt(monkeypatch):
    monkeypatch.setattr(auth, "LOGIN_MAX_ATTEMPTS", 5)
    monkeypatch.setattr(auth, "LOGIN_WINDOW_SECONDS", 900)
    auth._login_attempts.clear()
    request = Request({"type": "http", "method": "POST", "path": "/auth/login", "headers": [], "client": ("10.0.0.1", 1234)})
    form = SimpleNamespace(username="missing@example.com", password="wrong")

    for _attempt in range(5):
        with pytest.raises(HTTPException) as caught:
            auth.login(request=request, form_data=form, db=_NoUserDb())
        assert caught.value.status_code == 401

    with pytest.raises(HTTPException) as caught:
        auth.login(request=request, form_data=form, db=_NoUserDb())
    assert caught.value.status_code == 429


def test_unassigned_acting_role_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ALLOW_UNASSIGNED_ACTING_ROLES", raising=False)
    user = SimpleNamespace(roles=[SimpleNamespace(name="Owner", permissions=[])])
    with pytest.raises(HTTPException) as caught:
        auth.set_acting_role(
            payload=auth.ActingRolePayload(role_name="Dispatch"),
            db=SimpleNamespace(),
            current_user=user,
        )
    assert caught.value.status_code == 403


def test_session_claims_prefer_effective_acting_roles():
    user = SimpleNamespace(
        roles=[SimpleNamespace(name="Owner")],
        token_payload={"roles": ["Owner"], "effective_roles": ["Dispatch"]},
    )
    assert get_session_claims(user)["roles"] == ["Dispatch"]


def test_privileged_dependency_rejects_owner_during_dispatch_acting_session():
    user = SimpleNamespace(
        roles=[SimpleNamespace(name="Owner")],
        token_payload={"roles": ["Dispatch"], "effective_roles": ["Dispatch"]},
    )
    with pytest.raises(HTTPException) as caught:
        require_role(["Owner", "Admin"])(current_user=user)
    assert caught.value.status_code == 403


def test_production_app_imports_all_routers():
    from src.main import app

    assert any(route.path == "/plants" for route in app.routes)
