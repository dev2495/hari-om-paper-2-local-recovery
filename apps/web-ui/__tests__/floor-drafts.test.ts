import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Client round 28 Oct (floor): device drafts for every floor form, the Process count as a flag (never a
// gate), stage closes from the whole printed card, and each stage's close on the printed card.

// A small localStorage for node.
const store = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
}
const realKeys = Object.keys
;(Object as any).keys = (target: any) => (target === (globalThis as any).window.localStorage ? [...store.keys()] : realKeys(target))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { draftKey, draftKeysFor, draftTime, readDraft, removeDraft, setDraftOwner, writeDraft } = require("../components/production/card/draft-store")

// Nobody signed in: no draft at all (a shared tablet keeps nothing for "nobody").
setDraftOwner(null)
assert.equal(draftKey("output", "c1", "WINDER"), null, "no signed-in person, no draft")

// Keys: person · form · card · stage (· run), so two people, two stages or two runs never share a draft.
setDraftOwner("u-a")
assert.equal(draftKey("output", "c1", "WINDER"), "hariom-draft:v2:u-a:output:c1:WINDER")
assert.equal(draftKey("qc", "c1", "OVEN", "run-7"), "hariom-draft:v2:u-a:qc:c1:OVEN:run-7")
assert.equal(draftKey("whole", "c1"), "hariom-draft:v2:u-a:whole:c1:ALL")
assert.equal(draftKey("output", null, "WINDER"), null, "no card, no draft")

// Old v1 keys (no person) are removed on first use.
store.set("hariom-draft:v1:output:c1:WINDER", JSON.stringify({ value: { output: "9" }, savedAt: Date.now() }))

// Write, read back, keep the first time when nothing changed, remove.
const key = draftKey("output", "c1", "WINDER")
writeDraft(key, { output: "7" })
assert.equal(store.has("hariom-draft:v1:output:c1:WINDER"), false, "v1 drafts without a person are dropped")
const first = readDraft(key)
assert.deepEqual(first.value, { output: "7" })
const firstAt = first.savedAt
writeDraft(key, { output: "7" })
assert.equal(readDraft(key).savedAt, firstAt, "same values keep the time they were typed")

// Another person on the same device sees none of it (28 Oct: drafts leaked between users on a shared tablet).
setDraftOwner("u-b")
assert.equal(readDraft(draftKey("output", "c1", "WINDER")), null, "person B never gets person A's draft")
assert.deepEqual(draftKeysFor("output", "c1"), [])
setDraftOwner("u-a")

writeDraft(draftKey("oldform", "c9", "WINDER"), { a: 1 })
writeDraft(draftKey("oldform", "c9", "OVEN"), { a: 2 })
assert.deepEqual(draftKeysFor("oldform", "c9").sort(), ["hariom-draft:v2:u-a:oldform:c9:OVEN", "hariom-draft:v2:u-a:oldform:c9:WINDER"])
removeDraft(key)
assert.equal(readDraft(key), null)

// Older than 7 days is dropped; broken JSON is ignored.
store.set("hariom-draft:v2:u-a:output:old:WINDER", JSON.stringify({ value: { output: "1" }, savedAt: Date.now() - 8 * 24 * 3600 * 1000 }))
assert.equal(readDraft("hariom-draft:v2:u-a:output:old:WINDER"), null)
assert.equal(store.has("hariom-draft:v2:u-a:output:old:WINDER"), false)
store.set("hariom-draft:v2:u-a:output:bad:WINDER", "{nope")
assert.equal(readDraft("hariom-draft:v2:u-a:output:bad:WINDER"), null)

// "4:52 pm" today, "27 Oct, 4:52 pm" on another day.
const today = new Date()
today.setHours(16, 52, 0, 0)
assert.match(draftTime(today.getTime()), /^4:52\s?pm$/i)
const before = new Date(today.getTime() - 2 * 24 * 3600 * 1000)
assert.match(draftTime(before.getTime()), /^\d{1,2} [A-Z][a-z]{2}, 4:52\s?pm$/i)

// Contracts on the floor forms (source text): the count is a flag, drafts are wired, closes are printed.
const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8")
const output = read("components/production/card/LogOutputForm.tsx")
assert.ok(!output.includes("an output the bamboo can give"), "Log output no longer blocks a count gap")
assert.ok(output.includes('data-testid="process-count-gap"') && output.includes("Nothing has to be written for it"), "the gap is shown as a flag")
assert.ok(output.includes('draftKey("output"') && output.includes("draft.clear()"), "Log output keeps a device draft and clears it after save")
const qc = read("components/production/card/LogQcForm.tsx")
assert.ok(qc.includes('draftKey("qc"') && qc.includes("draft.clear()"), "Log QC keeps a device draft")
const close = read("components/production/card/CloseStageDialog.tsx")
assert.ok(close.includes('draftKey("close"') && close.includes("draft.clear()"), "Close stage keeps a device draft")
const whole = read("components/production/WholeCardEntryForm.tsx")
assert.ok(whole.includes('draftKey("whole"') && whole.includes("whole-card-count-"), "Whole printed card keeps a draft and shows the count")
const doc = read("components/production/JobCardDocument.tsx")
assert.ok(doc.includes('draftKey("oldform"') && doc.includes('testId="old-form-draft"'), "the old-form card keeps device drafts")
assert.ok(doc.includes('data-testid="final-qc-readings"') && doc.includes("finalQcSamples"), "old-form Final QC takes the final readings itself")
assert.ok(doc.includes('data-testid="print-stage-closes"') && doc.includes("closeSign("), "the printed card shows each stage's close")
const runs = read("components/production/card/RunList.tsx")
assert.ok(runs.includes("CountGapLine"), "a run with a count gap is flagged in the Output log")

// Round 4: one truth for "on the planner", one meaning of "draft", the V2 print gap, old-form QC rules.
const model = read("components/production/card/model.ts")
assert.ok(model.includes("s.machine_id && s.plan_date && s.shift_code") && model.includes("const slots: any[] = plannerSlots(state, openOnly)"), "a slot is a machine, a date and a shift (a part without a machine is not on the planner)")
assert.ok(model.includes("unplanned: true"), "Plan match says when the run is before planning")
assert.ok(output.includes("const slotReady = !planMatch.unplanned"), "the banner follows the Plan match tile")
assert.ok(model.includes("`${n} with supervisor`") && output.includes("waitingRunsBadge("), "runs waiting for the supervisor are named for who has them")
assert.ok(!output.includes("draft_count} draft"), "a run waiting for the supervisor is not called a draft on the form")
const sheet = read("components/production/card/EntrySheet.tsx")
assert.ok(sheet.includes('"bg-primary-foreground text-primary"'), "the badge on the active tab is a solid chip (contrast)")
const bar = read("components/production/card/draft.tsx")
assert.ok(!bar.includes('<span aria-hidden="true">·</span>'), "no stray dot before Discard")
assert.ok(doc.includes("const runGaps = seasonalCard ? v2Rows(stage)"), "the V2 print close strip carries the runs' count gap")
assert.ok(doc.includes('stageReadingsShort(stage: "WINDER" | "OVEN" | "PROCESS"') && doc.includes('data-testid={`stage-qc-${pairKey}-sample-2`}'), "old-form Winder, Oven and Process need two readings; Oven and Process take a second sample")
assert.ok(doc.includes('data-testid="process-reject-reason-needed"'), "old-form Process rejects ask for a reason")

;(Object as any).keys = realKeys
console.log("floor drafts, Process count flag and stage-close print contracts passed")
