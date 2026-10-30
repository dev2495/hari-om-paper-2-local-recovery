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


def test_unmapped_paper_still_counts_its_kg_and_warns():
    args = list(fixture()); args[5] = {}; args[7] = {"paper": {"id": "paper", "code": "KRAFT-230-18BF", "variety": "Kraft", "gsm": 230}}
    rows, warning = explode_paper_demand(*args)
    assert rows and rows[0]["qty_kg"] == 36.75
    assert rows[0]["mapped"] is False and rows[0]["item_id"] == "paper:paper" and rows[0]["item_code"] == "KRAFT-230-18BF"
    assert "no stock item" in warning


def test_paper_maps_to_stock_item_by_code_ignoring_spaces_and_dashes():
    args = list(fixture()); args[5] = {}
    args[6] = {"KRAFT 230 18BF": {"id": "stock-1", "item_code": "KRAFT 230 18BF", "name": "Kraft 230", "type": "RAW_PAPER", "uom": "KG"}}
    args[7] = {"paper": {"id": "paper", "code": "KRAFT-230-18BF"}}
    rows, warning = explode_paper_demand(*args)
    assert warning is None and rows[0]["item_id"] == "stock-1" and rows[0]["mapped"] is True


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
        elif url.endswith('/season'):
            body={'active_season':'ROY','epoch':1}
        elif url.endswith('/season/release-authorizations'):
            body=[]
        elif url.endswith('/specs/spec'):
            body = {'id': 'spec', 'version': 3, 'status': 'approved', 'tube_size_id': 'tube'}
        elif url.endswith('/recipes/spec/spec'):
            body = [{'id': 'recipe', 'version': 2}]
        elif url.endswith('/calculate/bom/recipe'):
            assert params == {'tube_length_mm': 500, 'tube_od_mm': 122.2}
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

