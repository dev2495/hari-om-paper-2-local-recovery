import assert from "node:assert/strict"
import {
  EMPTY_QUEUE_FILTERS,
  activeQuickBadge,
  applyQuickBadge,
  describeQueueFilters,
  matchesQueueFilters,
  normalizeQueueFilters,
  queueFilterOptions,
  rangeBetween,
  sortQueue,
  viewMatchesFilters,
} from "../lib/planner-queue-filters"

const today = "2026-10-27"
const ctx = { today, stage: "OVEN" as const, grouping: "release" as const }
const cards = [
  { segment_id: "a", job_card_no: "26/10/23", customer_name: "Season acceptance customer", customer_code: "SEASON_VERIFY", segment_planned_qty: 600, due_date: "2026-11-11", current_stage: "WINDER", assigned_winder_machine_id: "w1", product_size_label: "76.4 x 81 x 150", planning_locked: true, waiting_for_stage: "WINDER", planning_locked_reason: "Waiting for the winding plan" },
  { segment_id: "b", job_card_no: "26/10/17", customer_name: "Season acceptance customer", customer_code: "SEASON_VERIFY", segment_planned_qty: 240, due_date: "2026-10-26", current_stage: "OVEN", assigned_winder_machine_id: "w1", parchment_color: "Red", product_size_label: "76.4 x 81 x 150", missed_slot_open: true, created_at: "2026-10-17" },
  { segment_id: "c", job_card_no: "26/10/22", customer_name: "Ambica Tubes", customer_code: "AMB", segment_planned_qty: 1200, due_date: "2026-10-29", current_stage: "OVEN", assigned_winder_machine_id: "w2", product_size_label: "50 x 60 x 120", is_emergency: true, segment_no: 2, remaining_segments: 2, created_at: "2026-10-22" },
  { segment_id: "d", job_card_no: "26/10/21-A", customer_name: "Ambica Tubes", customer_code: "AMB", segment_planned_qty: 360, due_date: "2026-10-27", current_stage: "OVEN", product_size_label: "50 x 60 x 120", split_kind: "SPLIT", created_at: "2026-10-21" },
]

// Search: customer code, card no, size, several words (AND), case-insensitive.
const search = (needle: string) => cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, search: needle }, ctx)).map((job) => job.segment_id)
assert.deepEqual(search("amb"), ["c", "d"], "customer code matches")
assert.deepEqual(search("26/10/17"), ["b"], "card number matches")
assert.deepEqual(search("50 x 60"), ["c", "d"], "size matches")
assert.deepEqual(search("amb 26/10/21"), ["d"], "every word must match")
assert.deepEqual(search("red"), ["b"], "colour matches")

// Due presets against today.
const due = (preset: any, extra: any = {}) => cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, due: preset, ...extra }, ctx)).map((job) => job.segment_id)
assert.deepEqual(due("overdue"), ["b"])
assert.deepEqual(due("today"), ["d"])
assert.deepEqual(due("3d"), ["c", "d"], "≤3 days includes today, excludes overdue")
assert.deepEqual(due("7d"), ["c", "d"])
assert.deepEqual(due("custom", { due_from: "2026-11-01", due_to: "2026-11-30" }), ["a"])

// Machine, customer, colour, size, qty, flags.
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, machines: ["w2"] }, ctx)).map((job) => job.segment_id), ["c"])
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, machines: ["unassigned"] }, ctx)).map((job) => job.segment_id), ["d"])
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, customers: ["Ambica Tubes"] }, ctx)).map((job) => job.segment_id), ["c", "d"])
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, colours: ["Plain"] }, ctx)).map((job) => job.segment_id), ["a", "c", "d"], "Plain = no colour")
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, sizes: ["50 x 60 x 120"] }, ctx)).map((job) => job.segment_id), ["c", "d"])
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, qty_min: 300, qty_max: 700 }, ctx)).map((job) => job.segment_id), ["a", "d"])
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, flags: ["missed"] }, ctx)).map((job) => job.segment_id), ["b"])
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, flags: ["emergency", "split_plan"] }, ctx)).map((job) => job.segment_id), ["c"], "flags are AND")
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, flags: ["split_card"] }, ctx)).map((job) => job.segment_id), ["d"])
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, flags: ["waiting"] }, ctx)).map((job) => job.segment_id), ["a"], "waiting = locked or previous stage")
assert.deepEqual(cards.filter((job) => matchesQueueFilters(job, { ...EMPTY_QUEUE_FILTERS, show_waiting: false }, ctx)).map((job) => job.segment_id), ["b", "c", "d"], "hide locked cards")

