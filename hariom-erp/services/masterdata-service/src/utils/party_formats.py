"""Format checks for party (vendor) master fields: GSTIN, PAN, IFSC, PIN, phone, email.

Every field is optional (client 2026-10-27: "GST number and more basic details, all optional").
A blank value is stored as NULL; a filled value is trimmed, upper-cased where the format is
upper-case, and checked for shape only. Nothing here calls the GST portal or verifies a checksum.
"""

from __future__ import annotations

import re
from typing import Optional

# GST state / union-territory codes (first two digits of a GSTIN).
GST_STATE_CODES: dict[str, str] = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "28": "Andhra Pradesh (old)",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman and Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
    "97": "Other Territory",
    "99": "Centre Jurisdiction",
}

PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
# 2-digit state code + 10-character PAN + entity number + one letter/digit (usually Z) + check character.
GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$")
IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PIN_PATTERN = re.compile(r"^[1-9][0-9]{5}$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def blank_to_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _squeezed_upper(value: Optional[str]) -> Optional[str]:
    cleaned = blank_to_none(value)
    if cleaned is None:
        return None
    return re.sub(r"\s+", "", cleaned).upper()


def normalize_gstin(value: Optional[str]) -> Optional[str]:
    """Upper-case GSTIN without spaces; ``ValueError`` when filled but not a GSTIN."""
    gstin = _squeezed_upper(value)
    if gstin is None:
        return None
    if len(gstin) != 15:
        raise ValueError(f"GSTIN must be 15 characters (got {len(gstin)})")
    if not GSTIN_PATTERN.match(gstin):
        raise ValueError("GSTIN must be 2-digit state code + 10-character PAN + 3 characters, e.g. 24ABCDE1234F1Z5")
    if gstin[:2] not in GST_STATE_CODES:
        raise ValueError(f"GSTIN starts with {gstin[:2]}, which is not a GST state code")
    return gstin


def normalize_pan(value: Optional[str]) -> Optional[str]:
    pan = _squeezed_upper(value)
    if pan is None:
        return None
    if not PAN_PATTERN.match(pan):
        raise ValueError("PAN must be 5 letters, 4 digits and 1 letter, e.g. ABCDE1234F")
    return pan


def normalize_ifsc(value: Optional[str]) -> Optional[str]:
    ifsc = _squeezed_upper(value)
    if ifsc is None:
        return None
    if not IFSC_PATTERN.match(ifsc):
        raise ValueError("IFSC must be 4 letters, a zero and 6 letters or digits, e.g. SBIN0001234")
    return ifsc


def normalize_pin(value: Optional[str]) -> Optional[str]:
    pin = _squeezed_upper(value)
    if pin is None:
        return None
    if not PIN_PATTERN.match(pin):
        raise ValueError("PIN code must be 6 digits and cannot start with 0")
    return pin


def normalize_state_code(value: Optional[str]) -> Optional[str]:
    code = _squeezed_upper(value)
    if code is None:
        return None
    if code.isdigit() and len(code) == 1:
        code = f"0{code}"
    if code not in GST_STATE_CODES:
        raise ValueError("State code must be a 2-digit GST state code, e.g. 24 for Gujarat")
    return code


def normalize_phone(value: Optional[str]) -> Optional[str]:
    phone = blank_to_none(value)
    if phone is None:
        return None
    if not re.match(r"^\+?[0-9\s\-()]+$", phone):
        raise ValueError("Phone may contain digits, spaces, +, - and brackets only")
    digits = re.sub(r"\D", "", phone)
    if not 6 <= len(digits) <= 15:
        raise ValueError("Phone must have 6 to 15 digits")
    return phone


def normalize_email(value: Optional[str]) -> Optional[str]:
    email = blank_to_none(value)
    if email is None:
        return None
    if not EMAIL_PATTERN.match(email):
        raise ValueError("Email must look like name@company.com")
    return email.lower()


def normalize_account_no(value: Optional[str]) -> Optional[str]:
    account = _squeezed_upper(value)
    if account is None:
        return None
    if not re.match(r"^[0-9]{6,20}$", account):
        raise ValueError("Bank account number must be 6 to 20 digits")
    return account


def state_for_code(code: Optional[str]) -> Optional[str]:
    return GST_STATE_CODES.get(code or "")


def full_address(supplier) -> Optional[str]:
    """One line for documents: lines, city, state - PIN, country (India is left out)."""
    city = blank_to_none(getattr(supplier, "city", None))
    state = blank_to_none(getattr(supplier, "state", None))
    pin = blank_to_none(getattr(supplier, "pin_code", None))
    country = blank_to_none(getattr(supplier, "country", None))
    place = ", ".join(part for part in (city, state) if part)
    if pin:
        place = f"{place} - {pin}" if place else pin
    parts = [
        blank_to_none(getattr(supplier, "address", None)),
        blank_to_none(getattr(supplier, "address_line2", None)),
        place or None,
        country if country and country.lower() != "india" else None,
    ]
    joined = ", ".join(part for part in parts if part)
    return joined or None
