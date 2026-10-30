/**
 * Delivery challan helpers (client 2026-10-28).
 *
 * - The plant (legal name, address, GSTIN) and the customer (GSTIN, billing and dispatch address)
 *   come from their masters; the challan keeps a copy when it is sealed.
 * - Net weight fills itself: shipment pcs × finished tube weight per piece from the spec sheet.
 *   It is worked out again when the pcs change and stays editable before sealing.
 * - Every seal refusal says in plain words what is missing and where it is fixed.
 */
import { fromGstin, stateCodeFor, stateName } from "./party-formats"

const finite = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
const clean = (value: unknown) => String(value ?? "").trim()

export type TubeWeight = { grams: number; source: string }

/** Finished tube weight per piece (grams) from the job card's spec sheet, or null when the spec has none. */
export function tubeWeightFromSpec(spec: any): TubeWeight | null {
  if (!spec || typeof spec !== "object") return null
  const average = finite(spec.weight_avg_g)
  if (average) return { grams: average, source: "spec average tube weight" }
  const target = finite(spec.target_tube_weight)
  if (target) return { grams: target, source: "spec target tube weight" }
  const low = finite(spec.weight_min_g)
  const high = finite(spec.weight_max_g)
  if (low && high) return { grams: (low + high) / 2, source: "middle of the spec weight band" }
  const customer = finite(spec.qc_profile?.refs?.CUSTOMER_WEIGHT)
  if (customer) return { grams: customer, source: "customer tube weight on the spec" }
  return null
}

/** True when a net weight (kg) is typed or worked out and is more than 0. An empty field is not 0 kg. */
export function hasNetWeight(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}

/** Net weight in kg for a shipment, rounded to grams (3 decimals). */
export function netWeightKg(pcs: number, gramsPerPiece: number) {
  const value = (Number(pcs) * Number(gramsPerPiece)) / 1000
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : 0
}

