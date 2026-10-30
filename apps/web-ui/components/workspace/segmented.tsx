"use client"

import { useRef, type KeyboardEvent, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type SegmentOption<T extends string> = {
  value: T
  label: ReactNode
  /** Optional leading icon (always beside a word, never alone). */
  icon?: LucideIcon
  /** A small count after the label; hidden when undefined. */
  count?: number
  /** Show the count as needing attention (rose) instead of neutral. */
  alert?: boolean
  /** A short second line (e.g. a date under a shift name). */
  sub?: ReactNode
  disabled?: boolean
  testId?: string
}

/**
 * The one segmented control for tabs and choices (client 2026-10-28: one style everywhere).
 *
 * - The active segment is a raised card pill on a muted track, in light and dark mode.
 * - 44 px tall on a phone, 36 px from the small breakpoint up; the track scrolls sideways instead of
 *   wrapping, so the page itself never scrolls sideways.
 * - `kind="tabs"` is a tablist (page sections); `kind="choice"` is a radio group (filters, views).
 *   Arrow keys, Home and End move between segments; only the active one is in the tab order.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  kind = "tabs",
  fill = false,
  className,
  testId,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<SegmentOption<T>>
  /** What the segments choose, read by screen readers ("Stock sections"). */
  label: string
  kind?: "tabs" | "choice"
  /** Equal-width segments across the full width on a phone; natural width from the small breakpoint up. */
  fill?: boolean
  className?: string
  testId?: string
}) {
  const track = useRef<HTMLDivElement | null>(null)
  const enabled = options.filter((option) => !option.disabled)

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]
    if (!keys.includes(event.key) || !enabled.length) return
    event.preventDefault()
    const at = Math.max(0, enabled.findIndex((option) => option.value === value))
    const next = event.key === "Home" ? 0
      : event.key === "End" ? enabled.length - 1
      : event.key === "ArrowRight" || event.key === "ArrowDown" ? (at + 1) % enabled.length
      : (at - 1 + enabled.length) % enabled.length
    const target = enabled[next]
    onChange(target.value)
    const button = track.current?.querySelector<HTMLButtonElement>(`[data-segment="${CSS.escape(target.value)}"]`)
    button?.focus()
    button?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }

  return (
    <div
      ref={track}
      role={kind === "tabs" ? "tablist" : "radiogroup"}
      aria-label={label}
      data-testid={testId}
      className={cn(
        "flex max-w-full gap-1 overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        fill ? "w-full sm:inline-flex sm:w-auto" : "w-fit",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role={kind === "tabs" ? "tab" : "radio"}
            aria-selected={kind === "tabs" ? active : undefined}
            aria-checked={kind === "choice" ? active : undefined}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            data-segment={option.value}
            data-state={active ? "active" : "inactive"}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            onKeyDown={move}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13.5px] font-semibold",
              "transition-[background-color,color,box-shadow] duration-150 sm:min-h-9 sm:text-[13px]",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-muted",
              "disabled:cursor-not-allowed disabled:opacity-50",
              option.sub ? "flex-col gap-0 py-1 leading-tight" : "",
              fill ? "min-w-0 flex-1 sm:flex-none" : "",
              active
                ? "bg-card text-foreground shadow-[var(--shadow-sm),0_0_0_1px_hsl(var(--border))]"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
              <span className="truncate">{option.label}</span>
              {option.count !== undefined ? (
                <span
                  className={cn(
                    "inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                    option.alert ? "bg-signal-rose-soft text-signal-rose-ink" : active ? "bg-muted text-foreground" : "bg-foreground/[.06] text-muted-foreground",
                  )}
                >
                  {option.count}
                </span>
              ) : null}
            </span>
            {option.sub ? <span className="text-[11px] font-medium opacity-80">{option.sub}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
