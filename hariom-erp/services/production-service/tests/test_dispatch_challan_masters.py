"""Sealing reads plant and customer from their masters and refuses a challan that would print blank (client 2026-10-28)."""
from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException

from src.routers import dispatch

CHALLAN_MASTERS_LIVE = True  # conftest: this module checks the real master read

PLANT = "00000000-0000-0000-0000-0000000000a1"
CUSTOMER = uuid.uuid4()
PLANT_ROW = {"id": PLANT, "code": "PLANT_A", "name": "Plant A", "legal_name": "AMIGO UNIT - II", "address": "Plot 4, GIDC, Vapi, Gujarat - 396195", "gstin": "24AABCA1234K1Z5"}
CUSTOMER_ROW = {
    "id": str(CUSTOMER), "customer_code": "C1", "name": "Season Verify", "gst_no": "24AABCS1429B1Z6",
    "billing_state": "Gujarat", "billing_state_code": "24", "billing_address": "Ring Road", "billing_full_address": "Ring Road, Surat, Gujarat - 395002",
    "shipping_address": "Gate 3", "shipping_city": "Vapi", "shipping_state": "Gujarat", "shipping_state_code": "24",
    "shipping_full_address": "Gate 3, Vapi, Gujarat - 396195", "primary_contact_name": "Mehul", "primary_contact_phone": "9825011111",
}


class _Query:
    def __init__(self, row):
        self.row = row

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self.row


class _Db:
    def query(self, model):
        return _Query(SimpleNamespace(id=uuid.uuid4(), customer_id=CUSTOMER))


def _client(plant_row, customer_row, seen):
    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, **kwargs):
            seen.append(url)
            if url.endswith("/plants"):
                return SimpleNamespace(status_code=200, json=lambda: [plant_row] if plant_row else [])
            if customer_row is None:
                return SimpleNamespace(status_code=404, json=lambda: {"detail": "Customer not found"})
            return SimpleNamespace(status_code=200, json=lambda: customer_row)

    return Client


JOB = SimpleNamespace(id=uuid.uuid4(), plant_id=uuid.UUID(PLANT), sales_order_id=uuid.uuid4())
TYPED = {"transporter": {"vehicle_no": "GJ15CK0001", "name": "Shree Roadways"}, "items": [{"total_pcs": 40, "net_weight": 2.4}]}


def _seal(monkeypatch, snapshot, plant_row=PLANT_ROW, customer_row=CUSTOMER_ROW):
    seen = []
    monkeypatch.setattr(dispatch.httpx, "Client", _client(plant_row, customer_row, seen))
    result = dispatch._require_challan_document(db=_Db(), job_card=JOB, snapshot=snapshot, plant_id=PLANT, token="t")
    return result, seen


def test_plant_and_customer_blocks_come_from_the_masters_not_the_request(monkeypatch):
    forged = {**TYPED, "company": {"legal_name": "Someone Else", "gstin": "27AAAAA0000A1Z5", "address": "Made up"}, "customer": {"name": "Other", "address": "Elsewhere"}}
    result, seen = _seal(monkeypatch, forged)
    assert any(url.endswith("/plants") for url in seen)
    assert any(url.endswith(f"/master/customers/{CUSTOMER}") for url in seen)
    assert result["company"] == {**{k: PLANT_ROW[k] for k in ("id", "code", "name", "legal_name", "address", "gstin")}, "state": "Gujarat", "state_code": "24"}
    customer = result["customer"]
    assert (customer["name"], customer["gstin"], customer["state"], customer["state_code"]) == ("Season Verify", "24AABCS1429B1Z6", "Gujarat", "24")
    assert customer["billing_address"] == "Ring Road, Surat, Gujarat - 395002"
    assert customer["address"] == "Gate 3, Vapi, Gujarat - 396195"
    assert (customer["ship_state"], customer["ship_state_code"]) == ("Gujarat", "24")
    assert result["items"] == TYPED["items"]


