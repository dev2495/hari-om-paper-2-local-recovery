"use client"

// Count hub (client 2026-10-28): every rack with its progress and who is counting it, items without labels
// in the "no location" bucket, Send to the Owner, and the Owner's review: lines grouped by result, value
// impact, issued-but-found decisions, Approve (posts the exact lots) or Send back for a recount.

import Link from "next/link"
import { useParams } from "next/navigation"
import { useMemo, useState } from "react"
import {
  AlertTriangle, ArrowRight, ArrowRightLeft, BadgeCheck, Ban, CheckCircle2, ChevronRight, CircleDashed, ClipboardList, FileCheck2, Inbox, MapPinned, PackagePlus, Printer, ScanLine, Send, Undo2, Users,
} from "lucide-react"

import { ChangedAfterCountNotice } from "@/components/inventory/changed-after-count"
import { BackLink, Chip, EmptyBlock, Field, Notice, Panel, PickPlant, SegmentBar, Sheet, Stat, TONE, fieldClass } from "@/components/inventory/stock-ui"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { usePeopleVersion } from "@/hooks/use-people"
import { useApproveCount, useCancelCount, useCount, useDecide, useSendBackCount, useSinglePlant, useSubmitCount } from "@/hooks/use-stock"
import {
  COUNT_STATUS_TONE, RACK_STATUS, dayText, errorText, plural, qtyText, rupees, signedQty, timeText, who,
  type CountDetail, type CountEntry, type RackView, type Tone,
} from "@/lib/api-stock"
import { businessDate } from "@/lib/business-date"
import { cn } from "@/lib/utils"

// Every line sits in exactly one group (the same words as the tiles above and the rack pages).
const GROUPS: Array<{ key: string; title: string; tone: Tone; icon: any; help: string }> = [
  { key: "moved", title: "Moved after it was counted", tone: "violet", icon: ArrowRightLeft, help: "Really moved to another place after the count: approval leaves it where it is now (a not-found lot that was moved later is not written off). A weight difference still posts." },
  { key: "moved_away", title: "Moved away during the count", tone: "violet", icon: ArrowRightLeft, help: "On the rack when counting there started, then moved to another place before Rack done: not counted here, not missing. Nothing posts." },
  { key: "issued_after", title: "Issued after it was counted", tone: "violet", icon: ArrowRightLeft, help: "Went to the floor after it was counted. Approval never brings it back: what the floor used stays used, so it is not moved or written off. Only stock still in the store follows the count." },
  { key: "after", title: "Issued or received during or after the count", tone: "violet", icon: ArrowRightLeft, help: "Found as the book says; each line says what happened to it. The book already has that issue or receipt, so approval posts nothing for it." },
  { key: "missing", title: "Not found", tone: "rose", icon: AlertTriangle, help: "Written off by their own label when approved." },
  { key: "issued", title: "Issued, but found in store", tone: "violet", icon: Ban, help: "The issue is never reversed. Leave as used, or add as new stock on QC hold." },
  { key: "extra", title: "Extra stock", tone: "blue", icon: PackagePlus, help: "A known lot adds back to that lot; stock without a label becomes a new lot on QC hold." },
  { key: "wrong", title: "In the wrong place", tone: "amber", icon: ArrowRightLeft, help: "Moved to where it was found when approved. QC status does not change." },
  { key: "qty", title: "Quantity different", tone: "violet", icon: CircleDashed, help: "The lot is set to what was counted." },
  { key: "filed", title: "Had no location", tone: "blue", icon: MapPinned, help: "Filed on the rack where it was found when approved. Stock does not change." },
  { key: "used", title: "Used during the count", tone: "slate", icon: Undo2, help: "Issued to the floor while the count ran: consumed, not missing." },
  { key: "arrived", title: "Arrived during the count", tone: "slate", icon: Inbox, help: "Received or put on the rack after counting there started: left out, never missing." },
  { key: "ok", title: "Found as the book says", tone: "emerald", icon: CheckCircle2, help: "" },
]

