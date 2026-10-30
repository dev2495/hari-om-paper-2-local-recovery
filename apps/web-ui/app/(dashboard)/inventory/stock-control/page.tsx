"use client"

// Stock counts & book (client 2026-10-28): one place for counts (spot any time, one month-end count per
// month), corrections (anyone in the store raises, only the Owner approves), the stock book (per material,
// per month: opening + received − sent back − issued + corrections = closing, in each item's own unit)
// and a link to Locations. Query: ?tab=counts|corrections|book&month=YYYY-MM (old links land here too).

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"
import {
  AlertTriangle, ArrowRight, BookOpenCheck, CalendarCheck2, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, History, Lock,
  MapPin, PackageOpen, Plus, ScanLine, ShieldCheck, Wrench, XCircle,
} from "lucide-react"

import { CorrectionSheet } from "@/components/inventory/correction-sheet"
import { ChangedAfterCountNotice } from "@/components/inventory/changed-after-count"
import { CountStartSheet } from "@/components/inventory/count-start-sheet"
import { Chip, Count, EmptyBlock, Field, Notice, Panel, PickPlant, SegmentBar, Segmented, Sheet, TONE, fieldClass } from "@/components/inventory/stock-ui"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useOpeningLoads } from "@/hooks/use-inventory"
import { usePeopleVersion } from "@/hooks/use-people"
import {
  useApproveCorrection, useCorrections, useCounts, useItemSources, useMonthFigures, useRejectCorrection, useSinglePlant, useStartCount,
} from "@/hooks/use-stock"
import {
  COUNT_STATUS_TONE, dayText, errorText, monthText, plural, qtyText, reasonWord, shiftMonth, signedQty, timeText, unitName, who,
  type BookRow, type Correction, type CountListRow, type MonthEndState, type SourceRow,
} from "@/lib/api-stock"
import { businessDate } from "@/lib/business-date"
import { cn } from "@/lib/utils"

type Tab = "counts" | "corrections" | "book"
const TABS: Tab[] = ["counts", "corrections", "book"]

export default function StockControlPage() {
  return (
    <Suspense fallback={<LoadingState label="Opening stock counts & book…" />}>
      <StockHub />
    </Suspense>
  )
}

