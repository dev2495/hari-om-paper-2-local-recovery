from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
import os

from src.middleware.auth import get_token
from src.services.http_client import http_client, proxy_to_service
from src.services.workspace import current_user_claims, emit_from_response, response_body_json

router = APIRouter()
SALES_SERVICE_URL = os.getenv("SALES_SERVICE_URL", "http://127.0.0.1:18008")
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")
ORDER_CLOSE_CATEGORY = "SO_CLOSE"


@router.get("/orders")
async def list_orders(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders", request, token)


@router.get("/orders/aggregates")
async def get_order_aggregates(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/aggregates", request, token)


@router.get("/orders/pending")
async def list_pending_orders(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/pending", request, token)


@router.get("/orders/pending/export")
async def export_pending_orders(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/pending/export", request, token)


@router.get("/orders/delivery-calendar")
async def get_delivery_calendar(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/delivery-calendar", request, token)


@router.get("/orders/open-demand")
async def list_open_demand(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/open-demand", request, token)


@router.post("/orders")
async def create_order(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SALES_SERVICE_URL, "/sales-orders", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_CREATED",
        title=f"Sales order created: {payload.get('order_no') or payload.get('id') or 'draft'}",
        message=f"{payload.get('customer_name') or 'Customer'} demand entered into the ERP flow.",
        href="/sales-orders",
        recipient_roles=["Owner", "Admin", "Sales", "Planner"],
        payload={"order_id": str(payload.get("id") or "")},
    )
    return response


@router.post("/orders/import")
async def import_orders(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/import", request, token)


@router.get("/orders/last-rate")
async def get_last_rate(request: Request, token: str = Depends(get_token)):
    """Last rate of the same customer and product, shown as a suggestion beside Rate / Pc (2026-10-28)."""
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/last-rate", request, token)


@router.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}", request, token)


@router.get("/orders/{order_id}/timeline")
async def get_order_timeline(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/timeline", request, token)


@router.get("/orders/{order_id}/history")
async def get_order_history(order_id: str, request: Request, token: str = Depends(get_token)):
    """One history for the order page (client 2026-10-27): the order's own events (sales) and every
    event of every job card released from it (production), newest first, in one shape."""
    import asyncio

    headers = {"Authorization": f"Bearer {token}"}
    if request.headers.get("X-Plant-ID"):
        headers["X-Plant-ID"] = request.headers["X-Plant-ID"]
    production_url = os.getenv("PRODUCTION_SERVICE_URL", "http://127.0.0.1:18004")
    sales_call = http_client.get(f"{SALES_SERVICE_URL}/sales-orders/{order_id}/timeline", headers=headers, params={"depth": "full"})
    cards_call = http_client.get(f"{production_url}/sales-orders/{order_id}/card-history", headers=headers)
    sales_response, cards_response = await asyncio.gather(sales_call, cards_call, return_exceptions=True)
    if isinstance(sales_response, Exception):
        raise HTTPException(status_code=502, detail="Sales service unavailable for the order history")
    if sales_response.status_code != 200:
        raise HTTPException(status_code=sales_response.status_code, detail=(sales_response.json() or {}).get("detail") if sales_response.headers.get("content-type", "").startswith("application/json") else "Order history could not be loaded")
    timeline = sales_response.json() or {}
    kind_of = {
        "SALES_ORDER_CREATED": "ORDER", "SALES_ORDER_LINE_CREATED": "ORDER", "SALES_ORDER_APPROVED": "ORDER", "SALES_ORDER_RELEASED": "RELEASE",
        "SALES_ORDER_CANCELLED": "CLOSE", "SALES_ORDER_SHORT_CLOSED": "CLOSE",
        # Customer PO (2026-10-28): an internal order confirmed by its PO, or the PO number changed.
        "SALES_ORDER_PO_CONFIRMED": "ORDER", "SALES_ORDER_PO_CHANGED": "EDIT",
    }
    events = [{
        "id": f"s:{row.get('id')}", "at": row.get("created_at"), "actor": row.get("actor"), "role": None,
        "kind": kind_of.get(str(row.get("event_type") or ""), "ORDER" if str(row.get("event_type") or "").startswith("SALES_ORDER") else "OTHER"),
        "source": "SALES", "title": row.get("title"), "detail": row.get("message"), "stage": None, "stage_label": None,
        "job_card_id": None, "job_card_no": None, "line_id": row.get("line_id"), "flag": False, "before": None, "after": row.get("metadata") or None,
    } for row in (timeline.get("events") or [])]
    warnings = list(timeline.get("warnings") or [])
    job_cards: list = []
    if isinstance(cards_response, Exception) or cards_response.status_code != 200:
        warnings.append("Job card events could not be loaded; only the order's own events are shown.")
    else:
        body = cards_response.json() or {}
        job_cards = body.get("job_cards") or []
        events += [{**row, "source": "PRODUCTION"} for row in body.get("events") or []]
    events.sort(key=lambda row: (str(row.get("at") or ""), str(row.get("id"))), reverse=True)
    return {"order_id": order_id, "order_no": timeline.get("order_no"), "status": timeline.get("status"), "events": events,
            "job_cards": job_cards, "warnings": warnings,
            "summary": {"events": len(events), "flags": sum(1 for row in events if row.get("flag"))}}


@router.get("/orders/{order_id}/delivery-schedules")
async def get_order_delivery_schedules(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/delivery-schedules", request, token)


@router.post("/orders/{order_id}/delivery-schedules/preview")
async def preview_order_delivery_schedules(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/delivery-schedules/preview", request, token)


@router.post("/orders/{order_id}/delivery-schedules/commit")
async def commit_order_delivery_schedules(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/delivery-schedules/commit", request, token)


@router.patch("/orders/{order_id}/delivery-schedules/{schedule_id}")
async def patch_order_delivery_schedule(order_id: str, schedule_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/delivery-schedules/{schedule_id}", request, token)


@router.post("/orders/{order_id}/delivery-schedules/group-move")
async def group_move_order_remainder(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        SALES_SERVICE_URL, f"/sales-orders/{order_id}/delivery-schedules/group-move", request, token
    )


@router.post("/orders/release-bulk")
async def bulk_release_order_lines(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders/release-bulk", request, token)


@router.post("/orders/{order_id}/schedule-entire-po/preview")
async def preview_schedule_entire_po(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/schedule-entire-po/preview", request, token)


@router.post("/orders/{order_id}/schedule-entire-po/commit")
async def commit_schedule_entire_po(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/schedule-entire-po/commit", request, token)


@router.put("/orders/{order_id}")
async def update_order(order_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_UPDATED",
        title=f"Sales order updated: {payload.get('order_no') or order_id}",
        message=f"{payload.get('customer_name') or 'Order'} details were updated.",
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner"],
        payload={"order_id": order_id},
    )
    return response


@router.post("/orders/{order_id}/customer-po")
async def set_customer_po(order_id: str, request: Request, token: str = Depends(get_token)):
    """Add or change the customer PO: free before release, once after release, then locked."""
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/customer-po", request, token)
    payload = response_body_json(response) or {}
    changes = payload.get("po_changes") or []
    last = changes[-1] if changes and isinstance(changes[-1], dict) else {}
    confirmed = last.get("kind") == "CONFIRMED"
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_PO_CONFIRMED" if confirmed else "SALES_ORDER_PO_CHANGED",
        title=(f"Order confirmed by customer PO {payload.get('po_number')}" if confirmed else f"Customer PO changed: {payload.get('po_number')}")
        + f" ({payload.get('order_no') or order_id})",
        message=(
            "The internal order is now a confirmed customer order."
            if confirmed
            else f"PO {last.get('old_po_number') or '-'} → {payload.get('po_number')}."
        )
        + (" Changed after release — the PO number is now locked." if last.get("after_release") else ""),
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner"],
        payload={"order_id": order_id},
    )
    if response.status_code != 200 or not isinstance(payload, dict):
        return response
    # Released job cards keep a copy of the PO; bring them up to date so the card, its print and
    # the planning overview show the confirmed / changed PO (client 2026-10-28).
    payload["job_card_po_sync"] = await _sync_job_card_po(order_id, request, token)
    return JSONResponse(content=payload, status_code=200)


@router.post("/orders/{order_id}/job-card-po-sync")
async def sync_job_card_po(order_id: str, request: Request, token: str = Depends(get_token)):
    """Retry copying the order's customer PO onto its job cards (after a failed try)."""
    result = await _sync_job_card_po(order_id, request, token)
    if not result.get("ok"):
        # A refusal (role, order not found, bad id) keeps its own status; only an outage is a 502.
        status = int(result.get("status") or 502)
        raise HTTPException(
            status_code=status if 400 <= status < 500 else 502,
            detail=result.get("detail") or "The job cards could not be updated with the new PO.",
        )
    return result


async def _sync_job_card_po(order_id: str, request: Request, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if request.headers.get("X-Plant-ID"):
        headers["X-Plant-ID"] = request.headers["X-Plant-ID"]
    production_url = os.getenv("PRODUCTION_SERVICE_URL", "http://127.0.0.1:18004")
    try:
        result = await http_client.post(f"{production_url}/sales-orders/{order_id}/customer-po-sync", headers=headers)
    except httpx.RequestError:
        return {"ok": False, "detail": "Production could not be reached, so the job cards still show the old PO."}
    if result.status_code != 200:
        return {"ok": False, "status": result.status_code, "detail": _job_card_po_sync_refusal(result)}
    body = result.json() if result.headers.get("content-type", "").startswith("application/json") else {}
    return {"ok": True, "job_cards": body.get("job_cards", 0), "updated": body.get("updated", [])}


def _job_card_po_sync_refusal(result: httpx.Response) -> str:
    """Plain words for a production refusal of the job-card PO copy (never raw JSON)."""
    if result.status_code in (401, 403):
        return (
            "Your role cannot update the job cards, so they still show the old PO. "
            "Ask an Owner, Planner or Plant Manager to press Retry on this order."
        )
    if result.status_code == 404:
        return "The order or its job cards were not found, so the job cards still show the old PO."
    detail = None
    try:
        body = result.json()
        detail = body.get("detail") if isinstance(body, dict) else None
    except Exception:
        detail = None
    if isinstance(detail, str) and detail.strip() and 400 <= result.status_code < 500:
        return f"The job cards still show the old PO: {detail.strip()}"
    return "The job cards could not be updated with the new PO."


@router.post("/orders/{order_id}/hold")
async def hold_order(order_id: str, request: Request, token: str = Depends(get_token)):
    # Customer hold closes the PO: same reason code list as cancel / short close (client 2026-10-26).
    body = await _order_close_body(request, token)
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/hold", request, token, json_body=body)
    payload = response_body_json(response) or {}
    held = sum(float(line.get("hold_qty") or 0) for line in payload.get("lines") or [] if isinstance(line, dict))
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_HELD",
        title=f"Customer hold: {payload.get('po_number') or payload.get('order_no') or order_id}",
        message=f"{held:,.0f} pcs held and the PO closed. Stop further releases and dispatch planning for it. Reason: {payload.get('hold_reason') or '-'}",
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager", "Dispatch"],
        payload={"order_id": order_id, "priority": "action", "action": "review"},
    )
    return response


@router.post("/orders/{order_id}/resume")
async def resume_order(order_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/resume", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_HOLD_LIFTED",
        title=f"Customer hold lifted: {payload.get('po_number') or payload.get('order_no') or order_id}",
        message="The order is open again with its previous status. Releases and dispatch can continue.",
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager", "Dispatch"],
        payload={"order_id": order_id},
    )
    return response


async def _order_close_body(request: Request, token: str) -> dict:
    """The reason code must be an active "Order cancel / short close" code of this plant (Masters ›
    Reason codes); its name is stored with the order so the record reads the same later."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    code = str(body.get("reason_code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=422, detail="Choose a reason code.")
    headers = {"Authorization": f"Bearer {token}"}
    if request.headers.get("X-Plant-ID"):
        headers["X-Plant-ID"] = request.headers["X-Plant-ID"]
    try:
        response = await http_client.get(f"{MASTER_SERVICE_URL}/master/reason-codes/", params={"category": ORDER_CLOSE_CATEGORY}, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Reason codes could not be checked right now. Try again.") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="Reason codes could not be checked right now. Try again.")
    data = response.json()
    rows = data if isinstance(data, list) else []
    match = next((row for row in rows if str(row.get("code") or "").upper() == code and row.get("category") == ORDER_CLOSE_CATEGORY), None)
    if not match:
        raise HTTPException(status_code=422, detail=f"{code} is not an active order close reason. Pick one from the list, or ask the Owner or an Admin to add it on Masters › Order close reasons.")
    return {"reason_code": code, "reason_label": match.get("label") or code, "note": str(body.get("note") or "").strip() or None}


@router.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: str, request: Request, token: str = Depends(get_token)):
    body = await _order_close_body(request, token)
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/cancel", request, token, json_body=body)
    payload = response_body_json(response) or {}
    total = sum(float(line.get("qty") or 0) for line in payload.get("lines") or [] if isinstance(line, dict))
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_CANCELLED",
        title=f"Sales order cancelled: {payload.get('po_number') or payload.get('order_no') or order_id}",
        message=f"{total:,.0f} pcs cancelled — {payload.get('closure_reason') or body['reason_code']}. Nothing was released or dispatched; remove it from any plans.",
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager"],
        payload={"order_id": order_id, "reason_code": body["reason_code"]},
    )
    return response


@router.post("/orders/{order_id}/short-close")
async def short_close_order(order_id: str, request: Request, token: str = Depends(get_token)):
    body = await _order_close_body(request, token)
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/short-close", request, token, json_body=body)
    payload = response_body_json(response) or {}
    dropped = sum(float(line.get("short_closed_qty") or 0) for line in payload.get("lines") or [] if isinstance(line, dict))
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_SHORT_CLOSED",
        title=f"Sales order short-closed: {payload.get('po_number') or payload.get('order_no') or order_id}",
        message=f"{dropped:,.0f} pcs not yet released were dropped — {payload.get('closure_reason') or body['reason_code']}. Released job cards finish and are dispatched; do not release more.",
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager", "Dispatch"],
        payload={"order_id": order_id, "reason_code": body["reason_code"]},
    )
    return response


@router.post("/orders/{order_id}/approve")
async def approve_order(order_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/approve", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_APPROVED",
        title=f"Sales order approved: {payload.get('order_no') or order_id}",
        message="The order is ready for release planning.",
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager"],
        payload={"order_id": order_id},
    )
    return response


@router.post("/orders/{order_id}/release")
async def release_order(order_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/release", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_RELEASED",
        title=f"Sales order released: {payload.get('order_no') or order_id}",
        message="Planning can now schedule execution against this order.",
        href=f"/sales-orders/{order_id}",
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager", "Operator"],
        payload={"order_id": order_id},
    )
    return response


@router.put("/orders/lines/{line_id}/colors")
async def update_line_colors(line_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/lines/{line_id}/colors", request, token)


@router.post("/orders/lines/{line_id}/release")
async def release_order_line(line_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/lines/{line_id}/release", request, token)
    payload = response_body_json(response) or {}
    order_id = str(payload.get("order_id") or "")
    await emit_from_response(
        response,
        token=token,
        event_type="SALES_ORDER_LINE_RELEASED",
        title=f"Sales line released: {line_id}",
        message="A sales-order line was released into production planning.",
        href=f"/sales-orders/{order_id}" if order_id else "/sales-orders",
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager", "Operator"],
        payload={"order_id": order_id, "line_id": line_id},
        plant_id=(request.headers.get("X-Plant-ID") or "").strip() if (request.headers.get("X-Plant-ID") or "").strip().upper() not in {"", "ALL"} else None,
    )
    return response


# ── Order close reasons master (client 2026-10-28) ──────────────────────────────────────────────
# The SO_CLOSE reason codes (Masters › Reason codes) behind cancel, short close and customer hold.
# Everyone may read them; only Owner and Admin add, rename, deactivate or reactivate them.
ORDER_CLOSE_WRITERS = {"Owner", "Admin"}


def _close_reason_headers(request: Request, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if request.headers.get("X-Plant-ID"):
        headers["X-Plant-ID"] = request.headers["X-Plant-ID"]
    return headers


def _require_close_reason_writer(token: str) -> None:
    roles = {str(role) for role in (current_user_claims(token).get("roles") or [])}
    if not roles.intersection(ORDER_CLOSE_WRITERS):
        raise HTTPException(status_code=403, detail="Only the Owner or an Admin can change order close reasons.")


async def _master_call(method: str, path: str, request: Request, token: str, **kwargs):
    try:
        response = await http_client.request(method, f"{MASTER_SERVICE_URL}{path}", headers=_close_reason_headers(request, token), **kwargs)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Masters could not be reached right now. Try again.") from exc
    body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    if response.status_code >= 400:
        detail = body.get("detail") if isinstance(body, dict) else None
        raise HTTPException(status_code=response.status_code, detail=detail or "Masters refused the change.")
    return body


async def _close_reason(reason_id: str, request: Request, token: str) -> dict:
    rows = await _master_call("GET", "/master/reason-codes/", request, token, params={"category": ORDER_CLOSE_CATEGORY, "include_inactive": "true"})
    match = next((row for row in (rows if isinstance(rows, list) else []) if str(row.get("id")) == str(reason_id)), None)
    if not match or match.get("category") != ORDER_CLOSE_CATEGORY:
        raise HTTPException(status_code=404, detail="This order close reason was not found.")
    return match


def _code_from_label(label: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in label.upper()).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return f"SO-{slug}"[:40].rstrip("-")


@router.get("/order-close-reasons")
async def list_order_close_reasons(request: Request, token: str = Depends(get_token)):
    rows = await _master_call("GET", "/master/reason-codes/", request, token, params={"category": ORDER_CLOSE_CATEGORY, "include_inactive": "true"})
    return [row for row in (rows if isinstance(rows, list) else []) if row.get("category") == ORDER_CLOSE_CATEGORY]


@router.post("/order-close-reasons")
async def create_order_close_reason(request: Request, token: str = Depends(get_token)):
    _require_close_reason_writer(token)
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    label = str(body.get("label") or "").strip()
    if len(label) < 2:
        raise HTTPException(status_code=422, detail="Enter the reason's name.")
    code = str(body.get("code") or "").strip().upper() or _code_from_label(label)
    if not all(ch.isalnum() or ch in "-_" for ch in code):
        raise HTTPException(status_code=422, detail="The code may use letters, numbers, - and _ only.")
    payload = {"code": code, "label": label[:200], "category": ORDER_CLOSE_CATEGORY, "severity": "WATCH",
               "description": str(body.get("description") or "").strip() or None}
    # A code is unique in the plant across every reason list (closed orders point to it): a duplicate is
    # a plain 422, never a 409/500 from masters (checker 30 Oct).
    duplicate = HTTPException(status_code=422, detail=f"The code {code} is already used by another reason (it may be deactivated). Choose another code.")
    existing = await _master_call("GET", "/master/reason-codes/", request, token, params={"include_inactive": "true"})
    if any(str(row.get("code") or "").strip().upper() == code for row in (existing if isinstance(existing, list) else [])):
        raise duplicate
    try:
        return await _master_call("POST", "/master/reason-codes/", request, token, json=payload)
    except HTTPException as exc:
        if exc.status_code == 409:
            raise duplicate from exc
        raise


@router.put("/order-close-reasons/{reason_id}")
async def update_order_close_reason(reason_id: str, request: Request, token: str = Depends(get_token)):
    """Rename (label / description) or reactivate. The code never changes: closed orders keep it."""
    _require_close_reason_writer(token)
    await _close_reason(reason_id, request, token)
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    update: dict = {}
    if "label" in body:
        label = str(body.get("label") or "").strip()
        if len(label) < 2:
            raise HTTPException(status_code=422, detail="Enter the reason's name.")
        update["label"] = label[:200]
    if "description" in body:
        update["description"] = str(body.get("description") or "").strip() or None
    if "is_active" in body:
        update["is_active"] = bool(body.get("is_active"))
    if not update:
        raise HTTPException(status_code=422, detail="Nothing to change.")
    return await _master_call("PUT", f"/master/reason-codes/{reason_id}", request, token, json=update)


@router.delete("/order-close-reasons/{reason_id}")
async def deactivate_order_close_reason(reason_id: str, request: Request, token: str = Depends(get_token)):
    """Deactivate: hidden from new cancels / short closes / holds; orders that used it keep it."""
    _require_close_reason_writer(token)
    await _close_reason(reason_id, request, token)
    return await _master_call("DELETE", f"/master/reason-codes/{reason_id}", request, token)
