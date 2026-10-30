import assert from "node:assert/strict"

import { chooseFound, compactNumber, foundWords, isReady, matchWords, sameNumber, type FoundRow } from "../lib/lot-find"

// A typed number on the issue desks works like a scan (client 2026-10-30): case, spaces and separators never matter.
assert.equal(compactNumber(" in/26/028 - b002 "), "IN26028B002")
assert.ok(sameNumber("in 26 028 b002", "IN/26/028-B002"))
assert.ok(sameNumber("at 261028 025", "AT-261028-025"))
assert.ok(!sameNumber("", ""), "a blank never matches")
assert.ok(!sameNumber("AT-261028-02", "AT-261028-025"))

const row = (over: Partial<FoundRow>): FoundRow => ({
  kind: "LOT", id: "x", code: "IN/26/028-B002", item_id: "i", uom: "KG", qty: 45, stock_status: "UNRESTRICTED", plant_id: "p",
  matched_on: "LOT_NO", matched_value: "IN/26/028-B002", ...over,
})

// Ready = in stock, cleared, something left; a reel also not issued already.
assert.ok(isReady(row({})))
assert.ok(!isReady(row({ stock_status: "QC_HOLD" })))
assert.ok(!isReady(row({ qty: 0 })))
assert.ok(isReady(row({ kind: "REEL", status: "IN_STOCK", qty: 300 })))
assert.ok(!isReady(row({ kind: "REEL", status: "CONSUMED", qty: 300 })))

// One match: that one, whatever its state (the desk then refuses a held or used-up one in plain words).
const held = row({ id: "h", stock_status: "QC_HOLD" })
assert.equal(chooseFound({ match: "EXACT", rows: [held] }).row, held)

// An old mark on a reel in stock and on a used-up one: the one in stock, with a note.
const live = row({ kind: "REEL", id: "a", code: "AT-261028-025", status: "IN_STOCK", qty: 1250.5, matched_on: "OLD_MARK", matched_value: "CK3UI-1" })
const gone = row({ kind: "REEL", id: "b", code: "AT-261028-026", status: "CONSUMED", qty: 0, matched_on: "OLD_MARK", matched_value: "CK3UI-1" })
const picked = chooseFound({ match: "EXACT", rows: [gone, live] })
assert.equal(picked.row, live)
assert.equal(picked.note, "One other with this number cannot be issued; AT-261028-025 is the one in stock and cleared.")

// A GRN with two cleared lots, or a part of a number: a pick list, the ones that can go first.
const first = row({ id: "1", code: "IN/26/028-B001", matched_on: "GRN", matched_value: "IN/26/028" })
const second = row({ id: "2", code: "IN/26/028-B002", matched_on: "GRN", matched_value: "IN/26/028" })
assert.equal(chooseFound({ match: "EXACT", rows: [first, second] }).row, undefined)
assert.deepEqual(chooseFound({ match: "PARTIAL", rows: [held, first] }).rows.map((r) => r.id), ["1", "h"])
// A part of a number never auto-picks, even with one ready lot.
assert.equal(chooseFound({ match: "PARTIAL", rows: [held, first] }).row, undefined)

assert.deepEqual(foundWords(held), { text: "Waiting for QC", tone: "blue" })
assert.deepEqual(foundWords(row({ stock_status: "BLOCKED" })), { text: "Rejected by QC", tone: "rose" })
assert.deepEqual(foundWords(row({ qty: 0 })), { text: "Used up", tone: "slate" })
assert.deepEqual(foundWords(gone), { text: "Already issued", tone: "slate" })
assert.deepEqual(foundWords(first), { text: "Cleared", tone: "emerald" })

assert.equal(matchWords([first, second], "IN/26/028"), "2 lots match IN/26/028")
assert.equal(matchWords([live, gone], "CK3UI-1"), "2 reels and coils match CK3UI-1")
assert.equal(matchWords([first, live], "B00"), "2 match B00")

console.log("lot-find ok")
