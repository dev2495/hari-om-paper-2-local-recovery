import assert from "node:assert/strict"

import { boxDayText, boxLabelPages, boxLabelSize, boxPcsText, boxStockLabel } from "../lib/boxes"
import { jobCardIdOf, locationScanPayload, parseScanCode } from "../lib/scan-code"

const CARD = "2772a320-c3d1-44fb-beb3-f64a0846fe5e"
const PLANT = "00000000-0000-0000-0000-0000000000a1"
const REEL = "46097db9-1111-4c2b-9d3e-0123456789ab"
const reelPayload = `HARIOM|REEL|${PLANT}|${REEL}|AT-261027-003`

// Lot labels: the plain payload (older prints, handheld scanners) and the new /scan link read the same.
for (const value of [reelPayload, `https://35-154-224-14.sslip.io/scan?c=${encodeURIComponent(reelPayload)}`, `/scan?c=${encodeURIComponent(reelPayload)}`, `  ${reelPayload}\n`]) {
  const parsed = parseScanCode(value)
  assert.equal(parsed.kind, "REEL", value)
  assert.equal(parsed.id, REEL)
  assert.equal(parsed.plantId, PLANT)
  assert.equal(parsed.code, "AT-261027-003")
}
const batch = parseScanCode(`HARIOM|BATCH|${PLANT}|ab350015-0000-4000-8000-000000000001|A/26/001-B001`)
assert.equal(batch.kind, "BATCH")
assert.equal(batch.code, "A/26/001-B001")

// Location (rack) labels (client 2026-10-28): HARIOM|LOC|plant|uuid|CODE, plain or inside the /scan link.
const LOC = "7d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6"
const locPayload = locationScanPayload(PLANT, LOC, "RM-A-01")
assert.equal(locPayload, `HARIOM|LOC|${PLANT}|${LOC}|RM-A-01`)
for (const value of [locPayload, `https://35-154-224-14.sslip.io/scan?c=${encodeURIComponent(locPayload)}`, `/scan?c=${encodeURIComponent(locPayload)}`, `HARIOM|LOCATION|${PLANT}|${LOC.toUpperCase()}|RM-A-01`, `hariom|loc|${PLANT}|${LOC}|RM-A-01`]) {
  const parsed = parseScanCode(value)
  assert.equal(parsed.kind, "LOCATION", value)
  assert.equal(parsed.id, LOC)
  assert.equal(parsed.plantId, PLANT)
  assert.equal(parsed.code, "RM-A-01")
}
// A location label whose id is not a real record id is looked up by its printed code, never sent to an API path.
for (const bad of ["../../inventory/stock-moves", "not-a-uuid", ""]) {
  const parsed = parseScanCode(`HARIOM|LOC|${PLANT}|${bad}|RM-A-01`)
  assert.deepEqual([parsed.kind, parsed.id, parsed.code], ["CODE", "", "RM-A-01"])
}
assert.equal(parseScanCode(`HARIOM|LOC|bad plant/..|${LOC}|RM-A-01`).plantId, "")
// A typed rack code stays a typed code.
assert.deepEqual([parseScanCode("RM-A-01").kind, parseScanCode("RM-A-01").code], ["CODE", "RM-A-01"])

// Job cards: absolute and bare paths, the job card page, and the old supervisor / end-of-day links.
for (const value of [`https://35-154-224-14.sslip.io/production/entry/${CARD}`, `/production/entry/${CARD}`, `http://127.0.0.1:13003/production/job-cards/${CARD}?log=qc`,
  `/production/supervisor-entry?job_card_id=${CARD}`, `https://x.example/supervisor-entry?job_card_id=${CARD}`, `/production/eod-entry?job_card_id=${CARD}`]) {
  const parsed = parseScanCode(value)
  assert.equal(parsed.kind, "JOB_CARD", value)
  assert.equal(parsed.id, CARD)
  assert.equal(jobCardIdOf(value), CARD)
}

