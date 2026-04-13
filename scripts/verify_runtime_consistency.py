#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from runtime_support import REPORT_DIR, WEB_UI_DIR, build_runtime_manifest, write_runtime_manifest

REQUEST_TIMEOUT = 60.0
NEXT_ASSET_PATTERN = re.compile(r"/_next/static/[^\"'> ]+")


@dataclass
class CheckRow:
    name: str
    status: str
    detail: str


class RuntimeConsistencyVerifier:
    def __init__(self, manifest: dict[str, Any]) -> None:
        self.manifest = manifest
        self.rows: list[CheckRow] = []
        self.evidence: dict[str, Any] = {"pages": {}, "bff": {}, "services": {}}

    def add(self, name: str, ok: bool, detail: str) -> None:
        self.rows.append(CheckRow(name=name, status="PASS" if ok else "FAIL", detail=detail))

    def _request(
        self,
        method: str,
        url: str,
        *,
        expected: tuple[int, ...],
        json_body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[requests.Response, Any]:
        response = requests.request(
            method,
            url,
            json=json_body,
            headers=headers or {},
            timeout=REQUEST_TIMEOUT,
        )
        try:
            payload = response.json()
        except Exception:
            payload = {"raw": response.text[:2000]}
        if response.status_code not in expected:
            raise RuntimeError(f"{method} {url} expected {expected} got {response.status_code}: {str(payload)[:400]}")
        return response, payload

    def verify_service_health(self) -> str:
        urls = self.manifest["urls"]
        targets = {
            "auth": f"{urls['auth']}/",
            "master": f"{urls['master']}/health",
            "spec": f"{urls['spec']}/health",
            "sales": f"{urls['sales']}/health",
            "production": f"{urls['production']}/health",
            "inventory": f"{urls['inventory']}/health",
            "analytics": f"{urls['analytics']}/health",
            "bff": f"{urls['bff']}/health",
        }
        for label, url in targets.items():
            response, payload = self._request("GET", url, expected=(200,))
            self.evidence["services"][label] = {
                "url": url,
                "status": response.status_code,
                "payload": payload,
            }
            self.add(f"Service health {label}", True, url)
        return "all service health endpoints returned 200"

    def verify_bff_auth_surface(self) -> str:
        bff = self.manifest["urls"]["bff"]
        admin_email = self.manifest["defaults"]["admin_email"]
        admin_password = self.manifest["defaults"]["admin_password"]

        login_response, login_payload = self._request(
            "POST",
            f"{bff}/api/auth/login",
            expected=(200,),
            json_body={"email": admin_email, "password": admin_password},
        )
        token = str(login_payload.get("access_token") or "")
        if not token:
            raise RuntimeError("BFF login succeeded but returned no access token")
        self.evidence["bff"]["login"] = {
            "status": login_response.status_code,
            "user_email": login_payload.get("user", {}).get("email") or admin_email,
        }
        self.add("BFF route /api/auth/login", True, f"user={admin_email}")

        self._request("GET", f"{bff}/api/auth/me", expected=(401,))
        self.add("BFF route /api/auth/me unauth", True, "401 without token")

        me_response, me_payload = self._request(
            "GET",
            f"{bff}/api/auth/me",
            expected=(200,),
            headers={"Authorization": f"Bearer {token}"},
        )
        self.evidence["bff"]["me"] = me_payload
        self.add("BFF route /api/auth/me auth", True, f"email={me_payload.get('email') or me_payload.get('user', {}).get('email')}")

        acting_response, acting_payload = self._request(
            "POST",
            f"{bff}/api/auth/acting-role",
            expected=(200,),
            headers={"Authorization": f"Bearer {token}"},
            json_body={"role_name": "Owner"},
        )
        self.evidence["bff"]["acting_role"] = {
            "status": acting_response.status_code,
            "acting_role": acting_payload.get("acting_role"),
        }
        self.add("BFF route /api/auth/acting-role", True, f"acting_role={acting_payload.get('acting_role')}")

        checks = [
            ("planning board", f"{bff}/api/production/planning/board"),
            ("dispatch ready jobs", f"{bff}/api/dispatch/ready-jobs"),
            ("owner report", f"{bff}/api/analytics/reports/owner-pack"),
        ]
        for label, url in checks:
            params = None
            if "owner-pack" in url:
                params = {"start_date": datetime.now().date().isoformat(), "end_date": datetime.now().date().isoformat(), "granularity": "day"}
            response = requests.get(url, params=params, headers={"Authorization": f"Bearer {token}"}, timeout=REQUEST_TIMEOUT)
            if response.status_code not in (200, 204):
                raise RuntimeError(f"{label} route check failed with {response.status_code}: {response.text[:200]}")
            self.add(f"BFF route {label}", True, f"status={response.status_code}")
        return "auth and required BFF routes are live"

    def verify_web_assets(self) -> str:
        if not self.manifest.get("settings", {}).get("start_web_ui", True):
            self.evidence["web_assets"] = {"skipped": True, "reason": "web runtime disabled"}
            self.add("Web static assets", True, "skipped because START_WEB_UI=0")
            return "web verification skipped because the runtime was started in backend-only mode"

        base_url = self.manifest["urls"]["web"]
        build_id = self.manifest.get("web", {}).get("build_id")
        web_mode = str(self.manifest.get("settings", {}).get("web_ui_mode") or "dev")
        if web_mode == "prod" and not build_id:
            raise RuntimeError("apps/web-ui/.next/BUILD_ID is missing")

        build_dir = WEB_UI_DIR / ".next"
        checked_assets: list[str] = []
        for route in ("/login", "/dashboard"):
            response = requests.get(f"{base_url}{route}", timeout=REQUEST_TIMEOUT)
            if response.status_code != 200:
                raise RuntimeError(f"{route} returned {response.status_code}")
            html = response.text
            assets = sorted(set(NEXT_ASSET_PATTERN.findall(html)))
            if not assets:
                raise RuntimeError(f"{route} returned no _next/static asset references")
            page_key = route.lstrip("/") or "root"
            self.evidence["pages"][page_key] = {"asset_count": len(assets), "assets": assets}
            build_label = build_id if build_id else f"{web_mode}-mode"
            self.add(f"Web route {route}", True, f"assets={len(assets)} build_id={build_label}")

            for asset in assets:
                normalized_asset = asset.split("?", 1)[0].rstrip("\\")
                relative = normalized_asset.removeprefix("/_next/")
                local_file = build_dir / relative
                if not local_file.exists():
                    raise RuntimeError(f"{route} references missing local asset {asset}")
                asset_response = requests.get(f"{base_url}{normalized_asset}", timeout=REQUEST_TIMEOUT)
                content_type = asset_response.headers.get("content-type", "")
                if asset_response.status_code != 200:
                    raise RuntimeError(f"{normalized_asset} returned {asset_response.status_code}")
                if "text/html" in content_type.lower():
                    raise RuntimeError(f"{normalized_asset} returned HTML instead of static content")
                checked_assets.append(normalized_asset)

        self.evidence["web_assets"] = {
            "checked_count": len(sorted(set(checked_assets))),
            "build_id": build_id,
            "web_ui_mode": web_mode,
        }
        self.add("Web static assets", True, f"verified={len(sorted(set(checked_assets)))}")
        return "login and dashboard reference live current-build assets"


def write_reports(manifest: dict[str, Any], rows: list[CheckRow], evidence: dict[str, Any]) -> tuple[Path, Path]:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = REPORT_DIR / f"runtime_consistency_{stamp}.json"
    md_path = REPORT_DIR / f"runtime_consistency_{stamp}.md"
    latest_json = REPORT_DIR / "runtime_consistency_latest.json"
    latest_md = REPORT_DIR / "runtime_consistency_latest.md"
    failed = sum(1 for row in rows if row.status == "FAIL")
    passed = len(rows) - failed

    payload = {
        "generated_at": datetime.now().isoformat(),
        "summary": {"total": len(rows), "passed": passed, "failed": failed},
        "runtime_manifest": manifest,
        "checks": [row.__dict__ for row in rows],
        "evidence": evidence,
    }
    json_blob = json.dumps(payload, indent=2)
    json_path.write_text(json_blob, encoding="utf-8")
    latest_json.write_text(json_blob, encoding="utf-8")

    lines = [
        f"# Runtime Consistency Report ({datetime.now().date().isoformat()})",
        "",
        f"- Generated at: `{payload['generated_at']}`",
        f"- Web URL: `{manifest['urls']['web']}`",
        f"- BFF URL: `{manifest['urls']['bff']}`",
        f"- Summary: **PASS={passed} FAIL={failed} TOTAL={len(rows)}**",
        "",
        "| Status | Check | Detail |",
        "|---|---|---|",
    ]
    for row in rows:
        escaped_detail = row.detail.replace("|", "\\|")
        lines.append(f"| {row.status} | {row.name} | {escaped_detail} |")
    lines.extend(
        [
            "",
            "## Evidence",
            "",
            "```json",
            json.dumps(evidence, indent=2),
            "```",
            "",
            f"JSON artifact: `{json_path}`",
        ]
    )
    markdown = "\n".join(lines)
    md_path.write_text(markdown, encoding="utf-8")
    latest_md.write_text(markdown, encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the live runtime is serving the current repo build.")
    parser.add_argument("--write-manifest", action="store_true", help="Persist the verified manifest to hariom-erp/.runtime/runtime_manifest.json.")
    args = parser.parse_args()

    manifest = build_runtime_manifest()
    verifier = RuntimeConsistencyVerifier(manifest)

    try:
        verifier.verify_service_health()
        verifier.verify_bff_auth_surface()
        verifier.verify_web_assets()
    except Exception as exc:
        verifier.add("Runtime consistency", False, f"{type(exc).__name__}: {exc}")
        verifier.evidence["exception"] = {"type": type(exc).__name__, "message": str(exc)}

    failed = sum(1 for row in verifier.rows if row.status == "FAIL")
    manifest["consistency"] = {
        "verified_at": datetime.now().isoformat(),
        "status": "PASS" if failed == 0 else "FAIL",
        "summary": {
            "total": len(verifier.rows),
            "passed": len(verifier.rows) - failed,
            "failed": failed,
        },
    }

    if args.write_manifest or failed == 0:
        write_runtime_manifest(manifest)

    json_path, md_path = write_reports(manifest, verifier.rows, verifier.evidence)
    print(json.dumps({"manifest": str(Path(manifest["paths"]["manifest_path"])), "json_report": str(json_path), "markdown_report": str(md_path), "failed": failed}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
