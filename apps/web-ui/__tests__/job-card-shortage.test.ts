import { strict as assert } from "node:assert"
import { matchesShortageReview, shortageRecoveryIsConclusive, type ShortageRecord, type ShortageReview } from "../lib/job-card-shortage"

const review: ShortageReview = {
  kind: "CREATE", job_card_id: "parent-card", planned_qty: 50, produced_qty: 40, gap_qty: 10,
  reason_code: "QC_LOSS", reason_label: "QC loss", decision: "CARRY_FORWARD", notes: "Remake accepted FG shortage",
}
const record: ShortageRecord = {
  id: "decision-1", job_card_id: "parent-card", stage_type: "JOB_CARD", planned_qty: 50, produced_qty: 40, gap_qty: 10,
  reason_code: "QC_LOSS", decision: "CARRY_FORWARD", notes: "Remake accepted FG shortage", created_at: "2026-10-03T00:00:00Z",
}

assert.equal(matchesShortageReview(record, review), true, "a committed identical decision recovers after timeout")
assert.equal(matchesShortageReview(null, review), false, "absence is not proof of committed success")
for (const change of [{ job_card_id: "other-card" }, { stage_type: "WINDER" }, { decision: "HOLD" }, { reason_code: "OTHER" }, { planned_qty: 49 }, { produced_qty: 41 }, { gap_qty: 9 }, { notes: "Other decision" }]) {
  assert.equal(matchesShortageReview({ ...record, ...change } as ShortageRecord, review), false, `another action must not be mistaken for recovery: ${JSON.stringify(change)}`)
}
assert.equal(matchesShortageReview({ ...record, produced_qty: 0, gap_qty: 50 }, { ...review, produced_qty: 0, gap_qty: 50 }), true, "zero accepted FG remains a valid exact decision")
assert.equal(matchesShortageReview({ ...record, notes: null }, { ...review, notes: "" }), true, "empty optional notes use the server's null representation")

const resolve: ShortageReview = { ...review, kind: "RESOLVE", short_close_id: "decision-1", decision: "SHORT_CLOSE_SO", notes: "Customer accepted reduced order" }
const resolved: ShortageRecord = { ...record, decision: "HOLD", hold_status: "RESOLVED", resolution_decision: "SHORT_CLOSE_SO", resolution_note: resolve.notes }
assert.equal(matchesShortageReview(resolved, resolve), true, "identical resolved HOLD is safe timeout recovery")
for (const change of [{ id: "other-hold" }, { hold_status: "OPEN" }, { resolution_decision: "CARRY_FORWARD" }, { resolution_note: "Other reason" }]) {
  assert.equal(matchesShortageReview({ ...resolved, ...change } as ShortageRecord, resolve), false, "an unresolved or different hold resolution cannot recover this command")
}

const openHold: ShortageRecord = { ...record, decision: "HOLD", hold_status: "OPEN" }
for (const uncertainStatus of [0, 408, 500, 502, 503]) {
  assert.equal(shortageRecoveryIsConclusive(openHold, resolve, uncertainStatus), false, "an existing open hold cannot unlock a second decision after an ambiguous resolution attempt")
  assert.equal(shortageRecoveryIsConclusive(null, review, uncertainStatus), false, "missing creation history cannot unlock a second decision after an ambiguous attempt")
}
assert.equal(shortageRecoveryIsConclusive(resolved, resolve, 500), true, "a resolved original hold establishes the final outcome even after transport failure")
assert.equal(shortageRecoveryIsConclusive({ ...resolved, id: "other-hold" }, resolve, 500), false, "another hold cannot settle the reviewed attempt")
assert.equal(shortageRecoveryIsConclusive({ ...record, job_card_id: "other-card" }, review, 500), false, "another card's creation does not settle the reviewed attempt")
assert.equal(shortageRecoveryIsConclusive(openHold, { ...review, decision: "HOLD" }, 500), true, "a newly created hold is conclusive for a creation attempt")
assert.equal(shortageRecoveryIsConclusive(openHold, resolve, 422), true, "an explicit server rejection allows the manager to review again")

console.log("job-card-shortage: exact decision and HOLD recovery checks passed")
