#!/usr/bin/env bash
# Resolve a supported Node bin directory from PATH or an explicit override.
# Do not hard-require Homebrew Node 18. Accept Node major >= 18.
# Optional overrides: NODE_BIN, NODE18_BIN (directory containing node and npm).

resolve_node_bin_dir() {
  local candidate=""
  local node_path=""
  local major=""

  if [[ -n "${NODE_BIN:-}" ]]; then
    candidate="${NODE_BIN}"
  elif [[ -n "${NODE18_BIN:-}" ]]; then
    candidate="${NODE18_BIN}"
  elif command -v node >/dev/null 2>&1; then
    node_path="$(command -v node)"
    candidate="$(cd "$(dirname "${node_path}")" && pwd)"
  else
    echo "Supported Node runtime not found on PATH. Install Node >= 18 or set NODE_BIN." >&2
    return 1
  fi

  if [[ ! -x "${candidate}/node" ]]; then
    echo "Node executable missing at ${candidate}/node" >&2
    return 1
  fi
  if [[ ! -x "${candidate}/npm" ]]; then
    echo "npm executable missing at ${candidate}/npm" >&2
    return 1
  fi

  major="$("${candidate}/node" -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ -z "${major}" ]] || (( major < 18 )); then
    echo "Detected Node $("${candidate}/node" -v) at ${candidate}; Hari Om web-ui requires Node >= 18." >&2
    return 1
  fi

  echo "${candidate}"
}

export_resolved_node() {
  local bin_dir
  bin_dir="$(resolve_node_bin_dir)" || return 1
  export PATH="${bin_dir}:${PATH}"
  hash -r
  echo "[node] using ${bin_dir} ($("${bin_dir}/node" -v), npm $( "${bin_dir}/npm" -v ))"
}
