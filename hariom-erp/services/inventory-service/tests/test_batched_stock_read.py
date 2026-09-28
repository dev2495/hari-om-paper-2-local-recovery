"""Match batched planning balances to ledger helpers, with bounded SQL."""
import os
import pytest
from sqlalchemy import event
if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Isolated procurement database required", allow_module_level=True)
from src.database import SessionLocal
from src.services.stock_calc import get_all_items_balance, get_item_balance, get_reserved_qty, get_usable_item_qty, get_qc_held_item_qty, get_batch_weighted_cost


def test_catalog_balances_match_original_helpers_without_n_plus_one():
    with SessionLocal() as db:
        calls=[]
        def count(*args): calls.append(args[2])
        connection=db.connection()
        event.listen(connection, "before_cursor_execute", count)
        try: rows=get_all_items_balance(db)
        finally: event.remove(connection, "before_cursor_execute", count)
        assert rows, "Run after procurement fixtures populate the isolated database"
        assert len(calls) <= 6
        for row in rows:
            item=row["item_id"]
            assert row["balance"] == round(get_item_balance(item,db),2)
            assert row["reserved_qty"] == round(get_reserved_qty(db,item_id=item),2)
            assert row["usable_qty"] == get_usable_item_qty(item,db)
            assert row["qc_held_qty"] == get_qc_held_item_qty(item,db)
            cost,source=get_batch_weighted_cost(item,db)
            if cost>0:
                assert row["unit_cost"] == round(cost,4)
                assert row["cost_source"] == source
