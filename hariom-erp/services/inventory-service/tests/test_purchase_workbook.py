from src.services.purchase_workbook import preview_workbook, resolve_po_issuer, source_fingerprint


def _sep_rows():
    return [
        {
            "date": "2026-04-04",
            "vendor": "VATSALYA",
            "item_code": "KRAFT",
            "qty": 12,
            "unit": "KG",
            "pending": None,
            "record_type": "PLANNING",
        },
        {
            "date": "2026-09-02",
            "vendor": "AMIGO",
            "item_code": "KRAFT",
            "qty": 1,
            "unit": "300,000",
            "pending": "",
            "record_type": "PLANNING",
        },
        {
            "date": "2026-09-10",
            "vendor": "Verify Mills",
            "item_code": "KRAFT",
            "qty": 20,
            "unit": "KG",
            "pending": 20,
            "record_type": "PO_COMMITMENT",
            "item_id": "00000000-0000-0000-0000-00000000aa01",
            "supplier_id": "00000000-0000-0000-0000-00000000bb01",
            "unit_cost": 10,
        },
    ]


def test_pur06_sep_preview_flags_april_blank_pending_and_unknown_unit_without_stock():
    preview = preview_workbook(sheet_name="SEP 2026", rows=_sep_rows())
    assert preview["would_post_stock"] is False
    assert preview["ledger"] is False
    codes = set(preview["flag_codes"])
    assert {"DATE_SHEET_MISMATCH", "BLANK_PENDING", "UNKNOWN_UNIT"} <= codes
    april = preview["rows"][0]
    assert april["pending_blank"] is True
    assert april["pending_treated_as_zero"] is False
    assert april["would_post_stock"] is False
    assert april["would_create_po"] is False
    unknown = preview["rows"][1]
    assert "UNKNOWN_UNIT" in unknown["flags"]
    assert unknown["would_create_po"] is False
    commitment = preview["rows"][2]
    assert commitment["would_create_po"] is True
    assert commitment["would_post_stock"] is False


def test_pur07_fingerprint_is_stable_for_the_same_source_rows():
    first = source_fingerprint("PLANT_A", "SEP 2026", _sep_rows())
    second = source_fingerprint("PLANT_A", "SEP 2026", _sep_rows())
    changed = source_fingerprint("PLANT_A", "SEP 2026", _sep_rows() + [{"date": "2026-09-11", "record_type": "PLANNING"}])
    assert first == second
    assert first != changed


def test_pur08_unresolved_issuer_is_not_hari_om():
    unresolved = resolve_po_issuer({})
    assert unresolved["issuer_status"] == "UNRESOLVED"
    assert unresolved["print_blocked"] is True
    assert unresolved["issuer_name"] is None
    confirmed = resolve_po_issuer({"legal_entity": "AMIGO INDUSTRIES UNIT-II"})
    assert confirmed["issuer_name"] == "AMIGO INDUSTRIES UNIT-II"
    assert confirmed["issuer_status"] == "CONFIRMED"
    assert confirmed["hardcoded_hari_om"] is False
