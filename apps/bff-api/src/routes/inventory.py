from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
import os
import httpx

from src.middleware.auth import get_token
from src.services.books_guard import assert_not_backdated, invalidate_books_cache
from src.services.http_client import proxy_to_service
from src.services.workspace import emit_from_response, emit_notification_event, response_body_json

router = APIRouter()
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")


@router.get("/items")
async def get_items(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/items/", request, token)


@router.post("/items")
async def create_item(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/items/", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_ITEM_CREATED",
        title=f"Inventory item created: {payload.get('item_code') or payload.get('id') or 'new item'}",
        message="A new item is available for inventory flows.",
        href="/inventory/items",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"item_id": str(payload.get('id') or '')},
    )
    return response


@router.put("/items/{item_id}")
async def update_item(item_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_POLICY_UPDATED",
        title=f"Inventory policy updated: {payload.get('item_code') or item_id}",
        message="Cost, reorder, safety stock, or lead-time controls changed.",
        href="/inventory/items",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"item_id": item_id},
    )
    return response


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, request: Request, token: str = Depends(get_token)):
    """Soft-delete an item. Historical transactions remain intact."""
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_ITEM_DEACTIVATED",
        title=f"Item deactivated: {payload.get('item_code') or item_id}",
        message="Soft-delete; existing transactions are preserved for audit.",
        href="/inventory/items",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"item_id": item_id},
    )
    return response


@router.post("/inward")
async def create_inward(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/inward/", request, token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_INWARD_CREATED",
        title="Raw material inward recorded",
        message="Stores recorded new inbound stock.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "Planner", "PlantManager", "Operator"],
    )
    return response


@router.get("/inward/stock-as-on")
async def get_inward_stock_as_on(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inward/stock-as-on", request, token)


@router.post("/issue")
async def create_issue(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/issue/", request, token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_ISSUE_CREATED",
        title="Inventory issue recorded",
        message="Material was issued from stores into production.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator", "Planner"],
    )
    return response


@router.post("/fg-inward")
async def create_fg_inward(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/fg-inward/", request, token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="FG_INWARD_CREATED",
        title="Finished goods inward recorded",
        message="Finished goods stock is now available for dispatch planning.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "Dispatch", "Sales"],
    )
    return response


@router.post("/dispatch")
async def create_dispatch(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date") or body.get("dispatch_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/dispatch/",
        request,
        token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_DISPATCH_MOVED",
        title="Inventory dispatch recorded",
        message="Stock moved out against a dispatch flow.",
        href="/dispatch",
        recipient_roles=["Owner", "Admin", "Store", "Dispatch", "Sales"],
    )
    return response


