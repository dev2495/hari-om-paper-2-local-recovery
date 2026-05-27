"use client"

import { useMemo, useState } from "react"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  DrillLink,
  KpiRail,
  NoteCallout,
  Panel,
  ParetoChart,
  Pill,
  ReportFilterBar,
  ReportHero,
  FilterField,
  formatCurrency,
  formatNumber,
  formatPct,
} from "@/components/reports/primitives"
import { useAuth } from "@/context/AuthContext"
import { useCustomer360 } from "@/hooks/use-analytics"

export default function Customer360Wrapper() {
  return (
    <RoleGate allow={["Sales", "Owner", "Admin", "PlantManager"]}>
      <Customer360Page />
    </RoleGate>
  )
}

function Customer360Page() {
  const { activePlant } = useAuth()
  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  const [riskFilter, setRiskFilter] = useState<"all" | "watch" | "critical">("all")

  const { data: customers, isLoading } = useCustomer360({ startDate, endDate: today, plant: activePlant || undefined })

  const rows: any[] = useMemo(
    () => (Array.isArray((customers as any)?.rows) ? (customers as any).rows : []),
    [customers],
  )
  const summary = (customers as any)?.summary || {}

  const filtered = useMemo(() => {
    if (riskFilter === "all") return rows
    if (riskFilter === "critical") return rows.filter((r) => r.risk === "critical")
    return rows.filter((r) => r.risk === "critical" || r.risk === "watch")
  }, [rows, riskFilter])

  const paretoBars = rows.slice(0, 10).map((r: any) => ({
    label: (r.customer_name || "").substring(0, 8) + ((r.customer_name || "").length > 8 ? "…" : ""),
    value: Number(r.dispatched_value || 0) + Number(r.open_value || 0),
  }))

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="reports-customer-360-page">
      <ReportHero
        eyebrow="Customer 360"
        title="Every customer · open ₹ · dispatched ₹ · OTIF · risk."
        description="One row per customer, sorted by total value. Risk band is computed from delayed orders + OTIF posture."
        accent="emerald"
        chips={[
          { label: `${summary.active_customers || rows.length} active`, tone: "neutral" },
          { label: `${summary.at_risk_customers || 0} at risk`, tone: summary.at_risk_customers ? "warn" : "ok" },
          { label: `${formatCurrency(Number(summary.total_open_value || 0))} open`, tone: "warn" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Window">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">Last 30 days</span>
        </FilterField>
        <FilterField label="Risk">
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as any)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
          >
            <option value="all">All</option>
            <option value="watch">Watch + Critical</option>
            <option value="critical">Critical only</option>
          </select>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">{activePlant || "ALL"}</span>
        </FilterField>
      </ReportFilterBar>

      <KpiRail
        items={[
          { label: "Active customers", value: formatNumber(Number(summary.active_customers || rows.length)), tone: "cyan" },
          { label: "At risk", value: formatNumber(Number(summary.at_risk_customers || 0)), tone: summary.at_risk_customers ? "rose" : "emerald" },
          { label: "Total open value", value: formatCurrency(Number(summary.total_open_value || 0)), tone: "amber" },
          { label: "Total dispatched value", value: formatCurrency(Number(summary.total_dispatched_value || 0)), tone: "emerald" },
        ]}
        columns={4}
      />

      <Panel eyebrow="Concentration" title="Top customers (Pareto)" description="The customers carrying the period — concentration risk if top-1 > 35% of total.">
        {paretoBars.length ? <ParetoChart bars={paretoBars} /> : <NoteCallout tone="neutral">No customer activity in this window.</NoteCallout>}
      </Panel>

      <Panel eyebrow="Ladder" title="Customer rows" description="Click any customer to drill into their orders, dispatches and OTIF history.">
        {isLoading ? (
          <NoteCallout tone="neutral">Loading customer 360…</NoteCallout>
        ) : filtered.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3 text-right">Open</th>
                <th className="py-2 pr-3 text-right">Closed</th>
                <th className="py-2 pr-3 text-right">Delayed</th>
                <th className="py-2 pr-3 text-right">Open ₹</th>
                <th className="py-2 pr-3 text-right">Dispatched ₹</th>
                <th className="py-2 pr-3 text-right">OTIF</th>
                <th className="py-2 pr-3">Risk</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.customer_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-3 font-medium text-slate-900">{c.customer_name}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(Number(c.orders_open || 0))}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(Number(c.orders_closed || 0))}</td>
                  <td className="py-2 pr-3 text-right text-rose-700 font-semibold">{formatNumber(Number(c.orders_delayed || 0))}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(Number(c.open_value || 0))}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(Number(c.dispatched_value || 0))}</td>
                  <td className="py-2 pr-3 text-right">{formatPct(Number(c.otif_percent || 0))}</td>
                  <td className="py-2 pr-3">
                    <Pill tone={c.risk === "critical" ? "critical" : c.risk === "watch" ? "warn" : "ok"}>
                      {c.risk === "critical" ? "CRITICAL" : c.risk === "watch" ? "WATCH" : "OK"}
                    </Pill>
                  </td>
                  <td className="py-2 pr-3"><DrillLink href={`/sales/orders?customer=${encodeURIComponent(c.customer_id || "")}`}>Orders</DrillLink></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoteCallout tone="ok">No customers match the current filter.</NoteCallout>
        )}
      </Panel>
    </div>
  )
}