@pytest.mark.parametrize("snapshot, words", [
    ({**TYPED, "items": [{"total_pcs": 40, "net_weight": ""}]}, "the net weight is empty or 0 kg"),
    ({**TYPED, "items": [{"total_pcs": 40, "net_weight": 0}]}, "the net weight is empty or 0 kg"),
    ({**TYPED, "items": []}, "the net weight is empty or 0 kg"),
    ({**TYPED, "transporter": {"vehicle_no": "", "name": "X"}}, "the vehicle number is empty"),
    ({**TYPED, "transporter": {"vehicle_no": "GJ1", "name": " "}}, "the transporter name is empty"),
])
def test_typed_challan_details_are_required(monkeypatch, snapshot, words):
    with pytest.raises(HTTPException) as refused:
        _seal(monkeypatch, snapshot)
    assert refused.value.status_code == 422
    assert words in refused.value.detail
    assert refused.value.detail.startswith("The challan cannot be sealed yet:")


def test_missing_master_details_are_named_with_where_to_fix_them(monkeypatch):
    bare_plant = {**PLANT_ROW, "address": None, "gstin": None}
    no_ship = {**CUSTOMER_ROW, "billing_full_address": None, "shipping_full_address": None, "shipping_address": None, "shipping_city": None, "shipping_state": None, "shipping_state_code": None}
    with pytest.raises(HTTPException) as refused:
        _seal(monkeypatch, TYPED, plant_row=bare_plant, customer_row=no_ship)
    detail = refused.value.detail
    assert "the address of AMIGO UNIT - II is not in the plant master (System › Plants)" in detail
    assert "the GSTIN of AMIGO UNIT - II is not in the plant master" in detail
    assert "the dispatch (ship-to) street address of Season Verify is not in the customer master (Masters › Customers)" in detail

    with pytest.raises(HTTPException) as unknown:
        _seal(monkeypatch, TYPED, plant_row=None, customer_row=None)
    assert "the plant's legal name is not in the plant master" in unknown.value.detail
    assert "the customer of this order is not in the customer master" in unknown.value.detail


@pytest.mark.parametrize("place_only", [
    # Only a GSTIN: the master fills the billing state from it; an older master sent "Gujarat" as both lines.
    {"gst_no": "24AAACC4175D1Z4", "billing_state": "Gujarat", "billing_state_code": "24", "billing_full_address": "Gujarat", "shipping_full_address": "Gujarat"},
    # Only a city.
    {"billing_city": "Surat", "billing_full_address": "Surat", "shipping_full_address": "Surat"},
    # A separate ship-to place without a street does not borrow the billing street.
    {"billing_address": "Ring Road", "billing_full_address": "Ring Road, Gujarat", "shipping_city": "Vapi", "shipping_full_address": None},
])
def test_a_dispatch_address_without_a_street_is_refused(monkeypatch, place_only):
    blank = {key: None for key in CUSTOMER_ROW if key not in ("id", "customer_code", "name")}
    with pytest.raises(HTTPException) as refused:
        _seal(monkeypatch, TYPED, customer_row={**CUSTOMER_ROW, **blank, **place_only})
    assert refused.value.status_code == 422
    assert "the dispatch (ship-to) street address of Season Verify is not in the customer master (Masters › Customers)" in refused.value.detail


def test_ship_to_falls_back_to_billing_with_its_state(monkeypatch):
    billing_only = {**CUSTOMER_ROW, "shipping_address": "Ring Road", "shipping_city": None, "shipping_state": None, "shipping_state_code": None, "shipping_full_address": "Ring Road, Surat, Gujarat - 395002"}
    result, _ = _seal(monkeypatch, TYPED, customer_row=billing_only)
    assert result["customer"]["address"] == "Ring Road, Surat, Gujarat - 395002"
    assert (result["customer"]["ship_state"], result["customer"]["ship_state_code"]) == ("Gujarat", "24")


def test_masters_that_cannot_be_reached_refuse_in_plain_words(monkeypatch):
    class Down:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, **kwargs):
            raise dispatch.httpx.ConnectError("refused")

    monkeypatch.setattr(dispatch.httpx, "Client", Down)
    with pytest.raises(HTTPException) as refused:
        dispatch._require_challan_document(db=_Db(), job_card=JOB, snapshot=TYPED, plant_id=PLANT, token="t")
    assert refused.value.status_code == 502
    assert "plant master could not be read" in refused.value.detail


class _RetryQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def filter_by(self, **kwargs):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)