export function formatKg(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return "0"
  return parsed.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

export function formatGrams(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return "0"
  return parsed.toLocaleString("en-IN", { maximumFractionDigits: 2 })
}

/** One line from street lines + city, state - PIN (the masterdata service builds the same line). */
export function placeLine(street?: string | null, city?: string | null, state?: string | null, pin?: string | null) {
  let place = [clean(city), clean(state)].filter(Boolean).join(", ")
  if (clean(pin)) place = place ? `${place} - ${clean(pin)}` : clean(pin)
  const lines = clean(street).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return [...lines, place].filter(Boolean).join(", ")
}

export type ChallanCompany = {
  id?: string
  code?: string
  name?: string
  legal_name?: string
  address?: string
  gstin?: string
  state?: string
  state_code?: string
}

export type ChallanCustomer = {
  id?: string
  code?: string
  name?: string
  gstin?: string
  state?: string
  state_code?: string
  billing_address?: string
  /** Dispatch (ship-to) address. */
  address?: string
  ship_state?: string
  ship_state_code?: string
  contact_name?: string
  contact_phone?: string
}

/** Plant block of the challan, from the plant master. */
export function plantChallanParty(plant: any): ChallanCompany {
  if (!plant) return {}
  const gstin = clean(plant.gstin).toUpperCase()
  const fromTax = fromGstin(gstin)
  return {
    id: plant.id ? String(plant.id) : undefined,
    code: clean(plant.code) || undefined,
    name: clean(plant.name) || undefined,
    legal_name: clean(plant.legal_name) || undefined,
    address: clean(plant.address) || undefined,
    gstin: gstin || undefined,
    state: fromTax.state || undefined,
    state_code: fromTax.stateCode || undefined,
  }
}

/** True when the customer keeps a dispatch (ship-to) address apart from the billing address. */
export function hasSeparateShipTo(customer: any) {
  if (!customer) return false
  const billingStreet = clean(customer.billing_address || customer.address)
  return Boolean(
    clean(customer.shipping_city) || clean(customer.shipping_state) || clean(customer.shipping_state_code) || clean(customer.shipping_pin_code) ||
      (clean(customer.shipping_address) && clean(customer.shipping_address) !== billingStreet),
  )
}

export function customerBillingAddress(customer: any) {
  if (!customer) return ""
  return clean(customer.billing_full_address) ||
    placeLine(customer.billing_address || customer.address, customer.billing_city, customer.billing_state, customer.billing_pin_code)
}

/**
 * The street lines of the dispatch (ship-to) address: the separate ship-to street, else the billing street.
 * Goods cannot be sent to "Gujarat": a GSTIN fills the billing state by itself, so a customer with only a GSTIN
 * (or only a city) has no dispatch address. The server applies the same rule when sealing.
 */
export function customerDispatchStreet(customer: any) {
  if (!customer) return ""
  return hasSeparateShipTo(customer) ? clean(customer.shipping_address) : clean(customer.billing_address || customer.address)
}

export function customerDispatchAddress(customer: any) {
  if (!customer || !customerDispatchStreet(customer)) return ""
  if (clean(customer.shipping_full_address)) return clean(customer.shipping_full_address)
  if (hasSeparateShipTo(customer)) return placeLine(customer.shipping_address, customer.shipping_city, customer.shipping_state, customer.shipping_pin_code)
  return customerBillingAddress(customer)
}

/** Customer block of the challan, from the customer master. */
export function customerChallanParty(customer: any): ChallanCustomer {
  if (!customer) return {}
  const gstin = clean(customer.gst_no || customer.tax_id).toUpperCase()
  const fromTax = fromGstin(gstin)
  const stateCode = clean(customer.billing_state_code) || fromTax.stateCode
  const separate = hasSeparateShipTo(customer)
  const shipCode = separate ? clean(customer.shipping_state_code) || stateCodeFor(customer.shipping_state) : stateCode
  return {
    id: customer.id ? String(customer.id) : undefined,
    code: clean(customer.customer_code) || undefined,
    name: clean(customer.name) || undefined,
    gstin: gstin || undefined,
    state: clean(customer.billing_state) || stateName(stateCode) || fromTax.state || undefined,
    state_code: stateCode || undefined,
    billing_address: customerBillingAddress(customer) || undefined,
    address: customerDispatchAddress(customer) || undefined,
    ship_state: (separate ? clean(customer.shipping_state) || stateName(shipCode) : clean(customer.billing_state) || stateName(stateCode)) || undefined,
    ship_state_code: shipCode || undefined,
    contact_name: clean(customer.dispatch_contact_name || customer.primary_contact_name) || undefined,
    contact_phone: clean(customer.dispatch_contact_phone || customer.primary_contact_phone) || undefined,
  }
}

export type ChallanGap = {
  key: string
  /** Plain words: what is missing. */
  text: string
  /** Where it is fixed. */
  place: "plant" | "customer" | "challan"
  href?: string
  fixLabel: string
}

export const plantMasterHref = (plantId?: string | null) => `/system/plants${plantId ? `?edit=${encodeURIComponent(plantId)}` : ""}`
export const customerMasterHref = (customerId?: string | null) => `/masters/customers${customerId ? `?edit=${encodeURIComponent(customerId)}` : ""}`

/**
 * What stops this challan from being sealed, in plain words, each with the place it is fixed.
 * Plant legal name / address / GSTIN and the customer dispatch address come from the masters;
 * vehicle, transporter, quantity and net weight are typed on the challan. The server checks the same list.
 */
export function challanGaps(data: any, ids: { plantId?: string | null; customerId?: string | null } = {}): ChallanGap[] {
  const company = data?.company || {}
  const customer = data?.customer || {}
  const plantName = clean(company.legal_name || company.name) || "this plant"
  const customerName = clean(customer.name) || "this customer"
  const plantHref = plantMasterHref(ids.plantId || company.id)
  const customerHref = customerMasterHref(ids.customerId || customer.id)
  const gaps: ChallanGap[] = []
  if (!clean(company.legal_name || company.name)) gaps.push({ key: "plant_name", text: "The plant's legal name is not in the plant master.", place: "plant", href: plantHref, fixLabel: "Add it in Plants" })
  if (!clean(company.address)) gaps.push({ key: "plant_address", text: `The address of ${plantName} is not in the plant master.`, place: "plant", href: plantHref, fixLabel: "Add it in Plants" })
  if (!clean(company.gstin)) gaps.push({ key: "plant_gstin", text: `The GSTIN of ${plantName} is not in the plant master.`, place: "plant", href: plantHref, fixLabel: "Add it in Plants" })
  if (!clean(customer.name)) gaps.push({ key: "customer_name", text: "The customer of this order is not in the customer master for this plant.", place: "customer", href: customerHref, fixLabel: "Open Customers" })
  else if (!clean(customer.address)) gaps.push({ key: "customer_address", text: `The dispatch (ship-to) street address of ${customerName} is not in the customer master.`, place: "customer", href: customerHref, fixLabel: "Add it in Customers" })
  if (!clean(data?.transporter?.vehicle_no)) gaps.push({ key: "vehicle_no", text: "The vehicle number is empty.", place: "challan", href: "#challan-vehicle", fixLabel: "Type it on the challan" })
  if (!clean(data?.transporter?.name)) gaps.push({ key: "transporter", text: "The transporter name is empty.", place: "challan", href: "#challan-transporter", fixLabel: "Type it on the challan" })
  if (!(Number(data?.items?.[0]?.total_pcs) > 0)) gaps.push({ key: "qty", text: "The shipment quantity is empty.", place: "challan", href: "#challan-qty", fixLabel: "Go to the quantity" })
  if (!hasNetWeight(data?.items?.[0]?.net_weight)) gaps.push({ key: "net_weight", text: "The net weight is empty or 0 kg.", place: "challan", href: "#challan-weight", fixLabel: "Go to the net weight" })
  return gaps
}

/**
 * The server's own seal refusal ("The challan cannot be sealed yet: a; b; c.") as gaps with fix links, for when
 * the page's copy of the masters was stale (for example the plant GSTIN was cleared in another tab).
 * Returns [] for any other message.
 */
export function gapsFromServerMessage(message: unknown, ids: { plantId?: string | null; customerId?: string | null } = {}): ChallanGap[] {
  const text = clean(message)
  const prefix = /^The challan cannot be sealed yet:\s*/i
  if (!prefix.test(text)) return []
  const parts = text.replace(prefix, "").replace(/\.\s*$/, "").split(/;\s*/).map((part) => part.trim()).filter(Boolean)
  const sentence = (part: string) => {
    const words = part.replace(/\s*\((System › Plants|Masters › Customers|type it on the challan)\)\s*/gi, " ").trim()
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`
  }
  return parts.map((part, index): ChallanGap => {
    const lower = part.toLowerCase()
    const base = { key: `server_${index}`, text: sentence(part) }
    if (lower.includes("plant master")) return { ...base, place: "plant", href: plantMasterHref(ids.plantId), fixLabel: "Fix it in Plants" }
    if (lower.includes("customer master")) return { ...base, place: "customer", href: customerMasterHref(ids.customerId), fixLabel: "Fix it in Customers" }
    if (lower.includes("vehicle")) return { ...base, place: "challan", href: "#challan-vehicle", fixLabel: "Type it on the challan" }
    if (lower.includes("transporter")) return { ...base, place: "challan", href: "#challan-transporter", fixLabel: "Type it on the challan" }
    if (lower.includes("net weight")) return { ...base, place: "challan", href: "#challan-weight", fixLabel: "Go to the net weight" }
    return { ...base, place: "challan", fixLabel: "" }
  })
}

/** Details that do not stop sealing but print blank on the challan. */
export function challanNotes(data: any): string[] {
  const notes: string[] = []
  if (clean(data?.customer?.name) && !clean(data?.customer?.gstin)) notes.push(`The GSTIN of ${clean(data.customer.name)} is not in the customer master, so the challan prints without it.`)
  return notes
}
