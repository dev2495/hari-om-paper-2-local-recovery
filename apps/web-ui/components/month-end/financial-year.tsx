"use client"

import Link from "next/link"
import { ChevronLeft, ChevronRight, CircleDot, Clock3, LockKeyhole, Minus, Sparkles } from "lucide-react"

import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useMonthEndYear } from "@/hooks/use-month-end"
import { dayText, monthEndErrorText, qty, signedQty, unitFloorWords, type MonthEndYear, type MonthEndYearMonth } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

import { Section } from "./parts"

const MONTH_STATE: Record<MonthEndYearMonth["status"] | "QUIET", { word: string; icon: typeof LockKeyhole; tile: string }> = {
  CLOSED: { word: "Closed", icon: LockKeyhole, tile: "border-signal-emerald-line bg-signal-emerald-soft/70 text-signal-emerald-ink" },
  OPEN: { word: "To close", icon: Clock3, tile: "border-signal-amber-line bg-signal-amber-soft/70 text-signal-amber-ink" },
  RUNNING: { word: "Running", icon: CircleDot, tile: "border-primary/40 bg-primary/[.06] text-primary" },
  FUTURE: { word: "Not started", icon: Minus, tile: "border-dashed border-border bg-card text-muted-foreground" },
  QUIET: { word: "No activity", icon: Minus, tile: "border-border bg-[hsl(var(--surface-2))] text-muted-foreground" },
}

type TotalKey = "opening" | "received" | "sent_back" | "issued" | "corrections" | "closing"

/** FY totals per unit as one statement card each (a kg total never includes pieces). */
function YearTotals({ year }: { year: MonthEndYear }) {
  if (!year.totals.length) {
    return <p className="rounded-xl border border-dashed border-border px-3 py-4 text-[13px] text-muted-foreground">No store figures for this financial year yet.</p>
  }
  const store: Array<[TotalKey, string, string?]> = [
    ["opening", year.opening_label || `Opening ${dayText(year.period_start)}`],
    ["received", "Received", "+"],
    ["sent_back", "Sent back", "−"],
    ["issued", "Issued to floor", "−"],
    ["corrections", "Count and corrections", "±"],
    ["closing", year.closing_label, "="],
  ]
  return (
    <div className="grid gap-3" data-testid="month-end-year-totals">
      {year.totals.map((unit) => {
        const floor = unitFloorWords(unit, unit.unit_label)
        return (
          <article key={unit.uom} className="rounded-xl border border-border p-3 sm:p-4" data-testid="month-end-year-unit" data-uom={unit.uom}>
            <h4 className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-wide text-foreground">{unit.unit_label}</span>
              Totals in {unit.unit_label}
              <span className="font-normal">· {unit.months === 1 ? "1 month" : `${unit.months} months`} with store figures</span>
            </h4>
            <dl className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 xl:grid-cols-6">
              {store.map(([key, label, sign]) => (
                <div key={key} className={cn("min-w-0 rounded-lg px-2.5 py-2 ring-1 ring-inset ring-border/60 sm:px-3", key === "closing" ? "bg-primary/[.06]" : "bg-[hsl(var(--surface-2))]")}>
                  <dt className="text-[12px] leading-4 text-muted-foreground">
                    {sign ? <span className="mr-1 font-semibold text-foreground/70" aria-hidden="true">{sign}</span> : null}
                    {label}
                  </dt>
                  <dd className="mt-0.5 break-words text-[15px] font-semibold leading-tight tabular-nums">
                    {key === "corrections" ? signedQty(unit.corrections, unit.unit_label) : qty(unit[key], unit.unit_label)}
                  </dd>
                  {/* Received includes opening loads, as in the stock book and the sources drawer (checker 2026-10-30). */}
                  {key === "received" && Number(unit.opening_loads || 0) > 0 ? (
                    <p className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground" data-testid="month-end-year-opening-loads">of which opening loads {qty(unit.opening_loads, unit.unit_label)}</p>
                  ) : null}
                </div>
              ))}
            </dl>
            <dl className="mt-1.5 grid grid-cols-2 gap-1.5 sm:mt-2 sm:grid-cols-3 sm:gap-2">
              <div className="min-w-0 rounded-lg border border-dashed border-border px-2.5 py-2 sm:px-3">
                <dt className="text-[12px] leading-4 text-muted-foreground">Spec (good tubes)</dt>
                <dd className="mt-0.5 break-words text-[15px] font-semibold leading-tight tabular-nums">{qty(unit.spec, unit.unit_label)}</dd>
              </div>
              <div className="min-w-0 rounded-lg border border-dashed border-border px-2.5 py-2 sm:px-3">
                <dt className="text-[12px] leading-4 text-muted-foreground">Spec + wastage</dt>
                <dd className="mt-0.5 break-words text-[15px] font-semibold leading-tight tabular-nums">{qty(unit.expected, unit.unit_label)}</dd>
              </div>
              <div className="col-span-2 min-w-0 rounded-lg border border-dashed border-border px-2.5 py-2 sm:col-span-1 sm:px-3">
                <dt className="text-[12px] leading-4 text-muted-foreground">Floor against spec + wastage</dt>
                <dd className={cn("mt-0.5 break-words font-semibold leading-tight", floor.outside ? "text-[13.5px] text-signal-amber-ink" : "text-[15px]")} data-testid="month-end-year-floor">
                  {floor.short}
                </dd>
              </div>
            </dl>
          </article>
        )
      })}
    </div>
  )
}

