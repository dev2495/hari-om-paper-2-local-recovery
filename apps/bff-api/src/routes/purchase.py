"""Purchase-to-GRN proxy routes."""

import os

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


@router.post("/orders/{po_id}/grn")
async def post_purchase_grn(po_id: str, request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(
            token,
            plant_id,
            effective_date=body.get("received_date") or body.get("effective_date") or body.get("date"),
        )
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/purchase/orders/{po_id}/grn",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="PURCHASE_GRN_POSTED",
        title=f"GRN posted: {payload.get('grn_no') or po_id}",
        message="Received purchase stock has been posted into batch ledger with vendor and cost.",
        href="/purchase",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager"],
        payload={"purchase_order_id": po_id, "grn_id": str(payload.get("id") or "")},
    )
    return response


@router.post("/orders/{po_id}/lines/{line_id}/reject-remainder")
async def reject_purchase_remainder(po_id: str, line_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/purchase/orders/{po_id}/lines/{line_id}/reject-remainder",
        request,
        token,
    )


@router.post("/qc-tasks/retry")
async def retry_incoming_qc_tasks(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/qc-tasks/retry", request, token)


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
