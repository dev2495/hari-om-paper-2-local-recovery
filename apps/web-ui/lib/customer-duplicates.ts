// Possible duplicate customers (owner, 2 Nov 2026): flag only. Nothing is merged or blocked; users decide.
// Two customers are a possible duplicate when their names match after normalising (case, punctuation,
// spaces, company suffixes such as Pvt Ltd / Private Limited / Ltd / Limited / LLP) or differ by a small
// typo ("Relience" / "Reliance", "Polyetser" / "Polyester"), and their bracketed units do not differ:
// "Reliance Industries Limited [Hazira]" and "[Silvassa]" are two customers; a name without a unit may be
// either, so it is flagged against both.

/** Trailing words that only say what kind of company it is. */
const SUFFIX_WORDS = new Set(["pvt", "pvtltd", "private", "ltd", "limited", "llp", "plc", "p"])
/** Bracket text that is a company suffix, not a unit: "(P) Ltd", "(Pvt.) Ltd", "(India)" is kept as a unit. */
const SUFFIX_BRACKET = /^(p|pvt|private|pvt ltd|ltd|limited|llp)$/

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

export type CustomerNameKey = {
  /** Name without suffixes, punctuation or units, words kept: "reliance industries". */
  base: string
  /** The base with no spaces, for comparing: "relianceindustries". */
  compact: string
  /** The bracketed unit with no spaces or punctuation, "" when none: "hazira". */
  unit: string
}

/** The parts of a customer name that decide whether two names are the same customer. */
export function customerNameKey(name: any): CustomerNameKey {
  const raw = String(name || "")
  const units: string[] = []
  const rest = raw.replace(/[\[(]([^\])]*)[\])]?/g, (_match, inner: string) => {
    const unit = words(inner)
    if (unit && !SUFFIX_BRACKET.test(unit)) units.push(unit)
    return " "
  })
  const tokens = words(rest).split(" ").filter(Boolean)
  while (tokens.length > 1 && SUFFIX_WORDS.has(tokens[tokens.length - 1])) tokens.pop()
  const base = tokens.join(" ")
  return { base, compact: base.replace(/ /g, ""), unit: units.join(" ").replace(/ /g, "") }
}

/**
 * Edit distance with swapped neighbours counted as one edit (optimal string alignment), stopping early once
 * it is above `max` (returns max + 1 then).
 */
export function nameDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1)
      row.push(value)
      if (value < best) best = value
    }
    if (best > max) return max + 1
    rows.push(row)
  }
  return rows[a.length][b.length]
}

/** How many typos a name of this length may have and still match: none under 5 letters, 1 under 10, else 2. */
export const typoAllowance = (length: number) => (length < 5 ? 0 : length < 10 ? 1 : 2)

function keysMatch(a: CustomerNameKey, b: CustomerNameKey): boolean {
  if (!a.compact || !b.compact) return false
  if (a.unit && b.unit && a.unit !== b.unit) return false
  if (a.compact === b.compact) return true
  const allowance = typoAllowance(Math.min(a.compact.length, b.compact.length))
  return allowance > 0 && nameDistance(a.compact, b.compact, allowance) <= allowance
}

/** True when two customer names look like the same customer. */
export function isPossibleDuplicate(a: any, b: any): boolean {
  return keysMatch(customerNameKey(a), customerNameKey(b))
}

/** Every customer that has a possible duplicate, with the others it may duplicate (id → others). */
export function findPossibleDuplicates<T extends { id: any; name?: any }>(rows: T[]): Map<string, T[]> {
  const list = (rows || []).filter((row) => row && row.id != null)
  const keys = list.map((row) => customerNameKey(row.name))
  const out = new Map<string, T[]>()
  const add = (from: T, other: T) => {
    const id = String(from.id)
    out.set(id, [...(out.get(id) || []), other])
  }
  // Sorted by length so each name is only compared with names close enough in length to be a typo.
  const order = list.map((_, i) => i).sort((x, y) => keys[x].compact.length - keys[y].compact.length)
  for (let p = 0; p < order.length; p++) {
    const i = order[p]
    for (let q = p + 1; q < order.length; q++) {
      const j = order[q]
      if (keys[j].compact.length - keys[i].compact.length > 2) break
      if (String(list[i].id) === String(list[j].id)) continue
      if (keysMatch(keys[i], keys[j])) {
        add(list[i], list[j])
        add(list[j], list[i])
      }
    }
  }
  return out
}

/** "Possible duplicate of Reliance Industries Ltd (WB-RIL)" — the other names in one line. */
export function duplicateText(others: Array<{ name?: any; customer_code?: any }>): string {
  const names = (others || []).map((c) => `${String(c.name || "—")}${c.customer_code ? ` (${c.customer_code})` : ""}`)
  if (!names.length) return ""
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}
