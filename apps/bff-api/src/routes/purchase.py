"""Purchase-to-GRN proxy routes."""

import os
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request

from src.middleware.auth import get_token
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
        recipient_roles=["Owner", "Admin", "Store", "PlantManager"],
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
            if fresh["blocked"]:
                raise HTTPException(409, "Material demand has unresolved evidence; reconcile flagged lines before MRP")
            if body.get("demand_source_version") != fresh["source_version"]:
                raise HTTPException(409, "Sales, stock allocations or production demand changed. Refresh requirements before MRP")
            grouped = {}
            for row in fresh["requirements"]:
                item = grouped.setdefault(row["item_id"], {"item_id":row["item_id"], "demand_kg":0, "dated_demand":[]})
                item["demand_kg"] += row["qty_kg"]
                item["dated_demand"].append({"date":row["date"], "qty_kg":row["qty_kg"]})
            if not grouped:
                raise HTTPException(422, "There is no residual material demand in this horizon")
            body = {**body, "items":list(grouped.values())}
    return await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/procurement/{procurement_path}",
        request,
        token,
        json_body=body,
    )


@router.get("/material-demand")
async def purchase_material_demand(request: Request, as_of_date: date, horizon_end: date, token: str = Depends(get_token)):
    from src.services.procurement_demand import material_demand
    return await material_demand(token, request.query_params.get("plant_id") or request.headers.get("X-Plant-ID"), as_of_date, horizon_end)


@router.patch("/schedules/{schedule_id}")
async def patch_supplier_schedule(schedule_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/schedules/{schedule_id}", request, token)
