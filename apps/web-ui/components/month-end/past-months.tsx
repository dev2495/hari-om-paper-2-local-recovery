"use client"

import Link from "next/link"
import { ArrowRight, Clock3, LockKeyhole, LockKeyholeOpen, Minus, Sparkles } from "lucide-react"

import { EmptyQueryState } from "@/components/workspace/query-state"
import { dayText, dayTimeText, personText, qty, type MonthEndMonthRow, type MonthEndMonths } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

function StatusChip({ row }: { row: MonthEndMonthRow }) {
  if (row.status === "CLOSED")
    return <span className="inline-flex h-6 items-center gap-1 rounded-full border border-signal-emerald-line bg-signal-emerald-soft px-2 text-[12px] font-semibold text-signal-emerald-ink"><LockKeyhole className="h-3 w-3" aria-hidden="true" />Closed</span>
  if (row.status === "RUNNING")
    return <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-muted px-2 text-[12px] font-semibold text-muted-foreground"><Clock3 className="h-3 w-3" aria-hidden="true" />Running</span>
  if (!row.has_activity && !row.reopened_at)
    return <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-[hsl(var(--surface-2))] px-2 text-[12px] font-semibold text-muted-foreground"><Minus className="h-3 w-3" aria-hidden="true" />No activity</span>
  if (row.reopened_at)
    return <span className="inline-flex h-6 items-center gap-1 rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 text-[12px] font-semibold text-signal-amber-ink"><LockKeyholeOpen className="h-3 w-3" aria-hidden="true" />Re-opened</span>
  return <span className="inline-flex h-6 items-center gap-1 rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 text-[12px] font-semibold text-signal-amber-ink"><Clock3 className="h-3 w-3" aria-hidden="true" />Not closed</span>
}

export function PastMonths({ data, monthHref }: { data: MonthEndMonths; monthHref: (month: string) => string }) {
  // The running month lives on This month only: Past months lists months that have ended.
  const ended = data.months.filter((row) => row.status !== "RUNNING" && row.month < data.current_month)
  // A month with no store or job card activity has nothing to close: it gets one quiet line, not a card.
  const isIdle = (row: MonthEndMonthRow) => row.status !== "CLOSED" && !row.has_activity && !row.reopened_at
  const rows = ended.filter((row) => !isIdle(row))
  const idle = ended.filter(isIdle)
  if (!ended.length) return <EmptyQueryState title="No past months yet" message="Months appear here once they have ended and the store or a job card had activity in them." />
  return (
    <section className="space-y-2.5" data-testid="month-end-past" aria-label="Past months">
      {rows.map((row) => {
        const units = (row.summary?.units || []).filter((unit) => unit.items_with_use > 0 || unit.issued || unit.actual_used)
        // A month closed once says so in its first line; the history list only adds re-opens and re-closes.
        const showHistory = row.history.length > 1 || (row.history.length === 1 && row.status !== "CLOSED")
        return (
          <article key={row.month} className="rounded-xl border border-border bg-card p-4 shadow-premium" data-testid="month-end-past-row" data-month={row.month}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  {row.month_label}
                  <StatusChip row={row} />
                  {row.is_fy_close && row.status === "CLOSED" ? (
                    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-signal-violet-line bg-signal-violet-soft px-2 text-[12px] font-semibold text-signal-violet-ink">
                      <Sparkles className="h-3 w-3" aria-hidden="true" />Financial year close {row.fy}
                    </span>
                  ) : null}
                </h3>
                <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                  {row.status === "CLOSED"
                    ? `Closed ${dayText(row.closed_at)} by ${personText(row.closed_by)}${row.version && row.version > 1 ? ` · closed ${row.version} times` : ""}`
                    : row.reopened_at
                      ? "Re-opened and still to close."
                      : row.has_activity
                        ? "Ended and still to close."
                        : "Nothing moved in the store and no job card posted spec."}
                </p>
                {row.close_note && row.status === "CLOSED" ? <p className="mt-1 break-words text-[13px]">“{row.close_note}”</p> : null}
              </div>
              <Link href={monthHref(row.month)} className="erp-btn-secondary !h-11 shrink-0 sm:!h-9" aria-label={`View ${row.month_label}`}>
                View <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            {row.summary ? (
              <div className="mt-3 grid gap-2">
                <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
                  <div className="rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2"><dt className="text-muted-foreground">Items used</dt><dd className="font-semibold tabular-nums">{row.summary.items_with_use}</dd></div>
                  <div className="rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2"><dt className="text-muted-foreground">Outside the limit</dt><dd className="font-semibold tabular-nums">{row.summary.over + row.summary.under} <span className="font-normal text-muted-foreground">({row.summary.explained} explained)</span></dd></div>
                </dl>
                {units.length ? (
                  <ul className="grid gap-2 lg:grid-cols-2" aria-label={`${row.month_label} totals per unit`}>
                    {units.map((unit) => (
                      <li key={unit.uom} className="rounded-lg border border-border px-3 py-2" data-testid="month-end-past-unit" data-uom={unit.uom}>
                        <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-bold uppercase text-foreground">{unit.unit_label}</span>
                          {unit.items_with_use} item{unit.items_with_use === 1 ? "" : "s"} used
                        </p>
                        <dl className="mt-1.5 grid grid-cols-3 gap-2 text-[12.5px]">
                          <div className="min-w-0"><dt className="text-muted-foreground">Spec + wastage</dt><dd className="break-words font-semibold tabular-nums">{qty(unit.expected, unit.unit_label)}</dd></div>
                          <div className="min-w-0"><dt className="text-muted-foreground">Issued</dt><dd className="break-words font-semibold tabular-nums">{qty(unit.issued, unit.unit_label)}</dd></div>
                          <div className="min-w-0"><dt className="text-muted-foreground">Used per count</dt><dd className="break-words font-semibold tabular-nums">{unit.actual_used !== null ? qty(unit.actual_used, unit.unit_label) : "Not known"}</dd></div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {showHistory ? (
              <ol className="mt-3 space-y-1.5 border-l border-border pl-3" aria-label={`${row.month_label} history`}>
                {row.history.map((event, index) => (
                  <li key={`${event.event}-${event.at}-${index}`} className="relative text-[12.5px] leading-5">
                    <span className={cn("absolute -left-[17px] top-1.5 h-2 w-2 rounded-full ring-2 ring-card", event.event === "CLOSED" ? "bg-signal-emerald-ink" : "bg-signal-amber-ink")} aria-hidden="true" />
                    <span className="font-semibold">{event.event === "CLOSED" ? "Closed" : "Re-opened"}</span>
                    <span className="text-muted-foreground"> · {dayTimeText(event.at)} · {personText(event.actor)}</span>
                    {event.reason ? <span className="block break-words text-foreground">“{event.reason}”</span> : null}
                    {event.details?.backfilled ? <span className="block text-[12px] text-muted-foreground">Closed before close history was kept.</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </article>
        )
      })}
      {idle.length ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] px-4 py-2 text-[12.5px] text-muted-foreground" data-testid="month-end-past-idle">
          <span className="inline-flex items-center gap-1 font-semibold"><Minus className="h-3.5 w-3.5" aria-hidden="true" />No activity, nothing to close:</span>
          {idle.map((row, index) => (
            <Link key={row.month} href={monthHref(row.month)} className="inline-flex min-h-[44px] items-center font-medium text-foreground underline-offset-2 hover:text-primary hover:underline sm:min-h-[32px]" data-month={row.month}>
              {row.month_label}{index < idle.length - 1 ? "," : ""}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