function groupOf(entry: CountEntry): string {
  if (entry.movement_flag === "MOVED_AFTER_COUNT" && ["FOUND", "WRONG_PLACE", "EXTRA", "MISSING", "MOVED"].includes(entry.status)) return "moved"
  if (entry.status === "MOVED") return "moved_away"
  // Issued after it was counted: its own group, never under "moved to where it was found" or "written off".
  if (entry.movement_flag === "ISSUED_AFTER_COUNT" && ["FOUND", "WRONG_PLACE", "MISSING"].includes(entry.status)) return "issued_after"
  if (entry.status === "MISSING") return "missing"
  if (entry.status === "ISSUED_FOUND") return "issued"
  if (entry.status === "EXTRA") return "extra"
  if (entry.status === "WRONG_PLACE") return "wrong"
  if (entry.status === "USED") return "used"
  if (entry.status === "ARRIVED") return "arrived"
  if (Math.abs(entry.variance_qty) > 0.0005) return "qty"
  // Something moved after it was counted: never hidden inside the collapsed "found as the book says".
  if (entry.movement_flag) return "after"
  return entry.filed_here ? "filed" : "ok"
}

/** The rack to count next: one sent back for a recount first, then one being counted, then one not started. */
function nextRack(racks: RackView[]): RackView | undefined {
  return racks.find((rack) => rack.status === "RECOUNT") || racks.find((rack) => rack.status === "COUNTING") || racks.find((rack) => rack.status === "TODO")
}

function Steps({ count }: { count: CountDetail }) {
  const steps = [
    { label: "Counting", done: count.status !== "DRAFT" && count.status !== "CANCELLED", now: count.status === "DRAFT", detail: `${count.racks_done} of ${plural(count.racks_total, "rack")} done` },
    { label: "Sent to the Owner", done: ["APPROVED", "CERTIFIED"].includes(count.status), now: count.status === "SUBMITTED", detail: count.submitted_at ? `${who(count.submitted_by)} · ${timeText(count.submitted_at)}` : "Waiting" },
    { label: count.kind === "MONTH_END" ? "Approved · certificate" : "Approved", done: ["APPROVED", "CERTIFIED"].includes(count.status), now: false, detail: count.approved_at ? `${who(count.approved_by)} · ${timeText(count.approved_at)}` : "Owner only" },
  ]
  return (
    <ol className="grid gap-2 sm:grid-cols-3" data-testid="count-steps">
      {steps.map((step, index) => (
        <li key={step.label} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", step.now ? "border-primary/50 bg-primary/5" : "border-border bg-card")}>
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold", step.done ? "bg-signal-emerald-soft text-signal-emerald-ink" : step.now ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {step.done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : index + 1}
          </span>
          <span className="min-w-0"><span className="block text-[13px] font-semibold text-foreground">{step.label}</span><span className="block truncate text-[12px] text-muted-foreground">{step.detail}</span></span>
        </li>
      ))}
    </ol>
  )
}

function RackTile({ rack, countId, canCount }: { rack: RackView; countId: string; canCount: boolean }) {
  const p = rack.progress
  const status = RACK_STATUS[rack.status]
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {rack.bucket === "UNASSIGNED" ? (
            <p className="flex items-center gap-1.5 truncate text-[16px] font-bold tracking-tight text-foreground"><Inbox className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{rack.label}</p>
          ) : <p className="truncate font-mono text-[17px] font-bold tracking-tight text-foreground">{rack.label}</p>}
          <p className="truncate text-[12.5px] text-muted-foreground">{rack.name}</p>
        </div>
        <Chip tone={status.tone}>{status.word}</Chip>
      </div>
      <SegmentBar className="mt-3" label={`${p.found} found of ${p.expected}`} parts={[{ value: p.found, tone: "emerald" }, { value: p.missing, tone: "rose" }, { value: p.to_find, tone: "slate" }]} />
      <p className="mt-2 text-[12.5px] tabular-nums text-muted-foreground">
        <b className="text-foreground">{p.found}</b> found{p.expected ? ` of ${p.expected}` : ""}
        {p.missing ? <> · <span className="text-signal-rose-ink">{p.missing} not found</span></> : null}
        {p.extra ? <> · <span className="text-signal-blue-ink">{p.extra} extra</span></> : null}
        {p.wrong_place ? <> · <span className="text-signal-amber-ink">{p.wrong_place} wrong place</span></> : null}
        {p.issued_found ? <> · <span className="text-signal-violet-ink">{p.issued_found} issued, found</span></> : null}
        {p.arrived ? <> · {p.arrived} arrived later</> : null}
        {p.moved ? <> · <span className="text-signal-violet-ink">{p.moved} moved away</span></> : null}
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-5 text-muted-foreground">
        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">
          {rack.counted_by ? rack.counted_by.split(", ").map(who).join(", ") : "Nobody yet"}
          {rack.done_at ? <span className="whitespace-nowrap"> · done {timeText(rack.done_at)}</span> : null}
        </span>
      </p>
      {rack.recount_note && rack.status === "RECOUNT" ? <p className="mt-2 rounded-lg bg-signal-amber-soft px-2.5 py-1.5 text-[12px] text-signal-amber-ink">Owner: {rack.recount_note}</p> : null}
    </>
  )
  return (
    <Link href={`/inventory/counts/${countId}/rack/${rack.key}`} className={cn("group block rounded-2xl border bg-card p-4 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-[var(--shadow-premium-hover)]", rack.status === "RECOUNT" ? "border-signal-amber-line" : "border-border")} data-testid={`count-rack-${rack.label}`}>
      {body}
      <span className="mt-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary">{canCount && rack.status !== "DONE" ? "Count this rack" : "Open"} <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
    </Link>
  )
}

