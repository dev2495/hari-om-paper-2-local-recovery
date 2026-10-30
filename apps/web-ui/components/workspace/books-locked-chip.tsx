"use client"

import Link from "next/link"
import { useEffect } from "react"
import { CalendarClock, LockKeyhole, LockKeyholeOpen } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { useBooksState } from "@/hooks/use-production"
import { monthText } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

const short = (key: string) => {
  const text = monthText(key)
  return text ? `${text.slice(0, 3)} ${text.slice(-4)}` : key
}

/**
 * Header chip for closed months (client 2026-10-28). Locked months are exactly the closed ones.
 * Owner, Admin and the plant head go to Month-end close (the oldest month still to close when there is
 * one); Planner and Store go to the stock book, which they can open.
 */
export function BooksLockedChip({ compact }: { compact?: boolean }) {
  const { activePlant, activeRole, user } = useAuth()
  const roles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  const canClose = roles.has("Owner") || roles.has("Admin") || roles.has("PlantManager")
  const canSee = canClose || roles.has("Planner") || roles.has("Store")

  const booksQuery = useBooksState(activePlant || "", canSee && Boolean(activePlant) && activePlant !== "ALL")
  const data = booksQuery.data as
    | { locked_months?: string[]; oldest_open_month?: string | null; locked_by?: string | null; locked_through?: string | null; store_months_known?: boolean | null }
    | undefined
  const unknown = data?.store_months_known === false
  const refetch = booksQuery.refetch
  // The server is still asking the store which months it moved in (after a restart): ask again shortly.
  useEffect(() => {
    if (!unknown) return
    const timer = window.setTimeout(() => void refetch(), 5000)
    return () => window.clearTimeout(timer)
  }, [unknown, refetch, data])
  if (!canSee || !data) return null
  // The store has not said yet which months it moved in (it did not answer, or production just
  // restarted): a store-only month older than any month production knows may be open, so say nothing
  // until it answers, rather than "Books open", the last close, or a later month to close (checker r2:
  // "Sep 2026 to close" for a few seconds while July was the oldest open month).
  if (data.store_months_known === false) return null

  const locked = Array.isArray(data.locked_months) ? data.locked_months : []
  const latest = locked[locked.length - 1]
  const toClose = canClose ? data.oldest_open_month || null : null
  const href = canClose
    ? `/production/reconciliation${toClose ? `?month=${toClose}` : ""}`
    : "/inventory/stock-control?tab=book"

  const tone = toClose ? "amber" : latest ? "emerald" : "muted"
  const Icon = toClose ? CalendarClock : latest ? LockKeyhole : LockKeyholeOpen
  const text = toClose
    ? compact ? `Close ${short(toClose).slice(0, 3)}` : `${short(toClose)} to close`
    : latest
      ? compact ? `${short(latest).slice(0, 3)} closed` : `${short(latest)} closed`
      : "Books open"
  const title = toClose
    ? `${monthText(toClose)} has ended and is still open. Open Month-end close.`
    : latest
      ? `Closed months: ${locked.map(short).join(", ")}. Entries dated in them are refused.`
      : "No month is closed yet."

  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      data-testid="books-locked-chip"
      className={cn(
        "hidden h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold transition xl:inline-flex",
        tone === "amber" && "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink hover:brightness-[0.98]",
        tone === "emerald" && "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink hover:brightness-[0.98]",
        tone === "muted" && "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{text}</span>
    </Link>
  )
}
