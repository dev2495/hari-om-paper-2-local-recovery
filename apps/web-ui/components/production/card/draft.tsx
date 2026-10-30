"use client"

// Floor form drafts kept on the device (client 2026-10-28: "auto draft save at the time of job card filling").
// Every floor form saves what is typed, keyed by card, stage and form, restores it when the form opens again
// with a "Draft restored from 4:52 pm · Discard" bar, and forgets it after a successful save. A draft is never
// sent by itself. It lives in this browser only (localStorage), survives a reload or a closed tab, and is
// dropped after 7 days.

import { History } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { draftTime, readDraft, removeDraft, writeDraft } from "./draft-store"
import { toneClass } from "./model"

export { draftKey, draftKeysFor, draftTime, readDraft, removeDraft, writeDraft, type StoredDraft } from "./draft-store"

const SAVE_DELAY_MS = 300

/**
 * Keeps `value` on the device while `active` (the user has typed something worth keeping).
 * `restore()` reads the stored draft for the current key (call it where the form sets its starting values);
 * `clear()` forgets it after a successful save; `discard()` is the bar's Discard.
 */
export function useFormDraft<T>(key: string | null, value: T, active: boolean) {
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const json = JSON.stringify(value ?? null)
  const latest = useRef({ key, json })
  latest.current = { key, json }
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; key: string; value: T; active: boolean } | null>(null)
  const suspendedJson = useRef<string | null>(null)
  const wasActive = useRef(false)
  const lastKey = useRef<string | null>(null)

  const commit = useCallback((job: { key: string; value: T; active: boolean }) => {
    if (job.active) writeDraft(job.key, job.value)
    else removeDraft(job.key)
  }, [])
  // Write what is still waiting (to the key it was typed under) right now.
  const flush = useCallback(() => {
    const job = pending.current
    if (!job) return
    clearTimeout(job.timer)
    pending.current = null
    commit(job)
  }, [commit])

  // Saves as the user types (declared before the key change below, so the render that brings a new key —
  // whose values still belong to the old one — saves nothing).
  useEffect(() => {
    if (!key || lastKey.current !== key || json === suspendedJson.current) return
    if (active) wasActive.current = true
    else if (!wasActive.current) return
    if (pending.current) clearTimeout(pending.current.timer)
    const job = { key, value, active, timer: setTimeout(() => {
      pending.current = null
      commit(job)
    }, SAVE_DELAY_MS) }
    pending.current = job
    // value is represented by json
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, json, active])

  // A new card / stage / run: the values on screen still belong to the old one until the form resets them,
  // so nothing is saved on this render (the form calls restore() for its starting values).
  useEffect(() => {
    if (lastKey.current === key) return
    flush()
    lastKey.current = key
    suspendedJson.current = null
    wasActive.current = false
    setRestoredAt(null)
  }, [key, flush])

  // Closing the tab, locking the phone or leaving the page writes what is still waiting.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") flush()
    }
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", hidden)
    return () => {
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", hidden)
      flush()
    }
  }, [flush])

  const restore = useCallback((): T | null => {
    const stored = readDraft<T>(latest.current.key)
    if (!stored) return null
    wasActive.current = true
    setRestoredAt(stored.savedAt)
    return stored.value
  }, [])
  const clear = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = null
    suspendedJson.current = latest.current.json
    wasActive.current = false
    removeDraft(latest.current.key)
    setRestoredAt(null)
  }, [])
  return { restoredAt, restore, clear, discard: clear }
}

export function DraftRestoredBar({ savedAt, onDiscard, testId = "draft-restored", className }: { savedAt: number | null; onDiscard: () => void; testId?: string; className?: string }) {
  if (!savedAt) return null
  return (
    // data-no-mirror: the bar is already on the form, so the page-wide status mirror must not repeat it as a toast.
    <div role="status" data-no-mirror className={cn("flex items-center gap-2 rounded-lg border px-3 text-[13px]", toneClass("blue"), className)} data-testid={testId}>
      <History className="h-4 w-4 shrink-0" aria-hidden="true" />
      {/* "Draft" here means only text typed on this device; runs waiting for the supervisor are "with supervisor". */}
      <span className="min-w-0 flex-1 py-1.5">
        Draft restored from <b>{draftTime(savedAt)}</b> · not saved yet
        <span className="hidden sm:inline">, kept on this device only</span>
      </span>
      <button type="button" className="-mr-1 min-h-11 shrink-0 rounded-md px-2 font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2" onClick={onDiscard} data-testid={`${testId}-discard`}>
        Discard
      </button>
    </div>
  )
}
