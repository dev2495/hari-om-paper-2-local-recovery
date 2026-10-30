import assert from "node:assert/strict"

import { personName } from "../components/procurement/rm-calendar/format"
import { personText } from "../lib/api-month-end"
import { forgetPeople, knownPersonName, peopleInText, personLabel, rememberPeople } from "../lib/people"
import { errorCode, who } from "../lib/stock-format"
import { canOpenScreen, rolePlainLabel, rolesSentence } from "../lib/role-matrix"
import { inboxTargetFor, quickActionsFor } from "../lib/workspace"

// People by name (client 2026-10-28): logins resolve to display names once the directory is known.
assert.equal(personLabel("owner2.e2e@hariom.com"), "owner2.e2e")
assert.equal(personLabel(null), "—")
assert.equal(personLabel("", "someone"), "someone")
assert.equal(personLabel("system"), "System")
assert.equal(personLabel("Harish Shah"), "Harish Shah")
rememberPeople([
  { email: "owner2.e2e@hariom.com", name: "Owner two (E2E)" },
  { email: "Operator.E2E@hariom.com", name: "Ramesh" },
  { email: "store@plant-a.in", name: "Store A" },
  { email: "store@plant-b.in", name: "Store B" },
])
assert.equal(personLabel("owner2.e2e@hariom.com"), "Owner two (E2E)")
assert.equal(personLabel("OWNER2.E2E@HARIOM.COM"), "Owner two (E2E)")
assert.equal(personLabel("owner2.e2e"), "Owner two (E2E)", "a login shown without its domain")
assert.equal(personLabel("operator.e2e@hariom.com"), "Ramesh")
assert.equal(personLabel("store@plant-b.in"), "Store B")
assert.equal(personLabel("store"), "Store", "two people share the login part: never guess between them")
assert.equal(personLabel("pm.e2e@hariom.com"), "pm.e2e", "not in the directory yet")
// The stock, month-end and RM calendar pages format people through the same directory (2026-10-30).
assert.equal(who("operator.e2e@hariom.com"), "Ramesh")
assert.equal(personText("owner2.e2e@hariom.com"), "Owner two (E2E)")
assert.equal(personName("owner2.e2e@hariom.com"), "Owner two (E2E)")
assert.equal(personName("pm.e2e@hariom.com"), "Pm E2e", "an unknown login keeps the calendar's own fallback")
assert.equal(knownPersonName("pm.e2e@hariom.com"), null)
assert.equal(who(null), "—")
assert.equal(personText(""), "someone")
assert.equal(peopleInText("Count CNT-1 approved 28 Oct 2026 by owner2.e2e."), "Count CNT-1 approved 28 Oct 2026 by Owner two (E2E).")
assert.equal(peopleInText("Closed by owner2.e2e@hariom.com, then store opened"), "Closed by Owner two (E2E), then store opened", "plain words are left alone")
assert.equal(peopleInText("Waiting for pm.e2e"), "Waiting for pm.e2e", "a login the directory does not know stays")
forgetPeople()
assert.equal(personLabel("owner2.e2e@hariom.com"), "owner2.e2e", "sign-out forgets the names")

// Restricted pages say who may open them in plain words, each role once.
assert.equal(rolesSentence(["Owner", "Admin", "Owner", "Admin", "PlantManager"]), "the Owner, Admin and Plant Manager")
assert.equal(rolesSentence(["Owner", "Admin", "Store", "Planner", "PlantManager", "GRN"]), "the Owner, Admin, Store, Planner, Plant Manager and Goods inward")
assert.equal(rolesSentence(["Owner"]), "the Owner")
assert.equal(rolesSentence([]), "")
assert.equal(rolePlainLabel("RMIssue"), "Material issue")
assert.equal(rolePlainLabel("InProcessQC"), "In-process QC")
assert.equal(rolePlainLabel("SomeNewRole"), "Some New Role")

console.log("people names and plain role sentences ok")

// Operator landing (checker 30 Oct): no link or button the role would meet as "not open to your role".
assert.equal(canOpenScreen("/inventory/reels/issue", ["Operator"]), false)
assert.equal(canOpenScreen("/inventory/reels/issue", ["RMIssue"]), true)
assert.equal(canOpenScreen("/production/job-cards/4ee9f41d", ["Operator"]), true, "a card's own page follows Job cards")
assert.equal(canOpenScreen("/production/job-cards/manage", ["Operator"]), false)
assert.equal(canOpenScreen("/production/entry?mode=qc", ["Operator"]), true)
assert.equal(canOpenScreen("/scan", ["Operator"]), true, "pages outside the matrix stay open")
assert.equal(canOpenScreen("/inventory/reels/issue", ["Operator", "Owner"]), true)
assert.deepEqual(inboxTargetFor({ href: "/inventory/reels/issue", action: null }, ["Operator"]), { href: "/inbox", action: null })
assert.deepEqual(inboxTargetFor({ href: "/production/job-cards/abc", action: "schedule" }, ["Operator"]), { href: "/production/job-cards/abc", action: null }, "Schedule is planning work")
assert.deepEqual(inboxTargetFor({ href: "/production/job-cards/abc", action: "schedule" }, ["Planner"]), { href: "/production/job-cards/abc", action: "schedule" })
assert.deepEqual(inboxTargetFor({ href: "/production/job-cards/abc", action: "continue" }, ["Operator"]), { href: "/production/job-cards/abc", action: "continue" })
assert.deepEqual(quickActionsFor("Operator", ["Operator"]).map((row) => row.label), ["Log output", "Job cards", "Log QC", "Scan a label"])

// One closed-month refusal: the code reads from either shape.
const locked = { code: "BOOKS_LOCKED", message: "March 2026 is closed. Ask the owner to re-open it.", month: "2026-03" }
assert.equal(errorCode({ response: { data: { ...locked, detail: locked } } }), "BOOKS_LOCKED")
assert.equal(errorCode({ response: { data: locked } }), "BOOKS_LOCKED")
assert.equal(errorCode({ response: { data: { detail: locked } } }), "BOOKS_LOCKED")
assert.equal(errorCode({ response: { data: { detail: "Only 2 kg left" } } }), "")

console.log("role-filtered landing links and books-locked code ok")
