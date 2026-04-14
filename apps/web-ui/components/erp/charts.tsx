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
    <section className={cn("erp-chart-panel", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-5 min-w-0" style={{ height, minHeight: height }}>
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
    <div ref={containerRef} className="h-full min-h-[16rem] min-w-0 w-full overflow-hidden" style={{ height, minHeight: height }}>
      {chartElement ? (
        chartElement
      ) : (
        <div className="h-full w-full rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50/80" />
      )}
    </div>
  )
}

export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className={ERP_CHART_THEME.tooltipClassName}>
      {label ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{String(label)}</p> : null}
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => (
          <div key={`${entry.name}-${index}`} className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color || ERP_CHART_THEME.palette[index % ERP_CHART_THEME.palette.length] }} />
              <span className="text-slate-600">{String(entry.name || entry.dataKey)}</span>
            </span>
            <span className="font-semibold text-slate-900">{Number(entry.value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChartEmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500">
      {label}
    </div>
  )
}
