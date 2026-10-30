import assert from "node:assert/strict"

import { addDays, istToday, shiftBusinessDate, shiftSlotNow } from "../lib/shift"

// Client 2026-10-30: a partial entry at 01:31 IST was refused. Log output / whole-card forms default the
// date and shift from the clock by the shift rule, in India time, whatever the device's time zone.
const night = new Date("2026-10-30T20:00:00Z") // 01:30 IST on 31 Oct
assert.deepEqual(shiftSlotNow(night), { date: "2026-10-30", shift: "SHIFT_B" })
assert.equal(istToday(night), "2026-10-31") // the latest date a run may carry (the server's limit)
assert.equal(shiftBusinessDate("SHIFT_B", night), "2026-10-30")
assert.equal(shiftBusinessDate("SHIFT_A", night), "2026-10-30")

// 10:00 IST on 31 Oct: Shift A is today; a Shift B card (the night just ended) is yesterday's.
const morning = new Date("2026-10-31T04:30:00Z")
assert.deepEqual(shiftSlotNow(morning), { date: "2026-10-31", shift: "SHIFT_A" })
assert.equal(shiftBusinessDate("B", morning), "2026-10-30")
assert.equal(shiftBusinessDate("SHIFT_A", morning), "2026-10-31")

// 21:00 IST: Shift B of the same day.
assert.deepEqual(shiftSlotNow(new Date("2026-10-31T15:30:00Z")), { date: "2026-10-31", shift: "SHIFT_B" })
assert.equal(addDays("2026-11-01", -1), "2026-10-31")
assert.equal(addDays("2026-12-31", 1), "2027-01-01")

console.log("Floor entry clock: night shift date, shift follows the clock, India time passed")
