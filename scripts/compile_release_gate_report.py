#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from runtime_support import MANIFEST_PATH, REPORT_DIR


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def main() -> int:
    runtime = _read_json(REPORT_DIR / "runtime_consistency_latest.json") or {}
    truth = _read_json(REPORT_DIR / "hard_cutover_validation_latest.json") or {}
    browser = _read_json(REPORT_DIR / "browser_release_gate_latest.json") or {}
    manifest = _read_json(MANIFEST_PATH) or {}

    browser_stats = (browser.get("stats") or {})
    browser_failed = int(browser_stats.get("unexpected", 0) or 0) + int(browser_stats.get("flaky", 0) or 0)
    browser_passed = int(browser_stats.get("expected", 0) or 0)
    browser_total = browser_passed + browser_failed

    summary = {
        "generated_at": datetime.now().isoformat(),
        "runtime": runtime.get("summary") or {},
        "truth": truth.get("summary") or {},
        "browser": {
            "total": browser_total,
            "passed": browser_passed,
            "failed": browser_failed,
        },
        "manifest_path": str(MANIFEST_PATH),
    }

    unresolved: list[str] = []
    if (summary["runtime"].get("failed") or 0) > 0:
        unresolved.append("Runtime consistency has failing checks.")
    if (summary["truth"].get("failed") or 0) > 0:
        unresolved.append("Hard cutover truth validation has failing checks.")
    if browser_failed > 0:
        unresolved.append("Browser release-gate suite has failing tests.")

    payload = {
        "summary": summary,
        "runtime_report": runtime,
        "truth_report": truth,
        "browser_report": browser,
        "runtime_manifest": manifest,
        "unresolved_defects": unresolved,
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = REPORT_DIR / f"release_gate_signoff_{stamp}.json"
    md_path = REPORT_DIR / f"release_gate_signoff_{stamp}.md"
    latest_json = REPORT_DIR / "release_gate_signoff_latest.json"
    latest_md = REPORT_DIR / "release_gate_signoff_latest.md"

    blob = json.dumps(payload, indent=2)
    json_path.write_text(blob, encoding="utf-8")
    latest_json.write_text(blob, encoding="utf-8")

    lines = [
        f"# Release Gate Sign-off ({datetime.now().date().isoformat()})",
        "",
        f"- Generated at: `{summary['generated_at']}`",
        f"- Runtime manifest: `{MANIFEST_PATH}`",
        f"- Runtime checks: **PASS={summary['runtime'].get('passed', 0)} FAIL={summary['runtime'].get('failed', 0)} TOTAL={summary['runtime'].get('total', 0)}**",
        f"- Truth checks: **PASS={summary['truth'].get('passed', 0)} FAIL={summary['truth'].get('failed', 0)} TOTAL={summary['truth'].get('total', 0)}**",
        f"- Browser checks: **PASS={browser_passed} FAIL={browser_failed} TOTAL={browser_total}**",
        "",
        "## Unresolved Defects",
        "",
    ]
    if unresolved:
        lines.extend([f"- {item}" for item in unresolved])
    else:
        lines.append("- None.")
    lines.extend(
        [
            "",
            "## Order Reconciliation",
            "",
            "```json",
            json.dumps(truth.get("flows") or [], indent=2),
            "```",
            "",
            f"Runtime report: `{REPORT_DIR / 'runtime_consistency_latest.md'}`",
            f"Truth report: `{REPORT_DIR / 'hard_cutover_validation_latest.md'}`",
            f"Browser report: `{REPORT_DIR / 'browser_release_gate_latest.json'}`",
        ]
    )

    markdown = "\n".join(lines)
    md_path.write_text(markdown, encoding="utf-8")
    latest_md.write_text(markdown, encoding="utf-8")
    print(json.dumps({"json_report": str(json_path), "markdown_report": str(md_path), "unresolved": unresolved}, indent=2))
    return 1 if unresolved else 0


if __name__ == "__main__":
    raise SystemExit(main())
