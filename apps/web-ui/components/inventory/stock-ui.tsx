"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { AlertTriangle, CheckCircle2, Info, Layers, X } from "lucide-react"
import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"

import type { Tone } from "@/lib/api-stock"
import { cn } from "@/lib/utils"

/** Shared look of the stock pages (counts, locations, corrections, stock book): theme tokens only, so
 * light and dark both work, and every colour also carries a word or an icon. */

export const TONE: Record<Tone, { chip: string; panel: string; dot: string; bar: string; ink: string }> = {
  emerald: { chip: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink", panel: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink", dot: "bg-signal-emerald-ink", bar: "bg-signal-emerald-ink", ink: "text-signal-emerald-ink" },
  amber: { chip: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", panel: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", dot: "bg-signal-amber-ink", bar: "bg-signal-amber-ink", ink: "text-signal-amber-ink" },
  rose: { chip: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", panel: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", dot: "bg-signal-rose-ink", bar: "bg-signal-rose-ink", ink: "text-signal-rose-ink" },
  blue: { chip: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink", panel: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink", dot: "bg-signal-blue-ink", bar: "bg-signal-blue-ink", ink: "text-signal-blue-ink" },
  violet: { chip: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink", panel: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink", dot: "bg-signal-violet-ink", bar: "bg-signal-violet-ink", ink: "text-signal-violet-ink" },
  slate: { chip: "border-border bg-muted text-muted-foreground", panel: "border-border bg-muted text-foreground", dot: "bg-muted-foreground", bar: "bg-muted-foreground/30", ink: "text-muted-foreground" },
}

export function Chip({ tone = "slate", icon: Icon, children, className, testId }: { tone?: Tone; icon?: any; children: ReactNode; className?: string; testId?: string }) {
  return (
    <span data-testid={testId} className={cn("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11.5px] font-semibold leading-none", TONE[tone].chip, className)}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : <span className={cn("h-1.5 w-1.5 rounded-full", TONE[tone].dot)} aria-hidden="true" />}
      {children}
    </span>
  )
}