def residual_result(*, section_issues=None, job_issues=None, shared=False, plan_date=None, made=None, line_due='2026-09-20', packing=None, spec_error=False, released=5000, job_extra=None, adhesive=None):
    import asyncio
    from unittest.mock import AsyncMock, patch
    import httpx
    from src.services.procurement_demand import material_demand
    bom = {'expected_output': {'tubes_per_bamboo': 5}, 'raw_materials': {'papers': [
        {'paper_id': 'paper', 'weight_kg': 5}, {'paper_id': 'paper', 'weight_kg': 5}]}}
    if packing:
        bom['packing'] = packing
    if adhesive:
        bom['raw_materials']['adhesives'] = {'components': [{'item_code': 'GLUE', 'name': 'Glue', 'weight_kg': adhesive}]}
    jobs = [
        {'id':'done','sales_order_line_id':'line','planned_qty':2000,'status':'COMPLETED'},
        {'id':'wip','sales_order_line_id':'line','planned_qty':3000,'status':'RUNNING','started':True,
         'reel_issue_ids':['issue'], 'spec_snapshot':{'version':1},
         'material_plan_snapshot':{'bom_snapshot':bom,'recipe_snapshot':{'recipe_id':'frozen','version':1}}}]
    if shared:
        jobs[0]['reel_issue_ids'] = ['issue']
    if plan_date:
        jobs[1]['production_plan_date'] = plan_date
        jobs[1]['job_card_no'] = '26/09/07'
    if made is not None:
        jobs[1]['made_pcs'] = made
    jobs[1].update(job_extra or {})
    bodies = {
        '/sales-orders': [{'id':'so','order_no':'SO-1','status':'partially_dispatched','lines':[{
            'id':'line','due_date':line_due,'release_remaining_qty':5000,'remaining_qty':8000,
            'released_qty':released,'fulfilled_qty':2000,'approved_spec_id':'spec'}]}],
        '/master/tube-sizes/':[{'id':'tube','length_mm':500,'outer_diameter_mm':120}],
        '/master/papers/':[{'id':'paper','code':'P1'}],
        '/items/':[{'id':'paper','item_code':'P1','name':'Paper','type':'RAW_PAPER','uom':'KG'},
                   {'id':'box','item_code':'R-150','name':'Box R-150','type':'PACKAGING','uom':'PCS'},
                   {'id':'glue','item_code':'GLUE','name':'Glue','type':'ADHESIVE','uom':'KG'}],
        '/specs/spec':{'id':'spec','version':2,'status':'approved','tube_size_id':'tube', **({'seasonal_model': True} if spec_error else {})},
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
        if path=='/calculate/bom-for-spec/spec':return httpx.Response(409,json={'detail':'recipe pending'})
        if path=='/season':return httpx.Response(200,json={'active_season':'ROY','epoch':1})
        if path=='/season/release-authorizations':return httpx.Response(200,json=[])
        return httpx.Response(200,json=bodies[path])
    with patch('src.services.procurement_demand.http_client.get',new=AsyncMock(side_effect=get)):
        return asyncio.run(material_demand('test','plant',date(2026,9,1),date(2026,9,30)))


def test_residual_uses_frozen_layers_once_and_accepted_fg_before_new_bom():
    # Started card: BOM x (planned - good made) / planned = 6000 x (3000 - 2250) / 3000 (client 2026-10-28).
    result = residual_result(made=2250)
    assert result['blocked'] == []
    work, new = result['requirements']
    assert work['gross_qty_kg'] == 6000 and work['qty_kg'] == 1500 and work['already_used_kg'] == 4500
    assert work['made_pcs'] == 2250 and work['planned_pcs'] == 3000 and work['basis'] == 'FROZEN_JOB_REMAINING'
    assert work['recipe_id'] == 'frozen' and work['recipe_version'] == 1
    assert new['open_units'] == 4000 and new['qty_kg'] == 8000
    assert new['accepted_external_fg_pcs'] == 1000


def test_started_card_never_depends_on_attributed_issues_and_never_blocks():
    # Floor issues are by shift: exclusive, shared or missing attribution changes nothing and
    # nothing is "blocked" any more; the card is still counted (flags, not blocks).
    issue = [{'id':'issue','item_id':'paper','qty_kg':6000}]
    for result in (residual_result(made=1500, section_issues=issue), residual_result(made=1500, section_issues=issue, shared=True),
                   residual_result(made=1500, job_issues=[{'job_id':'wip','item_id':'paper','net_issued_qty':4500}])):
        assert result['blocked'] == []
        assert result['requirements'][0]['job_id'] == 'wip' and result['requirements'][0]['qty_kg'] == 3000


def test_started_card_without_made_figure_is_counted_whole_with_a_warning():
    result = residual_result()
    assert result['requirements'][0]['qty_kg'] == 6000
    assert any('pieces made so far are not known' in row['reason'] for row in result['warnings'])


def test_fully_made_card_needs_nothing_more():
    result = residual_result(made=3000)
    assert all(row.get('job_id') != 'wip' for row in result['requirements'])


def test_line_due_after_window_still_counts_its_card_planned_inside_the_window():
    # Before 2026-10-28 a line due after the window end was skipped whole, hiding planner demand.
    hidden = residual_result(made=0, line_due='2026-11-15')
    assert hidden['requirements'] == []
    shown = residual_result(made=0, line_due='2026-11-15', plan_date='2026-09-12')
    work = shown['requirements'][0]
    assert work['job_id'] == 'wip' and work['date'] == '2026-09-12' and work['qty_kg'] == 6000
    assert all(row.get('job_id') == 'wip' for row in shown['requirements'])
    # The planner slot is the need date; the order's own date travels apart (checker r4: the day
    # sheet called the 12 Sep slot "due" while the order is due 15 Nov).
    assert work['due_date'] == '2026-09-12' and work['production_plan_date'] == '2026-09-12' and work['order_due_date'] == '2026-11-15'
    from src.services.rm_calendar import _need_payload
    need = _need_payload({**work, 'qty': work['qty_kg']})
    assert need['production_plan_date'] == '2026-09-12' and need['order_due_date'] == '2026-11-15'


def other_fixture(**line_overrides):
    from src.services.procurement_demand import explode_other_demand  # noqa: F401
    order = {"id": "so", "order_no": "SO-01"}
    line = {"id": "line", "due_date": "2026-09-20", "release_remaining_qty": 1000, "parchment_color": "BLUE", **line_overrides}
    bom = {"expected_output": {"tubes_per_bamboo": 12},
           "raw_materials": {"adhesives": {"components": [
               {"name": "SYNTHETIC", "item_code": "SYN-01", "weight_kg": 0.1},
               {"name": "CHINA CLAY", "item_code": "CLAY", "weight_kg": 0.2}]},
               "parchment": {"color": "BLUE", "weight_kg": 0.03}},
           "packing": {"box_code": "G-120", "qty_per_box": 48, "plastic_sku": "PB-32", "plastic_per_box": 1, "fadda_sku": None, "fadda_per_box": 0}}
    items = [{"id": "syn", "item_code": "SYN 01", "name": "Synthetic", "type": "ADHESIVE", "uom": "KG"},
             {"id": "clay", "item_code": "CHINA-CLAY", "name": "China clay", "type": "OTHER", "uom": "KG"},
             {"id": "pblue", "item_code": "PARCH-BLUE", "name": "Parchment blue", "type": "PARCHMENT", "uom": "KG"},
             {"id": "box", "item_code": "G120", "name": "Box G-120 3 ply", "type": "PACKAGING", "uom": "PCS"}]
    return order, line, {"id": "spec"}, bom, items, date(2026, 9, 1), date(2026, 9, 30)


def test_adhesive_parchment_and_packing_come_from_the_same_spec_bom():
    from src.services.procurement_demand import explode_other_demand
    rows, warning = explode_other_demand(*other_fixture())
    by_code = {row["item_code"]: row for row in rows}
    # 1000 pcs / 12 per bamboo -> 84 whole bamboos
    assert by_code["SYN 01"]["qty"] == 8.4 and by_code["SYN 01"]["material_class"] == "ADHESIVE"
    assert by_code["PARCH-BLUE"]["qty"] == 2.52 and by_code["PARCH-BLUE"]["uom"] == "KG"
    # 1000 pcs / 48 per box -> 21 boxes, one plastic bag per box
    assert by_code["G120"]["qty"] == 21 and by_code["G120"]["uom"] == "PCS"
    assert by_code["PB-32"]["qty"] == 21 and by_code["PB-32"]["mapped"] is False
    # code "CLAY" matches nothing; the component name "CHINA CLAY" matches item CHINA-CLAY
    assert by_code["CHINA-CLAY"]["qty"] == 16.8 and by_code["CHINA-CLAY"]["mapped"] is True
    assert "Packing PB-32 has no stock item yet" in warning


def test_parchment_splits_by_the_line_colour_breakup():
    from src.services.procurement_demand import explode_other_demand
    rows, _ = explode_other_demand(*other_fixture(color_splits=[
        {"color": "BLUE", "qty": 400, "open_qty": 400}, {"color": "RED", "qty": 300, "open_qty": 300}],
        unassigned_color_qty=300, parchment_color=None))
    parchment = {row["item_code"]: row["qty"] for row in rows if row["material_class"] == "PARCHMENT"}
    assert parchment["PARCH-BLUE"] == 1.008  # 40% of 2.52 kg
    assert parchment["RED"] == 0.756 and parchment["UNASSIGNED"] == 0.756
    assert sum(parchment.values()) == 2.52


def test_packing_without_pcs_per_box_warns_instead_of_guessing():
    from src.services.procurement_demand import explode_other_demand
    order, line, spec, bom, items, start, end = other_fixture()
    bom["packing"] = {"box_code": "G-120", "qty_per_box": None}
    rows, warning = explode_other_demand(order, line, spec, bom, items, start, end)
    assert not [row for row in rows if row["material_class"] == "PACKING"]
    assert "no pcs-per-box" in warning


def test_same_code_of_another_type_is_not_the_paper_and_is_reported_on_create():
    from src.services.procurement_demand import resolve_paper_item
    wrong = {"id": "x", "item_code": "KRAFT-230-18BF", "name": "Mislabelled", "type": "OTHER", "uom": "PCS"}
    assert resolve_paper_item("paper", {"code": "KRAFT-230-18BF"}, {"x": wrong}, {"KRAFT-230-18BF": wrong}) is None


def test_packing_in_kg_never_satisfies_pieces():
    from src.services.procurement_demand import explode_other_demand
    order, line, spec, bom, items, start, end = other_fixture()
    items = [row for row in items if row["id"] != "box"] + [{"id": "boxkg", "item_code": "G120", "name": "Box", "type": "PACKAGING", "uom": "KG"}]
    rows, warning = explode_other_demand(order, line, spec, bom, items, start, end)
    box = next(row for row in rows if row["material_class"] == "PACKING" and row["item_code"] in {"G-120", "G120"})
    assert box["mapped"] is False and box["uom"] == "PCS"


def test_create_items_reports_a_code_clash_instead_of_skipping(monkeypatch):
    import asyncio
    from src.services import procurement_demand as pd

    class Resp:
        def __init__(self, data, status=200):
            self._data, self.status_code = data, status
        def json(self):
            return self._data

    posted = []

    class Client:
        async def get(self, url, **kwargs):
            if "papers" in url:
                return Resp([{"id": "p1", "code": "KRAFT-230-18BF", "variety": "Kraft", "gsm": 230}])
            return Resp([{"id": "x", "item_code": "KRAFT 230 18BF", "type": "OTHER", "uom": "PCS"}])
        async def post(self, url, **kwargs):
            posted.append(kwargs)
            return Resp({}, 201)

    monkeypatch.setattr(pd, "http_client", Client())
    result = asyncio.run(pd.create_paper_stock_items("t", "PLANT_A", ["p1"]))
    assert not posted and not result["skipped"]
    assert "already a OTHER item" in result["failed"][0]["reason"]


def test_job_on_the_board_needs_material_by_its_production_slot():
    result = residual_result(job_issues=[{'job_id':'wip','item_id':'paper','net_issued_qty':4500}], plan_date='2026-09-12')
    work, new = result['requirements']
    assert work['date'] == '2026-09-12' and work['source'] == 'PRODUCTION_PLAN' and work['job_card_no'] == '26/09/07'
    assert new['source'] == 'LINE_DUE' and new['date'] == '2026-09-20'


def test_queued_job_keeps_the_customer_date():
    result = residual_result(job_issues=[{'job_id':'wip','item_id':'paper','net_issued_qty':4500}])
    work = result['requirements'][0]
    assert work['source'] == 'RELEASED_QUEUE' and work['date'] == '2026-09-20'


def test_adhesive_mass_from_bom_converts_to_stock_litres():
    from src.services.procurement_demand import explode_other_demand
    rows, warning = explode_other_demand(
        {"id": "so", "order_no": "SO-L"},
        {"id": "line", "due_date": "2026-09-20", "release_remaining_qty": 10},
        {"id": "spec"},
        {"expected_output": {"tubes_per_bamboo": 5}, "raw_materials": {"adhesives": {"components": [{"item_code": "GLUE", "name": "Glue", "weight_kg": 6}]}}},
        [{"id": "glue", "item_code": "GLUE", "name": "Glue", "type": "ADHESIVE", "uom": "L", "density_kg_per_litre": 1.2}],
        date(2026, 9, 1), date(2026, 9, 30))
    assert warning is None
    assert rows[0]["qty"] == 10 and rows[0]["uom"] == "L"


def test_free_text_bom_codes_cannot_create_master_records():
    import asyncio
    import pytest
    from fastapi import HTTPException
    from src.services.procurement_demand import create_material_stock_items
    with pytest.raises(HTTPException) as error:
        asyncio.run(create_material_stock_items("t", "PLANT_A", [{"material_class": "ADHESIVE", "code": "Unverified name"}]))
    assert error.value.status_code == 409
    assert "Masters" in error.value.detail


def test_line_with_no_delivery_date_is_needed_at_window_start_and_never_overdue():
    # Delivery date is optional everywhere (client 2026-10-28): a line with no date is "No date".
    line = {'id': 'line', 'due_date': None, 'delivery_schedules': []}
    assert dated_new_build_buckets(line, 500) == [{'due_date': None, 'quantity': 500, 'delivery_schedule_ids': []}]
    assert job_material_need_date(line, {}) is None
    args = list(fixture()); args[1] = {**args[1], 'due_date': None}
    rows, error = explode_paper_demand(*args)
    assert error is None and rows[0]['date'] == '2026-09-01'
    assert rows[0]['due_date'] is None and rows[0]['no_date'] is True and rows[0]['overdue'] is False
    from src.services.procurement_demand import explode_other_demand
    order, line_row, spec, bom, items, start, end = other_fixture(due_date=None)
    other, _ = explode_other_demand(order, line_row, spec, bom, items, start, end)
    assert other and all(row['due_date'] is None and row['no_date'] and not row['overdue'] for row in other)


def test_no_date_line_counts_new_build_at_window_start_and_queued_card_too():
    # Queued card (no plan slot) on a line with no date: needed at the window start, not dropped.
    result = residual_result(made=0, line_due=None)
    work, new = result['requirements']
    assert work['job_id'] == 'wip' and work['source'] == 'RELEASED_QUEUE' and work['date'] == '2026-09-01'
    assert work['no_date'] is True and work['overdue'] is False
    assert new['source'] == 'LINE_DUE' and new['date'] == '2026-09-01' and new['due_date'] is None


def test_no_date_line_with_a_planned_card_keeps_the_plan_slot_date():
    result = residual_result(made=0, line_due=None, plan_date='2026-09-12')
    work = result['requirements'][0]
    assert work['job_id'] == 'wip' and work['source'] == 'PRODUCTION_PLAN' and work['date'] == '2026-09-12'
    assert work['no_date'] is False and work['due_date'] == '2026-09-12'


def test_packing_of_a_started_card_is_needed_until_packed_and_rounds_up():
    # Card planned 3000 pcs, wound 2250: paper follows the made share, the boxes are used at packing,
    # so the whole card still needs ceil(3000 / 45) = 67 boxes (checker 2026-10-28: 6 x 100/240 -> 2).
    result = residual_result(made=2250, packing={'box_code': 'R-150', 'qty_per_box': 45})
    work_paper = next(row for row in result['requirements'] if row['basis'] == 'FROZEN_JOB_REMAINING')
    assert work_paper['qty_kg'] == 1500
    box = next(row for row in result['material_requirements'] if row['basis'] == 'FROZEN_JOB_REMAINING')
    assert box['item_code'] == 'R-150' and box['qty'] == 67 and box['remaining_share'] == 1.0 and box['share_basis'] == 'UNTIL_PACKED'
    # Fully wound, not packed: no paper is needed, every box still is.
    wound = residual_result(made=3000, packing={'box_code': 'R-150', 'qty_per_box': 45})
    assert not [row for row in wound['requirements'] if row['basis'] == 'FROZEN_JOB_REMAINING']
    assert next(row for row in wound['material_requirements'] if row['basis'] == 'FROZEN_JOB_REMAINING')['qty'] == 67


def test_packing_demand_drops_once_the_card_is_packed_not_at_dispatch():
    # Client 2026-10-30, card 26/10/155: Process closed, Packing auto-closed, waiting dispatch. Its boxes
    # were consumed at packing, so the card needs none; paper is already 0 because it is fully made.
    box = {'box_code': 'R-150', 'qty_per_box': 45}
    packed = residual_result(made=3000, packing=box, job_extra={'packing_closed': True, 'packed_pcs': 3000})
    assert not [row for row in packed['material_requirements'] if row['basis'] == 'FROZEN_JOB_REMAINING']
    assert not [row for row in packed['requirements'] if row['basis'] == 'FROZEN_JOB_REMAINING']
    # Packing still open with 1,350 of 3,000 pcs packed: ceil(1,650 / 45) = 37 boxes, rounded up.
    half = residual_result(made=3000, packing=box, job_extra={'packing_closed': False, 'packed_pcs': 1350})
    row = next(row for row in half['material_requirements'] if row['basis'] == 'FROZEN_JOB_REMAINING')
    assert row['qty'] == 37 and row['packed_pcs'] == 1350 and row['remaining_share'] == 0.55 and row['already_used'] == 30
    # Closed Packing wins even when the packed count is not known.
    assert not [r for r in residual_result(made=0, packing=box, job_extra={'packing_closed': True})['material_requirements']
                if r['basis'] == 'FROZEN_JOB_REMAINING']


def test_a_closed_winder_needs_no_more_paper_or_adhesive_even_after_a_short_close():
    # Checker 2026-10-30: 26/10/45 short-closed its Winder at 690 of 1,440 pcs (Oven running) and still
    # asked for 233 kg of paper and 26 kg of adhesive. Boxes are used at packing, so they stay.
    box = {'box_code': 'R-150', 'qty_per_box': 45}
    open_winder = residual_result(made=1350, packing=box, adhesive=0.2)
    assert next(r for r in open_winder['requirements'] if r['basis'] == 'FROZEN_JOB_REMAINING')['qty_kg'] == 3300
    assert any(r['item_code'] == 'GLUE' for r in open_winder['material_requirements'] if r['basis'] == 'FROZEN_JOB_REMAINING')
    short = residual_result(made=1350, packing=box, adhesive=0.2, job_extra={'winding_closed': True, 'packing_closed': False})
    work = [r for r in short['requirements'] if r['basis'] == 'FROZEN_JOB_REMAINING']
    other = [r for r in short['material_requirements'] if r['basis'] == 'FROZEN_JOB_REMAINING']
    assert work == [] and [r['item_code'] for r in other] == ['R-150'] and other[0]['qty'] == 67
    # Process and Packing closed, only Dispatch open (26/10/10): nothing at all, even from an older
    # production service that does not send winding_closed, and no "made not known" warning.
    for extra in ({'winding_closed': True, 'packing_closed': True}, {'packing_closed': True}):
        done = residual_result(packing=box, adhesive=0.2, job_extra=extra)
        assert not [r for r in done['requirements'] + done['material_requirements'] if r['basis'] == 'FROZEN_JOB_REMAINING']
        assert not any('pieces made so far are not known' in w['reason'] for w in done['warnings'])


def test_a_line_is_never_both_counted_and_not_counted():
    # 960 released pcs have no card, and the season recipe is pending: one plain "not counted" note.
    result = residual_result(made=0, spec_error=True, released=5960)
    reasons = [row['reason'] for row in result['warnings'] if row.get('line_id') == 'line']
    assert not any('counted as still to make' in reason for reason in reasons)
    assert any(reason.startswith('Not counted:') and '960 released pcs have no job card yet' in reason for reason in reasons)
    counted = residual_result(made=0, released=5960)
    assert any(row['reason'] == '960 released pcs have no job card yet — counted as still to make' for row in counted['warnings'])
