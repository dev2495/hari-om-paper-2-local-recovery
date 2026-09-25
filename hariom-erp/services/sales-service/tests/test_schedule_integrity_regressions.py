from datetime import date
from types import SimpleNamespace
import uuid

import pytest

from src.schedule_policy import SchedulePolicyError, merge_line_schedules, propose_entire_po_rows


def line(**values):
    return SimpleNamespace(**{**dict(id=uuid.uuid4(), qty=100, fulfilled_qty=0, delivery_schedules=[], due_date=date(2026, 10, 1)), **values})


@pytest.mark.parametrize('quantity', [float('nan'), float('inf'), float('-inf'), 'NaN', 'invalid'])
def test_nonfinite_schedule_quantity_cannot_pass_conservation(quantity):
    with pytest.raises(SchedulePolicyError, match='finite'):
        merge_line_schedules(line=line(), existing=[], proposed=[dict(quantity=quantity, delivery_date=date(2026, 10, 1))])


def test_existing_row_id_cannot_fake_fulfillment():
    row = dict(id=str(uuid.uuid4()), quantity=20, status='committed', delivery_date=date(2026, 10, 1))
    with pytest.raises(SchedulePolicyError) as error:
        merge_line_schedules(line=line(), existing=[row], proposed=[{**row, 'status': 'delivered'}])
    assert error.value.code == 'INVALID_STATUS'


def test_row_from_another_line_cannot_be_reassigned():
    with pytest.raises(SchedulePolicyError) as error:
        merge_line_schedules(line=line(), existing=[], proposed=[dict(id=str(uuid.uuid4()), quantity=20, delivery_date=date(2026, 10, 1))])
    assert error.value.code == 'UNKNOWN_SCHEDULE_ROW'


def test_unknown_split_line_is_not_silently_ignored():
    with pytest.raises(SchedulePolicyError) as error:
        propose_entire_po_rows([line()], line_splits={str(uuid.uuid4()): [dict(quantity=20, delivery_date=date(2026, 10, 1))]})
    assert error.value.code == 'UNKNOWN_LINE'


def test_duplicate_row_cannot_bypass_actual_persisted_quantity():
    row = dict(id=str(uuid.uuid4()), quantity=20, status='committed', delivery_date=date(2026, 10, 1))
    with pytest.raises(SchedulePolicyError) as error:
        merge_line_schedules(line=line(), existing=[row], proposed=[row, row])
    assert error.value.code == 'DUPLICATE_SCHEDULE_ROW'