/** "Month-end count · September 2026": on a phone the month goes on its own line, with no dot starting it
 * (screen readers still hear the separator). */
function KindTitle({ text }: { text: string }) {
  const [kind, ...rest] = text.split(" · ")
  if (!rest.length) return <>{text}</>
  return <><span>{kind}</span><span className="max-sm:sr-only"> · </span><span className="max-sm:block">{rest.join(" · ")}</span></>
}

function EntryRow({ entry, count, onDecide, deciding }: { entry: CountEntry; count: CountDetail; onDecide: (entry: CountEntry, decision: "LEAVE_AS_USED" | "ADD_ON_QC_HOLD") => void; deciding: boolean }) {
  const counted = entry.counted_qty ?? 0
  // What approval does to stock on this line (an issued-but-found reel left as used changes nothing).
  const change = entry.status === "ISSUED_FOUND" && entry.decision !== "ADD_ON_QC_HOLD" ? 0 : entry.variance_qty
  const where = entry.status === "WRONG_PLACE"
    ? ` (belongs to ${entry.expected_location_code || "another rack"})`
    : entry.filed_here ? " (had no location: filed here on approval)" : ""
  return (
    <li className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center" data-testid="count-entry">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13.5px] font-semibold text-foreground">{entry.code || "No label"}</span>
          {entry.movement_word ? <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded-2xl border px-2 py-1 text-[11.5px] font-semibold leading-4", TONE.violet.chip)}><ArrowRightLeft className="h-3 w-3 shrink-0" aria-hidden="true" />{entry.movement_word}</span> : null}
          {entry.stock_status === "QC_HOLD" ? <Chip tone="amber">QC hold</Chip> : null}
        </p>
        <p className="truncate text-[12.5px] text-muted-foreground">{entry.item_name} · {entry.location_code || "No location"}{where}</p>
        {entry.note ? <p className="mt-0.5 text-[12px] text-muted-foreground">{entry.note}</p> : null}
        {entry.created_lot_code ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="count-new-lot">
            <Chip tone="blue" icon={PackagePlus}>New lot {entry.created_lot_code} · on QC hold</Chip>
            {count.can.print_labels ? <Link href={`/inventory/locations/lot-labels?ids=${entry.created_lot_id}&count=${count.id}`} className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"><Printer className="h-3.5 w-3.5" aria-hidden="true" />Print its label</Link> : null}
          </p>
        ) : null}
      </div>
      <div className="text-[12.5px] tabular-nums text-muted-foreground">
        Book <b className="text-foreground">{qtyText(entry.expected_qty, entry.uom)}</b> · counted <b className="text-foreground">{qtyText(counted, entry.uom)}</b>
        <span className="block">{who(entry.counted_by)} · {timeText(entry.counted_at)}</span>
      </div>
      <div className="flex items-center gap-3 sm:justify-end">
        {entry.status === "MOVED" ? <span className="text-[13px] font-semibold text-muted-foreground">Not written off</span> : entry.status !== "USED" && entry.status !== "ARRIVED" ? (
          Math.abs(change) > 0.0005 ? (
            <span className={cn("text-[14px] font-bold tabular-nums", change < 0 ? "text-signal-rose-ink" : "text-signal-emerald-ink")}>
              {signedQty(change, entry.uom)}
              {entry.value ? <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">{rupees(entry.value)}</span> : entry.value === null ? <span className="ml-1.5 text-[12px] font-medium text-signal-amber-ink">value not known</span> : null}
            </span>
          ) : <span className="text-[13px] font-semibold text-muted-foreground">No change</span>
        ) : null}
      </div>
      {entry.status === "ISSUED_FOUND" ? (
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          {count.can.decide ? (
            <>
              {!entry.decision ? <Chip tone="amber">Choose one before approving</Chip> : null}
              <button type="button" disabled={deciding} onClick={() => onDecide(entry, "LEAVE_AS_USED")} className={cn("inline-flex min-h-11 items-center rounded-xl border px-3 text-[13px] font-semibold", entry.decision === "LEAVE_AS_USED" ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground")} aria-pressed={entry.decision === "LEAVE_AS_USED"} data-testid="decide-leave">Leave as used (no change)</button>
              <button type="button" disabled={deciding} onClick={() => onDecide(entry, "ADD_ON_QC_HOLD")} className={cn("inline-flex min-h-11 items-center rounded-xl border px-3 text-[13px] font-semibold", entry.decision === "ADD_ON_QC_HOLD" ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground")} aria-pressed={entry.decision === "ADD_ON_QC_HOLD"} data-testid="decide-add">Add as new stock on QC hold</button>
            </>
          ) : <Chip tone={entry.decision === "ADD_ON_QC_HOLD" ? "blue" : "slate"}>{entry.decision === "ADD_ON_QC_HOLD" ? "Added as new stock on QC hold" : entry.decision ? "Left as used" : "Owner decides"}</Chip>}
        </div>
      ) : null}
    </li>
  )
}

export default function CountHubPage() {
  // Names arrive with the people directory, sometimes after the page first shows: show them at once.
  usePeopleVersion()
  const params = useParams<{ id: string }>()
  const countId = String(params.id)
  const single = useSinglePlant()
  const query = useCount(countId, 20000)
  const submit = useSubmitCount()
  const approve = useApproveCount()
  const sendBack = useSendBackCount()
  const cancel = useCancelCount()
  const decide = useDecide()
  const [sheet, setSheet] = useState<"" | "approve" | "back" | "cancel" | "submit">("")
  const [note, setNote] = useState("")
  const [backRacks, setBackRacks] = useState<string[]>([])
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null)
  const [showOk, setShowOk] = useState(false)
  const count = query.data

  const groups = useMemo(() => GROUPS.map((group) => ({ ...group, rows: (count?.entries || []).filter((entry) => groupOf(entry) === group.key) })).filter((group) => group.rows.length), [count])
  const openSheet = (name: typeof sheet) => { setNote(""); setBackRacks([]); setMessage(null); setSheet(name) }
  const run = async (task: () => Promise<unknown>, ok: string) => {
    try { await task(); setSheet(""); setMessage({ tone: "emerald", text: ok }) } catch (error) { setMessage({ tone: "rose", text: errorText(error) }) }
  }

  if (!single) return <PickPlant what="a stock count" />
  if (query.isLoading) return <LoadingState label="Opening the count…" />
  if (!count && [404, 422].includes((query.error as any)?.response?.status)) {
    // Not a connection problem: retrying cannot help, so the way out is back to the counts list.
    return (
      <div className="mx-auto max-w-xl space-y-3" data-testid="count-not-found">
        <BackLink href="/inventory/stock-control?tab=counts">Stock counts & book</BackLink>
        <EmptyBlock icon={ClipboardList} title={(query.error as any)?.response?.status === 422 ? "This count does not exist" : "This count is not in this plant"} message="The link may be wrong, or it may belong to another plant: check the plant at the top. Otherwise open the list of counts and pick it from there."
          action={<Link href="/inventory/stock-control?tab=counts" className="erp-btn-primary !h-11">Back to Stock counts & book</Link>} />
      </div>
    )
  }
  if (!count) return <ErrorState title="This count could not be opened" message={errorText(query.error, "Check the connection and try again.")} onRetry={() => void query.refetch()} />

  const s = count.summary
  const notDone = count.racks.filter((rack) => rack.status !== "DONE")
  const next = nextRack(count.racks)
  const reviewing = count.status !== "DRAFT"
  const newLots = count.entries.filter((entry) => entry.created_lot_id)
  // Lines with no rate are left out of the rupee figures; say so, with their quantity per unit.
  const unpriced = s.unpriced_lines ?? 0
  const unpricedQty = (s.unpriced_by_unit ?? []).map((row) => [
    Math.abs(row.loss) > 0.0005 ? `${qtyText(Math.abs(row.loss), row.uom)} short` : "",
    row.gain > 0.0005 ? `${qtyText(row.gain, row.uom)} extra` : "",
  ].filter(Boolean).join(", ")).filter(Boolean).join("; ")
  // A month-end count posts on the month's last day (or today, if the month is still running); a spot count today.
  const today = businessDate()
  const monthEnd = count.kind === "MONTH_END" && count.month ? `${count.month}-${String(new Date(Date.UTC(Number(count.month.slice(0, 4)), Number(count.month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}` : today
  const effective = monthEnd < today ? dayText(monthEnd) : "today"

  return (
    <div className="space-y-4 pb-24" data-testid="count-hub">
      <BackLink href="/inventory/stock-control?tab=counts">Stock counts & book</BackLink>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{count.count_no} · started by {who(count.created_by)} · {dayText(count.created_at)}</p>
          <h1 className="mt-1 text-[24px] font-bold tracking-tight text-foreground sm:text-[28px]"><KindTitle text={count.kind_word} /></h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip tone={COUNT_STATUS_TONE[count.status]} testId="count-status">{count.status_word}</Chip>
            {count.counters.length ? <Chip tone="slate" icon={Users}>{count.counters.map(who).join(", ")}</Chip> : null}
          </div>
        </div>
        {/* One main action at a time: keep counting, then send, then (Owner) approve. */}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {count.can.count && next ? (
            <Link href={`/inventory/counts/${countId}/rack/${next.key}`} className="erp-btn-primary !h-11 flex-1 sm:flex-none" data-testid="count-continue">
              <ScanLine className="h-4 w-4" aria-hidden="true" />{next.status === "TODO" ? "Count" : "Continue counting"} {next.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          {count.can.submit && !notDone.length ? <button type="button" className="erp-btn-primary !h-11 flex-1 sm:flex-none" onClick={() => openSheet("submit")} data-testid="count-submit"><Send className="h-4 w-4" aria-hidden="true" />Send to the Owner</button> : null}
          {count.can.approve ? <button type="button" className="erp-btn-primary !h-11 flex-1 sm:flex-none" onClick={() => openSheet("approve")} data-testid="count-approve"><BadgeCheck className="h-4 w-4" aria-hidden="true" />Approve and post</button> : null}
          {count.can.send_back ? <button type="button" className="erp-btn-secondary !h-11 flex-1 sm:flex-none" onClick={() => openSheet("back")} data-testid="count-send-back"><Undo2 className="h-4 w-4" aria-hidden="true" />Send back</button> : null}
          {count.can.cancel ? <button type="button" className="erp-btn-secondary !h-11" onClick={() => openSheet("cancel")} data-testid="count-cancel">Cancel count</button> : null}
        </div>
      </header>

      {message ? <Notice tone={message.tone} testId="count-message" mirror>{message.text}</Notice> : null}
      <Steps count={count} />
      {count.status === "DRAFT" && count.sent_back_note ? <Notice tone="amber" title={`Sent back by ${who(count.sent_back_by)} · ${timeText(count.sent_back_at)}`}>{count.sent_back_note}</Notice> : null}
      {count.status === "DRAFT" && notDone.length ? <Notice tone="blue" title={`${plural(notDone.length, "rack")} still to finish`}>Open a rack, scan what is on it and tap Rack done. When every rack is done, Send to the Owner appears here.</Notice> : null}
      {count.status === "DRAFT" && !notDone.length && count.can.submit ? <Notice tone="emerald" title="Every rack is done">Check the lines below, then send the count to the Owner.</Notice> : null}
      {count.status === "SUBMITTED" && count.approve_refusal ? <Notice tone="amber" title="This count can no longer be approved" testId="count-approve-refusal">{count.approve_refusal}</Notice> : null}
      {count.status === "SUBMITTED" && !count.can.approve && !count.approve_refusal ? <Notice tone="blue" title="Waiting for the Owner">Counting is locked. The Owner approves the count or sends racks back for a recount.</Notice> : null}
      {count.status === "CANCELLED" ? <Notice tone="slate" title={`Cancelled by ${who(count.cancelled_by)}`}>{count.cancel_note || "Stock did not change."}</Notice> : null}
      {count.voucher ? (
        <Notice tone="emerald" icon={FileCheck2} title={`Stock updated · ${(count.vouchers?.length ? count.vouchers : [count.voucher]).map((row) => row.voucher_no).join(" and ")}`} testId="count-posted"
          action={<>
            {newLots.length && count.can.print_labels ? <Link href={`/inventory/locations/lot-labels?ids=${newLots.map((entry) => entry.created_lot_id).join(",")}&count=${countId}`} className="erp-btn-primary !h-11" data-testid="count-print-new-lots"><Printer className="h-4 w-4" aria-hidden="true" />Print {plural(newLots.length, "new label")}</Link> : null}
            <Link href={`/inventory/stock-control?tab=book&month=${(count.voucher.effective_date || "").slice(0, 7)}`} className="erp-btn-secondary !h-11">Open the stock book</Link>
          </>}>
          {(count.vouchers?.length ? count.vouchers : [count.voucher]).map((row) => `${plural(row.line_count, "line")} posted, dated ${dayText(row.effective_date)}`).join("; ")}.
          {count.vouchers && count.vouchers.length > 1 ? " Lots received after the month end are changed on the approval day, never before they came in." : ""}
          {count.status === "CERTIFIED" ? ` This is the stock certificate for ${count.month_label}.` : ""}
          {newLots.length ? (count.can.print_labels
            ? ` ${plural(newLots.length, "new lot")} on QC hold need a label: print and stick it before the lot is moved.`
            : ` ${plural(newLots.length, "new lot")} on QC hold need a label: the store prints it.`) : ""}
        </Notice>
      ) : ["APPROVED", "CERTIFIED"].includes(count.status) ? <Notice tone="emerald" title="Approved">The count matched the book: no stock change was needed.</Notice> : null}

      {count.changed_after_count?.length ? <ChangedAfterCountNotice items={count.changed_after_count} monthLabel={count.month_label} /> : null}

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" data-testid="count-summary">
        <Stat label="Found" value={s.found} tone="emerald" icon={CheckCircle2} detail={s.filed ? `${s.filed} had no location` : undefined} />
        <Stat label="Not found" value={s.missing} tone="rose" icon={AlertTriangle} />
        <Stat label="Extra" value={s.extra + s.loose} tone="blue" icon={PackagePlus} detail={s.loose ? `${s.loose} without a label` : undefined} />
        <Stat label="Wrong place" value={s.wrong_place} tone="amber" icon={ArrowRightLeft} />
        <Stat label="Issued, found" value={s.issued_found} tone="violet" icon={Ban} />
        <Stat label="Value" value={rupees(s.net_value)} tone={unpriced ? "amber" : s.net_value < 0 ? "rose" : "emerald"} testId="count-value"
          detail={`${rupees(s.loss_value)} short · ${rupees(s.gain_value)} extra${unpriced ? ` · ${unpriced} with no rate` : ""}`} />
      </section>
      {s.by_unit.length ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground" data-testid="count-units">
          {s.by_unit.map((row) => (
            <span key={row.uom}>
              {Math.abs(row.loss) > 0.0005 ? <><b className="text-signal-rose-ink">{qtyText(Math.abs(row.loss), row.uom)}</b> short · </> : null}
              {row.gain > 0.0005 ? <><b className="text-signal-emerald-ink">{qtyText(row.gain, row.uom)}</b> extra · </> : null}
              net <b className="text-foreground">{signedQty(row.net, row.uom)}</b>
            </span>
          ))}
        </p>
      ) : null}
      {unpriced ? (
        <Notice tone="amber" title={`Rate not known for ${plural(unpriced, "line")}`} testId="count-unpriced">
          {unpricedQty ? `That is ${unpricedQty}. ` : ""}No rate is known yet (usually a goods inward whose invoice is still pending), so the value above leaves {unpriced === 1 ? "it" : "them"} out. The stock change is still posted in full.
        </Notice>
      ) : null}

      <Panel title="Racks" icon={ClipboardList} description={count.status === "DRAFT" ? "Tap a rack to count it. Several people can count different racks at the same time." : `${count.racks_done} of ${plural(count.racks_total, "rack")} done`} testId="count-racks" bodyClassName="p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {count.racks.map((rack) => <RackTile key={rack.key} rack={rack} countId={countId} canCount={count.can.count} />)}
        </div>
      </Panel>

      {reviewing || count.entries.length ? (
        <Panel title={count.can.approve ? "Review before approving" : "Lines"} description="Every counted thing, grouped by what approval will do." testId="count-review" bodyClassName="p-0">
          {groups.length ? groups.filter((group) => group.key !== "ok" || showOk).map((group) => (
            <section key={group.key} className="border-b border-border last:border-0" data-testid={`count-group-${group.key}`}>
              <header className={cn("flex flex-wrap items-center gap-2 px-4 py-2.5", TONE[group.tone].panel, "border-0")}>
                <group.icon className="h-4 w-4" aria-hidden="true" />
                <h3 className="text-[13.5px] font-semibold">{group.title} · {group.rows.length}</h3>
                {group.help ? <span className="text-[12px] opacity-80">{group.help}</span> : null}
              </header>
              <ul className="divide-y divide-border">{group.rows.map((entry) => <EntryRow key={entry.id} entry={entry} count={count} deciding={decide.isPending} onDecide={(row, decision) => void decide.mutateAsync({ id: countId, entryId: row.id, decision }).catch((error) => setMessage({ tone: "rose", text: errorText(error) }))} />)}</ul>
            </section>
          )) : <div className="p-4"><EmptyBlock title="Nothing counted yet" message="Lines show here as racks are counted." /></div>}
          {groups.some((group) => group.key === "ok") ? (
            <button type="button" onClick={() => setShowOk(!showOk)} className="flex min-h-11 w-full items-center justify-center gap-1 border-t border-border text-[13px] font-semibold text-primary" data-testid="count-toggle-ok">
              {showOk ? "Hide" : "Show"} {groups.find((group) => group.key === "ok")?.rows.length} found as the book says
            </button>
          ) : null}
        </Panel>
      ) : null}

      <Sheet open={sheet === "submit"} onOpenChange={(open) => !open && setSheet("")} title="Send the count to the Owner?" description="Counting locks. The Owner approves it or sends racks back for a recount."
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setSheet("")}>Not yet</button><button type="button" className="erp-btn-primary !h-11" disabled={submit.isPending} onClick={() => run(() => submit.mutateAsync({ id: countId, note }), "Sent to the Owner.")} data-testid="count-submit-confirm">Send</button></>}>
        <Field label="Note for the Owner (optional)"><textarea className={`${fieldClass} !h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></Field>
      </Sheet>

      <Sheet open={sheet === "approve"} onOpenChange={(open) => !open && setSheet("")} title="Approve and post?" testId="count-approve-sheet"
        description={`Stock changes now, dated ${effective}. This cannot be undone; a later count or correction fixes any mistake.`}
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setSheet("")}>Cancel</button><button type="button" className="erp-btn-primary !h-11 min-w-36" disabled={approve.isPending || s.undecided > 0} onClick={() => run(() => approve.mutateAsync({ id: countId, note }), "Approved. Stock is updated.")} data-testid="count-approve-confirm">{approve.isPending ? "Posting…" : "Approve and post"}</button></>}>
        <ul className="space-y-2 text-[13.5px] text-foreground" data-testid="count-approve-list">
          <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-rose-ink" aria-hidden="true" />{s.missing} not found: written off by their own label.</li>
          <li className="flex gap-2"><CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-signal-violet-ink" aria-hidden="true" />{s.qty_different} quantity different: each lot is set to what was counted.</li>
          <li className="flex gap-2"><PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-signal-blue-ink" aria-hidden="true" />{s.extra + s.loose} extra: known lots add back; {s.loose} without a label become new lots on QC hold.</li>
          <li className="flex gap-2"><ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-signal-amber-ink" aria-hidden="true" />{s.wrong_place} in the wrong place: moved to where they were found.</li>
          {s.filed ? <li className="flex gap-2"><MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-signal-blue-ink" aria-hidden="true" />{s.filed} had no location: filed where they were found.</li> : null}
          {s.issued_found ? <li className="flex gap-2"><Ban className="mt-0.5 h-4 w-4 shrink-0 text-signal-violet-ink" aria-hidden="true" />{s.issued_found} issued but found{s.undecided ? ` (${s.undecided} not decided yet)` : ""}.</li> : null}
          {s.used || s.arrived || s.moved ? <li className="flex gap-2"><Inbox className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{[s.used ? `${s.used} used during the count` : "", s.arrived ? `${s.arrived} arrived during the count` : "", s.moved ? `${s.moved} moved away` : ""].filter(Boolean).join(", ")}: no change.</li> : null}
          <li className="flex gap-2"><FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Value {rupees(s.net_value)}{unpriced ? ` (${plural(unpriced, "line")} with no rate not in it: ${unpricedQty})` : ""}{count.kind === "MONTH_END" ? `; becomes the stock certificate for ${count.month_label}` : ""}.</li>
        </ul>
        {s.undecided ? <Notice tone="amber" className="mt-3" testId="count-approve-undecided" title={`Decide ${plural(s.undecided, "issued-but-found line")} first`}>For each one choose Leave as used, or Add as new stock on QC hold, in the list below. Approval never picks for you.</Notice> : null}
        <Field label="Note (optional)" className="mt-3"><input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></Field>
        {message?.tone === "rose" ? <Notice tone="rose" className="mt-3">{message.text}</Notice> : null}
      </Sheet>

      <Sheet open={sheet === "back"} onOpenChange={(open) => !open && setSheet("")} title="Send back for a recount" description="The chosen racks go back to counting with your note. Scans already made stay." testId="count-back-sheet"
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setSheet("")}>Cancel</button><button type="button" className="erp-btn-primary !h-11" disabled={note.trim().length < 3 || sendBack.isPending} onClick={() => run(() => sendBack.mutateAsync({ id: countId, note: note.trim(), racks: backRacks }), "Sent back for a recount.")} data-testid="count-back-confirm">Send back</button></>}>
        <Field label="What should be counted again? (needed)"><textarea className={`${fieldClass} !h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} data-testid="count-back-note" /></Field>
        <p className="mt-3 text-[12.5px] font-semibold text-foreground">Racks to count again <span className="font-normal text-muted-foreground">(none ticked = all)</span></p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {count.racks.map((rack) => (
            <label key={rack.key} className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3">
              <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={backRacks.includes(rack.key)} onChange={() => setBackRacks(backRacks.includes(rack.key) ? backRacks.filter((key) => key !== rack.key) : [...backRacks, rack.key])} />
              <span className={cn("text-[13px] font-semibold", rack.bucket !== "UNASSIGNED" && "font-mono")}>{rack.label}</span>
            </label>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === "cancel"} onOpenChange={(open) => !open && setSheet("")} title="Cancel this count?" description="Nothing in stock changes. The count stays in the list as cancelled."
        footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => setSheet("")}>Keep it</button><button type="button" className="erp-btn-primary !h-11" disabled={cancel.isPending} onClick={() => run(() => cancel.mutateAsync({ id: countId, note }), "Count cancelled.")} data-testid="count-cancel-confirm">Cancel count</button></>}>
        <Field label="Why (optional)"><input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></Field>
      </Sheet>
    </div>
  )
}
