export const ORDER_ORIGIN_CUSTOMER_PO = "CUSTOMER_PO"
export const ORDER_ORIGIN_INTERNAL = "INTERNAL"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function formatCustomerPoDate(value?: string | null) {
  if (!value) return ""
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return String(value)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || month < 1 || month > 12 || day < 1) return String(value)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

export function addCalendarDays(isoDate: string, days: number) {
  const match = String(isoDate).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ""
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days)
  const next = new Date(utc)
  const month = String(next.getUTCMonth() + 1).padStart(2, "0")
  const day = String(next.getUTCDate()).padStart(2, "0")
  return `${next.getUTCFullYear()}-${month}-${day}`
}

export function deliveryDateMustFollowCustomerPoDate(deliveryDate: string, customerPoDate: string, origin = ORDER_ORIGIN_CUSTOMER_PO) {
  if (origin !== ORDER_ORIGIN_CUSTOMER_PO) return null
  if (!customerPoDate) return "Customer PO Date is required for customer PO orders."
  if (!deliveryDate || deliveryDate <= customerPoDate) {
    return `Delivery date must be after the Customer PO Date (${formatCustomerPoDate(customerPoDate)}).`
  }
  return null
}

export function isCustomerPoOrigin(origin?: string | null) {
  return String(origin || ORDER_ORIGIN_CUSTOMER_PO).toUpperCase() === ORDER_ORIGIN_CUSTOMER_PO
}

export function isInternalOrigin(origin?: string | null) {
  return String(origin || "").toUpperCase() === ORDER_ORIGIN_INTERNAL
}

export function salesOrderReferenceLabel(order: { origin?: string | null; po_number?: string | null; order_no?: string | null; id?: string | null }) {
  if (isInternalOrigin(order?.origin)) return order?.order_no || String(order?.id || "-")
  return order?.po_number || order?.order_no || String(order?.id || "-")
}

export function salesOrderOriginLabel(origin?: string | null) {
  const value = String(origin || "").toUpperCase()
  if (value === ORDER_ORIGIN_INTERNAL) return "Internal sales order"
  if (value === "REVIEW") return "Origin review"
  return "Customer PO"
}

export function parchmentLineLabel(line: { parchment_required?: boolean; parchment_color?: string | null }) {
  if (line?.parchment_required) return line.parchment_color ? `Parchment ${line.parchment_color}` : "Parchment required"
  return "No parchment"
}
