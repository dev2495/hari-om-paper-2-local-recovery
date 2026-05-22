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
  if (!data) return null

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
        "hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] shadow-sm transition lg:inline-flex",
        locked
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
      )}
    >
      {locked ? <LockKeyhole className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
      {compact ? (
        <span>{locked ? `Lk ${lockedThrough}` : "Open"}</span>
      ) : (
        <span>{locked ? `Books lk ${lockedThrough}` : `Books open · ${data.current_month_status}`}</span>
      )}
    </Link>
  )
}
