from datetime import date
from src.services.procurement_demand import explode_paper_demand, dated_new_build_buckets, job_material_need_date


def test_calloff_dates_keep_early_demand_visible_and_deduct_explicit_releases():
    line = {'due_date': '2026-12-31', 'delivery_schedules': [
        {'id': 'early', 'delivery_date': '2026-09-22', 'quantity': 2000, 'allocations': [{'release_lot_id': 'lot', 'quantity': 500}]},
        {'id': 'later', 'delivery_date': '2026-10-15', 'quantity': 3000},
        {'id': 'cancelled', 'delivery_date': '2026-09-01', 'quantity': 999, 'status': 'cancelled'},
    ]}
    result = dated_new_build_buckets(line, 5000)
    assert [(row['due_date'], row['quantity']) for row in result] == [('2026-09-22', 1500), ('2026-10-15', 3000), ('2026-12-31', 500)]
    assert sum(row['quantity'] for row in result) == 5000
    assert job_material_need_date(line, {'release_lot_id': 'lot'}) == '2026-09-22'
    assert job_material_need_date(line, {}) == '2026-09-22'


def test_same_day_calloffs_combine_before_whole_bamboo_rounding():
    line = {'due_date': '2026-09-30', 'delivery_schedules': [
        {'id': 'a', 'delivery_date': '2026-09-20', 'quantity': 2},
        {'id': 'b', 'delivery_date': '2026-09-20', 'quantity': 3},
    ]}
    assert dated_new_build_buckets(line, 5) == [{'due_date': '2026-09-20', 'quantity': 5, 'delivery_schedule_ids': ['a', 'b']}]


def fixture():
    return ({"id": "so", "order_no": "SO-01"}, {"id": "line", "due_date": "2026-09-20", "release_remaining_qty": 11, "released_qty": 8}, {"id": "spec", "version": 3}, {"id": "recipe", "version": 2}, {"expected_output": {"tubes_per_bamboo": 5}, "raw_materials": {"papers": [{"paper_id": "paper", "weight_kg": 12.25}]}}, {"paper": {"id": "paper", "item_code": "RM01", "name": "Paper", "type": "RAW_PAPER", "uom": "KG"}}, {}, {}, date(2026, 9, 1), date(2026, 9, 30))


def test_bom_rounds_whole_bamboos_and_excludes_already_released_work():
    rows, error = explode_paper_demand(*fixture())
    assert error is None
    assert rows[0]["qty_kg"] == 36.75
    assert rows[0]["open_units"] == 11 and rows[0]["bamboos"] == 3
    assert rows[0]["recipe_version"] == 2


def test_missing_paper_mapping_is_blocked_instead_of_zero_demand():
    args = list(fixture()); args[5] = {}
    rows, error = explode_paper_demand(*args)
    assert rows == [] and "mapping" in error


def test_demand_outside_horizon_excluded_and_overdue_rolled_to_first_day():
    args = list(fixture()); args[1] = {**args[1], "due_date": "2026-10-01"}
    assert explode_paper_demand(*args) == ([], None)
    args[1]["due_date"] = "2026-08-20"
    rows, error = explode_paper_demand(*args)
    assert rows[0]["date"] == "2026-09-01" and rows[0]["overdue"]


def test_adapter_uses_plant_scoped_sources_and_canonical_bom():
    import asyncio
    from unittest.mock import AsyncMock, patch
    import httpx
    from src.services.procurement_demand import material_demand
    calls = []
    async def get(url, headers, params=None):
        calls.append((url, headers, params))
        if url.endswith('/sales-orders'):
            body = [{'id': 'so', 'order_no': 'SO-01', 'status': 'approved', 'lines': [{'id': 'line', 'due_date': '2026-09-20', 'release_remaining_qty': 11, 'released_qty': 8, 'approved_spec_id': 'spec'}]}]
        elif url.endswith('/master/tube-sizes/'):
            body = [{'id': 'tube', 'length_mm': 500, 'outer_diameter_mm': 122.2}]
        elif url.endswith('/master/papers/'):
            body = [{'id': 'paper', 'code': 'RM01'}]
        elif url.endswith('/items/'):
            body = [{'id': 'inventory-paper', 'item_code': 'RM01', 'name': 'Mapped paper', 'type': 'RAW_PAPER', 'uom': 'KG'}]
        elif url.endswith('/material-demand-snapshots'):
            body = {'coverage': 'all_linked_jobs', 'jobs': []}
        elif url.endswith('/material-issues/by-job'):
            body = {'coverage': 'all_attributed_job_issues', 'items': []}
        elif url.endswith('/specs/spec'):
            body = {'id': 'spec', 'version': 3, 'status': 'approved', 'tube_size_id': 'tube'}
        elif url.endswith('/recipes/spec/spec'):
            body = [{'id': 'recipe', 'version': 2}]
        elif url.endswith('/calculate/bom/recipe'):
            assert params == {'tube_length_mm': 500, 'tube_od_mm': 123}
            body = {'expected_output': {'tubes_per_bamboo': 5}, 'raw_materials': {'papers': [{'paper_id': 'paper', 'weight_kg': 12.25}]}}
        else:
            raise AssertionError(url)
        return httpx.Response(200, json=body)
    with patch('src.services.procurement_demand.http_client.get', new=AsyncMock(side_effect=get)):
        result = asyncio.run(material_demand('test', 'plant', date(2026,9,1), date(2026,9,30)))
    assert result['requirements'][0]['qty_kg'] == 36.75
    assert result['requirements'][0]['item_id'] == 'inventory-paper'
    assert result['source_version'].startswith('SALES-BOM:')
    assert all(headers['X-Plant-ID'] == 'plant' for _, headers, _ in calls)


