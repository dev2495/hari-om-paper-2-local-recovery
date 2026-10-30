"""Parchment colours must come from the parchment colour master (client 2026-10-28, "there is no none").

The release dialog and the order form only offer master colours, but the API used to accept any text,
so "None", "-" or a made-up name could become a job card colour. This module:

* refuses placeholder words ("none", "no parchment", "-", ...) everywhere a colour is saved;
* checks a colour that is new on a line against the active master colours of the plant, using the
  caller's own sign-in (Authorization and X-Plant-ID of the request being served).

Direct calls without an HTTP request (unit tests, internal jobs) skip the master lookup; the
placeholder check still applies to them.
"""
from __future__ import annotations

import contextvars
import logging
import os
import re
import uuid
from typing import Any, Optional

import requests
from fastapi import HTTPException

logger = logging.getLogger(__name__)

MASTERDATA_SERVICE_URL = os.getenv(
    "MASTERDATA_SERVICE_URL",
    os.getenv("MASTER_DATA_SERVICE_URL", "http://masterdata-service:8002"),
)

# Words that mean "no parchment". Compared after lower-casing and squeezing spaces.
_PLACEHOLDER_WORDS = {
    "none", "no", "nil", "null", "na", "n/a", "n.a", "n.a.", "nothing", "not applicable",
    "no parchment", "without parchment", "without", "no colour", "no color", "no-parchment",
    "multiple colors", "multiple colours", "tbd", "undecided", "not decided", "0",
}

_REQUEST: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("sales_parchment_request", default=None)


class RequestContextMiddleware:
    """Pure ASGI middleware: remembers the caller's sign-in headers for the master lookup."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers") or []}
        token = _REQUEST.set({
            "authorization": headers.get("authorization") or "",
            "plant": headers.get("x-plant-id") or "",
            "cache": {},
        })
        try:
            await self.app(scope, receive, send)
        finally:
            _REQUEST.reset(token)


def is_placeholder_colour(name: Optional[str]) -> bool:
    text = re.sub(r"\s+", " ", str(name or "").strip().lower())
    if not text:
        return False
    if text in _PLACEHOLDER_WORDS:
        return True
    # Only punctuation ("-", "--", "—", "...") is not a colour either.
    return re.fullmatch(r"[\W_]+", text) is not None


def refuse_placeholder(name: Optional[str], line_no: Optional[int] = None) -> None:
    if is_placeholder_colour(name):
        prefix = f"Line {line_no}: " if line_no else ""
        raise HTTPException(
            status_code=400,
            detail=(
                f"{prefix}“{str(name).strip()}” is not a parchment colour. Every job card needs a parchment colour "
                "— pick one from the parchment colour list."
            ),
        )


def _fetch_master(ctx: dict) -> list[dict[str, Any]]:
    cache = ctx.setdefault("cache", {})
    if "colours" in cache:
        return cache["colours"]
    headers = {"Authorization": ctx.get("authorization") or ""}
    if ctx.get("plant"):
        headers["X-Plant-ID"] = ctx["plant"]
    try:
        colours = requests.get(f"{MASTERDATA_SERVICE_URL}/master/parchment/colors", headers=headers, timeout=6)
        vendors = requests.get(f"{MASTERDATA_SERVICE_URL}/master/parchment/vendors", headers=headers, timeout=6)
    except requests.RequestException as exc:
        logger.warning("parchment master lookup failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Could not check the parchment colour list just now. Nothing was saved — try again in a moment.",
        ) from exc
    if colours.status_code != 200 or vendors.status_code != 200:
        logger.warning("parchment master lookup answered %s / %s", colours.status_code, vendors.status_code)
        raise HTTPException(
            status_code=503,
            detail="Could not check the parchment colour list just now. Nothing was saved — try again in a moment.",
        )
    vendor_names = {str(row.get("id")): str(row.get("name") or "").strip() for row in vendors.json() or []}
    rows: list[dict[str, Any]] = []
    for row in colours.json() or []:
        if row.get("active") is False:
            continue
        name = str(row.get("color_name") or "").strip()
        if not name:
            continue
        vendor = vendor_names.get(str(row.get("vendor_id")), "")
        label = f"{name} / {vendor}" if vendor else name
        rows.append({"id": str(row.get("id")).lower(), "color_name": name, "label": label})
    cache["colours"] = rows
    return rows


def check_master_colour(
    name: Optional[str],
    color_id: Optional[uuid.UUID],
    *,
    line_no: Optional[int] = None,
) -> tuple[str, Optional[uuid.UUID]]:
    """A colour that is new on a line must be an active master colour. Returns (name, master id)."""
    text = str(name or "").strip()
    refuse_placeholder(text, line_no)
    ctx = _REQUEST.get()
    if not ctx or not ctx.get("authorization"):
        return text, color_id
    prefix = f"Line {line_no}: " if line_no else ""
    rows = _fetch_master(ctx)
    match = None
    if color_id is not None:
        match = next((row for row in rows if row["id"] == str(color_id).lower()), None)
    if match is None and text:
        wanted = text.lower()
        match = next((row for row in rows if wanted in {row["label"].lower(), row["color_name"].lower()}), None)
    if match is None:
        shown = text or "This colour"
        raise HTTPException(
            status_code=400,
            detail=(
                f"{prefix}“{shown}” is not in the parchment colour list. Pick a colour from the list, "
                "or ask the Admin to add it in Masters › Parchment first."
            ),
        )
    keep_name = text and text.lower() in {match["label"].lower(), match["color_name"].lower()}
    return (text if keep_name else match["label"]), uuid.UUID(match["id"])
