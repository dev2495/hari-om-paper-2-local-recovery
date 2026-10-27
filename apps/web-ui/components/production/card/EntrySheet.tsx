"use client"

// The floor forms open in one place: a side panel on a PC, the whole screen on a phone.
// Stage tabs sit across the top; a stage that cannot take an entry says why instead of hiding.

import type { ReactNode } from "react"
import { Lock } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { STAGE_ICON, fmt, stageLabel } from "./model"

export function EntrySheet({
  open,
  onOpenChange,
  title,
  subtitle,
  tone = "primary",
  children,
  footer,
  testId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  subtitle?: ReactNode
  tone?: "primary" | "amber"
  children: ReactNode
  footer?: ReactNode
  testId?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="tube-sheet-right !left-auto !right-0 !top-0 !flex !h-dvh !max-h-dvh !w-full !max-w-none !translate-x-0 !translate-y-0 !flex-col !gap-0 !rounded-none !border-0 !p-0 md:!w-[min(720px,100vw)] md:!rounded-l-2xl md:!border-l"
        data-testid={testId}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className={cn("flex items-start gap-3 border-b border-border py-3 pl-4 pr-12 sm:pl-5", tone === "amber" ? "bg-signal-amber-soft/40" : "bg-primary/[.04]")}>
          <div className="min-w-0 flex-1">
            <DialogTitle className="!text-[17px] font-semibold tracking-tight">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 !text-[12.5px] text-muted-foreground">{subtitle || " "}</DialogDescription>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
        {footer ? <div className="border-t border-border bg-card px-4 py-3 sm:px-5 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  )
}

export type StageTab = { stage: string; status: string; good?: number; target?: number; unit?: string; disabled?: string; badge?: string }

/** Stage chips across the top of a form. Disabled ones say why (closed, not open yet, no QC checks). */
export function FormStageTabs({ tabs, value, onChange, ariaLabel = "Stage" }: { tabs: StageTab[]; value: string; onChange: (stage: string) => void; ariaLabel?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" data-testid="form-stage-tabs">
      {tabs.map((tab) => {
        const Icon = STAGE_ICON[tab.stage]
        const active = tab.stage === value
        return (
          <button
            key={tab.stage}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={Boolean(tab.disabled)}
            disabled={Boolean(tab.disabled)}
            title={tab.disabled || undefined}
            onClick={() => (tab.disabled ? undefined : onChange(tab.stage))}
            data-testid={`form-stage-${tab.stage.toLowerCase()}`}
            className={cn(
              "flex min-w-[8.25rem] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition",
              active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card hover:bg-muted",
              tab.disabled ? "cursor-not-allowed opacity-60 hover:bg-card" : "",
            )}
          >
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", active ? "bg-primary-foreground/15" : "bg-muted")}>
              {tab.disabled ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                {stageLabel(tab.stage)}
                {tab.badge ? <span className={cn("rounded-full px-1.5 text-[10.5px] font-bold", active ? "bg-primary-foreground/20" : "bg-signal-amber-soft text-signal-amber-ink")}>{tab.badge}</span> : null}
              </span>
              <span className={cn("block truncate text-[11.5px] tabular-nums", active ? "opacity-90" : "text-muted-foreground")}>
                {tab.disabled ? tab.disabled : tab.target != null ? `${fmt(tab.good)} of ${fmt(tab.target)} ${tab.unit || ""} good` : tab.status.toLowerCase()}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** A segmented choice (shift, date) with big targets for a phone. */
export function Segmented<T extends string>({ options, value, onChange, label, testId }: { options: Array<{ value: T; label: string; sub?: string }>; value: T; onChange: (value: T) => void; label: string; testId?: string }) {
  return (
    <div role="group" aria-label={label} className="grid gap-1.5 rounded-xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} data-testid={testId}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn("flex min-h-11 flex-col items-center justify-center rounded-lg px-2 py-1 text-[14px] font-semibold leading-tight transition", value === option.value ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}
        >
          {option.label}
          {option.sub ? <span className="text-[11px] font-medium opacity-80">{option.sub}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Round choice chips (machine, operator, rejection reason) — one tap on a phone. */
export function Chips({ options, value, onChange, label, tone = "primary", testId, allowClear = true }: { options: Array<{ value: string; label: string; sub?: string }>; value: string; onChange: (value: string) => void; label: string; tone?: "primary" | "rose"; testId?: string; allowClear?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2" data-testid={testId}>
      {options.map((option) => {
        const on = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on && allowClear ? "" : option.value)}
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition",
              on ? (tone === "rose" ? "border-signal-rose-ink bg-signal-rose-ink text-white" : "border-primary bg-primary text-primary-foreground") : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {option.sub ? <strong>{option.label}</strong> : option.label}
            {option.sub ? <span className={cn("text-[12px]", on ? "opacity-90" : "text-muted-foreground")}>{option.sub}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export const fieldLabel = "mb-1 block text-[12.5px] font-semibold text-muted-foreground"
export const selectClass = "h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px]"
export const bigNumberClass = "h-14 w-full rounded-xl border border-border bg-background px-3 text-right text-[26px] font-bold tabular-nums tracking-tight"
