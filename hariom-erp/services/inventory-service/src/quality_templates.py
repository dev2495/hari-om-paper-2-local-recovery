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

QC_TEMPLATE_PRESETS: tuple[dict[str, Any], ...] = (
    {"material_type": "ADHESIVE", "parameter_key": "viscosity", "label": "Viscosity", "input_type": "number", "options": [], "required": True, "sort_order": 10},
    {"material_type": "ADHESIVE", "parameter_key": "temperature", "label": "Temperature", "input_type": "number", "options": [], "required": True, "sort_order": 20},
    {"material_type": "ADHESIVE", "parameter_key": "solid_content", "label": "Solid Content", "input_type": "number", "options": [], "required": True, "sort_order": 30},
    {"material_type": "ADHESIVE", "parameter_key": "color", "label": "Color", "input_type": "text", "options": [], "required": True, "sort_order": 40},
    {"material_type": "ADHESIVE", "parameter_key": "ph", "label": "PH", "input_type": "number", "options": [], "required": True, "sort_order": 50},
    {"material_type": "PARCHMENT", "parameter_key": "color_bleeding", "label": "Color Bleeding", "input_type": "select", "options": ["PASS", "FAIL"], "required": True, "sort_order": 10},
    {"material_type": "PARCHMENT", "parameter_key": "gsm", "label": "GSM", "input_type": "number", "options": [], "required": True, "sort_order": 20},
    {"material_type": "PARCHMENT", "parameter_key": "bf", "label": "BF", "input_type": "number", "options": [], "required": True, "sort_order": 30},
    {"material_type": "RAW_PAPER", "parameter_key": "gsm", "label": "GSM", "input_type": "number", "options": [], "required": True, "sort_order": 10},
    {"material_type": "RAW_PAPER", "parameter_key": "bs", "label": "BS", "input_type": "number", "options": [], "required": False, "sort_order": 20},
    {"material_type": "RAW_PAPER", "parameter_key": "bf", "label": "BF", "input_type": "number", "options": [], "required": True, "sort_order": 30},
    {"material_type": "RAW_PAPER", "parameter_key": "caliper_mm", "label": "Caliper (mm)", "input_type": "number", "options": [], "required": False, "sort_order": 40},
    {"material_type": "RAW_PAPER", "parameter_key": "bulk", "label": "Bulk", "input_type": "number", "options": [], "required": False, "sort_order": 50},
    {"material_type": "RAW_PAPER", "parameter_key": "ply_bond", "label": "Ply Bond", "input_type": "number", "options": [], "required": False, "sort_order": 60},
    {"material_type": "RAW_PAPER", "parameter_key": "rct", "label": "RCT", "input_type": "number", "options": [], "required": False, "sort_order": 70},
    {"material_type": "RAW_PAPER", "parameter_key": "cobb", "label": "COBB", "input_type": "number", "options": [], "required": False, "sort_order": 80},
    {"material_type": "RAW_PAPER", "parameter_key": "moisture_pct", "label": "Moisture %", "input_type": "number", "options": [], "required": True, "sort_order": 90},
    {"material_type": "RAW_PAPER", "parameter_key": "clear_for_slitting", "label": "Clear For Slitting", "input_type": "select", "options": ["YES", "NO", "HOLD"], "required": True, "sort_order": 100},
    {"material_type": "FINISHED_GOOD", "parameter_key": "visual_ok", "label": "Visual OK", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 10},
    {"material_type": "FINISHED_GOOD", "parameter_key": "label_match", "label": "Label Match", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 20},
    {"material_type": "FINISHED_GOOD", "parameter_key": "visual_defect", "label": "Visual Defect", "input_type": "text", "options": [], "required": False, "sort_order": 30},
    {"material_type": "FINISHED_GOOD", "parameter_key": "reject_reason", "label": "Reject Reason", "input_type": "text", "options": [], "required": False, "sort_order": 40},
    {"material_type": "FINISHED_GOOD", "parameter_key": "rework_possible", "label": "Rework Possible", "input_type": "select", "options": ["YES", "NO"], "required": False, "sort_order": 50},
    {"material_type": "PACKAGING", "parameter_key": "seal_integrity", "label": "Seal Integrity", "input_type": "select", "options": ["PASS", "FAIL"], "required": True, "sort_order": 10},
    {"material_type": "PACKAGING", "parameter_key": "print_registration", "label": "Print Registration", "input_type": "text", "options": [], "required": True, "sort_order": 20},
    {"material_type": "PACKAGING", "parameter_key": "burst", "label": "Burst", "input_type": "number", "options": [], "required": False, "sort_order": 30},
    {"material_type": "TOOL", "parameter_key": "asset_identity", "label": "Asset Identity", "input_type": "text", "options": [], "required": True, "sort_order": 10},
    {"material_type": "TOOL", "parameter_key": "calibration_due", "label": "Calibration Due", "input_type": "text", "options": [], "required": True, "sort_order": 20},
    {"material_type": "TOOL", "parameter_key": "condition", "label": "Condition", "input_type": "select", "options": ["OK", "HOLD", "SCRAP"], "required": True, "sort_order": 30},
    {"material_type": "OTHER", "parameter_key": "visual_ok", "label": "Visual OK", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 10},
    {"material_type": "OTHER", "parameter_key": "identity_confirmed", "label": "Identity Confirmed", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 20},
)
