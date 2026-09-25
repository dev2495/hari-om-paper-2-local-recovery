"use client"

import { type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { useAuth } from "@/context/AuthContext"
import { PageHeader } from "@/components/workspace/page-header"
import { cn } from "@/lib/utils"


export const fieldClass = "h-9 w-full rounded-lg border border-input bg-card px-3 text-[13px] text-foreground shadow-[var(--shadow-xs)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/20 focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15 disabled:bg-muted disabled:text-muted-foreground"
export const areaClass = "w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] text-foreground shadow-[var(--shadow-xs)] outline-none transition-[border-color,box-shadow] duration-150 focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15"
export const primaryButton = "erp-btn-primary"
export const secondaryButton = "erp-btn-secondary"

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-end justify-between gap-2 text-[12.5px] font-medium text-foreground/80">
        {label}{hint ? <span className="text-[11.5px] font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

export function ProcurementShell({ title, eyebrow, description, actions, children }: {
  title: string; eyebrow: string; description: string; actions?: ReactNode; children: ReactNode
}) {
  const { activePlant } = useAuth()
  return (
    <div className="min-w-0 space-y-5" data-testid="procurement-workspace">
      <PageHeader title={title} description={description} actions={activePlant && activePlant !== "ALL" ? actions : null} />
      {!activePlant || activePlant === "ALL" ? <MessageBar tone="info">Choose one plant using the plant selector above to work with purchase orders, receipts, schedules and costing.</MessageBar> : null}
      {activePlant && activePlant !== "ALL" ? children : null}
    </div>
  )
}

export function SummaryCard({ label, value, detail, icon: Icon, tone = "cyan" }: {
  label: string; value: ReactNode; detail: string; icon: LucideIcon; tone?: "cyan" | "amber" | "emerald" | "slate" | "rose"
}) {
  const tones = {
    cyan: "bg-signal-cyan-soft text-signal-cyan-ink ring-signal-cyan-line", amber: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line",
    emerald: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line", slate: "bg-muted text-muted-foreground ring-border", rose: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line",
  }
  return (
    <article className="tube-kpi">
      <div className="flex items-start justify-between gap-3">
        <div><p className="tube-kpi-label">{label}</p><p className="tube-kpi-value">{value}</p></div>
        <span className={cn("tube-kpi-icon ring-1 ring-inset", tones[tone])}><Icon aria-hidden="true" /></span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </article>
  )
}

export function WorkPanel({ title, description, action, children, className }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={cn("erp-panel min-w-0 rounded-xl p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>{description ? <p className="mt-0.5 max-w-3xl text-[12.5px] leading-5 text-muted-foreground">{description}</p> : null}</div>
        {action ? <div className="flex max-w-full flex-wrap gap-2 [&>div]:flex-wrap [&>*]:max-w-full">{action}</div> : null}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  )
}

export function QuantityLotStrip({ ordered, received, open, lots, expectedLots, label = "Paper line" }: {
  ordered: string; received: string; open: string; lots: number; expectedLots?: number | null; label?: string
}) {
  const showPlan = expectedLots !== null && expectedLots !== undefined
  return (
    <div className="grid overflow-hidden rounded-xl border border-signal-cyan-line bg-signal-cyan-soft/60 sm:grid-cols-4">
      {[{ k: label, v: ordered }, { k: "Received", v: received },
        { k: "Open to receive", v: open },
        { k: showPlan ? "Lots actual / plan" : "Physical lots", v: showPlan ? `${lots} / ${expectedLots}` : String(lots) }].map((item, index) => (
        <div key={item.k} className={cn("px-4 py-3", index > 0 && "border-t border-signal-cyan-line sm:border-l sm:border-t-0")}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-cyan-ink/70">{item.k}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{item.v}</p>
        </div>
      ))}
    </div>
  )
}

export function MessageBar({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  const classes = tone === "success" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
    : tone === "error" ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink"
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm leading-6", classes)}>{children}</div>
}

export function StateBadge({ value }: { value: string | null | undefined }) {
  const state = String(value || "UNKNOWN").toUpperCase()
  const good = ["APPROVED", "ACTIVE", "CLEAR", "RECEIVED", "SETTLED", "RECOVERED", "PASS"].includes(state)
  const bad = ["REJECTED", "BLOCKED", "CRITICAL", "VOID"].includes(state)
  return <span className={cn("inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]",
    good ? "bg-signal-emerald-soft text-signal-emerald-ink" : bad ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-signal-amber-soft text-signal-amber-ink")}>{state.replaceAll("_", " ")}</span>
}

export function RequestErrors({ errors }: { errors: unknown[] }) {
  const messages = errors.filter(Boolean).map((error: any) => {
    const detail = error?.response?.data?.detail
    return typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((row: any) => `${(row.loc || []).filter((part: any) => part !== "body").join(" / ")}: ${row.msg}`).join("; ") : error?.message || "The request failed. Review the details and retry."
  })
  return messages.length ? <MessageBar tone="error">{Array.from(new Set(messages)).join(" · ")}</MessageBar> : null
}
