import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { classifyDueRisk, DUE_RISK_OVERDUE, DUE_RISK_PRIORITY, plantToday, priorityWindow } from "../lib/due-risk"

test("priority window is today through today+2 and overdue is separate", () => {
  const today = "2026-09-17"
  const window = priorityWindow(today)
  assert.equal(window.start, "2026-09-17")
  assert.equal(window.end, "2026-09-19")
  assert.equal(classifyDueRisk("2026-09-16", today), DUE_RISK_OVERDUE)
  assert.equal(classifyDueRisk("2026-09-17", today), DUE_RISK_PRIORITY)
  assert.equal(classifyDueRisk("2026-09-19", today), DUE_RISK_PRIORITY)
  assert.equal(classifyDueRisk("2026-09-20", today), null)
  assert.equal(classifyDueRisk(null, today), null)
})

test("plantToday returns an ISO calendar date", () => {
  assert.match(plantToday(), /^\d{4}-\d{2}-\d{2}$/)
})

test("job-card tiles are URL-driven stage links backed by a server aggregate", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/production/job-cards/page.tsx"), "utf8")
  assert.match(page, /useJobCardAggregates/)
  assert.match(page, /job-cards\?stage=\$\{row\.stage\}/)
  assert.match(page, /due: dueFilter === "priority"/)
  assert.doesNotMatch(page, /isBefore\(dayjs\(\)\.add\(1, "day"\)/)
})

test("quality pass-rate never defaults to 100 from an empty set", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/quality/page.tsx"), "utf8")
  assert.match(page, /useQualitySummary/)
  assert.match(page, /No data/)
  assert.doesNotMatch(page, /inspections\.length \? \(passedInspections\.length \/ inspections\.length\) \* 100 : 100/)
})

test("sales order KPIs come from a server aggregate not the current page", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/sales-orders/page.tsx"), "utf8")
  assert.match(page, /useSalesOrderAggregates/)
  assert.match(page, /aggregates\.ready_count/)
  assert.doesNotMatch(page, /Pieces still open in this loaded window/)
})

test("sales release confirm is not a compatibility veto and offers a winder-queue next step", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/sales-orders/page.tsx"), "utf8")
  assert.match(page, /authorized_winders/)
  assert.match(page, /Open this winder queue/)
  assert.match(page, /planning synchronization pending/)
  assert.doesNotMatch(page, /router\.push\(`\/planning\/board\?section=winder/)
})

test("planning board uses the same 3-day due-risk predicate", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/planning/board/page.tsx"), "utf8")
  assert.match(page, /classifyDueRisk/)
  assert.match(page, /DUE_RISK_PRIORITY/)
  assert.match(page, /DUE_RISK_OVERDUE/)
  assert.doesNotMatch(page, /isBefore\(dayjs\(\)\.add\(1, "day"\)/)
})

test("order detail exposes Approve + Release", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/sales-orders/[orderId]/page.tsx"), "utf8")
  assert.match(page, /Approve \+ Release/)
  assert.match(page, /ReleaseToQueueDialog/)
  assert.match(page, /sales-order-detail:approve-release/)
})
