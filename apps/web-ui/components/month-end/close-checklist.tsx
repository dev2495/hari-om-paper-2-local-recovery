"use client"

import Link from "next/link"
import { useState } from "react"
import { AlertTriangle, ArrowRight, Ban, Check, Clock3, LoaderCircle, LockKeyhole, LockKeyholeOpen, RotateCcw } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import { useCloseMonth, useReopenMonth } from "@/hooks/use-month-end"
import { describeApiError } from "@/lib/api-error"
import { monthText, qty, type MonthEndOverview } from "@/lib/api-month-end"
import { peopleInText } from "@/lib/people"
import { cn } from "@/lib/utils"

function StepLink({ href, label }: { href: string; label: string }) {
  if (href.startsWith("#")) {
    return (
      <a href={href} className="mt-1 inline-flex min-h-11 items-center gap-1 self-start text-[12.5px] font-semibold text-primary hover:underline">
        {label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    )
  }
  return (
    <Link href={href} className="mt-1 inline-flex min-h-11 items-center gap-1 self-start text-[12.5px] font-semibold text-primary hover:underline">
      {label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  )
}

/** The close checklist (spec 2.6): each condition as a step, progress, and one Next action. */
export function CloseChecklist({ view, onClose, onReopen, monthHref }: { view: MonthEndOverview; onClose: () => void; onReopen: () => void; monthHref: (href: string) => string }) {
  const { done, total } = view.progress
  const percent = total ? Math.round((done / total) * 100) : 0
  const closed = view.state === "CLOSED"
  const next = view.next
  const nextHref = next.action_href ? monthHref(next.action_href) : null
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-premium sm:p-5" data-testid="month-end-checklist" aria-labelledby="checklist-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="checklist-title" className="text-[15px] font-semibold tracking-tight">{closed ? "Closed" : "Close checklist"}</h2>
        <span className="text-[12.5px] font-medium tabular-nums text-muted-foreground">{done} of {total} done</span>
      </div>
      <div
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${done} of ${total} close steps done`}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", closed ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${percent}%` }} />
      </div>
      <ol
        className={cn(
          "mt-4 grid grid-cols-2 gap-2 sm:gap-2.5 [&>li:last-child:nth-child(odd)]:col-span-2",
          view.checklist.length === 5 ? "xl:grid-cols-5 xl:[&>li:last-child:nth-child(odd)]:col-span-1" : "xl:grid-cols-4",
        )}
      >
        {view.checklist.map((step, index) => (
          <li
            key={step.key}
            data-testid={`month-end-step-${step.key}`}
            data-state={step.state}
            className={cn(
              "flex min-w-0 flex-col rounded-xl border p-2.5 transition sm:p-3",
              step.state === "done" && (step.warning ? "border-signal-amber-line bg-signal-amber-soft/60" : "border-signal-emerald-line bg-signal-emerald-soft/70"),
              step.state === "now" && "border-primary/60 bg-card shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]",
              step.state === "todo" && "border-border bg-card",
            )}
          >
            <p className="flex items-start gap-2 text-[13px] font-semibold leading-tight sm:items-center sm:text-[13.5px]">
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
                  step.state === "done" ? "bg-signal-emerald-ink text-card" : step.state === "now" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {step.state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span className="min-w-0">{step.label}</span>
              <span className="sr-only">{step.state === "done" ? " (done)" : step.state === "now" ? " (next)" : " (to do)"}</span>
            </p>
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-[1.15rem] text-muted-foreground sm:text-[12.5px] sm:leading-5">
              {step.blocked && step.state !== "done" ? <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              <span>{peopleInText(step.detail)}</span>
            </p>
            {step.warning ? (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-signal-amber-ink">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Check below
              </p>
            ) : null}
            {step.action_label && step.action_href && step.state !== "done" ? <StepLink href={monthHref(step.action_href)} label={step.action_label} /> : null}
          </li>
        ))}
      </ol>
      {/* A done step that still needs the Owner's eye: full width, so the step cards stay even. */}
      {view.checklist.filter((step) => step.warning).map((step) => (
        <p
          key={`${step.key}-warning`}
          className="mt-2.5 flex items-start gap-2 rounded-xl border border-signal-amber-line bg-signal-amber-soft px-3.5 py-2.5 text-[12.5px] leading-5 text-signal-amber-ink"
          role="status"
          data-testid={`month-end-step-${step.key}-warning`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold">{step.label}:</strong> {step.warning}</span>
        </p>
      ))}

      <div
        data-testid="month-end-next"
        data-kind={next.kind}
        className={cn(
          "mt-4 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          next.kind === "closed"
            ? "border-signal-emerald-line bg-signal-emerald-soft"
            : next.kind === "close"
              ? "border-primary/40 bg-primary/[.07]"
              : next.kind === "month_ended"
                ? "border-border bg-[hsl(var(--surface-2))]"
                : "border-primary/30 bg-primary/[.05]",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", next.kind === "closed" ? "bg-signal-emerald-ink text-card" : next.kind === "month_ended" ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground")} aria-hidden="true">
            {next.kind === "closed" ? <LockKeyhole className="h-4 w-4" /> : next.kind === "month_ended" ? <Clock3 className="h-4 w-4" /> : next.kind === "close" ? <LockKeyhole className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-snug">{next.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{peopleInText(next.detail)}</p>
            {next.waiting_for ? <p className="mt-1 text-[12px] font-medium text-muted-foreground">{next.waiting_for}</p> : null}
          </div>
        </div>
        {next.kind === "closed" && view.can.reopen ? (
          <button type="button" className="erp-btn-secondary !h-11 w-full sm:w-auto" onClick={onReopen} data-testid="month-end-reopen">
            <LockKeyholeOpen className="h-4 w-4" aria-hidden="true" />Re-open month
          </button>
        ) : next.kind === "close" && view.can.close ? (
          <button type="button" className="erp-btn-primary !h-11 w-full sm:w-auto" onClick={onClose} data-testid="month-end-close-next">
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />{next.action_label || view.close_title}
          </button>
        ) : next.action_label && nextHref ? (
          nextHref.startsWith("#") ? (
            <a href={nextHref} className="erp-btn-primary !h-11 w-full sm:w-auto">{next.action_label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
          ) : (
            <Link href={nextHref} className="erp-btn-primary !h-11 w-full sm:w-auto">{next.action_label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          )
        ) : null}
      </div>
    </section>
  )
}

/**
 * Sticky bottom close bar, shown only while the checklist's Next card is out of view: what closing
 * needs, and the Owner's button. Everyone else sees who closes the month instead of a button they cannot
 * use (spec 2.8).
 */
export function CloseBar({ view, onClose }: { view: MonthEndOverview; onClose: () => void }) {
  if (view.state === "CLOSED") return null
  const pending = view.checklist.filter((step) => step.state !== "done")
  const owner = view.can.is_owner
  const reason = view.state === "RUNNING" ? `${view.month_label} is still running.` : pending.length ? pending[0].detail : owner ? "Everything is ready." : "Everything is ready for the Owner to close it."
  return (
    <div
      className="sticky bottom-2 z-20 rounded-xl border border-border bg-card/95 px-3.5 py-2.5 shadow-pop backdrop-blur [margin-bottom:env(safe-area-inset-bottom)] sm:px-4 sm:py-3"
      data-testid="month-end-close-bar"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{view.is_fy_close ? `${view.month_label} · financial year ${view.fy}` : view.month_label}</p>
          <p className="line-clamp-2 text-[12px] leading-[1.35rem] text-muted-foreground sm:text-[12.5px]">{reason}</p>
        </div>
        {owner ? (
          <button
            type="button"
            className="erp-btn-primary !h-11 shrink-0"
            disabled={!view.can.close}
            onClick={onClose}
            title={view.can.close ? undefined : reason}
            data-testid="month-end-close"
          >
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            <span className="sm:hidden">Close</span>
            <span className="hidden sm:inline">{view.close_title}</span>
          </button>
        ) : (
          <p className="inline-flex max-w-[11rem] shrink-0 items-center gap-1.5 text-right text-[12px] font-medium leading-4 text-muted-foreground" data-testid="month-end-owner-closes">
            <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Only the Owner closes the month
          </p>
        )}
      </div>
    </div>
  )
}

export function CloseDialog({ view, plantId, open, onOpenChange }: { view: MonthEndOverview; plantId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { showToast } = useApp()
  const [note, setNote] = useState("")
  const [accepted, setAccepted] = useState(false)
  const close = useCloseMonth(plantId)
  const changed = view.changed_since_count || []
  const submit = () =>
    close.mutate(
      { month: view.month, note: note.trim() || null, ...(changed.length ? { accept_count_changes: accepted } : {}) },
      {
        onSuccess: () => {
          showToast(view.is_fy_close ? `Financial year ${view.fy} closed. 1 April opens from this close.` : `${view.month_label} is closed. Entries dated in it are now locked.`, "success")
          setNote("")
          setAccepted(false)
          onOpenChange(false)
        },
        onError: (error) => showToast(describeApiError(error, "The month could not be closed"), "error"),
      },
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl" data-testid="month-end-close-dialog">
        <DialogTitle className="text-[17px] font-semibold">{view.close_title}</DialogTitle>
        <DialogDescription className="text-[13px] leading-5 text-muted-foreground">
          The figures, statuses, limits and notes are frozen as they are now. Floor entries and store movements dated in {view.month_word} are refused until the Owner re-opens it.
          {view.is_fy_close ? ` This also closes the financial year ${view.fy}; 1 April opens from this close.` : ""}
        </DialogDescription>
        {changed.length ? (
          <div className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-3 py-2.5" data-testid="month-end-close-count-changed">
            <p className="flex items-start gap-1.5 text-[12.5px] font-semibold leading-5 text-signal-amber-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Store entries dated in {view.month_word} were posted after the count was approved. These closings are not what was counted:
            </p>
            <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pl-6 text-[12.5px] leading-5 text-foreground">
              {changed.map((row) => (
                <li key={row.item_code} className="break-words">
                  <span className="font-semibold">{row.item_name}</span>: counted {qty(row.counted, row.unit_label)}, closing now {qty(row.closing, row.unit_label)}
                </li>
              ))}
            </ul>
            <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-2.5 text-[12.5px] font-medium leading-5 text-foreground">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" data-testid="month-end-close-accept" />
              I have checked these entries. Close with the new closing figures.
            </label>
          </div>
        ) : null}
        <label className="grid gap-1.5 text-[12.5px] font-medium">
          Closing note (optional)
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} className="min-h-[44px] rounded-lg border border-input bg-card px-3 py-2 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40" placeholder="e.g. Checked with the plant head" />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="erp-btn-secondary !h-11" onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className="erp-btn-primary !h-11" onClick={submit} disabled={close.isPending || (changed.length > 0 && !accepted)} data-testid="month-end-close-confirm">
            {close.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
            {view.close_title}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ReopenDialog({ view, plantId, open, onOpenChange }: { view: MonthEndOverview; plantId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { showToast } = useApp()
  const [reason, setReason] = useState("")
  const reopen = useReopenMonth(plantId)
  const later = view.later_closed_months || []
  const valid = reason.trim().length >= 3
  const submit = () =>
    reopen.mutate(
      { month: view.month, reason: reason.trim() },
      {
        onSuccess: (result) => {
          const months = (result.reopened_months || [view.month]).map(monthText)
          showToast(`Re-opened ${months.join(", ")}.`, "success")
          setReason("")
          onOpenChange(false)
        },
        onError: (error) => showToast(describeApiError(error, "The month could not be re-opened"), "error"),
      },
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl" data-testid="month-end-reopen-dialog">
        <DialogTitle className="text-[17px] font-semibold">Re-open {view.month_label}?</DialogTitle>
        <DialogDescription className="text-[13px] leading-5 text-muted-foreground">
          Entries dated in {view.month_word} will be allowed again and the figures go back to live. The close stays in the history.
        </DialogDescription>
        {later.length ? (
          <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] leading-5 text-signal-amber-ink" role="alert">
            {later.length === 1 ? `${monthText(later[0])} is closed after it, so it re-opens too.` : `${later.map(monthText).join(", ")} are closed after it, so they re-open too (newest first).`}
          </p>
        ) : null}
        <label className="grid gap-1.5 text-[12.5px] font-medium">
          Reason (required)
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} className="min-h-[44px] rounded-lg border border-input bg-card px-3 py-2 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40" placeholder="e.g. Late GRN for kraft 351 found after the close" aria-invalid={!valid && reason.length > 0} />
          {!valid && reason.length > 0 ? <span className="text-[12px] font-normal text-signal-rose-ink">Write at least a few words.</span> : null}
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="erp-btn-secondary !h-11" onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className="erp-btn-primary !h-11" onClick={submit} disabled={!valid || reopen.isPending} data-testid="month-end-reopen-confirm">
            {reopen.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Re-open {later.length ? `${later.length + 1} months` : view.month_word}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