// Tools, typed codes and junk.
assert.deepEqual([parseScanCode("hariom://tool/TA-0007").kind, parseScanCode("hariom://tool/TA-0007").code], ["TOOL", "TA-0007"])
assert.equal(parseScanCode(`https://site/scan?c=${encodeURIComponent("hariom://tool/TA-0007")}`).kind, "TOOL")
assert.deepEqual([parseScanCode("AT-261027-003").kind, parseScanCode("AT-261027-003").code], ["CODE", "AT-261027-003"])
assert.equal(parseScanCode("26/10/65").kind, "CODE")
assert.equal(jobCardIdOf("26/10/65"), "26/10/65")
assert.equal(parseScanCode("").kind, "CODE")
assert.equal(parseScanCode("https://evil.example/").kind, "CODE")
assert.equal(parseScanCode("HARIOM|WHAT|p|i|c").kind, "CODE")

// Malformed or crafted labels never throw and never hand a path-like id to the API.
for (const value of ["hariom://tool/%", "hariom://tool/TA-1%ZZ", `/scan?c=${encodeURIComponent("hariom://tool/%E0%A4")}`]) {
  assert.equal(parseScanCode(value).kind, "TOOL", value)
}
assert.equal(parseScanCode("hariom://tool/TA-1%ZZ").code, "TA-1%ZZ")
const crafted = parseScanCode(`HARIOM|REEL|${PLANT}|../../production/job-cards?x=|AT-X`)
assert.deepEqual([crafted.kind, crafted.id, crafted.code], ["CODE", "", "AT-X"])
assert.equal(parseScanCode(`HARIOM|REEL|bad plant/..|${REEL}|AT-1`).plantId, "")
assert.equal(parseScanCode(`HARIOM|REEL|${PLANT}|${REEL.toUpperCase()}|AT-1`).id, REEL)

// Box labels (owner decision 2026-11-01): the QR link, the bare code and a typed lower-case code open the box page.
for (const value of ["B261014-001", "b261014-001", " B261014-001\n", "https://35-154-224-14.sslip.io/production/boxes/B261014-001", "/production/boxes/B261014-001?x=1",
  "http://127.0.0.1:13003/production/boxes/b261014-001", `/scan?c=${encodeURIComponent("https://site/production/boxes/B261014-001")}`, `/scan?c=B261014-001`]) {
  const parsed = parseScanCode(value)
  assert.deepEqual([parsed.kind, parsed.code, parsed.id], ["BOX", "B261014-001", ""], value)
}
assert.equal(parseScanCode("B26101Q-0012").kind, "BOX")
// Not a box: other codes keep their own kind, and junk stays a typed code.
for (const value of ["B261014", "B-001", "B261014-01", "AT-261027-003", "RM-A-01", "BOX", "/production/boxes/", "/production/boxes/../x", "https://site/production/boxes/B1-001", "B261014-001-B001"]) {
  assert.notEqual(parseScanCode(value).kind, "BOX", value)
}
assert.equal(parseScanCode(`/production/job-cards/${CARD}`).kind, "JOB_CARD")

// Box label helpers.
assert.equal(boxLabelSize("a4-21"), "a4-21")
assert.equal(boxLabelSize("single"), "single")
assert.equal(boxLabelSize("huge"), "a4-8")
assert.equal(boxLabelSize(null), "a4-8")
const twenty = Array.from({ length: 20 }, (_, i) => i)
assert.deepEqual(boxLabelPages(twenty, "a4-8").map((page) => page.length), [8, 8, 4])
assert.deepEqual(boxLabelPages(twenty, "a4-21").map((page) => page.length), [20])
assert.equal(boxLabelPages(twenty, "single").length, 20)
assert.deepEqual(boxLabelPages([], "a4-8"), [])
assert.equal(boxDayText("2026-11-01"), "01 Nov 2026")
assert.equal(boxDayText("2026-03-09T10:00:00"), "09 Mar 2026")
assert.equal(boxDayText(null), "")
assert.equal(boxDayText("2026-13-01"), "")
assert.equal(boxPcsText({ qty: 30, is_part: false }), "30 pcs")
assert.equal(boxPcsText({ qty: 1200, is_part: true }), "1,200 pcs · PART BOX")
assert.equal(boxStockLabel.FAILED, "Posting failed — retried automatically")

console.log("Scan codes: lot and location labels, job cards, legacy links, tools, box labels and typed codes passed")
