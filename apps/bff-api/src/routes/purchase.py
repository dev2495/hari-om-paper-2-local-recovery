"""Purchase-to-GRN proxy routes."""

import os
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request

from src.middleware.auth import get_token
from src.services import quality_events
from src.services.books_guard import assert_not_backdated
from src.services.http_client import proxy_to_service
from src.services.workspace import emit_from_response, response_body_json

router = APIRouter()
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")


@router.get("/orders")
async def list_purchase_orders(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/orders", request, token)


@router.get("/orders/{po_id}")
async def get_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}", request, token)


@router.get("/orders/{po_id}/pdf")
async def purchase_order_pdf(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/pdf", request, token)


@router.post("/orders")
async def create_purchase_order(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/orders", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="PURCHASE_ORDER_CREATED",
        title=f"Purchase order created: {payload.get('po_no') or payload.get('id') or 'PO'}",
        message="A vendor-linked purchase order is ready for approval and GRN.",
        href="/purchase",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager"],
        payload={"purchase_order_id": str(payload.get("id") or "")},
    )
    return response


@router.post("/orders/{po_id}/approve")
async def approve_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/approve", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="PURCHASE_ORDER_APPROVED",
        title=f"Purchase order approved: {payload.get('po_no') or po_id}",
        message="Stores can now receive GRN against this PO.",
        href="/purchase",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "GRN"],
        payload={"purchase_order_id": po_id},
    )
    return response


@router.post("/orders/{po_id}/submit")
async def submit_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/submit", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(response, token=token, event_type="PURCHASE_ORDER_SUBMITTED",
        title=f"Purchase order awaiting approval: {payload.get('po_no') or po_id}",
        message="The current immutable PO revision is ready for maker-checker review.", href="/purchase/approvals",
        recipient_roles=["Owner", "Admin", "PlantManager"], payload={"purchase_order_id": po_id})
    return response


@router.post("/orders/{po_id}/revisions")
async def revise_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/revisions", request, token)


@router.post("/orders/{po_id}/reject")
async def reject_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/reject", request, token)


