"""Client round 28 Oct 2026 (sales): delivery date optional everywhere; parchment compulsory at release."""
import unittest
import uuid
from datetime import date
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from src.routers import planning
from src.routers.planning import _job_due_date, _order_due_date, _snapshot_due_date


class NoDateTests(unittest.TestCase):
    def test_card_released_without_a_date_has_no_date_even_with_a_local_order_placeholder(self):
        local_order = SimpleNamespace(due_date=date(2026, 10, 28))
        card = SimpleNamespace(spec_snapshot={"sales_order_line_due_date": ""})
        self.assertIsNone(_job_due_date(card, local_order))

    def test_card_with_a_date_keeps_it(self):
        card = SimpleNamespace(spec_snapshot={"sales_order_line_due_date": "2026-11-09"})
        self.assertEqual(_job_due_date(card, None), date(2026, 11, 9))

    def test_old_card_without_the_snapshot_key_falls_back_to_the_order(self):
        local_order = SimpleNamespace(due_date=date(2026, 11, 1))
        self.assertEqual(_snapshot_due_date({}, local_order), date(2026, 11, 1))

    def test_lines_without_a_date_do_not_pull_the_order_due_date_to_today(self):
        order = {"lines": [{"due_date": None}, {"due_date": "2026-12-05"}]}
        self.assertEqual(_order_due_date(order), date(2026, 12, 5))


class ParchmentAtReleaseTests(unittest.TestCase):
    def _sync(self, row_colour, lot_colour, existing_card=None):
        order_id, line_id, lot_id = uuid.uuid4(), str(uuid.uuid4()), uuid.uuid4()
        live = {"id": str(order_id), "status": "released", "lines": [
            {"id": line_id, "line_no": 1, "release_lots": [{"id": str(lot_id), "release_lot_id": str(lot_id), "parchment_color": lot_colour}]}]}
        payload = planning.ReleaseSyncPayload(release_rows=[{
            "release_lot_id": lot_id, "sales_order_line_id": line_id, "release_qty": 100,
            "winder_machine_id": uuid.uuid4(), "parchment_color": row_colour}])
        db = mock.MagicMock()
        db.query.return_value.filter.return_value.first.return_value = existing_card
        with mock.patch.object(planning, "_fetch_sales_order", return_value=live), \
                mock.patch.object(planning, "_create_or_sync_job_card_for_line", side_effect=RuntimeError("reached card creation")):
            return planning.sync_released_sales_order(order_id, payload, db=db, plant_id=str(uuid.uuid4()), current_user={"token": ""})

    def test_new_card_without_any_colour_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self._sync(None, None)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("no parchment colour", caught.exception.detail)

    def test_colour_on_the_lot_is_enough(self):
        with self.assertRaisesRegex(RuntimeError, "reached card creation"):
            self._sync(None, "RED")

    def test_replay_of_an_existing_card_is_not_refused(self):
        with self.assertRaisesRegex(RuntimeError, "reached card creation"):
            self._sync(None, None, existing_card=SimpleNamespace(id=uuid.uuid4()))


if __name__ == "__main__":
    unittest.main()


class CustomerPoOnCardsTests(unittest.TestCase):
    """The one-time PO change / internal-order confirmation reaches the cards (checker 28 Oct)."""

    def _run(self, cards, live):
        db = mock.MagicMock()
        db.query.return_value.filter.return_value.all.return_value = cards
        with mock.patch.object(planning, "_fetch_sales_order", return_value=live):
            result = planning.sync_sales_order_customer_po(uuid.uuid4(), db=db, plant_id=str(uuid.uuid4()), current_user={"token": ""})
        return result, db

    def test_cards_take_the_order_po_from_sales(self):
        stale = SimpleNamespace(id=uuid.uuid4(), job_card_no="26/10/84", spec_snapshot={"sales_order_po_number": None, "keep": 1})
        result, db = self._run([stale], {"po_number": " R28-CUST-PO-1 ", "po_date": "2026-10-28"})
        self.assertEqual(stale.spec_snapshot["sales_order_po_number"], "R28-CUST-PO-1")
        self.assertEqual(stale.spec_snapshot["sales_order_po_date"], "2026-10-28")
        self.assertEqual(stale.spec_snapshot["keep"], 1)
        self.assertEqual(result["updated"], ["26/10/84"])
        db.commit.assert_called_once()

    def test_cards_already_up_to_date_are_left_alone(self):
        snapshot = {"sales_order_po_number": "PO-1", "sales_order_po_date": "2026-10-20"}
        card = SimpleNamespace(id=uuid.uuid4(), job_card_no="26/10/90", spec_snapshot=snapshot)
        result, _ = self._run([card], {"po_number": "PO-1", "po_date": "2026-10-20"})
        self.assertIs(card.spec_snapshot, snapshot)
        self.assertEqual(result["updated"], [])


