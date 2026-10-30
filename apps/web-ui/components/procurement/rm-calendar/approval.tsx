"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, CircleDashed, ClipboardCheck, Lightbulb, Plus, ShieldCheck } from "lucide-react"

import { MessageBar, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useProposeArrivals, useUpdateArrival } from "@/hooks/use-rm-calendar"
import { apiErrorText, type CalendarData, type PendingArrival, type Suggestion } from "@/lib/api-rm-calendar"
import { cn } from "@/lib/utils"

import type { Notice, Vendor } from "./detail-sheet"
import { longDate, perUnit, qty, rateText, rupees, shortDate, weekStart } from "./format"
import { Sheet } from "./sheet"

/** Sticky bottom bar for the Owner: how many arrivals wait, with Review and Approve all. One 56 px
 * row on a phone. Arrivals without a vendor cannot go on a PO, so the bar says so and Review leads. */
export function OwnerBar({ pending, visible, onReview, onApproveAll, busy }: {
  pending: CalendarData["pending_approval"]
  visible: PendingArrival[]
  onReview: () => void
  onApproveAll: () => void
  busy: boolean
}) {
  if (!pending.count) return null
  const ready = visible.filter((row) => row.supplier_id)
  const needVendor = visible.length - ready.length
  const late = visible.filter((row) => row.late).length
  const units = visible.reduce((totals, row) => ({ ...totals, [row.uom]: (totals[row.uom] || 0) + row.qty }), {} as Record<string, number>)
  const vendors = new Set(visible.map((row) => row.supplier_name).filter(Boolean))
  const detail = [
    visible.length !== pending.count ? `${visible.length} in this view · Review shows all ${pending.count}` : null,
    perUnit(units),
    vendors.size ? `${vendors.size} vendor${vendors.size === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ")
  return (
    <div className="sticky bottom-3 z-30 mt-4" data-testid="rm-owner-bar">
      <div role="region" aria-label="Arrivals waiting for your approval" className="flex items-center justify-between gap-2 rounded-2xl border border-signal-violet-line bg-card/95 px-2.5 py-1 shadow-[var(--shadow-premium)] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:gap-3 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal-violet-soft text-signal-violet-ink sm:grid"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold text-foreground sm:text-[14px]">
              <span className="sm:hidden">{pending.count} waiting</span>
              <span className="hidden sm:inline">{pending.count} arrival{pending.count === 1 ? "" : "s"} waiting for your approval</span>
            </p>
            <p className="truncate text-[12px] text-muted-foreground">
              {needVendor ? <span className="font-semibold text-signal-amber-ink">{needVendor} need{needVendor === 1 ? "s" : ""} a vendor<span className="hidden sm:inline"> before approval</span></span> : null}
              {needVendor && (late || detail) ? " · " : null}
              {late ? <span className="font-semibold text-signal-rose-ink">{late} late</span> : null}
              {late && detail ? " · " : null}
              <span className={needVendor || late ? "hidden sm:inline" : undefined}>{detail}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className={cn(needVendor && !ready.length ? primaryButton : secondaryButton, "px-3")} onClick={onReview}>
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />Review
          </button>
          {ready.length ? (
            <button type="button" className={cn(primaryButton, "px-3")} disabled={busy} onClick={onApproveAll}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {busy ? "Approving…" : needVendor || visible.length !== pending.count
                ? <><span className="sm:hidden">Approve {ready.length}</span><span className="hidden sm:inline">Approve {ready.length} with a vendor</span></>
                : <><span className="sm:hidden">Approve all</span><span className="hidden sm:inline">Approve all</span></>}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Owner review: every waiting arrival, grouped by PO week, with its rate and value, a vendor picker
 * for arrivals that have none, and select / approve week / approve selected. Read-only for the desk. */
export function ReviewSheet({ open, onOpenChange, pending, today, onApprove, busy, canApprove, canPropose, vendors, onNotice }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: PendingArrival[]
  today: string
  onApprove: (rows: PendingArrival[]) => void
  busy: boolean
  canApprove: boolean
  canPropose: boolean
  vendors: Vendor[]
  onNotice: (notice: Notice) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const update = useUpdateArrival()
  // Tick every arrival with a vendor once, when the sheet opens. A refetch while it is open (a vendor
  // picked here, any other refresh) keeps the Owner's choices: it only drops rows no longer waiting,
  // so an arrival he unticked is never approved behind his back (checker 2026-10-28).
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) setSelected(new Set(pending.filter((row) => row.supplier_id).map((row) => row.entry_id)))
    else if (open) setSelected((current) => {
      const waiting = new Set(pending.map((row) => row.entry_id))
      const next = new Set(Array.from(current).filter((id) => waiting.has(id)))
      return next.size === current.size ? current : next
    })
    wasOpen.current = open
  }, [open, pending])
  const weeks = useMemo(() => {
    const groups = new Map<string, PendingArrival[]>()
    for (const row of [...pending].sort((a, b) => a.date.localeCompare(b.date))) {
      const key = weekStart(row.date < today ? today : row.date)
      groups.set(key, [...(groups.get(key) || []), row])
    }
    return Array.from(groups.entries())
  }, [pending, today])
  const chosen = pending.filter((row) => selected.has(row.entry_id) && row.supplier_id)
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const value = chosen.reduce((sum, row) => sum + Number(row.value || 0), 0)
  const rateNeeded = chosen.filter((row) => !row.rate).length
  async function pickVendor(row: PendingArrival, vendorId: string) {
    const vendor = vendors.find((option) => String(option.id) === vendorId)
    if (!vendor) return
    try {
      await update.mutateAsync({ id: row.entry_id, supplier_id: vendor.id, supplier_name: vendor.name })
      setSelected((current) => new Set(current).add(row.entry_id))
      onNotice({ tone: "success", text: `${row.item_name} on ${shortDate(row.date)} now comes from ${vendor.name}.` })
    } catch (failure) { onNotice({ tone: "error", text: apiErrorText(failure) }) }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} wide testId="rm-review-sheet" eyebrow={canApprove ? "Owner approval" : "Waiting for the Owner"}
      title={canApprove ? "Arrivals waiting for you" : "Arrivals waiting for the Owner"}
      description={canApprove
        ? "Approved arrivals become draft POs right away: one per vendor per week, tagged “Scheduled by Owner”, at the rate shown. If nothing changes before the desk sends them, no second approval is needed."
        : "Only the Owner approves arrivals. You can still pick a vendor for an arrival that has none, so it is ready for him."}
      footer={canApprove ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{chosen.length} selected</span>
            {chosen.length ? ` · ${perUnit(chosen.reduce((totals, row) => ({ ...totals, [row.uom]: (totals[row.uom] || 0) + row.qty }), {} as Record<string, number>))}` : ""}
            {value ? ` · ${rupees(value)}` : ""}
            {rateNeeded ? <span className="text-signal-amber-ink"> · rate needed for {rateNeeded}</span> : null}
          </p>
          <button type="button" className={cn(primaryButton, "w-full sm:w-auto")} disabled={busy || !chosen.length} onClick={() => onApprove(chosen)}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{busy ? "Approving…" : `Approve selected (${chosen.length})`}
          </button>
        </div>
      ) : <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><ShieldCheck className="h-4 w-4 text-signal-violet-ink" aria-hidden="true" />The Owner gets a notice for every proposal and approves it here.</p>}>
      {weeks.length ? (
        <div className="space-y-5">
          {weeks.map(([monday, rows]) => {
            const ready = rows.filter((row) => row.supplier_id)
            return (
              <section key={monday} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">PO week of {shortDate(monday)}</h3>
                  {canApprove && ready.length ? <button type="button" className={secondaryButton} disabled={busy} onClick={() => onApprove(ready)}>Approve week ({ready.length})</button> : null}
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {rows.map((row) => {
                    const noVendor = !row.supplier_id
                    const body = (
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-semibold text-foreground">{row.item_name}</span>
                          {row.late ? <span className="shrink-0 rounded bg-signal-rose-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-rose-ink">Late · goes on today</span> : null}
                          {row.outside_window ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">After this window</span> : null}
                        </span>
                        <span className="block truncate text-[12px] text-muted-foreground">{row.item_code} · {longDate(row.date)}{row.supplier_name ? ` · ${row.supplier_name}` : ""}</span>
                        {!noVendor ? (
                          <span className={cn("block text-[12px]", row.rate ? "text-muted-foreground" : "font-semibold text-signal-amber-ink")}>
                            {rateText(row.rate, row.uom)}{row.rate ? ` · ${rupees(row.value)}` : " · the desk fills it, then the PO comes back to you"}
                            {row.rate && row.rate_source === "RM_COSTING" ? " · from RM costing" : row.rate && row.rate_source === "VENDOR_LAST_PO" ? " · last approved PO" : ""}
                          </span>
                        ) : null}
                      </span>
                    )
                    return (
                      <li key={row.entry_id} className="px-3 py-2.5">
                        {noVendor ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <AlertTriangle className="h-5 w-5 shrink-0 text-signal-amber-ink" aria-hidden="true" />
                            {body}
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{qty(row.qty, row.uom)}</span>
                            {canPropose ? (
                              <label className="w-full sm:pl-8">
                                <span className="mb-1 block text-[12px] font-semibold text-signal-amber-ink">Pick a vendor to approve it</span>
                                <select className={cn(fieldClass, "max-sm:h-11")} value="" disabled={update.isPending} onChange={(event) => pickVendor(row, event.target.value)}>
                                  <option value="">Choose the vendor…</option>
                                  {vendors.filter((option) => option.is_active !== false).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                                </select>
                              </label>
                            ) : <p className="w-full text-[12px] font-semibold text-signal-amber-ink sm:pl-8">Needs a vendor before it can be approved.</p>}
                          </div>
                        ) : canApprove ? (
                          <label className="flex min-h-[48px] cursor-pointer items-center gap-3 hover:bg-foreground/[.02]">
                            <input type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={selected.has(row.entry_id)} onChange={() => toggle(row.entry_id)} />
                            {body}
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{qty(row.qty, row.uom)}</span>
                          </label>
                        ) : (
                          <div className="flex min-h-[48px] items-center gap-3">
                            {body}
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{qty(row.qty, row.uom)}</span>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      ) : <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing is waiting for approval.</p>}
    </Sheet>
  )
}

/** "Suggest arrivals": proposals from shortages, previewed before they are saved. */
export function SuggestSheet({ open, onOpenChange, suggestions, loading, error, onDone, vendors }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestions: Suggestion[]
  loading: boolean
  error: string
  onDone: (notice: Notice) => void
  vendors: Vendor[]
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [failure, setFailure] = useState("")
  const propose = useProposeArrivals()
  useEffect(() => { setSelected(new Set(suggestions.map((_, index) => index))); setPicked({}); setFailure("") }, [suggestions])
  // A material never bought on an approved PO has no last vendor: pick one here, or later in Review.
  const vendorOf = (row: Suggestion, index: number) => {
    const chosenVendor = vendors.find((option) => String(option.id) === picked[index])
    return chosenVendor ? { id: chosenVendor.id, name: chosenVendor.name } : row.supplier_id ? { id: row.supplier_id, name: row.supplier_name } : null
  }
  const chosen = suggestions.map((row, index) => ({ row, index })).filter(({ index }) => selected.has(index))
  async function save() {
    setFailure("")
    try {
      await propose.mutateAsync(chosen.map(({ row, index }) => ({ item_id: row.item_id, entry_date: row.entry_date, qty: row.qty,
        supplier_id: vendorOf(row, index)?.id || null, supplier_name: vendorOf(row, index)?.name || null,
        note: `${row.reason}${row.order_by ? `; order by ${longDate(row.order_by)}` : ""}`, source: "SUGGESTED" as const })))
      onDone({ tone: "success", text: `${chosen.length} suggested arrival${chosen.length === 1 ? "" : "s"} added as proposals.` })
      onOpenChange(false)
    } catch (problem) { setFailure(apiErrorText(problem)) }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} wide testId="rm-suggest-sheet" eyebrow={<span className="inline-flex items-center gap-1"><Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />Suggest arrivals</span>}
      title="Arrivals that close the shortages"
      description="Each shortage gets an arrival the day before, enough for the following week, rounded up to the minimum order and order multiple, from the last vendor. Nothing is saved until you add them."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-muted-foreground">{chosen.length} of {suggestions.length} selected</p>
          <button type="button" className={cn(primaryButton, "w-full sm:w-auto")} disabled={propose.isPending || !chosen.length} onClick={save}>
            <Plus className="h-4 w-4" aria-hidden="true" />{propose.isPending ? "Adding…" : `Add ${chosen.length} as proposals`}
          </button>
        </div>
      }>
      {error ? <MessageBar tone="error">{error}</MessageBar> : null}
      {failure ? <div className="mb-3"><MessageBar tone="error">{failure}</MessageBar></div> : null}
      {loading ? (
        <div className="space-y-2" role="status" aria-live="polite">{[0, 1, 2].map((key) => <div key={key} className="skeleton h-16 rounded-xl" />)}<span className="sr-only">Working out suggestions…</span></div>
      ) : suggestions.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {suggestions.map((row, index) => (
            <li key={`${row.item_id}-${row.entry_date}-${index}`}>
              <label className="flex min-h-[60px] cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-foreground/[.02]">
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={selected.has(index)}
                  onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-foreground"><CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{row.item_name}</span>
                  <span className="block text-[12px] leading-5 text-muted-foreground">
                    Arrive {longDate(row.entry_date)} · {row.reason.replace(/ on (\d{4}-\d{2}-\d{2}|\d{1,2} \w{3} \d{4})$/, ` on ${shortDate(row.short_date)}`)} · {vendorOf(row, index)?.name || <span className="font-semibold text-signal-amber-ink">no vendor yet</span>}
                    {row.late_to_order ? <span className="font-semibold text-signal-rose-ink"> · late to order (lead time)</span> : row.order_by ? ` · order by ${shortDate(row.order_by)}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{qty(row.qty, row.uom)}</span>
              </label>
              {!row.supplier_id ? (
                <label className="block px-3 pb-3 pl-11">
                  <span className="sr-only">Vendor for {row.item_name}</span>
                  <select className={cn(fieldClass, "max-sm:h-11")} value={picked[index] || ""} onChange={(event) => setPicked({ ...picked, [index]: event.target.value })}>
                    <option value="">No vendor yet (pick one before approval)</option>
                    {vendors.filter((option) => option.is_active !== false).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">No shortage to close in this view. Every material is covered by stock and counted arrivals.</p>}
    </Sheet>
  )
}
