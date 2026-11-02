#!/usr/bin/env python3
"""Go-live clean-up of test masters and test specifications. Preview by default.

Owner decision (2 Nov 2026): after the transaction reset, test specifications (made by
acceptance / e2e / verify runs) are removed with their recipes, values and bindings, and
test masters are DEACTIVATED (never deleted). A row is touched only when one of its own
text fields carries a clear test marker (SEASON_VERIFY, Season acceptance, GoLive, E2E,
ZZDUP/ZZCHK, CHK codes, verify.checker, Disposable, P4SELF, test e-mails ...). Masters
without a marker are never touched.

    # preview: writes cleanup-preview.json + cleanup-preview.txt, prints the fingerprint
    python scripts/season/cleanup_test_masters.py --out /tmp/cleanup
    # apply exactly the reviewed list (the fingerprint must match a fresh preview)
    python scripts/season/cleanup_test_masters.py --out /tmp/cleanup --apply --expect-fingerprint <fp>

Database settings come from DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / ERP_DB_PREFIX
(inside the erp-app container they are already set). Take a backup before --apply
(the AWS wrapper does). Idempotent: a second run finds nothing left to change.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

# Clear test markers. Each is searched in the listed text columns of a row.
MARKERS = [
    ("SEASON_VERIFY", re.compile(r"SEASON[_ ]VERIFY", re.I)),
    ("Season acceptance", re.compile(r"\bseason acceptance\b", re.I)),
    ("Acceptance", re.compile(r"\bacceptance\b", re.I)),
    ("GoLive", re.compile(r"\bgo-?live\b", re.I)),
    ("E2E", re.compile(r"(?<![A-Z0-9])E2E(?![A-Z])", re.I)),
    ("ZZDUP/ZZCHK", re.compile(r"\bZZ(DUP|CHK)", re.I)),
    ("verify.checker", re.compile(r"\bverify[. ]checker\b", re.I)),
    ("Checker", re.compile(r"\bchecker\d*\b", re.I)),
    ("Disposable", re.compile(r"\bdisposable\b", re.I)),
    ("P4SELF", re.compile(r"\bP4\s?SELF\b|\bP4 admin tester\b", re.I)),
    ("Scope test", re.compile(r"\bscope test\b", re.I)),
    ("Throwaway/probe", re.compile(r"\bthrowaway\b|^SO-PROBE", re.I)),
    ("OSnn test", re.compile(r"\bOS\d+ test\b", re.I)),
    ("Month-end check", re.compile(r"\bmonth-end check\b", re.I)),
]
# Codes only: CHK as its own token (CHK-UI, CHK3, R2-CHK) -- never "Chokshi".
CODE_MARKERS = [("CHK code", re.compile(r"(^|[^A-Z])CHK([^A-Z]|$)", re.I))]
# Users only: disposable addresses made by the test suites.
EMAIL_MARKERS = [
    ("test e-mail", re.compile(r"@(example\.(com|org|net)|test\.[a-z]+)$|^test\.|e2e@|^season-[a-z]+-[0-9a-f]{6,}@", re.I)),
]

# (db, table, key column, columns shown in the list, text columns searched, code columns, active columns, kind)
MASTERS = [
    ("masterdb", "customer", "id", ["customer_code", "name"], ["customer_code", "name", "address", "primary_contact_name", "dispatch_contact_name", "primary_contact_email", "contact_email"], ["customer_code"], ["active"], "customer"),
    ("masterdb", "customer_contact", "id", ["contact_name", "contact_email"], ["contact_name", "contact_email", "notes"], [], ["active"], "customer contact"),
    ("masterdb", "supplier", "id", ["supplier_code", "name"], ["supplier_code", "name", "legal_name", "trade_name", "contact_name", "contact_email", "bank_name", "notes"], ["supplier_code"], ["active"], "vendor"),
    ("masterdb", "supplier_contact", "id", ["contact_name", "contact_email"], ["contact_name", "contact_email", "notes"], [], ["active"], "vendor contact"),
    ("masterdb", "paper_master", "id", ["code", "variety"], ["code", "variety"], ["code"], ["active"], "paper"),
    ("masterdb", "machine", "id", ["code", "name"], ["code", "name"], ["code"], ["active", "is_active"], "machine"),
    ("masterdb", "employee", "id", ["employee_code", "name"], ["employee_code", "name", "email", "skills"], ["employee_code"], ["active"], "employee"),
    ("masterdb", "parchment_vendor", "id", ["name"], ["name"], [], ["active"], "parchment vendor"),
    ("masterdb", "parchment_color", "id", ["color_name"], ["color_name"], [], ["active"], "parchment colour"),
    ("masterdb", "packaging_box", "id", ["code", "size_label"], ["code", "size_label"], ["code"], ["active"], "box"),
    ("masterdb", "packaging_plastic_sheet", "id", ["sku", "size_label"], ["sku", "size_label"], ["sku"], ["active"], "plastic sheet"),
    ("masterdb", "packaging_fadda", "id", ["sku"], ["sku"], ["sku"], ["active"], "fadda"),
    ("masterdb", "adhesive_master", "id", ["internal_code", "name"], ["name", "variety", "internal_code"], ["internal_code"], ["active"], "adhesive"),
    ("masterdb", "mandrel", "id", ["mandrel_code", "outer_diameter_mm"], ["mandrel_code"], ["mandrel_code"], ["active"], "mandrel"),
    ("masterdb", "tube_size", "id", ["inner_diameter_mm", "outer_diameter_mm", "length_mm", "description"], ["description"], [], ["active"], "tube size"),
    ("masterdb", "reason_code", "id", ["category", "code", "label"], ["code", "label", "description"], ["code"], ["active"], "reason code"),
    ("masterdb", "tool_master", "id", ["name"], ["name"], [], ["active"], "tool"),
    ("authdb", "users", "id", ["email", "name"], ["email", "name"], [], ["is_active"], "user"),
    ("authdb", "plants", "id", ["code", "name"], ["code", "name", "legal_name"], ["code"], ["is_active"], "plant"),
    ("inventorydb", "item_master", "id", ["item_code", "name"], ["item_code", "name"], ["item_code"], ["active"], "stock item"),
    ("inventorydb", "inventory_locations", "id", ["code", "name"], ["code", "name"], ["code"], ["active"], "stock location"),
]
DATABASES = ["authdb", "masterdb", "specdb", "salesdb", "productiondb", "inventorydb", "analyticsdb"]


def db_url(name: str) -> URL:
    return URL.create(
        "postgresql+psycopg2",
        username=os.getenv("DB_USER", os.getenv("USER", "postgres")),
        password=os.getenv("DB_PASSWORD") or None,
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("ERP_DB_PREFIX", "") + name,
    )


def is_active(value) -> bool:
    return str(value).lower() in {"true", "t", "1"}


def find_markers(row, columns, code_columns, email=False) -> list[str]:
    found = []
    for column in columns:
        value = row.get(column)
        if not value:
            continue
        value = str(value)
        for label, pattern in MARKERS:
            if pattern.search(value):
                found.append(f"{label} in {column}: {value[:80]}")
        if column in code_columns:
            for label, pattern in CODE_MARKERS:
                if pattern.search(value):
                    found.append(f"{label} in {column}: {value[:80]}")
        if email and column == "email":
            for label, pattern in EMAIL_MARKERS:
                if pattern.search(value):
                    found.append(f"{label}: {value}")
    return found


def plan(engines, protected_users: set[str]) -> dict:
    deactivate, skipped, already = [], [], 0
    marked_ids: dict[str, set[str]] = {}
    for db, table, key, shown, columns, codes, actives, kind in MASTERS:
        with engines[db].connect() as c:
            present = set(c.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:t"), {"t": table}).scalars())
            if not present:
                continue
            cols = [col for col in columns if col in present]
            act = [col for col in actives if col in present]
            extra = ", is_receiving_default" if table == "inventory_locations" else ""
            rows = c.execute(text(f'SELECT "{key}", {", ".join(chr(34) + col + chr(34) for col in sorted(set(cols + [s for s in shown if s in present] + act)))}{extra} FROM "{table}"')).mappings().all()
            roles = {}
            if table == "users":
                roles = {str(r[0]): set(r[1] or []) for r in c.execute(text("SELECT ur.user_id, array_agg(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id GROUP BY ur.user_id"))}
        for row in rows:
            row = dict(row)
            marks = find_markers(row, cols, codes, email=(table == "users"))
            if not marks:
                continue
            row_id = str(row[key])
            marked_ids.setdefault(table, set()).add(row_id)
            label = " · ".join(str(row.get(s)) for s in shown if row.get(s) not in (None, ""))
            item = {"db": db, "table": table, "kind": kind, "id": row_id, "label": label, "markers": marks[:3], "columns": act}
            if not any(is_active(row.get(col)) for col in act):
                already += 1
                continue
            if table == "users":
                email = str(row.get("email") or "").strip().lower()
                item["roles"] = sorted(roles.get(row_id, []))
                if email in protected_users:
                    skipped.append({**item, "why": "protected account (import / bootstrap / --keep-user)"})
                    continue
            if table == "inventory_locations" and row.get("is_receiving_default"):
                skipped.append({**item, "why": "default receiving location; change the default first"})
                continue
            deactivate.append(item)
    # Never leave the system without an active Owner/Admin.
    with engines["authdb"].connect() as c:
        admins = {str(r[0]) for r in c.execute(text("SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.is_active AND r.name IN ('Owner','Admin')"))}
    going = {item["id"] for item in deactivate if item["table"] == "users"}
    if admins and not (admins - going):
        raise SystemExit("Refusing: every active Owner/Admin account carries a test marker. Pass --keep-user <email> for the real one.")
    specs = plan_specs(engines, marked_ids)
    actions = [{k: item[k] for k in ("table", "id")} | {"action": "deactivate"} for item in deactivate]
    actions += [{"table": "specification_sheet", "id": spec["id"], "action": "delete"} for spec in specs["delete"]]
    actions.sort(key=lambda a: (a["table"], a["id"], a["action"]))
    fingerprint = hashlib.sha256(json.dumps(actions, sort_keys=True).encode()).hexdigest()
    return {"deactivate": deactivate, "skipped": skipped, "already_inactive_with_marker": already, "specs": specs, "fingerprint": fingerprint}


def plan_specs(engines, marked_ids) -> dict:
    """Test specs: customer or tube size is a marked test master, or the spec's own customer name carries a marker."""
    test_customers = marked_ids.get("customer", set())
    test_tubes = marked_ids.get("tube_size", set())
    with engines["specdb"].connect() as c:
        rows = c.execute(text("SELECT id, customer_id, customer_name, tube_size_id, version, status, active, lineage_id, supersedes_spec_id FROM specification_sheet")).mappings().all()
    delete, keep_refs = [], []
    for row in rows:
        marks = []
        if row["customer_id"] and str(row["customer_id"]) in test_customers:
            marks.append("customer is a test master")
        if str(row["tube_size_id"]) in test_tubes:
            marks.append("tube size is a test master")
        marks += find_markers(dict(row), ["customer_name"], [])
        if marks:
            delete.append({"id": str(row["id"]), "customer": row["customer_name"], "version": row["version"], "status": row["status"], "markers": marks[:3]})
    ids = {spec["id"] for spec in delete}
    for row in rows:
        if str(row["id"]) not in ids and {str(row["lineage_id"] or ""), str(row["supersedes_spec_id"] or "")} & ids:
            keep_refs.append(str(row["id"]))
    if keep_refs:
        raise SystemExit(f"Refusing: specs without a test marker are versions of test specs: {keep_refs}")
    children = {}
    if ids:
        id_list = sorted(ids)
        with engines["specdb"].connect() as c:
            recipes = [str(r[0]) for r in c.execute(text("SELECT id FROM recipe_header WHERE spec_id::text = ANY(:ids)"), {"ids": id_list})]
            children["recipes"] = len(recipes)
            children["values"] = c.execute(text("SELECT count(*) FROM spec_dynamic_field_values WHERE spec_id::text = ANY(:ids)"), {"ids": id_list}).scalar()
            children["bindings"] = c.execute(text("SELECT count(*) FROM spec_season_recipe_bindings WHERE spec_id::text = ANY(:ids)"), {"ids": id_list}).scalar()
        # Orders and job cards must be gone (run the transaction reset first).
        refs = {}
        for db, sql in (("salesdb", "SELECT count(*) FROM sales_order_lines WHERE approved_spec_id::text = ANY(:ids)"),
                        ("productiondb", "SELECT count(*) FROM job_cards WHERE spec_id::text = ANY(:ids)")):
            with engines[db].connect() as c:
                try:
                    refs[db] = c.execute(text(sql), {"ids": id_list}).scalar()
                except Exception:  # column/table missing in an older schema: treat as no reference
                    c.rollback()
                    refs[db] = 0
        if any(refs.values()):
            raise SystemExit(f"Refusing: orders or job cards still use test specs {refs}; run the transaction reset first.")
    return {"delete": delete, "children": children}


