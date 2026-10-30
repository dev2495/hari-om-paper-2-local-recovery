/**
 * Vendor (party) master formats (client 2026-10-27: "GST number and more basic details, all optional").
 * The same checks run in masterdata-service (`src/utils/party_formats.py`); the page uses these to
 * explain a problem before saving. Blank is always fine.
 */

export const GST_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (old)" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
  { code: "99", name: "Centre Jurisdiction" },
]

const STATE_BY_CODE = new Map(GST_STATES.map((row) => [row.code, row.name]))

const squeeze = (value?: string | null) => String(value ?? "").replace(/\s+/g, "").toUpperCase()

export function stateName(code?: string | null) {
  return STATE_BY_CODE.get(String(code || "")) || ""
}

export function stateCodeFor(name?: string | null) {
  const wanted = String(name || "").trim().toLowerCase()
  return GST_STATES.find((row) => row.name.toLowerCase() === wanted)?.code || ""
}

/** Error text for a filled GSTIN that is not one, else "" (blank is fine). */
export function gstinError(value?: string | null) {
  const gstin = squeeze(value)
  if (!gstin) return ""
  if (gstin.length !== 15) return `GSTIN must be 15 characters (now ${gstin.length})`
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/.test(gstin)) return "GSTIN must be 2-digit state code + 10-character PAN + 3 characters, e.g. 24ABCDE1234F1Z5"
  if (!STATE_BY_CODE.has(gstin.slice(0, 2))) return `GSTIN starts with ${gstin.slice(0, 2)}, which is not a GST state code`
  return ""
}

export function panError(value?: string | null) {
  const pan = squeeze(value)
  if (!pan) return ""
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? "" : "PAN must be 5 letters, 4 digits and 1 letter, e.g. ABCDE1234F"
}

export function ifscError(value?: string | null) {
  const ifsc = squeeze(value)
  if (!ifsc) return ""
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) ? "" : "IFSC must be 4 letters, a zero and 6 letters or digits, e.g. SBIN0001234"
}

export function pinError(value?: string | null) {
  const pin = squeeze(value)
  if (!pin) return ""
  return /^[1-9][0-9]{5}$/.test(pin) ? "" : "PIN code must be 6 digits and cannot start with 0"
}

export function phoneError(value?: string | null) {
  const phone = String(value ?? "").trim()
  if (!phone) return ""
  if (!/^\+?[0-9\s\-()]+$/.test(phone)) return "Phone may contain digits, spaces, +, - and brackets only"
  const digits = phone.replace(/\D/g, "").length
  return digits >= 6 && digits <= 15 ? "" : "Phone must have 6 to 15 digits"
}

export function emailError(value?: string | null) {
  const email = String(value ?? "").trim()
  if (!email) return ""
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? "" : "Email must look like name@company.com"
}

export function accountNoError(value?: string | null) {
  const account = squeeze(value)
  if (!account) return ""
  return /^[0-9]{6,20}$/.test(account) ? "" : "Bank account number must be 6 to 20 digits"
}

export function daysError(value?: string | number | null, label = "Days") {
  if (value === "" || value == null) return ""
  const days = Number(value)
  return Number.isInteger(days) && days >= 0 && days <= 365 ? "" : `${label} must be 0 to 365 days`
}

/** The PAN and state a valid GSTIN carries ("" when the GSTIN is not complete). */
export function fromGstin(value?: string | null) {
  const gstin = squeeze(value)
  if (gstinError(gstin) || !gstin) return { pan: "", stateCode: "", state: "" }
  return { pan: gstin.slice(2, 12), stateCode: gstin.slice(0, 2), state: stateName(gstin.slice(0, 2)) }
}

export type VendorDetails = {
  address?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  state_code?: string | null
  pin_code?: string | null
  country?: string | null
  full_address?: string | null
}

/** One line for documents: lines, city, state - PIN (India is left out), as the service builds it. */
export function vendorAddress(vendor?: VendorDetails | null) {
  if (!vendor) return ""
  if (vendor.full_address) return vendor.full_address
  const clean = (value?: string | null) => String(value ?? "").trim()
  let place = [clean(vendor.city), clean(vendor.state)].filter(Boolean).join(", ")
  if (clean(vendor.pin_code)) place = place ? `${place} - ${clean(vendor.pin_code)}` : clean(vendor.pin_code)
  const country = clean(vendor.country)
  return [clean(vendor.address), clean(vendor.address_line2), place, country && country.toLowerCase() !== "india" ? country : ""].filter(Boolean).join(", ")
}

/** Field → error for the vendor form; empty object when everything filled is well formed. */
export function vendorFormErrors(form: Record<string, any>) {
  // The PAN and the state print beside the GSTIN on the PO, so they must be the GSTIN's (the server refuses a mismatch too).
  const tax = fromGstin(form.gst_no)
  const pan = squeeze(form.pan_no)
  const stateCode = String(form.state_code ?? "").trim()
  const checks: [string, string][] = [
    ["gst_no", gstinError(form.gst_no)],
    ["pan_no", panError(form.pan_no) || (tax.pan && pan && pan !== tax.pan ? `PAN ${pan} does not match the GSTIN, which carries PAN ${tax.pan}` : "")],
    ["state_code", tax.stateCode && stateCode && stateCode !== tax.stateCode ? `The GSTIN is registered in ${tax.state} (${tax.stateCode}), not ${stateName(stateCode) || stateCode} (${stateCode})` : ""],
    ["pin_code", pinError(form.pin_code)],
    ["contact_phone", phoneError(form.contact_phone)],
    ["alt_phone", phoneError(form.alt_phone)],
    ["contact_email", emailError(form.contact_email)],
    ["bank_ifsc", ifscError(form.bank_ifsc)],
    ["bank_account_no", accountNoError(form.bank_account_no)],
    ["payment_terms_days", daysError(form.payment_terms_days, "Payment terms")],
    ["credit_days", daysError(form.credit_days, "Credit days")],
    ["credit_limit", form.credit_limit !== "" && form.credit_limit != null && !(Number(form.credit_limit) >= 0) ? "Credit limit must be 0 or more" : ""],
  ]
  return Object.fromEntries(checks.filter(([, error]) => error)) as Record<string, string>
}
