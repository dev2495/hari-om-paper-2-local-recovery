import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { searchWorkspaceJumps } from "../lib/workspace-jump"

const root = process.cwd()
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8")

test("ExecutiveHero is the shared PageHeader hero variant", () => {
  const shell = read("components/erp/shell.tsx")
  assert.match(shell, /from "@\/components\/workspace\/page-header"/)
  assert.match(shell, /variant="hero"/)
  const header = read("components/workspace/page-header.tsx")
  assert.match(header, /export function PageHeader/)
  assert.match(header, /data-testid=\{testId \|\| "page-header"\}/)
})

test("query states distinguish loading, empty, and error", () => {
  const states = read("components/workspace/query-state.tsx")
  assert.match(states, /data-testid="query-loading"/)
  assert.match(states, /data-testid="query-empty"/)
  assert.match(states, /data-testid="query-error"/)
  assert.match(states, /role="alert"/)
  assert.match(states, /role="status"/)
  assert.doesNotMatch(states, /EmptyState label="Loading/)
})

test("core operational routes wrap RoleGate", () => {
  const files = {
    sales: read("app/(dashboard)/sales-orders/layout.tsx"),
    pending: read("app/(dashboard)/sales-orders/layout.tsx"),
    jobs: read("app/(dashboard)/production/job-cards/layout.tsx"),
    planning: read("app/(dashboard)/planning/layout.tsx"),
    quality: read("app/(dashboard)/quality/page.tsx"),
    purchase: read("app/(dashboard)/purchase/layout.tsx"),
    masters: read("app/(dashboard)/masters/layout.tsx"),
    system: read("app/(dashboard)/system/layout.tsx"),
    landingQc: read("app/(dashboard)/landing/qc/page.tsx"),
    landingOwner: read("app/(dashboard)/landing/owner/page.tsx"),
    audit: read("app/(dashboard)/system/audit/page.tsx"),
  }
  assert.match(files.sales, /pending \? \["Sales", "Planner", "PlantManager"\] : \["Sales", "Planner"\]/)
  assert.match(files.pending, /PlantManager/)
  assert.match(files.jobs, /"QC"/)
  assert.match(files.planning, /"Planner", "PlantManager"/)
  assert.match(files.quality, /allow=\{\["QC", "PlantManager", "Store", "Dispatch", "Sales"\]\}/)
  assert.match(files.purchase, /"Store", "Planner", "PlantManager"/)
  assert.match(files.masters, /RoleGate/)
  assert.match(files.system, /allow=\{\["Owner", "Admin"\]\}/)
  assert.match(files.landingQc, /allow=\{\["QC"\]\}/)
  assert.match(files.landingOwner, /allow=\{\["Owner"\]\}/)
  assert.match(files.audit, /role-gate-denied|RoleGate/)
  assert.match(read("components/workspace/role-gate.tsx"), /data-testid="role-gate-denied"/)
  assert.match(read("components/workspace/role-gate.tsx"), /Your role doesn't include this view/)
})

test("quality RoleGate was not regressed to PlantManager-only alias", () => {
  const quality = read("app/(dashboard)/quality/page.tsx")
  assert.match(quality, /allow=\{\["QC"/)
  assert.doesNotMatch(quality, /allow=\{\["PlantManager"\]\}/)
})

test("one intelligence home: reports hub redirects and layout does not re-export analytics layout", () => {
  const reportsLayout = read("app/(dashboard)/reports/layout.tsx")
  const reportsPage = read("app/(dashboard)/reports/page.tsx")
  const nextConfig = read("next.config.js")
  const analytics = read("app/(dashboard)/analytics/page.tsx")
  const sidebar = read("app/(dashboard)/layout.tsx")
  assert.doesNotMatch(reportsLayout, /export \{ default \} from "\.\.\/analytics\/layout"/)
  assert.match(reportsPage, /redirect\("\/analytics"\)/)
  assert.match(nextConfig, /source: "\/reports"/)
  assert.match(nextConfig, /destination: "\/analytics"/)
  assert.match(analytics, /IntelligenceReportCatalog/)
  assert.match(analytics, /data-testid="analytics-landing-page"/)
  assert.match(sidebar, /name: "Intelligence"/)
  assert.match(sidebar, /href: "\/analytics"/)
  assert.doesNotMatch(sidebar, /href: "\/reports"/)
})

test("duplicate plant and dispatch report URLs redirect to canonical reports routes", () => {
  const nextConfig = read("next.config.js")
  assert.match(nextConfig, /source: "\/analytics\/plants"/)
  assert.match(nextConfig, /destination: "\/reports\/plants"/)
  assert.match(nextConfig, /source: "\/analytics\/dispatch"/)
  assert.match(nextConfig, /destination: "\/reports\/dispatch"/)
  assert.match(read("app/(dashboard)/analytics/plants/page.tsx"), /redirect\("\/reports\/plants"\)/)
  assert.match(read("app/(dashboard)/analytics/dispatch/page.tsx"), /redirect\("\/reports\/dispatch"\)/)
})

test("sidebar jump-to-workspace search finds routes beyond nav labels", () => {
  const layout = read("app/(dashboard)/layout.tsx")
  assert.match(layout, /Jump to workspace/)
  assert.match(layout, /searchWorkspaceJumps/)
  const quality = searchWorkspaceJumps("incoming qc")
  assert.ok(quality.some((item) => item.href === "/quality/incoming"))
  const purchase = searchWorkspaceJumps("grn")
  assert.ok(purchase.some((item) => item.href === "/purchase"))
  const pending = searchWorkspaceJumps("pending")
  assert.ok(pending.some((item) => item.href === "/sales-orders/pending"))
})

test("integrated-slice nav entries remain: Quality, Pending Orders, Purchase", () => {
  const layout = read("app/(dashboard)/layout.tsx")
  assert.match(layout, /name: "Quality"/)
  assert.match(layout, /href: "\/quality"/)
  assert.match(layout, /name: "Pending Orders"/)
  assert.match(layout, /href: "\/sales-orders\/pending"/)
  assert.match(layout, /name: "Purchase"/)
  assert.match(layout, /href: "\/purchase"/)
})

test("core pages no longer use EmptyState for loading", () => {
  const sales = read("app/(dashboard)/sales-orders/page.tsx")
  const pending = read("app/(dashboard)/sales-orders/pending/page.tsx")
  const jobs = read("app/(dashboard)/production/job-cards/page.tsx")
  const tracker = read("app/(dashboard)/planning/tracker/page.tsx")
  assert.match(sales, /loadingLabel="Loading live sales orders/)
  assert.match(pending, /loadingLabel="Loading pending orders from the server/)
  assert.match(jobs, /loadingLabel="Loading recovered job cards/)
  assert.match(tracker, /loadingLabel="Loading sales-order tracker/)
  assert.doesNotMatch(sales, /EmptyState label="Loading live sales orders/)
  assert.doesNotMatch(pending, /EmptyState label="Loading pending orders/)
})

test("UserEditor and audit use the shared design system", () => {
  const editor = read("components/auth/user-editor.tsx")
  const audit = read("app/(dashboard)/system/audit/page.tsx")
  assert.match(editor, /PageHeader/)
  assert.match(editor, /htmlFor="user-full-name"/)
  assert.match(editor, /Assigned roles/)
  assert.match(editor, /Allow all plants/)
  assert.match(audit, /PageHeader/)
  assert.match(audit, /System audit history/)
  assert.match(audit, /htmlFor="audit-period"/)
  assert.match(audit, /LoadingState label="Loading audit records/)
})
