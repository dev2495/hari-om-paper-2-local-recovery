"use client"

import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  DrillLink,
  KpiRail,
  MiniLadder,
  NoteCallout,
  Panel,
  ParetoChart,
  Pill,
  ReportFilterBar,
  ReportHero,
  FilterField,
  Waterfall,
  formatCurrency,
  formatNumber,
  formatPct,
} from "@/components/reports/primitives"
import { useAuth } from "@/context/AuthContext"
import { useOwnerPack, useSalesReport } from "@/hooks/use-analytics"

export default function OwnerReportsPage() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <OwnerPackPage />
    </RoleGate>
  )
}

function OwnerPackPage() {
  const { activePlant } = useAuth()
  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const { data: pack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: salesReport } = useSalesReport({ startDate, endDate: today, plant: activePlant || undefined, granularity: "day" })

  const p: any = pack || {}
  const headline = p.headline || {}
  const sales = p.sales || {}
  const production = p.production || {}
  const reconciliation = p.reconciliation || {}

  const dispatchSeries = useMemo(() => {
    const raw = (production?.series || []) as any[]
    return raw.map((row: any, i: number) => ({
      label: row.bucket || row.date || row.label || `D${i + 1}`,
      dispatch: Number(row.dispatch_qty || 0),
      target: Number(row.dispatch_target_qty || 0) || undefined,
    }))
  }, [production?.series])

  const blockedRows = Array.isArray(production.blocked_rows) ? production.blocked_rows : []
  const delayedRows = Array.isArray(sales.delayed_rows) ? sales.delayed_rows : []
  const topCustomers = Array.isArray(sales.top_customers) ? sales.top_customers : []

  const otifValue = Number(headline.otif_percent || sales.summary?.otif_percent || 0)
  const dispatchValue = Number(headline.dispatch_value || 0)
  const backlogValue = Number(headline.backlog_value || salesReport?.summary?.backlog_orders || 0)
  const blockedCount = Number(headline.blocked_jobs || blockedRows.length || 0)
  const varianceValue = Number(reconciliation.summary?.variance_value || 0)
  const inventoryValue = Number(headline.inventory_value || 0)

  // Variance mini-waterfall: theoretical -> ledger -> actual
  const recBars = [
    { label: "Theoretical", value: Number(reconciliation.summary?.theoretical_kg || 0), total: true, tone: "anchor" as const },
    { label: "Over-issue", value: -Number(reconciliation.summary?.over_issue_kg || 0), tone: "negative" as const },
    { label: "Recovery", value: Number(reconciliation.summary?.recovery_kg || 0), tone: "positive" as const },
    { label: "Scrap", value: -Number(reconciliation.summary?.scrap_kg || 0), tone: "negative" as const },
    { label: "Actual", value: Number(reconciliation.summary?.actual_kg || 0), total: true, tone: "anchor" as const },
  ].filter((b) => Math.abs(b.value) > 0 || b.total)

  const standupQuestions = [
    blockedCount
      ? {
          title: `Why are ${blockedCount} jobs blocked?`,
          detail: `${blockedRows.slice(0, 2).map((r: any) => r.current_stage || r.stage).filter(Boolean).join(", ") || "Multiple stages"} have queue pressure.`,
          tone: "critical" as const,
          link: "/reports/operations",
        }
      : null,
    delayedRows.length
      ? {
          title: `Who's closing the ${delayedRows.length} delayed orders?`,
          detail: `Top: ${delayedRows[0]?.customer_name || "customer not named"} · due ${delayedRows[0]?.due_date || delayedRows[0]?.promise_date || "date not returned"}.`,
          tone: "warn" as const,
          link: "/reports/sales",
        }
      : null,
    otifValue && otifValue < 92
      ? {
          title: `OTIF at ${formatPct(otifValue)} — what slipped?`,
          detail: `${Math.max(0, 92 - otifValue).toFixed(1)} pp below target this window.`,
          tone: "warn" as const,
          link: "/reports/sales",
        }
      : null,
  ].filter(Boolean) as Array<{ title: string; detail: string; tone: "critical" | "warn"; link: string }>

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="analytics-owner-pack-page">
      <ReportHero
        eyebrow="Owner daily pack"
        title="The one page that walks into the morning standup."
        description="Six hero KPIs, three things to ask in standup, dispatch trend, customer Pareto, variance mini, live exceptions."
        accent="slate"
        chips={[
          { label: `OTIF ${formatPct(otifValue)}`, tone: otifValue >= 92 ? "ok" : "warn" },
          { label: `Dispatch ${formatCurrency(dispatchValue)}`, tone: "neutral" },
          { label: `Backlog ${formatCurrency(backlogValue)}`, tone: "warn" },
          { label: `Variance ${formatCurrency(varianceValue)}`, tone: varianceValue > 100_000 ? "critical" : "neutral" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Period">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">
            Last 30 days
          </span>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">
            {activePlant || "ALL"}
          </span>
        </FilterField>
        <span className="ml-auto" />
        <a href="/api/analytics/reports/owner-pack/pdf?download=1" className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900" rel="noopener" target="_blank">
          Export PDF
        </a>
      </ReportFilterBar>

      {/* 6 hero KPIs */}
      <KpiRail
        items={[
          { label: "Dispatch ₹ (30d)", value: formatCurrency(dispatchValue), tone: "cyan", detail: `${formatNumber(Number(headline.dispatch_qty || 0))} kg shipped` },
          { label: "OTIF", value: formatPct(otifValue), tone: otifValue >= 92 ? "emerald" : "rose", delta: { value: formatPct(Math.abs(otifValue - 92)), direction: otifValue >= 92 ? "up" : "down", label: "vs target" } },
          { label: "Backlog", value: formatCurrency(backlogValue), tone: "amber", detail: `${formatNumber(Number(headline.backlog_orders || 0))} open orders` },
          { label: "Blocked jobs", value: formatNumber(blockedCount), tone: blockedCount ? "rose" : "emerald", detail: "Waiting on planner / QC" },
          { label: "Inventory value", value: formatCurrency(inventoryValue), tone: "violet", detail: "RM + WIP + FG" },
          { label: "Variance", value: formatCurrency(varianceValue), tone: varianceValue > 50_000 ? "rose" : "slate", detail: "Reconciliation drift" },
        ]}
      />

      {/* Standup questions */}
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Three things to ask in standup</p>
      {standupQuestions.length ? (
        <div className="grid gap-3 md:grid-cols-3">
          {standupQuestions.map((q, i) => (
            <a key={i} href={q.link} className={`rounded-[1.4rem] border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${q.tone === "critical" ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50"}`}>
              <Pill tone={q.tone}>{i + 1}. {q.tone === "critical" ? "Critical" : "Watch"}</Pill>
              <h3 className="mt-2 font-semibold text-slate-950">{q.title}</h3>
              <p className="mt-1 text-sm text-slate-700">{q.detail}</p>
            </a>
          ))}
        </div>
      ) : (
        <NoteCallout tone="ok">No blocker, delay, or OTIF standup question was triggered by the current report data.</NoteCallout>
      )}

      {/* Trend + variance mini */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel eyebrow="Dispatch trend" title="Dispatch quantity (kg) — 30 days" description="Where the dispatch shape is going.">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dispatchSeries}>
                <defs>
                  <linearGradient id="dispatchFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#0e7490" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#0e7490" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [`${formatNumber(v)} kg`, "Dispatch"]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Area type="monotone" dataKey="dispatch" stroke="#0e7490" strokeWidth={2.4} fill="url(#dispatchFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel eyebrow="Variance bridge" title="Theoretical → actual (kg)" description="Where the kg went this period.">
          {recBars.length > 1 ? (
            <Waterfall bars={recBars} unit="kg" />
          ) : (
            <NoteCallout tone="neutral">Reconciliation data not yet available for this window.</NoteCallout>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel eyebrow="Top customers" title="Top customers by dispatched value" description="The customers carrying the period.">
          {topCustomers.length ? (
            <ParetoChart bars={topCustomers.slice(0, 8).map((c: any) => ({ label: c.customer_name || c.name || "C", value: Number(c.revenue || c.value || 0) }))} />
          ) : (
            <NoteCallout tone="neutral">No top-customer data in this window.</NoteCallout>
          )}
        </Panel>
        <Panel eyebrow="Live exceptions" title="What's firing right now" description="Click each row to drill into the underlying records.">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span>Blocked job cards</span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-slate-950">{formatNumber(blockedCount)}</span>
                <Pill tone={blockedCount ? "critical" : "ok"}>{blockedCount ? "CRITICAL" : "OK"}</Pill>
                <DrillLink href="/reports/operations">Open</DrillLink>
              </span>
            </li>
            <li className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span>Delayed orders</span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-slate-950">{formatNumber(delayedRows.length)}</span>
                <Pill tone={delayedRows.length ? "warn" : "ok"}>{delayedRows.length ? "WATCH" : "OK"}</Pill>
                <DrillLink href="/reports/sales">Open</DrillLink>
              </span>
            </li>
            <li className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span>Low-stock items</span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-slate-950">{formatNumber(Number(headline.low_stock_items || 0))}</span>
                <Pill tone={Number(headline.low_stock_items || 0) ? "warn" : "ok"}>{Number(headline.low_stock_items || 0) ? "WATCH" : "OK"}</Pill>
                <DrillLink href="/analytics/mrp">Open</DrillLink>
              </span>
            </li>
            <li className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span>Variance ledger drift</span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-slate-950">{formatCurrency(varianceValue)}</span>
                <Pill tone={varianceValue > 100_000 ? "critical" : varianceValue > 0 ? "warn" : "ok"}>{varianceValue > 100_000 ? "CRITICAL" : varianceValue > 0 ? "WATCH" : "OK"}</Pill>
                <DrillLink href="/production/reconciliation">Open</DrillLink>
              </span>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}