function StockHub() {
  // Names arrive with the people directory, sometimes after the page first shows: show them at once.
  usePeopleVersion()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const single = useSinglePlant()
  const thisMonth = businessDate().slice(0, 7)
  const tab: Tab = TABS.includes(search.get("tab") as Tab) ? (search.get("tab") as Tab) : "counts"
  const wanted = /^\d{4}-(0[1-9]|1[0-2])$/.test(search.get("month") || "") ? String(search.get("month")) : thisMonth
  const month = wanted > thisMonth ? thisMonth : wanted
  const counts = useCounts()
  const corrections = useCorrections("ALL")
  const [starting, setStarting] = useState(false)
  const go = (next: Partial<{ tab: Tab; month: string }>) => {
    const query = new URLSearchParams(search.toString())
    if (next.tab) query.set("tab", next.tab)
    if (next.month) query.set("month", next.month)
    router.replace(`${pathname}?${query.toString()}`, { scroll: false })
  }
  const openCounts = (counts.data?.items || []).filter((row) => row.status === "DRAFT" || row.status === "SUBMITTED").length
  const waiting = corrections.data?.waiting_count || 0

  return (
    <div className="space-y-4" data-testid="stock-hub">
      <PageHeader
        badge="Stores"
        title="Stock counts & book"
        description="Count racks, correct stock with the Owner's approval, and read the stock book month by month."
        actions={<>
          <Link href="/inventory/locations" className="erp-btn-secondary !h-11" data-testid="hub-locations"><MapPin className="h-4 w-4" aria-hidden="true" />Locations</Link>
          {/* Every issue to the floor behind the book's Issued column (client 2026-10-30). */}
          <Link href="/inventory/issue-history" className="erp-btn-secondary !h-11" data-testid="hub-issue-history"><History className="h-4 w-4" aria-hidden="true" />Issue history</Link>
          {single ? <button type="button" className="erp-btn-primary !h-11" onClick={() => setStarting(true)} data-testid="hub-start-spot"><ScanLine className="h-4 w-4" aria-hidden="true" />Start a spot count</button> : null}
        </>}
      />
      {!single ? <PickPlant what="the stock book" /> : (
        <>
          <Segmented<Tab> label="Stock sections" value={tab} onChange={(value) => go({ tab: value })} testId="hub-tabs" fill
            options={[
              { value: "counts", label: <><ClipboardList className="hidden h-4 w-4 sm:block" aria-hidden="true" />Counts</>, badge: <Count value={openCounts} tone="blue" /> },
              { value: "corrections", label: <><Wrench className="hidden h-4 w-4 sm:block" aria-hidden="true" />Corrections</>, badge: <Count value={waiting} tone="amber" /> },
              { value: "book", label: <><BookOpenCheck className="hidden h-4 w-4 sm:block" aria-hidden="true" />Stock book</> },
            ]} />
          {tab === "counts" ? <CountsTab query={counts} onStartSpot={() => setStarting(true)} /> : null}
          {tab === "corrections" ? <CorrectionsTab query={corrections} /> : null}
          {tab === "book" ? <BookTab month={month} thisMonth={thisMonth} onMonth={(value) => go({ month: value })} /> : null}
          <CountStartSheet open={starting} onOpenChange={setStarting} />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ Counts

function MonthEndCard({ state }: { state: MonthEndState }) {
  const router = useRouter()
  const start = useStartCount()
  const [error, setError] = useState("")
  const count = state.count
  const begin = async () => {
    setError("")
    try {
      const row = await start.mutateAsync({ kind: "MONTH_END", month: state.month })
      router.push(`/inventory/counts/${row.id}`)
    } catch (cause) {
      setError(errorText(cause))
    }
  }
  const done = count && ["APPROVED", "CERTIFIED"].includes(count.status)
  const word = monthText(state.month).split(" ")[0]
  // The server decides which month the store counts now (the oldest month not yet counted, never one before
  // a closed month, the running month only in its last days); the card says why when it cannot start yet.
  return (
    <article className={cn("flex flex-col rounded-2xl border bg-card p-4 shadow-[var(--shadow-premium)]", done ? "border-signal-emerald-line" : count?.status === "SUBMITTED" ? "border-signal-amber-line" : "border-border")} data-testid={`month-end-${state.month}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Month-end count</p>
          <h3 className="mt-0.5 text-[18px] font-bold tracking-tight text-foreground">{state.month_label}</h3>
        </div>
        {state.closed ? <Chip tone="slate" icon={Lock}>Month closed</Chip> : count ? <Chip tone={COUNT_STATUS_TONE[count.status]}>{count.status_word}</Chip> : state.can_start ? <Chip tone="blue">Ready to count</Chip> : <Chip tone="slate" icon={CalendarClock}>Not open yet</Chip>}
      </div>
      {count ? (
        <>
          <SegmentBar className="mt-3" label={`${count.racks_done} of ${plural(count.racks_total, "rack")} done`} parts={[{ value: count.racks_done, tone: done ? "emerald" : "blue" }, { value: count.racks_total - count.racks_done, tone: "slate" }]} />
          <p className="mt-2 text-[12.5px] leading-5 text-muted-foreground">
            {done ? `Approved by ${who(count.approved_by)} · ${dayText(count.approved_at)}${state.closed ? "" : " · the Owner closes the month on Month-end close"}` : count.status === "SUBMITTED" ? `Sent by ${who(count.submitted_by)} · waiting for the Owner` : `${count.racks_done} of ${plural(count.racks_total, "rack")} done${count.counters.length ? ` · counted by ${count.counters.map(who).join(", ")}` : ""}`}
          </p>
          <Link href={`/inventory/counts/${count.id}`} className="erp-btn-secondary mt-3 !h-11 w-full" data-testid={`month-end-open-${state.month}`}>{done ? "See the certificate" : count.status === "DRAFT" ? `Continue the ${word} count` : "Open the count"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </>
      ) : state.closed ? <p className="mt-2 text-[12.5px] text-muted-foreground">This month is closed; it cannot be counted again.</p> : state.can_start ? (
        <>
          <p className="mt-2 text-[12.5px] leading-5 text-muted-foreground">Count every rack and the stock with no location. When the Owner approves it, it becomes the closing stock of {state.month_label}.</p>
          <button type="button" className="erp-btn-secondary mt-3 !h-11 w-full" onClick={begin} disabled={start.isPending} data-testid={`month-end-start-${state.month}`}><CalendarCheck2 className="h-4 w-4" aria-hidden="true" />{start.isPending ? "Starting…" : `Start the ${word} count`}</button>
        </>
      ) : (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-[hsl(var(--surface-2))] px-3 py-2.5 text-[12.5px] leading-5 text-muted-foreground" data-testid={`month-end-wait-${state.month}`}>
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{state.note || `The ${word} count opens near the month end.`} Spot counts can run any time.
        </p>
      )}
      {error ? <Notice tone="rose" className="mt-2">{error}</Notice> : null}
    </article>
  )
}

type CountFilter = "OPEN" | "DONE" | "CANCELLED"
const COUNT_FILTER: Record<CountFilter, (row: CountListRow) => boolean> = {
  OPEN: (row) => row.status === "DRAFT" || row.status === "SUBMITTED",
  DONE: (row) => row.status === "APPROVED" || row.status === "CERTIFIED",
  CANCELLED: (row) => row.status === "CANCELLED",
}
const COUNT_PAGE = 20

function CountsTab({ query, onStartSpot }: { query: ReturnType<typeof useCounts>; onStartSpot: () => void }) {
  const [filter, setFilter] = useState<CountFilter>("OPEN")
  const [shown, setShown] = useState(COUNT_PAGE)
  if (query.isLoading) return <LoadingState label="Loading counts…" />
  if (query.isError || !query.data) return <ErrorState title="Counts could not be loaded" message={errorText(query.error)} onRetry={() => void query.refetch()} />
  const all = query.data.items
  const tally = { OPEN: all.filter(COUNT_FILTER.OPEN).length, DONE: all.filter(COUNT_FILTER.DONE).length, CANCELLED: all.filter(COUNT_FILTER.CANCELLED).length }
  const rows = all.filter(COUNT_FILTER[filter])
  const pick = (value: CountFilter) => { setFilter(value); setShown(COUNT_PAGE) }
  const emptyWords: Record<CountFilter, { title: string; message: string }> = {
    OPEN: { title: "No count running", message: all.length ? "Every count is approved or cancelled. Start a spot count of a few racks any time." : "Start a spot count of a few racks, or the month-end count when it opens." },
    DONE: { title: "No approved counts yet", message: "Counts the Owner approved show here, with what they changed." },
    CANCELLED: { title: "No cancelled counts", message: "Counts the Owner or their starter cancelled show here." },
  }
  return (
    <div className="space-y-4" data-testid="hub-counts">
      <div className={cn("grid gap-3", query.data.month_end.length > 1 && "md:grid-cols-2")}>
        {query.data.month_end.map((state) => <MonthEndCard key={state.month} state={state} />)}
      </div>
      <Panel title="All counts" description="Spot counts any time; one month-end count per month. Anyone can count; only the Owner approves." bodyClassName="p-0"
        action={<Segmented<CountFilter> label="Which counts" value={filter} onChange={pick} testId="count-filter" options={[
          { value: "OPEN", label: "Open", badge: <Count value={tally.OPEN} tone="blue" /> },
          { value: "DONE", label: "Approved", badge: <Count value={tally.DONE} tone="emerald" /> },
          { value: "CANCELLED", label: "Cancelled", badge: <Count value={tally.CANCELLED} tone="slate" /> },
        ]} />}>
        {rows.length ? (
          <>
            <ul className="divide-y divide-border">
              {rows.slice(0, shown).map((row) => <CountRow key={row.id} row={row} />)}
            </ul>
            {rows.length > shown ? (
              <div className="border-t border-border p-3 text-center">
                <button type="button" className="erp-btn-secondary !h-11 w-full sm:w-auto" onClick={() => setShown((value) => value + COUNT_PAGE)} data-testid="count-more">Show {Math.min(COUNT_PAGE, rows.length - shown)} more of {rows.length}</button>
              </div>
            ) : null}
          </>
        ) : <div className="p-4"><EmptyBlock icon={filter === "CANCELLED" ? XCircle : filter === "DONE" ? CheckCircle2 : ClipboardList} title={emptyWords[filter].title} message={emptyWords[filter].message} action={filter === "OPEN" ? <button type="button" className="erp-btn-secondary !h-11" onClick={onStartSpot}><Plus className="h-4 w-4" aria-hidden="true" />Start a spot count</button> : null} /></div>}
      </Panel>
    </div>
  )
}

function CountRow({ row }: { row: CountListRow }) {
  return (
    <li>
      <Link href={`/inventory/counts/${row.id}`} className="grid gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-muted/50 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto] lg:items-center" data-testid="count-row">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-foreground">{row.kind_word}</span><Chip tone={COUNT_STATUS_TONE[row.status]}>{row.status_word}</Chip></p>
          <p className="text-[12.5px] leading-5 text-muted-foreground">{row.count_no} · started {dayText(row.created_at)} by {who(row.created_by)}</p>
          {row.counters.length ? <p className="text-[12.5px] leading-5 text-muted-foreground">Counted by {row.counters.map(who).join(", ")}</p> : null}
        </div>
        {row.status === "CANCELLED" ? <p className="text-[12.5px] text-muted-foreground">Cancelled · stock did not change</p> : (
          <div>
            <SegmentBar label={`${row.racks_done} of ${plural(row.racks_total, "rack")} done`} parts={[{ value: row.racks_done, tone: "emerald" }, { value: row.racks_total - row.racks_done, tone: "slate" }]} />
            <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">{row.racks_done} of {plural(row.racks_total, "rack")} done</p>
          </div>
        )}
        <p className="text-[12.5px] tabular-nums text-muted-foreground"><b className="text-foreground">{row.found}</b> found · <span className={row.missing ? "text-signal-rose-ink" : ""}>{row.missing} not found</span> · {row.extra} extra{row.issued_found ? ` · ${row.issued_found} issued, found` : ""}</p>
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">Open <ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
      </Link>
    </li>
  )
}

// ------------------------------------------------------------------------------------------- Corrections

/** What the line does to the lot, from its real status: a new lot is on QC hold unless the line says otherwise. */
function correctionLotWords(line: Correction["lines"][number]): string {
  if (!line.lot_code && line.qty_delta < 0) return " · takes stock off the material, not a lot"
  if (!line.new_lot) return ""
  return line.stock_status === "QC_HOLD" ? " · new lot on QC hold" : line.stock_status === "UNRESTRICTED" ? " · new lot, cleared (not on QC hold)" : ` · new lot, ${line.stock_status.toLowerCase().replace(/_/g, " ")}`
}

/**
 * Why a waiting correction would post less than it asks (or nothing): another count or correction changed
 * the lot, or it was issued / used since (book now 0). "" when approving posts exactly what it says.
 */
function changedNote(line: Correction["lines"][number]): string {
  if (line.still_to_post === undefined) return ""
  const still = line.still_to_post
  // Nothing returns from the floor: a lot issued since this was raised cannot be put back by approving.
  if (line.issued_since) return `Since this was raised, ${line.reel_id ? "this reel" : "this lot"} was issued to the floor on ${dayText(line.issued_since)} (book now ${qtyText(line.live_qty ?? 0, line.uom)}). Nothing comes back from the floor: reject this one.`
  const changed = Math.abs(line.changed_since || 0) > 0.0005
  if (!changed && Math.abs(still - line.qty_delta) < 0.0005) return ""
  const what = changed
    ? `Since this was raised, a count or correction changed this lot by ${signedQty(line.changed_since || 0, line.uom)}.`
    : `Since this was raised, ${line.reel_id ? "this reel" : "this lot"} was issued or used (book now ${qtyText(line.live_qty ?? 0, line.uom)}).`
  return `${what} ${Math.abs(still) > 0.0005 ? `Approving now changes it by ${signedQty(still, line.uom)}.` : "Approving changes nothing: reject this one."}`
}

function CorrectionCard({ row, canApprove }: { row: Correction; canApprove: boolean }) {
  const approve = useApproveCorrection()
  const reject = useRejectCorrection()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const tone = row.status === "DRAFT" ? "amber" : row.status === "POSTED" ? "emerald" : "slate"
  const statusWord = row.status === "DRAFT" ? "Waiting for the Owner" : row.status === "POSTED" ? "Approved" : "Rejected"
  // Every named lot already changed (issued, counted or corrected) so approving would post nothing: Reject leads.
  const nothingLeft = row.status === "DRAFT" && row.lines.length > 0 && row.lines.every((line) => line.still_to_post !== undefined && Math.abs(line.still_to_post) < 0.0005)
  const rejectClass = nothingLeft ? "erp-btn-primary" : "erp-btn-secondary"
  const approveClass = nothingLeft ? "erp-btn-secondary" : "erp-btn-primary"
  return (
    <li className="px-4 py-3.5" data-testid="correction-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-foreground">{row.reason_label}</span><Chip tone={tone}>{statusWord}</Chip>{row.kind !== "CORRECTION" ? <Chip tone="slate">{row.kind === "COUNT" ? "From a count" : "System"}</Chip> : null}</p>
          <p className="text-[12.5px] text-muted-foreground">{row.voucher_no} · raised by {who(row.created_by)} · {timeText(row.created_at)}{row.approved_by && row.status === "POSTED" ? ` · approved by ${who(row.approved_by)}` : ""}</p>
        </div>
        {row.status === "DRAFT" && canApprove ? (
          <div className="flex gap-2 max-sm:hidden">
            <button type="button" className={`${rejectClass} !h-11 flex-1`} onClick={() => setRejecting(true)} data-testid="correction-reject"><XCircle className="h-4 w-4" aria-hidden="true" />Reject</button>
            <button type="button" className={`${approveClass} !h-11 flex-1`} disabled={approve.isPending} onClick={() => approve.mutateAsync({ id: row.id }).catch((cause) => setError(errorText(cause)))} data-testid="correction-approve"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve</button>
          </div>
        ) : null}
      </div>
      <ul className="mt-2 space-y-1">
        {row.lines.map((line) => (
          <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2 text-[13px]">
            <span className="font-mono font-semibold text-foreground">{line.lot_code || (line.qty_delta < 0 ? "No lot named" : "New lot")}</span>
            {/* Phone: the material gets its own full line (never cut to a letter); desk: one row. */}
            <span className="min-w-0 flex-1 text-muted-foreground max-sm:order-first max-sm:basis-full max-sm:font-medium max-sm:text-foreground sm:truncate">{line.item_name}{line.location_code ? ` · ${line.location_code}` : ""}{correctionLotWords(line)}</span>
            <span className={cn("font-bold tabular-nums", line.qty_delta < 0 ? "text-signal-rose-ink" : "text-signal-emerald-ink")}>{signedQty(line.qty_delta, line.uom)}</span>
            {line.live_qty !== undefined ? <span className="text-[12px] text-muted-foreground">book now {qtyText(line.live_qty, line.uom)}</span> : null}
            {changedNote(line) ? (
              <span className="basis-full rounded-md bg-signal-amber-soft px-2 py-1 text-[12px] text-signal-amber-ink" data-testid="correction-changed-since">{changedNote(line)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {row.status === "DRAFT" && canApprove ? (
        // Phone: Reject / Approve come after the lines they decide on.
        <div className="mt-2.5 flex w-full gap-2 sm:hidden">
          <button type="button" className={`${rejectClass} !h-11 flex-1`} onClick={() => setRejecting(true)} data-testid="correction-reject-phone"><XCircle className="h-4 w-4" aria-hidden="true" />Reject</button>
          <button type="button" className={`${approveClass} !h-11 flex-1`} disabled={approve.isPending} onClick={() => approve.mutateAsync({ id: row.id }).catch((cause) => setError(errorText(cause)))} data-testid="correction-approve-phone"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve</button>
        </div>
      ) : null}
      {row.reason_notes ? <p className="mt-1.5 text-[12.5px] text-muted-foreground">“{row.reason_notes}”</p> : null}
      {row.status === "CANCELLED" && row.cancel_note ? <p className="mt-1.5 text-[12.5px] text-muted-foreground">Rejected by {who(row.cancelled_by)}: {row.cancel_note}</p> : null}
      {error ? <Notice tone="rose" className="mt-2">{error}</Notice> : null}
      <Sheet open={rejecting} onOpenChange={setRejecting} title="Reject this correction?" description="Stock does not change. The person who raised it sees your note."
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setRejecting(false)}>Cancel</button><button type="button" className="erp-btn-primary !h-11" disabled={note.trim().length < 3 || reject.isPending} onClick={() => reject.mutateAsync({ id: row.id, note: note.trim() }).then(() => setRejecting(false)).catch((cause) => setError(errorText(cause)))} data-testid="correction-reject-confirm">Reject</button></>}>
        <Field label="Why (needed)"><textarea className={`${fieldClass} !h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></Field>
      </Sheet>
    </li>
  )
}

function CorrectionsTab({ query }: { query: ReturnType<typeof useCorrections> }) {
  const [raising, setRaising] = useState(false)
  const [filter, setFilter] = useState<"WAITING" | "DONE">("WAITING")
  if (query.isLoading) return <LoadingState label="Loading corrections…" />
  if (query.isError || !query.data) return <ErrorState title="Corrections could not be loaded" message={errorText(query.error)} onRetry={() => void query.refetch()} />
  const { items, can } = query.data
  const waiting = items.filter((row) => row.status === "DRAFT")
  const done = items.filter((row) => row.status !== "DRAFT")
  const rows = filter === "WAITING" ? waiting : done
  return (
    <div className="space-y-4" data-testid="hub-corrections">
      <Notice tone="blue" icon={ShieldCheck} title="Only the Owner approves stock corrections" action={can.raise ? <button type="button" className="erp-btn-primary !h-11" onClick={() => setRaising(true)} data-testid="correction-raise"><Plus className="h-4 w-4" aria-hidden="true" />Raise a correction</button> : null}>
        Store, raw-material issue, GRN and the plant head raise one for a lot that is short, extra, damaged or weighed wrong. Stock changes only when the Owner approves it.
      </Notice>
      <Panel bodyClassName="p-0" title={<Segmented<"WAITING" | "DONE"> label="Correction list" value={filter} onChange={setFilter} options={[{ value: "WAITING", label: "Waiting for the Owner", badge: <Count value={waiting.length} tone="amber" /> }, { value: "DONE", label: "Approved & rejected" }]} />}>
        {rows.length ? <ul className="divide-y divide-border">{rows.map((row) => <CorrectionCard key={row.id} row={row} canApprove={can.approve} />)}</ul>
          : <div className="p-4"><EmptyBlock icon={CheckCircle2} title={filter === "WAITING" ? "Nothing waiting" : "No corrections yet"} message={filter === "WAITING" ? "Corrections raised by the store show here for the Owner." : "Approved and rejected corrections, and count postings, show here."} /></div>}
      </Panel>
      <CorrectionSheet open={raising} onOpenChange={setRaising} />
    </div>
  )
}

// -------------------------------------------------------------------------------------------- Stock book

type BookFigures = Pick<BookRow, "opening" | "received" | "opening_loads" | "sent_back" | "issued" | "corrections" | "closing">
type BookColumn = { key: keyof BookFigures | "grn"; label: string; sign?: string }

const COLUMNS: BookColumn[] = [
  { key: "opening", label: "Opening" },
  { key: "received", label: "Received", sign: "+" },
  { key: "sent_back", label: "Sent back", sign: "−" },
  { key: "issued", label: "Issued", sign: "−" },
  { key: "corrections", label: "Corrections", sign: "±" },
  { key: "closing", label: "Closing", sign: "=" },
]
// Go-live stock is part of Received on the server; when a month has any, it shows as its own line
// "Opening loads" and Received shows the GRNs only, so the sum still reads across (spec 2.1 / C3.7).
const COLUMNS_WITH_LOADS: BookColumn[] = [
  { key: "opening", label: "Opening" },
  { key: "opening_loads", label: "Opening loads", sign: "+" },
  { key: "grn", label: "Received", sign: "+" },
  ...COLUMNS.slice(2),
]

const hasLoads = (row: Pick<BookFigures, "opening_loads">) => Math.abs(Number(row.opening_loads || 0)) > 0.0005

function bookValue(row: Partial<BookFigures>, key: BookColumn["key"]): number {
  if (key === "grn") return Number(row.received || 0) - Number(row.opening_loads || 0)
  return Number(row[key] || 0)
}

function BookTab({ month, thisMonth, onMonth }: { month: string; thisMonth: string; onMonth: (month: string) => void }) {
  const query = useMonthFigures(month)
  const loads = useOpeningLoads()
  const corrections = useCorrections("ALL")
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState("")
  const [drawer, setDrawer] = useState<BookRow | null>(null)
  const data = query.data
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.items || []).filter((row) => (showAll || row.has_movement || Math.abs(row.closing) > 0.0005 || Math.abs(row.opening) > 0.0005) && (!needle || `${row.item_code} ${row.item_name}`.toLowerCase().includes(needle)))
  }, [data, showAll, search])
  // A material that opens below zero did not balance last month either: never call that book balanced.
  const mismatches = (data?.items || []).filter((row) => !row.identity_ok || row.opening < -0.0005)
  // useOpeningLoads returns the batch list itself.
  const goLiveDone = Array.isArray(loads.data) && loads.data.length > 0
  const count = data?.month_end_count
  const columns = (data?.items || []).some(hasLoads) || (data?.units || []).some(hasLoads) ? COLUMNS_WITH_LOADS : COLUMNS
  // The table drops "Sent back" when nothing went back all month (the cards above still show it), so
  // Used fits beside Closing at 1280 with the sidebar open, with no hidden sideways scroll.
  const tableColumns = (data?.items || []).some((row) => Math.abs(Number(row.sent_back || 0)) > 0.0005) ? columns : columns.filter((column) => column.key !== "sent_back")

  return (
    <div className="space-y-4" data-testid="hub-book">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-border bg-card" role="group" aria-label="Month">
          <button type="button" className="grid h-11 w-11 place-items-center rounded-l-xl hover:bg-muted" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <span className="min-w-36 px-2 text-center text-[14px] font-semibold text-foreground" data-testid="book-month">{monthText(month)}</span>
          <button type="button" className="grid h-11 w-11 place-items-center rounded-r-xl hover:bg-muted disabled:opacity-40" onClick={() => onMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {data ? <>
          {data.closed ? <Chip tone="slate" icon={Lock}>Month closed</Chip> : data.running ? <Chip tone="blue">Running month · figures so far</Chip> : <Chip tone="amber">Not closed yet</Chip>}
          <Chip tone="slate">{data.opening_source === "PREVIOUS_CLOSE" ? "Opens from last month's close" : "Opens from the book on the 1st"}</Chip>
          {count ? <Link href={`/inventory/counts/${count.id}`} className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="book-count-link"><Chip tone={count.changed_after_count ? "amber" : COUNT_STATUS_TONE[count.status]}>Month-end count: {count.status === "CERTIFIED" ? (count.changed_after_count ? "approved · stock changed since" : "approved") : count.status === "SUBMITTED" ? "waiting for the Owner" : "counting"}<ChevronRight className="h-3 w-3" aria-hidden="true" /></Chip></Link> : <Chip tone="slate">No month-end count yet</Chip>}
        </> : null}
      </div>

      {query.isLoading ? <LoadingState label="Working out the stock book…" /> : query.isError || !data ? <ErrorState title="The stock book could not be loaded" message={errorText(query.error)} onRetry={() => void query.refetch()} /> : (
        <>
          <section className="space-y-3" data-testid="book-units">
            {data.units.length ? data.units.map((unit) => (
              <article key={unit.uom} className={cn("rounded-2xl border bg-card p-4 shadow-[var(--shadow-premium)]", unit.problem_items || unit.opening < -0.0005 ? "border-signal-rose-line" : "border-border")} data-testid={`book-unit-${unit.uom}`}>
                <p className="flex flex-wrap items-center justify-between gap-2 text-[12px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                  <span>Materials in {unitName(unit.uom)} · {unit.item_count}</span>
                  <span className="normal-case tracking-normal">{unit.problem_items ? <Chip tone="rose" icon={AlertTriangle}>{plural(unit.problem_items, "material")} not balancing</Chip> : <>Used this month <b className="text-foreground">{qtyText(unit.actual_used, unit.uom, 1)}</b></>}</span>
                </p>
                <dl className={cn("mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3", columns.length > 6 ? "lg:grid-cols-4 2xl:grid-cols-7" : "xl:grid-cols-6")}>
                  {columns.map((column) => (
                    <div key={column.key} className={cn("min-w-0 rounded-xl px-3 py-2.5", column.key === "closing" ? "bg-primary/10 ring-1 ring-primary/25" : "bg-[hsl(var(--surface-2))]")}>
                      <dt className="flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">{column.sign ? <span className="grid h-4 w-4 place-items-center rounded-full bg-card text-[11px] font-bold text-foreground ring-1 ring-border">{column.sign}</span> : null}{column.label}</dt>
                      <dd className={cn("mt-1 truncate text-[16px] font-bold tabular-nums", (column.key === "closing" || column.key === "opening") && bookValue(unit, column.key) < -0.0005 ? "text-signal-rose-ink" : "text-foreground")}>{qtyText(bookValue(unit, column.key), unit.uom, 1)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            )) : <EmptyBlock icon={PackageOpen} title="No stock movement" message={`Nothing was received, issued or corrected in ${data.month_label}.`} />}
          </section>
          {mismatches.length ? (
            <Notice tone="rose" title={`${plural(mismatches.length, "material")} ${mismatches.length === 1 ? "does" : "do"} not balance`} testId="book-problems">
              <ul className="mt-1 space-y-0.5">
                {mismatches.slice(0, 5).map((row) => <li key={row.item_id}><b>{row.item_name}</b> ({row.item_code}): {!row.identity_ok ? `${row.book_problem_word || "the book and the stock records differ"}${row.closing < -0.0005 ? `, closing ${qtyText(row.closing, row.uom)}` : ""}` : `opens below zero (${qtyText(row.opening, row.uom)}): last month closed below zero`}.</li>)}
              </ul>
              <p className="mt-1.5">Tell the Owner; month-end waits until this is fixed.</p>
            </Notice>
          ) : <Notice tone="emerald" title="The book balances" testId="book-balances">For every material: no opening or closing stock below zero, no lot below zero, and opening{columns.length > COLUMNS.length ? " + opening loads" : ""} + received − sent back − issued + corrections = closing{data.running ? ", which matches the stock in the store now" : ""}.</Notice>}
          {count?.changed_items?.length ? <ChangedAfterCountNotice items={count.changed_items} monthLabel={data.month_label} countHref={`/inventory/counts/${count.id}`} closed={data.closed} testId="book-changed-after-count" /> : null}

          <Panel bodyClassName="p-0" title="Materials" description="Tap a material to see the receipts, issues and corrections behind its numbers."
            action={<>
              <input className={cn(fieldClass, "!h-11 w-full sm:w-56")} placeholder="Search materials" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="book-search" />
              <label className="inline-flex min-h-11 items-center gap-2 text-[13px] text-muted-foreground"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Show materials with no stock</label>
            </>}>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-[13px]" data-testid="book-table">
                <thead className="bg-[hsl(var(--surface-2))] text-left text-[11.5px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 lg:px-4">Material</th>
                    {tableColumns.map((column) => <th key={column.key} className="px-2 py-2.5 text-right xl:px-3">{column.label}</th>)}
                    <th className="px-3 py-2.5 text-right lg:px-4">Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.item_id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDrawer(row)} data-testid="book-row">
                      <td className="max-w-[220px] px-3 py-2.5 lg:px-4"><button type="button" className="block w-full text-left" onClick={() => setDrawer(row)}><span className="block truncate font-semibold text-foreground">{row.item_name}</span><span className="block truncate font-mono text-[11.5px] text-muted-foreground">{row.item_code}</span>{!row.identity_ok ? <span className="mt-0.5 block text-[11.5px] font-semibold text-signal-rose-ink">{row.book_problem_word || "Does not balance"}</span> : null}{row.changed_after_count != null ? <span className="mt-0.5 block text-[11.5px] font-semibold text-signal-amber-ink">Changed after the month-end count</span> : null}</button></td>
                      {tableColumns.map((column) => <td key={column.key} className={cn("whitespace-nowrap px-2 py-2.5 text-right tabular-nums xl:px-3", column.key === "closing" ? (row.closing < -0.0005 ? "font-bold text-signal-rose-ink" : "font-bold text-foreground") : Math.abs(bookValue(row, column.key)) > 0.0005 ? "text-foreground" : "text-muted-foreground")}>{qtyText(bookValue(row, column.key), row.uom)}</td>)}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground lg:px-4">{qtyText(row.actual_used, row.uom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border md:hidden" data-testid="book-cards">
              {rows.map((row) => (
                <li key={row.item_id}>
                  <button type="button" onClick={() => setDrawer(row)} className="block w-full px-4 py-3 text-left" data-testid="book-card">
                    <p className="flex items-start justify-between gap-2">
                      <span className="min-w-0"><span className="block truncate text-[14px] font-semibold text-foreground">{row.item_name}</span><span className="block truncate font-mono text-[11.5px] text-muted-foreground">{row.item_code}</span></span>
                      <span className={cn("shrink-0 text-[14px] font-bold tabular-nums", row.closing < -0.0005 ? "text-signal-rose-ink" : "text-foreground")}>{qtyText(row.closing, row.uom)}</span>
                    </p>
                    {!row.identity_ok ? <p className="mt-1"><Chip tone="rose" icon={AlertTriangle}>{row.book_problem_word || "Does not balance"}</Chip></p> : null}
                    {row.changed_after_count != null ? <p className="mt-1"><Chip tone="amber">Changed after the month-end count</Chip></p> : null}
                    <p className="mt-1 text-[12.5px] leading-5 tabular-nums text-muted-foreground">{qtyText(row.opening, row.uom)}{hasLoads(row) ? ` + ${qtyText(row.opening_loads, row.uom)} opening loads` : ""} + {qtyText(bookValue(row, "grn"), row.uom)} received{row.sent_back ? ` − ${qtyText(row.sent_back, row.uom)} sent back` : ""} − {qtyText(row.issued, row.uom)} issued{row.corrections ? ` ${row.corrections < 0 ? "−" : "+"} ${qtyText(Math.abs(row.corrections), row.uom)} corrected` : ""}</p>
                  </button>
                </li>
              ))}
            </ul>
            {!rows.length ? <div className="p-4"><EmptyBlock icon={PackageOpen} title="No materials to show" message={search ? "No material matches the search." : "No material had stock or movement this month."} /></div> : null}
          </Panel>

          {corrections.data?.can.opening_load ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-[12.5px] text-muted-foreground" data-testid="book-go-live">
              <span><b className="text-foreground">Go-live opening stock</b> · {goLiveDone ? "Stock already in the plant on the go-live date, with its labels. More can be added on the same date until that month is closed." : "Owner and Admin enter the stock already in the plant, rack by rack, all on one go-live date. Later months open from the book by themselves."}</span>
              <Link href="/inventory/opening-stock" className="erp-btn-secondary !h-11" data-testid="book-opening-load">{goLiveDone ? "See opening stock" : "Enter opening stock"}</Link>
            </div>
          ) : null}
          <SourcesDrawer row={drawer} month={month} onClose={() => setDrawer(null)} />
        </>
      )}
    </div>
  )
}

/** The lot, document, shift, reason (in words), place and note behind one book line. */
function sourceDetail(source: SourceRow): string {
  const parts = [source.lot, source.doc && source.doc !== source.lot ? source.doc : "", source.shift ? `shift ${source.shift}` : "", reasonWord(source.reason),
    source.location_name || source.location_code ? `at ${source.location_name || source.location_code}` : "", source.note]
  return parts.filter((part, index) => part && parts.indexOf(part) === index).join(" · ")
}

const KIND_TONE: Record<string, "emerald" | "rose" | "amber" | "violet" | "blue" | "slate"> = { RECEIVED: "emerald", OPENING_LOAD: "blue", SENT_BACK: "amber", ISSUED: "rose", CORRECTION: "violet", COUNT_VARIANCE: "violet" }

function SourcesDrawer({ row, month, onClose }: { row: BookRow | null; month: string; onClose: () => void }) {
  const query = useItemSources(row?.item_id, month)
  return (
    <Sheet open={Boolean(row)} onOpenChange={(open) => !open && onClose()} wide title={row?.item_name || "Material"} description={row ? `${monthText(month)} · ${row.item_code}` : undefined} testId="book-sources">
      {row ? (
        <div className="space-y-3">
          <div className={cn("grid grid-cols-3 gap-2", hasLoads(row) ? "sm:grid-cols-4" : "sm:grid-cols-6")}>
            {(hasLoads(row) ? COLUMNS_WITH_LOADS : COLUMNS).map((column) => (
              <div key={column.key} className={cn("rounded-xl px-2.5 py-2", column.key === "closing" ? "bg-primary/10" : "bg-[hsl(var(--surface-2))]")}>
                <p className="text-[11px] font-semibold text-muted-foreground">{column.label}</p>
                <p className="truncate text-[13.5px] font-bold tabular-nums text-foreground">{qtyText(bookValue(row, column.key), row.uom)}</p>
              </div>
            ))}
          </div>
          {query.isLoading ? <LoadingState label="Loading the movements…" /> : query.isError || !query.data ? <ErrorState title="Movements could not be loaded" message={errorText(query.error)} onRetry={() => void query.refetch()} /> : query.data.rows.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {query.data.rows.map((source, index) => (
                <li key={`${source.day}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]" data-testid="book-source-row">
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{dayText(source.day)}</span>
                  <Chip tone={KIND_TONE[source.kind] || "slate"}>{source.label}</Chip>
                  <span className={cn("ml-auto shrink-0 font-bold tabular-nums sm:order-last", source.qty < 0 ? "text-signal-rose-ink" : "text-signal-emerald-ink")}>{signedQty(source.qty, row.uom)}</span>
                  {/* Phone: the detail gets its own wrapped line; wider screens keep one line with the full text on hover. */}
                  <span className="min-w-0 basis-full break-words text-[12.5px] leading-5 text-muted-foreground sm:flex-1 sm:basis-0 sm:truncate" title={sourceDetail(source)}>{sourceDetail(source)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyBlock title="No movements this month" message={`${row.item_name} only carried its opening stock.`} />}
          <p className="text-[12px] text-muted-foreground">Issued counts every issue to the floor on its issue day: a reel issued whole is consumed that day, whatever its slitting card says.</p>
        </div>
      ) : null}
    </Sheet>
  )
}
