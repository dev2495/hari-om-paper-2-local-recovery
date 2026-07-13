"use client"

import Link from "next/link"
import { useState } from "react"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  Panel,
  ReportFilterBar,
  ReportHero,
  ReportTileLink,
  FilterField,
  DrillLink,
} from "@/components/reports/primitives"
import { useAuth } from "@/context/AuthContext"
import { useOwnerPack } from "@/hooks/use-analytics"
import { usePlantScopeLabel } from "@/hooks/use-plant-scope-label"
import { formatCompactCurrency, formatPercent } from "@/components/erp/premium-dashboard"

type AudienceFilter = "all" | "owner" | "operations" | "commercial" | "inventory" | "quality" | "dispatch"

const REPORTS: Array<{
  href: string
  title: string
  description: string
  audience: AudienceFilter
  accent: "owner" | "ops" | "sales" | "inv" | "qc" | "disp"
}> = [
  {
    href: "/reports/owner",
    title: "Owner Daily Pack",
    description: "Single-page board pack: dispatch ₹, OTIF, backlog, variance, blocked jobs, scrap exposure.",
    audience: "owner",
    accent: "owner",
  },
  {
    href: "/production/reconciliation",
    title: "Period Close Workbook",
    description: "Reconciliation summary, theoretical/ledger/actual deltas, blockers, cert posture — audit-grade close package.",
    audience: "owner",
    accent: "owner",
  },
  {
    href: "/reports/operations",
    title: "Operations Command",
    description: "Stage throughput · 7×24 machine utilization heatmap · adherence ladder · operator productivity · blockers.",
    audience: "operations",
    accent: "ops",
  },
  {
    href: "/reports/production",
    title: "Stage & Machine Throughput",
    description: "Winder / oven / process / packing per-machine kg-throughput. Calendar-heatmap of utilization.",
    audience: "operations",
    accent: "ops",
  },
  {
    href: "/reports/tooling",
    title: "Tooling Ledger",
    description: "Tool definitions, inwarded QR assets, location, grinding cycles, and production job-card usage trail.",
    audience: "operations",
    accent: "ops",
  },
  {
    href: "/reports/plants",
    title: "Cross-plant Comparator",
    description: "Side-by-side benchmark of plants on throughput, yield, OTIF, ledger variance.",
    audience: "operations",
    accent: "ops",
  },
  {
    href: "/reports/sales",
    title: "Sales & Commercial Pulse",
    description: "Funnel · OTIF area trend · customer 360 ladder · top-SKU mix · lead-time anatomy.",
    audience: "commercial",
    accent: "sales",
  },
  {
    href: "/reports/customer-360",
    title: "Customer 360",
    description: "Per-customer P&L view: orders, dispatched, OTIF, risk, open value, last-dispatch recency.",
    audience: "commercial",
    accent: "sales",
  },
  {
    href: "/reports/inventory",
    title: "Inventory Intelligence",
    description: "Valuation · days-on-hand · aging · velocity matrix · top movers · MRP-driven shortage planner.",
    audience: "inventory",
    accent: "inv",
  },
  {
    href: "/analytics/mrp",
    title: "MRP & Shortage Planner",
    description: "Demand-driven shortages → PO drafts. Lead-time projection. Reorder-policy coverage gaps.",
    audience: "inventory",
    accent: "inv",
  },
  {
    href: "/reports/loss",
    title: "Supplier & Reel Performance",
    description: "Vendor lead time, reel weight variance, GSM/BF compliance, supplier-side defect Pareto.",
    audience: "inventory",
    accent: "inv",
  },
  {
    href: "/reports/quality",
    title: "Quality & Variance Bridge",
    description: "Variance waterfall (theoretical → ledger → actual). Hold Pareto. Scrap-cost ladder. QC pass-rate trend.",
    audience: "quality",
    accent: "qc",
  },
  {
    href: "/reports/dispatch",
    title: "Dispatch & Customer SLA",
    description: "Challan throughput · on-time delivery · vehicle fill rate · customer SLA hit-rate ladder.",
    audience: "dispatch",
    accent: "disp",
  },
]

const AUDIENCE_LABELS: Record<AudienceFilter, string> = {
  all: "All audiences",
  owner: "Owner / exec",
  operations: "Operations",
  commercial: "Commercial",
  inventory: "Inventory",
  quality: "Quality",
  dispatch: "Dispatch",
}

