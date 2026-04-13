'use client'

import Link from 'next/link'
import { Activity, ArrowRight, BarChart3, Factory, Package, Sparkles, Truck, type LucideIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { analyticsApi, dashboardApi } from '@/lib/api'
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
    description: 'KPIs, revenue posture, and operating drift in one surface.',
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
    description: 'Order releases, commercial movement, and dispatch-linked sales output.',
    accent: 'from-white to-amber-50 text-slate-950',
    icon: BarChart3,
  },
  {
    href: '/reports/inventory',
    title: 'Inventory reports',
    description: 'Stock levels, valuation, and raw-material visibility.',
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
    description: 'Material reconciliation, cost variance, and close-out review.',
    accent: 'from-white to-rose-50 text-slate-950',
    icon: Truck,
  },
]

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white/90 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
    </div>
  )
}

export default function ReportsHubPage() {
  const { data: overview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => {
      const { data } = await dashboardApi.getOverview()
      return data
    },
  })

  const { data: productionTrends } = useQuery({
    queryKey: ['production-trends'],
    queryFn: async () => {
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const { data } = await analyticsApi.getProductionTrends(startDate, endDate)
      return data
    },
  })

  const trendCount = Array.isArray(productionTrends) ? productionTrends.length : 0

  return (
    <div className="space-y-6 px-6 pb-8 pt-2" data-testid="reports-hub-page">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(186,230,253,0.3),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.98))] px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">TubeOS Workspace</p>
            <h1 className="mt-2 text-[2.4rem] font-semibold tracking-tight text-slate-950">Reports</h1>
            <p className="mt-2 text-sm text-slate-600">
              Owner reporting, plant summaries, reconciliation, and operational drift in one control surface.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[24px] border border-cyan-100 bg-cyan-50/90 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">Live trend pulls</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{trendCount}</p>
              <p className="mt-1 text-sm text-slate-600">Production trend points loaded</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-white/90 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Dispatch today</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{overview?.dispatch_today || 0}</p>
              <p className="mt-1 text-sm text-slate-600">Ready-to-ship output</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-white/90 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Reconciliation</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">₹{overview?.reconciliation_cost?.toLocaleString() || 0}</p>
              <p className="mt-1 text-sm text-slate-600">Variance cost on record</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="reports-hub:kpis">
        <MetricCard
          label="Total Production"
          value={`${overview?.total_production?.toLocaleString() || '0'} units`}
          hint="Reported manufacturing output"
        />
        <MetricCard
          label="Active Jobs"
          value={String(overview?.active_jobs || 0)}
          hint="Currently open production work"
        />
        <MetricCard
          label="Dispatch Today"
          value={String(overview?.dispatch_today || 0)}
          hint="Dispatches recorded today"
        />
        <MetricCard
          label="Reconciliation Cost"
          value={`₹${overview?.reconciliation_cost?.toLocaleString() || 0}`}
          hint="Material variance cost"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {reportTiles.map((tile) => {
            const Icon = tile.icon
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
                    <ArrowRight className="h-4 w-4 opacity-60 transition group-hover:translate-x-1" />
                  </div>
                  <h2 className="mt-6 text-xl font-semibold tracking-tight">{tile.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-current/70">{tile.description}</p>
                </div>
              </Link>
            )
          })}
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/90 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-2 text-slate-950">
              <Activity className="h-4 w-4 text-cyan-700" />
              <h2 className="font-semibold">Reporting posture</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p>Owner and plant surfaces are restored on the same route structure that the April workspace used.</p>
              <p>Inventory, sales, reconciliation, and dispatch summaries stay one click away from the hub.</p>
              <p>This page now uses the premium workspace layout instead of the fallback card grid.</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,#0f172a,#164e63_55%,#0f766e)] px-5 py-5 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">Control note</p>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">Reporting links stay stable</h2>
            <p className="mt-2 text-sm leading-6 text-white/75">
              Existing report routes remain intact, while the hub matches the later workspace styling more closely.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