def test_adapter_source_failure_never_becomes_zero_demand():
    import asyncio
    from unittest.mock import AsyncMock, patch
    import httpx
    import pytest
    from fastapi import HTTPException
    from src.services.procurement_demand import material_demand
    with patch('src.services.procurement_demand.http_client.get', new=AsyncMock(return_value=httpx.Response(503))):
        with pytest.raises(HTTPException) as error:
            asyncio.run(material_demand('test', 'plant', date(2026,9,1), date(2026,9,30)))
        assert error.value.status_code == 502


def test_repeated_paper_layers_aggregate_before_issue_subtraction():
    args = list(fixture())
    args[4]['raw_materials']['papers'].append({'paper_id': 'paper', 'weight_kg': 2})
    rows, error = explode_paper_demand(*args)
    assert error is None and len(rows) == 1
    assert rows[0]['qty_kg'] == 42.75

def residual_result(*, section_issues=None, job_issues=None, shared=False):
    import asyncio
    from unittest.mock import AsyncMock, patch
    import httpx
    from src.services.procurement_demand import material_demand
    bom = {'expected_output': {'tubes_per_bamboo': 5}, 'raw_materials': {'papers': [
        {'paper_id': 'paper', 'weight_kg': 5}, {'paper_id': 'paper', 'weight_kg': 5}]}}
    jobs = [
        {'id':'done','sales_order_line_id':'line','planned_qty':2000,'status':'COMPLETED'},
        {'id':'wip','sales_order_line_id':'line','planned_qty':3000,'status':'RUNNING','started':True,
         'reel_issue_ids':['issue'], 'spec_snapshot':{'version':1},
         'material_plan_snapshot':{'bom_snapshot':bom,'recipe_snapshot':{'recipe_id':'frozen','version':1}}}]
    if shared:
        jobs[0]['reel_issue_ids'] = ['issue']
    bodies = {
        '/sales-orders': [{'id':'so','order_no':'SO-1','status':'partially_dispatched','lines':[{
            'id':'line','due_date':'2026-09-20','release_remaining_qty':5000,'remaining_qty':8000,
            'released_qty':5000,'fulfilled_qty':2000,'approved_spec_id':'spec'}]}],
        '/master/tube-sizes/':[{'id':'tube','length_mm':500,'outer_diameter_mm':120}],
        '/master/papers/':[{'id':'paper','code':'P1'}],
        '/items/':[{'id':'paper','item_code':'P1','name':'Paper','type':'RAW_PAPER','uom':'KG'}],
        '/specs/spec':{'id':'spec','version':2,'status':'approved','tube_size_id':'tube'},
        '/recipes/spec/spec':[{'id':'recipe','version':2}],
        '/calculate/bom/recipe':bom,
        '/material-demand-snapshots':{'coverage':'all_linked_jobs','jobs':jobs},
        '/material-issues/by-job':{'coverage':'all_attributed_job_issues','items':job_issues or [],
            'section_issues':section_issues or [], 'accepted_fg_allocations':[
                {'line_id':'line','spec_id':'spec','quantity_pcs':1000,'source_job_ids':[]},
                # Own completed output must not reduce the unreleased balance twice.
                {'line_id':'line','spec_id':'spec','quantity_pcs':2000,'source_job_ids':['done']}]}}
    async def get(url, **kwargs):
        path = httpx.URL(url).path
        return httpx.Response(200,json=bodies[path])
    with patch('src.services.procurement_demand.http_client.get',new=AsyncMock(side_effect=get)):
        return asyncio.run(material_demand('test','plant',date(2026,9,1),date(2026,9,30)))


def test_residual_uses_frozen_layers_once_and_accepted_fg_before_new_bom():
    result = residual_result(job_issues=[{'job_id':'wip','item_id':'paper','net_issued_qty':4500}])
    assert result['blocked'] == []
    work, new = result['requirements']
    assert work['gross_qty_kg'] == 6000 and work['qty_kg'] == 1500
    assert work['recipe_id'] == 'frozen' and work['recipe_version'] == 1
    assert new['open_units'] == 4000 and new['qty_kg'] == 8000
    assert new['accepted_external_fg_pcs'] == 1000


def test_exclusive_reel_issue_covers_its_job_but_shared_issue_is_not_duplicated():
    issue = [{'id':'issue','item_id':'paper','qty_kg':6000}]
    result = residual_result(section_issues=issue)
    assert result['blocked'] == [] and result['requirements'][0]['qty_kg'] == 0
    ambiguous = residual_result(section_issues=issue,shared=True)
    assert len(ambiguous['blocked']) == 1
    assert all(row.get('job_id') != 'wip' for row in ambiguous['requirements'])