class ParchmentColourIsRealTests(unittest.TestCase):
    """A placeholder word or a colour other than the released lot's never becomes a card colour (checker 30 Oct)."""

    def _card(self, row_colour, lot_colour):
        lot_id = uuid.uuid4()
        line = {"id": str(uuid.uuid4()), "approved_spec_id": str(uuid.uuid4()),
                "release_lots": [{"id": str(lot_id), "release_lot_id": str(lot_id), "parchment_color": lot_colour}]}
        db = mock.MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        with mock.patch.object(planning, "_sync_local_sales_order", side_effect=RuntimeError("reached order sync")):
            return planning._create_or_sync_job_card_for_line(
                db=db, plant_uuid=uuid.uuid4(), live_order={}, line=line, release_lot_id=lot_id,
                winder_machine_id=uuid.uuid4(), planned_qty=100, priority="normal", product_code=None,
                token="", plant_id="p", current_user={}, parchment_color=row_colour)

    def test_placeholder_words_are_not_colours(self):
        for word in ("None", " no parchment ", "-", "—", "N/A", "Multiple colors"):
            self.assertTrue(planning._is_placeholder_parchment(word), word)
        for real in ("RED", "Natural · Stripe", "RED / SAGAR POLYFILMS", ""):
            self.assertFalse(planning._is_placeholder_parchment(real), real)

    def test_a_none_lot_colour_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self._card(None, "None")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("is not a parchment colour", caught.exception.detail)

    def test_a_request_colour_other_than_the_lot_colour_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self._card("NOT-A-REAL-COLOUR", "RED")
        self.assertIn("not the colour released on the order", caught.exception.detail)

    def test_the_lot_colour_goes_through(self):
        with self.assertRaisesRegex(RuntimeError, "reached order sync"):
            self._card("red", "RED")


class LegacyLotAndMasterColourTests(unittest.TestCase):
    """A lot saved before 28 Oct with no colour, or a colour not in the master, never makes a card (checker 30 Oct)."""

    def test_a_colour_sent_only_in_the_sync_request_is_refused_for_a_colourless_lot(self):
        with self.assertRaises(HTTPException) as caught:
            ParchmentAtReleaseTests._sync(self, "CHECKER4 NOT A MASTER COLOUR", None)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("saved before the parchment colour became compulsory", caught.exception.detail)
        self.assertIn("Release lines", caught.exception.detail)

    def test_card_creation_refuses_a_colourless_lot_even_with_a_request_colour(self):
        with self.assertRaises(HTTPException) as caught:
            ParchmentColourIsRealTests._card(self, "PURPLE-RAIN", None)
        self.assertIn("no parchment colour", caught.exception.detail)

    def _master(self, colour, colour_id=None):
        class Response:
            def __init__(self, body):
                self.status_code, self._body = 200, body

            def json(self):
                return self._body

        red_id = "de3af734-94c2-4c85-9849-b0a3aba6f09d"
        vendor_id = str(uuid.uuid4())
        bodies = {
            "colors": [{"id": red_id, "color_name": "RED", "vendor_id": vendor_id, "active": True},
                       {"id": str(uuid.uuid4()), "color_name": "OLD BLUE", "vendor_id": vendor_id, "active": False}],
            "vendors": [{"id": vendor_id, "name": "SAGAR POLYFILMS"}],
        }
        client = mock.MagicMock()
        client.__enter__.return_value.get.side_effect = lambda url, headers=None: Response(bodies["colors" if url.endswith("/colors") else "vendors"])
        with mock.patch.object(planning.httpx, "Client", return_value=client):
            return planning._check_parchment_master(colour, colour_id, "token", "plant", {"line_no": 2})

    def test_master_colour_by_label_name_or_id_passes(self):
        self.assertIsNone(self._master("RED / SAGAR POLYFILMS"))
        self.assertIsNone(self._master("red"))
        self.assertIsNone(self._master("Anything", "de3af734-94c2-4c85-9849-b0a3aba6f09d"))

    def test_made_up_or_inactive_colour_is_refused(self):
        for colour in ("PURPLE-RAIN", "OLD BLUE"):
            with self.assertRaises(HTTPException) as caught:
                self._master(colour)
            self.assertEqual(caught.exception.status_code, 400)
            self.assertIn("not in the active parchment colour list", caught.exception.detail)
            self.assertIn("Line 2", caught.exception.detail)
