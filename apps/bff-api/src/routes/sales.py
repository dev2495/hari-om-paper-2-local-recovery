from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
SALES_SERVICE_URL = os.getenv("SALES_SERVICE_URL", "http://localhost:28008")


@router.get("/orders")
async def list_orders(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders", request, token)


@router.post("/orders")
async def create_order(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, "/sales-orders", request, token)


@router.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}", request, token)


@router.put("/orders/{order_id}")
async def update_order(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}", request, token)


@router.post("/orders/{order_id}/approve")
async def approve_order(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/approve", request, token)


@router.post("/orders/{order_id}/release")
async def release_order(order_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SALES_SERVICE_URL, f"/sales-orders/{order_id}/release", request, token)
