from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
import httpx
import os

from src.middleware.auth import get_token
from src.services.http_client import proxy_to_service

router = APIRouter()
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")
http_client = httpx.AsyncClient(timeout=15.0)


def _master_headers(token: str, request: Request | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if request is not None:
        plant_header = request.headers.get("X-Plant-ID")
        if plant_header:
            headers["X-Plant-ID"] = plant_header
    return headers


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
async def get_parchments(request: Request, token: str = Depends(get_token)):
    headers = _master_headers(token, request)
    vendors_resp = await http_client.get(
        f"{MASTER_SERVICE_URL}/master/parchment/vendors",
        headers=headers,
    )
    colors_resp = await http_client.get(
        f"{MASTER_SERVICE_URL}/master/parchment/colors",
        headers=headers,
    )

    if vendors_resp.status_code != 200 or colors_resp.status_code != 200:
        status = vendors_resp.status_code if vendors_resp.status_code != 200 else colors_resp.status_code
        detail = vendors_resp.json() if vendors_resp.status_code != 200 else colors_resp.json()
        return JSONResponse(status_code=status, content=detail)

    vendors = {vendor["id"]: vendor for vendor in vendors_resp.json()}
    merged_by_key = {}
    for color in colors_resp.json():
        vendor = vendors.get(color.get("vendor_id"), {})
        vendor_name = vendor.get("name")
        row = {
            "id": color.get("id"),
            "vendor_id": color.get("vendor_id"),
            "vendor_name": vendor_name,
            "vendor_family": vendor_name,
            "color_name": color.get("color_name"),
            "display_name": (
                f"{color.get('color_name')} / {vendor_name}"
                if vendor_name and color.get("color_name")
                else vendor_name or color.get("color_name")
            ),
            "active": color.get("active", True),
        }
        key = (
            str(row.get("vendor_name") or "").strip().lower(),
            str(row.get("color_name") or "").strip().lower(),
        )
        merged_by_key[key] = row

    for vendor in vendors.values():
        vendor_name = vendor.get("name")
        key = (str(vendor_name or "").strip().lower(), "")
        if key not in merged_by_key and vendor_name:
            merged_by_key[key] = {
                "id": f"vendor:{vendor.get('id')}",
                "vendor_id": vendor.get("id"),
                "vendor_name": vendor_name,
                "vendor_family": vendor_name,
                "color_name": "",
                "display_name": vendor_name,
                "active": vendor.get("active", True),
            }

    merged = sorted(
        merged_by_key.values(),
        key=lambda item: (
            str(item.get("color_name") or "").lower(),
            str(item.get("vendor_name") or "").lower(),
        ),
    )
    return JSONResponse(content=merged)


@router.post("/parchments")
async def create_parchment_color(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    vendor_id = body.get("vendor_id")
    vendor_name = body.get("vendor_family") or body.get("vendor_name")
    color_name = body.get("color_name")
    if (not vendor_id and not vendor_name) or not color_name:
        return JSONResponse(status_code=400, content={"detail": "company selection and sub parchment are required"})

    headers = _master_headers(token, request)

    if not vendor_id:
        vendors_resp = await http_client.get(
            f"{MASTER_SERVICE_URL}/master/parchment/vendors",
            headers=headers,
        )
        if vendors_resp.status_code != 200:
            return JSONResponse(status_code=vendors_resp.status_code, content=vendors_resp.json())

        for vendor in vendors_resp.json():
            if vendor.get("name", "").strip().lower() == vendor_name.strip().lower():
                vendor_id = vendor.get("id")
                break

        if not vendor_id:
            create_vendor_resp = await http_client.post(
                f"{MASTER_SERVICE_URL}/master/parchment/vendors",
                json={"name": vendor_name},
                headers=headers,
            )
            if create_vendor_resp.status_code != 200:
                return JSONResponse(status_code=create_vendor_resp.status_code, content=create_vendor_resp.json())
            vendor_id = create_vendor_resp.json().get("id")

    create_color_resp = await http_client.post(
        f"{MASTER_SERVICE_URL}/master/parchment/colors",
        json={"vendor_id": vendor_id, "color_name": color_name},
        headers=headers,
    )
    return JSONResponse(status_code=create_color_resp.status_code, content=create_color_resp.json())


@router.put("/parchments/{color_id}")
async def update_parchment_color(color_id: str, request: Request, token: str = Depends(get_token)):
    body = await request.json()
    payload = {}
    headers = _master_headers(token, request)

    color_name = body.get("color_name")
    if color_name:
        payload["color_name"] = color_name

    vendor_id = body.get("vendor_id")
    vendor_name = body.get("vendor_family") or body.get("vendor_name")
    if vendor_id:
        payload["vendor_id"] = vendor_id
    elif vendor_name:
        vendors_resp = await http_client.get(
            f"{MASTER_SERVICE_URL}/master/parchment/vendors",
            headers=headers,
        )
        if vendors_resp.status_code != 200:
            return JSONResponse(status_code=vendors_resp.status_code, content=vendors_resp.json())

        matched_vendor_id = None
        for vendor in vendors_resp.json():
            if vendor.get("name", "").strip().lower() == vendor_name.strip().lower():
                matched_vendor_id = vendor.get("id")
                break

        if not matched_vendor_id:
            create_vendor_resp = await http_client.post(
                f"{MASTER_SERVICE_URL}/master/parchment/vendors",
                json={"name": vendor_name},
                headers=headers,
            )
            if create_vendor_resp.status_code != 200:
                return JSONResponse(status_code=create_vendor_resp.status_code, content=create_vendor_resp.json())
            matched_vendor_id = create_vendor_resp.json().get("id")

        payload["vendor_id"] = matched_vendor_id

    update_color_resp = await http_client.put(
        f"{MASTER_SERVICE_URL}/master/parchment/colors/{color_id}",
        json=payload,
        headers=headers,
    )
    return JSONResponse(status_code=update_color_resp.status_code, content=update_color_resp.json())


@router.delete("/parchments/{color_id}")
async def delete_parchment_color(color_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/parchment/colors/{color_id}", request, token)


@router.get("/parchment/vendors")
async def get_parchment_vendors(request: Request, token: str = Depends(get_token)):
    headers = _master_headers(token, request)
    response = await http_client.get(f"{MASTER_SERVICE_URL}/master/parchment/vendors", headers=headers)
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.post("/parchment/vendors")
async def create_parchment_vendor(request: Request, token: str = Depends(get_token)):
    headers = _master_headers(token, request)
    body = await request.json()
    response = await http_client.post(f"{MASTER_SERVICE_URL}/master/parchment/vendors", json=body, headers=headers)
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.put("/parchment/vendors/{vendor_id}")
async def update_parchment_vendor(vendor_id: str, request: Request, token: str = Depends(get_token)):
    headers = _master_headers(token, request)
    body = await request.json()
    response = await http_client.put(
        f"{MASTER_SERVICE_URL}/master/parchment/vendors/{vendor_id}",
        json=body,
        headers=headers,
    )
    return JSONResponse(status_code=response.status_code, content=response.json())


@router.delete("/parchment/vendors/{vendor_id}")
async def delete_parchment_vendor(vendor_id: str, request: Request, token: str = Depends(get_token)):
    headers = _master_headers(token, request)
    response = await http_client.delete(f"{MASTER_SERVICE_URL}/master/parchment/vendors/{vendor_id}", headers=headers)
    return JSONResponse(status_code=response.status_code, content=response.json())


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


@router.get("/suppliers")
async def get_suppliers(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/suppliers/", request, token)


@router.post("/suppliers")
async def create_supplier(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/suppliers/", request, token)


@router.put("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{supplier_id}", request, token)


@router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{supplier_id}", request, token)


@router.get("/vendors")
async def get_vendors(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/suppliers/", request, token)


@router.post("/vendors")
async def create_vendor(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/suppliers/", request, token)


@router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{vendor_id}", request, token)


@router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{vendor_id}", request, token)


@router.get("/contact-directory")
async def get_contact_directory(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/contact-directory/", request, token)


@router.get("/customers/{customer_id}/contacts")
async def get_customer_contacts(customer_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/customers/{customer_id}/contacts", request, token)


@router.post("/customers/{customer_id}/contacts")
async def create_customer_contact(customer_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/customers/{customer_id}/contacts", request, token)


@router.put("/customers/{customer_id}/contacts/{contact_id}")
async def update_customer_contact(customer_id: str, contact_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        MASTER_SERVICE_URL,
        f"/master/customers/{customer_id}/contacts/{contact_id}",
        request,
        token,
    )


@router.delete("/customers/{customer_id}/contacts/{contact_id}")
async def delete_customer_contact(customer_id: str, contact_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        MASTER_SERVICE_URL,
        f"/master/customers/{customer_id}/contacts/{contact_id}",
        request,
        token,
    )


@router.get("/suppliers/{supplier_id}/contacts")
async def get_supplier_contacts(supplier_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{supplier_id}/contacts", request, token)


@router.post("/suppliers/{supplier_id}/contacts")
async def create_supplier_contact(supplier_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{supplier_id}/contacts", request, token)


@router.put("/suppliers/{supplier_id}/contacts/{contact_id}")
async def update_supplier_contact(supplier_id: str, contact_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        MASTER_SERVICE_URL,
        f"/master/suppliers/{supplier_id}/contacts/{contact_id}",
        request,
        token,
    )


@router.delete("/suppliers/{supplier_id}/contacts/{contact_id}")
async def delete_supplier_contact(supplier_id: str, contact_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        MASTER_SERVICE_URL,
        f"/master/suppliers/{supplier_id}/contacts/{contact_id}",
        request,
        token,
    )


@router.get("/vendors/{vendor_id}/contacts")
async def get_vendor_contacts(vendor_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{vendor_id}/contacts", request, token)


@router.post("/vendors/{vendor_id}/contacts")
async def create_vendor_contact(vendor_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/suppliers/{vendor_id}/contacts", request, token)


@router.put("/vendors/{vendor_id}/contacts/{contact_id}")
async def update_vendor_contact(vendor_id: str, contact_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        MASTER_SERVICE_URL,
        f"/master/suppliers/{vendor_id}/contacts/{contact_id}",
        request,
        token,
    )


@router.delete("/vendors/{vendor_id}/contacts/{contact_id}")
async def delete_vendor_contact(vendor_id: str, contact_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        MASTER_SERVICE_URL,
        f"/master/suppliers/{vendor_id}/contacts/{contact_id}",
        request,
        token,
    )


@router.get("/packaging/boxes")
async def get_packaging_boxes(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/packaging/boxes", request, token)


@router.post("/packaging/boxes")
async def create_packaging_box(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/packaging/boxes", request, token)


@router.put("/packaging/boxes/{box_id}")
async def update_packaging_box(box_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/packaging/boxes/{box_id}", request, token)


@router.delete("/packaging/boxes/{box_id}")
async def delete_packaging_box(box_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/packaging/boxes/{box_id}", request, token)


@router.get("/packaging/plastic-sheets")
async def get_packaging_plastic_sheets(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/packaging/plastic-sheets", request, token)


@router.post("/packaging/plastic-sheets")
async def create_packaging_plastic_sheet(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/packaging/plastic-sheets", request, token)


@router.put("/packaging/plastic-sheets/{plastic_id}")
async def update_packaging_plastic_sheet(plastic_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/packaging/plastic-sheets/{plastic_id}", request, token)


@router.delete("/packaging/plastic-sheets/{plastic_id}")
async def delete_packaging_plastic_sheet(plastic_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/packaging/plastic-sheets/{plastic_id}", request, token)


@router.get("/packaging/fadda")
async def get_packaging_fadda(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/packaging/fadda", request, token)


@router.post("/packaging/fadda")
async def create_packaging_fadda(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/packaging/fadda", request, token)


@router.put("/packaging/fadda/{fadda_id}")
async def update_packaging_fadda(fadda_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/packaging/fadda/{fadda_id}", request, token)


@router.delete("/packaging/fadda/{fadda_id}")
async def delete_packaging_fadda(fadda_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/packaging/fadda/{fadda_id}", request, token)


@router.get("/tools")
async def get_tools(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/tools/", request, token)


@router.post("/tools")
async def create_tool(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, "/master/tools/", request, token)


@router.put("/tools/{tool_id}")
async def update_tool(tool_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/tools/{tool_id}", request, token)


@router.delete("/tools/{tool_id}")
async def delete_tool(tool_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(MASTER_SERVICE_URL, f"/master/tools/{tool_id}", request, token)
