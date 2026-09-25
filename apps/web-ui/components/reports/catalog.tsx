"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { PageHeader } from "@/components/workspace/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type AudienceFilter = "all" | "owner" | "operations" | "commercial" | "inventory" | "quality" | "dispatch"

export const INTELLIGENCE_REPORTS: Array<{
  href: string
  title: string
  description: string
  audience: Exclude<AudienceFilter, "all">
}> = [
  {
    href: "/reports/owner",
    title: "Owner Daily Pack",
    description: "Single-page board pack: dispatch ₹, OTIF, backlog, variance, blocked jobs, scrap exposure.",
    audience: "owner",
  },
  {
    href: "/production/reconciliation",
    title: "Period Close Workbook",
    description: "Reconciliation summary, theoretical/ledger/actual deltas, blockers, cert posture — audit-grade close package.",
    audience: "owner",
  },
  {
    href: "/reports/operations",
    title: "Operations Command",
    description: "Stage throughput · 7×24 machine utilization heatmap · adherence ladder · operator productivity · blockers.",
    audience: "operations",
  },
  {
    href: "/reports/production",
    title: "Stage & Machine Throughput",
    description: "Winder / oven / process / packing per-machine kg-throughput. Calendar-heatmap of utilization.",
    audience: "operations",
  },
  {
    href: "/reports/tooling",
    title: "Tooling Ledger",
    description: "Tool definitions, inwarded QR assets, location, grinding cycles, and production job-card usage trail.",
    audience: "operations",
  },
  {
    href: "/reports/plants",
    title: "Cross-plant Comparator",
    description: "Side-by-side benchmark of plants on throughput, yield, OTIF, ledger variance.",
    audience: "operations",
  },
  {
    href: "/reports/sales",
    title: "Sales & Commercial Pulse",
    description: "Funnel · OTIF area trend · customer 360 ladder · top-SKU mix · lead-time anatomy.",
    audience: "commercial",
  },
  {
    href: "/reports/customer-360",
    title: "Customer 360",
    description: "Per-customer P&L view: orders, dispatched, OTIF, risk, open value, last-dispatch recency.",
    audience: "commercial",
  },
  {
    href: "/reports/inventory",
    title: "Inventory Intelligence",
    description: "Valuation · days-on-hand · aging · velocity matrix · top movers · reorder-policy planner.",
    audience: "inventory",
  },
  {
    href: "/analytics/mrp",
    title: "MRP: reorder policy and demand coverage",
    description: "Two separate views: item-master reorder/safety policy, and demand/BOM coverage from all open sales lines.",
    audience: "inventory",
  },
  {
    href: "/reports/loss",
    title: "Supplier & Reel Performance",
    description: "Vendor lead time, reel weight variance, GSM/BF compliance, supplier-side defect Pareto.",
    audience: "inventory",
  },
  {
    href: "/reports/quality",
    title: "Quality & Variance Bridge",
    description: "Variance waterfall (theoretical → ledger → actual). Hold Pareto. Scrap-cost ladder. QC pass-rate trend.",
    audience: "quality",
  },
  {
    href: "/reports/dispatch",
    title: "Dispatch & Customer SLA",
    description: "Challan throughput · on-time delivery · vehicle fill rate · customer SLA hit-rate ladder.",
    audience: "dispatch",
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

const AUDIENCE_ORDER: Exclude<AudienceFilter, "all">[] = [
  "owner",
  "operations",
  "commercial",
  "inventory",
  "quality",
  "dispatch",
]

export function IntelligenceReportCatalog() {
  const [audience, setAudience] = useState<AudienceFilter>("all")
  const visible = useMemo(
    () => INTELLIGENCE_REPORTS.filter((report) => audience === "all" || report.audience === audience),
    [audience],
  )

  return (
    <section className="space-y-4" data-testid="intelligence-report-catalog">
      <PageHeader
        eyebrow="Finished reports"
        title="Report library"
        description="KPIs live on this page. Each tile opens the canonical report route. Duplicate analytics/report URLs redirect here or to the matching report."
      />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report audience">
        {(["all", ...AUDIENCE_ORDER] as AudienceFilter[]).map((value) => (
          <Button
            key={value}
            type="button"
            role="tab"
            aria-selected={audience === value}
            variant={audience === value ? "default" : "outline"}
            className="h-8 rounded-full px-3 text-[11px] font-semibold uppercase tracking-[0.14em]"
            onClick={() => setAudience(value)}
          >
            {AUDIENCE_LABELS[value]}
          </Button>
        ))}
      </div>
      {AUDIENCE_ORDER.filter((group) => audience === "all" || group === audience).map((group) => {
        const groupReports = visible.filter((report) => report.audience === group)
        if (!groupReports.length) return null
        return (
          <div key={group} className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{AUDIENCE_LABELS[group]}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groupReports.map((report) => (
                <Link key={report.href} href={report.href} className="group">
                  <Card className="h-full rounded-[1.4rem] border-border transition group-hover:border-signal-cyan-line group-hover:shadow-md">
                    <CardHeader className="space-y-2 p-5">
                      <CardTitle className="text-base">{report.title}</CardTitle>
                      <CardDescription className="text-sm leading-6">{report.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 pt-0">
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-cyan-ink">Open report</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
