from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
ANALYTICS_SERVICE_URL = os.getenv("ANALYTICS_SERVICE_URL", "http://127.0.0.1:18007")


@router.get("/dashboard/overview")
async def get_dashboard_overview(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/dashboard/overview", request, token)


@router.get("/dashboard/owner")
async def get_dashboard_owner(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/dashboard/owner", request, token)


@router.get("/reports/owner-pack")
async def get_owner_pack(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/owner-pack", request, token)


@router.get("/reports/owner-pack/html")
async def get_owner_pack_html(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/owner-pack/html", request, token)


@router.get("/reports/owner-pack/pdf")
async def get_owner_pack_pdf(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/owner-pack/pdf", request, token)


@router.get("/reports/production")
async def get_production_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/production", request, token)


@router.get("/reports/sales")
async def get_sales_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/sales", request, token)


@router.get("/reports/quality")
async def get_quality_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/quality", request, token)


@router.get("/reports/dispatch")
async def get_dispatch_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/dispatch", request, token)


@router.get("/reports/inventory-health")
async def get_inventory_health_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/inventory-health", request, token)


@router.get("/reports/plant-compare")
async def get_plant_compare_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/plant-compare", request, token)


@router.get("/reports/exceptions")
async def get_exception_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/reports/exceptions", request, token)


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

@router.get("/production/live-wip")
async def get_production_live_wip(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/live-wip", request, token)

@router.get("/production/oee")
async def get_production_oee(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(ANALYTICS_SERVICE_URL, "/production/oee", request, token)

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
