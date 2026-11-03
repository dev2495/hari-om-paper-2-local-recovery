"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartTooltip } from "@/components/erp/charts"

import { ClosuresByReason } from "@/components/sales/closures-by-reason"
import { RoleGate } from "@/components/workspace/role-gate"
import {
  DrillLink,
  Funnel,
  KpiRail,
  LeadTimeAnatomy,
  NoteCallout,
  Panel,
  Pill,
  ReportFilterBar,
  ReportHero,
  FilterField,
  formatCurrency,
  formatNumber,
  formatPct,
} from "@/components/reports/primitives"
import { reportLoadNote } from "@/components/reports/report-load"
import { useAuth } from "@/context/AuthContext"
import { useCustomer360, useLeadtimeAnatomy } from "@/hooks/use-analytics"
import { api } from "@/lib/api"
import { usePlantScopeLabel } from "@/hooks/use-plant-scope-label"

export default function SalesReportsWrapper() {
  return (
    <RoleGate allow={["Sales", "Owner", "Admin", "PlantManager"]}>
      <SalesPulsePage />
    </RoleGate>
  )
}

function SalesPulsePage() {
  const { activePlant } = useAuth()
  const activePlantLabel = usePlantScopeLabel(activePlant)
  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  // The sales report carries the OTIF, backlog and dispatch numbers itself, so this page no longer reads
  // the owner pack (Owner/Planner/Plant head only): Sales and the plant head both get real numbers.
  const salesQuery = useQuery({
    queryKey: ["analytics", "reports-sales", startDate, today, activePlant],
    queryFn: async () =>
      (await api.get("/api/analytics/reports/sales", {
        params: { start_date: startDate, end_date: today, granularity: "day", ...(activePlant ? { plant: activePlant } : {}) },
      })).data,
  })
  const salesReport = salesQuery.data
  const leadtimeQuery = useLeadtimeAnatomy({ startDate, endDate: today, plant: activePlant || undefined })
  const customersQuery = useCustomer360({ startDate, endDate: today, plant: activePlant || undefined })
  const leadtime = leadtimeQuery.data
  const customers = customersQuery.data
  const salesNote = reportLoadNote(salesQuery.error)
  const leadNote = reportLoadNote(leadtimeQuery.error)
  const customersNote = reportLoadNote(customersQuery.error)
  const sales: any = salesReport || {}

  const series = useMemo(() => (salesReport as any)?.series || [], [salesReport])
  const ordersCreated = series.reduce((a: number, r: any) => a + Number(r.orders_created || 0), 0)
  const released = series.reduce((a: number, r: any) => a + Number(r.released_or_better || 0), 0)
  const closed = series.reduce((a: number, r: any) => a + Number(r.orders_closed || 0), 0)
  const dispatchedPcs = series.reduce((a: number, r: any) => a + Number(r.dispatch_qty || 0), 0)

  const funnelStages = [
    { label: "Orders created", value: ordersCreated || Number((salesReport as any)?.summary?.closed_orders || 0) + Number((salesReport as any)?.summary?.backlog_orders || 0) },
    { label: "Released or better", value: released || ordersCreated },
    { label: "Closed (fully dispatched)", value: closed || 0 },
  ]

  const flowData = useMemo(
    () =>
      series.map((r: any, i: number) => ({
        label: String(r.bucket || r.label || `D${i + 1}`).slice(5),
        booked: Number(r.orders_created || 0),
        closed: Number(r.orders_closed || 0),
        dispatched: Number(r.dispatch_qty || 0),
      })),
    [series],
  )

  const customerRows: any[] = Array.isArray((customers as any)?.rows) ? (customers as any).rows : []
  const customerSummary = (customers as any)?.summary || {}
  const topSkuRows: Array<{ label: string; value: number }> = ((sales.top_items as any[]) || []).slice(0, 6).map((r: any) => ({
    label: r.item_code || r.name || "SKU",
    value: Number(r.qty || r.value || 0),
  }))

  const leadStages: any[] = Array.isArray((leadtime as any)?.stages) ? (leadtime as any).stages : []
  const totalAvgDays = Number((leadtime as any)?.total_average_days || 0)

  const otifValue = Number((salesReport as any)?.summary?.otif_percent ?? 0)
  const closedMeasured = Number((salesReport as any)?.summary?.closed_orders || 0)
  const backlogOrders = Number((salesReport as any)?.summary?.backlog_orders ?? 0)
  // On an API error the numbers are unknown, never zero.
  const shown = (value: string) => (salesNote ? "—" : value)

  return (
    <div className="space-y-5 pb-10" data-testid="reports-sales-page">
      <ReportHero
        eyebrow="Sales & commercial pulse"
        title="Sales pulse"
        description="Every customer-facing signal on one page. Click a row to drill into the order, customer, or specification."
        accent="emerald"
        chips={[
          { label: salesNote ? `Orders: ${salesNote}` : `${formatNumber(ordersCreated)} orders this window`, tone: salesNote ? "warn" : "neutral" },
          ...(salesNote ? [] : [{ label: closedMeasured ? `OTIF ${formatPct(otifValue)} of ${formatNumber(closedMeasured)} closed` : "No closed orders to measure OTIF", tone: "neutral" as const }]),
          ...(customersNote ? [] : [{ label: `${customerRows.length} customers tracked`, tone: "neutral" as const }]),
          ...(leadNote ? [] : [{ label: `Lead ${formatNumber(totalAvgDays, 1)} d`, tone: totalAvgDays > 21 ? ("warn" as const) : ("neutral" as const) }]),
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Period">
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-sm font-semibold text-muted-foreground">Last 30 days</span>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-sm font-semibold text-muted-foreground">{activePlantLabel}</span>
        </FilterField>
      </ReportFilterBar>

      {salesNote ? <NoteCallout tone="warn">Sales numbers: {salesNote}</NoteCallout> : null}

      <KpiRail
        items={[
          { label: "Orders created", value: shown(formatNumber(ordersCreated)), tone: "cyan" },
          { label: "Released %", value: ordersCreated ? shown(formatPct((released / ordersCreated) * 100)) : "—", tone: "violet" },
          { label: "Closed", value: shown(formatNumber(closed)), tone: "emerald" },
          { label: "Released backlog", value: shown(formatNumber(backlogOrders)), tone: "amber", detail: "Released, not yet fully dispatched" },
          { label: "OTIF", value: closedMeasured ? shown(formatPct(otifValue)) : "—", tone: "emerald", detail: salesNote || `${formatNumber(closedMeasured)} closed orders measured` },
          {
            label: "Lead time",
            value: leadNote ? "—" : `${formatNumber(totalAvgDays, 1)} d`,
            tone: "slate",
            detail: leadNote || `p50/p90 = ${formatNumber(Number((leadtime as any)?.p50 || 0), 1)} / ${formatNumber(Number((leadtime as any)?.p90 || 0), 1)} d`,
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel eyebrow="Order funnel" title="From created to dispatched" description="Each drop arrow shows the % lost between stages.">
          {salesNote ? <NoteCallout tone="warn">{salesNote}</NoteCallout> : funnelStages[0].value > 0 ? <Funnel stages={funnelStages} /> : <NoteCallout tone="neutral">No order activity in this window.</NoteCallout>}
        </Panel>
        <Panel eyebrow="Order flow" title="Booked, closed and dispatched" description="Orders booked and closed per day (bars) with pieces dispatched (line).">
          {salesNote ? <NoteCallout tone="warn">{salesNote}</NoteCallout> : flowData.some((row: any) => row.booked + row.closed + row.dispatched > 0) ? (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={flowData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={14} />
                  <YAxis yAxisId="o" tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <YAxis yAxisId="p" orientation="right" tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar yAxisId="o" dataKey="booked" name="Booked" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} maxBarSize={12} />
                  <Bar yAxisId="o" dataKey="closed" name="Closed" fill="hsl(var(--chart-7))" radius={[3, 3, 0, 0]} maxBarSize={12} />
                  <Line yAxisId="p" type="monotone" dataKey="dispatched" name="Dispatched pcs" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <NoteCallout tone="neutral">No orders booked, closed or dispatched in this window.</NoteCallout>}
          {salesNote ? null : <p className="mt-2 text-[12px] text-muted-foreground">{formatNumber(dispatchedPcs)} pcs dispatched in the window.</p>}
        </Panel>
      </div>

      <ClosuresByReason />

      <Panel eyebrow="Lead-time anatomy" title="Where the lead-time days are going" description="From order-created to dispatched, broken into the major stages.">
        {leadNote ? <NoteCallout tone="warn">{leadNote}</NoteCallout> : leadStages.length ? <LeadTimeAnatomy stages={leadStages.map((s: any) => ({ label: s.label, days: Number(s.days || 0) }))} /> : <NoteCallout tone="neutral">Not enough closed orders for a lead-time breakdown yet.</NoteCallout>}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel eyebrow="Customer 360" title="Top customers — risk-sorted" description={customersNote ? "Customer list could not be shown." : `${customerSummary.active_customers || customerRows.length} active · ${customerSummary.at_risk_customers || 0} at risk.`}>
          {customersNote ? <NoteCallout tone="warn">{customersNote}</NoteCallout> : customerRows.length ? (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3 text-right">Open ₹</th>
                  <th className="py-2 pr-3 text-right">Dispatched ₹</th>
                  <th className="py-2 pr-3 text-right">OTIF</th>
                  <th className="py-2 pr-3">Risk</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {customerRows.slice(0, 10).map((c: any) => (
                  <tr key={c.customer_id} className="border-b border-border">
                    <td className="py-2 pr-3 font-medium text-foreground">{c.customer_name}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(Number(c.open_value || 0))}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(Number(c.dispatched_value || 0))}</td>
                    <td className="py-2 pr-3 text-right">{formatPct(Number(c.otif_percent || 0))}</td>
                    <td className="py-2 pr-3">
                      <Pill tone={c.risk === "critical" ? "critical" : c.risk === "watch" ? "warn" : "ok"}>
                        {c.risk === "critical" ? "CRITICAL" : c.risk === "watch" ? "WATCH" : "OK"}
                      </Pill>
                    </td>
                    <td className="py-2 pr-3">
                      <DrillLink href={`/reports/customer-360?customer=${encodeURIComponent(c.customer_id || "")}`}>Open</DrillLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : (
            <NoteCallout tone="neutral">No customer-360 data in this window.</NoteCallout>
          )}
        </Panel>
        <Panel eyebrow="SKU mix" title="Top SKUs by quantity" description="Where the volume is concentrated.">
          {salesNote ? <NoteCallout tone="warn">{salesNote}</NoteCallout> : topSkuRows.length ? (
            <ul className="space-y-1.5">
              {topSkuRows.map((s) => (
                <li key={s.label} className="grid grid-cols-[minmax(0,1fr)_60px] items-center gap-2 text-sm">
                  <span className="truncate font-medium text-muted-foreground">{s.label}</span>
                  <span className="text-right font-bold text-foreground">{formatNumber(s.value)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <NoteCallout tone="neutral">No SKU mix yet.</NoteCallout>
          )}
        </Panel>
      </div>
    </div>
  )
}
