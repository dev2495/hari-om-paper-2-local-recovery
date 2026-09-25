"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Factory,
  Package,
  RefreshCw,
  ShieldCheck,
  Truck,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { useAuth } from "@/context/AuthContext"
import { analyticsApi } from "@/lib/api"
import { jobCardRef } from "@/lib/job-card-display"
import { displayPlantScope } from "@/lib/plant-scope"
import { cn } from "@/lib/utils"

type OwnerIntelligenceSuiteProps = {
  mode?: "dashboard" | "report"
  className?: string
}

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const formatNumber = (value: unknown, digits = 0) => numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: digits })
const formatKg = (value: unknown) => `${formatNumber(value, 2)} kg`
const formatPct = (value: unknown) => `${formatNumber(value, 2)}%`
const formatCurrency = (value: unknown) => `₹${formatNumber(value, 0)}`

function normalizeStagePipeline(value: any) {
  if (Array.isArray(value)) {
    return value.map((row) => ({
      stage: row.stage_type || row.stage || "UNKNOWN",
      count: numberValue(row.count ?? row.value),
    }))
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([stage, count]) => ({ stage, count: numberValue(count) }))
  }
  return []
}

function seriesTotals(series: any[]) {
  return (series || []).map((row) => ({
    bucket: row.bucket || row.date || row.label || "-",
    Winder: numberValue(row.winder_qty),
    Oven: numberValue(row.oven_qty),
    Process: numberValue(row.process_qty),
    Pack: numberValue(row.packing_qty),
    Dispatch: numberValue(row.dispatch_qty),
  }))
}

function KpiCard({
  label,
  value,
  detail,
  tone = "slate",
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  tone?: "slate" | "cyan" | "amber" | "emerald" | "rose"
  icon: any
}) {
  const toneClass = {
    slate: "border-border bg-card text-foreground",
    cyan: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
    amber: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    emerald: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    rose: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
  }[tone]
  return (
    <div className={cn("rounded-[1.6rem] border px-5 py-4 shadow-[0_16px_45px_rgba(15,23,42,0.06)]", toneClass)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] font-semibold opacity-60">{label}</p>
        <Icon className="h-4 w-4 opacity-60" />
      </div>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-sm leading-5 opacity-70">{detail}</p>
    </div>
  )
}

