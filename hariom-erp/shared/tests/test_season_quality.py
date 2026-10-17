from copy import deepcopy
import pytest
from season_quality import RuleError, initial_rules, validate_rules, resolve_profile, evaluate_samples, stage_readiness


@pytest.fixture
def profile():
    return resolve_profile({"id_min_mm":76.2,"id_max_mm":76.6,"od_min_mm":81,"od_max_mm":81,"length_min_mm":149.8,"length_max_mm":150.2,"target_tube_weight":120,"cs_min_n":400,"required_cs":400,"mandrel_diameter_mm":76.3,"selected_bamboo_length_mm":1560},initial_rules())


def rule(profile,stage,parameter):
    return next(r for r in profile["stages"][stage]["parameters"] if r["code"]==parameter)


def test_initial_bands(profile):
    assert not profile["unresolved"] and not profile["conflicts"]
    assert rule(profile,"WINDER","id")["min"]==76.2
    assert rule(profile,"WINDER","id")["max"]==76.5
    assert rule(profile,"WINDER","height")["min"]==1545
    assert rule(profile,"WINDER","cs")["min"]==150
    assert rule(profile,"WINDER","cs")["max"]==170
    assert rule(profile,"PROCESS","height")["max"]==150.2
    assert rule(profile,"PROCESS","id")["min"]==76.4


@pytest.mark.parametrize("post,expected",[(90,"PASS"),(92,"PASS"),(92.001,"FAIL"),(89.999,"FAIL")])
def test_paired_oven_precision(profile,post,expected):
    rows=evaluate_samples("OVEN",profile,[{"sample_id":"a","readings":{"pre_weight":100,"post_weight":post}}])["results"]
    assert next(r for r in rows if r["parameter"]=="post_weight")["verdict"]==expected


def test_missing_pair_is_incomplete(profile):
    result=evaluate_samples("OVEN",profile,[{"sample_id":"a","readings":{"post_weight":91}}])
    assert result["verdict"]=="INCOMPLETE"


def test_partial_entries_aggregate_without_poisoning(profile):
    evaluations=[]
    values={"id":76.3,"od":82,"height":1560,"weight":120,"cs":165}
    for code,value in values.items():
        evaluations.append(evaluate_samples("WINDER",profile,[{"sample_id":"one","readings":{code:value}}]))
        evaluations.append(evaluate_samples("WINDER",profile,[{"sample_id":"two","readings":{code:value}}]))
    assert stage_readiness("WINDER",profile,evaluations)["ready"]
    assert stage_readiness("WINDER",profile,evaluations+evaluations)["ready"]
    assert not stage_readiness("WINDER",profile,evaluations[:1])["ready"]


def test_record_only_and_empty(profile):
    assert evaluate_samples("WINDER",profile,[])["verdict"]=="NOT_MEASURED"
    assert evaluate_samples("WINDER",profile,[{"sample_id":"a","readings":{"weight":120}}])["verdict"]=="OBSERVATION_ONLY"
    measured=evaluate_samples("WINDER",profile,[{"sample_id":"b","readings":{"weight":120,"id":76.3}}])
    assert measured['verdict']=='PASS'
    assert next(r for r in measured['results'] if r['parameter']=='weight')['verdict']=='OBSERVATION_ONLY'


def test_contractual_conflict():
    p=resolve_profile({"id_min_mm":76.2,"id_max_mm":76.3},initial_rules())
    assert any(r["parameter"]=="id" for r in p["conflicts"])


def test_duplicate_sample_and_nan_rejected(profile):
    with pytest.raises(RuleError): evaluate_samples("OVEN",profile,[{"sample_id":"x","readings":{}},{"sample_id":"x","readings":{}}])
    assert evaluate_samples("WINDER",profile,[{"sample_id":"x","readings":{"id":"NaN"}}])["verdict"]=="INVALID"


def test_readings_cannot_be_disabled():
    rows=initial_rules(); rows[0]["min_readings"]=1
    with pytest.raises(RuleError):validate_rules(rows)
    rows=initial_rules();rows[0]["lower"]=[{"ref":"__import__","factor":1,"offset":0}]
    with pytest.raises(RuleError):validate_rules(rows)


