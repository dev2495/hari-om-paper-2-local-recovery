"""Customer master details for the delivery challan (client 2026-10-28).

GSTIN, billing address and dispatch (ship-to) address with state and PIN code, all editable.
The challan reads them from the master. API round trip on an in-memory database.
"""

import unittest
import uuid
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src import models
from src.database import get_db
from src.routers import customer as customer_router
from src.utils import auth

PLANT = "00000000-0000-0000-0000-0000000000a1"


@compiles(PG_UUID, "sqlite")
def _uuid_on_sqlite(_type, _compiler, **_kw):  # the API test runs on in-memory SQLite
    return "CHAR(36)"


class PlaceHelperTests(unittest.TestCase):
    def test_place_line_joins_street_lines_city_state_and_pin(self):
        self.assertEqual(
            customer_router._place_line("Plot 4, GIDC\nPhase 2", "Vapi", "Gujarat", "396195"),
            "Plot 4, GIDC, Phase 2, Vapi, Gujarat - 396195",
        )
        self.assertEqual(customer_router._place_line(None, None, None, "396195"), "396195")
        self.assertIsNone(customer_router._place_line("  ", None, "", None))

    def test_gstin_fills_pan_and_billing_state_but_never_overwrites(self):
        row = models.Customer(gst_no="27AAPFU0939F1ZV")
        customer_router._fill_places(row)
        self.assertEqual((row.pan_no, row.billing_state_code, row.billing_state), ("AAPFU0939F", "27", "Maharashtra"))
        typed = models.Customer(gst_no="27AAPFU0939F1ZV", pan_no="ZZZZZ9999Z", billing_state_code="24")
        customer_router._fill_places(typed)
        self.assertEqual((typed.pan_no, typed.billing_state_code, typed.billing_state), ("ZZZZZ9999Z", "24", "Gujarat"))
        by_name = models.Customer(shipping_state="dadra and nagar haveli and daman and diu")
        customer_router._fill_places(by_name)
        self.assertEqual(by_name.shipping_state_code, "26")


class CustomerApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        models.Customer.__table__.create(engine)
        models.CustomerContact.__table__.create(engine)
        Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        self.Session = Session

        def db():
            session = Session()
            try:
                yield session
            finally:
                session.close()

        app = FastAPI()
        app.include_router(customer_router.router)
        app.dependency_overrides[get_db] = db
        app.dependency_overrides[auth.get_current_user] = lambda: {"sub": "owner@test", "roles": ["Owner"], "token": ""}
        app.dependency_overrides[auth.get_current_plant] = lambda: PLANT
        app.dependency_overrides[auth.get_current_plant_scope] = lambda: {"selected_plant_id": PLANT, "scope_all": False, "allowed_plants": [PLANT]}
        self.audit = patch("src.utils.audit_client.emit_audit_event", lambda **_: None)
        self.audit.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.audit.stop()

    def test_old_style_customer_with_one_address_still_works(self):
        response = self.client.post("/master/customers/", json={"customer_code": "c-old", "name": "Plain Customer", "address": "Ring Road, Surat"})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["customer_code"], "C-OLD")
        self.assertEqual(body["billing_address"], "Ring Road, Surat")
        self.assertEqual(body["shipping_full_address"], "Ring Road, Surat")
        self.assertIsNone(body["gst_no"])

    def test_billing_and_dispatch_addresses_save_read_update_and_clear(self):
        payload = {
            "customer_code": "WB-RIL",
            "name": "Reliance Industries Limited [Silvassa]",
            "gst_no": " 26aaacr5055k1zs ",
            "address": "Survey 342, Khadoli Road",
            "billing_address": "Survey 342, Khadoli Road",
            "billing_city": "Silvassa",
            "billing_pin_code": "396230",
            "shipping_address": "Gate 3, Stores\nKhadoli Village",
            "shipping_city": "Silvassa",
            "shipping_state_code": "26",
            "shipping_pin_code": "396230",
            "primary_contact_name": "Mehul Shah",
            "primary_contact_phone": "+91 98250 11111",
            "primary_contact_email": "Stores@RIL.com",
            "dispatch_contact_name": "Gate stores",
            "dispatch_contact_phone": "0260 2640000",
        }
        created = self.client.post("/master/customers/", json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        row = created.json()
        self.assertEqual(row["gst_no"], "26AAACR5055K1ZS")
        self.assertEqual(row["tax_id"], "26AAACR5055K1ZS")
        self.assertEqual(row["pan_no"], "AAACR5055K")  # taken from the GSTIN
        self.assertEqual((row["billing_state_code"], row["billing_state"]), ("26", "Dadra and Nagar Haveli and Daman and Diu"))
        self.assertEqual(row["shipping_state"], "Dadra and Nagar Haveli and Daman and Diu")
        self.assertEqual(row["primary_contact_email"], "stores@ril.com")
        self.assertEqual(row["billing_full_address"], "Survey 342, Khadoli Road, Silvassa, Dadra and Nagar Haveli and Daman and Diu - 396230")
        self.assertEqual(row["shipping_full_address"], "Gate 3, Stores, Khadoli Village, Silvassa, Dadra and Nagar Haveli and Daman and Diu - 396230")

        listed = self.client.get("/master/customers/", params={"include_inactive": True}).json()
        same = next(item for item in listed if item["id"] == row["id"])
        for key in ("billing_city", "billing_pin_code", "shipping_city", "shipping_state_code", "shipping_pin_code", "shipping_full_address", "dispatch_contact_phone"):
            self.assertEqual(same[key], row[key], key)

        # Edit: move the dispatch place and clear the separate ship-to address.
        moved = self.client.put(f"/master/customers/{row['id']}", json={"shipping_state_code": "24", "shipping_city": "Vapi", "shipping_pin_code": "396195"})
        self.assertEqual(moved.status_code, 200, moved.text)
        after = moved.json()
        self.assertEqual((after["shipping_state_code"], after["shipping_state"]), ("24", "Gujarat"))
        self.assertEqual(after["gst_no"], "26AAACR5055K1ZS")  # untouched fields stay
        self.assertTrue(after["shipping_full_address"].endswith("Vapi, Gujarat - 396195"))

        cleared = self.client.put(
            f"/master/customers/{row['id']}",
            json={"shipping_address": "", "shipping_city": "", "shipping_state_code": "", "shipping_state": "", "shipping_pin_code": "", "gst_no": ""},
        )
        self.assertEqual(cleared.status_code, 200, cleared.text)
        body = cleared.json()
        self.assertIsNone(body["gst_no"])
        self.assertIsNone(body["shipping_pin_code"])
        # No separate ship-to address any more: the challan dispatches to the billing address.
        self.assertEqual(body["shipping_full_address"], body["billing_full_address"])

    def test_bad_formats_are_rejected_with_a_plain_message(self):
        for field, value, word in (
            ("gst_no", "26AAACR5055K1Z", "GSTIN"),
            ("pan_no", "ABCDE12345", "PAN"),
            ("billing_pin_code", "012345", "Billing PIN code"),
            ("shipping_pin_code", "3961", "Dispatch PIN code"),
            ("shipping_state_code", "25", "Dispatch state code"),
            ("primary_contact_phone", "call me", "Phone"),
            ("primary_contact_email", "stores.ril.com", "Email"),
        ):
            response = self.client.post("/master/customers/", json={"customer_code": f"C-{uuid.uuid4().hex[:6]}", "name": f"Customer {field}", field: value})
            self.assertEqual(response.status_code, 422, field)
            self.assertIn(word, response.json()["detail"], field)
        created = self.client.post("/master/customers/", json={"customer_code": "C-OK", "name": "Fine Customer"}).json()
        bad_update = self.client.put(f"/master/customers/{created['id']}", json={"gst_no": "XX"})
        self.assertEqual(bad_update.status_code, 422)
        self.assertIn("GSTIN", bad_update.json()["detail"])

    def test_billing_state_must_be_the_gstin_state_and_pairs_must_agree(self):
        created = self.client.post("/master/customers/", json={"customer_code": "ZZ-ST", "name": "State Check", "gst_no": "27AAACR5055K1ZS"}).json()
        self.assertEqual((created["billing_state_code"], created["billing_state"]), ("27", "Maharashtra"))
        # A GSTIN is registered in one state: a billing state elsewhere is refused in plain words.
        moved = self.client.put(f"/master/customers/{created['id']}", json={"billing_state": "Karnataka", "billing_state_code": "29", "billing_city": "Bengaluru"})
        self.assertEqual(moved.status_code, 422, moved.text)
        self.assertIn("registered in Maharashtra (27), but the billing state is Karnataka (29)", moved.json()["detail"])
        by_name = self.client.put(f"/master/customers/{created['id']}", json={"billing_state": "Karnataka"})
        self.assertEqual(by_name.status_code, 422, by_name.text)
        clash = self.client.put(f"/master/customers/{created['id']}", json={"billing_state": "Karnataka", "billing_state_code": "24"})
        self.assertEqual(clash.status_code, 422)
        self.assertIn("Karnataka has GST state code 29, not 24", clash.json()["detail"])
        refused = self.client.post("/master/customers/", json={"customer_code": "ZZ-ST2", "name": "State Clash", "gst_no": "24AAACC4175D1Z4", "billing_state_code": "29"})
        self.assertEqual(refused.status_code, 422, refused.text)
        # Without a GSTIN any billing state is fine, and the ship-to address may be in another state.
        plain = self.client.post("/master/customers/", json={"customer_code": "ZZ-ST3", "name": "No Gst", "billing_state_code": "29"})
        self.assertEqual(plain.status_code, 200, plain.text)
        ship = self.client.put(f"/master/customers/{created['id']}", json={"shipping_address": "Gate 2", "shipping_state_code": "29", "shipping_state": "Karnataka"})
        self.assertEqual(ship.status_code, 200, ship.text)
        # Other edits still save on an old row whose state already disagrees, as long as neither is touched.
        with self.Session() as db:
            row = db.get(models.Customer, uuid.UUID(created["id"]))
            row.billing_state, row.billing_state_code = "Goa", "30"
            db.commit()
        renamed = self.client.put(f"/master/customers/{created['id']}", json={"name": "State Check Renamed", "billing_state": "Goa", "billing_state_code": "30"})
        self.assertEqual(renamed.status_code, 200, renamed.text)

    def test_dispatch_address_needs_a_street_not_only_a_state_or_city(self):
        # The GSTIN fills the billing state by itself; that is not an address goods can be sent to.
        gst_only = self.client.post("/master/customers/", json={"customer_code": "ZZ-GSTONLY", "name": "Gst Only", "gst_no": "24AAACC4175D1Z4"}).json()
        self.assertEqual(gst_only["billing_state"], "Gujarat")
        self.assertEqual(gst_only["billing_full_address"], "Gujarat")
        self.assertIsNone(gst_only["shipping_full_address"])
        city_only = self.client.post("/master/customers/", json={"customer_code": "ZZ-CITY", "name": "City Only", "billing_city": "Surat"}).json()
        self.assertIsNone(city_only["shipping_full_address"])
        # A separate ship-to place without a street does not fall back to the billing street.
        ship_place = self.client.put(f"/master/customers/{gst_only['id']}", json={"billing_address": "Plot 7, GIDC", "shipping_city": "Vapi", "shipping_state_code": "24"}).json()
        self.assertEqual(ship_place["billing_full_address"], "Plot 7, GIDC, Gujarat")
        self.assertIsNone(ship_place["shipping_full_address"])
        same = self.client.put(f"/master/customers/{gst_only['id']}", json={"shipping_city": None, "shipping_state_code": None, "shipping_state": None}).json()
        self.assertEqual(same["shipping_full_address"], "Plot 7, GIDC, Gujarat")
        blank_lines = self.client.put(f"/master/customers/{city_only['id']}", json={"billing_address": "  \n  "}).json()
        self.assertIsNone(blank_lines["shipping_full_address"])

    def test_new_gstin_brings_its_pan_and_state_and_a_wrong_pan_is_refused(self):
        created = self.client.post("/master/customers/", json={"customer_code": "ZZ-GST", "name": "Gst Change", "gst_no": "27AAACR5055K1ZS"}).json()
        self.assertEqual(created["pan_no"], "AAACR5055K")
        # The form sends the old PAN and state back unchanged with the new GSTIN.
        changed = self.client.put(
            f"/master/customers/{created['id']}",
            json={"gst_no": "24AABCS1429B1Z6", "pan_no": "AAACR5055K", "billing_state": "Maharashtra", "billing_state_code": "27"},
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        body = changed.json()
        self.assertEqual((body["pan_no"], body["billing_state_code"], body["billing_state"]), ("AABCS1429B", "24", "Gujarat"))
        wrong = self.client.put(f"/master/customers/{created['id']}", json={"pan_no": "ABCDE1234F"})
        self.assertEqual(wrong.status_code, 422)
        self.assertIn("does not match GSTIN 24AABCS1429B1Z6", wrong.json()["detail"])
        refused = self.client.post("/master/customers/", json={"customer_code": "ZZ-GST2", "name": "Gst Clash", "gst_no": "24AABCS1429B1Z6", "pan_no": "ABCDE1234F"})
        self.assertEqual(refused.status_code, 422)
        # A typed billing state is kept when the GSTIN changes in the same request, so it must be the GSTIN's state.
        typed = self.client.put(
            f"/master/customers/{created['id']}",
            json={"gst_no": "27AAACR5055K1ZS", "billing_state": "Goa", "billing_state_code": "30"},
        )
        self.assertEqual(typed.status_code, 422, typed.text)
        self.assertIn("billing state is Goa (30)", typed.json()["detail"])
        typed_ok = self.client.put(
            f"/master/customers/{created['id']}",
            json={"gst_no": "27AAACR5055K1ZS", "billing_state": "Maharashtra", "billing_state_code": "27"},
        )
        self.assertEqual(typed_ok.status_code, 200, typed_ok.text)
        self.assertEqual((typed_ok.json()["pan_no"], typed_ok.json()["billing_state_code"]), ("AAACR5055K", "27"))


if __name__ == "__main__":
    unittest.main()
