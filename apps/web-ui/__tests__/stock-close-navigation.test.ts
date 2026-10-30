import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { MODULE_NAVIGATION, activeModuleLink, moduleLinkBase, moduleLinkCovers } from "../lib/module-navigation"
import { MATRIX_SCREENS } from "../lib/role-matrix"
import {
  countsRedirect,
  lifecycleRedirect,
  locationsRedirect,
  monthParam,
  mrpRedirect,
  reconciliationRedirect,
  tolerancesRedirect,
} from "../lib/retired-routes"
import { getGuideForRoute } from "../lib/guide-content"
import { searchWorkspaceJumps } from "../lib/workspace-jump"

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8")

// Retired pages keep their meaning: the month, plant or search of an old link carries over.
assert.equal(monthParam("2026-10"), "2026-10")
assert.equal(monthParam("2026-10-01"), "2026-10")
assert.equal(monthParam("2026-13"), "")
assert.equal(monthParam("October"), "")
assert.equal(reconciliationRedirect("actuals", { month: "2026-10" }), "/production/reconciliation?tab=month&month=2026-10")
assert.equal(reconciliationRedirect("drift", {}), "/production/reconciliation?tab=month")
assert.equal(reconciliationRedirect("history", { month_start: "2026-09-01", plant: "p1" }), "/production/reconciliation?tab=past&month=2026-09&plant=p1")
assert.equal(tolerancesRedirect({ plant_id: "p2" }), "/production/reconciliation/limits?plant=p2")
assert.equal(tolerancesRedirect(undefined), "/production/reconciliation/limits")
assert.equal(locationsRedirect({ q: "RM-A", tag: ["a", "b"] }), "/inventory/locations?q=RM-A&tag=a&tag=b")
assert.equal(lifecycleRedirect({ month: "2026-10", junk: "x" }), "/inventory/stock-control?month=2026-10")
assert.equal(countsRedirect({}), "/inventory/stock-control?tab=counts")
assert.equal(mrpRedirect({ view: "reorder", search: "KRAFT" }), "/purchase/scheduler?view=list&q=KRAFT")

// Each retired route is a server redirect page (it runs before any client role gate, so every role's old link works).
const retired: Array<[string, string]> = [
  ["app/(dashboard)/system/locations/page.tsx", "locationsRedirect"],
  ["app/(dashboard)/system/tolerances/page.tsx", "tolerancesRedirect"],
  ["app/(dashboard)/inventory/lifecycle/page.tsx", "lifecycleRedirect"],
  ["app/(dashboard)/inventory/counts/page.tsx", "countsRedirect"],
  ["app/(dashboard)/production/reconciliation/actuals/page.tsx", "reconciliationRedirect(\"actuals\""],
  ["app/(dashboard)/production/reconciliation/drift/page.tsx", "reconciliationRedirect(\"drift\""],
  ["app/(dashboard)/production/reconciliation/history/page.tsx", "reconciliationRedirect(\"history\""],
  ["app/(dashboard)/analytics/mrp/page.tsx", "mrpRedirect"],
]
for (const [file, call] of retired) {
  const source = read(file)
  assert.ok(source.includes(`redirect(${call}`), file)
  assert.doesNotMatch(source, /"use client"/, file)
}

// next.config.js redirects them at the routing layer (before any role gate), not permanent.
const nextConfig = read("next.config.js")
for (const [source, destination] of [["/system/locations", "/inventory/locations"], ["/system/tolerances", "/production/reconciliation/limits"],
  ["/inventory/lifecycle", "/inventory/stock-control"], ["/inventory/counts", "/inventory/stock-control?tab=counts"],
  ["/production/reconciliation/actuals", "/production/reconciliation?tab=month"], ["/production/reconciliation/drift", "/production/reconciliation?tab=month"],
  ["/production/reconciliation/history", "/production/reconciliation?tab=past"], ["/analytics/mrp", "/purchase/scheduler?view=list"]]) {
  assert.ok(nextConfig.includes(`["${source}", "${destination}"]`), source)
}
assert.match(nextConfig, /\.map\(\(\[source, destination\]\) => \(\{ source, destination, permanent: false \}\)\)/)

// Sidebar: the new names, nothing that points at a retired page.
const sidebar = read("app/(dashboard)/layout.tsx")
for (const name of ["Month-end close", "Stock counts & book", "RM inward calendar", "Expected arrivals"]) assert.match(sidebar, new RegExp(`name: "${name}"`))
for (const href of ["/inventory/lifecycle", "/analytics/mrp", "/system/tolerances", "/system/locations"]) assert.doesNotMatch(sidebar, new RegExp(`href: "${href}"`))
assert.doesNotMatch(sidebar, /name: "Reconciliation"|name: "RM & PM Schedule"|name: "Supplier deliveries"|name: "Stock Lifecycle"/)

// Module navigation: Usage limits under Month-end close, one Stock place, Background jobs in System.
const names = (key: string) => (MODULE_NAVIGATION[key] || []).map((link) => `${link.name} ${link.href}`)
assert.deepEqual(names("/production/reconciliation"), ["Month-end close /production/reconciliation", "Usage limits /production/reconciliation/limits"])
assert.deepEqual(names("/inventory/stock-control"), ["Counts /inventory/stock-control?tab=counts", "Corrections /inventory/stock-control?tab=corrections",
  "Stock book /inventory/stock-control?tab=book", "Locations /inventory/locations"])
