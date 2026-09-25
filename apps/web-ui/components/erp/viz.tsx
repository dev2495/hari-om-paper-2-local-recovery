"use client"

import { useId, useState } from "react"

import { cn } from "@/lib/utils"

/** Animated radial gauge (0–100). Shows "—" with a dashed track when there's no measurement. */
export function RadialGauge({ value, label, detail, color = "hsl(var(--chart-1))", size = 112, suffix = "%" }: {
  value: number | null | undefined; label: string; detail?: string; color?: string; size?: number; suffix?: string
}) {
  const measured = value !== null && value !== undefined && Number.isFinite(Number(value))
  const pct = measured ? Math.max(0, Math.min(100, Number(value))) : 0
  const stroke = 9
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const arc = circumference * 0.75
  const filled = (arc * pct) / 100
  return (
    <figure className="flex min-w-0 flex-col items-center text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-[225deg]" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} ${circumference}`} className={measured ? undefined : "opacity-60"} />
          {measured ? (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`}
              style={{ transition: "stroke-dasharray 900ms var(--ease-workspace)", filter: `drop-shadow(0 0 6px color-mix(in srgb, ${color} 35%, transparent))`, animation: "gauge-in 1s var(--ease-workspace) both" }} />
          ) : null}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[22px] font-semibold tabular-nums tracking-tight">{measured ? `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 1 })}${suffix}` : "—"}</span>
        </div>
      </div>
      <figcaption className="-mt-3">
        <span className="block text-[12.5px] font-semibold text-foreground/90">{label}</span>
        {detail ? <span className="mt-0.5 block text-[11.5px] leading-4 text-muted-foreground">{detail}</span> : null}
      </figcaption>
    </figure>
  )
}

export type DonutSlice = { label: string; value: number; color: string; href?: string }

/** SVG donut with animated sweep, hover focus and an interactive legend. */
export function Donut({ slices, centerLabel, centerValue, size = 168, format = (value: number) => value.toLocaleString("en-IN") }: {
  slices: DonutSlice[]; centerLabel: string; centerValue?: string; size?: number; format?: (value: number) => string
}) {
  const uid = useId().replace(/:/g, "")
  const [focus, setFocus] = useState<number | null>(null)
  const data = slices.filter((slice) => slice.value > 0)
  const total = data.reduce((sum, slice) => sum + slice.value, 0)
  const stroke = 20
  const radius = (size - stroke) / 2 - 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const focused = focus !== null ? data[focus] : null
  if (!total) {
    return <p className="py-10 text-center text-[13px] text-muted-foreground">Nothing to show for this period.</p>
  }
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`${centerLabel}: ${data.map((slice) => `${slice.label} ${format(slice.value)}`).join(", ")}`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
          {data.map((slice, index) => {
            const length = (slice.value / total) * circumference
            const gap = data.length > 1 ? Math.min(3, length * 0.25) : 0
            const element = (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={focus === index ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(0, length - gap)} ${circumference}`}
                strokeDashoffset={-offset}
                opacity={focus === null || focus === index ? 1 : 0.35}
                onMouseEnter={() => setFocus(index)}
                onMouseLeave={() => setFocus(null)}
                style={{ transition: "stroke-width 160ms ease, opacity 160ms ease", animation: `donut-in-${uid} 900ms var(--ease-workspace) both`, animationDelay: `${index * 70}ms`, cursor: "default" }}
              />
            )
            offset += length
            return element
          })}
          <style>{`@keyframes donut-in-${uid} { from { stroke-dasharray: 0 ${circumference}; } }`}</style>
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[20px] font-semibold tabular-nums tracking-tight">{focused ? format(focused.value) : centerValue ?? format(total)}</p>
            <p className="max-w-[92px] truncate text-[11px] text-muted-foreground">{focused ? focused.label : centerLabel}</p>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5">
        {data.map((slice, index) => {
          const share = (slice.value / total) * 100
          const content = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} />
              <span className="min-w-0 flex-1 truncate text-foreground/85">{slice.label}</span>
              <span className="font-semibold tabular-nums">{format(slice.value)}</span>
              <span className="w-11 text-right text-[11.5px] tabular-nums text-muted-foreground">{share.toLocaleString("en-IN", { maximumFractionDigits: 0 })}%</span>
            </>
          )
          const className = cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] transition-colors", focus === index && "bg-foreground/[.04]")
          return (
            <li key={slice.label} onMouseEnter={() => setFocus(index)} onMouseLeave={() => setFocus(null)}>
              {slice.href ? <a href={slice.href} className={cn(className, "hover:bg-foreground/[.04]")}>{content}</a> : <div className={className}>{content}</div>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Horizontal stacked progress of parts of a whole (e.g. ordered → released → delivered). */
export function StackedMeter({ parts, total, format = (value: number) => value.toLocaleString("en-IN") }: {
  parts: Array<{ label: string; value: number; color: string }>; total: number; format?: (value: number) => string
}) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((part) => `${part.label} ${format(part.value)}`).join(", ")}>
        {parts.map((part, index) => (
          <div key={part.label} className="h-full origin-left animate-[bar-grow_800ms_var(--ease-workspace)_both]" style={{ width: `${total ? Math.max(0, Math.min(100, (part.value / total) * 100)) : 0}%`, background: part.color, animationDelay: `${index * 90}ms` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((part) => (
          <span key={part.label} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: part.color }} />
            {part.label} <strong className="font-semibold tabular-nums text-foreground">{format(part.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}
