"""Vendor master basic details (client 2026-10-27): GSTIN and more, all optional.

Format checks for GSTIN / PAN / IFSC / PIN, plus an API round trip through the supplier
router (create, read, update, clear) on an in-memory database.
"""

import unittest
import uuid
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src import models
from src.database import get_db
from src.routers import supplier as supplier_router
from src.utils import auth
from src.utils import party_formats as formats

PLANT = "00000000-0000-0000-0000-0000000000a1"


@compiles(PG_UUID, "sqlite")
def _uuid_on_sqlite(_type, _compiler, **_kw):  # the API test runs on in-memory SQLite
    return "CHAR(36)"


class FormatCheckTests(unittest.TestCase):
    def test_gstin_is_trimmed_upper_cased_and_checked(self):
        self.assertEqual(formats.normalize_gstin(" 24abcde1234f1z5 "), "24ABCDE1234F1Z5")
        self.assertEqual(formats.normalize_gstin("27 AAPFU0939F 1ZV"), "27AAPFU0939F1ZV")
        self.assertIsNone(formats.normalize_gstin(""))
        self.assertIsNone(formats.normalize_gstin("   "))
        self.assertIsNone(formats.normalize_gstin(None))

    def test_gstin_rejects_wrong_length_pattern_and_state(self):
        with self.assertRaisesRegex(ValueError, "15 characters"):
            formats.normalize_gstin("24ABCDE1234F1Z")
        with self.assertRaisesRegex(ValueError, "PAN"):
            formats.normalize_gstin("24ABCD12345F1Z5")  # PAN part has a digit where a letter belongs
        with self.assertRaisesRegex(ValueError, "PAN"):
            formats.normalize_gstin("2AABCDE1234F1Z5")  # state code is not two digits
        with self.assertRaisesRegex(ValueError, "PAN"):
            formats.normalize_gstin("24ABCDE1234F0Z5")  # entity number cannot be 0
        with self.assertRaisesRegex(ValueError, "not a GST state code"):
            formats.normalize_gstin("25ABCDE1234F1Z5")  # 25 was merged into 26
        with self.assertRaisesRegex(ValueError, "not a GST state code"):
            formats.normalize_gstin("00ABCDE1234F1Z5")

    def test_pan(self):
        self.assertEqual(formats.normalize_pan("abcde1234f"), "ABCDE1234F")
        self.assertIsNone(formats.normalize_pan(""))
        for bad in ("ABCDE1234", "ABCD01234F", "12345ABCDE", "ABCDE12345"):
            with self.assertRaisesRegex(ValueError, "PAN must be"):
                formats.normalize_pan(bad)

    def test_ifsc(self):
        self.assertEqual(formats.normalize_ifsc("sbin0001234"), "SBIN0001234")
        self.assertEqual(formats.normalize_ifsc("HDFC0ABC123"), "HDFC0ABC123")
        self.assertIsNone(formats.normalize_ifsc(None))
        for bad in ("SBIN1001234", "SBI00001234", "SBIN000123", "SBIN00012345"):
            with self.assertRaisesRegex(ValueError, "IFSC must be"):
                formats.normalize_ifsc(bad)

    def test_pin(self):
        self.assertEqual(formats.normalize_pin(" 380015 "), "380015")
        self.assertIsNone(formats.normalize_pin(""))
        for bad in ("038001", "38001", "3800150", "38O015"):
            with self.assertRaisesRegex(ValueError, "PIN code"):
                formats.normalize_pin(bad)

    def test_state_code_phone_email_account(self):
        self.assertEqual(formats.normalize_state_code("24"), "24")
        self.assertEqual(formats.normalize_state_code("7"), "07")
        with self.assertRaises(ValueError):
            formats.normalize_state_code("25")
        self.assertEqual(formats.normalize_phone("+91 98250 12345"), "+91 98250 12345")
        with self.assertRaises(ValueError):
            formats.normalize_phone("call me")
        with self.assertRaises(ValueError):
            formats.normalize_phone("123")
        self.assertEqual(formats.normalize_email("Accounts@Vendor.IN"), "accounts@vendor.in")
        with self.assertRaises(ValueError):
            formats.normalize_email("accounts.vendor.in")
        self.assertEqual(formats.normalize_account_no("0123 4567 8901"), "012345678901")
        with self.assertRaises(ValueError):
            formats.normalize_account_no("12AB")

    def test_full_address_joins_the_filled_parts(self):
        row = models.Supplier(address="Plot 12, GIDC", address_line2="Phase 2", city="Vatva", state="Gujarat", pin_code="382445", country="India")
        self.assertEqual(formats.full_address(row), "Plot 12, GIDC, Phase 2, Vatva, Gujarat - 382445")
        self.assertIsNone(formats.full_address(models.Supplier()))
        self.assertEqual(formats.full_address(models.Supplier(city="Dubai", country="UAE")), "Dubai, UAE")


