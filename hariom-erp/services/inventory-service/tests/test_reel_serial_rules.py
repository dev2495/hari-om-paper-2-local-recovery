"""The plant's AIT reel serial and its reel label layout (owner decision 6, 1 Nov 2026): rules without a database."""
import uuid
from datetime import date
from types import SimpleNamespace

from src.services.labels import label_day, reel_label_facts
from src.services.procurement_documents import build_lot_label_pdf
from src.services.reel_serial import child_serial, coil_serial, financial_year, normal_serial, serial_text, year_label


def test_serial_is_ait_space_five_digits():
    assert serial_text(6243) == "AIT 06243"
    assert serial_text(1) == "AIT 00001"
    assert coil_serial("AIT 06243", 2) == "AIT 06243-2"


def test_financial_year_restarts_on_1_april():
    assert financial_year(date(2027, 3, 31)) == 2026
    assert financial_year(date(2027, 4, 1)) == 2027
    assert year_label(2026) == "2026-27"


def test_a_typed_serial_reads_as_printed():
    for typed in ("AIT 06243", "ait6243", "AIT-06243", " Ait 6243 ", "AIT/06243"):
        assert normal_serial(typed) == "AIT 06243", typed
    assert normal_serial("ait 6243 - 2") == "AIT 06243-2"
    assert normal_serial("AT-261030-004") is None
    assert normal_serial("6243") is None


def test_coils_take_the_parent_serial_plus_their_place():
    reel = SimpleNamespace(reel_code="AIT 06243", inward_metadata={"amigo_no": "AIT 06243"})
    assert child_serial(None, reel, 1) == {"serial": "AIT 06243-1", "reel_code": "AIT 06243-1"}
    # A later year's reel whose plain number was taken keeps its unique reel_code; the coil prints the serial.
    later = SimpleNamespace(reel_code="AIT 00001/27-28", inward_metadata={"amigo_no": "AIT 00001"})
    assert child_serial(None, later, 3) == {"serial": "AIT 00001-3", "reel_code": "AIT 00001/27-28-3"}
    # An older AT reel's coils follow the same pattern.
    old = SimpleNamespace(reel_code="AT-261030-004", inward_metadata={})
    assert child_serial(None, old, 2)["serial"] == "AT-261030-004-2"


def test_label_date_is_day_month_two_digit_year():
    assert label_day(date(2026, 10, 28)) == "28-Oct-26"
    assert label_day("2026-08-24") == "24-Aug-26"
    assert label_day("") == ""


def _reel(**overrides):
    values = dict(
        id=uuid.uuid4(), reel_code="AIT 06243", parent_reel_id=None, supplier_id=uuid.uuid4(),
        supplier_name="Akshat Paper Mills Pvt Ltd", supplier_name_snapshot="Akshat Paper Mills Pvt Ltd",
        inward_weight_kg=1161.0, net_weight_kg=1161.0, inward_date=date(2026, 10, 28), source_reel_no="65686",
        physical_form="REEL", gsm=350.0, bf=20.0,
        inward_metadata={"amigo_no": "AIT 06243", "mill_name": "AKSHAT", "invoice_no": "2525",
                         "paper_master_snapshot": {"ply_bond": 400}},
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_label_lines_are_the_plant_layout_and_nothing_more():
    item = SimpleNamespace(item_code="351", name="Kraft 350 GSM", qc_nominals={"gsm": 350, "ply_bond": 400})
    facts = reel_label_facts(None, _reel(), item)["facts"]
    assert facts["serial"] == "AIT 06243"
    assert (facts["mill"], facts["invoice_no"], facts["received_date"]) == ("AKSHAT", "2525", "28-Oct-26")
    # GSM prints the variety (paper code) when incoming QC has not measured it, as the plant's label does.
    assert (facts["plybond"], facts["variety"], facts["gsm"]) == ("400", "351", "351")
    assert (facts["roll_no"], facts["weight_kg"]) == ("65686", "1161")
    assert not any("(spec)" in value for value in facts.values())
    assert {"bf", "width_mm", "item", "reel_no"}.isdisjoint(facts)


def test_a_challan_only_receipt_prints_the_challan_number_and_old_reels_have_no_mill():
    reel = _reel(inward_metadata={"amigo_no": "AIT 06244", "challan_no": "VPI/1686/2026-27"})
    facts = reel_label_facts(None, reel, SimpleNamespace(item_code="301", name="Kraft 300", qc_nominals={}))["facts"]
    assert facts["invoice_no"] == "VPI/1686/2026-27"
    assert facts["mill"] == "" and facts["vendor"] == "Akshat Paper Mills Pvt Ltd"
    assert facts["plybond"] == ""  # nobody gave a polybond: blank, never 0


def test_pdf_label_prints_the_plant_rows_and_no_old_words(monkeypatch):
    from reportlab import rl_config

    monkeypatch.setattr(rl_config, "pageCompression", 0)  # page text readable in the bytes
    item = SimpleNamespace(item_code="351", name="Kraft", qc_nominals={})
    reel = _reel()
    label = {"entity_type": "REEL", "qr_value": f"HARIOM|REEL|p|{reel.id}|AIT 06243", "metadata": {}, "grn_no": "P/26/001",
             "po_no": "PO-1", **reel_label_facts(None, reel, item)}
    for profile in ("PAPER_LOT_A4", "PAPER_LOT_4X2"):
        pdf = build_lot_label_pdf([label], 1, profile, heading="AMIGO INDUSTRIES UNIT II")
        assert pdf.startswith(b"%PDF")
        for words in (b"AMIGO INDUSTRIES UNIT II", b"AIT 06243", b"PLYBOND", b"VARIETY", b"ROLL NO.", b"WEIGHT", b"AKSHAT", b"28-Oct-26"):
            assert words in pdf, (profile, words)
        for words in (b"Vendor", b"Received", b"GRN", b"QC status", b"(spec)"):
            assert words not in pdf, (profile, words)