def test_monsoon_copy_and_overlay_isolation(profile):
    rows=deepcopy(initial_rules()); rows[1]["lower"][0]["offset"]=.9
    assert initial_rules()[1]["lower"][0]["offset"]==.8
    assert rule(profile,"WINDER","od")["min"]==81.8


def test_customer_references_use_the_requirement_not_the_lower_limit():
    # Spec sheet: I.D. 120 ± 0.5, required C.S. 500 with a 7% band (465–535).
    spec={"id_min_mm":119.5,"id_max_mm":120.5,"od_min_mm":132.5,"od_max_mm":133.5,"length_min_mm":123,"length_max_mm":127,
          "target_tube_weight":245,"required_cs":500,"cs_min_n":465,"cs_max_n":535,"mandrel_diameter_mm":120.5,"selected_bamboo_length_mm":1535,
          "profile":{"dimensions":{"id_mm":{"avg":120},"od_mm":{"avg":133},"length_mm":{"avg":125}}}}
    profile=resolve_profile(spec,initial_rules())
    assert not profile["unresolved"] and not profile["conflicts"]
    assert (rule(profile,"WINDER","cs")["min"],rule(profile,"WINDER","cs")["max"])==(190,210)
    assert rule(profile,"OVEN","cs")["min"]==500 and rule(profile,"PROCESS","cs")["min"]==500 and rule(profile,"PROCESS","cs")["max"]==535
    assert (rule(profile,"WINDER","id")["min"],rule(profile,"WINDER","id")["max"])==(120.3,120.7)
    assert rule(profile,"PROCESS","id")["min"]==120.2 and rule(profile,"PROCESS","id")["max"]==120.5
    assert (rule(profile,"WINDER","od")["min"],rule(profile,"WINDER","od")["max"])==(133.8,134.2)
    assert (rule(profile,"WINDER","height")["min"],rule(profile,"WINDER","height")["max"])==(1520,1550)
    assert (rule(profile,"PROCESS","height")["min"],rule(profile,"PROCESS","height")["max"])==(124.8,125.2)
    assert (rule(profile,"PROCESS","weight")["min"],rule(profile,"PROCESS","weight")["max"])==(240,250)


def test_moisture_is_optional_but_reported(profile):
    # Client rule 2026-10-17: oven pre/post moisture and process moisture never hold a batch or a stage.
    oven=[evaluate_samples("OVEN",profile,[{"sample_id":sid,"readings":{"pre_weight":100,"post_weight":91,"cs":410}}]) for sid in ("a","b")]
    assert all(e["verdict"]=="PASS" for e in oven)
    assert [u["parameter"] for u in oven[0]["unrecorded"]]==["pre_moisture","post_moisture"]
    ready=stage_readiness("OVEN",profile,oven)
    assert ready["ready"] and not ready["missing"]
    assert {u["parameter"] for u in ready["unrecorded"]}=={"pre_moisture","post_moisture"}
    recorded=[evaluate_samples("OVEN",profile,[{"sample_id":sid,"readings":{"pre_weight":100,"post_weight":91,"cs":410,"pre_moisture":11,"post_moisture":8}}]) for sid in ("a","b")]
    assert "unrecorded" not in recorded[0] and stage_readiness("OVEN",profile,recorded)["unrecorded"]==[]
    # Other checks stay required, and a recorded moisture outside its band still fails.
    assert not stage_readiness("OVEN",profile,[evaluate_samples("OVEN",profile,[{"sample_id":"a","readings":{"pre_moisture":10}}])])["ready"]
    banded=resolve_profile({"id_min_mm":76.2,"id_max_mm":76.6,"od_min_mm":81,"od_max_mm":81,"length_min_mm":149.8,"length_max_mm":150.2,"target_tube_weight":120,"cs_min_n":400,"required_cs":400,"mandrel_diameter_mm":76.3,"selected_bamboo_length_mm":1560,"moisture_min_pct":6,"moisture_max_pct":8},initial_rules())
    assert evaluate_samples("PROCESS",banded,[{"sample_id":"a","readings":{"moisture":9}}])["verdict"]=="FAIL"
    assert evaluate_samples("WINDER",profile,[{"sample_id":"a","readings":{"id":76.3}}]).get("unrecorded") is None
