// Device drafts for the floor forms (client 2026-10-28): plain storage helpers, no React, so they can be
// unit-tested. Drafts live in this browser only (localStorage) and are dropped after 7 days.

// v2 (28 Oct): drafts belong to the signed-in person. A shared floor tablet must never hand one person's
// typed numbers to the next person who signs in, so every key carries the user's id and there is no draft
// at all while nobody is signed in. v1 keys (no user) are removed the first time a draft is read or written.
const PREFIX = "hariom-draft:v2"
const LEGACY_PREFIX = "hariom-draft:v1:"
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type StoredDraft<T> = { value: T; savedAt: number }

let owner: string | null = null
let legacyCleared = false

/** The signed-in person (AuthProvider sets it while rendering, before any form reads a draft). */
export function setDraftOwner(userId: string | null | undefined) {
  owner = userId ? String(userId) : null
}

export function draftOwner() {
  return owner
}

function clearLegacy() {
  if (legacyCleared) return
  legacyCleared = true
  try {
    Object.keys(window.localStorage).filter((k) => k.startsWith(LEGACY_PREFIX)).forEach((k) => window.localStorage.removeItem(k))
  } catch {}
}

/** hariom-draft:v2:<user>:<form>:<card>:<stage>[:<extra>] — null when nobody is signed in. */
export const draftKey = (form: string, cardId: any, stage?: string | null, extra?: string | null) =>
  cardId && owner ? [PREFIX, owner, form, String(cardId), stage || "ALL", ...(extra ? [String(extra)] : [])].join(":") : null

export function readDraft<T>(key: string | null): StoredDraft<T> | null {
  if (!key) return null
  clearLegacy()
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.savedAt !== "number" || !("value" in parsed)) return null
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key)
      return null
    }
    return parsed as StoredDraft<T>
  } catch {
    return null
  }
}

export function writeDraft(key: string | null, value: unknown) {
  if (!key) return
  clearLegacy()
  try {
    const json = JSON.stringify(value)
    const old = readDraft<unknown>(key)
    // Same values as stored: keep the original time, so "restored from" says when it was really typed.
    if (old && JSON.stringify(old.value) === json) return
    window.localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }))
  } catch {}
}

export function removeDraft(key: string | null) {
  if (!key) return
  try {
    window.localStorage.removeItem(key)
  } catch {}
}

/** Every draft of one card for a form (all stages), e.g. to drop the old form's drafts at once. */
export function draftKeysFor(form: string, cardId: any): string[] {
  if (!owner || !cardId) return []
  const start = `${PREFIX}:${owner}:${form}:${String(cardId)}:`
  try {
    return Object.keys(window.localStorage).filter((k) => k.startsWith(start))
  } catch {
    return []
  }
}

/** "4:52 pm" today, "27 Oct, 4:52 pm" on another day. */
export function draftTime(savedAt: number) {
  const at = new Date(savedAt)
  const time = at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
  return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`
}
