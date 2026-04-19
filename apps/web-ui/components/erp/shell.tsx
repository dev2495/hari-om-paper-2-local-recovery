"use client"

import { Download, FileDown, LucideIcon, Printer, TrendingUp } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { getAppearance, MODULE_APPEARANCES, type ModuleAppearance } from "@/lib/erp-appearance"
import { cn } from "@/lib/utils"

export function ExecutiveHero({
  appearance,
  title,
  description,
  badge,
  actions,
  aside,
  testId,
}: {
  appearance?: ModuleAppearance
  title?: string
  description?: string
  badge?: string
  actions?: ReactNode
  aside?: ReactNode
  testId?: string
}) {
  const resolvedAppearance = appearance || MODULE_APPEARANCES.dashboard
  const Icon = resolvedAppearance.icon
  return (
    <section
      data-testid={testId}
      className={cn(
        "overflow-hidden rounded-[2rem] border border-white/50 bg-gradient-to-br p-6 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)]",
        resolvedAppearance.surface,
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-sm">
            <Icon className="h-3.5 w-3.5" />
            {badge || resolvedAppearance.eyebrow}
          </div>
          <div>
            <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
              {title || resolvedAppearance.title}
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-700">
              {description || resolvedAppearance.description}
            </p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>
        <div className={cn("rounded-[1.6rem] bg-gradient-to-br p-[1px] shadow-xl", resolvedAppearance.accent)}>
          <div className="h-full rounded-[1.55rem] bg-slate-950/90 p-5 text-white">
            {aside || (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-cyan-100">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Premium View
                </div>
                <p className="text-xl font-semibold tracking-tight">Sharper KPIs, clearer exceptions, faster operator scanning.</p>
                <p className="text-sm text-slate-200/80">
                  One consistent executive shell across planning, inventory, reports, and dispatch.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export function MetricRail({
  children,
  className,
  testId,
}: {
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section data-testid={testId} className={cn("grid gap-4 md:grid-cols-2 2xl:grid-cols-4", className)}>
      {children}
    </section>
  )
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "slate",
  testId,
}: {
  label: string
  value: string | number
  detail?: string
  icon: LucideIcon
  tone?: "slate" | "cyan" | "emerald" | "amber" | "rose" | "violet"
  testId?: string
}) {
  const toneMap: Record<string, string> = {
    slate: "from-slate-950 to-slate-700 text-white",
    cyan: "from-cyan-950 to-cyan-700 text-white",
    emerald: "from-emerald-950 to-emerald-700 text-white",
    amber: "from-amber-900 to-orange-600 text-white",
    rose: "from-rose-900 to-rose-600 text-white",
    violet: "from-violet-950 to-violet-700 text-white",
  }

  return (
    <article
      data-testid={testId}
      className={cn(
        "erp-metric-card overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/90 p-5 shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={cn("rounded-2xl bg-gradient-to-br p-3 shadow-lg", toneMap[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {detail ? <p className="mt-3 text-sm text-slate-600">{detail}</p> : null}
    </article>
  )
}

export function StickyFilterBar({
  children,
  className,
  testId,
}: {
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        "sticky top-[5.25rem] z-10 rounded-[1.4rem] border border-white/60 bg-white/85 p-4 shadow-lg backdrop-blur",
        className,
      )}
    >
      <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">{children}</div>
    </section>
  )
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  testId,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className={cn("erp-panel rounded-[1.7rem] p-6 shadow-xl transition-all duration-200", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function ExceptionList({
  items,
  emptyLabel,
}: {
  items: Array<{ id: string; title: string; detail: string; tone?: string }>
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <EmptyState label={emptyLabel} />
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const appearance = getAppearance(item.tone || "BLOCKED", item.tone || "Exception")
        const Icon = appearance.icon
        return (
          <div key={item.id} className="rounded-[1.25rem] border border-slate-200 bg-white/85 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className={cn("rounded-2xl border px-2.5 py-2", appearance.className)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EmptyState({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div className={cn("rounded-[1.3rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500", className)}>
      {label}
    </div>
  )
}

export function StatusBadge({
  value,
  label,
  className,
}: {
  value?: string | null
  label?: string
  className?: string
}) {
  const appearance = getAppearance(value, label)
  const Icon = appearance.icon

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]", appearance.className, className)}>
      <span className={cn("h-2 w-2 rounded-full", appearance.dotClassName)} />
      <Icon className="h-3.5 w-3.5" />
      {appearance.label}
    </span>
  )
}

export function ExportActions({
  onExportCsv,
  printHref,
  printLabel = "Print / PDF",
}: {
  onExportCsv?: () => void
  printHref?: string
  printLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onExportCsv ? (
        <button type="button" onClick={onExportCsv} className="erp-btn-secondary">
          <FileDown className="h-4 w-4" />
          Export CSV
        </button>
      ) : null}
      {printHref ? (
        <Link href={printHref} data-testid="erp-export-print" className="erp-btn-secondary">
          <Printer className="h-4 w-4" />
          {printLabel}
        </Link>
      ) : null}
      {!onExportCsv && !printHref ? (
        <button type="button" className="erp-btn-secondary">
          <Download className="h-4 w-4" />
          Export
        </button>
      ) : null}
    </div>
  )
}
