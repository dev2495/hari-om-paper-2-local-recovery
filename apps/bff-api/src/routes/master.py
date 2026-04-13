from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
import httpx
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")
http_client = httpx.AsyncClient(timeout=15.0)


@router.get("/papers")
async def get_papers(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/papers/", request, token)


@router.post("/papers")
async def create_paper(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/papers/", request, token)


@router.put("/papers/{paper_id}")
async def update_paper(paper_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/papers/{paper_id}", request, token)


@router.delete("/papers/{paper_id}")
async def delete_paper(paper_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/papers/{paper_id}", request, token)


@router.get("/adhesives")
async def get_adhesives(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/adhesives/", request, token)


@router.post("/adhesives")
async def create_adhesive(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/adhesives/", request, token)


@router.put("/adhesives/{adhesive_id}")
async def update_adhesive(adhesive_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/adhesives/{adhesive_id}", request, token)


@router.delete("/adhesives/{adhesive_id}")
async def delete_adhesive(adhesive_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/adhesives/{adhesive_id}", request, token)


@router.get("/parchments")
async def get_parchments(token: str = Depends(get_token)):
    vendors_resp = await http_client.get(
        f"{MASTER_SERVICE_URL}/master/parchment/vendors",
        headers={"Authorization": f"Bearer {token}"},
    )
    colors_resp = await http_client.get(
        f"{MASTER_SERVICE_URL}/master/parchment/colors",
        headers={"Authorization": f"Bearer {token}"},
    )

    if vendors_resp.status_code != 200 or colors_resp.status_code != 200:
        status = vendors_resp.status_code if vendors_resp.status_code != 200 else colors_resp.status_code
        detail = vendors_resp.json() if vendors_resp.status_code != 200 else colors_resp.json()
        return JSONResponse(status_code=status, content=detail)

    vendors = {vendor["id"]: vendor for vendor in vendors_resp.json()}
    merged = []
    for color in colors_resp.json():
        vendor = vendors.get(color.get("vendor_id"), {})
        merged.append(
            {
                "id": color.get("id"),
                "vendor_id": color.get("vendor_id"),
                "vendor_name": vendor.get("name"),
                "color_name": color.get("color_name"),
                "active": color.get("active", True),
            }
        )

    return JSONResponse(content=merged)


@router.post("/parchments")
async def create_parchment_color(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    vendor_name = body.get("vendor_name")
    color_name = body.get("color_name")
    if not vendor_name or not color_name:
        return JSONResponse(status_code=400, content={"detail": "vendor_name and color_name are required"})

    vendors_resp = await http_client.get(
        f"{MASTER_SERVICE_URL}/master/parchment/vendors",
        headers={"Authorization": f"Bearer {token}"},
    )
    if vendors_resp.status_code != 200:
        return JSONResponse(status_code=vendors_resp.status_code, content=vendors_resp.json())

    vendor_id = None
    for vendor in vendors_resp.json():
        if vendor.get("name", "").strip().lower() == vendor_name.strip().lower():
            vendor_id = vendor.get("id")
            break

    if not vendor_id:
        create_vendor_resp = await http_client.post(
            f"{MASTER_SERVICE_URL}/master/parchment/vendors",
            json={"name": vendor_name},
            headers={"Authorization": f"Bearer {token}"},
        )
        if create_vendor_resp.status_code != 200:
            return JSONResponse(status_code=create_vendor_resp.status_code, content=create_vendor_resp.json())
        vendor_id = create_vendor_resp.json().get("id")

    create_color_resp = await http_client.post(
        f"{MASTER_SERVICE_URL}/master/parchment/colors",
        json={"vendor_id": vendor_id, "color_name": color_name},
        headers={"Authorization": f"Bearer {token}"},
    )
    return JSONResponse(status_code=create_color_resp.status_code, content=create_color_resp.json())


@router.put("/parchments/{color_id}")
async def update_parchment_color(color_id: str, request: Request, token: str = Depends(get_token)):
    body = await request.json()
    payload = {}

    color_name = body.get("color_name")
    if color_name:
        payload["color_name"] = color_name

    vendor_name = body.get("vendor_name")
    if vendor_name:
        vendors_resp = await http_client.get(
            f"{MASTER_SERVICE_URL}/master/parchment/vendors",
            headers={"Authorization": f"Bearer {token}"},
        )
        if vendors_resp.status_code != 200:
            return JSONResponse(status_code=vendors_resp.status_code, content=vendors_resp.json())

        vendor_id = None
        for vendor in vendors_resp.json():
            if vendor.get("name", "").strip().lower() == vendor_name.strip().lower():
                vendor_id = vendor.get("id")
                break

        if not vendor_id:
            create_vendor_resp = await http_client.post(
                f"{MASTER_SERVICE_URL}/master/parchment/vendors",
                json={"name": vendor_name},
                headers={"Authorization": f"Bearer {token}"},
            )
            if create_vendor_resp.status_code != 200:
                return JSONResponse(status_code=create_vendor_resp.status_code, content=create_vendor_resp.json())
            vendor_id = create_vendor_resp.json().get("id")

        payload["vendor_id"] = vendor_id

    update_color_resp = await http_client.put(
        f"{MASTER_SERVICE_URL}/master/parchment/colors/{color_id}",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    return JSONResponse(status_code=update_color_resp.status_code, content=update_color_resp.json())


@router.delete("/parchments/{color_id}")
async def delete_parchment_color(color_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/parchment/colors/{color_id}", request, token)


@router.get("/tube-sizes")
async def get_tube_sizes(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/tube-sizes/", request, token)


@router.post("/tube-sizes")
async def create_tube_size(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/tube-sizes/", request, token)


@router.put("/tube-sizes/{size_id}")
async def update_tube_size(size_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/tube-sizes/{size_id}", request, token)


@router.delete("/tube-sizes/{size_id}")
async def delete_tube_size(size_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/tube-sizes/{size_id}", request, token)


@router.get("/mandrels")
async def get_mandrels(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/mandrels/", request, token)


@router.post("/mandrels")
async def create_mandrel(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/mandrels/", request, token)


@router.put("/mandrels/{mandrel_id}")
async def update_mandrel(mandrel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/mandrels/{mandrel_id}", request, token)


@router.delete("/mandrels/{mandrel_id}")
async def delete_mandrel(mandrel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/mandrels/{mandrel_id}", request, token)


@router.get("/customers")
async def get_customers(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/customers/", request, token)


@router.post("/customers")
async def create_customer(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/customers/", request, token)


@router.put("/customers/{customer_id}")
async def update_customer(customer_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/customers/{customer_id}", request, token)


@router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/customers/{customer_id}", request, token)