@router.get("/orders/{po_id}/history")
async def purchase_order_history(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/history", request, token)


@router.post("/orders/{po_id}/short-close")
async def short_close_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/short-close", request, token)


@router.post("/orders/{po_id}/cancel")
async def cancel_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/cancel", request, token)


@router.post("/orders/{po_id}/lines/{line_id}/reject-remainder")
async def reject_purchase_remainder(po_id: str, line_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/purchase/orders/{po_id}/lines/{line_id}/reject-remainder",
        request,
        token,
    )


@router.get("/receipts")
async def list_purchase_receipts(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/receipts", request, token)


@router.get("/schedules")
async def list_supplier_schedules(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/schedules", request, token)


@router.post("/orders/{po_id}/schedules")
async def commit_supplier_schedules(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/schedules", request, token)


@router.get("/orders/{po_id}/print")
async def print_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/print", request, token)


@router.post("/workbook/preview")
async def preview_purchase_workbook(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/workbook/preview", request, token)


@router.post("/workbook/commit")
async def commit_purchase_workbook(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/workbook/commit", request, token)


@router.post("/receipts/{receipt_id}/evidence")
async def attach_receipt_evidence(receipt_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/purchase/receipts/{receipt_id}/evidence",
        request,
        token,
    )


@router.post("/receipt-lines/{line_id}/allocate-schedule")
async def allocate_receipt_schedule(line_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/purchase/receipt-lines/{line_id}/allocate-schedule",
        request,
        token,
    )


@router.post("/receipt-lines/{line_id}/qc")
async def post_purchase_receipt_qc(line_id: str, request: Request, token: str = Depends(get_token)):
    raise HTTPException(
        status_code=403,
        detail=(
            "Incoming QC PASS/UNRESTRICTED verdicts belong to QC/inventory, not the purchase desk. "
            "This purchase path does not set receipt QC status."
        ),
    )


@router.api_route("/v2/{procurement_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def procurement_v2_proxy(procurement_path: str, request: Request, token: str = Depends(get_token)):
    """Preserve period locks and authoritative demand across the restored routes."""
    body = None
    plant_id = request.query_params.get("plant_id") or request.headers.get("X-Plant-ID", "")
    if request.method == "POST" and procurement_path in {"receipts", "manual-receipts", "mrp-runs"}:
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("object required")
        except (ValueError, TypeError):
            raise HTTPException(422, "A JSON object is required")
        if procurement_path in {"receipts", "manual-receipts"}:
            await assert_not_backdated(token, plant_id, effective_date=body.get("received_date"))
        else:
            from src.services.procurement_demand import material_demand
            try:
                start = date.fromisoformat(body["as_of_date"])
                end = date.fromisoformat(body["horizon_end"])
            except (KeyError, TypeError, ValueError):
                raise HTTPException(422, "Valid MRP dates are required")
            fresh = await material_demand(token, plant_id, start, end)
            # Demand problems are warnings, never a 409 (client 2026-10-28: flags, not blocks).
            if body.get("demand_source_version") != fresh["source_version"]:
                raise HTTPException(409, "Sales, stock allocations or production demand changed. Refresh requirements before MRP")
            grouped = {}
            for row in fresh["requirements"]:
                if not row.get("mapped", True):
                    continue  # no stock item yet: shown as a warning, cannot be netted against stock
                item = grouped.setdefault(row["item_id"], {"item_id":row["item_id"], "demand_kg":0, "dated_demand":[]})
                item["demand_kg"] += row["qty_kg"]
                item["dated_demand"].append({"date":row["date"], "qty_kg":row["qty_kg"]})
            if not grouped:
                if any(not row.get("mapped", True) for row in fresh["requirements"]):
                    raise HTTPException(422, "Every required paper still needs a stock item. Create the stock items, then run the check")
                raise HTTPException(422, "There is no residual material demand in this horizon")
            body = {**body, "items":list(grouped.values())}
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/procurement/{procurement_path}",
        request,
        token,
        json_body=body,
    )
    if request.method == "POST":
        await _notify_plan_handoff(procurement_path, request, response, token, plant_id)
        await quality_events.notify_receipt(procurement_path, response, request, token)
    return response


_PLAN_ACTION_NOTICES = {
    "SUBMIT": ("PURCHASE_PLAN_SUBMITTED", "RM purchase plan submitted for approval", "Review the monthly paper arrival plan and approve it so purchase orders can be raised.", ["Owner", "Admin", "PlantManager"], "approve"),
    "APPROVE": ("PURCHASE_PLAN_APPROVED", "RM purchase plan approved", "Generate vendor PO drafts from the approved arrivals and send them to suppliers.", ["Store", "Planner", "Owner", "Admin"], "review"),
    "REJECT": ("PURCHASE_PLAN_REJECTED", "RM purchase plan sent back", "The approver asked for a revision. Update the arrivals and resubmit.", ["Planner", "Store"], "review"),
    "LOCK": ("PURCHASE_PLAN_LOCKED", "RM purchase plan locked", "The month's arrival plan is locked as the procurement baseline.", ["Store", "Planner", "PlantManager"], None),
}


async def _notify_plan_handoff(path: str, request: Request, response, token: str, plant_id: str) -> None:
    """Tell the next role when a monthly RM plan changes hands. Best effort, 2xx only."""
    if response.status_code >= 300:
        return
    parts = path.strip("/").split("/")
    if len(parts) != 3 or parts[0] != "plans" or parts[2] not in {"action", "convert"}:
        return
    payload = response_body_json(response) or {}
    plan_id = parts[1]
    plant = plant_id if plant_id and plant_id.upper() != "ALL" else None
    href = "/purchase/scheduler"
    if parts[2] == "convert":
        count = len(payload.get("purchase_order_ids") or []) if isinstance(payload, dict) else 0
        await emit_from_response(
            response,
            token=token,
            event_type="PURCHASE_PLAN_CONVERTED",
            title=f"{count} PO draft{'s' if count != 1 else ''} created from the RM plan",
            message="Vendor-grouped purchase orders are ready. Review rates and submit them for approval.",
            href="/purchase?tab=scheduled",
            recipient_roles=["Store", "Owner", "Admin", "PlantManager"],
            role_context="Store",
            payload={"plan_id": plan_id, "purchase_order_ids": payload.get("purchase_order_ids") if isinstance(payload, dict) else [], "action": "review", "priority": "action"},
            plant_id=plant,
        )
        return
    try:
        body = await request.json()
    except Exception:
        body = {}
    action = str((body or {}).get("action") or "").upper()
    notice = _PLAN_ACTION_NOTICES.get(action)
    if not notice:
        return
    event_type, title, message, roles, cta = notice
    month = str(payload.get("month") or "")[:7] if isinstance(payload, dict) else ""
    await emit_from_response(
        response,
        token=token,
        event_type=event_type,
        title=f"{title}{f' · {month}' if month else ''}",
        message=message,
        href=href,
        recipient_roles=roles,
        role_context=roles[0],
        payload={"plan_id": plan_id, **({"action": cta, "priority": "action"} if cta else {})},
        plant_id=plant,
    )


# ---------------------------------------------------------------- RM inward calendar (spec 3)


def _plant(request: Request) -> str:
    return request.query_params.get("plant_id") or request.headers.get("X-Plant-ID") or ""


def _concrete(plant: str) -> str | None:
    return plant if plant and plant.upper() != "ALL" else None


@router.get("/schedule/calendar")
async def rm_inward_calendar(request: Request, weeks: int = 8, token: str = Depends(get_token)):
    """Rolling day-by-day need vs stock and arrivals per material, starting today (IST)."""
    from src.services.rm_calendar import calendar_for
    return await calendar_for(token, _plant(request), weeks=weeks)


@router.post("/schedule/suggest")
async def rm_suggest_arrivals(request: Request, token: str = Depends(get_token)):
    """Proposals from shortages (not saved): arrive the day before the shortage, MOQ / multiple, last vendor."""
    from src.services.rm_calendar import calendar_for, suggest
    try:
        body = await request.json()
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    weeks = int(body.get("weeks") or 8)
    calendar = await calendar_for(token, _plant(request), weeks=weeks)
    return {"weeks": weeks, "items": suggest(calendar, material_class=body.get("material_class"), item_ids=body.get("item_ids"))}


@router.get("/schedule/supply")
async def rm_schedule_supply(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/procurement/schedule/supply", request, token)


@router.get("/schedule/expected-arrivals")
async def rm_expected_arrivals(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/procurement/schedule/expected-arrivals", request, token)


async def _json_object(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(422, "A JSON object is required")
    if not isinstance(body, dict):
        raise HTTPException(422, "A JSON object is required")
    return body


@router.post("/schedule/entries")
async def rm_propose_arrivals(request: Request, token: str = Depends(get_token)):
    """Proposals; every vendor must be an active vendor of this plant, and its name comes from the master."""
    from src.services.rm_calendar import apply_master_vendor, master_vendors
    body = await _json_object(request)
    entries = body.get("entries")
    if isinstance(entries, list) and any(isinstance(row, dict) and row.get("supplier_id") for row in entries):
        vendors = await master_vendors(token, _plant(request))
        body = {**body, "entries": [apply_master_vendor(row, vendors, label=f"Arrival {index}: " if len(entries) > 1 else "")
                                    if isinstance(row, dict) else row for index, row in enumerate(entries, start=1)]}
    elif isinstance(entries, list):
        body = {**body, "entries": [apply_master_vendor(row, {}) if isinstance(row, dict) else row for row in entries]}
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/procurement/schedule/entries", request, token, json_body=body)
    payload = response_body_json(response) or {}
    items = payload.get("items") if isinstance(payload, dict) else None
    if items:
        names = ", ".join(dict.fromkeys(str(row.get("item_name") or row.get("item_code") or "material") for row in items))
        await emit_from_response(response, token=token, event_type="RM_ARRIVALS_PROPOSED",
            title=f"{len(items)} RM arrival{'s' if len(items) != 1 else ''} waiting for your approval",
            message=f"{names}. Review them on the RM inward calendar and approve one, a week, or all.",
            href="/purchase/scheduler?review=1", recipient_roles=["Owner"], role_context="Owner",
            payload={"entry_ids": [row.get("id") for row in items], "action": "approve", "priority": "action"}, plant_id=_concrete(_plant(request)))
    return response


@router.patch("/schedule/entries/{entry_id}")
async def rm_update_arrival(entry_id: str, request: Request, token: str = Depends(get_token)):
    from src.services.rm_calendar import apply_master_vendor, master_vendors
    body = await _json_object(request)
    if "supplier_id" in body or "supplier_name" in body:
        body = apply_master_vendor(body, await master_vendors(token, _plant(request)) if body.get("supplier_id") else {})
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/procurement/schedule/entries/{entry_id}", request, token, json_body=body)


@router.post("/schedule/entries/{entry_id}/cancel")
async def rm_cancel_arrival(entry_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/procurement/schedule/entries/{entry_id}/cancel", request, token)


@router.post("/schedule/approve")
async def rm_approve_arrivals(request: Request, token: str = Depends(get_token)):
    """Owner approval. The BFF adds the vendor master of this plant (name, address, GSTIN, terms): inventory
    approves an arrival only for an active vendor in it, and prints the master name on the draft PO."""
    import uuid as _uuid
    from src.services.rm_calendar import vendor_details
    body = await _json_object(request)
    if not body.get("entry_ids"):
        raise HTTPException(422, "Pick at least one arrival to approve")
    plant = _plant(request)
    body = {"request_id": body.get("request_id") or str(_uuid.uuid4()), "entry_ids": body["entry_ids"],
            "vendor_details": await vendor_details(token, plant), "vendor_master_checked": True}
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/procurement/schedule/approve", request, token, json_body=body)
    payload = response_body_json(response) or {}
    orders = payload.get("purchase_orders") or [] if isinstance(payload, dict) else []
    if orders:
        vendors = ", ".join(dict.fromkeys(str(row.get("supplier_name") or "vendor") for row in orders))
        await emit_from_response(response, token=token, event_type="RM_SCHEDULE_APPROVED",
            title=f"{len(orders)} scheduled PO draft{'s' if len(orders) != 1 else ''} ready to send",
            message=f"The Owner approved RM arrivals for {vendors}. Check the rate and send each PO to the vendor.",
            href="/purchase?tab=scheduled", recipient_roles=["Store", "Planner", "PlantManager"], role_context="Store",
            payload={"purchase_order_ids": [row.get("id") for row in orders], "action": "review", "priority": "action"}, plant_id=_concrete(plant))
    return response


@router.post("/orders/{po_id}/send")
async def send_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/send", request, token)
    payload = response_body_json(response) or {}
    channel = {"WHATSAPP": "WhatsApp", "EMAIL": "email", "PDF": "PDF", "PRINT": "print"}.get(str(payload.get("sent_channel") or ""), "")
    await emit_from_response(response, token=token, event_type="PURCHASE_ORDER_SENT",
        title=f"PO sent to vendor: {payload.get('po_no') or po_id}",
        message=f"{payload.get('supplier_name') or 'The vendor'} got the PO{f' on {channel}' if channel else ''}. Expect the goods on the delivery dates.",
        href="/purchase/supplier-deliveries", recipient_roles=["Store", "GRN", "PlantManager"],
        payload={"purchase_order_id": po_id, "approval_source": payload.get("approval_source")}, plant_id=_concrete(_plant(request)))
    return response


@router.post("/orders/{po_id}/vendor-confirm")
async def vendor_confirm_purchase_order(po_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/vendor-confirm", request, token)


@router.get("/material-demand")
async def purchase_material_demand(request: Request, as_of_date: date, horizon_end: date, token: str = Depends(get_token)):
    from src.services.procurement_demand import material_demand
    return await material_demand(token, request.query_params.get("plant_id") or request.headers.get("X-Plant-ID"), as_of_date, horizon_end)


@router.post("/material-demand/create-paper-items")
async def purchase_create_paper_items(request: Request, token: str = Depends(get_token)):
    from src.services.procurement_demand import create_paper_stock_items
    body = await request.json()
    plant = request.query_params.get("plant_id") or request.headers.get("X-Plant-ID")
    return await create_paper_stock_items(token, plant, (body or {}).get("paper_ids") or [])


@router.post("/material-demand/create-material-items")
async def purchase_create_material_items(request: Request, token: str = Depends(get_token)):
    from src.services.procurement_demand import create_material_stock_items
    body = await request.json()
    plant = request.query_params.get("plant_id") or request.headers.get("X-Plant-ID")
    return await create_material_stock_items(token, plant, (body or {}).get("materials") or [])


@router.patch("/schedules/{schedule_id}")
async def patch_supplier_schedule(schedule_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/schedules/{schedule_id}", request, token)


@router.api_route("/requisitions", methods=["GET", "POST"])
async def requisitions(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/requisitions", request, token)
    if request.method == "POST":
        payload = response_body_json(response) or {}
        # The Owner decides requisitions: tell them a request is waiting (step 1 of purchasing).
        await emit_from_response(
            response,
            token=token,
            event_type="PURCHASE_REQUISITION_SUBMITTED",
            title=f"Requisition to approve: {payload.get('pr_no') or 'PR'}",
            message=f"{payload.get('item_name') or 'Material'} · {payload.get('quantity')} {payload.get('uom') or ''} requested by {payload.get('requested_by') or 'an employee'}. Approve or reject it in PO approvals.",
            href="/purchase/approvals",
            recipient_roles=["Owner"],
            role_context="Owner",
            payload={"requisition_id": str(payload.get("id") or ""), "priority": "action"},
        )
    return response

@router.post("/requisitions/{requisition_id}/decision")
async def requisition_decision(requisition_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/requisitions/{requisition_id}/decision", request, token)
    payload = response_body_json(response) or {}
    decision = str(payload.get("status") or "").upper()
    await emit_from_response(
        response,
        token=token,
        event_type="PURCHASE_REQUISITION_DECIDED",
        title=f"Requisition {payload.get('pr_no') or ''} {decision.lower() or 'decided'}",
        message=(f"{payload.get('item_name') or 'Material'}: {decision.title()}. " + ("Purchasing can now create the linked PO." if decision == "APPROVED" else str(payload.get("decision_reason") or ""))).strip(),
        href="/purchase/requisitions",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Planner"],
        payload={"requisition_id": requisition_id, "decision": decision},
    )
    return response
