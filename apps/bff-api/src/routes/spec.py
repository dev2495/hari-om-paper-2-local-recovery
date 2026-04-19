from fastapi import APIRouter, Depends, Request
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service
from src.services.workspace import emit_from_response, response_body_json

router = APIRouter()
SPEC_SERVICE_URL = os.getenv("SPEC_SERVICE_URL", "http://127.0.0.1:18003")


@router.get("/specifications")
async def get_specifications(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/specs/", request, token)


@router.post("/specifications")
async def create_specification(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SPEC_SERVICE_URL, "/specs/", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SPEC_CREATED",
        title=f"Specification created: {payload.get('spec_no') or payload.get('id') or 'draft'}",
        message=f"{payload.get('customer_name') or 'Customer'} specification draft entered workflow.",
        href="/specifications",
        recipient_roles=["Owner", "Admin", "Planner", "SpecMaker", "SpecApprover", "Sales"],
        payload={"spec_id": str(payload.get('id') or '')},
    )
    return response


@router.get("/specifications/{spec_id}")
async def get_specification(spec_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/specs/{spec_id}", request, token)


@router.put("/specifications/{spec_id}")
async def update_specification(spec_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SPEC_SERVICE_URL, f"/specs/{spec_id}", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SPEC_UPDATED",
        title=f"Specification updated: {payload.get('spec_no') or spec_id}",
        message=f"{payload.get('customer_name') or 'Specification'} details changed.",
        href=f"/specifications/{spec_id}",
        recipient_roles=["Owner", "Admin", "Planner", "SpecMaker", "SpecApprover", "Sales"],
        payload={"spec_id": spec_id},
    )
    return response


@router.post("/specifications/{spec_id}/approve")
async def approve_specification(spec_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SPEC_SERVICE_URL, f"/specs/{spec_id}/approve", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SPEC_APPROVED",
        title=f"Specification approved: {payload.get('spec_no') or spec_id}",
        message="Commercial and planning flows can now consume this approved spec.",
        href=f"/specifications/{spec_id}",
        recipient_roles=["Owner", "Admin", "Planner", "SpecMaker", "SpecApprover", "Sales"],
        payload={"spec_id": spec_id},
    )
    return response


@router.post("/specifications/{spec_id}/obsolete")
async def obsolete_specification(spec_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SPEC_SERVICE_URL, f"/specs/{spec_id}/obsolete", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="SPEC_OBSOLETED",
        title=f"Specification obsoleted: {payload.get('spec_no') or spec_id}",
        message="This spec is no longer active for new demand.",
        href=f"/specifications/{spec_id}",
        recipient_roles=["Owner", "Admin", "Planner", "SpecMaker", "SpecApprover", "Sales"],
        payload={"spec_id": spec_id},
    )
    return response


@router.get("/spec-fields")
async def get_spec_fields(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/spec-fields/", request, token)


@router.post("/spec-fields")
async def create_spec_field(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/spec-fields/", request, token)


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


@router.post("/recipes/{recipe_id}/approve")
async def approve_recipe(recipe_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/{recipe_id}/approve", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="RECIPE_APPROVED",
        title=f"Recipe approved: {payload.get('id') or recipe_id}",
        message="Production planning can now consume this approved recipe snapshot.",
        href="/specifications",
        recipient_roles=["Owner", "Admin", "Planner", "SpecMaker", "SpecApprover"],
        payload={"recipe_id": recipe_id, "spec_id": str(payload.get("spec_id") or "")},
    )
    return response


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


@router.post("/calculate/suggestions")
async def calculate_suggestions(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/calculate/suggestions", request, token)


@router.post("/calculate/preview")
async def calculate_preview(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, "/calculate/preview", request, token)


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/{recipe_id}", request, token)


@router.post("/recipes/{recipe_id}/approve")
async def approve_recipe(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/{recipe_id}/approve", request, token)


@router.post("/recipes/{recipe_id}/layers")
async def add_recipe_layer(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/recipes/{recipe_id}/layers", request, token)


@router.post("/trials/{recipe_id}")
async def create_trial(recipe_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(SPEC_SERVICE_URL, f"/trials/{recipe_id}", request, token)


@router.get("/trials/{recipe_id}")
async def get_trials(recipe_id: str, request: Request, token: str = Depends(get_token)):
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
