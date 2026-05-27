"use client"

import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

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
import { useAuth } from "@/context/AuthContext"
import { useCustomer360, useLeadtimeAnatomy, useOwnerPack, useSalesReport } from "@/hooks/use-analytics"
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

  const { data: salesReport } = useSalesReport({ startDate, endDate: today, plant: activePlant || undefined, granularity: "day" })
  const { data: pack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: leadtime } = useLeadtimeAnatomy({ startDate, endDate: today, plant: activePlant || undefined })
  const { data: customers } = useCustomer360({ startDate, endDate: today, plant: activePlant || undefined })

  const p: any = pack || {}
  const sales = p.sales || {}
  const headline = p.headline || {}

  const series = useMemo(() => (salesReport as any)?.series || [], [salesReport])
  const ordersCreated = series.reduce((a: number, r: any) => a + Number(r.orders_created || 0), 0)
  const released = series.reduce((a: number, r: any) => a + Number(r.released_or_better || 0), 0)
  const closed = series.reduce((a: number, r: any) => a + Number(r.orders_closed || 0), 0)
  const dispatched = Math.max(0, closed - Number((salesReport as any)?.summary?.delayed_orders || 0))

  const funnelStages = [
    { label: "Orders created", value: ordersCreated || Number((salesReport as any)?.summary?.closed_orders || 0) + Number((salesReport as any)?.summary?.backlog_orders || 0) },
    { label: "Released or better", value: released || ordersCreated },
    { label: "Closed", value: closed || 0 },
    { label: "Dispatched", value: dispatched || closed || 0 },
  ]

  const otifData = useMemo(
    () =>
      series.map((r: any, i: number) => ({
        label: r.label || r.date || `D${i + 1}`,
        otif: Number(r.otif_percent || r.otif || 0),
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

  const otifValue = Number(headline.otif_percent || sales.summary?.otif_percent || 0)
  const backlogValue = Number(headline.backlog_value || sales.summary?.backlog_value || (salesReport as any)?.summary?.backlog_value || 0)

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="reports-sales-page">
      <ReportHero
        eyebrow="Sales & commercial pulse"
        title="Funnel, OTIF, customer 360, top SKUs, lead-time anatomy."
        description="Every customer-facing signal on one page. Click a row to drill into the order, customer, or specification."
        accent="emerald"
        chips={[
          { label: `${formatNumber(ordersCreated)} orders this window`, tone: "neutral" },
          { label: `OTIF ${formatPct(otifValue)}`, tone: otifValue >= 92 ? "ok" : "warn" },
          { label: `${customerRows.length} customers tracked`, tone: "neutral" },
          { label: `Lead ${formatNumber(totalAvgDays, 1)} d`, tone: totalAvgDays > 21 ? "warn" : "neutral" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Period">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">Last 30 days</span>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">{activePlantLabel}</span>
        </FilterField>
      </ReportFilterBar>

      <KpiRail
        items={[
          { label: "Orders created", value: formatNumber(ordersCreated), tone: "cyan" },
          { label: "Released %", value: ordersCreated ? formatPct((released / ordersCreated) * 100) : "—", tone: "violet" },
          { label: "Closed", value: formatNumber(closed), tone: "emerald" },
          { label: "Backlog", value: formatCurrency(backlogValue), tone: "amber" },
          { label: "OTIF", value: formatPct(otifValue), tone: otifValue >= 92 ? "emerald" : "rose" },
          {
            label: "Lead time",
            value: `${formatNumber(totalAvgDays, 1)} d`,
            tone: "slate",
            detail: `p50/p90 = ${formatNumber(Number((leadtime as any)?.p50 || 0), 1)} / ${formatNumber(Number((leadtime as any)?.p90 || 0), 1)} d`,
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Panel eyebrow="Order funnel" title="From created to dispatched" description="Each drop arrow shows the % lost between stages.">
          {funnelStages[0].value > 0 ? <Funnel stages={funnelStages} /> : <NoteCallout tone="neutral">No order activity in this window.</NoteCallout>}
        </Panel>
        <Panel eyebrow="OTIF trend" title="Daily OTIF with 92% target" description="Where the SLA is bending.">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={otifData}>
                <defs>
                  <linearGradient id="otifFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#047857" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#047857" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <ReferenceLine y={92} stroke="#dc2626" strokeDasharray="6 6" />
                <Tooltip formatter={(v: number) => [`${formatPct(v)}`, "OTIF"]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Area type="monotone" dataKey="otif" stroke="#047857" strokeWidth={2.4} fill="url(#otifFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Lead-time anatomy" title="Where the lead-time days are going" description="From order-created to dispatched, broken into the major stages.">
        {leadStages.length ? <LeadTimeAnatomy stages={leadStages.map((s: any) => ({ label: s.label, days: Number(s.days || 0) }))} /> : <NoteCallout tone="neutral">Not enough closed orders for a lead-time breakdown yet.</NoteCallout>}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel eyebrow="Customer 360" title="Top customers — risk-sorted" description={`${customerSummary.active_customers || customerRows.length} active · ${customerSummary.at_risk_customers || 0} at risk.`}>
          {customerRows.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                  <tr key={c.customer_id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-900">{c.customer_name}</td>
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
            </table>
          ) : (
            <NoteCallout tone="neutral">No customer-360 data in this window.</NoteCallout>
          )}
        </Panel>
        <Panel eyebrow="SKU mix" title="Top SKUs by quantity" description="Where the volume is concentrated.">
          {topSkuRows.length ? (
            <ul className="space-y-1.5">
              {topSkuRows.map((s) => (
                <li key={s.label} className="grid grid-cols-[1fr_60px] items-center gap-2 text-sm">
                  <span className="truncate font-medium text-slate-700">{s.label}</span>
                  <span className="text-right font-bold text-slate-950">{formatNumber(s.value)}</span>
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
