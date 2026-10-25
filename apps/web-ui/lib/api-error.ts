/**
 * One plain sentence from any API error (client 2026-10-25: a stage close showed raw JSON —
 * [{"type":"value_error","loc":["body","shift_code"],"msg":"Value error, ..."}]).
 */
const FIELD_LABELS: Record<string, string> = { shift_code: "Shift", machine_id: "Machine", output_qty: "Output", input_qty: "Input", start_time: "Start time", end_time: "End time" }

function fieldLabel(loc: unknown): string {
  const parts = Array.isArray(loc) ? loc.filter((part) => part !== "body" && part !== "query" && typeof part === "string") : []
  const last = String(parts[parts.length - 1] || "")
  if (!last) return ""
  return FIELD_LABELS[last] || last.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
}

function validationLine(row: any): string {
  if (typeof row === "string") return row
  const message = String(row?.msg || row?.message || "").replace(/^Value error,\s*/i, "").replace(/^Assertion failed,\s*/i, "")
  const field = fieldLabel(row?.loc)
  if (!message) return field ? `${field} is not valid` : "A value is not valid"
  return field && !message.toLowerCase().includes(field.toLowerCase()) ? `${field}: ${message}` : message
}

export function describeApiError(error: any, fallback = "Something went wrong"): string {
  const data = error?.response?.data
  const detail = data?.detail ?? data
  if (typeof detail === "string" && detail.trim()) return detail
  if (Array.isArray(detail)) return detail.map(validationLine).join(" · ")
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message
    if (Array.isArray(detail.errors) && detail.errors.length) return detail.errors.map(validationLine).join(" · ")
    if (typeof detail.detail === "string") return detail.detail
  }
  return String(error?.message || fallback)
}

/** The same plain sentence when a page already pulled out `response.data.detail`. */
export function describeErrorDetail(detail: unknown, fallback = "Something went wrong"): string {
  return describeApiError({ response: { data: { detail } } }, fallback)
}
