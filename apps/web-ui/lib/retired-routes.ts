/**
 * Retired pages and where their old links now go (client 2026-10-28). next.config.js redirects each one
 * at the routing layer (query string passed through), before any page or role gate renders, so every
 * role's old bookmark works. Each route also keeps a small server redirect page built from these
 * helpers as a fallback, which maps the old query (month, plant, search) the same way.
 *
 * Query contracts the new pages read:
 *   /inventory/stock-control       ?tab=counts|corrections|book &month=YYYY-MM
 *   /production/reconciliation     ?tab=month|past|year &month=YYYY-MM
 *   /production/reconciliation/limits ?plant=<id>
 *   /purchase/scheduler            ?view=week|month|list &q=<search>
 */

export type SearchParamsInput = Record<string, string | string[] | undefined> | undefined

function first(params: SearchParamsInput, ...keys: string[]): string {
  for (const key of keys) {
    const value = params?.[key]
    const text = Array.isArray(value) ? value[0] : value
    if (text && text.trim()) return text.trim()
  }
  return ""
}

/** "2026-10" from "2026-10" or "2026-10-01"; anything else is dropped. */
export function monthParam(value: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(value || "")
  return match ? `${match[1]}-${match[2]}` : ""
}

function build(path: string, query: Record<string, string>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, value)
  const text = search.toString()
  return text ? `${path}?${text}` : path
}

/** Every query value passed through unchanged (for a page that only moved). */
function carryAll(path: string, params: SearchParamsInput): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) value.forEach((item) => search.append(key, item))
    else if (value !== undefined) search.set(key, value)
  }
  const text = search.toString()
  return text ? `${path}?${text}` : path
}

/** Actual entry and Weekly drift are part of this month's close; Close history is the Past months tab. */
export function reconciliationRedirect(view: "actuals" | "drift" | "history", params: SearchParamsInput): string {
  return build("/production/reconciliation", {
    tab: view === "history" ? "past" : "month",
    month: monthParam(first(params, "month", "month_start")),
    plant: first(params, "plant", "plant_id"),
  })
}

/** Stock variance limits became Usage limits under Month-end close. */
export function tolerancesRedirect(params: SearchParamsInput): string {
  return build("/production/reconciliation/limits", { plant: first(params, "plant", "plant_id") })
}

/** Locations moved from System to Stores, unchanged. */
export function locationsRedirect(params: SearchParamsInput): string {
  return carryAll("/inventory/locations", params)
}

/** The Stock lifecycle tracker folded into Stock counts & book. */
export function lifecycleRedirect(params: SearchParamsInput): string {
  return build("/inventory/stock-control", { month: monthParam(first(params, "month", "month_start")) })
}

/** The count list lives on the Stock counts & book hub (count pages are /inventory/counts/<id>). */
export function countsRedirect(params: SearchParamsInput): string {
  return build("/inventory/stock-control", { tab: "counts", month: monthParam(first(params, "month")) })
}

/** The MRP coverage screen is replaced by the RM inward calendar; its demand list is the List view. */
export function mrpRedirect(params: SearchParamsInput): string {
  return build("/purchase/scheduler", { view: "list", q: first(params, "q", "search", "item") })
}
