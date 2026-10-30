"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ChevronRight } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { useAllJobCards } from "@/hooks/use-job-card-rows"
import { useJobCardAggregates } from "@/hooks/use-production"
import { useSalesOrderAggregates } from "@/hooks/use-sales"
import { queueForRoles, type QueueItem } from "@/lib/notifications"
import { canReadJobCardAggregates } from "@/lib/role-matrix"
import { cn } from "@/lib/utils"

const TONE: Record<QueueItem["tone"], string> = {
  rose: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line",
  amber: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line",
  emerald: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line",
  cyan: "bg-signal-cyan-soft text-signal-cyan-ink ring-signal-cyan-line",
  violet: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line",
  blue: "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line",
}

// Totals a floor role's tile can count from the job-card list itself (the rest stay plain links).
const LIST_COUNTED = new Set(["open_cards", "due_priority"])
const CLOSED_CARD = new Set(["COMPLETED", "CANCELLED", "CLOSED"])

/**
 * Live, role-shaped "what is waiting on me" counts. These are server totals from the
 * same aggregate endpoints the module pages use, so the numbers always agree.
 */
export function WorkQueue({ variant = "full", onNavigate }: { variant?: "compact" | "full"; onNavigate?: () => void }) {
  const { user, activeRole } = useAuth()
  const roles = [user?.role, ...(user?.roles || [])].filter(Boolean) as string[]
  const { role, items } = queueForRoles(roles, activeRole)
  // Floor roles (Operator, QC, GRN, RMIssue…) may not read the job-card totals (planning.py aggregates), so the
  // totals are never asked for (no 403). Their tiles count the same job-card list their Job cards page reads
  // instead: open = not completed or cancelled; due = the priority window (operator landing, 30 Oct).
  const jobsCountable = canReadJobCardAggregates(roles)
  const needsSales = items.some((item) => item.source === "sales")
  const needsJobs = jobsCountable && items.some((item) => item.source === "jobs")
  const listFields = jobsCountable ? [] : items.filter((item) => item.source === "jobs" && LIST_COUNTED.has(item.field)).map((item) => item.field)
  const needsOpenList = listFields.includes("open_cards")
  const needsDueList = listFields.includes("due_priority")
  const sales = useSalesOrderAggregates(needsSales)
  const jobs = useJobCardAggregates(needsJobs)
  const openList = useAllJobCards({}, needsOpenList)
  const dueList = useAllJobCards({ due_risk: "PRIORITY" }, needsDueList)
  const listCounts = useMemo(() => {
    const open = (rows: any[] | undefined) => (rows ? rows.filter((row) => !CLOSED_CARD.has(String(row?.status || "").toUpperCase())).length : undefined)
    return { open_cards: open(openList.data?.rows), due_priority: open(dueList.data?.rows) }
  }, [openList.data, dueList.data])
  const sources = { sales: needsSales ? sales.data : undefined, jobs: needsJobs ? jobs.data : listFields.length ? listCounts : undefined }
  const loading = (needsSales && sales.isLoading) || (needsJobs && jobs.isLoading) || (needsOpenList && openList.isLoading) || (needsDueList && dueList.isLoading)
  const countable = (item: QueueItem) => item.source !== "jobs" || jobsCountable || listFields.includes(item.field)

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
                  {!countable(item) ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : loading ? "·" : value ?? "–"}
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
              {countable(item)
                ? <span className="block text-[22px] font-semibold leading-tight tracking-tight tabular-nums">{loading ? <span className="skeleton inline-block h-5 w-10 align-middle" /> : value ?? "–"}</span>
                : <span className="block text-[15px] font-semibold leading-tight tracking-tight text-foreground">Open the list</span>}
              <span className="block text-[11.5px] leading-4 text-muted-foreground">{item.hint}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        )
      })}
    </div>
  )
}
