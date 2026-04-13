from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
ANALYTICS_SERVICE_URL = os.getenv("ANALYTICS_SERVICE_URL", "http://127.0.0.1:18007")


@router.get("/dashboard/overview")
async def get_dashboard_overview(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/dashboard/overview", request, token)

@router.get("/production/trends")
async def get_production_trends(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/trends", request, token)

@router.get("/production/shrink")
async def get_shrink_analysis(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/shrink", request, token)

@router.get("/production/scrap")
async def get_scrap_analysis(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/scrap", request, token)

@router.get("/production/winder")
async def get_production_winder(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/winder", request, token)

@router.get("/production/oven")
async def get_production_oven(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/oven", request, token)

@router.get("/production/process")
async def get_production_process(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/process", request, token)

@router.get("/inventory/valuation")
async def get_inventory_valuation(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/inventory/valuation", request, token)

@router.get("/dispatch/sales-trends")
async def get_sales_trends(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/dispatch/sales-trends", request, token)

@router.get("/loss/supplier-loss")
async def get_supplier_loss(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/loss/supplier-loss", request, token)

@router.get("/loss/gsm-bf-loss")
async def get_gsm_bf_loss(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/loss/gsm-bf-loss", request, token)

@router.get("/quality/compliance")
async def get_quality_compliance(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/quality/compliance", request, token)
