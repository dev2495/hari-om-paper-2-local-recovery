"""Shared helpers for the 2 Nov 2026 client imports (spec packing, Tally sales orders).

Both importers talk to the running app through the BFF (the same API the screens use),
signed in like scripts/client_specs/import_client_specs.py: inside the erp-app container a
host-maintenance session for an existing active Owner/Admin (no password), otherwise
ERP_IMPORT_EMAIL / ERP_IMPORT_PASSWORD. Dry-run unless --apply.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "client_import_2026-11-02"


def load_spec_importer():
    """Reuse the sign-in (Erp) of the client spec importer; one implementation of host sessions."""
    path = ROOT / "scripts" / "client_specs" / "import_client_specs.py"
    spec = importlib.util.spec_from_file_location("import_client_specs", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data-dir", default=str(DATA_DIR))
    parser.add_argument("--plant", default="PLANT_A", help="Plant code or id (PLANT_A / PLANT_B)")
    parser.add_argument("--auth-url", default=os.environ.get("ERP_AUTH_URL", "http://127.0.0.1:18001"))
    parser.add_argument("--bff-url", default=os.environ.get("ERP_BFF_URL", "http://127.0.0.1:14000"))
    parser.add_argument("--as", dest="as_user", help="Inside the app container: e-mail of the active Owner/Admin to run as")
    parser.add_argument("--apply", action="store_true", help="Write to the app (default: preview only)")
    parser.add_argument("--report", help="Write the JSON report here (a .txt report is written next to it)")


def connect(args):
    """Signed-in API client with X-Plant-ID set to the plant's canonical id."""
    module = load_spec_importer()
    erp = module.Erp(args)
    plants = erp.call("GET", args.auth_url, "/plants")
    wanted = norm(args.plant)
    plant = next((p for p in plants if norm(p.get("code")) == wanted or str(p.get("id")).lower() == args.plant.lower()), None)
    if plant is None:
        raise SystemExit(f"Plant {args.plant} not found; choose one of: {', '.join(str(p.get('code')) for p in plants)}")
    args.plant = str(plant["id"])
    return erp, plant, module.ApiError


def norm(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def name_key(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


STOP_WORDS = {"ltd", "limited", "pvt", "private", "the", "co", "company", "inc"}


def loose_key(value) -> str:
    """Company name without punctuation and legal suffixes: 'Garden Silk Mills Pvt. Ltd.' = 'Garden Silk Mills Ltd.'"""
    words = re.findall(r"[a-z0-9]+", str(value or "").lower())
    return "".join(word for word in words if word not in STOP_WORDS)


class CustomerResolver:
    """Map a client / Tally party name to ONE active customer master; never creates customers."""

    def __init__(self, customers: list[dict], alias_file: Path, use_confirm_aliases: bool = True):
        self.customers = [c for c in customers if c.get("active", True)]
        self.use_confirm_aliases = use_confirm_aliases
        aliases = json.loads(alias_file.read_text())["aliases"] if alias_file.exists() else []
        self.aliases = {name_key(a["source"]): a for a in aliases}
        self.aliases.update({loose_key(a["source"]): a for a in aliases})

    def _by_name(self, name):
        exact = [c for c in self.customers if name_key(c.get("name")) == name_key(name)]
        if len(exact) == 1:
            return exact[0]
        loose = [c for c in self.customers if loose_key(c.get("name")) == loose_key(name)]
        return loose[0] if len(loose) == 1 else None

    def resolve(self, name: str) -> tuple[dict | None, str]:
        """(customer, how): how is 'name', 'alias', 'alias (confirm: ...)' or why nothing matched."""
        customer = self._by_name(name)
        if customer:
            return customer, "name"
        alias = self.aliases.get(name_key(name)) or self.aliases.get(loose_key(name))
        if alias and alias.get("confirm") and not self.use_confirm_aliases:
            return None, f"alias to '{alias['customer']}' needs confirmation ({alias['why']}); left out by --no-confirm-aliases"
        if alias:
            customer = self._by_name(alias["customer"])
            if customer is None:
                return None, f"alias points at '{alias['customer']}', which is not an active customer"
            return customer, (f"alias (confirm: {alias['why']})" if alias.get("confirm") else "alias")
        return None, "no customer master with this name (customers are never created by the import)"


def dims_equal(a: float, b: float) -> bool:
    return abs(float(a) - float(b)) < 0.011


def near(a: float, b: float, tol: float = 0.21) -> bool:
    return abs(float(a) - float(b)) <= tol


def base_variant(description: str | None) -> str:
    """Tube size description without the tags the earlier importer added to tell duplicates apart."""
    parts = [p.strip() for p in str(description or "").split("·")]
    parts = [p for p in parts if p and not p.lower().startswith(("notch ", "sheet row "))]
    return " · ".join(parts)


def variant_key(value: str | None) -> str:
    return norm(value)


def tokens(value: str | None) -> set[str]:
    return set(re.findall(r"[A-Z0-9]+", str(value or "").upper()))


def box_code(raw) -> str:
    """R.125 = R-125, HBD 3 PLY = HBD-3 PLY, N.225 = N-225; JP-93.75 keeps its decimal (same as extract_workbooks.py)."""
    value = re.sub(r"\s+", " ", str(raw or "").strip().upper())
    match = re.fullmatch(r"([A-Z]+)\s*[.\-\s]\s*(\d.*)", value)
    return f"{match.group(1)}-{match.group(2)}" if match else value


def write_reports(path: str | None, report: dict, text: str) -> None:
    print(text)
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=1, default=str, ensure_ascii=False))
    target.with_suffix(".txt").write_text(text)