def delete_specs(engine, ids: list[str]) -> dict:
    counts = {}
    with engine.begin() as c:
        recipes = [str(r[0]) for r in c.execute(text("SELECT id FROM recipe_header WHERE spec_id::text = ANY(:ids)"), {"ids": ids})]
        fks = c.execute(text("""SELECT src.relname, att.attname, tgt.relname FROM pg_constraint f
            JOIN pg_class src ON src.oid = f.conrelid JOIN pg_class tgt ON tgt.oid = f.confrelid
            JOIN pg_attribute att ON att.attrelid = f.conrelid AND att.attnum = f.conkey[1]
            WHERE f.contype = 'f' AND tgt.relname IN ('specification_sheet', 'recipe_header') AND src.relnamespace = 'public'::regnamespace""")).all()
        # Rows that point at the test specs/recipes without a foreign key.
        loose = [("season_qc_overlay_versions", "target_id", ids + recipes), ("season_release_authorizations", "spec_id", ids)]
        for table, column, values in loose:
            if values:
                counts[table] = counts.get(table, 0) + c.execute(text(f'DELETE FROM "{table}" WHERE "{column}"::text = ANY(:v)'), {"v": values}).rowcount
        # Children of recipes first (layers, trials, bindings), then children of specs, then recipes, then specs.
        for source, column, target in sorted(fks, key=lambda f: (f[2] != "recipe_header", f[0])):
            if source in ("recipe_header", "specification_sheet"):
                continue
            values = recipes if target == "recipe_header" else ids
            if values:
                counts[source] = counts.get(source, 0) + c.execute(text(f'DELETE FROM "{source}" WHERE "{column}"::text = ANY(:v)'), {"v": values}).rowcount
        counts["recipe_header"] = c.execute(text("DELETE FROM recipe_header WHERE spec_id::text = ANY(:ids)"), {"ids": ids}).rowcount
        counts["specification_sheet"] = c.execute(text("DELETE FROM specification_sheet WHERE id::text = ANY(:ids)"), {"ids": ids}).rowcount
    return counts


