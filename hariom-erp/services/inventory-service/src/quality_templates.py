"""Type-appropriate incoming QC templates.

Paper GSM/slitting and finished-good return-defect fields are not mandatory
on unrelated inward categories (packaging, tool, adhesive, OTHER).
"""

from __future__ import annotations

from typing import Any


ALLOWED_MATERIAL_TYPES = frozenset(
    {"ADHESIVE", "PARCHMENT", "RAW_PAPER", "FINISHED_GOOD", "PACKAGING", "TOOL", "OTHER"}
)

PAPER_MANDATORY_KEYS = frozenset({"gsm", "bf", "moisture_pct", "clear_for_slitting", "bs", "caliper_mm", "bulk", "ply_bond", "rct", "cobb"})
RETURN_DEFECT_KEYS = frozenset({"reject_reason", "rework_possible", "visual_defect"})

# Client inward QC lists (2026-10-16): paper GSM, width, reel weight, moisture, thickness, BF,
# polybond, remark; adhesive viscosity, solid %, pH, remark; parchment GSM, colour, weight, remark.
# Supplier, batch/lot and quantity come from the GRN line itself. Other long-standing checks stay
# registered but disabled (active=False) so QC can switch them on in Quality > Material standards.
# QC owns this list (add / rename / disable); Masters own the tolerance bands (2026-10-18).
QC_TEMPLATE_PRESETS: tuple[dict[str, Any], ...] = (
    {"material_type": "RAW_PAPER", "parameter_key": "gsm", "label": "GSM", "unit": "g/m²", "input_type": "number", "options": [], "required": True, "sort_order": 10},
    {"material_type": "RAW_PAPER", "parameter_key": "width_mm", "label": "Paper width", "unit": "mm", "input_type": "number", "options": [], "required": True, "sort_order": 11},
    {"material_type": "RAW_PAPER", "parameter_key": "reel_weight_kg", "label": "Reel weight", "unit": "kg", "input_type": "number", "options": [], "required": True, "sort_order": 12},
    {"material_type": "RAW_PAPER", "parameter_key": "moisture_pct", "label": "Moisture", "unit": "%", "input_type": "number", "options": [], "required": True, "sort_order": 20},
    {"material_type": "RAW_PAPER", "parameter_key": "caliper_mm", "label": "Thickness", "unit": "mm", "input_type": "number", "options": [], "required": True, "sort_order": 30},
    {"material_type": "RAW_PAPER", "parameter_key": "bf", "label": "BF", "unit": "", "input_type": "number", "options": [], "required": True, "sort_order": 40},
    {"material_type": "RAW_PAPER", "parameter_key": "ply_bond", "label": "Polybond", "unit": "", "input_type": "number", "options": [], "required": True, "sort_order": 50},
    {"material_type": "RAW_PAPER", "parameter_key": "remark", "label": "Remark", "unit": "", "input_type": "text", "options": [], "required": False, "sort_order": 95},
    {"material_type": "RAW_PAPER", "parameter_key": "bs", "label": "BS", "unit": "", "input_type": "number", "options": [], "required": False, "sort_order": 60, "active": False},
    {"material_type": "RAW_PAPER", "parameter_key": "bulk", "label": "Bulk", "unit": "", "input_type": "number", "options": [], "required": False, "sort_order": 70, "active": False},
    {"material_type": "RAW_PAPER", "parameter_key": "rct", "label": "RCT", "unit": "", "input_type": "number", "options": [], "required": False, "sort_order": 75, "active": False},
    {"material_type": "RAW_PAPER", "parameter_key": "cobb", "label": "COBB", "unit": "", "input_type": "number", "options": [], "required": False, "sort_order": 80, "active": False},
    {"material_type": "RAW_PAPER", "parameter_key": "clear_for_slitting", "label": "Clear for slitting", "unit": "", "input_type": "select", "options": ["YES", "NO", "HOLD"], "required": False, "sort_order": 90, "active": False},
    {"material_type": "ADHESIVE", "parameter_key": "viscosity", "label": "Viscosity", "unit": "", "input_type": "number", "options": [], "required": True, "sort_order": 10},
    {"material_type": "ADHESIVE", "parameter_key": "solid_content", "label": "Solid", "unit": "%", "input_type": "number", "options": [], "required": True, "sort_order": 20},
    {"material_type": "ADHESIVE", "parameter_key": "ph", "label": "pH", "unit": "", "input_type": "number", "options": [], "required": True, "sort_order": 30},
    {"material_type": "ADHESIVE", "parameter_key": "remark", "label": "Remark", "unit": "", "input_type": "text", "options": [], "required": False, "sort_order": 60},
    {"material_type": "ADHESIVE", "parameter_key": "temperature", "label": "Temperature", "unit": "°C", "input_type": "number", "options": [], "required": False, "sort_order": 40, "active": False},
    {"material_type": "ADHESIVE", "parameter_key": "color", "label": "Colour", "unit": "", "input_type": "text", "options": [], "required": False, "sort_order": 50, "active": False},
    {"material_type": "PARCHMENT", "parameter_key": "gsm", "label": "GSM", "unit": "g/m²", "input_type": "number", "options": [], "required": True, "sort_order": 10},
    {"material_type": "PARCHMENT", "parameter_key": "color", "label": "Colour", "unit": "", "input_type": "text", "options": [], "required": True, "sort_order": 20},
    {"material_type": "PARCHMENT", "parameter_key": "weight_kg", "label": "Weight", "unit": "kg", "input_type": "number", "options": [], "required": True, "sort_order": 30},
    {"material_type": "PARCHMENT", "parameter_key": "remark", "label": "Remark", "unit": "", "input_type": "text", "options": [], "required": False, "sort_order": 60},
    {"material_type": "PARCHMENT", "parameter_key": "color_bleeding", "label": "Colour bleeding", "unit": "", "input_type": "select", "options": ["PASS", "FAIL"], "required": False, "sort_order": 40, "active": False},
    {"material_type": "PARCHMENT", "parameter_key": "bf", "label": "BF", "unit": "", "input_type": "number", "options": [], "required": False, "sort_order": 50, "active": False},
    {"material_type": "FINISHED_GOOD", "parameter_key": "visual_ok", "label": "Visual OK", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 10},
    {"material_type": "FINISHED_GOOD", "parameter_key": "label_match", "label": "Label Match", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 20},
    {"material_type": "FINISHED_GOOD", "parameter_key": "visual_defect", "label": "Visual Defect", "input_type": "text", "options": [], "required": False, "sort_order": 30},
    {"material_type": "FINISHED_GOOD", "parameter_key": "reject_reason", "label": "Reject Reason", "input_type": "text", "options": [], "required": False, "sort_order": 40},
    {"material_type": "FINISHED_GOOD", "parameter_key": "rework_possible", "label": "Rework Possible", "input_type": "select", "options": ["YES", "NO"], "required": False, "sort_order": 50},
    {"material_type": "PACKAGING", "parameter_key": "seal_integrity", "label": "Seal integrity", "input_type": "select", "options": ["PASS", "FAIL"], "required": True, "sort_order": 10},
    {"material_type": "PACKAGING", "parameter_key": "print_registration", "label": "Print registration", "input_type": "text", "options": [], "required": True, "sort_order": 20},
    {"material_type": "PACKAGING", "parameter_key": "burst", "label": "Burst", "input_type": "number", "options": [], "required": False, "sort_order": 30},
    {"material_type": "TOOL", "parameter_key": "asset_identity", "label": "Asset identity", "input_type": "text", "options": [], "required": True, "sort_order": 10},
    {"material_type": "TOOL", "parameter_key": "calibration_due", "label": "Calibration due", "input_type": "text", "options": [], "required": True, "sort_order": 20},
    {"material_type": "TOOL", "parameter_key": "condition", "label": "Condition", "input_type": "select", "options": ["OK", "HOLD", "SCRAP"], "required": True, "sort_order": 30},
    {"material_type": "OTHER", "parameter_key": "visual_ok", "label": "Visual OK", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 10},
    {"material_type": "OTHER", "parameter_key": "identity_confirmed", "label": "Identity confirmed", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 20},
)
