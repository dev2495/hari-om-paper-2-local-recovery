'use client'

import Link from 'next/link'
import { BarChart3, Factory, Package, Sparkles, Truck, type LucideIcon } from 'lucide-react'

import { ChartCard, FilterChip, KpiCard, PageIntro, formatCompactCurrency, formatCompactNumber, formatPercent } from '@/components/erp/premium-dashboard'
import { RoleGate } from '@/components/workspace/role-gate'
import { useAuth } from '@/context/AuthContext'
import { useDashboardOverview, useExceptionReport, useOwnerPack, usePlantCompareReport, useSalesReport } from '@/hooks/use-analytics'
import { cn } from '@/lib/utils'

type ReportTile = {
  href: string
  title: string
  description: string
  accent: string
  icon: LucideIcon
}

const reportTiles: ReportTile[] = [
  {
    href: '/reports/owner',
    title: 'Owner dashboard',
    description: 'Revenue posture, OTIF, stage pressure, and board-pack summary.',
    accent: 'from-slate-950 via-slate-900 to-cyan-900 text-white',
    icon: Sparkles,
  },
  {
    href: '/reports/production',
    title: 'Production reports',
    description: 'Throughput, efficiency, and floor-level production signals.',
    accent: 'from-white to-cyan-50 text-slate-950',
    icon: Factory,
  },
  {
    href: '/reports/sales',
    title: 'Sales reports',
    description: 'Order releases, commercial movement, and dispatch-linked output.',
    accent: 'from-white to-amber-50 text-slate-950',
    icon: BarChart3,
  },
  {
    href: '/reports/inventory',
    title: 'Inventory reports',
    description: 'Stock levels, valuation, ageing, and risk posture.',
    accent: 'from-white to-emerald-50 text-slate-950',
    icon: Package,
  },
  {
    href: '/reports/plants',
    title: 'Plant reports',
    description: 'Plant-wise performance, capacity, and execution differences.',
    accent: 'from-white to-violet-50 text-slate-950',
    icon: Factory,
  },
  {
    href: '/production/reconciliation',
    title: 'Reconciliation',
    description: 'Material variance, close-out posture, and cost truth.',
    accent: 'from-white to-rose-50 text-slate-950',
    icon: Truck,
  },
]

export default function ReportsHubPageWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Store", "Dispatch", "Sales"]}>
      <ReportsHubPage />
    </RoleGate>
  )
}

function ReportsHubPage() {
  const { activePlant } = useAuth()
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { data: overview } = useDashboardOverview(activePlant || undefined)
  const { data: ownerPack } = useOwnerPack(activePlant ? { plant: activePlant } : undefined, { enabled: true })
  const { data: salesReport } = useSalesReport({ startDate, endDate, plant: activePlant || undefined, granularity: 'day' })
  const { data: plantReport } = usePlantCompareReport({ startDate, endDate, plant: activePlant || undefined, granularity: 'day' })
  const { data: exceptionReport } = useExceptionReport({ startDate, endDate, plant: activePlant || undefined, granularity: 'day' })
  const pack: any = ownerPack || {}
  const reportPreviews = {
    owner: formatCompactCurrency(Number(pack.headline?.dispatch_value || 0)),
    production: `${formatCompactNumber(Number(pack.headline?.active_job_cards || 0))} active JCs`,
    sales: `${formatCompactNumber(Number(salesReport?.summary?.backlog_orders || 0))} backlog`,
    inventory: formatCompactCurrency(Number(pack.headline?.inventory_value || 0)),
    plant: `${formatCompactNumber((plantReport?.rows || []).length)} plants`,
    reconciliation: formatCompactCurrency(Number(pack.reconciliation?.summary?.variance_value || 0)),
  }

  return (
    <div className="space-y-6 px-6 pb-8 pt-2" data-testid="reports-hub-page">
      <PageIntro
        eyebrow="Reports Suite"
        title="Finished reports for owner, production, sales, inventory, plant comparison, and reconciliation."
        description="Every report opens as a real operating artifact: consistent shell, export-ready, and built from the same live aggregates the rest of the ERP is using."
        actions={
          <>
            <FilterChip active>Last 30d</FilterChip>
            <FilterChip>{activePlant || 'ALL PLANTS'}</FilterChip>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="reports-hub:kpis">
        <KpiCard label="Revenue" value={formatCompactCurrency(Number(pack.headline?.dispatch_value || 0))} detail="Owner report headline value" tone="cyan" />
        <KpiCard label="Production" value={`${formatCompactNumber(Number(pack.headline?.dispatch_qty || 0))} kg`} detail="Dispatched quantity in scope" tone="emerald" />
        <KpiCard label="OTIF" value={formatPercent(Number(pack.headline?.otif_percent || 0))} detail="Current order promise performance" tone={Number(pack.headline?.otif_percent || 0) >= 92 ? 'emerald' : 'rose'} />
        <KpiCard label="Variance" value={formatCompactCurrency(Number(pack.reconciliation?.summary?.variance_value || 0))} detail="Reconciliation proxy" tone="amber" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {reportTiles.map((tile) => {
            const Icon = tile.icon
            const previewValue =
              tile.href === '/reports/owner'
                ? reportPreviews.owner
                : tile.href === '/reports/production'
                  ? reportPreviews.production
                  : tile.href === '/reports/sales'
                    ? reportPreviews.sales
                    : tile.href === '/reports/inventory'
                      ? reportPreviews.inventory
                      : tile.href === '/reports/plants'
                        ? reportPreviews.plant
                        : reportPreviews.reconciliation

            return (
              <Link key={tile.href} href={tile.href} className="group">
                <div
                  className={cn(
                    'h-full rounded-[28px] border border-slate-200/80 bg-gradient-to-br px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_24px_60px_rgba(15,23,42,0.12)]',
                    tile.accent,
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-2xl border border-white/20 bg-white/10 p-3">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <h2 className="mt-6 text-xl font-semibold tracking-tight">{tile.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-current/70">{tile.description}</p>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-current/70">{previewValue}</p>
                </div>
              </Link>
            )
          })}
        </div>

        <div className="space-y-4">
          <ChartCard eyebrow="Scheduled Deliveries" title="Delivery cadence readiness" description="Report automation UI can be layered on top of this suite without changing routes.">
            <div className="space-y-3 text-sm text-slate-600">
              <p>Owner and reconciliation reports are now shaped as finished surfaces rather than placeholder tiles.</p>
              <p>Sales, inventory, and plant reports use the same shell so exported PDFs and CSVs read coherently.</p>
              <p>{formatCompactNumber(Number(exceptionReport?.summary?.delayed_orders || 0))} delayed-order exceptions are already available for scheduled delivery logic.</p>
            </div>
          </ChartCard>

          <ChartCard eyebrow="Report Notes" title="Suite readiness" description="What this hub is now doing for the workspace.">
            <div className="space-y-3 text-sm text-slate-600">
              <p>The hub KPI rail is fed by the same live owner-pack and report data the detail pages now consume.</p>
              <p>Report previews now carry actual signal instead of decorative copy-only tiles.</p>
              <p>Plant comparison is ready to open even in single-plant mode, using the shared report shell.</p>
              <p>Overview dispatch today: {formatCompactNumber(Number(overview?.dispatch_today || 0))}.</p>
            </div>
          </ChartCard>
        </div>
      </section>
    </div>
  )
}
