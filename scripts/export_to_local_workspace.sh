#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:-}"
TARGET_ROOT="${2:-}"

if [[ -z "${SOURCE_ROOT}" || -z "${TARGET_ROOT}" ]]; then
  echo "Usage: $0 <source-root> <target-root>"
  exit 1
fi

if [[ ! -d "${SOURCE_ROOT}" ]]; then
  echo "Source root not found: ${SOURCE_ROOT}"
  exit 1
fi

copy_file() {
  local rel="$1"
  mkdir -p "${TARGET_ROOT}/$(dirname "${rel}")"
  cp -p "${SOURCE_ROOT}/${rel}" "${TARGET_ROOT}/${rel}"
}

copy_tree_files() {
  local rel_dir="$1"
  shift
  local find_args=("$@")

  if [[ ! -d "${SOURCE_ROOT}/${rel_dir}" ]]; then
    return 0
  fi

  while IFS= read -r -d '' rel; do
    copy_file "${rel}"
  done < <(
    cd "${SOURCE_ROOT}"
    find "${rel_dir}" "${find_args[@]}" -print0
  )
}

rm -rf "${TARGET_ROOT}"
mkdir -p "${TARGET_ROOT}"

# Top-level docs and launch scripts kept intentionally small and source-only.
top_level_files=(
  "ARCHITECTURE.md"
  "DECISIONS.md"
  "SYSTEM_DESIGN.md"
  "TESTING_GUIDE.md"
  "start_all.sh"
  "start_services.sh"
  "start_ui.sh"
  "status_all.sh"
  "stop_all.sh"
  "stop_services.sh"
)

for rel in "${top_level_files[@]}"; do
  [[ -f "${SOURCE_ROOT}/${rel}" ]] && copy_file "${rel}"
done

copy_tree_files "apps/web-ui/app" -type f
copy_tree_files "apps/web-ui/components" -type f
copy_tree_files "apps/web-ui/context" -type f
copy_tree_files "apps/web-ui/e2e" -type f
copy_tree_files "apps/web-ui/hooks" -type f
copy_tree_files "apps/web-ui/lib" -type f
copy_tree_files "apps/web-ui/pages" -type f
copy_tree_files "apps/web-ui/public" -type f
copy_tree_files "apps/web-ui/types" -type f

web_ui_root_files=(
  "apps/web-ui/Dockerfile"
  "apps/web-ui/next-env.d.ts"
  "apps/web-ui/next.config.js"
  "apps/web-ui/package-lock.json"
  "apps/web-ui/package.json"
  "apps/web-ui/playwright.config.cjs"
  "apps/web-ui/postcss.config.js"
  "apps/web-ui/tailwind.config.ts"
  "apps/web-ui/tsconfig.json"
)

for rel in "${web_ui_root_files[@]}"; do
  [[ -f "${SOURCE_ROOT}/${rel}" ]] && copy_file "${rel}"
done

copy_tree_files "apps/bff-api/src" -type f
for rel in "apps/bff-api/Dockerfile" "apps/bff-api/requirements.txt"; do
  [[ -f "${SOURCE_ROOT}/${rel}" ]] && copy_file "${rel}"
done

copy_tree_files "hariom-erp/services" -type f
copy_tree_files "hariom-erp/scripts" -type f
copy_tree_files "hariom-erp/docs" -type f
copy_tree_files "hariom-erp/infra" -type f
copy_tree_files "hariom-erp/ui" -type f

hariom_root_files=(
  "hariom-erp/.env"
  "hariom-erp/.env.example"
  "hariom-erp/.gitignore"
  "hariom-erp/ACCESS_GUIDE.md"
  "hariom-erp/Hariom_ERP_Final_Requirements_and_Plan.md"
  "hariom-erp/README.md"
  "hariom-erp/ROADMAP.md"
  "hariom-erp/TASK.md"
  "hariom-erp/docker-compose.yml"
  "hariom-erp/render.yaml"
  "hariom-erp/start_all.sh"
  "hariom-erp/status_all.sh"
  "hariom-erp/stop_all.sh"
)

for rel in "${hariom_root_files[@]}"; do
  [[ -f "${SOURCE_ROOT}/${rel}" ]] && copy_file "${rel}"
done

copy_tree_files "scripts" -type f

echo "Export complete: ${TARGET_ROOT}"
