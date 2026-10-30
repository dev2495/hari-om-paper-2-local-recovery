from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
import os
import httpx

from src.middleware.auth import get_token
from src.services import quality_events
from src.services.books_guard import assert_not_backdated, invalidate_books_cache
from src.services.http_client import proxy_to_service
from src.services.workspace import MASTER_SERVICE_URL, PRODUCTION_SERVICE_URL, emit_from_response, emit_notification_event, response_body_json, service_get

router = APIRouter()
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")


def _validate_tool_issue_job_card(job_card: dict, stage_type: str) -> None:
    stages = job_card.get("stages") if isinstance(job_card, dict) else []
    valid_stages = {str(stage.get("stage_type") or "").upper() for stage in stages or [] if isinstance(stage, dict)}
    if valid_stages and stage_type not in valid_stages:
        raise HTTPException(status_code=409, detail=f"{stage_type.title()} is not part of this job card")


def _authoritative_tool_inward_body(body: dict, master: dict) -> dict:
    if str(master.get("status") or "").upper() != "ACTIVE" or master.get("active") is False:
        raise HTTPException(status_code=409, detail="Only active tooling masters can be inwarded")
    # The master is authoritative for category, display name, and attributes.
    # Do not allow a stale or altered browser payload to create a different
    # physical definition than the one selected by the store operator.
    authoritative = dict(body)
    authoritative["tool_definition_id"] = master["id"]
    authoritative["category"] = master["category"]
    authoritative["definition_name"] = master["name"]
    authoritative["attribute_snapshot"] = master.get("attribute_values") or {}
    return authoritative


@router.get("/items")
async def get_items(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/items/", request, token)


@router.post("/items/sync-masters")
async def sync_items_from_masters(request: Request, token: str = Depends(get_token)):
    """Create the stock item for every master that has none (papers, adhesives, parchment
    colours, packing). Safe to call any time; existing items are never changed."""
    from fastapi import HTTPException
    from src.services.master_items import sync_master_items
    try:
        return await sync_master_items(token, request.headers.get("X-Plant-ID"))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"Masters could not be synced to stock items: {exc}") from exc


@router.post("/items")
async def create_item(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/items/", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_ITEM_CREATED",
        title=f"Inventory item created: {payload.get('item_code') or payload.get('id') or 'new item'}",
        message="A new item is available for inventory flows.",
        href="/inventory/items",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"item_id": str(payload.get('id') or '')},
    )
    return response


@router.put("/items/{item_id}")
async def update_item(item_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_POLICY_UPDATED",
        title=f"Inventory policy updated: {payload.get('item_code') or item_id}",
        message="Cost, reorder, safety stock, or lead-time controls changed.",
        href="/inventory/items",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"item_id": item_id},
    )
    return response


@router.put("/items/{item_id}/quality-profile")
async def upsert_item_quality_profile(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}/quality-profile", request, token)


@router.put("/items/{item_id}/quality-profile/tolerances")
async def adjust_item_quality_tolerances(item_id: str, request: Request, token: str = Depends(get_token)):
    """Masters: re-band QC's existing inward-QC parameters (min/max only)."""
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}/quality-profile/tolerances", request, token)


@router.post("/items/{item_id}/quality-profile/copy-template")
async def copy_item_quality_template(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}/quality-profile/copy-template", request, token)


@router.post("/items/{item_id}/quality-profile/approve")
async def approve_item_quality_profile(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}/quality-profile/approve", request, token)


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, request: Request, token: str = Depends(get_token)):
    """Soft-delete an item. Historical transactions remain intact."""
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/items/{item_id}", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_ITEM_DEACTIVATED",
        title=f"Item deactivated: {payload.get('item_code') or item_id}",
        message="Soft-delete; existing transactions are preserved for audit.",
        href="/inventory/items",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"item_id": item_id},
    )
    return response


@router.post("/inward")
async def create_inward(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/inward/", request, token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_INWARD_CREATED",
        title="Raw material inward recorded",
        message="Stores recorded new inbound stock.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "Planner", "PlantManager", "Operator", "GRN", "InwardQC"],
    )
    return response


@router.get("/inward/stock-as-on")
async def get_inward_stock_as_on(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inward/stock-as-on", request, token)


@router.post("/issue")
async def create_issue(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/issue/", request, token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_ISSUE_CREATED",
        title="Inventory issue recorded",
        message="Material was issued from stores into production.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator", "Planner", "RMIssue"],
    )
    return response


@router.post("/fg-inward")
async def create_fg_inward(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/fg-inward/", request, token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="FG_INWARD_CREATED",
        title="Finished goods inward recorded",
        message="Finished goods stock is now available for dispatch planning.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "Dispatch", "Sales"],
    )
    return response


