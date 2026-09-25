"use client"

import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react"

import { ERP_CHART_THEME } from "@/lib/erp-appearance"
import { cn } from "@/lib/utils"

export function ChartPanel({
  title,
  subtitle,
  children,
  height = 320,
  actions,
  className,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  height?: number
  actions?: ReactNode
  className?: string
}) {
  return (
    <section className={cn("erp-chart-panel erp-panel min-w-0 rounded-xl p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 min-w-0" style={{ height, minHeight: height }}>
        {children}
      </div>
    </section>
  )
}

export function ChartBox({
  children,
  height = 320,
}: {
  children: ReactNode
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 0, height })

  useLayoutEffect(() => {
    setMounted(true)
    const element = containerRef.current
    if (!element) return

    const update = () => {
      setDimensions({
        width: Math.max(element.clientWidth, 0),
        height: Math.max(element.clientHeight || height, height),
      })
    }

    update()

    const frame = window.requestAnimationFrame(update)
    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [height])

  const chartElement =
    mounted && isValidElement(children) && dimensions.width > 16 && dimensions.height > 16
      ? cloneElement(children as ReactElement<any>, {
          width: dimensions.width,
          height: dimensions.height || height,
        })
      : null

  return (
    <div ref={containerRef} className="erp-chart-box h-full min-h-[12rem] min-w-0 w-full overflow-hidden animate-fade-in" style={{ height, minHeight: height }}>
      {chartElement ? (
        chartElement
      ) : (
        <div className="skeleton h-full w-full rounded-lg" aria-hidden="true" />
      )}
    </div>
  )
}

export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className={ERP_CHART_THEME.tooltipClassName}>
      {label ? <p className="mb-1.5 border-b border-border pb-1.5 text-[11.5px] font-semibold text-foreground">{String(label)}</p> : null}
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => (
          <div key={`${entry.name}-${index}`} className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: entry.color || ERP_CHART_THEME.palette[index % ERP_CHART_THEME.palette.length] }} />
              <span className="text-muted-foreground">{String(entry.name || entry.dataKey)}</span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">{Number(entry.value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChartEmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-[hsl(var(--surface-2))] px-4 text-center text-[13px] text-muted-foreground">
      <svg width="44" height="28" viewBox="0 0 44 28" fill="none" aria-hidden="true" className="text-muted-foreground/50"><path d="M2 24 L12 16 L20 19 L30 8 L42 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" /><path d="M2 26.5h40" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
      {label}
    </div>
  )
}
