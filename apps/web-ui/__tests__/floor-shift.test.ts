import assert from "node:assert/strict"

import { canonicalShift, shiftAt, shiftWords } from "../lib/shift"

// Shift rule (client 2026-10-30): A 08:00–20:00 IST, B 20:00–08:00 IST; the business date is the day the shift began.
const at = (iso: string) => shiftAt(new Date(iso))

// 01:30 IST on 31 Oct (= 20:00 UTC on 30 Oct) is Shift B of 30 Oct.
assert.deepEqual(
  { ...at("2026-10-30T20:00:00Z") },
  { shift: "B", code: "SHIFT_B", businessDate: "2026-10-30", label: "Shift B · 30 Oct", clock: "01:30" },
)
// 07:59 IST on 31 Oct is still Shift B of 30 Oct; 08:00 IST is Shift A of 31 Oct.
assert.equal(at("2026-10-31T02:29:00Z").label, "Shift B · 30 Oct")
assert.equal(at("2026-10-31T02:30:00Z").label, "Shift A · 31 Oct")
// 19:59 IST is Shift A; 20:00 IST starts Shift B of the same day.
assert.equal(at("2026-10-30T14:29:00Z").shift, "A")
assert.equal(at("2026-10-30T14:30:00Z").label, "Shift B · 30 Oct")
// Month and year ends: 02:00 IST on 1 Nov belongs to 31 Oct; 03:00 IST on 1 Jan to 31 Dec.
assert.equal(at("2026-10-31T20:30:00Z").businessDate, "2026-10-31")
assert.equal(at("2026-12-31T21:30:00Z").businessDate, "2026-12-31")
// The device's own time zone never matters: the same instant gives the same answer.
assert.equal(shiftAt(new Date(Date.UTC(2026, 9, 30, 20, 0))).businessDate, "2026-10-30")

assert.equal(shiftWords("B", "2026-10-30"), "Shift B · 30 Oct")
assert.equal(shiftWords("SHIFT_A", "2026-11-01"), "Shift A · 1 Nov")
assert.equal(shiftWords("GENERAL", "2026-10-29"), "General shift · 29 Oct")
assert.equal(shiftWords("", null), "Shift not recorded")
assert.equal(canonicalShift("b"), "SHIFT_B")

console.log("Floor shift rule: Shift B after midnight, month ends, words passed")
