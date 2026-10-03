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
