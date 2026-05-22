#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
resolve_runtime_dir() {
  local erp_dir="$1"
  if [[ -n "${ERP_RUNTIME_DIR:-}" ]]; then
    echo "${ERP_RUNTIME_DIR}"
    return
  fi
  if [[ -d "${erp_dir}/runtime" || ! -e "${erp_dir}/.runtime" ]]; then
    echo "${erp_dir}/runtime"
    return
  fi
  echo "${erp_dir}/.runtime"
}

RUNTIME_DIR="$(resolve_runtime_dir "${BASE_DIR}/hariom-erp")"
RUNTIME_ENV="${RUNTIME_DIR}/orchestrator.env"
RUNTIME_LOG_DIR="${RUNTIME_DIR}/logs"
SKIP_RUNTIME_START="${SKIP_RUNTIME_START:-0}"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

record_result() {
  local status="$1"
  local label="$2"
  local detail="$3"
  RESULTS+=("${status}|${label}|${detail}")
  if [[ "$status" == "PASS" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

http_check() {
  local label="$1"
  local expected="$2"
  local method="$3"
  local url="$4"
  local body="${5:-}"
  local auth="${6:-}"
  local output_file="${7:-}"

  if [[ -z "$output_file" ]]; then
    output_file="$(mktemp)"
  fi
  local status
  if [[ -n "$body" ]]; then
    if [[ -n "$auth" ]]; then
      status="$(curl -s -o "$output_file" -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -H "Authorization: Bearer ${auth}" -d "$body")"
    else
      status="$(curl -s -o "$output_file" -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$body")"
    fi
  else
    if [[ -n "$auth" ]]; then
      status="$(curl -s -o "$output_file" -w "%{http_code}" -X "$method" "$url" -H "Authorization: Bearer ${auth}")"
    else
      status="$(curl -s -o "$output_file" -w "%{http_code}" -X "$method" "$url")"
    fi
  fi

  if [[ "$status" == "$expected" ]]; then
    record_result "PASS" "$label" "HTTP ${status}"
  else
    local body_preview
    body_preview="$(tr '\n' ' ' < "$output_file" | head -c 220)"
    record_result "FAIL" "$label" "expected ${expected}, got ${status}; body=${body_preview}"
  fi

  echo "$output_file"
}

http_cookie_check() {
  local label="$1"
  local expected="$2"
  local method="$3"
  local url="$4"
  local cookie_jar="$5"
  local body="${6:-}"
  local output_file="${7:-}"

  if [[ -z "$output_file" ]]; then
    output_file="$(mktemp)"
  fi

  local curl_args=(
    -s
    -b "$cookie_jar"
    -c "$cookie_jar"
    -o "$output_file"
    -w "%{http_code}"
    -X "$method"
    "$url"
  )

  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local status
  status="$(curl "${curl_args[@]}")"
  if [[ "$status" == "$expected" ]]; then
    record_result "PASS" "$label" "HTTP ${status}"
  else
    local body_preview
    body_preview="$(tr '\n' ' ' < "$output_file" | head -c 220)"
    record_result "FAIL" "$label" "expected ${expected}, got ${status}; body=${body_preview}"
  fi

  echo "$output_file"
}

content_check() {
  local label="$1"
  local expected="$2"
  local method="$3"
  local url="$4"
  local expected_content_type="$5"
  local min_bytes="$6"
  local auth="${7:-}"
  local body="${8:-}"
  local cookie_jar="${9:-}"

  local output_file
  local header_file
  output_file="$(mktemp)"
  header_file="$(mktemp)"

  local curl_args=(
    -s
    -D "$header_file"
    -o "$output_file"
    -w "%{http_code}"
    -X "$method"
    "$url"
  )

  if [[ -n "$cookie_jar" ]]; then
    curl_args+=(-b "$cookie_jar" -c "$cookie_jar")
  fi
  if [[ -n "$auth" ]]; then
    curl_args+=(-H "Authorization: Bearer ${auth}")
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local status
  status="$(curl "${curl_args[@]}")"
  local content_type
  content_type="$(tr -d '\r' < "$header_file" | grep -i '^content-type:' | head -n 1 | cut -d':' -f2- | sed 's/^ *//')"
  local size
  size="$(wc -c < "$output_file" | tr -d ' ')"
  if [[ "$status" == "$expected" && "$content_type" == *"$expected_content_type"* && "$size" -ge "$min_bytes" ]]; then
    if [[ "$expected_content_type" == "application/pdf" ]]; then
      if head -c 4 "$output_file" | grep -q "%PDF"; then
        record_result "PASS" "$label" "HTTP ${status}; type=${content_type}; bytes=${size}"
      else
        record_result "FAIL" "$label" "invalid PDF signature; type=${content_type}; bytes=${size}"
      fi
    else
      record_result "PASS" "$label" "HTTP ${status}; type=${content_type}; bytes=${size}"
    fi
  else
    record_result "FAIL" "$label" "expected ${expected}/${expected_content_type}/${min_bytes}B, got ${status}/${content_type}/${size}B"
  fi
}

json_get() {
  local input_file="$1"
  local path="$2"
  python3 - "$input_file" "$path" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    print("")
    raise SystemExit(0)

value = data
for part in sys.argv[2].split("."):
    if not part:
        continue
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break

if isinstance(value, (dict, list)):
    print(json.dumps(value))
elif value is True:
    print("true")
elif value is False:
    print("false")
elif value is None:
    print("")
else:
    print(str(value))
PY
}

json_len() {
  local input_file="$1"
  local path="$2"
  python3 - "$input_file" "$path" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    print(0)
    raise SystemExit(0)

value = data
for part in sys.argv[2].split("."):
    if not part:
        continue
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break

if isinstance(value, (dict, list)):
    print(len(value))
else:
    print(0)
PY
}

if [[ "$SKIP_RUNTIME_START" == "1" ]]; then
  echo "[smoke] using existing runtime..."
else
  echo "[smoke] starting runtime..."
  if ! "${BASE_DIR}/start_all.sh" >/tmp/runtime_smoke_start.log 2>&1; then
    echo "[smoke] startup failed. Last startup logs:"
    tail -n 200 /tmp/runtime_smoke_start.log
    exit 1
  fi
fi

if [[ -f "$RUNTIME_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$RUNTIME_ENV"
fi

HOST="${HOST:-127.0.0.1}"
BFF_PORT="${BFF_PORT:-14000}"
WEB_UI_PORT="${WEB_UI_PORT:-13000}"
BFF_URL="http://${HOST}:${BFF_PORT}"
WEB_URL="http://${HOST}:${WEB_UI_PORT}"
LOG_BASELINE_FILE="$(mktemp)"
if compgen -G "${RUNTIME_LOG_DIR}/*.log" >/dev/null; then
  for log_file in "${RUNTIME_LOG_DIR}"/*.log; do
    line_count="$(wc -l < "$log_file" | tr -d ' ')"
    printf '%s\t%s\n' "$log_file" "$line_count" >> "$LOG_BASELINE_FILE"
  done
fi

login_file="/tmp/runtime_smoke_login.json"
http_check "Auth login" "200" "POST" "${BFF_URL}/api/auth/login" '{"email":"admin@hariom.com","password":"admin123"}' "" "$login_file" >/dev/null
TOKEN="$(python3 - "$login_file" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    print("")
    sys.exit(0)
print(data.get("access_token",""))
PY
)"

if [[ -z "$TOKEN" ]]; then
  record_result "FAIL" "Auth login token parse" "missing access_token in login response"
else
  record_result "PASS" "Auth login token parse" "token present"
fi

http_check "Auth me" "200" "GET" "${BFF_URL}/api/auth/me" "" "$TOKEN" >/dev/null
http_check "Auth plants" "200" "GET" "${BFF_URL}/api/auth/plants" "" "$TOKEN" >/dev/null
http_check "Auth invalid token" "401" "GET" "${BFF_URL}/api/auth/me" "" "invalid-token" >/dev/null

COOKIE_JAR="/tmp/runtime_smoke_cookies.txt"
rm -f "$COOKIE_JAR"
http_cookie_check "Auth cookie login" "200" "POST" "${BFF_URL}/api/auth/login" "$COOKIE_JAR" '{"email":"admin@hariom.com","password":"admin123"}' >/dev/null
acting_role_file="$(http_cookie_check "Auth acting role mint" "200" "POST" "${BFF_URL}/api/auth/acting-role" "$COOKIE_JAR" '{"role_name":"Owner"}')"
ACTING_TOKEN="$(json_get "$acting_role_file" "access_token")"
if [[ -n "$ACTING_TOKEN" ]]; then
  record_result "PASS" "Auth acting token parse" "token present"
else
  record_result "FAIL" "Auth acting token parse" "missing access_token in acting-role response"
fi
acting_me_file="$(http_cookie_check "Auth acting me cookie" "200" "GET" "${BFF_URL}/api/auth/me" "$COOKIE_JAR")"
ACTING_ROLE="$(json_get "$acting_me_file" "acting_role")"
ACTING_FLAG="$(json_get "$acting_me_file" "is_acting_session")"
if [[ "$ACTING_ROLE" == "Owner" && "$ACTING_FLAG" == "true" ]]; then
  record_result "PASS" "Auth acting me semantics" "acting_role=${ACTING_ROLE} is_acting_session=${ACTING_FLAG}"
else
  record_result "FAIL" "Auth acting me semantics" "acting_role=${ACTING_ROLE} is_acting_session=${ACTING_FLAG}"
fi
http_cookie_check "Auth acting role clear" "200" "DELETE" "${BFF_URL}/api/auth/acting-role" "$COOKIE_JAR" >/dev/null
cleared_me_file="$(http_cookie_check "Auth acting me cleared" "200" "GET" "${BFF_URL}/api/auth/me" "$COOKIE_JAR")"
CLEARED_ACTING_ROLE="$(json_get "$cleared_me_file" "acting_role")"
CLEARED_ACTING_FLAG="$(json_get "$cleared_me_file" "is_acting_session")"
if [[ -z "$CLEARED_ACTING_ROLE" && "$CLEARED_ACTING_FLAG" == "false" ]]; then
  record_result "PASS" "Auth acting clear semantics" "acting session removed"
else
  record_result "FAIL" "Auth acting clear semantics" "acting_role=${CLEARED_ACTING_ROLE} is_acting_session=${CLEARED_ACTING_FLAG}"
fi

http_check "Web login page" "200" "GET" "${WEB_URL}/login" >/dev/null
http_check "Master customers" "200" "GET" "${BFF_URL}/api/master/customers" "" "$TOKEN" >/dev/null
http_check "Master papers" "200" "GET" "${BFF_URL}/api/master/papers" "" "$TOKEN" >/dev/null
http_check "Master adhesives list" "200" "GET" "${BFF_URL}/api/master/adhesives" "" "$TOKEN" >/dev/null
role_matrix_file="$(http_check "Role matrix read" "200" "GET" "${BFF_URL}/api/auth/roles/matrix" "" "$TOKEN")"
ROLE_GROUPS="$(json_len "$role_matrix_file" "seeded_role_groups")"
if [[ "$ROLE_GROUPS" -ge 8 ]]; then
  record_result "PASS" "Role matrix seeded group count" "groups=${ROLE_GROUPS}"
else
  record_result "FAIL" "Role matrix seeded group count" "groups=${ROLE_GROUPS}"
fi

ADH_NAME="STAB_ADH_$(date +%s)"
ADH_CODE="STAB_${RANDOM}"
create_adh_file="$(http_check "Master adhesive create" "200" "POST" "${BFF_URL}/api/master/adhesives" "{\"name\":\"${ADH_NAME}\",\"internal_code\":\"${ADH_CODE}\"}" "$TOKEN")"
ADH_ID="$(python3 - "$create_adh_file" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    print("")
    sys.exit(0)
print(data.get("id",""))
PY
)"
if [[ -n "$ADH_ID" ]]; then
  http_check "Master adhesive update" "200" "PUT" "${BFF_URL}/api/master/adhesives/${ADH_ID}" "{\"name\":\"${ADH_NAME}_U\"}" "$TOKEN" >/dev/null
else
  record_result "FAIL" "Master adhesive update" "create response missing id"
fi

http_check "Spec list" "200" "GET" "${BFF_URL}/api/spec/specifications?active_only=true" "" "$TOKEN" >/dev/null
http_check "Planning queue read" "200" "GET" "${BFF_URL}/api/production/planning/queues?stage=WINDER" "" "$TOKEN" >/dev/null
http_check "Inventory reels read" "200" "GET" "${BFF_URL}/api/inventory/reels" "" "$TOKEN" >/dev/null
http_check "Inventory reel-issues read" "200" "GET" "${BFF_URL}/api/inventory/reel-issues" "" "$TOKEN" >/dev/null
palette_file="$(http_check "Workspace command palette" "200" "GET" "${BFF_URL}/api/workspace/command-palette?q=inventory" "" "$TOKEN")"
PALETTE_NAV_COUNT="$(json_len "$palette_file" "nav")"
PALETTE_ACTION_COUNT="$(json_len "$palette_file" "actions")"
if [[ "$PALETTE_NAV_COUNT" -gt 0 || "$PALETTE_ACTION_COUNT" -gt 0 ]]; then
  record_result "PASS" "Workspace command palette results" "nav=${PALETTE_NAV_COUNT} actions=${PALETTE_ACTION_COUNT}"
else
  record_result "FAIL" "Workspace command palette results" "nav=${PALETTE_NAV_COUNT} actions=${PALETTE_ACTION_COUNT}"
fi

notifications_file="$(http_check "Notifications feed" "200" "GET" "${BFF_URL}/api/auth/notifications?limit=10" "" "$TOKEN")"
NOTIFICATION_COUNT="$(json_len "$notifications_file" "items")"
record_result "PASS" "Notifications feed count" "items=${NOTIFICATION_COUNT}"
unread_file="$(http_check "Notifications unread count" "200" "GET" "${BFF_URL}/api/auth/notifications/unread-count" "" "$TOKEN")"
UNREAD_COUNT="$(json_get "$unread_file" "count")"
if [[ "$UNREAD_COUNT" =~ ^[0-9]+$ ]]; then
  record_result "PASS" "Notifications unread payload" "count=${UNREAD_COUNT}"
else
  record_result "FAIL" "Notifications unread payload" "count=${UNREAD_COUNT}"
fi
http_check "Notifications mark-all-read" "200" "POST" "${BFF_URL}/api/auth/notifications/mark-all-read" "" "$TOKEN" >/dev/null

TODAY_DATE="$(python3 - <<'PY'
from datetime import date
print(date.today().isoformat())
PY
)"
DATE_MINUS_7="$(python3 - <<'PY'
from datetime import date, timedelta
print((date.today() - timedelta(days=7)).isoformat())
PY
)"
DATE_MINUS_30="$(python3 - <<'PY'
from datetime import date, timedelta
print((date.today() - timedelta(days=30)).isoformat())
PY
)"
DATE_MINUS_180="$(python3 - <<'PY'
from datetime import date, timedelta
print((date.today() - timedelta(days=180)).isoformat())
PY
)"

owner_pack_file="$(http_check "Owner pack JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/owner-pack?start_date=${DATE_MINUS_7}&end_date=${TODAY_DATE}&granularity=day" "" "$ACTING_TOKEN")"
OWNER_PACK_RANGE_START="$(json_get "$owner_pack_file" "available_range.start_date")"
OWNER_PACK_RANGE_END="$(json_get "$owner_pack_file" "available_range.end_date")"
if [[ -n "$OWNER_PACK_RANGE_START" && -n "$OWNER_PACK_RANGE_END" ]]; then
  record_result "PASS" "Owner pack available range" "start=${OWNER_PACK_RANGE_START} end=${OWNER_PACK_RANGE_END}"
else
  record_result "FAIL" "Owner pack available range" "start=${OWNER_PACK_RANGE_START} end=${OWNER_PACK_RANGE_END}"
fi
content_check "Owner pack HTML export" "200" "GET" "${BFF_URL}/api/analytics/reports/owner-pack/html?start_date=${DATE_MINUS_7}&end_date=${TODAY_DATE}&granularity=day" "text/html" 1024 "$ACTING_TOKEN"
content_check "Owner pack PDF export" "200" "GET" "${BFF_URL}/api/analytics/reports/owner-pack/pdf?start_date=${DATE_MINUS_7}&end_date=${TODAY_DATE}&granularity=day" "application/pdf" 4096 "$ACTING_TOKEN"

production_report_file="$(http_check "Production report JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/production?start_date=${DATE_MINUS_30}&end_date=${TODAY_DATE}&granularity=week" "" "$TOKEN")"
sales_report_file="$(http_check "Sales report JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/sales?start_date=${DATE_MINUS_7}&end_date=${TODAY_DATE}&granularity=day" "" "$TOKEN")"
quality_report_file="$(http_check "Quality report JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/quality?start_date=${TODAY_DATE}&end_date=${TODAY_DATE}&granularity=day" "" "$TOKEN")"
dispatch_report_file="$(http_check "Dispatch report JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/dispatch?start_date=${DATE_MINUS_30}&end_date=${TODAY_DATE}&granularity=week" "" "$TOKEN")"
inventory_report_file="$(http_check "Inventory health report JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/inventory-health?start_date=${DATE_MINUS_180}&end_date=${TODAY_DATE}&granularity=month" "" "$TOKEN")"
plant_compare_file="$(http_check "Plant compare report JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/plant-compare?start_date=${DATE_MINUS_30}&end_date=${TODAY_DATE}&granularity=week" "" "$TOKEN")"
exceptions_report_file="$(http_check "Exceptions report JSON" "200" "GET" "${BFF_URL}/api/analytics/reports/exceptions?start_date=${DATE_MINUS_7}&end_date=${TODAY_DATE}&granularity=day" "" "$TOKEN")"

for report_label in \
  "Production report JSON:${production_report_file}" \
  "Sales report JSON:${sales_report_file}" \
  "Quality report JSON:${quality_report_file}" \
  "Dispatch report JSON:${dispatch_report_file}" \
  "Inventory health report JSON:${inventory_report_file}" \
  "Plant compare report JSON:${plant_compare_file}" \
  "Exceptions report JSON:${exceptions_report_file}"
do
  label="${report_label%%:*}"
  file="${report_label#*:}"
  range_start="$(json_get "$file" "available_range.start_date")"
  range_end="$(json_get "$file" "available_range.end_date")"
  if [[ -n "$range_start" && -n "$range_end" ]]; then
    record_result "PASS" "${label} available range" "start=${range_start} end=${range_end}"
  else
    record_result "FAIL" "${label} available range" "start=${range_start} end=${range_end}"
  fi
done

LOG_SCAN_FILE="/tmp/runtime_smoke_logscan.txt"
: > "$LOG_SCAN_FILE"
while IFS="$(printf '\t')" read -r log_file baseline_count; do
  if [[ -f "$log_file" ]]; then
    start_line=$((baseline_count + 1))
    tail -n +"${start_line}" "$log_file" \
      | rg -n "Internal Server Error|Traceback|ResponseValidationError|ERROR:    Exception in ASGI application" \
      | sed "s|^|${log_file}:|" >> "$LOG_SCAN_FILE" || true
  fi
done < "$LOG_BASELINE_FILE"

if [[ -s "$LOG_SCAN_FILE" ]]; then
  log_preview="$(head -n 20 /tmp/runtime_smoke_logscan.txt | tr '\n' ' ' | head -c 260)"
  record_result "FAIL" "Runtime log scan" "errors found: ${log_preview}"
else
  record_result "PASS" "Runtime log scan" "no internal server traceback markers detected"
fi

echo
echo "Runtime Smoke Matrix"
echo "===================="
for row in "${RESULTS[@]}"; do
  IFS='|' read -r status label detail <<<"$row"
  echo "${status} | ${label} | ${detail}"
done

echo
echo "Summary: PASS=${PASS_COUNT} FAIL=${FAIL_COUNT}"

if (( FAIL_COUNT > 0 )); then
  exit 1
fi
