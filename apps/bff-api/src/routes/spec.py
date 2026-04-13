from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
SPEC_SERVICE_URL = os.getenv("SPEC_SERVICE_URL", "http://localhost:28003")


@router.get("/specifications")
async def get_specifications(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/specs/", request, token)


@router.post("/specifications")
async def create_specification(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/specs/", request, token)


@router.get("/specifications/{spec_id}")
async def get_specification(spec_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/specs/{spec_id}", request, token)


@router.put("/specifications/{spec_id}")
async def update_specification(spec_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/specs/{spec_id}", request, token)


@router.post("/specifications/{spec_id}/approve")
async def approve_specification(spec_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/specs/{spec_id}/approve", request, token)


@router.get("/spec-fields")
async def get_spec_fields(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/spec-fields", request, token)


@router.post("/spec-fields")
async def create_spec_field(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/spec-fields", request, token)


@router.put("/spec-fields/{field_id}")
async def update_spec_field(field_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/spec-fields/{field_id}", request, token)


@router.delete("/spec-fields/{field_id}")
async def delete_spec_field(field_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/spec-fields/{field_id}", request, token)


@router.get("/constants")
async def get_spec_constants(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/specs/constants", request, token)


@router.post("/recipes/{spec_id}")
async def create_recipe(spec_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/{spec_id}", request, token)


@router.get("/recipes/spec/{spec_id}")
async def get_recipes_for_spec(spec_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/spec/{spec_id}", request, token)


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/{recipe_id}", request, token)


@router.post("/recipes/{recipe_id}/layers")
async def add_recipe_layer(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/{recipe_id}/layers", request, token)


@router.post("/trials/{recipe_id}")
async def create_trial(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/trials/{recipe_id}", request, token)


@router.get("/calculate/yield/{spec_id}")
async def calculate_yield(spec_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/calculate/yield/{spec_id}", request, token)


@router.get("/calculate/weight/{recipe_id}")
async def calculate_weight(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/calculate/weight/{recipe_id}", request, token)


@router.get("/calculate/bom/{recipe_id}")
async def calculate_bom(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/calculate/bom/{recipe_id}", request, token)