class RouterCleaningTests(unittest.TestCase):
    def test_clean_details_names_the_field_in_the_error(self):
        with self.assertRaises(HTTPException) as caught:
            supplier_router._clean_details({"gst_no": "24ABC"})
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("GSTIN", caught.exception.detail)
        with self.assertRaises(HTTPException) as caught:
            supplier_router._clean_details({"bank_ifsc": "SBIN1"})
        self.assertIn("IFSC", caught.exception.detail)
        with self.assertRaises(HTTPException) as caught:
            supplier_router._clean_details({"payment_terms_days": 400})
        self.assertIn("Payment terms", caught.exception.detail)
        with self.assertRaises(HTTPException):
            supplier_router._clean_details({"credit_limit": -1})

    def test_blank_values_become_null(self):
        cleaned = supplier_router._clean_details({"gst_no": " ", "city": "  ", "notes": "", "pan_no": None})
        self.assertEqual(cleaned, {"gst_no": None, "city": None, "notes": None, "pan_no": None})

    def test_gstin_fills_pan_state_code_and_state(self):
        row = models.Supplier(gst_no="24ABCDE1234F1Z5")
        supplier_router._fill_from_gstin(row)
        self.assertEqual((row.pan_no, row.state_code, row.state), ("ABCDE1234F", "24", "Gujarat"))
        typed = models.Supplier(gst_no="24ABCDE1234F1Z5", pan_no="ZZZZZ9999Z", state="Gujarat", state_code="24")
        supplier_router._fill_from_gstin(typed)
        self.assertEqual(typed.pan_no, "ZZZZZ9999Z")  # a typed PAN is never overwritten
        by_name = models.Supplier(state="maharashtra")
        supplier_router._fill_from_gstin(by_name)
        self.assertEqual(by_name.state_code, "27")


