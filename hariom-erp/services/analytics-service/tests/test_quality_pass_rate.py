from datetime import date

from src.routers.reports import _quality_report


def test_quality_report_empty_inspections_are_not_one_hundred_percent():
    report = _quality_report(
        {"quality_inspections": [], "quality_holds": []},
        date(2026, 9, 1),
        date(2026, 9, 17),
        "day",
    )
    assert report["summary"]["checked"] == 0
    assert report["summary"]["compliance_percent"] == 0.0
    assert report["summary"]["pass_rate"] is None
    assert report["summary"]["has_inspection_data"] is False


def test_pending_and_record_only_readings_are_not_failures():
    report=_quality_report({'quality_holds':[], 'quality_inspections':[
        {'created_at':'2026-09-02T10:00:00','status':status,'stage_type':'WINDER'}
        for status in ('PASS','FAIL','OBSERVATION_ONLY','INCOMPLETE')
    ]},date(2026,9,1),date(2026,9,3),'day')
    assert report['summary']['checked']==4
    assert report['summary']['failed']==1
    assert report['summary']['pass_rate']==50
    assert report['summary']['pending_or_record_only']==2
    assert report['fail_by_stage']==[{'stage_type':'WINDER','count':1}]


def test_dispatch_report_reads_saved_sales_timeline_quantity_and_date():
    from src.routers.reports import _dispatch_report, _compute_order_state
    order={'status':'closed','created_at':'2026-08-01','lines':[{'due_date':'2026-09-03'}], '_timeline_events':[
        {'event_type':'SALES_ORDER_DISPATCH_RECORDED','created_at':'2026-09-02T10:00:00','qty':50},
        {'event_type':'SALES_ORDER_DISPATCH_RECORDED','created_at':'2026-08-02T10:00:00','qty':30}
    ]}
    start,end=date(2026,9,1),date(2026,9,3)
    report=_dispatch_report({'orders':[order],'ready_jobs':[]},start,end,'day')
    assert report['summary']['dispatch_qty']==50
    assert _compute_order_state(order,start,end)['final_dispatch']==date(2026,9,2)