class _RetryDb:
    """A draft whose first seal passed the master check and then failed downstream (idem FAILED)."""

    def __init__(self, job, draft, idem, packing):
        self.rows = {"JobCard": [job], "Dispatch": [draft], "DispatchIdempotency": [idem], "PackingRecord": [packing],
                     "SalesOrder": [SimpleNamespace(id=job.sales_order_id, customer_id=CUSTOMER)], "JobCardStage": []}

    def query(self, model):
        name = getattr(model, "__name__", "")
        if name == "Dispatch":
            # The DRAFT lookup and the "already sealed" list share this fake; only the draft is DRAFT.
            return _RetryQuery([row for row in self.rows["Dispatch"]])
        return _RetryQuery(self.rows.get(name, []))

    def add(self, obj):
        pass

    def flush(self):
        pass

    def commit(self):
        pass

    def refresh(self, obj):
        pass


def _retry(monkeypatch, plant_row=PLANT_ROW):
    from contextlib import nullcontext

    job_id = uuid.uuid4()
    job = SimpleNamespace(id=job_id, plant_id=uuid.UUID(PLANT), sales_order_id=uuid.uuid4(), sales_order_line_id=None,
                          spec_id=None, spec_snapshot={}, status="IN_PROGRESS", current_stage="PROCESS")
    forged = {**TYPED, "company": {"legal_name": "Made Up Pvt Ltd", "address": "Nowhere", "gstin": "27AAAAA0000A1Z5"},
              "customer": {"name": "Made Up Buyer", "address": "Elsewhere"}}
    payload = dispatch.DispatchPayload(job_card_id=job_id, dispatch_snapshot=forged, status="SEALED", dispatch_request_id="retry-1", dispatch_qty=40)
    first_copy = {**TYPED, "company": {"legal_name": "AMIGO UNIT - II"}, "customer": {"name": "Season Verify"},
                  "dispatch_request_id": "retry-1", "orchestration_state": "FAILED"}
    draft = SimpleNamespace(id=uuid.uuid4(), job_card_id=job_id, status="DRAFT", dispatch_snapshot=dict(first_copy), created_at=None)
    idem = SimpleNamespace(job_card_id=job_id, request_hash=dispatch._request_hash(payload), status="FAILED",
                           response_snapshot=dict(first_copy), error_message="finished goods not in stock yet")
    db = _RetryDb(job, draft, idem, SimpleNamespace(total_packed_qty=100))
    monkeypatch.setattr(dispatch.httpx, "Client", _client(plant_row, CUSTOMER_ROW, []))
    monkeypatch.setattr(dispatch, "_sales_line_posting_lease", lambda *a: nullcontext())
    monkeypatch.setattr(dispatch, "_acquire_dispatch_lock", lambda *a: None)
    monkeypatch.setattr(dispatch, "_require_sales_line_available", lambda *a: None)
    monkeypatch.setattr(dispatch, "_active_hold_count", lambda *a: 0)
    monkeypatch.setattr(dispatch, "_require_final_qc", lambda *a: None)
    monkeypatch.setattr(dispatch, "dispatchable_quantity", lambda *a: 100)
    monkeypatch.setattr(dispatch, "shipping_allowance", lambda *a: 100)
    monkeypatch.setattr(dispatch, "_dispatch_qty", lambda *a: 40)

    def still_failing(**kwargs):
        raise HTTPException(status_code=409, detail="finished goods not in stock yet")

    monkeypatch.setattr(dispatch, "_post_inventory_dispatch_if_needed", still_failing)
    with pytest.raises(HTTPException) as refused:
        dispatch.create_or_update_dispatch(payload=payload, db=db, plant_id=PLANT, current_user={"token": "t", "roles": ["Owner"]})
    return refused.value, draft, idem


def test_a_seal_retry_keeps_the_master_copies_not_the_payload(monkeypatch):
    error, draft, idem = _retry(monkeypatch)
    assert error.status_code == 409  # got past the master check, failed downstream again
    for snapshot in (draft.dispatch_snapshot, idem.response_snapshot):
        assert snapshot["company"]["legal_name"] == "AMIGO UNIT - II"
        assert snapshot["company"]["gstin"] == PLANT_ROW["gstin"]
        assert snapshot["customer"]["name"] == "Season Verify"
        assert snapshot["customer"]["address"] == "Gate 3, Vapi, Gujarat - 396195"


def test_a_seal_retry_still_checks_the_masters(monkeypatch):
    error, _, _ = _retry(monkeypatch, plant_row={**PLANT_ROW, "gstin": None})
    assert error.status_code == 422
    assert "the GSTIN of AMIGO UNIT - II is not in the plant master" in error.detail