export function FinancialYear({ plantId, fy, onFy, monthHref }: { plantId: string; fy?: string; onFy: (fy: string) => void; monthHref: (month: string) => string }) {
  const query = useMonthEndYear(fy, plantId)
  if (query.isLoading) return <LoadingState label="Adding up the financial year…" />
  if (query.isError || !query.data) return <ErrorState title="The financial year could not be loaded" message={monthEndErrorText(query.error)} onRetry={() => query.refetch()} />
  const year = query.data
  const march = year.months[year.months.length - 1]
  return (
    <div className="space-y-4" data-testid="month-end-year">
      <Section
        title={`Financial year ${year.fy}`}
        subtitle={`${dayText(year.period_start)} to ${dayText(year.period_end)} · ${year.closed_months} of 12 months closed. 1 April opens from 31 March's close.`}
        action={
          <div className="flex items-center gap-1.5">
            <button type="button" className="erp-btn-secondary !h-11 !w-11 !px-0 sm:!h-9 sm:!w-9" onClick={() => onFy(year.previous_fy)} aria-label={`Financial year ${year.previous_fy}`}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-[5.5rem] text-center text-[13px] font-semibold tabular-nums">{year.fy}</span>
            <button type="button" className="erp-btn-secondary !h-11 !w-11 !px-0 sm:!h-9 sm:!w-9" onClick={() => year.next_fy && onFy(year.next_fy)} disabled={!year.next_fy} aria-label={year.next_fy ? `Financial year ${year.next_fy}` : "No later financial year yet"}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        }
      >
        <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-12" aria-label="Months of the financial year">
          {year.months.map((month, index) => {
            // An ended month with no store movement and no spec has nothing to close: quiet, not pending work.
            const quiet = month.status === "OPEN" && !month.has_activity
            const style = MONTH_STATE[quiet ? "QUIET" : month.status]
            const Icon = style.icon
            const isMarch = index === 11
            const body = (
              <>
                <span className="flex items-center justify-between gap-1">
                  <span className="text-[13px] font-semibold text-foreground">{month.short_label}</span>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-[12px] font-semibold">{style.word}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {month.status === "CLOSED"
                    ? dayText(month.closed_at)
                    : month.needs_note
                      ? `${month.needs_note} need${month.needs_note === 1 ? "s" : ""} a note`
                      : isMarch
                        ? "Year close"
                        : month.status === "RUNNING"
                          ? "So far"
                          : quiet
                            ? " "
                            : month.status === "OPEN"
                              ? month.actual_known ? "Ready to close" : "Count needed"
                              : " "}
                </span>
              </>
            )
            return (
              <li key={month.month} data-testid="month-end-year-month" data-status={month.status}>
                {month.status === "FUTURE" ? (
                  <div className={cn("block min-h-[76px] rounded-xl border p-2.5", style.tile)} aria-label={`${month.month_label}: not started`}>{body}</div>
                ) : (
                  <Link href={monthHref(month.month)} className={cn("block min-h-[76px] rounded-xl border p-2.5 transition hover:shadow-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", style.tile, isMarch && "ring-1 ring-inset ring-signal-violet-line")} aria-label={`${month.month_label}: ${style.word}`}>
                    {body}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
        <p className={cn("mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium", year.march_closed ? "bg-signal-violet-soft text-signal-violet-ink" : "bg-muted text-muted-foreground")}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {year.march_closed ? `Financial year close ${year.fy} done (${dayText(march.closed_at)}).` : `Closing March is the financial year close ${year.fy}.`}
        </p>
      </Section>
      <Section title="Year totals" subtitle="Per unit; a kg total never includes pieces. Opening is the book stock on 1 April; closing is the latest month with store figures, and 31 March once March is closed.">
        <YearTotals year={year} />
      </Section>
    </div>
  )
}
