#!/usr/bin/env bash
# Isolated seven-database dump/restore rehearsal.
# Does NOT touch production. Does NOT drop hariom_nverify_* candidate DBs.
# Restores into disposable hariom_nverify_restore_* databases.
set -euo pipefail

HOST="${PGHOST:-127.0.0.1}"
USER_NAME="${PGUSER:-$USER}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT_DIR="${ROOT}/reports/nverify-restore-${STAMP}"
mkdir -p "${OUT_DIR}"

SERVICES=(auth master spec sales production inventory analytics)
SOURCE_DBS=(
  hariom_nverify_authdb
  hariom_nverify_masterdb
  hariom_nverify_specdb
  hariom_nverify_salesdb
  hariom_nverify_productiondb
  hariom_nverify_inventorydb
  hariom_nverify_analyticsdb
)

echo "restore_rehearsal_start ${STAMP}" | tee "${OUT_DIR}/summary.txt"
START_NS="$(python3 -c 'import time; print(time.time())')"

for i in "${!SERVICES[@]}"; do
  src="${SOURCE_DBS[$i]}"
  dest="hariom_nverify_restore_${SERVICES[$i]}"
  dump="${OUT_DIR}/${src}.dump"
  echo "=== ${src} -> ${dest} ===" | tee -a "${OUT_DIR}/summary.txt"
  dropdb --if-exists --host="${HOST}" --username="${USER_NAME}" "${dest}"
  createdb --host="${HOST}" --username="${USER_NAME}" "${dest}"
  pg_dump --host="${HOST}" --username="${USER_NAME}" --format=custom --no-owner --no-privileges --dbname="${src}" --file="${dump}"
  pg_restore --host="${HOST}" --username="${USER_NAME}" --no-owner --no-privileges --dbname="${dest}" "${dump}"
  python3 - <<PY | tee -a "${OUT_DIR}/summary.txt"
import subprocess, json
src = "${src}"
dest = "${dest}"
host = "${HOST}"
user = "${USER_NAME}"

def tables(db):
    sql = """
    SELECT c.relname, c.reltuples::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY 1
    """
    out = subprocess.check_output(["psql", "-h", host, "-U", user, "-d", db, "-At", "-F", ",", "-c", sql], text=True)
    rows = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        name, est = line.split(",", 1)
        count = subprocess.check_output(
            ["psql", "-h", host, "-U", user, "-d", db, "-At", "-c", f'SELECT COUNT(*) FROM public."{name}"'],
            text=True,
        ).strip()
        rows[name] = int(count)
    return rows

a, b = tables(src), tables(dest)
missing = sorted(set(a) - set(b))
extra = sorted(set(b) - set(a))
mismatched = sorted(name for name in a if name in b and a[name] != b[name])
print(json.dumps({
    "source": src,
    "dest": dest,
    "tables_source": len(a),
    "tables_dest": len(b),
    "row_total_source": sum(a.values()),
    "row_total_dest": sum(b.values()),
    "missing": missing,
    "extra": extra,
    "mismatched": {name: {"source": a[name], "dest": b[name]} for name in mismatched},
    "has_audit_outbox": "audit_outbox" in a,
    "audit_outbox": {"source": a.get("audit_outbox"), "dest": b.get("audit_outbox")},
    "quality_hold_tables": {name: {"source": a.get(name), "dest": b.get(name)} for name in a if "hold" in name.lower() or "outbox" in name.lower()},
}, indent=2, sort_keys=True))
if missing or extra or mismatched:
    raise SystemExit(f"RESTORE_MISMATCH {src} -> {dest}")
print(f"ROWCOUNT_PASS {src} -> {dest}")
PY
done

python3 - <<PY | tee -a "${OUT_DIR}/summary.txt"
import os, json, subprocess
user = os.environ.get("PGUSER") or os.environ.get("USER")
host = os.environ.get("PGHOST", "127.0.0.1")

def scalar(db, sql):
    return subprocess.check_output(["psql", "-h", host, "-U", user, "-d", db, "-At", "-c", sql], text=True).strip()

pending = {
    "inventory_holds": scalar("hariom_nverify_restore_inventory", "SELECT COUNT(*) FROM inventory_quality_holds"),
    "inventory_open_holds": scalar("hariom_nverify_restore_inventory", "SELECT COUNT(*) FROM inventory_quality_holds WHERE status = 'HOLD' AND released_at IS NULL"),
    "inventory_open_hold_qty": scalar("hariom_nverify_restore_inventory", "SELECT COALESCE(SUM(quantity),0) FROM inventory_quality_holds WHERE status = 'HOLD' AND released_at IS NULL"),
    "inventory_outbox_undelivered": scalar("hariom_nverify_restore_inventory", "SELECT COUNT(*) FROM audit_outbox WHERE delivered_at IS NULL"),
    "production_holds": scalar("hariom_nverify_restore_production", "SELECT COUNT(*) FROM quality_holds"),
    "production_outbox_undelivered": scalar("hariom_nverify_restore_production", "SELECT COUNT(*) FROM audit_outbox WHERE delivered_at IS NULL"),
    "sales_outbox_undelivered": scalar("hariom_nverify_restore_sales", "SELECT COUNT(*) FROM audit_outbox WHERE delivered_at IS NULL"),
    "source_inventory_open_holds": scalar("hariom_nverify_inventorydb", "SELECT COUNT(*) FROM inventory_quality_holds WHERE status = 'HOLD' AND released_at IS NULL"),
    "source_production_holds": scalar("hariom_nverify_productiondb", "SELECT COUNT(*) FROM quality_holds"),
}
assert pending["inventory_open_holds"] == pending["source_inventory_open_holds"]
assert pending["production_holds"] == pending["source_production_holds"]
print(json.dumps({"restore_pending_match": pending, "duplicate_posting_check": "row counts matched source; restore DBs are unused by the running stack"}))
PY

END_NS="$(python3 -c 'import time; print(time.time())')"
python3 - <<PY | tee -a "${OUT_DIR}/summary.txt"
import json
start=float("${START_NS}")
end=float("${END_NS}")
print(json.dumps({
  "result": "PASS",
  "kind": "synthetic_isolated_nverify_dump_restore",
  "not_production_backup_proof": True,
  "elapsed_seconds": round(end-start, 3),
  "output_dir": "${OUT_DIR}",
}))
PY