assert.ok(names("/system/users").includes("Background jobs /system/scheduler"))
assert.ok(!names("/system/users").some((row) => /tolerances|locations/.test(row)))
// A nested page marks its own module link: the longest link it sits under.
assert.equal(activeModuleLink(MODULE_NAVIGATION["/production/reconciliation"], "/production/reconciliation/limits")?.name, "Usage limits")
assert.equal(activeModuleLink(MODULE_NAVIGATION["/production/reconciliation"], "/production/reconciliation")?.name, "Month-end close")
assert.equal(activeModuleLink(MODULE_NAVIGATION["/inventory/stock-control"], "/inventory/counts/7d1e/rack/9a2b")?.name, "Counts")
assert.equal(activeModuleLink(MODULE_NAVIGATION["/inventory/stock-control"], "/inventory/locations/labels")?.name, "Locations")
assert.equal(activeModuleLink(MODULE_NAVIGATION["/inventory/stock-control"], "/inventory/ledger"), undefined)
// The hub's tabs: the address tab marks its own entry; no tab (or an unknown one) is the Counts tab.
const stock = MODULE_NAVIGATION["/inventory/stock-control"]
assert.equal(activeModuleLink(stock, "/inventory/stock-control")?.name, "Counts")
assert.equal(activeModuleLink(stock, "/inventory/stock-control", "tab=book&month=2026-10")?.name, "Stock book")
assert.equal(activeModuleLink(stock, "/inventory/stock-control", "?tab=corrections")?.name, "Corrections")
assert.equal(activeModuleLink(stock, "/inventory/stock-control", "tab=nothing")?.name, "Counts")
assert.equal(activeModuleLink(stock, "/inventory/counts/7d1e", "tab=book")?.name, "Counts")
assert.equal(activeModuleLink(MODULE_NAVIGATION["/production/reconciliation"], "/production/reconciliation", "tab=past")?.name, "Month-end close")
assert.equal(activeModuleLink(MODULE_NAVIGATION["/planning/board"], "/planning/winder", "date=2026-10-28")?.name, "Winder planning")
// Each entry appears once; the hub itself is the sidebar item, not a duplicate sub-item.
assert.equal(new Set(stock.map((link) => link.name)).size, stock.length)
assert.ok(moduleLinkCovers(stock[0], "/inventory/counts/7d1e/rack/9a2b") && !moduleLinkCovers(stock[1], "/inventory/counts/7d1e"))
assert.equal(moduleLinkBase(stock[0], "/inventory/counts/7d1e/rack/unassigned"), "/inventory/counts")

// No page or component links to a retired route (the redirect pages themselves aside).
const scanned = ["lib/workspace.ts", "lib/workspace-jump.ts", "lib/role-matrix.ts", "lib/module-navigation.ts", "components/workspace/owner-admin-landings.tsx",
  "components/workspace/command-center.tsx", "components/workspace/books-locked-chip.tsx", "components/common/crud-table.tsx", "components/reports/catalog.tsx",
  "app/(dashboard)/masters/page.tsx", "app/(dashboard)/inventory/page.tsx", "app/(dashboard)/system/users/page.tsx", "app/(dashboard)/system/plants/page.tsx",
  "app/(dashboard)/system/machines/page.tsx"]
for (const file of scanned) assert.doesNotMatch(read(file), /["'`](?:\/system\/tolerances|\/system\/locations|\/inventory\/lifecycle|\/analytics\/mrp|\/production\/reconciliation\/(?:actuals|drift|history))/, file)

// Jump to workspace finds the new homes by their old words too.
const jump = (query: string) => searchWorkspaceJumps(query, 20).map((item) => item.href)
assert.ok(jump("usage limits").includes("/production/reconciliation/limits"))
assert.ok(jump("tolerance").includes("/production/reconciliation/limits"))
assert.ok(jump("mrp").includes("/purchase/scheduler"))
assert.ok(jump("expected arrivals").includes("/purchase/supplier-deliveries"))
assert.ok(jump("rack").includes("/inventory/locations"))
assert.ok(jump("stock count").includes("/inventory/stock-control"))
assert.ok(jump("reconciliation").includes("/production/reconciliation"))
assert.ok(jump("background").includes("/system/scheduler"))

// Role matrix: every signed-in role counts; the plant head reads usage limits.
const screen = (href: string) => MATRIX_SCREENS.find((row) => row.href === href)
assert.equal(screen("/inventory/stock-control")?.access.Operator, "work")
assert.equal(screen("/inventory/stock-control")?.access.RMIssue, "work")
assert.equal(screen("/production/reconciliation/limits")?.access.PlantManager, "view")
assert.equal(screen("/purchase/scheduler")?.access.GRN, "view")
assert.equal(screen("/inventory/lifecycle"), undefined)

// Help: each new route opens its own guide.
for (const [route, id] of [["/inventory/stock-control", "stock-counts"], ["/inventory/counts/x", "stock-counts"], ["/inventory/locations/labels", "locations"],
  ["/production/reconciliation", "month-end-close"], ["/production/reconciliation/limits", "usage-limits"], ["/purchase/scheduler", "purchase-scheduler"],
  ["/purchase/supplier-deliveries", "supplier-promises"], ["/analytics/mrp", "purchase-scheduler"]]) {
  assert.equal(getGuideForRoute(route).id, id, route)
}

// GRN reads the RM inward calendar; the books chip sends Planner and Store to the stock book.
assert.match(read("app/(dashboard)/purchase/layout.tsx"), /prefix: "\/purchase\/scheduler", roles: \["GRN"\]/)
assert.match(read("components/workspace/books-locked-chip.tsx"), /\/inventory\/stock-control\?tab=book/)
assert.ok(existsSync(resolve(process.cwd(), "lib/retired-routes.ts")))

console.log("Stock, month-end and RM calendar navigation: redirects, sidebar, sub-navigation, jump, role matrix and guides passed")
