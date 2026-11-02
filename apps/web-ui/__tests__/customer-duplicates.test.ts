import assert from "node:assert/strict"

import { customerNameKey, duplicateText, findPossibleDuplicates, isPossibleDuplicate, nameDistance, typoAllowance } from "../lib/customer-duplicates"

// Possible duplicate customers (owner, 2 Nov 2026): flag only, never merged or blocked.
assert.deepEqual(customerNameKey("Reliance Industries Limited [Hazira]"), { base: "reliance industries", compact: "relianceindustries", unit: "hazira" })
assert.deepEqual(customerNameKey("Madelin Enterprises Ltd.[ Saily ]"), { base: "madelin enterprises", compact: "madelinenterprises", unit: "saily" })
assert.deepEqual(customerNameKey("Relience (Patal Ganga )"), { base: "relience", compact: "relience", unit: "patalganga" })
assert.equal(customerNameKey("Chokshi Texelin Pvt.Ltd.").base, "chokshi texelin")
assert.equal(customerNameKey("PNP Polymers Pvt.ltd.").base, "pnp polymers")
assert.equal(customerNameKey("Sanathan Textile Private Limited").base, "sanathan textile")
assert.equal(customerNameKey("Acme Traders LLP").base, "acme traders")
assert.equal(customerNameKey("Acme (P) Ltd").unit, "", "(P) is a suffix, not a unit")
assert.equal(customerNameKey("Limited").base, "limited", "a name is never emptied")
assert.equal(customerNameKey(null).compact, "")

// Normalising: case, punctuation, spaces and company suffixes.
assert.equal(isPossibleDuplicate("Chokshi Texelin Pvt.Ltd.", "CHOKSHI TEXELIN PRIVATE LIMITED"), true)
assert.equal(isPossibleDuplicate("Chokshi Texelin Pvt Ltd", "Chokshi  Texelin"), true)
assert.equal(isPossibleDuplicate("Century Enka Ltd", "Century Enka Limited"), true)
assert.equal(isPossibleDuplicate("P.N.P. Polymers", "PNP Polymers Pvt.ltd."), true)
assert.equal(isPossibleDuplicate("Acme Traders LLP", "Acme Traders"), true)
// Close typos.
assert.equal(nameDistance("polyetser", "polyester"), 1, "swapped letters are one typo")
assert.equal(nameDistance("relience", "reliance"), 1)
assert.equal(nameDistance("abcdef", "uvwxyz", 2), 3, "stops early above the limit")
assert.equal(isPossibleDuplicate("Relience Industries Ltd", "Reliance Industries Limited"), true)
assert.equal(isPossibleDuplicate("Reliance Polyetser Ltd.[ Silvassa ]", "Reliance Polyester Ltd [Silvassa]"), true)
assert.equal(isPossibleDuplicate("Reliance Polyetser Ltd", "Reliance Polyester Ltd."), true)
// Different units are different customers.
assert.equal(isPossibleDuplicate("Reliance Industries Limited [Hazira]", "Reliance Industries Limited [Silvassa]"), false)
assert.equal(isPossibleDuplicate("Reliance Polyester Ltd.[ Dahej ]", "Reliance Polyetser Ltd.[ Silvassa ]"), false)
assert.equal(isPossibleDuplicate("Madelin Enterprises Ltd. [ Athola ]", "Madelin Enterprises Ltd.[ Saily ]"), false)
assert.equal(isPossibleDuplicate("Reliance Industries Limited [ Hazira ]", "Reliance Industries Ltd.[Hazira]"), true, "same unit, spaced differently")
assert.equal(isPossibleDuplicate("Reliance Industries Limited", "Reliance Industries Limited [Hazira]"), true, "a name without a unit may be either")
// Not duplicates.
assert.equal(isPossibleDuplicate("Sanathan Textile Pvt.Ltd", "Santhan Polycoat Pvt.Ltd"), false)
assert.equal(isPossibleDuplicate("Raj Rayon Industries Ltd", "Rajashree Polyfils Ltd"), false)
assert.equal(isPossibleDuplicate("Season acceptance customer", "Season acceptance customer_FINAL"), false)
assert.equal(isPossibleDuplicate("SRF Ltd", "SRK Ltd"), false, "short names need an exact match")
assert.equal(typoAllowance(4), 0)
assert.equal(typoAllowance(8), 1)
assert.equal(typoAllowance(12), 2)

// The list: each customer with the others it may duplicate.
const rows = [
  { id: "1", name: "Reliance Industries Limited [Hazira]", customer_code: "RIL-H" },
  { id: "2", name: "Reliance Industries Limited [Silvassa]", customer_code: "RIL-S" },
  { id: "3", name: "Relience Industries Ltd. [ Hazira ]", customer_code: "RIL-H2" },
  { id: "4", name: "Chokshi Texelin Pvt.Ltd.", customer_code: "CT" },
  { id: "5", name: "Chokshi Texelin Private Limited", customer_code: "CT2" },
  { id: "6", name: "Garden Silk Mills Ltd.", customer_code: "GS" },
]
const found = findPossibleDuplicates(rows)
assert.deepEqual([...found.keys()].sort(), ["1", "3", "4", "5"])
assert.deepEqual(found.get("1")!.map((r) => r.id), ["3"], "Hazira only with Hazira")
assert.deepEqual(found.get("4")!.map((r) => r.id), ["5"])
assert.equal(found.has("2"), false)
assert.equal(found.has("6"), false)
assert.equal(findPossibleDuplicates([]).size, 0)
assert.equal(duplicateText(found.get("4")!), "Chokshi Texelin Private Limited (CT2)")
assert.equal(duplicateText([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]), "A, B and 2 more")
assert.equal(duplicateText([]), "")

console.log("customer-duplicates: ok")
