import { strict as assert } from "node:assert"
import { accountNoError, fromGstin, gstinError, ifscError, panError, pinError, stateCodeFor, vendorAddress, vendorFormErrors } from "../lib/party-formats"
import { bandText, flagLine, logQcHref, missingText, offBy, parameterSummary, stageCounts, waitingState, type QcFlagRow } from "../lib/qc-flags"

// Vendor master formats (client 2026-10-27): blank is fine; a filled value must have the right shape.
assert.equal(gstinError(""), "")
assert.equal(gstinError("24abcde1234f1z5"), "", "lower case is accepted (saved upper case)")
assert.match(gstinError("24ABCDE1234F1Z"), /15 characters/)
assert.match(gstinError("24ABCD12345F1Z5"), /PAN/)
assert.match(gstinError("25ABCDE1234F1Z5"), /not a GST state code/)
assert.deepEqual(fromGstin("24ABCDE1234F1Z5"), { pan: "ABCDE1234F", stateCode: "24", state: "Gujarat" })
assert.deepEqual(fromGstin("24ABCDE"), { pan: "", stateCode: "", state: "" })
assert.equal(panError("abcde1234f"), "")
assert.match(panError("ABCDE12345"), /PAN must be/)
assert.equal(ifscError("SBIN0001234"), "")
assert.match(ifscError("SBIN1001234"), /IFSC must be/)
assert.equal(pinError("382445"), "")
assert.match(pinError("038244"), /PIN code/)
assert.match(accountNoError("12AB"), /6 to 20 digits/)
assert.equal(stateCodeFor("maharashtra"), "27")
assert.equal(vendorAddress({ address: "Plot 12", address_line2: "Phase 2", city: "Vatva", state: "Gujarat", pin_code: "382445", country: "India" }), "Plot 12, Phase 2, Vatva, Gujarat - 382445")
assert.equal(vendorAddress({ full_address: "From the service" }), "From the service")
assert.deepEqual(vendorFormErrors({ gst_no: "", pan_no: "", payment_terms_days: "", credit_limit: "" }), {})
assert.deepEqual(Object.keys(vendorFormErrors({ gst_no: "24ABC", bank_ifsc: "X", payment_terms_days: "400", credit_limit: "-1" })).sort(), ["bank_ifsc", "credit_limit", "gst_no", "payment_terms_days"])

// QC flags register: flagged, never held; traced stage-wise.
const row = (over: Partial<QcFlagRow>): QcFlagRow => ({ entry_id: "e1", job_card_id: "c1", stage: "WINDER", label: "I.D.", unit: "mm", value: 76.9, min: 76.2, max: 76.5, direction: "HIGH", ...over })
assert.equal(flagLine(row({})), "Flagged · I.D. 76.9 mm (band 76.2–76.5)")
assert.equal(bandText(76.2, null, "mm"), "at least 76.2 mm")
assert.equal(offBy(row({})), 0.4)
assert.equal(offBy(row({ value: 70, direction: "LOW" })), 6.2)
assert.equal(offBy(row({ direction: null })), null)
const rows = [
  row({}),
  row({ entry_id: "e2", value: 70, direction: "LOW" }),
  row({ entry_id: "e2", label: "O.D.", value: 90, min: 80, max: 82 }),
  row({ entry_id: "e3", job_card_id: "c2", stage: "PROCESS", label: "C.S.", value: 10, min: 12, max: null, direction: "LOW" }),
]
const summary = parameterSummary(rows)
assert.deepEqual(summary.map((item) => `${item.stage}:${item.label}:${item.readings}`), ["WINDER:I.D.:2", "WINDER:O.D.:1", "PROCESS:C.S.:1"])
assert.equal(summary[0].high, 1)
assert.equal(summary[0].low, 1)
assert.equal(summary[0].worst, 6.2)
assert.deepEqual(stageCounts(rows).map((item) => [item.stage, item.readings, item.runs, item.cards]), [["WINDER", 3, 2, 1], ["OVEN", 0, 0, 0], ["PROCESS", 1, 1, 1]])
assert.equal(missingText({ state: "MORE_READINGS", readings_short: [{ label: "I.D.", have: 1, need: 2 }, { label: "O.D.", have: 0, need: 2 }] }), "I.D. 1/2 · O.D. 0/2")
assert.equal(missingText({ state: "NO_READINGS", readings_short: [] }), "No readings yet")
assert.equal(waitingState({ state: "FAILED" }), "Flagged · more readings needed")
assert.equal(logQcHref("abc", "OVEN"), "/production/entry/abc?mode=qc&stage=OVEN")

console.log("PASS vendor formats and QC flags")
