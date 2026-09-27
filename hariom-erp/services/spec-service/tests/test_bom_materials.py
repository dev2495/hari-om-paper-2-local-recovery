import json
from types import SimpleNamespace

import pytest

from src import calculators


def _dynamic(**values):
    return [SimpleNamespace(field=SimpleNamespace(key=key), value=value) for key, value in values.items()]


def _recipe(monkeypatch, dynamic_values, **spec_overrides):
    spec = SimpleNamespace(id='spec', id_min_mm=125, id_max_mm=125,
        od_min_mm=137, od_max_mm=137, length_min_mm=120, length_max_mm=120,
        target_tube_weight=92, adhesive_percent=12.5, parchment_percent=1.5,
        moisture_loss_percent=9, parchment_allowed=True, parchment_color='BLUE',
        adhesive_20100_percent=30, adhesive_30100_percent=70, dynamic_values=dynamic_values)
    for key, value in spec_overrides.items():
        setattr(spec, key, value)
    layers = [SimpleNamespace(ply_no=1, paper_id='paper-a', gsm_snapshot=250, bf_snapshot=18, bulk_snapshot=1.4),
              SimpleNamespace(ply_no=2, paper_id='paper-b', gsm_snapshot=300, bf_snapshot=18, bulk_snapshot=1.4)]
    recipe = SimpleNamespace(id='recipe', specification=spec, layers=layers)
    monkeypatch.setattr(calculators, '_get_recipe', lambda *args: recipe)
    return spec


def test_bom_adhesive_follows_the_spec_recipe_not_the_legacy_split(monkeypatch):
    components = [
        {'item_code': 'TOP', 'name': 'TOP ADHESIVE', 'base_percent': 15, 'ratio_percent': 5},
        {'item_code': 'SYN', 'name': 'SYNTHETIC', 'base_percent': 15, 'ratio_percent': 30},
        {'item_code': 'CLAY', 'name': 'CHINA CLAY', 'base_percent': 15, 'ratio_percent': 65},
    ]
    _recipe(monkeypatch, _dynamic(adhesive_components_json=json.dumps(components)))
    bom = calculators.generate_bom('recipe', None, None, None)
    adhesives = bom['raw_materials']['adhesives']
    rows = adhesives['components']
    assert [row['item_code'] for row in rows] == ['TOP', 'SYN', 'CLAY']
    assert [row['ratio_percent'] for row in rows] == [5, 30, 65]
    # parts add back to the whole-bamboo adhesive weight (grams-exact after rounding)
    assert sum(row['weight_kg'] for row in rows) == pytest.approx(adhesives['total_adhesive_weight_kg'], abs=1e-5)
    assert rows[2]['weight_kg'] == pytest.approx(adhesives['total_adhesive_weight_kg'] * 0.65, abs=1e-6)


def test_bom_falls_back_to_legacy_split_without_a_component_recipe(monkeypatch):
    _recipe(monkeypatch, [])
    bom = calculators.generate_bom('recipe', None, None, None)
    rows = bom['raw_materials']['adhesives']['components']
    assert [row['name'] for row in rows] == ['20100', '30100']


def test_bom_carries_the_spec_packing_bill_per_box(monkeypatch):
    _recipe(monkeypatch, _dynamic(box_code='G-120', qty_per_box='48', plastic_required='true',
        plastic_sku='PLASTIC BAG 32+8+8x43', fadda_sku='540 X 310', fadda_per_box='0'))
    packing = calculators.generate_bom('recipe', None, None, None)['packing']
    assert packing['box_code'] == 'G-120'
    assert packing['qty_per_box'] == 48
    assert packing['plastic_sku'] == 'PLASTIC BAG 32+8+8x43'
    assert packing['plastic_per_box'] == 1.0
    assert packing['fadda_per_box'] == 0.0


def test_bom_packing_is_empty_when_the_spec_has_none(monkeypatch):
    _recipe(monkeypatch, [])
    packing = calculators.generate_bom('recipe', None, None, None)['packing']
    assert packing['box_code'] is None and packing['qty_per_box'] is None
    assert packing['plastic_sku'] is None and packing['plastic_per_box'] == 0.0
