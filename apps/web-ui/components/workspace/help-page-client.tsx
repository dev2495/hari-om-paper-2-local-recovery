"use client"

import Link from "next/link"
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
      className="h-auto min-h-[13rem] w-full overflow-visible"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="guide-node-fill" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#ecfeff" />
        </linearGradient>
        <filter id="guide-shadow" x="-20%" y="-30%" width="140%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.12" />
        </filter>
      </defs>

      <rect x="8" y="20" width={width - 16} height="174" rx="18" fill="#f8fafc" stroke="#dbeafe" />

      {visibleSteps.map((step, index) => {
        const x = startX + index * (boxWidth + gap)
        const nextX = x + boxWidth + gap
        const lines = wrapWords(step.label)
        return (
          <g key={`${step.label}-${index}`}>
            {index < visibleSteps.length - 1 ? (
              <g>
                <line x1={x + boxWidth + 10} y1="104" x2={nextX - 16} y2="104" stroke="#0e7490" strokeWidth="3" strokeLinecap="round" />
                <path d={`M ${nextX - 20} 96 L ${nextX - 8} 104 L ${nextX - 20} 112`} fill="none" stroke="#0e7490" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : null}
            <rect x={x} y="56" width={boxWidth} height="96" rx="16" fill="url(#guide-node-fill)" stroke="#bae6fd" filter="url(#guide-shadow)" />
            <circle cx={x + 24} cy="82" r="14" fill="#0f172a" />
            <text x={x + 24} y="87" textAnchor="middle" className="fill-white text-[13px] font-bold">
              {index + 1}
            </text>
            <text x={x + boxWidth / 2} y="111" textAnchor="middle" className="fill-slate-950 text-[13px] font-bold">
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
      ? "border-cyan-100 bg-cyan-50/70 text-cyan-950"
      : tone === "emerald"
        ? "border-emerald-100 bg-emerald-50/70 text-emerald-950"
        : tone === "amber"
          ? "border-amber-100 bg-amber-50/75 text-amber-950"
          : "border-slate-200 bg-white text-slate-900"

  return (
    <section className={cn("rounded-2xl border p-5 shadow-sm", toneClass)}>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/85 text-slate-900 shadow-sm">{icon}</span>
        <h2 className="text-sm font-bold uppercase tracking-[0.18em]">{title}</h2>
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-cyan-800" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GuideIndex({ activeGuide, guides }: { activeGuide: GuideContent; guides: GuideContent[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Guide library</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">All operator flows</h2>
        </div>
        <BookOpen className="h-5 w-5 text-cyan-900" />
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
                  ? "border-cyan-200 bg-cyan-50 text-cyan-950"
                  : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-cyan-200 hover:bg-white",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{guide.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{guide.eyebrow}</p>
                </div>
                <ArrowRight className={cn("mt-1 h-4 w-4 shrink-0", active ? "text-cyan-800" : "text-slate-300 group-hover:text-cyan-800")} />
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

  return (
    <div data-testid="guide-page" className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-slate-950 text-white shadow-premium">
        <div className="grid gap-0 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="p-7 md:p-9">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-cyan-100">
              <Route className="h-3.5 w-3.5" />
              {guide.eyebrow}
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{guide.title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">{guide.summary}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {guide.outputs.map((output) => (
                <span key={output} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-cyan-50">
                  {output}
                </span>
              ))}
            </div>
          </div>
          <div className="border-t border-white/10 bg-white px-4 py-5 text-slate-950 xl:border-l xl:border-t-0">
            <div className="mb-3 flex items-center justify-between px-2">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">{guide.flowTitle}</p>
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-cyan-900">
                SVG flow
              </span>
            </div>
            <GuideFlowSvg steps={guide.steps} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        {guide.steps.map((step, index) => (
          <div key={step.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">{index + 1}</div>
            <h2 className="mt-4 text-base font-semibold text-slate-950">{step.label}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{step.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <InfoPanel title="Field rules" icon={<ListChecks className="h-4 w-4" />} items={guide.fieldRules} tone="cyan" />
        <InfoPanel title="Main actions" icon={<ClipboardCheck className="h-4 w-4" />} items={guide.primaryActions} />
        <InfoPanel title="Control checks" icon={<ShieldCheck className="h-4 w-4" />} items={guide.controlChecks} tone="emerald" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Related pages</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Open the next workspace</h2>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {guide.relatedRoutes.map((relatedRoute) => (
            <Link
              key={relatedRoute}
              href={relatedRoute}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-950"
            >
              {relatedRoute}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ))}
        </div>
      </section>

      <GuideIndex activeGuide={guide} guides={guides} />
    </div>
  )
}
