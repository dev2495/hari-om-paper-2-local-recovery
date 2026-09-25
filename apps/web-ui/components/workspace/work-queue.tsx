"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { useJobCardAggregates } from "@/hooks/use-production"
import { useSalesOrderAggregates } from "@/hooks/use-sales"
import { queueForRoles, type QueueItem } from "@/lib/notifications"
import { cn } from "@/lib/utils"

const TONE: Record<QueueItem["tone"], string> = {
  rose: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line",
  amber: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line",
  emerald: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line",
  cyan: "bg-signal-cyan-soft text-signal-cyan-ink ring-signal-cyan-line",
  violet: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line",
  blue: "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line",
}

/**
 * Live, role-shaped "what is waiting on me" counts. These are server totals from the
 * same aggregate endpoints the module pages use, so the numbers always agree.
 */
export function WorkQueue({ variant = "full", onNavigate }: { variant?: "compact" | "full"; onNavigate?: () => void }) {
  const { user, activeRole } = useAuth()
  const roles = [user?.role, ...(user?.roles || [])].filter(Boolean) as string[]
  const { role, items } = queueForRoles(roles, activeRole)
  const needsSales = items.some((item) => item.source === "sales")
  const needsJobs = items.some((item) => item.source === "jobs")
  const sales = useSalesOrderAggregates()
  const jobs = useJobCardAggregates(needsJobs)
  const sources = { sales: needsSales ? sales.data : undefined, jobs: jobs.data }
  const loading = (needsSales && sales.isLoading) || (needsJobs && jobs.isLoading)

  const valueFor = (item: QueueItem) => {
    const source = sources[item.source] as Record<string, unknown> | undefined
    const value = Number(source?.[item.field])
    return Number.isFinite(value) ? value : null
  }

  if (variant === "compact") {
    return (
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Waiting on you · {role.replace(/([a-z])([A-Z])/g, "$1 $2")}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {items.slice(0, 4).map((item) => {
            const value = valueFor(item)
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={onNavigate}
                className="group flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 transition hover:border-input hover:bg-muted"
              >
                <span className={cn("grid h-6 min-w-6 place-items-center rounded-md px-1 text-[11.5px] font-bold tabular-nums ring-1 ring-inset", value ? TONE[item.tone] : "bg-muted text-muted-foreground ring-border")}>
                  {loading ? "·" : value ?? "–"}
                </span>
                <span className="min-w-0 truncate text-[12px] font-medium text-foreground/90">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="stagger grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const value = valueFor(item)
        const Icon = item.icon
        return (
          <Link key={item.id} href={item.href} className="tube-kpi group flex items-center gap-3 !p-3.5 hover:border-primary/30">
            <span className={cn("tube-kpi-icon ring-1 ring-inset", TONE[item.tone])}><Icon aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-muted-foreground">{item.label}</span>
              <span className="block text-[22px] font-semibold leading-tight tracking-tight tabular-nums">{loading ? <span className="skeleton inline-block h-5 w-10 align-middle" /> : value ?? "–"}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{item.hint}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        )
      })}
    </div>
  )
}