@router.post("/dispatch")
async def create_dispatch(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("date") or body.get("effective_date") or body.get("dispatch_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/dispatch/",
        request,
        token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_DISPATCH_MOVED",
        title="Inventory dispatch recorded",
        message="Stock moved out against a dispatch flow.",
        href="/dispatch",
        recipient_roles=["Owner", "Admin", "Store", "Dispatch", "Sales"],
    )
    return response


@router.get("/reservations")
async def list_reservations(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reservations", request, token)


@router.post("/reservations")
async def create_reservation(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/reservations", request, token)
    await emit_from_response(
        response,
        token=token,
        event_type="FG_RESERVATION_CREATED",
        title="Finished-goods reservation created",
        message="Stock has been protected against a released sales-order line.",
        href="/inventory/reservations",
        recipient_roles=["Owner", "Admin", "Dispatch", "Store", "Sales"],
    )
    return response


@router.post("/reservations/{reservation_id}/release")
async def release_reservation(reservation_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/reservations/{reservation_id}/release",
        request,
        token,
    )


@router.post("/reservations/{reservation_id}/consume")
async def consume_reservation(reservation_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/reservations/{reservation_id}/consume",
        request,
        token,
    )
    await invalidate_books_cache(request.headers.get("X-Plant-ID", "") or None)
    return response


@router.get("/balance")
async def get_all_balances(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/all-balances", request, token)


@router.get("/balance/{item_id}")
async def get_item_balance(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/balance/{item_id}", request, token)


@router.get("/ledger")
async def get_ledger(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/ledger", request, token)


@router.get("/stock-control/statement")
async def get_stock_statement(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/statement", request, token)


@router.get("/stock-control/opening-loads")
async def list_opening_loads(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/opening-loads", request, token)


@router.post("/stock-control/opening-loads")
async def create_opening_load(request: Request, token: str = Depends(get_token)):
    try:
        body = await request.json()
    except Exception:
        body = {}
    # No BFF books guard here: inventory checks the go-live rule first ("Opening stock is closed…" once the
    # go-live month is closed) and then the books lock itself (409 BOOKS_LOCKED), in the posting transaction.
    # The BFF guard would answer a closed go-live month with BOOKS_LOCKED before that plainer sentence.
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/stock-control/opening-loads",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    if payload.get("idempotent"):
        return response  # a repeated click: the first post already told everyone
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_OPENING_LOAD_POSTED",
        title=f"Opening stock posted: {payload.get('document_no') or payload.get('id') or 'document'}",
        message=f"Go-live opening stock: {payload.get('reel_count', 0)} reel(s) and {payload.get('lot_count', 0)} lot(s) are in stock.",
        href="/inventory/opening-stock",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"opening_load_id": str(payload.get("id") or "")},
    )
    return response


# Go-live opening stock page (client 2026-10-30): what is posted, a check before posting, and labels.
@router.get("/stock-control/opening-stock")
async def get_opening_stock(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/opening-stock", request, token)


@router.post("/stock-control/opening-loads/preview")
async def preview_opening_load(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/opening-loads/preview", request, token)


@router.get("/stock-control/opening-loads/{load_id}/labels")
async def opening_load_labels(load_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/opening-loads/{load_id}/labels", request, token)


@router.get("/stock-control/certifications")
async def list_certifications(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/certifications", request, token)


@router.post("/stock-control/certifications")
async def create_certification(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/certifications", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_CERTIFICATION_DRAFTED",
        title=f"Stock certification drafted: {payload.get('period_end') or payload.get('id') or 'period'}",
        message="Physical count can now be checked against book closing stock.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/stock-control/certifications/{certification_id}")
async def get_certification(certification_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}", request, token)


@router.patch("/stock-control/certifications/{certification_id}")
async def update_certification(certification_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}", request, token)


@router.post("/stock-control/certifications/{certification_id}/refresh")
async def refresh_certification(certification_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}/refresh", request, token)


@router.post("/stock-control/certifications/{certification_id}/certify")
async def certify_stock(certification_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}/certify", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_CERTIFIED",
        title=f"Closing stock certified: {payload.get('period_end') or certification_id}",
        message="The period has an auditable book-vs-physical stock certificate.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": certification_id},
    )
    return response


@router.get("/stock-control/adjustment-vouchers")
async def list_adjustment_vouchers(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/adjustment-vouchers", request, token)


@router.post("/stock-control/adjustment-vouchers")
async def create_adjustment_voucher(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/stock-control/adjustment-vouchers",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_ADJUSTMENT",
        title=f"Stock adjustment {payload.get('status') or 'saved'}: {payload.get('voucher_no') or payload.get('id') or 'voucher'}",
        message="Stock difference was recorded in an auditable adjustment voucher.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"adjustment_id": str(payload.get("id") or "")},
    )
    return response


@router.post("/stock-control/adjustment-vouchers/{voucher_id}/post")
async def post_adjustment_voucher(voucher_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/stock-control/adjustment-vouchers/{voucher_id}/post",
        request,
        token,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_ADJUSTMENT_POSTED",
        title=f"Stock adjustment posted: {payload.get('voucher_no') or voucher_id}",
        message="Stock adjustment posted into inventory stock truth.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"adjustment_id": voucher_id},
    )
    return response


@router.post("/stock-control/certifications/{certification_id}/post-variance")
async def post_certification_variance(certification_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/stock-control/certifications/{certification_id}/post-variance",
        request,
        token,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_STOCK_COUNT_VARIANCE_POSTED",
        title=f"Stock count variance posted: {payload.get('voucher_no') or certification_id}",
        message="Physical count difference was posted to inventory through an adjustment voucher.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": certification_id, "adjustment_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/stock-control/carry-forwards")
async def list_carry_forwards(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/carry-forwards", request, token)


@router.post("/stock-control/certifications/{certification_id}/carry-forward")
async def create_carry_forward(certification_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/certifications/{certification_id}/carry-forward", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_CARRY_FORWARD_GENERATED",
        title=f"Year carry-forward generated: {payload.get('document_no') or certification_id}",
        message="Certified closing stock has been frozen as the next period's opening proof.",
        href="/inventory/stock-control",
        recipient_roles=["Owner", "Admin", "Store", "Planner"],
        payload={"certification_id": certification_id, "carry_forward_id": str(payload.get("id") or "")},
    )
    return response


@router.get("/books/locks")
async def list_books_locks(request: Request, token: str = Depends(get_token)):
    """Closed months of the store books for the plant (month-end close, client 2026-10-28)."""
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/books/locks", request, token)


async def _books_lock_call(action: str, request: Request, token: str):
    """POST /inventory/books/lock|unlock (spec 5). Owner only, checked by inventory; both are idempotent.

    The web closes and re-opens a month through production's month-end close, which locks both
    services together. These proxies keep the spec contract for tools and a repair after a half-done
    close; the dated-write guard cache is dropped so the next write sees the new state at once."""
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/books/{action}", request, token)
    if response.status_code < 300:
        await invalidate_books_cache(request.headers.get("X-Plant-ID", "") or None)
    return response


@router.post("/books/lock")
async def lock_books_month(request: Request, token: str = Depends(get_token)):
    return await _books_lock_call("lock", request, token)


@router.post("/books/unlock")
async def unlock_books_month(request: Request, token: str = Depends(get_token)):
    return await _books_lock_call("unlock", request, token)


@router.get("/locations")
async def get_locations(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations", request, token)


# --- Locations, moves, counts, corrections and the stock book (client 2026-10-28, spec 2.1-2.7). ---
# Plain proxies: the inventory service enforces roles (Owner-only approvals) and closed months itself.


@router.get("/locations/overview")
async def get_locations_overview(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations/overview", request, token)


@router.get("/locations/unassigned")
async def get_unassigned_stock(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations/unassigned", request, token)


@router.post("/locations/put-away-all")
async def put_away_all_unassigned(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations/put-away-all", request, token)


@router.get("/locations/lots")
async def get_lots_for_labels(request: Request, token: str = Depends(get_token)):
    """Reels and lots by id, for printing their labels (new lots made by a count)."""
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations/lots", request, token)


@router.get("/locations/{location_id}")
async def get_location(location_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/locations/{location_id}", request, token)


@router.patch("/locations/{location_id}")
async def update_location(location_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/locations/{location_id}", request, token)


@router.post("/stock-moves")
async def create_stock_move(request: Request, token: str = Depends(get_token)):
    """One reel or lot to another place in the store (from, to and who are recorded).

    From the browser a move changes only the place (spec 2.7: location never changes QC status). A stock
    status, or the reference production uses for its server-to-server QC hold release, is refused here.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail="Send the reel or lot and the place to move it to.")
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Send the reel or lot and the place to move it to.")
    if body.get("stock_status") not in (None, ""):
        raise HTTPException(status_code=422, detail="A move changes only the place. QC status changes only through QC.")
    if str(body.get("external_ref") or "").upper().startswith("QC-REL-"):
        raise HTTPException(status_code=422, detail="That reference is kept for QC hold releases.")
    clean = {key: value for key, value in body.items() if key != "stock_status"}
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-moves", request, token, json_body=clean)


@router.post("/stock-moves/scan")
async def scan_move_stock(request: Request, token: str = Depends(get_token)):
    """Phone move / put-away: a scanned label to a scanned rack."""
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-moves/scan", request, token)


@router.post("/stock-moves/scan/undo")
async def undo_scan_move(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-moves/scan/undo", request, token)


@router.get("/stock-control/month-figures")
async def get_month_figures(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/month-figures", request, token)


@router.get("/stock-control/month-figures/{item_id}/sources")
async def get_month_figure_sources(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/month-figures/{item_id}/sources", request, token)


@router.get("/stock-control/corrections/lookup")
async def lookup_correction_lot(request: Request, token: str = Depends(get_token)):
    """What a label is (material, place, book qty, QC state) before a correction is raised."""
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/corrections/lookup", request, token)


@router.get("/stock-control/corrections")
async def list_corrections(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/corrections", request, token)


@router.post("/stock-control/corrections")
async def raise_correction(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/stock-control/corrections", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_CORRECTION_RAISED",
        title=f"Stock correction waiting for you: {payload.get('voucher_no') or 'correction'}",
        message=f"{payload.get('reason_label') or 'A stock correction'} raised by {payload.get('created_by') or 'the store'}. Approve or reject it in Stock counts & book.",
        href="/inventory/stock-control?tab=corrections",
        recipient_roles=["Owner"],
        payload={"adjustment_id": str(payload.get("id") or "")},
    )
    return response


@router.post("/stock-control/corrections/{voucher_id}/approve")
async def approve_correction(voucher_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/corrections/{voucher_id}/approve", request, token)


@router.post("/stock-control/corrections/{voucher_id}/cancel")
async def reject_correction(voucher_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/stock-control/corrections/{voucher_id}/cancel", request, token)


@router.get("/counts")
async def list_counts(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/counts", request, token)


@router.post("/counts")
async def start_count(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/counts", request, token)


@router.get("/counts/{count_id}")
async def get_count(count_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}", request, token)


@router.get("/counts/{count_id}/racks/{rack_key}")
async def get_count_rack(count_id: str, rack_key: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/racks/{rack_key}", request, token)


@router.post("/counts/{count_id}/racks/{rack_key}/{action}")
async def count_rack_action(count_id: str, rack_key: str, action: str, request: Request, token: str = Depends(get_token)):
    if action not in {"start", "done", "reopen"}:
        raise HTTPException(status_code=404, detail="Not found")
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/racks/{rack_key}/{action}", request, token)


@router.post("/counts/{count_id}/scan")
async def scan_in_count(count_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/scan", request, token)


@router.post("/counts/{count_id}/loose")
async def add_loose_stock(count_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/loose", request, token)


@router.patch("/counts/{count_id}/entries/{entry_id}")
async def update_count_entry(count_id: str, entry_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/entries/{entry_id}", request, token)


@router.post("/counts/{count_id}/entries/{entry_id}/{action}")
async def count_entry_action(count_id: str, entry_id: str, action: str, request: Request, token: str = Depends(get_token)):
    if action not in {"undo", "decide"}:
        raise HTTPException(status_code=404, detail="Not found")
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/entries/{entry_id}/{action}", request, token)


@router.post("/counts/{count_id}/submit")
async def submit_count(count_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/submit", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_COUNT_SUBMITTED",
        title=f"Stock count waiting for your approval: {payload.get('count_no') or count_id}",
        message=f"{payload.get('kind_word') or 'A stock count'} was sent by {payload.get('submitted_by') or 'the store'}. Review and approve it.",
        href=f"/inventory/counts/{count_id}",
        recipient_roles=["Owner"],
        payload={"count_id": count_id},
    )
    return response


@router.post("/counts/{count_id}/{action}")
async def count_action(count_id: str, action: str, request: Request, token: str = Depends(get_token)):
    """Owner decisions (approve, send back) and cancel; the service checks who may do each."""
    if action not in {"approve", "send-back", "cancel"}:
        raise HTTPException(status_code=404, detail="Not found")
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/counts/{count_id}/{action}", request, token)
    if action == "send-back":
        payload = response_body_json(response) or {}
        await emit_from_response(
            response,
            token=token,
            event_type="INVENTORY_COUNT_SENT_BACK",
            title=f"Recount asked: {payload.get('count_no') or count_id}",
            message=str(payload.get("sent_back_note") or "The Owner sent the count back for a recount."),
            href=f"/inventory/counts/{count_id}",
            recipient_roles=["Store", "PlantManager"],
            payload={"count_id": count_id},
        )
    return response


@router.post("/locations")
async def create_location(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/locations", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_LOCATION_CREATED",
        title=f"Inventory location created: {payload.get('code') or payload.get('id') or 'new location'}",
        message="Stores can now use this location for reel and batch placement.",
        href="/inventory/locations",
        recipient_roles=["Owner", "Admin", "Store"],
        payload={"location_id": str(payload.get("id") or "")},
    )
    return response


# Physical tooling is inventory-controlled. Master definitions stay under
# /api/master/tools; these routes own GRN inward, QR assets, movement, usage,
# grinding, maintenance, scrap, and the asset report.
@router.post("/tools/receipts")
async def receive_tool_assets(request: Request, token: str = Depends(get_token)):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Tool inward payload must be valid JSON") from exc
    if not isinstance(body, dict) or not body.get("tool_definition_id"):
        raise HTTPException(status_code=422, detail="Select an active tooling master before inwarding a physical tool")
    try:
        master = await service_get(
            MASTER_SERVICE_URL,
            f"/master/tools/{body['tool_definition_id']}",
            token,
            request,
        )
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        if status_code in {401, 403, 404}:
            raise HTTPException(status_code=409, detail="The selected tooling master is not active in this plant") from exc
        raise HTTPException(status_code=502, detail="Tool master service could not validate the inward") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Tool master service is unavailable; inward was not posted") from exc
    body = _authoritative_tool_inward_body(body, master)
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/tools/receipts",
        request,
        token,
        json_body=body,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="TOOL_ASSETS_RECEIVED",
        title=f"Tool inward posted: {payload.get('receipt', {}).get('receipt_no') or 'new receipt'}",
        message="Physical tool assets received and assigned QR identities.",
        href="/masters/tools",
        recipient_roles=["Owner", "Admin", "Store", "Production"],
        payload={"receipt_id": str(payload.get("receipt", {}).get("id") or "")},
    )
    return response


@router.get("/tools/assets")
async def list_tool_assets(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/tools", request, token)


@router.get("/tools/assets/{asset_id}")
async def get_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}", request, token)


@router.get("/tools/report")
async def get_tool_asset_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/tools/report/summary", request, token)


@router.post("/tools/assets/{asset_id}/move")
async def move_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/move", request, token)


@router.post("/tools/assets/{asset_id}/issue")
async def issue_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Tool issue payload must be valid JSON") from exc
    job_card_id = str(body.get("job_card_id") or "").strip() if isinstance(body, dict) else ""
    stage_type = str(body.get("stage_type") or "").strip().upper() if isinstance(body, dict) else ""
    if not job_card_id or not stage_type:
        raise HTTPException(status_code=422, detail="Select a job card and production stage")
    try:
        job_card = await service_get(PRODUCTION_SERVICE_URL, f"/job-cards/{job_card_id}", token, request)
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        if status_code == 404:
            raise HTTPException(status_code=409, detail="The selected job card no longer exists") from exc
        raise HTTPException(status_code=502, detail="Production service could not validate the tool issue") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Production service is unavailable; the tool was not issued") from exc
    _validate_tool_issue_job_card(job_card, stage_type)
    return await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/tools/{asset_id}/issue",
        request,
        token,
        json_body={**body, "job_card_id": job_card_id, "stage_type": stage_type},
    )


@router.post("/tools/assets/{asset_id}/usage")
async def record_tool_asset_usage(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/usage", request, token)


@router.post("/tools/assets/{asset_id}/return")
async def return_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/return", request, token)


@router.post("/tools/assets/{asset_id}/grinding-out")
async def grinding_out_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/grinding-out", request, token)


@router.post("/tools/assets/{asset_id}/grinding-return")
async def grinding_return_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/grinding-return", request, token)


@router.post("/tools/assets/{asset_id}/maintenance")
async def maintain_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/maintenance", request, token)


@router.post("/tools/assets/{asset_id}/maintenance-complete")
async def complete_tool_maintenance(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/maintenance-complete", request, token)


@router.post("/tools/assets/{asset_id}/scrap")
async def scrap_tool_asset(asset_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/tools/{asset_id}/scrap", request, token)


@router.get("/lots/availability")
async def lot_availability(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/lots/availability", request, token)


@router.post("/reels/inward")
async def create_reel_inward(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("inward_date") or body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/reels/inward",
        request,
        token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_INWARD_CREATED",
        title="Reel inward recorded",
        message="New reels are available in inventory.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator", "GRN", "InwardQC"],
    )
    return response


@router.get("/reels")
async def list_reels(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reels", request, token)


@router.get("/reels/{reel_id}")
async def get_reel(reel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/reels/{reel_id}", request, token)


@router.post("/reels/slit")
async def slit_coil(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict) and body.get("slit_date"):
        await assert_not_backdated(token, plant_id, effective_date=body.get("slit_date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/reels/slit",
        request,
        token,
        json_body=body if body else None,
    )
    await emit_from_response(
        response,
        token=token,
        event_type="COIL_SLIT_RECORDED",
        title="Coil slitting recorded",
        message="Slit coils are available for production issue.",
        href="/inventory/reels/issue",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator", "RMIssue"],
    )
    return response


@router.post("/reels/{reel_id}/scan")
async def create_reel_scan_event(reel_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/reels/{reel_id}/scan", request, token)
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_SCANNED",
        title="Reel scan captured",
        message=f"Reel {reel_id} changed tracked state or location.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator", "RMIssue"],
        payload={"reel_id": reel_id},
    )
    return response


@router.get("/reels/{reel_id}/scans")
async def list_reel_scan_events(reel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/reels/{reel_id}/scans", request, token)


@router.get("/labels/batches/{batch_id}")
async def get_batch_label(batch_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/labels/batches/{batch_id}", request, token)


@router.get("/labels/reels/{reel_id}")
async def get_reel_label(reel_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/labels/reels/{reel_id}", request, token)


@router.post("/reel-issues")
async def create_reel_issue(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/reel-issues", request, token)
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_ISSUE_CREATED",
        title="Reel / coil issued to the floor",
        message="Material went to the floor for the shift. A reel needs its slitting card (coils made + wastage).",
        href="/inventory/reels/issue",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator", "RMIssue"],
    )
    return response


@router.post("/reel-issues/by-weight")
async def issue_parchment_by_weight(request: Request, token: str = Depends(get_token)):
    """Parchment to the floor by colour and kg; the oldest cleared coils are used (client 2026-10-26)."""
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("issue_date"))
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/reel-issues/by-weight", request, token, json_body=body if body else None)
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_ISSUE_CREATED",
        title="Parchment issued to the floor",
        message="Parchment went to the floor for the shift by colour and kg.",
        href="/inventory/production-issue",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "RMIssue"],
    )
    return response


@router.get("/reel-issues")
async def list_reel_issues(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reel-issues", request, token)


@router.get("/reel-issues/by-weight/coils")
async def parchment_coils_to_pick(request: Request, token: str = Depends(get_token)):
    """Which parchment coils a by-weight issue takes and where each sits ("Pick from <rack>")."""
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reel-issues/by-weight/coils", request, token)


@router.get("/reel-issues/slitting-report")
async def slitting_report(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/reel-issues/slitting-report", request, token)


@router.post("/reel-issues/{issue_id}/slitting-card")
async def record_slitting_card(issue_id: str, request: Request, token: str = Depends(get_token)):
    """Coils made and wastage from one reel on the slitter (floor issue, 2026-10-18)."""
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/reel-issues/{issue_id}/slitting-card", request, token)


@router.post("/reel-issues/{issue_id}/close")
async def close_reel_issue(issue_id: str, request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, f"/reel-issues/{issue_id}/close", request, token)
    await emit_from_response(
        response,
        token=token,
        event_type="REEL_ISSUE_CLOSED",
        title="Reel issue closed",
        message=f"Reel issue {issue_id} was resolved.",
        href="/inventory",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Operator", "RMIssue"],
        payload={"issue_id": issue_id},
    )
    return response


@router.get("/quality/templates")
async def list_quality_templates(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/templates", request, token)


@router.post("/quality/templates")
async def upsert_quality_template(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/templates", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_QC_TEMPLATE_UPDATED",
        title=f"QC parameter updated: {payload.get('label') or payload.get('parameter_key') or 'parameter'}",
        message="An inward QC parameter list was changed.",
        href="/quality",
        recipient_roles=["Owner", "Admin", "PlantManager", "QC", "Store", "InwardQC"],
        payload={"template_id": str(payload.get("id") or ""), "scope": "GLOBAL"},
    )
    return response


# Inward QC standards (2026-10-18): QC parameter lists + Masters tolerance bands.
@router.get("/quality/standards/types")
async def list_quality_standard_types(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/standards/types", request, token)


@router.get("/quality/standards/parameters")
async def list_quality_standard_parameters(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/standards/parameters", request, token)


@router.post("/quality/standards/parameters")
async def create_quality_standard_parameter(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/standards/parameters", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_QC_PARAMETER_ADDED",
        title=f"Inward QC check added: {payload.get('label') or 'parameter'}",
        message="QC added a check. Set its tolerance band in Masters › Inward QC tolerances.",
        href="/masters/inward-qc",
        recipient_roles=["Owner", "Admin"],
        payload={"parameter_id": str(payload.get("id") or ""), "material_type": payload.get("material_type"), "action": "review", "priority": "action", "scope": "GLOBAL"},
    )
    return response


@router.put("/quality/standards/parameters/{parameter_id}")
async def update_quality_standard_parameter(parameter_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/quality/standards/parameters/{parameter_id}", request, token)


@router.get("/quality/standards/tolerances")
async def read_quality_standard_tolerances(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/standards/tolerances", request, token)


@router.put("/quality/standards/tolerances")
async def save_quality_standard_tolerances(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/standards/tolerances", request, token)
    payload = response_body_json(response) or {}
    if isinstance(payload, dict) and payload.get("changed"):
        await emit_from_response(
            response,
            token=token,
            event_type="QC_BAND_CHANGED",
            title=f"Inward QC band changed (version {payload.get('version')})",
            message=f"Masters changed {len(payload.get('changed') or [])} band(s); {payload.get('items_updated') or 0} material line(s) are inspected against them from now on.",
            href="/quality/material-standards",
            recipient_roles=["QC", "InwardQC", "Owner"],
            payload={"version": payload.get("version"), "action": "review", "priority": "info", "scope": "GLOBAL"},
        )
    return response


@router.get("/quality/standards/scope")
async def read_quality_standard_scope(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/standards/scope", request, token)


@router.put("/quality/standards/items/{item_id}")
async def save_quality_standard_item(item_id: str, request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, f"/inventory/quality/standards/items/{item_id}", request, token)


@router.get("/quality/standards/history")
async def read_quality_standard_history(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/standards/history", request, token)


@router.get("/quality/pending")
async def list_pending_quality(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/pending", request, token)


@router.get("/quality/inspections")
async def list_inventory_quality_inspections(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/inspections", request, token)


@router.post("/quality/inspections")
async def create_inventory_quality_inspection(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/inspections", request, token)
    # Outside the band → held, Owner/Admin/plant head/QC decide; inside → Store can issue it.
    await quality_events.notify_inward_inspection(response, request, token)
    return response


@router.get("/quality/analytics")
async def inventory_quality_analytics(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/analytics", request, token)


@router.get("/quality/concessions")
async def list_inventory_quality_concessions(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/concessions", request, token)


@router.post("/quality/concessions")
async def create_inventory_quality_concession(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/concessions", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="QC_CONCESSION_APPROVED",
        title="Quality concession recorded",
        message="A FAIL inspection received a permissioned concession. Measured status remains FAIL.",
        href="/quality",
        recipient_roles=["Owner", "Admin", "QC", "Store", "InwardQC"],
        payload={
            "inspection_id": str(payload.get("inspection_id") or ""),
            "plant_id": request.headers.get("X-Plant-ID"),
            "measured_status": payload.get("measured_status"),
            "hold_released": payload.get("hold_released"),
            "event_id": f"qc-concession:{payload.get('inspection_id')}",
        },
    )
    return response


@router.post("/quality/rejected-lots/return-to-supplier")
async def return_rejected_lot_to_supplier(request: Request, token: str = Depends(get_token)):
    response = await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/rejected-lots/return-to-supplier", request, token)
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="QC_LOT_RETURNED_TO_SUPPLIER",
        title="Rejected lot returned to supplier" + (f" · GRN {payload['grn_no']}" if payload.get("grn_no") else ""),
        message=(
            f"{payload.get('returned_qty') or ''} written out of stock. A quality claim is open for the debit note."
            if payload.get("claim_id")
            else f"{payload.get('returned_qty') or ''} written out of stock. Deduct it when the supplier invoice arrives."
        ),
        href="/purchase/discrepancies" if payload.get("claim_id") else "/quality/incoming",
        recipient_roles=["Owner", "Admin", "PlantManager", "Accounts", "Purchase", "QC", "Store", "InwardQC", "GRN"],
        payload={
            "entity_id": str(payload.get("entity_id") or ""),
            "claim_id": str(payload.get("claim_id") or ""),
            "plant_id": request.headers.get("X-Plant-ID"),
            "event_id": f"qc-return:{payload.get('entity_id')}",
        },
    )
    return response


@router.get("/quality/customer-rejections/dispatch-lookup")
async def lookup_dispatch_for_return(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/customer-rejections/dispatch-lookup", request, token)


@router.get("/quality/customer-rejections")
async def list_customer_rejections(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/quality/customer-rejections", request, token)


def _qty_text(value) -> str:
    try:
        return f"{float(value):g}"
    except (TypeError, ValueError):
        return str(value or "")


@router.post("/quality/customer-rejections")
async def create_customer_rejection(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/quality/customer-rejections",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="CUSTOMER_REJECTION_INWARDED",
        title=f"Customer complaint: {payload.get('customer_name') or 'customer'} · {_qty_text(payload.get('rejected_qty'))} pcs",
        message=f"{payload.get('reason_code') or 'Complaint'}{' · batch ' + str(payload.get('complaint_batch')) if payload.get('complaint_batch') else ''}{' · ' + str(payload.get('size_label')) if payload.get('size_label') else ''}. Goods are held for QC; QC records the decision.",
        href=f"/quality/returns?case={payload.get('id') or ''}",
        recipient_roles=["Owner", "Admin", "PlantManager", "QC", "Store", "Dispatch", "Sales"],
        payload={"customer_rejection_id": str(payload.get("id") or ""), "batch_id": str(payload.get("batch_id") or ""), "action": "decide_return", "priority": "action"},
    )
    return response


@router.post("/quality/customer-rejections/{rejection_id}/disposition")
async def dispose_customer_rejection(rejection_id: str, request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/quality/customer-rejections/{rejection_id}/disposition",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="CUSTOMER_REJECTION_DISPOSED",
        title=f"Complaint {str(payload.get('closure_status') or '').replace('_', ' ').lower() or 'updated'}: {payload.get('customer_name') or 'customer'} · {str(payload.get('disposition') or '').replace('_', ' ').lower() or 'decision'}",
        message=f"QC decided {str(payload.get('disposition') or '').replace('_', ' ').lower() or 'the next step'} for {_qty_text(payload.get('rejected_qty'))} pcs.{' Corrective action: ' + str(payload.get('corrective_action')) if payload.get('corrective_action') else ''}",
        href=f"/quality/returns?case={rejection_id}",
        recipient_roles=["Owner", "Admin", "PlantManager", "QC", "Store", "Dispatch", "Sales"],
        payload={"customer_rejection_id": rejection_id, "status": str(payload.get("status") or ""), "action": "review", "priority": "info"},
    )
    return response


@router.get("/valuation/summary")
async def get_valuation_summary(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/valuation/summary", request, token)


@router.get("/valuation/reels")
async def get_valuation_reels(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/valuation/reels", request, token)


@router.get("/health/summary")
async def get_health_summary(request: Request, token: str = Depends(get_token)):
    try:
        return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/summary", request, token)
    except httpx.TimeoutException:
        return JSONResponse(
            status_code=503,
            content={
                "degraded": True,
                "detail": "Inventory health rollup timed out. Live balances were not confirmed.",
                "dispatch_allocated_qty": 0.0,
                "active_dispatch_allocations": 0,
                "blocked_qty": 0.0,
                "qc_hold_qty": 0.0,
                "occupied_locations": 0,
                "total_locations": 0,
                "aging_hotspots": 0,
                "status_rows": [],
                "summary": {
                    "low_stock_items": 0,
                    "degraded": True,
                },
            },
        )


@router.get("/health/status-summary")
async def get_health_status_summary(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/status-summary", request, token)


@router.post("/mrp/notify-shortage")
async def notify_mrp_shortage(request: Request, token: str = Depends(get_token)):
    payload = await request.json()
    raw_lines = payload.get("lines") if isinstance(payload, dict) else []
    lines = raw_lines if isinstance(raw_lines, list) else []
    shortage_count = len(lines)
    total_value = sum(float(row.get("estimated_value") or row.get("po_value") or 0) for row in lines if isinstance(row, dict))
    try:
        await emit_notification_event(
            token=token,
            event_type="MRP_SHORTAGE_DRAFTED",
            title=f"MRP shortage draft generated ({shortage_count} lines)",
            message=f"Store must review shortage material and PO draft value {total_value:,.0f}.",
            href="/analytics/mrp",
            recipient_roles=["Owner", "Admin", "Store", "Planner"],
            payload={"shortage_count": shortage_count, "estimated_value": total_value, "lines": lines[:20] if isinstance(lines, list) else []},
        )
    except httpx.RequestError:
        return JSONResponse(status_code=202, content={"notified": False, "detail": "Notification service unavailable"})
    return {"notified": True, "shortage_count": shortage_count, "estimated_value": total_value}


@router.get("/health/location-occupancy")
async def get_health_location_occupancy(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/location-occupancy", request, token)


@router.get("/health/aging")
async def get_health_aging(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/aging", request, token)


@router.get("/health/genealogy-exceptions")
async def get_health_genealogy_exceptions(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/inventory/health/genealogy-exceptions", request, token)


# ──────────────────────────────────────────────────────────────────────────
# Lifecycle gaps — new BFF endpoints
# ──────────────────────────────────────────────────────────────────────────


@router.get("/transactions/aggregate-by-item")
async def get_transactions_aggregate(request: Request, token: str = Depends(get_token)):
    """Gap 1: aggregate ISSUE_PRODUCTION etc. per item across a date range."""
    return await proxy_to_service(
        INVENTORY_SERVICE_URL, "/transactions/aggregate-by-item", request, token
    )


@router.post("/fg-inward/manual")
async def manual_fg_inward(request: Request, token: str = Depends(get_token)):
    """Gap 7: manual FG inward for rework / returns / adjustments."""
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL, "/fg-inward/manual", request, token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_MANUAL_FG_INWARD",
        title=f"Manual FG inward: {payload.get('batch_no') or payload.get('item_id') or 'item'}",
        message=str(payload.get("message") or "Manual FG inward recorded outside job-close flow."),
        href="/inventory/fg-inward",
        recipient_roles=["Owner", "Admin", "Store", "Dispatch", "Sales"],
        payload={"batch_id": str(payload.get("batch_id") or ""), "transaction_id": str(payload.get("transaction_id") or "")},
    )
    return response


@router.post("/stock-control/carry-forwards/{cf_id}/post-opening")
async def post_opening_from_cf(cf_id: str, request: Request, token: str = Depends(get_token)):
    """Gap 5: auto-create an opening load from a carry-forward document."""
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        f"/inventory/stock-control/carry-forwards/{cf_id}/post-opening",
        request,
        token,
    )
    payload = response_body_json(response) or {}
    if not payload.get("already_existed"):
        await emit_from_response(
            response,
            token=token,
            event_type="INVENTORY_CF_OPENING_POSTED",
            title=f"Opening load posted from CF: {payload.get('document_no') or cf_id}",
            message=str(payload.get("message") or "Carry-forward proof was converted into a posted opening load."),
            href="/inventory/stock-control",
            recipient_roles=["Owner", "Admin", "Store", "Planner"],
            payload={"opening_load_id": str(payload.get("opening_load_id") or ""), "carry_forward_id": cf_id},
        )
    return response


@router.post("/stock-moves/wip-issue")
async def issue_batch_to_wip(request: Request, token: str = Depends(get_token)):
    plant_id = request.headers.get("X-Plant-ID", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        await assert_not_backdated(token, plant_id, effective_date=body.get("effective_date") or body.get("date"))
    response = await proxy_to_service(
        INVENTORY_SERVICE_URL,
        "/inventory/stock-moves/wip-issue",
        request,
        token,
        json_body=body if body else None,
    )
    payload = response_body_json(response) or {}
    await emit_from_response(
        response,
        token=token,
        event_type="INVENTORY_WIP_ISSUE_POSTED",
        title=f"Material issued to WIP: {payload.get('stage') or 'stage'}",
        message=str(payload.get("message") or "Store stock moved into production WIP against a job card."),
        href="/inventory/production-issue",
        recipient_roles=["Owner", "Admin", "Store", "PlantManager", "Production"],
        payload={
            "job_card_id": str(payload.get("job_card_id") or ""),
            "batch_id": str(payload.get("batch_id") or ""),
            "wip_transaction_id": str(payload.get("wip_transaction_id") or ""),
        },
    )
    return response


@router.get("/issue/returnable")
async def returnable_production_issues(request: Request, token: str = Depends(get_token)):
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/issue/returnable", request, token)


@router.post("/issue/returns")
async def return_production_material(request: Request, token: str = Depends(get_token)):
    body = await request.json()
    await assert_not_backdated(token, request.headers.get("X-Plant-ID", ""), effective_date=body.get("effective_date"))
    return await proxy_to_service(INVENTORY_SERVICE_URL, "/issue/returns", request, token, json_body=body)
