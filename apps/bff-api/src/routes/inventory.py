from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")


@router.get("/items")
async def get_items(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/items/", request, token)


@router.post("/items")
async def create_item(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/items/", request, token)


@router.post("/inward")
async def create_inward(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inward/", request, token)


@router.post("/issue")
async def create_issue(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/issue/", request, token)


@router.post("/fg-inward")
async def create_fg_inward(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/fg-inward/", request, token)


@router.post("/dispatch")
async def create_dispatch(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/dispatch/", request, token)


@router.get("/balance")
async def get_all_balances(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/all-balances", request, token)


@router.get("/balance/{item_id}")
async def get_item_balance(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/balance/{item_id}", request, token)


@router.get("/ledger")
async def get_ledger(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/ledger", request, token)


@router.post("/reservations")
async def create_reservation(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reservations", request, token)


@router.get("/reservations")
async def list_reservations(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reservations", request, token)


@router.post("/reservations/{reservation_id}/release")
async def release_reservation(reservation_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/reservations/{reservation_id}/release", request, token)


@router.get("/lots/availability")
async def lot_availability(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/lots/availability", request, token)