// Sort.
assert.deepEqual(sortQueue(cards, "due").map((job) => job.segment_id), ["c", "b", "d", "a"], "emergency first, then due")
assert.deepEqual(sortQueue(cards, "qty").map((job) => job.segment_id), ["c", "a", "d", "b"])
assert.deepEqual(sortQueue(cards, "created").map((job) => job.segment_id), ["a", "b", "d", "c"], "no created_at sorts first (empty string)")
assert.deepEqual(sortQueue(cards, "customer").map((job) => job.segment_id), ["d", "c", "b", "a"], "customer A–Z, then due")
assert.deepEqual(sortQueue(cards, "priority").map((job) => job.segment_id), ["c", "b", "d", "a"], "emergency, missed, then due")

// Quick badges keep search/sort, replace everything else; the active one is recognised.
const quick = applyQuickBadge({ ...EMPTY_QUEUE_FILTERS, search: "amb", sort: "qty", customers: ["x"] }, "overdue")
assert.deepEqual(quick, { ...EMPTY_QUEUE_FILTERS, search: "amb", sort: "qty", due: "overdue" })
assert.equal(activeQuickBadge(quick), "overdue")
assert.equal(activeQuickBadge({ ...EMPTY_QUEUE_FILTERS, search: "amb" }), "all")
assert.equal(activeQuickBadge({ ...EMPTY_QUEUE_FILTERS, flags: ["missed"] }), "missed")
assert.equal(activeQuickBadge({ ...EMPTY_QUEUE_FILTERS, flags: ["missed"], customers: ["x"] }), null)

// Saved views: unknown keys dropped, missing keys filled, matching ignores search/sort unless the view set them.
const saved = normalizeQueueFilters({ customers: ["Ambica Tubes"], due: "custom", due_from: "2026-10-01", bogus: 1, flags: ["missed", "nope"], qty_min: "100" })
assert.deepEqual(saved, { ...EMPTY_QUEUE_FILTERS, customers: ["Ambica Tubes"], due: "custom", due_from: "2026-10-01", flags: ["missed"], qty_min: 100 })
assert.equal(viewMatchesFilters(saved, { ...saved, search: "typed", sort: "qty", show_waiting: false }), true)
assert.equal(viewMatchesFilters({ ...saved, search: "amb" }, { ...saved, search: "typed" }), false)
assert.equal(viewMatchesFilters(saved, { ...saved, customers: [] }), false)

// Chips: one per value, each removable on its own.
const chips = describeQueueFilters({ ...EMPTY_QUEUE_FILTERS, machines: ["w1"], due: "3d", customers: ["Ambica Tubes", "Z"], qty_max: 500, flags: ["emergency"], show_waiting: false }, { machine: (id) => id.toUpperCase() })
assert.deepEqual(chips.map((chip) => chip.label), ["Machine: W1", "Due in 3 days", "Customer: Ambica Tubes", "Customer: Z", "Qty ≤ 500 pcs", "Emergency", "Waiting cards hidden"])
const afterRemove = chips[2].clear({ ...EMPTY_QUEUE_FILTERS, customers: ["Ambica Tubes", "Z"] })
assert.deepEqual(afterRemove.customers, ["Z"])

// Pick-list options and shift-click ranges.
const options = queueFilterOptions(cards)
assert.deepEqual(options.customers, ["Ambica Tubes", "Season acceptance customer"])
assert.equal(options.customerCodes.get("Ambica Tubes"), "AMB")
assert.deepEqual(options.colours, ["Plain", "Red"])
assert.deepEqual(rangeBetween(["a", "b", "c", "d"], "d", "b"), ["b", "c", "d"])
assert.deepEqual(rangeBetween(["a", "b", "c", "d"], null, "b"), ["b"])
assert.deepEqual(rangeBetween(["a", "b"], "zz", "b"), ["b"], "unknown anchor falls back to the clicked card")

console.log("Planner queue filters: search, due, lists, flags, sort, quick badges, saved views, chips and ranges passed")
