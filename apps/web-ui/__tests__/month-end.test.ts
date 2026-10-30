import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { dayText, gapWords, istMonthKey, monthText, notePlaceholder, personText, plainCode, qty, shiftMonth, signedQty, storeChangeWords, unitFloorWords } from "../lib/api-month-end"

// Quantities: en-IN with the unit, never a bare number.
assert.equal(qty(1234.5, "kg"), "1,234.5 kg")
assert.equal(qty(40, "pcs"), "40 pcs")
assert.equal(qty(0.4567, "kg"), "0.457 kg")
assert.equal(qty(null, "kg"), "—")
// A real minus sign, never an ASCII hyphen; signed changes always carry their sign.
assert.equal(qty(-12.2, "kg"), "−12.2 kg")
assert.equal(qty(-0.0001, "kg"), "0 kg")
// One decimal from 10 up, so figures on one page read alike ("966.7 kg" next to "1,034.4 kg").
assert.equal(qty(966.71, "kg"), "966.7 kg")
assert.equal(qty(72.41, "kg"), "72.4 kg")
assert.equal(qty(1.25, "litre"), "1.25 litre")
assert.equal(signedQty(25, "pcs"), "+25 pcs")
assert.equal(signedQty(-5, "kg"), "−5 kg")
assert.equal(signedQty(0, "kg"), "0 kg")

// A manual correction is never called a count: count and other corrections are told apart.
assert.equal(storeChangeWords(0, 0, "kg").short, "Matches the books")
assert.equal(storeChangeWords(-2, -2, "kg").sentence, "store count is 2 kg short of the books")
assert.equal(storeChangeWords(-7, -2, "kg").short, "Count −2 kg · corrections −5 kg")
assert.match(storeChangeWords(-7, -2, "kg").sentence, /^count and corrections are 7 kg short of the books/)
assert.equal(storeChangeWords(-5, 0, "kg").sentence, "corrections took 5 kg off the books")
assert.equal(storeChangeWords(25, 25, "pcs").sentence, "store count is 25 pcs more than the books")
assert.equal(storeChangeWords(-12, undefined, "kg").sentence, "count and corrections are 12 kg short of the books")

// Stored codes read as words; document and lot numbers stay as printed.
assert.equal(plainCode("DAMAGED_IN_STORE"), "Damaged in store")
assert.equal(plainCode("PHYSICAL_COUNT_VARIANCE"), "Count difference")
assert.equal(plainCode("WINDER"), "Winder")
assert.equal(plainCode("VAR-20260930-001"), "VAR-20260930-001")
assert.equal(plainCode("Two reels had wet edges"), "Two reels had wet edges")

// Dates in Indian style; naive-UTC server stamps are shown in IST (31 Oct 19:00 UTC is 1 Nov in India).
assert.equal(dayText("2026-10-27"), "27 Oct 2026")
assert.equal(dayText("2026-10-31T19:00:00"), "1 Nov 2026")
assert.equal(monthText("2026-10"), "October 2026")
assert.equal(personText("owner2.e2e@hariom.com"), "owner2.e2e")

// Month stepping without local-time Date maths, across a year end.
assert.equal(shiftMonth("2026-12", 1), "2027-01")
assert.equal(shiftMonth("2027-01", -1), "2026-12")
assert.equal(istMonthKey(new Date("2026-10-31T19:00:00Z")), "2026-11")
assert.equal(istMonthKey(new Date("2026-10-31T18:00:00Z")), "2026-10")

// Gap words.
assert.deepEqual(gapWords(6.94, "kg"), { amount: "6.94 kg", direction: "more" })
assert.deepEqual(gapWords(-0.69, "kg"), { amount: "0.69 kg", direction: "less" })
assert.equal(gapWords(0, "pcs").direction, "same")

// The page never uses the UTC month of a local date, and the old dead "?view=actuals" links are gone.
const read = (file: string) => readFileSync(resolve(__dirname, "..", file), "utf8")
for (const file of ["components/month-end/month-end-close.tsx", "components/month-end/item-card.tsx", "components/month-end/item-table.tsx", "components/month-end/close-checklist.tsx", "lib/api-month-end.ts"]) {
  assert.doesNotMatch(read(file), /toISOString\(\)\.slice\(0, ?7\)|\?view=actuals|bg-rose-900|bg-amber-700/, file)
}
// Only the Owner sees a Close button; everyone else is told who closes the month (spec 2.8).
assert.match(read("components/month-end/close-checklist.tsx"), /owner \? \(\s*<button[\s\S]*Only the Owner closes the month/)
// Planner and Store follow the books chip to the stock book; closers go to Month-end close.
const chip = read("components/workspace/books-locked-chip.tsx")
assert.match(chip, /\/inventory\/stock-control\?tab=book/)
assert.match(chip, /\/production\/reconciliation/)
console.log("month-end ok")

// Unit floor summary: items over and under never net out to "exactly".
{
  const netted = unitFloorWords({ floor_gap: 0, floor_over_items: 1, floor_over: 200, floor_under_items: 1, floor_under: 200 }, "pcs")
  assert.equal(netted.outside, true)
  assert.equal(netted.sentence, "On the floor, 1 item took 200 pcs more and 1 item took 200 pcs less than spec + wastage, outside their limit (net for all materials 0 pcs)")
  assert.equal(netted.short, "1 item more (+200 pcs), 1 item less (−200 pcs) · net 0 pcs")
  assert.doesNotMatch(netted.sentence, /exactly/i)
  assert.equal(unitFloorWords({ floor_gap: 0 }, "kg").sentence, "The floor took exactly the spec + wastage")
  assert.equal(unitFloorWords({ floor_gap: 0 }, "kg").short, "Exactly")
  assert.equal(unitFloorWords({ floor_gap: 0.8 }, "kg", true).sentence, "So far, the floor took 0.8 kg more than spec + wastage, every item within its limit")
  assert.match(unitFloorWords({ floor_gap: 94.3, floor_over_items: 2, floor_over: 93.5 }, "kg", true).sentence, /^So far on the floor, 2 items took 93.5 kg more/)
  // Note examples speak in the item's own unit and material.
  assert.equal(notePlaceholder({ status: "OVER", material_type: "PACKAGING", unit_label: "pcs" }), "Why more? e.g. 20 pcs torn in the rain")
  assert.doesNotMatch(notePlaceholder({ status: "OVER", material_type: "PACKAGING", unit_label: "pcs" }), /kg/)
  assert.match(notePlaceholder({ status: "OVER", material_type: "RAW_PAPER", unit_label: "kg" }), /6 kg cut off/)
}
