from types import SimpleNamespace
from math import pi
import pytest
from src import calculators


def fixture_recipe(monkeypatch):
    spec = SimpleNamespace(id='spec', id_min_mm=125, id_max_mm=125,
        od_min_mm=137, od_max_mm=137, length_min_mm=120.5, length_max_mm=120.5,
        target_tube_weight=92, adhesive_percent=12.5, parchment_percent=1.5,
        moisture_loss_percent=9, parchment_allowed=True, parchment_color=None,
        adhesive_20100_percent=0, adhesive_30100_percent=0)
    layers=[SimpleNamespace(ply_no=1,paper_id='paper-a',gsm_snapshot=250,bf_snapshot=18,bulk_snapshot=1.4),
            SimpleNamespace(ply_no=2,paper_id='paper-b',gsm_snapshot=300,bf_snapshot=18,bulk_snapshot=1.4)]
    recipe=SimpleNamespace(id='recipe',specification=spec,layers=layers)
    monkeypatch.setattr(calculators,'_get_recipe',lambda *args:recipe)
    monkeypatch.setattr(calculators,'_get_spec',lambda *args:spec)
    return spec


def test_bom_uses_spec_geometry_and_preserves_fractional_length(monkeypatch):
    fixture_recipe(monkeypatch)
    bom=calculators.generate_bom('recipe',None,None,None)
    assert bom['tube_length_mm']==120.5
    assert bom['tube_od_mm']==137
    # Two concentric plies: thickness 0.35mm then 0.42mm, centres 125.35 and 126.12mm.
    expected=(250*pi*125.35*120.5 + 300*pi*126.12*120.5)/1_000_000
    assert bom['weight_summary']['nominal_paper_weight_g']==pytest.approx(expected,abs=0.0001)
    assert expected>26  # A zero-diameter calculation produced less than one gram.
    yield_result=calculators.calculate_yield('spec',None,None)
    assert yield_result['tube_length_mm']==120.5
    assert yield_result['tubes_per_bamboo']==bom['expected_output']['tubes_per_bamboo']


def test_explicit_preview_length_uses_real_spec_id(monkeypatch):
    fixture_recipe(monkeypatch)
    a=calculators.calculate_weights('recipe',None,tube_length_mm=120)
    b=calculators.calculate_weights('recipe',None,tube_length_mm=240)
    assert b['nominal_paper_weight_g']==pytest.approx(2*a['nominal_paper_weight_g'])
    assert a['nominal_paper_weight_g']>26


def test_missing_spec_geometry_cannot_be_silently_zero(monkeypatch):
    spec=fixture_recipe(monkeypatch);spec.id_min_mm=None;spec.id_max_mm=None
    with pytest.raises(ValueError,match='id is missing'):
        calculators.generate_bom('recipe',None,None,None)


def test_saved_profile_nominal_matches_job_card_instead_of_tolerance_midpoint(monkeypatch):
    import json
    spec=fixture_recipe(monkeypatch)
    spec.dynamic_values=[SimpleNamespace(field=SimpleNamespace(key='profile_json'), value=json.dumps({
        'dimensions': {'id_mm': {'avg':125.25}, 'od_mm': {'avg':137.25}, 'length_mm': {'avg':121.25}}
    }))]
    bom=calculators.generate_bom('recipe',None,None,None)
    assert bom['tube_length_mm']==121.25
    assert bom['tube_od_mm']==137.25
    expected=(250*pi*125.60*121.25+300*pi*126.37*121.25)/1_000_000
    assert bom['weight_summary']['nominal_paper_weight_g']==pytest.approx(expected,abs=0.0001)
