"""Purchase-to-GRN proxy routes."""

import os

from fastapi import APIRouter, Depends, Request

from src.middleware.auth import get_token
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
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/orders/{po_id}/grn", request, token)
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


@router.get("/receipts")
async def list_purchase_receipts(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/purchase/receipts", request, token)


@router.post("/receipt-lines/{line_id}/qc")
async def post_purchase_receipt_qc(line_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/purchase/receipt-lines/{line_id}/qc", request, token)
