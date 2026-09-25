"use client"

import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/workspace/page-header"
import { ArrowRight, BookOpen, CheckCircle2, ClipboardCheck, ExternalLink, ListChecks, Route, ShieldCheck } from "lucide-react"

import { getAllGuides, getGuideForRoute, type GuideContent, type GuideStep } from "@/lib/guide-content"
import { cn } from "@/lib/utils"

function wrapWords(value: string, maxLength = 18) {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxLength && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  })
  if (current) lines.push(current)
  return lines.slice(0, 2)
}

function GuideFlowSvg({ steps }: { steps: GuideStep[] }) {
  const visibleSteps = steps.slice(0, 5)
  const boxWidth = 150
  const gap = 38
  const startX = 34
  const width = startX * 2 + visibleSteps.length * boxWidth + Math.max(0, visibleSteps.length - 1) * gap

  return (
    <svg
      data-testid="guide-flow-svg"
      viewBox={`0 0 ${width} 214`}
      role="img"
      aria-label="Workflow diagram"
      className="h-auto min-w-[640px] w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="guide-node-fill" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--card))" />
          <stop offset="100%" stopColor="hsl(var(--secondary))" />
        </linearGradient>
        <filter id="guide-shadow" x="-20%" y="-30%" width="140%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="hsl(var(--foreground))" floodOpacity="0.12" />
        </filter>
      </defs>

      <rect x="8" y="20" width={width - 16} height="174" rx="18" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />

      {visibleSteps.map((step, index) => {
        const x = startX + index * (boxWidth + gap)
        const nextX = x + boxWidth + gap
        const lines = wrapWords(step.label)
        return (
          <g key={`${step.label}-${index}`}>
            {index < visibleSteps.length - 1 ? (
              <g>
                <line x1={x + boxWidth + 10} y1="104" x2={nextX - 16} y2="104" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" />
                <path d={`M ${nextX - 20} 96 L ${nextX - 8} 104 L ${nextX - 20} 112`} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : null}
            <rect x={x} y="56" width={boxWidth} height="96" rx="16" fill="url(#guide-node-fill)" stroke="hsl(var(--border))" filter="url(#guide-shadow)" />
            <circle cx={x + 24} cy="82" r="14" fill="hsl(var(--foreground))" />
            <text x={x + 24} y="87" textAnchor="middle" className="fill-white text-[13px] font-bold">
              {index + 1}
            </text>
            <text x={x + boxWidth / 2} y="111" textAnchor="middle" className="fill-foreground text-[13px] font-bold">
              {lines.map((line, lineIndex) => (
                <tspan key={line} x={x + boxWidth / 2} dy={lineIndex === 0 ? 0 : 16}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function InfoPanel({
  title,
  icon,
  items,
  tone = "slate",
}: {
  title: string
  icon: React.ReactNode
  items: string[]
  tone?: "slate" | "cyan" | "emerald" | "amber"
}) {
  const toneClass =
    tone === "cyan"
      ? "border-signal-cyan-line bg-signal-cyan-soft/70 text-signal-cyan-ink"
      : tone === "emerald"
        ? "border-signal-emerald-line bg-signal-emerald-soft/70 text-signal-emerald-ink"
        : tone === "amber"
          ? "border-signal-amber-line bg-signal-amber-soft/75 text-signal-amber-ink"
          : "border-border bg-card text-foreground"

  return (
    <section className={cn("rounded-2xl border p-5 shadow-sm", toneClass)}>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-card/85 text-foreground shadow-sm">{icon}</span>
        <h2 className="text-sm font-bold uppercase tracking-[0.18em]">{title}</h2>
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-signal-cyan-ink" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GuideIndex({ activeGuide, guides }: { activeGuide: GuideContent; guides: GuideContent[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">Guide library</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">All operator flows</h2>
        </div>
        <BookOpen className="h-5 w-5 text-signal-cyan-ink" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {guides.map((guide) => {
          const active = guide.id === activeGuide.id
          return (
            <Link
              key={guide.id}
              data-testid={`guide-index:${guide.id}`}
              href={`/help?route=${encodeURIComponent(guide.route)}`}
              className={cn(
                "group rounded-xl border px-3 py-3 transition",
                active
                  ? "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink"
                  : "border-border bg-muted/70 text-muted-foreground hover:border-signal-cyan-line hover:bg-card",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{guide.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{guide.eyebrow}</p>
                </div>
                <ArrowRight className={cn("mt-1 h-4 w-4 shrink-0", active ? "text-signal-cyan-ink" : "text-muted-foreground group-hover:text-signal-cyan-ink")} />
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export function HelpPageClient({ route }: { route?: string }) {
  const guide = getGuideForRoute(route)
  const guides = getAllGuides()

  const [query, setQuery] = useState("")
  const matching = guides.filter(item => `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase()))
  return <div data-testid="guide-page" className="space-y-6">
    <PageHeader title={guide.title} description={guide.summary} actions={<>
      <a href="/docs/Hari-Om-TubeOS-Client-Guide.pdf" className="erp-btn-secondary" download>Download PDF guide</a>
      <a href="/docs/Hari-Om-TubeOS-Client-Guide.html" className="erp-btn-secondary" target="_blank" rel="noreferrer">Full client handbook</a>
    </>} />
    <div className="grid min-w-0 gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="order-2 min-w-0 xl:order-1">
        <div className="erp-panel rounded-xl p-4 xl:sticky xl:top-24">
          <h2 className="text-sm font-semibold">Guide library</h2>
          <label className="sr-only" htmlFor="guide-search">Search guides</label>
          <input id="guide-search" className="my-3 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" placeholder="Find a workflow…" value={query} onChange={event=>setQuery(event.target.value)} />
          <nav aria-label="Operator guides" className="max-h-80 overflow-y-auto xl:max-h-[65dvh]">
            {matching.map(item=><Link key={item.id} data-testid={`guide-index:${item.id}`} className="tube-nav-link" aria-current={item.id === guide.id ? "page" : undefined} href={`/help?route=${encodeURIComponent(item.route)}`}>{item.title.replace(/ Guide$/, "")}</Link>)}
            {!matching.length ? <p className="py-4 text-xs text-muted-foreground">No guide matches this search.</p> : null}
          </nav>
        </div>
      </aside>
      <div className="order-1 min-w-0 space-y-5 xl:order-2">
        <section className="erp-panel overflow-hidden rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{guide.flowTitle}</h2><p className="mt-1 text-xs text-muted-foreground">Follow the steps in order; each saved record stays linked to its source.</p></div><Link href={guide.route} className="erp-btn-primary">Open workspace <ArrowRight size={15} /></Link></div>
          <div className="mt-4 overflow-x-auto"><GuideFlowSvg steps={guide.steps} /></div>
        </section>
        <ol className="grid gap-4 md:grid-cols-2">
          {guide.steps.map((step,index)=><li key={step.label} className="erp-panel flex items-start gap-4 rounded-xl p-5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-semibold text-primary">{index+1}</span><div><h2 className="text-sm font-semibold">{step.label}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{step.detail}</p></div></li>)}
        </ol>
        <div className="grid gap-4 lg:grid-cols-2"><InfoPanel title="Field rules" icon={<ListChecks size={16} />} items={guide.fieldRules} /><InfoPanel title="Control checks" icon={<ShieldCheck size={16} />} items={guide.controlChecks} tone="emerald" /></div>
        <InfoPanel title="Actions and outputs" icon={<ClipboardCheck size={16} />} items={[...guide.primaryActions, ...guide.outputs.map(output=>`Output: ${output}`)]} tone="cyan" />
        <section className="erp-panel rounded-xl p-5"><h2 className="text-sm font-semibold">Continue the workflow</h2><div className="mt-3 flex flex-wrap gap-2">{guide.relatedRoutes.map(route=><Link key={route} href={route} className="erp-btn-secondary">{getGuideForRoute(route).title.replace(/ Guide$/, "")}<ExternalLink size={13} /></Link>)}</div></section>
      </div>
    </div>
  </div>
}
