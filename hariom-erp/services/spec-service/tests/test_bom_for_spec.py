from src.routers.calculations import _midpoint


def test_spec_tube_midpoint_does_not_invent_a_length():
    assert _midpoint(120, 140) == 130
    assert _midpoint(None, None) == 0.0
    assert _midpoint(150, None) == 150