class VendorApiTests(unittest.TestCase):
    """Create / read / update / clear the new fields through the HTTP routes."""

    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        models.Supplier.__table__.create(engine)
        models.SupplierContact.__table__.create(engine)
        Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

        def db():
            session = Session()
            try:
                yield session
            finally:
                session.close()

        app = FastAPI()
        app.include_router(supplier_router.router)
        app.dependency_overrides[get_db] = db
        app.dependency_overrides[auth.get_current_user] = lambda: {"sub": "owner@test", "roles": ["Owner"], "token": ""}
        app.dependency_overrides[auth.get_current_plant] = lambda: PLANT
        app.dependency_overrides[auth.get_current_plant_scope] = lambda: {"selected_plant_id": PLANT, "scope_all": False, "allowed_plants": [PLANT]}
        self.audit = patch("src.utils.audit_client.emit_audit_event", lambda **_: None)
        self.audit.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.audit.stop()

    def test_old_style_vendor_without_details_still_saves(self):
        response = self.client.post("/master/suppliers/", json={"supplier_code": "v-old", "name": "Plain Vendor"})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["supplier_code"], "V-OLD")
        self.assertIsNone(body["gst_no"])
        self.assertIsNone(body["full_address"])
        self.assertEqual(body["country"], "India")

    def test_details_save_read_update_and_clear(self):
        payload = {
            "supplier_code": "VEND-GST",
            "name": "Shree Kraft Mills",
            "category": "Raw paper",
            "gst_no": "24abcde1234f1z5",
            "legal_name": "Shree Kraft Mills Private Limited",
            "trade_name": "Shree Kraft",
            "contact_name": "Ramesh Patel",
            "contact_phone": "+91 98250 12345",
            "alt_phone": "079 2583 0000",
            "contact_email": "Sales@ShreeKraft.in",
            "address": "Plot 12, GIDC Estate",
            "address_line2": "Phase 2",
            "city": "Vatva",
            "pin_code": "382445",
            "payment_terms_days": 45,
            "credit_days": 60,
            "credit_limit": 500000,
            "bank_name": "State Bank of India",
            "bank_account_no": "00001234567890",
            "bank_ifsc": "sbin0001234",
            "msme_no": "udyam-gj-01-0012345",
            "notes": "Delivers on Tuesdays",
        }
        created = self.client.post("/master/suppliers/", json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        vendor = created.json()
        self.assertEqual(vendor["gst_no"], "24ABCDE1234F1Z5")
        self.assertEqual(vendor["pan_no"], "ABCDE1234F")  # taken from the GSTIN
        self.assertEqual((vendor["state_code"], vendor["state"]), ("24", "Gujarat"))
        self.assertEqual(vendor["bank_ifsc"], "SBIN0001234")
        self.assertEqual(vendor["msme_no"], "UDYAM-GJ-01-0012345")
        self.assertEqual(vendor["contact_email"], "sales@shreekraft.in")
        self.assertEqual(vendor["full_address"], "Plot 12, GIDC Estate, Phase 2, Vatva, Gujarat - 382445")

        listed = self.client.get("/master/suppliers/", params={"include_inactive": True}).json()
        row = next(item for item in listed if item["id"] == vendor["id"])
        for key in ("legal_name", "trade_name", "alt_phone", "city", "pin_code", "payment_terms_days", "credit_days", "credit_limit", "bank_name", "bank_account_no", "notes"):
            self.assertEqual(row[key], vendor[key], key)
        self.assertEqual(row["credit_limit"], 500000)

        updated = self.client.put(f"/master/suppliers/{vendor['id']}", json={"city": "Ahmedabad", "notes": "", "alt_phone": " "})
        self.assertEqual(updated.status_code, 200, updated.text)
        after = updated.json()
        self.assertEqual(after["city"], "Ahmedabad")
        self.assertIsNone(after["notes"])
        self.assertIsNone(after["alt_phone"])
        self.assertEqual(after["gst_no"], "24ABCDE1234F1Z5")  # untouched fields stay

        cleared = self.client.put(f"/master/suppliers/{vendor['id']}", json={"gst_no": ""})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()["gst_no"])

    def test_bad_formats_are_rejected_with_a_plain_message(self):
        for field, value, word in (
            ("gst_no", "24ABCDE1234F1Z", "GSTIN"),
            ("pan_no", "ABCDE12345", "PAN"),
            ("bank_ifsc", "SBIN1234567", "IFSC"),
            ("pin_code", "012345", "PIN code"),
        ):
            response = self.client.post("/master/suppliers/", json={"supplier_code": f"V-{uuid.uuid4().hex[:6]}", "name": f"Vendor {field}", field: value})
            self.assertEqual(response.status_code, 422, field)
            self.assertIn(word, response.json()["detail"])
        created = self.client.post("/master/suppliers/", json={"supplier_code": "V-OK", "name": "Fine Vendor"}).json()
        bad_update = self.client.put(f"/master/suppliers/{created['id']}", json={"gst_no": "XX"})
        self.assertEqual(bad_update.status_code, 422)
        self.assertIn("GSTIN", bad_update.json()["detail"])

    def test_new_gstin_brings_its_pan_and_state_and_mismatches_are_refused(self):
        created = self.client.post("/master/suppliers/", json={"supplier_code": "V-GSTCHG", "name": "Gst Change Vendor", "gst_no": "24AABCS9999C1Z1"}).json()
        self.assertEqual((created["pan_no"], created["state_code"], created["state"]), ("AABCS9999C", "24", "Gujarat"))
        # The form sends the old PAN and state back unchanged with the new GSTIN: they follow the new GSTIN.
        changed = self.client.put(
            f"/master/suppliers/{created['id']}",
            json={"gst_no": "27AAACR5055K1Z7", "pan_no": "AABCS9999C", "state": "Gujarat", "state_code": "24"},
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        body = changed.json()
        self.assertEqual((body["pan_no"], body["state_code"], body["state"]), ("AAACR5055K", "27", "Maharashtra"))
        # A state name and code that disagree are refused.
        pair = self.client.put(f"/master/suppliers/{created['id']}", json={"state": "Karnataka", "state_code": "27"})
        self.assertEqual(pair.status_code, 422, pair.text)
        self.assertIn("Karnataka has GST state code 29, not 27", pair.json()["detail"])
        # A state that is not the GSTIN's is refused.
        moved = self.client.put(f"/master/suppliers/{created['id']}", json={"state": "Karnataka", "state_code": "29"})
        self.assertEqual(moved.status_code, 422, moved.text)
        self.assertIn("registered in Maharashtra (27), but the state is Karnataka (29)", moved.json()["detail"])
        by_name = self.client.put(f"/master/suppliers/{created['id']}", json={"state": "Karnataka"})
        self.assertEqual(by_name.status_code, 422, by_name.text)
        # A PAN that is not the GSTIN's is refused.
        pan = self.client.put(f"/master/suppliers/{created['id']}", json={"pan_no": "ZZZZZ9999Z"})
        self.assertEqual(pan.status_code, 422, pan.text)
        self.assertIn("does not match GSTIN 27AAACR5055K1Z7", pan.json()["detail"])
        refused = self.client.post("/master/suppliers/", json={"supplier_code": "V-GSTCLASH", "name": "Clash Vendor", "gst_no": "24AABCS9999C1Z1", "state_code": "27"})
        self.assertEqual(refused.status_code, 422, refused.text)
        # A typed state that differs from the old GSTIN's is kept and checked against the new GSTIN.
        typed = self.client.put(f"/master/suppliers/{created['id']}", json={"gst_no": "24AABCS9999C1Z1", "state": "Maharashtra", "state_code": "27"})
        self.assertEqual(typed.status_code, 200, typed.text)  # unchanged state is the old GSTIN's, so it follows
        self.assertEqual((typed.json()["state_code"], typed.json()["pan_no"]), ("24", "AABCS9999C"))
        # Other details still save, and clearing the GSTIN keeps the PAN and state.
        renamed = self.client.put(f"/master/suppliers/{created['id']}", json={"name": "Renamed Vendor", "gst_no": "", "pan_no": "AABCS9999C"})
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertEqual((renamed.json()["gst_no"], renamed.json()["state_code"]), (None, "24"))
        # With no GSTIN, adding one whose state disagrees with a typed state is refused (the form shows it first).
        clash = self.client.put(f"/master/suppliers/{created['id']}", json={"gst_no": "27AAACR5055K1Z7", "pan_no": "AAACR5055K"})
        self.assertEqual(clash.status_code, 422, clash.text)
        self.assertIn("but the state is Gujarat (24)", clash.json()["detail"])


if __name__ == "__main__":
    unittest.main()
