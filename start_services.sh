#!/bin/bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat <<'EOF'
=================================================================
Legacy startup path deprecated
Use ./start_all.sh for the only supported ERP runtime.
This wrapper now forwards to the hardened runtime entrypoint.
=================================================================
EOF

cd "$BASE_DIR"
exec ./start_all.sh "$@"