const AUDIENCE_ORDER: AudienceFilter[] = ["owner", "operations", "commercial", "inventory", "quality", "dispatch"]

export default function ReportsHubPageWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Store", "Dispatch", "Sales", "Owner", "Admin"]}>
      <ReportsLandingPage />
    </RoleGate>
  )
}

function ReportsLandingPage() {
  const { activePlant } = useAuth()
  const activePlantLabel = usePlantScopeLabel(activePlant)
  const [period, setPeriod] = useState<"7" | "30" | "90">("30")
  const [audience, setAudience] = useState<AudienceFilter>("all")
  const [compare, setCompare] = useState<"none" | "prior" | "year">("prior")
  const { data: pack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })

  const headline = (pack as any)?.headline || {}

  const visible = REPORTS.filter((r) => audience === "all" || r.audience === audience)
  const liveSnapshotRows = [
    {
      label: "OTIF",
      value: formatPercent(Number(headline.otif_percent || 0)),
      href: "/reports/sales",
    },
    {
      label: "Backlog",
      value: formatCompactCurrency(Number(headline.backlog_value || 0)),
      href: "/reports/sales",
    },
    {
      label: "Blocked jobs",
      value: String(Number(headline.blocked_jobs || 0)),
      href: "/reports/operations",
    },
    {
      label: "Inventory value",
      value: formatCompactCurrency(Number(headline.inventory_value || 0)),
      href: "/reports/inventory",
    },
  ]

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="reports-hub-page">
      <ReportHero
        eyebrow="Reports"
        title="Finished reports — picked by who you are."
        description="Each report opens on a screenshot-grade page with the same filter spine, the same comparison model, and the same drill paths. Pair this with /analytics for the live KPI snapshot view."
        accent="cyan"
        chips={[
          { label: `${REPORTS.length} reports`, tone: "neutral" },
          { label: `OTIF ${formatPercent(Number(headline.otif_percent || 0))}`, tone: "neutral" },
          { label: `Backlog ${formatCompactCurrency(Number(headline.backlog_value || 0))}`, tone: "warn" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Period">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </FilterField>
        <FilterField label="Compare">
          <select
            value={compare}
            onChange={(e) => setCompare(e.target.value as any)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
          >
            <option value="none">None</option>
            <option value="prior">vs prior period</option>
            <option value="year">vs same period last year</option>
          </select>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-700">
            {activePlantLabel}
          </span>
        </FilterField>
        <span className="ml-auto" />
        <span className="text-xs text-slate-500">
          Tip: open <Link href="/analytics" className="underline">/analytics</Link> for the live KPI dashboard.
        </span>
      </ReportFilterBar>

      {/* Audience tabs */}
      <div className="flex flex-wrap gap-2">
        {(["all", ...AUDIENCE_ORDER] as AudienceFilter[]).map((a) => (
          <button
            type="button"
            key={a}
            onClick={() => setAudience(a)}
            className={
              "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition " +
              (audience === a
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:text-cyan-900")
            }
          >
            {AUDIENCE_LABELS[a]}
          </button>
        ))}
      </div>

      {/* Render groups */}
      {AUDIENCE_ORDER.filter((a) => audience === "all" || a === audience).map((group) => {
        const groupReports = visible.filter((r) => r.audience === group)
        if (!groupReports.length) return null
        return (
          <section key={group} className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{AUDIENCE_LABELS[group]}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groupReports.map((r) => (
                <ReportTileLink
                  key={r.href}
                  href={r.href}
                  title={r.title}
                  description={r.description}
                  accent={r.accent}
                />
              ))}
            </div>
          </section>
        )
      })}

      {/* Live report snapshot */}
      <Panel
        eyebrow="Live snapshot"
        title="Current report signals"
        description="These values come from the owner-pack endpoint for the selected plant scope. Open a signal to inspect the underlying report."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-3">Signal</th>
              <th className="py-2 pr-3 text-right">Value</th>
              <th className="py-2 pr-3" />
            </tr>
          </thead>
          <tbody>
            {liveSnapshotRows.map((row) => (
              <tr key={row.label} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 pr-3 font-medium text-slate-900">{row.label}</td>
                <td className="py-2 pr-3 text-right font-bold text-slate-950">{row.value}</td>
                <td className="py-2 pr-3">
                  <DrillLink href={row.href}>Open</DrillLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
