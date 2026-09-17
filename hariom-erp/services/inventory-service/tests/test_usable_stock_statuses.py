from src.services.stock_calc import QC_HELD_STOCK_STATUSES, USABLE_STOCK_STATUSES


def test_usable_and_qc_held_statuses_stay_disjoint():
    assert "UNRESTRICTED" in USABLE_STOCK_STATUSES
    assert "QC_HOLD" not in USABLE_STOCK_STATUSES
    assert "QC_HOLD" in QC_HELD_STOCK_STATUSES
    assert not (USABLE_STOCK_STATUSES & QC_HELD_STOCK_STATUSES)
