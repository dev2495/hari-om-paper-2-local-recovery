"""Versioned seasonal manufacturing QC. Pure functions; no database or eval.

Incoming QC and legacy snapshots keep their existing evaluator. Values are
compared as decimals, never rounded into a pass. Missing observations are pending.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import hashlib
import json

SEASONS = ("ROY", "MONSOON")
PARAMETERS = {
    "WINDER": {"id": ("I.D.", "mm"), "od": ("O.D.", "mm"), "height": ("Bamboo length", "mm"), "weight": ("Weight", "g"), "cs": ("C.S.", "N")},
    "OVEN": {"pre_weight": ("Pre-weight", "g"), "post_weight": ("Post-weight", "g"), "pre_moisture": ("Pre-moisture", "%"), "post_moisture": ("Post-moisture", "%"), "cs": ("C.S.", "N")},
    "PROCESS": {"id": ("I.D.", "mm"), "od": ("O.D.", "mm"), "height": ("Height", "mm"), "weight": ("Weight", "g"), "cs": ("C.S.", "N"), "notch_distance": ("Notch distance", "mm"), "notch_depth": ("Notch depth", "mm"), "moisture": ("Moisture", "%")},
}
REFS = {"CUSTOMER_ID", "CUSTOMER_OD", "CUSTOMER_LENGTH", "CUSTOMER_WEIGHT", "CUSTOMER_CS", "MANDREL_DIAMETER", "WINDING_LENGTH", "MOISTURE_MIN", "MOISTURE_MAX", "CONST", "SAMPLE.pre_weight"}


class RuleError(ValueError):
    pass


def decimal(value):
    if isinstance(value, bool) or value in (None, ""):
        raise RuleError("A finite number is required")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise RuleError("A finite number is required") from exc
    if not result.is_finite():
        raise RuleError("A finite number is required")
    return result


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False).encode()).hexdigest()


def term(ref, factor=1, offset=0):
    return {"ref": ref, "factor": factor, "offset": offset}


def initial_rules():
    rows = []
    def add(stage, code, lower=(), upper=(), **extra):
        label, unit = PARAMETERS[stage][code]
        rows.append({"rule_id": f"{stage}:{code}", "stage": stage, "parameter": code, "label": label, "unit": unit, "mode": "BAND" if lower or upper else "RECORD_ONLY", "lower": list(lower), "upper": list(upper), "required": True, "min_readings": 2, "gating": "blocking", "non_waivable": False, "applicability": "ALWAYS", "on_missing_ref": "BLOCK", **extra})
    add("WINDER", "id", [term("MANDREL_DIAMETER", offset=-.2), term("CUSTOMER_ID")], [term("MANDREL_DIAMETER", offset=.2)])
    add("WINDER", "od", [term("CUSTOMER_OD", offset=.8)], [term("CUSTOMER_OD", offset=1.2)])
    add("WINDER", "height", [term("WINDING_LENGTH", offset=-15)], [term("WINDING_LENGTH", offset=15)])
    add("WINDER", "weight")
    add("WINDER", "cs", [term("CUSTOMER_CS", .4)], [term("CUSTOMER_CS", .4, 10)])
    add("OVEN", "pre_weight")
    add("OVEN", "post_weight", [term("SAMPLE.pre_weight", .90)], [term("SAMPLE.pre_weight", .92)])
    add("OVEN", "pre_moisture")
    add("OVEN", "post_moisture")
    add("OVEN", "cs", [term("CUSTOMER_CS")])
    add("PROCESS", "id", [term("CUSTOMER_ID", offset=.2)])
    add("PROCESS", "od")
    add("PROCESS", "height", [term("CUSTOMER_LENGTH", offset=-.2)], [term("CUSTOMER_LENGTH", offset=.2)])
    add("PROCESS", "weight", [term("CUSTOMER_WEIGHT", offset=-5)], [term("CUSTOMER_WEIGHT", offset=5)])
    add("PROCESS", "cs", [term("CUSTOMER_CS")])
    add("PROCESS", "notch_distance", applicability="NOTCHING")
    add("PROCESS", "notch_depth", applicability="NOTCHING")
    add("PROCESS", "moisture", [term("MOISTURE_MIN")], [term("MOISTURE_MAX")], on_missing_ref="RECORD_ONLY")
    return rows


def validate_rules(rows, *, overlay=False):
    if not isinstance(rows, list) or len(rows) > 100:
        raise RuleError("Rules must be a bounded list")
    seen = set()
    clean = deepcopy(rows)
    for row in clean:
        if not isinstance(row, dict):
            raise RuleError("Rule must be an object")
        key = (row.get("stage"), row.get("parameter"))
        if key[0] not in PARAMETERS or key[1] not in PARAMETERS[key[0]] or key in seen:
            raise RuleError("Unknown or duplicate stage parameter")
        seen.add(key)
        if row.get("mode") not in ("BAND", "RECORD_ONLY"):
            raise RuleError("Unknown rule mode")
        if row.get("required") is not True or type(row.get("min_readings")) is not int or not 2 <= row["min_readings"] <= 10:
            raise RuleError("Required parameters need at least two samples")
        if row.get("gating") not in ("blocking", "advisory") or row.get("on_missing_ref") not in ("BLOCK", "RECORD_ONLY"):
            raise RuleError("Unknown gating or missing-reference policy")
        if type(row.get("requires_instrument",False)) is not bool:
            raise RuleError("Instrument requirement must be true or false")
        expected_applicability = "NOTCHING" if key[1].startswith("notch_") else "ALWAYS"
        if row.get("applicability", "ALWAYS") != expected_applicability:
            raise RuleError("Required parameter applicability cannot be disabled")
        row["applicability"] = expected_applicability
        row["label"], row["unit"] = PARAMETERS[key[0]][key[1]]
        for side in ("lower", "upper"):
            values = row.get(side, [])
            if not isinstance(values, list) or len(values) > 8:
                raise RuleError("Bounds must contain at most eight terms")
            for value in values:
                if not isinstance(value, dict) or value.get("ref") not in REFS:
                    raise RuleError("Unknown bound reference")
                if value["ref"].startswith("SAMPLE.") and key != ("OVEN", "post_weight"):
                    raise RuleError("Only paired oven post-weight may reference pre-weight")
                decimal(value.get("factor", 1)); decimal(value.get("offset", 0))
        if row["mode"] == "BAND" and not row.get("lower") and not row.get("upper"):
            raise RuleError("Band requires a lower or upper bound")
        if row["mode"] == "RECORD_ONLY" and (row.get("lower") or row.get("upper")):
            raise RuleError("Record-only rule cannot contain bounds")
    if not overlay and seen != {(s, p) for s, ps in PARAMETERS.items() for p in ps}:
        raise RuleError("Global rules must cover every required parameter")
    return clean


def spec_references(spec, dynamic=None):
    dynamic = dynamic or {}
    def positive(value):
        try:
            return float(decimal(value)) if decimal(value) > 0 else None
        except RuleError:
            return None
    def midpoint(prefix):
        band = ((spec.get("profile") or {}).get("dimensions") or {}).get(prefix+"_mm") or {}
        nominal = positive(band.get("avg"))
        if nominal is not None:
            return nominal
        a, b = spec.get(prefix + "_min_mm"), spec.get(prefix + "_max_mm")
        try:
            return float((decimal(a) + decimal(b))/2) if a is not None and b is not None else positive(a or b)
        except RuleError:
            return None
    return {
        "CUSTOMER_ID": positive(spec.get("id_min_mm")),
        "CUSTOMER_OD": midpoint("od"), "CUSTOMER_LENGTH": midpoint("length"),
        "CUSTOMER_WEIGHT": positive(spec.get("target_tube_weight")) or (float((decimal(spec["weight_min_g"])+decimal(spec["weight_max_g"]))/2) if spec.get("weight_min_g") is not None and spec.get("weight_max_g") is not None else None),
        "CUSTOMER_CS": positive(spec.get("cs_min_n")) or positive(spec.get("required_cs")),
        "MANDREL_DIAMETER": positive(spec.get("mandrel_diameter_mm")),
        "WINDING_LENGTH": positive(spec.get("selected_bamboo_length_mm") or dynamic.get("selected_bamboo_length_mm")),
        "MOISTURE_MIN": spec.get("moisture_min_pct"), "MOISTURE_MAX": spec.get("moisture_max_pct"),
    }


def bound(terms, refs, sample, side):
    values = []
    missing = []
    for item in terms:
        ref = item["ref"]
        raw = 0 if ref == "CONST" else sample.get(ref[7:]) if ref.startswith("SAMPLE.") else refs.get(ref)
        try:
            values.append(decimal(raw)*decimal(item.get("factor", 1))+decimal(item.get("offset", 0)))
        except RuleError:
            missing.append(ref)
    return (max(values) if side == "lower" else min(values)) if values else None, missing


def resolve_profile(spec, rules, overlays=(), *, season="ROY", provenance=None, notching=False):
    refs = spec_references(spec)
    effective = {(r["stage"], r["parameter"]): deepcopy(r) for r in validate_rules(rules)}
    for overlay in overlays:
        for row in validate_rules(overlay["rows"], overlay=True):
            effective[(row["stage"], row["parameter"])] = {**row, "overlay_id": overlay.get("id"), "overlay_version": overlay.get("version")}
    result = {"schema_version": 2, "source": "GLOBAL_RULES", "season": season, "status": "approved", "refs": refs, "provenance": provenance or {}, "stages": {}, "unresolved": [], "conflicts": []}
    contractual = {"id": ("id_min_mm", "id_max_mm"), "od": ("od_min_mm", "od_max_mm"), "height": ("length_min_mm", "length_max_mm"), "weight": ("weight_min_g", "weight_max_g"), "cs": ("cs_min_n", "cs_max_n")}
    for (stage, code), row in effective.items():
        applicable = row["applicability"] != "NOTCHING" or notching
        rule = {**row, "code": code, "applicable": applicable, "min": None, "max": None, "dynamic": any(t["ref"].startswith("SAMPLE.") for side in ("lower", "upper") for t in row.get(side, []))}
        lo, ml = bound([t for t in row.get("lower", []) if not t["ref"].startswith("SAMPLE.")], refs, {}, "lower")
        hi, mh = bound([t for t in row.get("upper", []) if not t["ref"].startswith("SAMPLE.")], refs, {}, "upper")
        missing = ml+mh
        if missing and row["on_missing_ref"] == "RECORD_ONLY":
            # Moisture can be one-sided; downgrade only if neither side resolves.
            if lo is None and hi is None:
                rule.update(mode="RECORD_ONLY", lower=[], upper=[])
            else:
                for side in ("lower", "upper"):
                    rule[side] = [t for t in rule[side] if t["ref"] not in missing]
            missing = []
        if stage == "PROCESS" and code in contractual:
            low_key, high_key = contractual[code]
            if spec.get(low_key) is not None:
                lo = max(lo, decimal(spec[low_key])) if lo is not None else decimal(spec[low_key])
            if spec.get(high_key) is not None:
                hi = min(hi, decimal(spec[high_key])) if hi is not None else decimal(spec[high_key])
            if lo is not None or hi is not None:
                rule["mode"] = "BAND"
        if applicable and missing:
            result["unresolved"].append({"stage": stage, "parameter": code, "refs": missing})
        if applicable and lo is not None and hi is not None and lo > hi:
            result["conflicts"].append({"stage": stage, "parameter": code, "min": float(lo), "max": float(hi)})
        rule["min"], rule["max"] = float(lo) if lo is not None else None, float(hi) if hi is not None else None
        result["stages"].setdefault(stage, {"parameters": []})["parameters"].append(rule)
    result["fingerprint"] = fingerprint(result)
    return result


def evaluate_samples(stage, profile, samples):
    parameters = profile.get("stages", {}).get(stage, {}).get("parameters", [])
    rows, seen = [], set()
    for sample in samples:
        sid = str(sample.get("sample_id") or "").strip()
        if not sid or sid in seen:
            raise RuleError("Samples need distinct stable sample IDs")
        seen.add(sid)
        readings = sample.get("readings", {})
        if not isinstance(readings, dict) or set(readings)-{r["code"] for r in parameters}:
            raise RuleError("Unknown measurement parameter")
        for rule in parameters:
            code = rule["code"]
            if not rule["applicable"] or code not in readings or readings[code] in (None, ""):
                continue
            item = {"sample_id": sid, "parameter": code, "value": readings[code], "gating": rule["gating"], "non_waivable": rule.get("non_waivable", False)}
            try:
                value = decimal(readings[code])
                if value < 0 or (rule["unit"] == "%" and value > 100) or (rule["unit"] in ("g", "N", "mm") and not code.startswith("notch_") and value <= 0):
                    raise RuleError("Measurement outside physical range")
                lo = decimal(rule["min"]) if rule.get("min") is not None else None
                hi = decimal(rule["max"]) if rule.get("max") is not None else None
                if rule.get("dynamic"):
                    dl, ml = bound(rule["lower"], profile["refs"], readings, "lower")
                    dh, mh = bound(rule["upper"], profile["refs"], readings, "upper")
                    if ml or mh:
                        item.update(verdict="INCOMPLETE", message="Paired pre-weight is required")
                        rows.append(item); continue
                    lo = max(lo, dl) if lo is not None and dl is not None else dl if dl is not None else lo
                    hi = min(hi, dh) if hi is not None and dh is not None else dh if dh is not None else hi
                item.update(min=float(lo) if lo is not None else None, max=float(hi) if hi is not None else None)
                if rule["mode"] == "RECORD_ONLY":
                    verdict = "OBSERVATION_ONLY"
                elif lo is None and hi is None:
                    verdict = "INCOMPLETE"
                else:
                    verdict = "PASS" if (lo is None or value >= lo) and (hi is None or value <= hi) else "FAIL"
                item.update(verdict=verdict, value=float(value))
            except RuleError as exc:
                item.update(verdict="INVALID", message=str(exc))
            rows.append(item)
    # A recorded weight/moisture does not erase a measured tolerance PASS.
    # An entry containing only record-only fields still remains observation-only.
    rank = {"OBSERVATION_ONLY": 0, "PASS": 1, "INCOMPLETE": 2, "INVALID": 3, "FAIL": 4}
    return {"verdict": max((r["verdict"] for r in rows), key=rank.get) if rows else "NOT_MEASURED", "results": rows}


def stage_readiness(stage, profile, evaluations):
    samples = {}
    for evaluation in evaluations:
        for item in evaluation.get("results", []):
            samples[(item["sample_id"], item["parameter"])] = item
    missing, blockers = [], []
    for rule in profile.get("stages", {}).get(stage, {}).get("parameters", []):
        if not rule["applicable"]:
            continue
        rows = [r for (_, code), r in samples.items() if code == rule["code"]]
        valid = sum(r["verdict"] in ("PASS", "FAIL", "OBSERVATION_ONLY") for r in rows)
        if valid < rule["min_readings"]:
            missing.append({"parameter": rule["code"], "label": rule["label"], "have": valid, "need": rule["min_readings"]})
        blockers += [r for r in rows if r["verdict"] in ("INVALID", "INCOMPLETE") or r["verdict"] == "FAIL" and r["gating"] == "blocking"]
    return {"ready": not missing and not blockers, "missing": missing, "blockers": blockers}


def potentially_loosens(parent_rows, rows):
    parent = {(r["stage"], r["parameter"]): r for r in parent_rows}
    for row in rows:
        old = parent.get((row["stage"], row["parameter"]))
        if old is None or row.get("min_readings", 0) < old.get("min_readings", 2) or old.get("non_waivable") and not row.get("non_waivable") or old.get("gating") == "blocking" and row.get("gating") != "blocking":
            return True
        # Equal expressions are provably contained. Any changed formula needs
        # review rather than guessing containment using one selected spec.
        if any(row.get(k) != old.get(k) for k in ("mode", "lower", "upper", "required", "applicability", "on_missing_ref")):
            return True
    return False
