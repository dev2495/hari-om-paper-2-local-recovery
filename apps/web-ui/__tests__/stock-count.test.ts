import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { dayText, daysHere, errorCode, errorText, isWholeUnit, monthText, pickFromText, placeText, plural, qtyText, reasonWord, shiftMonth, signedQty, timeText, unitName, unitTotalsText, unitWord, who } from "../lib/stock-format"
import { buildScanUrl } from "../lib/app-url"
import { locationScanPayload, parseScanCode } from "../lib/scan-code"

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8")

// Quantities: en-IN numbers with the unit; pieces are whole; kg and pcs never add together.
assert.equal(qtyText(1234.5, "KG"), "1,234.5 kg")
assert.equal(qtyText(40, "PCS"), "40 pcs")
assert.equal(qtyText(39.6, "PCS"), "40 pcs")
assert.equal(qtyText(2.5, "L"), "2.5 L")
assert.equal(signedQty(-10, "KG"), "−10 kg")
assert.equal(signedQty(5, "PCS"), "+5 pcs")
assert.equal(signedQty(0.0001, "KG"), "0 kg")
assert.equal(unitTotalsText([{ uom: "KG", qty: 4320 }, { uom: "PCS", qty: 40 }, { uom: "L", qty: 0 }]), "4,320 kg · 40 pcs")
// A negative quantity uses the minus sign, never a hyphen; other units keep their own word and whole numbers.
assert.equal(qtyText(-61, "KG"), "−61 kg")
assert.equal(qtyText(-0.2, "PCS"), "0 pcs")
assert.equal(qtyText(12.6, "BOX"), "13 boxes")
assert.equal(unitWord("NOS"), "nos")
assert.equal(unitWord("ltr"), "L")
assert.equal(unitName("PCS"), "pieces")
assert.ok(isWholeUnit("ROLL") && isWholeUnit("pcs") && !isWholeUnit("KG") && !isWholeUnit("L"))
assert.equal(plural(1, "rack"), "1 rack")
assert.equal(plural(3, "rack"), "3 racks")
// "Days here" counts from when the lot came to this place (IST days), not from its inward date.
const now = new Date("2026-10-28T09:00:00Z")
assert.equal(daysHere("2026-10-28T03:00:00", now), "here since today")
assert.equal(daysHere("2026-10-27T03:00:00", now), "1 day here")
assert.equal(daysHere("2026-10-18", now), "10 days here")
assert.equal(daysHere(null, now), "")

// Dates in Indian style; a naive UTC server stamp is shown on its IST day (30 Sep 20:00 UTC = 1 Oct in India).
assert.equal(dayText("2026-10-27"), "27 Oct 2026")
assert.equal(dayText("2026-09-30T20:00:00"), "1 Oct 2026")
assert.match(timeText("2026-10-28T10:35:00"), /28 Oct.*4:05/i)
// Month maths is pure string maths: no new Date(y, m, 1).toISOString() slipping a day in India.
assert.equal(shiftMonth("2026-01", -1), "2025-12")
assert.equal(shiftMonth("2026-12", 1), "2027-01")
assert.equal(shiftMonth("2026-10", 0), "2026-10")
assert.equal(monthText("2026-10"), "October 2026")
assert.equal(who("store.maker@hariom.com"), "store.maker")

// Plain-word errors from the service, including the structured {code, message} details.
assert.equal(errorText({ response: { data: { detail: "October 2026 is closed. Ask the owner to re-open it." } } }), "October 2026 is closed. Ask the owner to re-open it.")
assert.equal(errorText({ response: { data: { detail: { code: "RACK_LABEL", message: "That is a rack label (RM-A-01)." } } } }), "That is a rack label (RM-A-01).")
assert.equal(errorCode({ response: { data: { detail: { code: "UNKNOWN_LABEL", message: "x" } } } }), "UNKNOWN_LABEL")
assert.equal(errorText({ message: "Request failed with status code 500" }, "Try again."), "Try again.")

// A rack label's QR is a /scan link that parses back to the location.
const plant = "00000000-0000-0000-0000-0000000000a1"
const id = "3f2a6c1e-9b1d-4c55-8e7a-0b6d2f1c9a10"
const payload = locationScanPayload(plant, id, "RM-A-01")
const link = buildScanUrl(payload)
const parsed = parseScanCode(link)
assert.equal(parsed.kind, "LOCATION")
assert.equal(parsed.id, id)
assert.equal(parsed.code, "RM-A-01")

