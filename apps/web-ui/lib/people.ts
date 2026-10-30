// People by name, not by login (client 2026-10-28): "started by Owner two", not "started by owner2.e2e".
//
// Services record who did something by login (an e-mail address or a bare username). The dashboard
// layout loads the directory once (hooks/use-people.ts → GET /api/auth/people: login + display name,
// for every role) and keeps a copy in this browser until sign-out, so `personLabel` is a plain
// synchronous function any page or formatter can call while rendering. No React or network here, so
// pure formatters (and their node tests) can import it.

export type PersonRow = { email: string; name: string }

const STORAGE_KEY = "hariom.people.v1"
const names = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0
let seeded = false

const keyOf = (value: string) => value.trim().toLowerCase()

function seedFromBrowser() {
  if (seeded || typeof window === "undefined") return
  seeded = true
  try {
    const rows = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")
    if (Array.isArray(rows)) store(rows)
  } catch {
    /* A private window or blocked storage: names arrive with the directory instead. */
  }
}

function store(rows: PersonRow[]): boolean {
  let changed = false
  const locals = new Map<string, Set<string>>()
  for (const row of rows) {
    const login = keyOf(String(row?.email || ""))
    const name = String(row?.name || "").trim()
    if (!login || !name) continue
    if (names.get(login) !== name) { names.set(login, name); changed = true }
    const local = login.split("@")[0]
    if (local && local !== login) locals.set(local, (locals.get(local) || new Set()).add(name))
  }
  // A login is often shown without its domain ("owner2.e2e"); map it when only one person has it.
  for (const [local, people] of Array.from(locals.entries())) {
    if (people.size === 1 && !names.has(local)) { names.set(local, Array.from(people)[0]); changed = true }
  }
  return changed
}

/** Add people to the directory (the layout calls this; tests may too). */
export function rememberPeople(rows: PersonRow[]) {
  seedFromBrowser()
  if (!store(rows)) return
  version += 1
  listeners.forEach((listener) => listener())
}

/**
 * The directory name for a login, or null when the directory does not know it yet. Formatters that keep
 * their own fallback for unknown logins use this; everything else uses `personLabel`.
 */
export function knownPersonName(actor: string | null | undefined): string | null {
  const text = String(actor || "").trim()
  if (!text) return null
  seedFromBrowser()
  const key = keyOf(text)
  return names.get(key) || (key.includes("@") ? names.get(key.split("@")[0]) : undefined) || null
}

/**
 * A sentence a service built with logins in it ("approved 28 Oct 2026 by owner2.e2e") with each login the
 * directory knows replaced by the person's name. Only whole logins that contain a dot, @ or digit are
 * touched, so ordinary words are never replaced.
 */
export function peopleInText(text: string | null | undefined): string {
  const value = String(text || "")
  if (!value) return value
  seedFromBrowser()
  return value.replace(/[A-Za-z0-9][A-Za-z0-9._%+-]*(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?/g, (token) => {
    const clean = token.replace(/[.]+$/, "")
    if (!/[.@\d]/.test(clean)) return token
    const known = knownPersonName(clean)
    return known ? known + token.slice(clean.length) : token
  })
}

/**
 * The display name for a login: "owner2.e2e@hariom.com" → "Owner two (E2E)".
 * Unknown logins show the part before the @ ("store.maker"); a value that is already a name stays.
 */
export function personLabel(actor: string | null | undefined, fallback = "—"): string {
  const text = String(actor || "").trim()
  if (!text) return fallback
  const known = knownPersonName(text)
  if (known) return known
  if (text.includes("@")) return text.split("@")[0] || fallback
  return text === text.toLowerCase() && /^[a-z]+$/.test(text) ? text[0].toUpperCase() + text.slice(1) : text
}

/** True when this browser already holds the directory from an earlier load (names show on first paint). */
export function hasStoredPeople(): boolean {
  if (typeof window === "undefined") return false
  seedFromBrowser()
  try {
    const rows = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return false
  }
}

/** Subscribe to directory updates (hooks/use-people.ts re-renders on them). */
export function subscribePeople(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function peopleVersion(): number {
  return version
}

/** Keep the directory in this browser until sign-out. */
export function savePeople(rows: PersonRow[]) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)) } catch { /* optional */ }
}

/** Sign-out: a shared phone keeps no list of colleagues. */
export function forgetPeople() {
  names.clear()
  seeded = true
  version += 1
  try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* optional */ }
  listeners.forEach((listener) => listener())
}