function SectionShell({
  title,
  eyebrow,
  children,
  className,
}: {
  title: string
  eyebrow: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)]", className)}>
      <p className="text-[11.5px] font-semibold text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-black tracking-tight text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function OwnerIntelligenceSuite({ mode = "dashboard", className }: OwnerIntelligenceSuiteProps) {
  const { activePlant, user } = useAuth()
  const [startDate, setStartDate] = useState(daysAgo(29))
  const [endDate, setEndDate] = useState(today())
  const plantScope = activePlant || undefined
  const plantScopeLabel = displayPlantScope(plantScope, "Plant not selected")
  const userRoles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean))
  const canUseGlobal = userRoles.has("Owner") || userRoles.has("Admin")

  const query = useQuery({
    queryKey: ["owner-intelligence-suite", plantScope, startDate, endDate],
    queryFn: async () => {
      const { data } = await analyticsApi.getOwnerPack({
        start_date: startDate,
        end_date: endDate,
        granularity: "day",
        plant: plantScope,
      })
      return data
    },
    enabled: Boolean(startDate && endDate),
  })

  const pack = query.data || {}
  const headline = pack.headline || {}
  const production = pack.production || {}
  const sales = pack.sales || {}
  const quality = pack.quality || {}
  const dispatch = pack.dispatch || {}
  const inventory = pack.inventory || {}
  const exceptions = pack.exceptions || {}
  const plantCompare = Array.isArray(pack.plant_compare) ? pack.plant_compare : []
  const trendRows = useMemo(() => seriesTotals(Array.isArray(production.series) ? production.series : []).slice(-14), [production.series])
  const stageRows = normalizeStagePipeline(production.stage_pipeline)
  const delayedRows = Array.isArray(sales.delayed_rows) ? sales.delayed_rows : []
  const blockedRows = Array.isArray(production.blocked_rows) ? production.blocked_rows : []
  const lowStock = Array.isArray(inventory?.risk_items?.low_stock) ? inventory.risk_items.low_stock : []
  const holdRows = Array.isArray(exceptions.active_holds) ? exceptions.active_holds : []

  return (
    <div className={cn("space-y-5", className)} data-testid="owner-intelligence-suite">
      <section className="relative overflow-hidden rounded-xl border border-border bg-[#07111f] px-6 py-6 text-white shadow-[0_24px_90px_rgba(15,23,42,0.20)]">
        <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-card lg:block" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[12px] font-semibold text-muted-foreground">Owner Intelligence</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Live company health, WIP, variance, and exceptions.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              This reads the same owner-pack service used for reports: sales backlog, production stages, dispatch readiness, inventory risk, quality holds, and plant comparison.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-[11.5px] font-semibold text-muted-foreground">
              From
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 h-10 rounded-2xl border border-border/15 bg-card/10 px-3 text-sm text-white outline-none" />
            </label>
            <label className="text-[11.5px] font-semibold text-muted-foreground">
              To
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-2 h-10 rounded-2xl border border-border/15 bg-card/10 px-3 text-sm text-white outline-none" />
            </label>
            <div className="rounded-2xl border border-border/10 bg-card/10 px-4 py-3">
              <p className="text-[11.5px] font-semibold text-muted-foreground">Scope</p>
              <p className="mt-2 text-sm font-black">{plantScopeLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">{canUseGlobal ? "Owner/Admin can use Global Analytics" : "Plant-isolated view"}</p>
            </div>
          </div>
        </div>
      </section>

      {query.isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-sm font-semibold text-muted-foreground">Loading owner intelligence...</div>
      ) : query.isError ? (
        <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-8 text-sm font-semibold text-signal-rose-ink">Unable to load analytics owner pack. Check analytics-service and BFF health.</div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Active jobs" value={formatNumber(headline.active_job_cards)} detail="Released work not yet closed" tone="cyan" icon={Factory} />
            <KpiCard label="Sales backlog" value={formatNumber(headline.backlog_orders)} detail="Open release or dispatch demand" tone="amber" icon={ClipboardCheck} />
            <KpiCard label="Dispatch qty" value={formatKg(headline.dispatch_qty)} detail="Dispatched in selected window" tone="emerald" icon={Truck} />
            <KpiCard label="Blocked jobs" value={formatNumber(headline.blocked_jobs)} detail="Planner/quality intervention needed" tone={numberValue(headline.blocked_jobs) ? "rose" : "slate"} icon={AlertTriangle} />
            <KpiCard label="Inventory value" value={formatCurrency(headline.inventory_value)} detail="RM + WIP + FG valuation" icon={Package} />
            <KpiCard label="Low stock" value={formatNumber(headline.low_stock_items)} detail="Items at reorder risk" tone={numberValue(headline.low_stock_items) ? "amber" : "slate"} icon={Package} />
            <KpiCard label="QC holds" value={formatNumber(headline.active_qc_holds)} detail="Active quality holds" tone={numberValue(headline.active_qc_holds) ? "rose" : "slate"} icon={ShieldCheck} />
            <KpiCard label="OTIF" value={formatPct(headline.otif_percent)} detail="On-time in-full closed orders" icon={BarChart3} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <SectionShell title="Stage throughput trend" eyebrow="Production">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendRows}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid hsl(var(--chart-grid))" }} />
                    <Bar dataKey="Winder" stackId="a" fill="hsl(var(--chart-8))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Oven" stackId="a" fill="hsl(var(--chart-6))" />
                    <Bar dataKey="Process" stackId="a" fill="hsl(var(--chart-1))" />
                    <Bar dataKey="Pack" stackId="a" fill="hsl(var(--muted-foreground))" />
                    <Bar dataKey="Dispatch" stackId="a" fill="hsl(var(--chart-7))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionShell>

            <SectionShell title="Live WIP by stage" eyebrow="Tracker">
              <div className="space-y-3">
                {stageRows.length ? stageRows.map((row) => (
                  <div key={row.stage} className="rounded-2xl border border-border bg-muted px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-muted-foreground">{row.stage}</span>
                      <span className="text-xl font-black text-foreground">{formatNumber(row.count)}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-foreground" style={{ width: `${Math.min(100, row.count * 8)}%` }} />
                    </div>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No active WIP rows in the selected window.</p>}
              </div>
            </SectionShell>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <SectionShell title="Exception queue" eyebrow="Action">
              <div className="space-y-3 text-sm">
                {[
                  ["Delayed orders", sales.summary?.delayed_orders, "/reports/sales"],
                  ["Blocked jobs", production.summary?.blocked_jobs, "/reports/production"],
                  ["Low-stock items", inventory.summary?.low_stock_count, "/reports/inventory"],
                  ["QC holds", quality.summary?.active_holds, "/reports/quality"],
                ].map(([label, value, href]) => (
                  <Link key={String(label)} href={String(href)} className="flex items-center justify-between rounded-2xl border border-border px-4 py-3 font-semibold text-muted-foreground hover:bg-muted">
                    <span>{label}</span>
                    <span className={numberValue(value) ? "text-signal-rose-ink" : "text-signal-emerald-ink"}>{formatNumber(value)}</span>
                  </Link>
                ))}
              </div>
            </SectionShell>

            <SectionShell title="Commercial pressure" eyebrow="Sales">
              <div className="space-y-3">
                {delayedRows.slice(0, 5).map((row: any) => (
                  <div key={row.order_id || row.order_no} className="rounded-2xl border border-border bg-muted px-4 py-3">
                    <p className="text-sm font-black text-foreground">{row.order_no || String(row.order_id).slice(0, 8)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{row.customer_name || "-"} · due {row.due_date || "-"}</p>
                  </div>
                ))}
                {!delayedRows.length ? <p className="text-sm text-muted-foreground">No delayed orders in the selected window.</p> : null}
              </div>
            </SectionShell>

            <SectionShell title="Rejection and variance trail" eyebrow="Quality">
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Rejections are tracked at stage entry as reject quantity plus reason; month close explains remaining variance against actual stock.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                    <p className="text-[11.5px] font-semibold text-muted-foreground">Checked</p>
                    <p className="mt-2 text-2xl font-black text-foreground">{formatNumber(quality.summary?.checked)}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted px-4 py-3">
                    <p className="text-[11.5px] font-semibold text-muted-foreground">Compliance</p>
                    <p className="mt-2 text-2xl font-black text-foreground">{formatPct(quality.summary?.compliance_percent)}</p>
                  </div>
                </div>
                {holdRows.slice(0, 3).map((row: any) => (
                  <div key={row.id || row.job_card_id} className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft px-4 py-3 text-signal-rose-ink">
                    Hold: {jobCardRef(row)} · {row.reason || row.status || "-"}
                  </div>
                ))}
              </div>
            </SectionShell>
          </section>

          {mode === "report" ? (
            <section className="grid gap-4 xl:grid-cols-2">
              <SectionShell title="Inventory risk list" eyebrow="Stock">
                <div className="overflow-hidden rounded-2xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[hsl(var(--surface-2))] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3 text-[11.5px]">Item</th>
                        <th className="px-3 py-3 text-right text-[11.5px]">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStock.slice(0, 8).map((row: any) => (
                        <tr key={row.id || row.item_code} className="border-t border-border">
                          <td className="px-3 py-3 font-semibold">{row.name || row.item_name || row.item_code}</td>
                          <td className="px-3 py-3 text-right">{formatKg(row.available_qty ?? row.current_stock)}</td>
                        </tr>
                      ))}
                      {!lowStock.length ? <tr><td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">No low-stock risks.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </SectionShell>

              <SectionShell title="Plant comparison" eyebrow="Owner">
                <div className="space-y-3">
                  {plantCompare.map((row: any) => (
                    <div key={row.plant_id} className="rounded-2xl border border-border bg-muted px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-black text-foreground">{row.plant_name || row.plant_code}</p>
                        <p className="text-sm font-black text-muted-foreground">{formatNumber(row.job_cards)} cards</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Ready jobs {formatNumber(row.ready_job_count)} · delayed orders {formatNumber(row.delayed_orders)} · blocked qty {formatKg(row.blocked_qty)}</p>
                    </div>
                  ))}
                  {!plantCompare.length ? <p className="text-sm text-muted-foreground">Plant comparison needs Global Analytics scope.</p> : null}
                </div>
              </SectionShell>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
