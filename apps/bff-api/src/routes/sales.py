from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service
from src.services.workspace import emit_from_response, response_body_json

router = APIRouter()
SALES_SERVICE_URL = os.getenv("SALES_SERVICE_URL", "http://127.0.0.1:18008")


@router.get("/orders")
async def list_orders(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders", request, token)


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


@router.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}", request, token)


@router.get("/orders/{order_id}/timeline")
async def get_order_timeline(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/timeline", request, token)


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
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager", "Production"],
        payload={"order_id": order_id},
    )
    return response


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
        recipient_roles=["Owner", "Admin", "Sales", "Planner", "PlantManager", "Production"],
        payload={"order_id": order_id, "line_id": line_id},
    )
    return response
