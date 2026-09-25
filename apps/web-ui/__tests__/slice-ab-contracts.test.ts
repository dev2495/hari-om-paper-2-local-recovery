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

test("pending workspace is URL-driven and exports the full server set", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/sales-orders/pending/page.tsx"), "utf8")
  assert.match(page, /usePendingSalesOrders/)
  assert.match(page, /exportPendingOrders/)
  assert.match(page, /searchParams/)
  assert.match(page, /pending-orders:total-count/)
  assert.doesNotMatch(page, /limit: 750/)
})

test("tracker no longer joins a capped job-card page in the browser", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/planning/tracker/page.tsx"), "utf8")
  assert.match(page, /usePendingSalesOrders/)
  assert.match(page, /usePendingJobCardsByOrder/)
  assert.doesNotMatch(page, /usePlanningJobCards\(\{ limit: 750 \}\)/)
  assert.doesNotMatch(page, /jobs\.filter/)
})

test("owner landing rupee totals come from the sales aggregate endpoint", () => {
  const page = readFileSync(resolve(process.cwd(), "components/workspace/command-center.tsx"), "utf8")
  assert.match(page, /salesAggregates\?\.booked_value/)
  assert.match(page, /salesAggregates\?\.open_order_book_value/)
  assert.doesNotMatch(page, /useSalesOrders\(\)/)
  assert.doesNotMatch(page, /totals\.booked \+= qty \* rate/)
})

test("order detail shows persisted delivery schedules and schedule-entire-PO preview/commit", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/sales-orders/[orderId]/page.tsx"), "utf8")
  assert.match(page, /DeliverySchedulePanel/)
  const panel = readFileSync(resolve(process.cwd(), "components/sales/delivery-schedule-panel.tsx"), "utf8")
  assert.match(panel, /schedule-entire-po:preview/)
  assert.match(panel, /schedule-entire-po:commit/)
  assert.match(panel, /Customer delivery schedule/)
})

test("planning board has a keyboard scheduling path equivalent to drag", () => {
  const page = readFileSync(resolve(process.cwd(), "components/planning/planning-workspace.tsx"), "utf8")
  assert.match(page, /KeyboardScheduleForm/)
  assert.match(page, /tabIndex=\{0\}/)
  const form = readFileSync(resolve(process.cwd(), "components/planning/keyboard-schedule-form.tsx"), "utf8")
  assert.match(form, /planner-keyboard-schedule/)
  assert.match(form, /Same move as drag-and-drop/)
})

test("sales release confirm is not a compatibility veto and offers a winder-queue next step", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/sales-orders/page.tsx"), "utf8")
  assert.match(page, /authorized_winders/)
  assert.match(page, /Open planning queue/)
  assert.match(page, /planning synchronization pending/)
  assert.doesNotMatch(page, /router\.push\(`\/planning\/board\?section=winder/)
})

test("planning board uses the same 3-day due-risk predicate", () => {
  const page = readFileSync(resolve(process.cwd(), "components/planning/planning-workspace.tsx"), "utf8")
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
