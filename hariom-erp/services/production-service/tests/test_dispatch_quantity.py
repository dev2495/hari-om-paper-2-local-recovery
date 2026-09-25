from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from src.routers.dispatch import _dispatch_qty

job=SimpleNamespace(released_qty=64,planned_qty=64)
packing=SimpleNamespace(total_packed_qty=64)


def test_partial_challan_posts_only_the_pieces_shown_in_the_ui():
    assert _dispatch_qty({'items':[{'qty_units':2,'pcs_per_unit':16,'total_pcs':32}]},job,packing)==32
    assert _dispatch_qty({'summary':{'total_pcs':32}},job,packing)==32


def test_explicit_zero_is_not_replaced_with_full_packed_quantity():
    assert _dispatch_qty({'qty':0},job,packing)==0
    assert _dispatch_qty({'items':[{'total_pcs':0}]},job,packing)==0


@pytest.mark.parametrize('value',[float('nan'),float('inf'),-1,'not a number',None])
def test_invalid_dispatch_quantity_cannot_fall_back_to_full_order(value):
    with pytest.raises(HTTPException):
        _dispatch_qty({'items':[{'total_pcs':value}]},job,packing)