@router.get("/balance")
async def get_all_balances(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/all-balances", request, token)


@router.get("/balance/{item_id}")
async def get_item_balance(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/balance/{item_id}", request, token)


@router.get("/ledger")
async def get_ledger(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/ledger", request, token)


@router.get("/stock-control/statement")
async def get_stock_statement(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/statement", request, token)


@router.get("/stock-control/opening-loads")
async def list_opening_loads(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/opening-loads", request, token)


@router.post("/stock-control/opening-loads")
async def create_opening_load(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    await assert_not_backdated(
        token,
        plant_id,
        effective_date=body.get("effective_date") if isinstance(body, dict) else None,
    )
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/stock-control/opening-loads",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_OPENING_LOAD_POSTED",
        title=f"Opening stock posted: {payload.get('document_no') or payload.get('id') or 'document'}",
        message="Stores posted auditable opening stock into the inventory ledger.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"opening_load_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/stock-control/certifications")
async def list_certifications(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/certifications", request, token)


@router.post("/stock-control/certifications")
async def create_certification(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/certifications", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_CERTIFICATION_DRAFTED",
        title=f"Stock certification drafted: {payload.get('period_end') or payload.get('id') or 'period'}",
        message="Physical count can now be checked against book closing stock.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/stock-control/certifications/{certification_id}")
async def get_certification(certification_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}", request, token)


@router.patch("/stock-control/certifications/{certification_id}")
async def update_certification(certification_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}", request, token)


@router.post("/stock-control/certifications/{certification_id}/certify")
async def certify_stock(certification_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}/certify", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_CERTIFIED",
        title=f"Closing stock certified: {payload.get('period_end') or certification_id}",
        message="The period has an auditable book-vs-physical stock certificate.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": certification_id},
    )
    return response


@router.get("/stock-control/adjustment-vouchers")
async def list_adjustment_vouchers(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/adjustment-vouchers", request, token)


@router.post("/stock-control/adjustment-vouchers")
async def create_adjustment_voucher(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/stock-control/adjustment-vouchers",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_ADJUSTMENT",
        title=f"Stock adjustment {payload.get('status') or 'saved'}: {payload.get('voucher_no') or payload.get('id') or 'voucher'}",
        message="Stock difference was recorded in an auditable adjustment voucher.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"adjustment_id": str(payload.get("id") or "")},
    )
    return response


@router.post("/stock-control/adjustment-vouchers/{voucher_id}/post")
async def post_adjustment_voucher(voucher_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/stock-control/adjustment-vouchers/{voucher_id}/post",
        request,
        token,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_ADJUSTMENT_POSTED",
        title=f"Stock adjustment posted: {payload.get('voucher_no') or voucher_id}",
        message="Stock adjustment posted into inventory stock truth.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"adjustment_id": voucher_id},
    )
    return response


@router.post("/stock-control/certifications/{certification_id}/post-variance")
async def post_certification_variance(certification_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/stock-control/certifications/{certification_id}/post-variance",
        request,
        token,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_COUNT_VARIANCE_POSTED",
        title=f"Stock count variance posted: {payload.get('voucher_no') or certification_id}",
        message="Physical count difference was posted to inventory through an adjustment voucher.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": certification_id, "adjustment_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/stock-control/carry-forwards")
async def list_carry_forwards(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/carry-forwards", request, token)


@router.post("/stock-control/certifications/{certification_id}/carry-forward")
async def create_carry_forward(certification_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}/carry-forward", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_CARRY_FORWARD_GENERATED",
        title=f"Year carry-forward generated: {payload.get('document_no') or certification_id}",
        message="Certified closing stock has been frozen as the next period's opening proof.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": certification_id, "carry_forward_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/locations")
async def get_locations(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations", request, token)


@router.post("/locations")
async def create_location(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_LOCATION_CREATED",
        title=f"Inventory location created: {payload.get('code') or payload.get('id') or 'new location'}",
        message="Stores can now use this location for reel and batch placement.",
        href="/system/locations",
        recipient_roles=["Owner", "Admin", "Store"],
        payload={"location_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/lots/availability")
async def lot_availability(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/lots/availability", request, token)


@router.post("/reels/inward")
async def create_reel_inward(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("inward_date") or body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/reels/inward",
        request,
        token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_INWARD_CREATED",
        title="Reel inward recorded",
        message="New reels are available in inventory.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator"],
    )
    return response


@router.get("/reels")
async def list_reels(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reels", request, token)


@router.get("/reels/{reel_id}")
async def get_reel(reel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/reels/{reel_id}", request, token)


@router.post("/reels/{reel_id}/scan")
async def create_reel_scan_event(reel_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/reels/{reel_id}/scan", request, token)
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_SCANNED",
        title="Reel scan captured",
        message=f"Reel {reel_id} changed tracked state or location.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator"],
        payload={"reel_id": reel_id},
    )
    return response


@router.get("/reels/{reel_id}/scans")
async def list_reel_scan_events(reel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/reels/{reel_id}/scans", request, token)


@router.get("/labels/batches/{batch_id}")
async def get_batch_label(batch_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/labels/batches/{batch_id}", request, token)


@router.get("/labels/reels/{reel_id}")
async def get_reel_label(reel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/labels/reels/{reel_id}", request, token)


@router.post("/reel-issues")
async def create_reel_issue(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/reel-issues", request, token)
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_ISSUE_CREATED",
        title="Reel issue recorded",
        message="A reel variance or issue now needs follow-up.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator"],
    )
    return response


@router.get("/reel-issues")
async def list_reel_issues(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reel-issues", request, token)


@router.post("/reel-issues/{issue_id}/close")
async def close_reel_issue(issue_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/reel-issues/{issue_id}/close", request, token)
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_ISSUE_CLOSED",
        title="Reel issue closed",
        message=f"Reel issue {issue_id} was resolved.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator"],
        payload={"issue_id": issue_id},
    )
    return response


@router.get("/quality/templates")
async def list_quality_templates(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/templates", request, token)


@router.post("/quality/templates")
async def upsert_quality_template(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/templates", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_QC_TEMPLATE_UPDATED",
        title=f"QC parameter updated: {payload.get('label') or payload.get('parameter_key') or 'parameter'}",
        message="An inward QC parameter list was changed.",
        href="/quality",
        recipient_roles=["Owner", "Admin", "PlantManager", "QC", "Store"],
        payload={"template_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/quality/pending")
async def list_pending_quality(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/pending", request, token)


@router.get("/quality/inspections")
async def list_inventory_quality_inspections(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/inspections", request, token)


@router.post("/quality/inspections")
async def create_inventory_quality_inspection(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/inspections", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_QC_RECORDED",
        title=f"Inventory QC {payload.get('status') or 'recorded'}",
        message="A held inward item was inspected and its stock status was updated.",
        href="/quality",
        recipient_roles=["Owner", "Admin", "PlantManager", "QC", "Store"],
        payload={"inspection_id": str(payload.get("id") or ""), "entity_id": str(payload.get("entity_id") or "")},
    )
    return response


@router.get("/quality/customer-rejections")
async def list_customer_rejections(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/customer-rejections", request, token)


@router.post("/quality/customer-rejections")
async def create_customer_rejection(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/quality/customer-rejections",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="CUSTOMER_REJECTION_INWARDED",
        title=f"Customer rejection inward: {payload.get('customer_name') or 'customer'}",
        message="Rejected finished goods were brought back under QC hold.",
        href="/quality",
        recipient_roles=["Owner", "Admin", "PlantManager", "QC", "Store", "Dispatch", "Sales"],
        payload={"customer_rejection_id": str(payload.get("id") or ""), "batch_id": str(payload.get("batch_id") or "")},
    )
    return response


@router.post("/quality/customer-rejections/{rejection_id}/disposition")
async def dispose_customer_rejection(rejection_id: str, request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/quality/customer-rejections/{rejection_id}/disposition",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="CUSTOMER_REJECTION_DISPOSED",
        title=f"Customer rejection disposition: {payload.get('disposition') or payload.get('status') or 'updated'}",
        message="Rejected finished goods were assigned to rework, release, block, or scrap.",
        href="/quality",
        recipient_roles=["Owner", "Admin", "PlantManager", "QC", "Store", "Dispatch", "Sales"],
        payload={"customer_rejection_id": rejection_id, "status": str(payload.get("status") or "")},
    )
    return response


@router.get("/valuation/summary")
async def get_valuation_summary(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/valuation/summary", request, token)


@router.get("/valuation/reels")
async def get_valuation_reels(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/valuation/reels", request, token)


@router.get("/health/summary")
async def get_health_summary(request: Request, token: str = Depends(get_token)):
    try:
        return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/summary", request, token)
    except httpx.TimeoutException:
        return JSONResponse(
            status_code=503,
            content={
                "degraded": True,
                "detail": "Inventory health rollup timed out. Live balances were not confirmed.",
                "dispatch_allocated_qty": 0.0,
                "active_dispatch_allocations": 0,
                "blocked_qty": 0.0,
                "qc_hold_qty": 0.0,
                "occupied_locations": 0,
                "total_locations": 0,
                "aging_hotspots": 0,
                "status_rows": [],
                "summary": {
                    "low_stock_items": 0,
                    "degraded": True,
                },
            },
        )


@router.get("/health/status-summary")
async def get_health_status_summary(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/status-summary", request, token)


@router.post("/mrp/notify-shortage")
async def notify_mrp_shortage(request: Request, token: str = Depends(get_token)):
    payload = await request.json()
    raw_lines = payload.get("lines") if isinstance(payload, dict) else []
    lines = raw_lines if isinstance(raw_lines, list) else []
    shortage_count = len(lines)
    total_value = sum(float(row.get("estimated_value") or row.get("po_value") or 0) for row in lines if isinstance(row, dict))
    try:
        await emit_notification_event(
            token=token,
            event_type="MRP_SHORTAGE_DRAFTED",
            title=f"MRP shortage draft generated ({shortage_count} lines)",
            message=f"Store must review shortage material and PO draft value {total_value:,.0f}.",
            href="/analytics/mrp",
            recipient_roles=["Owner", "Admin", "Store", "Planner"],
            payload={"shortage_count": shortage_count, "estimated_value": total_value, "lines": lines[:20] if isinstance(lines, list) else []},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=202, content={"notified": False, "detail": "Notification service unavailable"})
    return {"notified": True, "shortage_count": shortage_count, "estimated_value": total_value}


@router.get("/health/location-occupancy")
async def get_health_location_occupancy(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/location-occupancy", request, token)


@router.get("/health/aging")
async def get_health_aging(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/aging", request, token)


@router.get("/health/genealogy-exceptions")
async def get_health_genealogy_exceptions(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/genealogy-exceptions", request, token)


# ──────────────────────────────────────────────────────────────────────────
# Lifecycle gaps — new BFF endpoints
# ──────────────────────────────────────────────────────────────────────────


@router.get("/transactions/aggregate-by-item")
async def get_transactions_aggregate(request: Request, token: str = Depends(get_token)):
    """Gap 1: aggregate ISSUE_PRODUCTION etc. per item across a date range."""
    return await proxy_to_service(
        INVENTORY_SERVICE_URL, "/transactions/aggregate-by-item", request, token
    )


@router.post("/fg-inward/manual")
async def manual_fg_inward(request: Request, token: str = Depends(get_token)):
    """Gap 7: manual FG inward for rework / returns / adjustments."""
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/fg-inward/manual", request, token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_MANUAL_FG_INWARD",
        title=f"Manual FG inward: {payload.get('batch_no') or payload.get('item_id') or 'item'}",
        message=str(payload.get("message") or "Manual FG inward recorded outside job-close flow."),
        href="/inventory/fg-inward",
        recipient_roles=["Owner", "Admin", "Store", "Dispatch", "Sales"],
        payload={"batch_id": str(payload.get("batch_id") or ""), "transaction_id": str(payload.get("transaction_id") or "")},
    )
    return response


@router.post("/stock-control/carry-forwards/{cf_id}/post-opening")
async def post_opening_from_cf(cf_id: str, request: Request, token: str = Depends(get_token)):
    """Gap 5: auto-create an opening load from a carry-forward document."""
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/stock-control/carry-forwards/{cf_id}/post-opening",
        request,
        token,
    )
    payload = response_body_json(response) or {}
    if not payload.get("already_existed"):
        await emit_from_response(
            response,
            token=token,
            event_type="INVENTORY_CF_OPENING_POSTED",
            title=f"Opening load posted from CF: {payload.get('document_no') or cf_id}",
            message=str(payload.get("message") or "Carry-forward proof was converted into a posted opening load."),
            href="/inventory/stock-control",
            recipient_roles=["Owner", "Admin", "Store", "Planner"],
            payload={"opening_load_id": str(payload.get("opening_load_id") or ""), "carry_forward_id": cf_id},
        )
    return response


@router.post("/stock-moves/wip-issue")
async def issue_batch_to_wip(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/stock-moves/wip-issue",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_WIP_ISSUE_POSTED",
        title=f"Material issued to WIP: {payload.get('stage') or 'stage'}",
        message=str(payload.get("message") or "Store stock moved into production WIP against a job card."),
        href="/inventory/production-issue",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Production"],
        payload={
            "job_card_id": str(payload.get("job_card_id") or ""),
            "batch_id": str(payload.get("batch_id") or ""),
            "wip_transaction_id": str(payload.get("wip_transaction_id") or ""),
        },
    )
    return response
