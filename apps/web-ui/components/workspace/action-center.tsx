"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileWarning,
  PackageSearch,
  PauseCircle,
  ReceiptText,
  ShieldAlert,
  ShoppingCart,
  TimerOff,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { useAuth } from "@/context/AuthContext"
import { useJobCardAggregates, usePlanningJobCards } from "@/hooks/use-production"
import { useSalesOrderAggregates, useSalesOrders } from "@/hooks/use-sales"
import { purchaseApi } from "@/lib/api"
import { jobCardRef } from "@/lib/job-card-display"
import { cn } from "@/lib/utils"

type Tone = "rose" | "amber" | "primary" | "emerald"
type Row = { id: string; title: string; detail: string; href: string; meta?: string }

const TONE: Record<Tone, string> = {
  rose: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line",
  amber: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line",
  primary: "bg-accent text-accent-foreground ring-primary/20",
  emerald: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line",
}

function Lane({ title, icon: Icon, tone, count, loading, rows, href, cta, empty, note }: {
  title: string; icon: LucideIcon; tone: Tone; count: number | null; loading?: boolean; rows: Row[]; href: string; cta: string; empty: string; note?: ReactNode
}) {
  const done = !loading && count === 0
  return (
    <section className="erp-panel flex min-w-0 flex-col rounded-xl">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className={cn("tube-kpi-icon ring-1 ring-inset", done ? TONE.emerald : TONE[tone])}>{done ? <CheckCircle2 aria-hidden="true" /> : <Icon aria-hidden="true" />}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold">{title}</h3>
          <p className="text-[12px] text-muted-foreground">{loading ? "Checking…" : count === null ? "Select a plant to see this queue" : done ? "Nothing waiting" : `${count} waiting`}</p>
        </div>
        {count ? <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums ring-1 ring-inset", TONE[tone])}>{count}</span> : null}
      </header>
      <div className="flex-1 divide-y divide-border">
        {loading ? <div className="space-y-2 p-3">{[0, 1].map((n) => <div key={n} className="skeleton h-9" />)}</div> : null}
        {!loading && rows.length === 0 ? <p className="px-4 py-5 text-[12.5px] text-muted-foreground">{count === null ? note || empty : empty}</p> : null}
        {!loading && rows.slice(0, 4).map((row) => (
          <Link key={row.id} href={row.href} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-foreground/[.025]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground group-hover:text-primary">{row.title}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{row.detail}</span>
            </span>
            {row.meta ? <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{row.meta}</span> : null}
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
          </Link>
        ))}
      </div>
      <footer className="border-t border-border px-4 py-2.5">
        <Link href={href} className="group inline-flex items-center gap-1 text-[12.5px] font-medium text-primary">{cta}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link>
      </footer>
    </section>
  )
}

/**
 * Owner action center: every queue that needs a decision from the owner or the
 * desks they supervise, from the same endpoints those desks use.
 */
export function ActionCenter() {
  const { activePlant } = useAuth()
  const concrete = Boolean(activePlant && activePlant !== "ALL")
  const month = dayjs().format("YYYY-MM")
  const salesAgg = useSalesOrderAggregates()
  const jobsAgg = useJobCardAggregates()
  const drafts = useSalesOrders({ status: "submitted", limit: 6, offset: 0 })
  const draftOnly = useSalesOrders({ status: "draft", limit: 6, offset: 0 })
  const jobs = usePlanningJobCards({ limit: 250 })
  const poQuery = useQuery({ queryKey: ["action-center", "po-approvals", activePlant], enabled: concrete, queryFn: () => purchaseApi.getOrders({ status: "SUBMITTED", limit: 20 }) })
  const planQuery = useQuery({ queryKey: ["action-center", "plans", activePlant, month], enabled: concrete, queryFn: () => purchaseApi.getPlans({ month: `${month}-01` }) })
  const diffQuery = useQuery({ queryKey: ["action-center", "discrepancies", activePlant], enabled: concrete, queryFn: () => purchaseApi.getDiscrepancies() })
  const receiptsQuery = useQuery({ queryKey: ["action-center", "invoice-pending", activePlant], enabled: concrete, queryFn: () => purchaseApi.getGovernedReceipts({ invoice_pending: true, limit: 20, offset: 0 }) })
  const alertsQuery = useQuery({ queryKey: ["action-center", "stock-alerts", activePlant], enabled: concrete, queryFn: () => purchaseApi.getStockAlerts() })

  const salesRows: Row[] = [...(Array.isArray(drafts.data) ? drafts.data : []), ...(Array.isArray(draftOnly.data) ? draftOnly.data : [])].map((order: any) => ({
    id: String(order.id),
    title: order.po_number || order.order_no,
    detail: `${order.customer_name || "Customer"} · ${String(order.status).toLowerCase()}`,
    href: `/sales-orders/${order.id}`,
    meta: `${Number((order.lines || []).reduce((sum: number, line: any) => sum + Number(line.qty || 0), 0)).toLocaleString("en-IN")} pcs`,
  }))
  const poRows: Row[] = ((poQuery.data?.data?.items || []) as any[]).filter((row) => row.status === "SUBMITTED").map((row) => ({
    id: String(row.id), title: row.po_no, detail: `${row.supplier_name || "Supplier"} · revision ${row.current_revision_no ?? "—"}`, href: "/purchase/approvals",
    meta: row.total_amount ? `₹${Number(row.total_amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : undefined,
  }))
  const plans = (planQuery.data?.data?.items || []) as any[]
  const plan = plans[0]
  const planRows: Row[] = !concrete ? [] : !plan
    ? [{ id: "no-plan", title: `No RM plan for ${dayjs().format("MMMM")}`, detail: "Create the month's paper arrival plan", href: "/purchase/scheduler" }]
    : plan.status === "APPROVED" || plan.status === "LOCKED"
      ? []
      : [{ id: plan.id, title: plan.name, detail: plan.status === "SUBMITTED" ? "Submitted — waiting for your approval" : `Status ${String(plan.status).toLowerCase()} · v${plan.version}`, href: "/purchase/scheduler" }]
  const diffRows: Row[] = ((diffQuery.data?.data?.items || []) as any[]).filter((row) => ["OPEN", "UNDER_REVIEW"].includes(row.status)).map((row) => ({
    id: String(row.id), title: `${row.po_no} · ${row.item_code}`, detail: `${row.supplier_name} · ${row.type.toLowerCase()} difference`, href: "/purchase/discrepancies",
    meta: row.type === "RATE" ? `₹${Number(row.signed_amount || 0).toLocaleString("en-IN")}` : undefined,
  }))
  const receiptRows: Row[] = ((receiptsQuery.data?.data?.items || []) as any[]).map((row) => ({
    id: String(row.id), title: row.grn_no || "GRN", detail: `${row.supplier_name || "Supplier"} · invoice pending`, href: `/purchase/receipts?receipt=${row.id}`,
    meta: row.received_date ? dayjs(row.received_date).format("D MMM") : undefined,
  }))
  const alertRows: Row[] = ((alertsQuery.data?.data?.items || []) as any[]).filter((row) => row.status !== "RECOVERED").map((row) => ({
    id: String(row.id), title: `${row.item_code} · ${row.item_name}`, detail: `${Number(row.stock_qty_kg || 0).toLocaleString("en-IN")} kg free vs ${Number(row.threshold_qty_kg || 0).toLocaleString("en-IN")} kg threshold`, href: "/inventory/stock-alerts",
    meta: String(row.severity || "").toLowerCase(),
  }))
  const jobRows: Row[] = ((Array.isArray(jobs.data) ? jobs.data : []) as any[])
    .filter((job) => job.planner_gate_ready === false || job.blocked_reason || job.due_risk_bucket === "OVERDUE")
    .map((job) => ({ id: String(job.id), title: jobCardRef(job), detail: job.blocked_reason || job.planner_gate_reason || "Overdue", href: `/production/job-cards/${job.id}`, meta: job.due_date ? dayjs(job.due_date).format("D MMM") : undefined }))

  const plantNote = <>Purchase queues are per plant. <span className="font-medium text-foreground">Pick a plant</span> in the top bar to see them.</>
  const draftCount = Number(salesAgg.data?.draft_count ?? salesRows.length)
  const expired = Number(salesAgg.data?.expired_open_count || 0)

  return (
    <div className="space-y-4" data-testid="owner-action-center">
      <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Lane title="Sales orders to approve" icon={ClipboardCheck} tone="amber" count={draftCount} loading={salesAgg.isLoading} rows={salesRows} href="/sales-orders?status=draft" cta="Open sales orders" empty="No drafts or submitted orders." />
        <Lane title="Purchase orders to approve" icon={ShoppingCart} tone="amber" count={concrete ? poRows.length : null} loading={concrete && poQuery.isLoading} rows={poRows} href="/purchase/approvals" cta="Open PO approvals" empty="No PO revisions waiting." note={plantNote} />
        <Lane title={`RM purchase plan · ${dayjs().format("MMM")}`} icon={CalendarRange} tone="primary" count={concrete ? planRows.length : null} loading={concrete && planQuery.isLoading} rows={planRows} href="/purchase/scheduler" cta="Open purchase planner" empty="This month's plan is approved." note={plantNote} />
        <Lane title="Blocked & overdue job cards" icon={Factory} tone="rose" count={jobRows.length} loading={jobs.isLoading} rows={jobRows} href="/production/job-cards" cta="Open job cards" empty="Every open card is ready for the floor." />
        <Lane title="Quality holds" icon={ShieldAlert} tone="rose" count={Number(jobsAgg.data?.qc_holds ?? 0)} loading={jobsAgg.isLoading} rows={[]} href="/quality/results" cta="Open results & holds" empty={Number(jobsAgg.data?.qc_holds ?? 0) ? "Open the results desk to decide each hold." : "No open holds."} />
        <Lane title="Invoice differences" icon={FileWarning} tone="amber" count={concrete ? diffRows.length : null} loading={concrete && diffQuery.isLoading} rows={diffRows} href="/purchase/discrepancies" cta="Open invoice differences" empty="No rate or quantity differences open." note={plantNote} />
        <Lane title="GRNs waiting for invoice" icon={ReceiptText} tone="primary" count={concrete ? receiptRows.length : null} loading={concrete && receiptsQuery.isLoading} rows={receiptRows} href="/purchase/receipts" cta="Open GRN register" empty="Every receipt has its invoice." note={plantNote} />
        <Lane title="Stock alerts" icon={PackageSearch} tone="amber" count={concrete ? alertRows.length : null} loading={concrete && alertsQuery.isLoading} rows={alertRows} href="/inventory/stock-alerts" cta="Open stock alerts" empty="All materials above their thresholds." note={plantNote} />
        <Lane title="Expired sales orders" icon={expired ? TimerOff : PauseCircle} tone="rose" count={expired} loading={salesAgg.isLoading} rows={[]} href="/sales-orders?status=all" cta="Review in sales orders" empty={expired ? `${expired} open orders passed their expiry — hold & close or extend them.` : "No open order past its expiry date."} />
      </div>
      {!concrete ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-[12.5px] text-muted-foreground"><AlertTriangle className="h-4 w-4 text-signal-amber-ink" />You&apos;re viewing all plants. Purchase queues need one plant — pick it from the plant selector.</p>
      ) : null}
    </div>
  )
}