def deactivate(engines, items) -> dict:
    counts = {}
    by_table = {}
    for item in items:
        by_table.setdefault((item["db"], item["table"], tuple(item["columns"])), []).append(item["id"])
    for (db, table, columns), ids in by_table.items():
        with engines[db].begin() as c:
            types = dict(c.execute(text("SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:t"), {"t": table}).all())
            sets = ", ".join(f'"{col}" = ' + ("'false'" if types.get(col) != "bool" else "false") for col in columns)
            counts[table] = c.execute(text(f'UPDATE "{table}" SET {sets} WHERE id::text = ANY(:ids)'), {"ids": ids}).rowcount
    return counts


def text_report(result: dict, applied: bool) -> str:
    lines = [f"Test-data clean-up {'APPLIED' if applied else 'PREVIEW'} · {result['created_at']}", f"Fingerprint: {result['fingerprint']}", ""]
    specs = result["specs"]["delete"]
    lines.append(f"DELETE {len(specs)} test specification(s) with {result['specs']['children'].get('recipes', 0)} recipe(s), "
                 f"{result['specs']['children'].get('values', 0)} field value(s), {result['specs']['children'].get('bindings', 0)} season binding(s):")
    lines += [f"  - {s['customer']} v{s['version']} ({s['status']}) {s['id']}  [{'; '.join(s['markers'])}]" for s in specs] or ["  (none)"]
    lines.append("")
    lines.append(f"DEACTIVATE {len(result['deactivate'])} test master(s) (kept in the database, can be reactivated):")
    kinds = {}
    for item in result["deactivate"]:
        kinds.setdefault(item["kind"], []).append(item)
    for kind, items in kinds.items():
        lines.append(f"  {kind} ({len(items)}):")
        for item in items:
            role = f" roles {','.join(item['roles'])}" if item.get("roles") else ""
            lines.append(f"    - {item['label']}{role}  [{item['markers'][0]}]")
    if result["skipped"]:
        lines.append("")
        lines.append("NOT TOUCHED although marked:")
        lines += [f"  - {i['kind']} {i['label']}: {i['why']}" for i in result["skipped"]]
    lines.append("")
    lines.append(f"Already inactive with a marker (left as they are): {result['already_inactive_with_marker']}")
    if result.get("applied_counts"):
        lines.append(f"Rows changed: {json.dumps(result['applied_counts'], sort_keys=True)}")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, help="Directory for cleanup-preview/applied .json and .txt")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expect-fingerprint", default="", help="Fingerprint printed by the reviewed preview (required with --apply)")
    parser.add_argument("--keep-user", action="append", default=[], help="E-mail of an account that must stay active (repeatable)")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    protected = {email.strip().lower() for email in args.keep_user + [os.getenv("BOOTSTRAP_ADMIN_EMAIL", ""), os.getenv("ERP_IMPORT_AS", ""), "admin@hariom.com"] if email.strip()}
    engines = {name: create_engine(db_url(name)) for name in DATABASES}
    result = plan(engines, protected)
    result["created_at"] = datetime.now(timezone.utc).isoformat()
    result["protected_users"] = sorted(protected)
    nothing = not result["deactivate"] and not result["specs"]["delete"]
    if args.apply and nothing:
        print("Nothing left to clean up (already applied); no rows changed")
        args.apply = False
    if args.apply:
        if not args.expect_fingerprint:
            raise SystemExit("--apply needs --expect-fingerprint from the reviewed preview")
        if args.expect_fingerprint != result["fingerprint"]:
            raise SystemExit(f"The clean-up list changed since the reviewed preview (now {result['fingerprint']}). Run the preview again and review it.")
        counts = deactivate(engines, result["deactivate"])
        ids = [spec["id"] for spec in result["specs"]["delete"]]
        if ids:
            counts.update({f"deleted {k}": v for k, v in delete_specs(engines["specdb"], ids).items()})
        result["applied_counts"] = counts
    name = "cleanup-applied" if args.apply else "cleanup-preview"
    (out / f"{name}.json").write_text(json.dumps(result, indent=1, default=str))
    report = text_report(result, args.apply)
    (out / f"{name}.txt").write_text(report)
    print(report)
    print(f"CLEANUP_FINGERPRINT={result['fingerprint']}")


if __name__ == "__main__":
    main()
