"use client"

import Link from "next/link"
import { LockKeyhole, Pencil } from "lucide-react"
import dayjs from "dayjs"

import { useAuth } from "@/context/AuthContext"
import { useBooksState } from "@/hooks/use-production"
import { cn } from "@/lib/utils"

export function BooksLockedChip({ compact }: { compact?: boolean }) {
  const { activePlant, user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const canSee = roles.has("Owner") || roles.has("Admin") || roles.has("PlantManager") || roles.has("Planner") || roles.has("Store")

  const booksQuery = useBooksState(activePlant || "", canSee && Boolean(activePlant) && activePlant !== "ALL")
  const data = booksQuery.data
  if (!data || (!data.locked_through && !data.current_month_status)) return null

  const locked = Boolean(data.locked_through)
  const lockedThrough = locked ? dayjs(data.locked_through as string).format("DD MMM YYYY") : null

  return (
    <Link
      href="/production/reconciliation"
      title={
        locked
          ? `Books locked through ${lockedThrough}${data.locked_by ? ` · ${data.locked_by}` : ""}`
          : "Current month is open — click to open reconciliation"
      }
      className={cn(
        "hidden shrink-0 items-center gap-1.5 whitespace-nowrap h-10 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition xl:inline-flex",
        locked
          ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink hover:bg-signal-emerald-soft"
          : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink hover:bg-signal-amber-soft",
      )}
    >
      {locked ? <LockKeyhole className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
      {compact ? (
        <span>{locked ? `Closed ${dayjs(data.locked_through as string).format("DD MMM")}` : "Open"}</span>
      ) : (
        <span>{locked ? `Books lk ${lockedThrough}` : `Books open · ${data.current_month_status}`}</span>
      )}
    </Link>
  )
}
