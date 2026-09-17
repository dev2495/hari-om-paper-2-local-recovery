"use client"

import { TrendingUp } from "lucide-react"
import type { ReactNode } from "react"

import { MODULE_APPEARANCES, type ModuleAppearance } from "@/lib/erp-appearance"
import { cn } from "@/lib/utils"

export type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  aside?: ReactNode
  badge?: string
  appearance?: ModuleAppearance
  variant?: "page" | "hero"
  testId?: string
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  aside,
  badge,
  appearance,
  variant = "page",
  testId,
}: PageHeaderProps) {
  const resolvedAppearance = appearance || MODULE_APPEARANCES.dashboard
  const Icon = resolvedAppearance.icon
  const chip = badge || eyebrow || resolvedAppearance.eyebrow

  if (variant === "hero") {
    return (
      <section
        data-testid={testId || "page-header"}
        className={cn(
          "overflow-hidden rounded-[2rem] border border-white/50 bg-gradient-to-br p-6 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)]",
          resolvedAppearance.surface,
        )}
      >
        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-sm">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {chip}
            </div>
            <div>
              <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">{title}</h1>
              {description ? <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-700">{description}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
          </div>
          <div className={cn("rounded-[1.6rem] bg-gradient-to-br p-[1px] shadow-xl", resolvedAppearance.accent)}>
            <div className="h-full rounded-[1.55rem] bg-slate-950/90 p-5 text-white">
              {aside || (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-cyan-100">
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                    Workspace
                  </div>
                  <p className="text-xl font-semibold tracking-tight">{resolvedAppearance.title}</p>
                  <p className="text-sm text-slate-200/80">{resolvedAppearance.description}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <header
      data-testid={testId || "page-header"}
      className="erp-panel flex flex-col gap-4 rounded-[1.7rem] px-5 py-5 md:flex-row md:items-start md:justify-between"
    >
      <div className="min-w-0 max-w-3xl space-y-2">
        {chip ? (
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-800/70">{chip}</p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
