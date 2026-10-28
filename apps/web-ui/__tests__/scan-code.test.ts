import assert from "node:assert/strict"

import { jobCardIdOf, parseScanCode } from "../lib/scan-code"

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

console.log("Scan codes: lot labels, job cards, legacy links, tools and typed codes passed")