// The pages of this build exist and keep their contracts.
for (const page of [
  "app/(dashboard)/inventory/stock-control/page.tsx",
  "app/(dashboard)/inventory/counts/[id]/page.tsx",
  "app/(dashboard)/inventory/counts/[id]/rack/[locationId]/page.tsx",
  "app/(dashboard)/inventory/locations/page.tsx",
  "app/(dashboard)/inventory/locations/[id]/page.tsx",
  "app/(dashboard)/inventory/locations/labels/page.tsx",
  "app/(dashboard)/inventory/locations/lot-labels/page.tsx",
]) assert.ok(existsSync(resolve(process.cwd(), page)), page)
const hub = read("app/(dashboard)/inventory/stock-control/page.tsx")
assert.match(hub, /"counts", "corrections", "book"/)
assert.match(hub, /<Suspense/)
assert.doesNotMatch(hub, /toISOString\(\)\.slice\(0, ?10\)/)
// The retired buttons stay retired: no carry forward, no "post opening", no direct post of a correction.
assert.doesNotMatch(hub, /carry-forward|Carry forward|post-opening|post_now/)
// Every in-app scan box says "That is a rack label" for a rack QR.
for (const page of [
  "app/(dashboard)/scan/page.tsx",
  "app/(dashboard)/inventory/reels/issue/page.tsx",
  "app/(dashboard)/inventory/production-issue/page.tsx",
  "app/(dashboard)/quality/incoming/page.tsx",
  "app/(dashboard)/inventory/genealogy/page.tsx",
  "app/(dashboard)/masters/tools/page.tsx",
  "app/(dashboard)/production/entry/page.tsx",
]) assert.match(read(page), /LOCATION|RackLabelHint/, page)
// GRN lines always say where the stock is put.
assert.match(read("app/(dashboard)/purchase/inward/page.tsx"), /location_id: lineLocation\(line\)/)

// The phone rack count: the scan answer goes straight into the page; one key per "no label" sheet; a rack
// that is not in the count leads back to it; the scanner shows the camera button only where it works.
const rack = read("app/(dashboard)/inventory/counts/[id]/rack/[locationId]/page.tsx")
assert.match(rack, /usePatchRack/)
assert.match(rack, /client_ref: loose\.ref/)
assert.match(rack, /This rack is not part of this count/)
assert.doesNotMatch(rack, /=== "PCS" \? "pcs" : String\(uom\)\.toUpperCase\(\) === "L" \? "L" : "kg"/)
assert.match(read("components/inventory/continuous-scanner.tsx"), /"BarcodeDetector" in window/)
// The count hub: one main action (keep counting, then send), new lots get labels, every line in one group.
const countHub = read("app/(dashboard)/inventory/counts/[id]/page.tsx")
assert.match(countHub, /count-continue/)
assert.match(countHub, /lot-labels\?ids=/)
assert.match(countHub, /quantity different/)
// Corrections start without a reason picked and show the lot before it is sent.
const correction = read("components/inventory/correction-sheet.tsx")
assert.match(correction, /Choose a reason/)
assert.match(correction, /lookupLot/)
// The stock book says why it does not balance, in words, and no developer text.
assert.doesNotMatch(hub, /Tell the developer/)
assert.match(hub, /book_problem_word/)

// Round 2: reasons in words in the stock book drawer (the count chip already says "Count difference").
assert.equal(reasonWord("COUNT_SHORT"), "Count short")
assert.equal(reasonWord("FLOOR_ISSUE"), "Floor issue")
assert.equal(reasonWord("PHYSICAL_COUNT_VARIANCE"), "")
assert.equal(reasonWord("SOME_NEW_CODE"), "Some new code")
assert.equal(reasonWord("Unused glue"), "Unused glue")
assert.equal(reasonWord(null), "")
// One "Pick from" wording on both issue desks: the plain name, the code in brackets.
assert.equal(pickFromText({ code: "RM-STORE", name: "RM store" }), "Pick from RM store (RM-STORE)")
assert.equal(pickFromText({ code: "CK2-R1", name: "CK2-R1" }), "Pick from CK2-R1")
assert.equal(pickFromText(null), "No rack yet")
assert.equal(placeText({ code: "RM-A-01", name: "" }), "RM-A-01")
for (const desk of ["app/(dashboard)/inventory/reels/issue/page.tsx", "app/(dashboard)/inventory/production-issue/page.tsx"]) assert.match(read(desk), /pickFromText\(/)
// Phone bars bleed by the 12 px gutter, never 16 px (no sideways page scroll at 390 px).
for (const page of ["app/(dashboard)/inventory/counts/[id]/rack/[locationId]/page.tsx", "app/(dashboard)/inventory/locations/[id]/page.tsx"]) assert.doesNotMatch(read(page), /sticky[^"]*-mx-4/)
// The book never calls a month balanced when a material opens below zero; the count list has a filter.
assert.match(hub, /row\.opening < -0\.0005/)
assert.match(hub, /count-filter/)

console.log("stock-count tests passed")
