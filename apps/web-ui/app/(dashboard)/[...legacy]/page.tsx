import { notFound, redirect } from "next/navigation"

type LegacyPageProps = {
  params: Promise<{
    legacy: string[]
  }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const legacyRedirects: Record<string, string> = {
  dashboard: "/dashboard",
  "control-tower": "/analytics/dashboard",
  "analytics-loss": "/analytics/loss",
  "analytics-overview": "/analytics/dashboard",
  "analytics-supplier-reels": "/analytics/inventory",
  "analytics-winder-variance": "/analytics/production",
  "inventory-items": "/inventory/items",
  "inventory-ledger": "/inventory/ledger",
  "inventory-reel-trace": "/inventory/genealogy",
  "inventory-reels-inward": "/inventory/reels/inward",
  "inventory-reels-issue": "/inventory/reels/issue",
  "inventory-rm-inward": "/inventory/raw-material-inward",
  "inventory-valuation": "/reports/inventory",
  "job-cards": "/production/job-cards",
  masters: "/masters/papers",
  "supervisor-entry": "/production/supervisor-entry",
  "analytics/operations": "/analytics/production",
  "analytics/plants": "/reports/plants",
  "inventory/valuation": "/reports/inventory",
  "master/customers": "/masters/customers",
  "master/packaging": "/masters/packaging",
  "master/suppliers": "/masters/suppliers",
  "master/vendors": "/masters/vendors",
  "master/tools": "/masters/tools",
  planning: "/planning/board",
  "planning/board": "/planning/board",
  "planning/print": "/production/planner/print",
  "production/eod-entry": "/production/supervisor-entry",
  "production/planner/print": "/production/planner/print",
  "production/supervisor-entry": "/production/supervisor-entry",
  "reports/dispatch": "/analytics/dispatch",
  "reports/exceptions": "/analytics/exceptions",
  "reports/loss": "/analytics/loss",
  "reports/quality": "/analytics/quality",
  specs: "/specifications",
}

function appendSearch(target: string, searchParams: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item))
    } else if (value !== undefined) {
      query.set(key, value)
    }
  }
  const search = query.toString()
  return search ? `${target}?${search}` : target
}

function resolveDynamicRedirect(segments: string[]) {
  if (segments[0] === "dispatch" && segments.length === 2) {
    return `/logistics/dispatch`
  }
  if (segments[0] === "dispatch" && segments[2] === "print") {
    return `/logistics/dispatch/${segments[1]}/print`
  }
  if (segments[0] === "job-cards" && segments.length >= 2) {
    return `/production/job-cards/${segments[1]}`
  }
  if (segments[0] === "production" && segments[1] === "entry" && segments.length === 3) {
    return `/production/entry/${segments[2]}`
  }
  if (segments[0] === "production" && segments[1] === "job-cards" && segments.length >= 3) {
    return `/production/job-cards/${segments[2]}`
  }
  if (segments[0] === "sales-orders" && (segments[2] === "audit" || segments[2] === "tracking")) {
    return `/sales-orders/${segments[1]}`
  }
  if (segments[0] === "specs" && segments.length === 2) {
    return `/specifications/${segments[1]}`
  }
  if (segments[0] === "specs" && segments[2] === "edit") {
    return `/specifications/${segments[1]}/edit`
  }
  if (segments[0] === "specs" && segments[2] === "print") {
    return `/specifications/${segments[1]}/print`
  }
  return null
}

export default async function LegacyRoutePage({ params, searchParams }: LegacyPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = (await searchParams) || {}
  const segments = resolvedParams.legacy || []
  const joined = segments.join("/")
  const target = legacyRedirects[joined] || resolveDynamicRedirect(segments)

  if (!target) {
    notFound()
  }

  redirect(appendSearch(target, resolvedSearchParams))
}