export function Panel({ title, description, action, children, className, bodyClassName, testId, icon: Icon }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; testId?: string; icon?: any
}) {
  return (
    <section data-testid={testId} className={cn("rounded-2xl border border-border bg-card shadow-[var(--shadow-premium)]", className)}>
      {title || action ? (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight text-foreground">{Icon ? <Icon className="h-4 w-4 text-primary" aria-hidden="true" /> : null}{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  )
}

/** A number tile: big value, small label, optional word underneath. */
export function Stat({ label, value, detail, tone = "slate", icon: Icon, testId, className }: { label: string; value: ReactNode; detail?: ReactNode; tone?: Tone; icon?: any; testId?: string; className?: string }) {
  return (
    <div data-testid={testId} className={cn("min-w-0 rounded-xl border border-border bg-card px-3.5 py-3", className)}>
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
        {Icon ? <Icon className={cn("h-3.5 w-3.5", TONE[tone].ink)} aria-hidden="true" /> : <span className={cn("h-1.5 w-1.5 rounded-full", TONE[tone].dot)} aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1 truncate text-[22px] font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      {detail ? <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

/** A thin stacked bar (found / wrong place / missing / still to find); the words sit beside it. */
export function SegmentBar({ parts, className, label }: { parts: Array<{ value: number; tone: Tone }>; className?: string; label?: string }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  return (
    <div className={cn("flex h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="img" aria-label={label}>
      {total > 0 ? parts.filter((part) => part.value > 0).map((part, index) => (
        <span key={index} className={cn("h-full transition-[width] duration-500 ease-out", TONE[part.tone].bar)} style={{ width: `${(part.value / total) * 100}%` }} />
      )) : null}
    </div>
  )
}

/** A message in the page. It stays where it is; only a result the person is waiting for (``mirror``) is
 * also shown in the corner banner by MessageMirror. */
export function Notice({ tone = "slate", icon, title, children, action, className, testId, mirror = false }: { tone?: Tone; icon?: any; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; testId?: string; mirror?: boolean }) {
  const Icon = icon || (tone === "rose" || tone === "amber" ? AlertTriangle : tone === "emerald" ? CheckCircle2 : Info)
  return (
    <div role={tone === "rose" ? "alert" : "status"} data-testid={testId} data-no-mirror={mirror ? undefined : ""} className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 text-[13px] leading-5", TONE[tone].panel, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div> : null}
      </div>
      {/* Phone: the button goes under the words (full width), so the words keep the whole line. */}
      {action ? <div className="flex shrink-0 flex-wrap gap-2 max-sm:w-full max-sm:pl-7 max-sm:[&>*]:flex-1">{action}</div> : null}
    </div>
  )
}

export function EmptyBlock({ icon: Icon = Layers, title, message, action, className, testId }: { icon?: any; title: string; message?: ReactNode; action?: ReactNode; className?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={cn("flex flex-col items-center rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] px-5 py-8 text-center", className)}>
      <span className="grid h-11 w-11 place-items-center rounded-full bg-card text-primary shadow-[var(--shadow-xs)] ring-1 ring-border"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <p className="mt-3 text-[14px] font-semibold text-foreground">{title}</p>
      {message ? <p className="mt-1 max-w-md text-[13px] leading-5 text-muted-foreground">{message}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

/** These pages work on one plant at a time. */
export function PickPlant({ what = "this page" }: { what?: string }) {
  return (
    <EmptyBlock
      testId="stock-pick-plant"
      title="Choose one plant"
      message={`Stock sits in one plant's store, so ${what} opens for one plant. Pick the plant from the plant switcher at the top.`}
    />
  )
}

/** Centered dialog on a desk; a bottom sheet within thumb reach on a phone. */
export function Sheet({ open, onOpenChange, title, description, children, footer, testId, wide }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; testId?: string; wide?: boolean
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="tube-overlay fixed inset-0 z-50 bg-[hsl(224_30%_6%/.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          data-testid={testId}
          className={cn(
            "fixed z-50 flex max-h-[92dvh] flex-col border border-border bg-popover text-popover-foreground shadow-[var(--shadow-pop)] outline-none",
            "inset-x-0 bottom-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)] max-sm:animate-enter-up sm:animate-fade-in",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0",
            wide ? "sm:max-w-2xl" : "sm:max-w-md",
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[16px] font-semibold tracking-tight text-foreground">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Details"}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="-mr-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export const fieldClass = "h-11 w-full rounded-xl border border-input bg-card px-3 text-[14px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15 disabled:opacity-60"

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="text-[12.5px] font-semibold text-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <span className="mt-1 block text-[12px] leading-4 text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/** Segmented tabs that keep 44 px targets. On a phone they are a full-width grid (up to three side by side,
 * more go onto a second row) whose words may wrap, so no option is ever cut off at the screen edge; from sm
 * they size to their words and scroll, or wrap with ``wrap``. */
export function Segmented<T extends string>({ value, onChange, options, label, testId, className, wrap = false, fill = false }: {
  value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode; badge?: ReactNode }>; label: string; testId?: string; className?: string; wrap?: boolean
  /** Phone: the options share the full width (no option cut off at the edge); from sm they size to their words. */
  fill?: boolean
}) {
  const phoneColumns = options.length <= 3 ? options.length : 2
  return (
    <div
      role="tablist"
      aria-label={label}
      data-testid={testId}
      style={{ "--seg-cols": phoneColumns } as CSSProperties}
      className={cn(
        "flex max-w-full gap-1 rounded-xl border border-border bg-muted p-1 max-sm:grid max-sm:w-full max-sm:[grid-template-columns:repeat(var(--seg-cols),minmax(0,1fr))]",
        wrap ? "flex-wrap" : "sm:overflow-x-auto",
        fill && "w-full sm:w-fit",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-semibold transition-colors",
            "max-sm:min-w-0 max-sm:justify-center max-sm:whitespace-normal max-sm:px-2 max-sm:py-1 max-sm:text-center max-sm:leading-tight",
            fill && "min-w-0 flex-1 justify-center px-2 sm:flex-none sm:px-3.5",
            value === option.value ? "bg-card text-foreground shadow-[var(--shadow-sm),0_0_0_1px_hsl(var(--border))]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
          {option.badge}
        </button>
      ))}
    </div>
  )
}

export function Count({ value, tone = "slate" }: { value: number; tone?: Tone }) {
  if (!value) return null
  return <span className={cn("inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums", TONE[tone].chip)}>{value}</span>
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">← {children}</Link>
}
