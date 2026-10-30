"use client"

import Link from "next/link"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, CalendarDays, CalendarRange, FileClock, FileSpreadsheet, Info, LayoutList, Lightbulb, PackageX, Plus, Rows3, Search, ShieldCheck, Truck } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { MessageBar, ProcurementShell, SummaryCard, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { OwnerBar, ReviewSheet, SuggestSheet } from "@/components/procurement/rm-calendar/approval"
import { Legend, Segmented } from "@/components/procurement/rm-calendar/atoms"
import { ArrivalForm, DaySheet, MaterialSheet, type Notice, type Permissions, type Vendor } from "@/components/procurement/rm-calendar/detail-sheet"
import { ExcelSheet } from "@/components/procurement/rm-calendar/excel"
import { CLASS_TABS, longDate, perUnit, perUnitParts, qty, searchMatch, shortDate } from "@/components/procurement/rm-calendar/format"
import { Sheet } from "@/components/procurement/rm-calendar/sheet"
import { ListView, MonthView, WeekGrid } from "@/components/procurement/rm-calendar/views"
import { EmptyQueryState, ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useVendors } from "@/hooks/use-master-data"
import { useApproveArrivals, useQueueCounts, useRmCalendar, useSuggestArrivals, useUpdateArrival } from "@/hooks/use-rm-calendar"
import { apiErrorText, type Arrival, type CalendarMaterial, type MaterialClass, type PendingArrival, type Suggestion } from "@/lib/api-rm-calendar"
import { cn } from "@/lib/utils"

type View = "week" | "month" | "list"
type ClassTab = MaterialClass | "ALL"

// Spec 2.8 (the server checks the same): proposing leaves Admin out; the purchase queue is the desk's.
const PROPOSER_ROLES = ["Planner", "Store", "PlantManager", "Owner"]
const RECEIVER_ROLES = ["GRN", "Store", "PlantManager", "Owner", "Admin"]
const QUEUE_ROLES = ["Store", "Planner", "PlantManager", "Owner", "Admin"]

export default function RmInwardCalendarPage() {
  return <Suspense fallback={<LoadingState label="Opening the RM inward calendar…" />}><RmInwardCalendar /></Suspense>
}

function RmInwardCalendar() {
  const params = useSearchParams(), router = useRouter(), pathname = usePathname()
  const { user, activeRole } = useAuth()
  const roles = useMemo(() => new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[]), [user, activeRole])
  const permissions: Permissions = useMemo(() => ({
    isOwner: roles.has("Owner"),
    canPropose: PROPOSER_ROLES.some((role) => roles.has(role)),
    canReceive: RECEIVER_ROLES.some((role) => roles.has(role)),
  }), [roles])
  const canOpenQueue = QUEUE_ROLES.some((role) => roles.has(role))

  const requestedView = params.get("view") as View | null
  const [autoView, setAutoView] = useState<View>("week")
  const [legendOpen, setLegendOpen] = useState(false)
  useEffect(() => {
    // Phone first: the list view by default.
    if (window.matchMedia("(max-width: 767px)").matches) setAutoView("list")
  }, [])
  const view: View = requestedView && ["week", "month", "list"].includes(requestedView) ? requestedView : autoView
  const weeks = [4, 8, 12].includes(Number(params.get("weeks"))) ? Number(params.get("weeks")) : 8
  const classTab = (CLASS_TABS.some((tab) => tab.id === params.get("class")) ? params.get("class") : "PAPER") as ClassTab
  const search = params.get("q") || ""
  const setParams = useCallback((values: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    Object.entries(values).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
    router.replace(`${pathname}?${next}`, { scroll: false })
  }, [params, pathname, router])
  const [draftSearch, setDraftSearch] = useState(search)
  // The box follows the URL only when the URL changed from elsewhere (back button, a link), never
  // when it is catching up with what was typed: keys typed while the URL updates are kept.
  const pushedSearch = useRef(search)
  useEffect(() => {
    if (search === pushedSearch.current) return
    pushedSearch.current = search
    setDraftSearch(search)
  }, [search])
  useEffect(() => {
    if (draftSearch === pushedSearch.current) return
    const timer = setTimeout(() => { pushedSearch.current = draftSearch; setParams({ q: draftSearch || null }) }, 250)
    return () => clearTimeout(timer)
  }, [draftSearch, setParams])

  const calendar = useRmCalendar(weeks)
  const queues = useQueueCounts()
  const vendorsQuery = useVendors()
  const vendors: Vendor[] = useMemo(() => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []), [vendorsQuery.data])
  const approve = useApproveArrivals()
  const update = useUpdateArrival()
  const suggestMutation = useSuggestArrivals()
  const data = calendar.data

  const [notice, setNotice] = useState<Notice | null>(null)
  const [detail, setDetail] = useState<{ itemId: string; day: string | null } | null>(null)
  const [daySheet, setDaySheet] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(params.get("review") === "1")
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [confirmMove, setConfirmMove] = useState<{ arrival: Arrival; day: string; qty?: number } | null>(null)
  const [weekIndex, setWeekIndex] = useState(0)
  useEffect(() => setWeekIndex(0), [weeks])

  const classMaterials = useMemo(() => (data?.materials || []).filter((row) => classTab === "ALL" || row.material_class === classTab), [data, classTab])
  const materials = useMemo(() => classMaterials.filter((row) => searchMatch(row, search)), [classMaterials, search])
  const visiblePending = useMemo(() => (data?.pending_approval.entries || []).filter((row) => materials.some((material) => material.item_id === row.item_id)), [data, materials])
  const detailMaterial = detail && data ? data.materials.find((row) => row.item_id === detail.itemId) || null : null
  const tabCounts = useMemo(() => Object.fromEntries(CLASS_TABS.map((tab) => {
    const rows = (data?.materials || []).filter((row) => tab.id === "ALL" || row.material_class === tab.id)
    return [tab.id, { count: rows.length, short: rows.filter((row) => row.first_short).length }]
  })), [data])

  // The KPI follows the class tab, as the tab badges do; it names the class and the all-class figure (checker r1: 8 vs 9).
  const classLabel = CLASS_TABS.find((tab) => tab.id === classTab)?.label || "All"
  const allShort = tabCounts.ALL?.short || 0
  const kpis = useMemo(() => {
    if (!data) return null
    const short = classMaterials.filter((row) => row.first_short).sort((a, b) => a.first_short!.date.localeCompare(b.first_short!.date))
    // Counted arrivals over the next 7 days (Owner-approved and open PO rows). Stock waiting for
    // incoming QC is already in the store, so it is never part of this total.
    const arriving: Record<string, number> = {}
    for (const material of classMaterials) {
      material.arrive.slice(0, 7).forEach((value) => { if (value > 0) arriving[material.uom] = (arriving[material.uom] || 0) + value })
    }
    return { short, arriving }
  }, [data, classMaterials])

  // Until the calendar has loaded, nothing is known: never an all-clear (checker 2026-10-28).
  const notKnown = calendar.isError ? "Not known: the calendar did not load" : "Working it out…"

  async function approveRows(rows: PendingArrival[]) {
    const ready = rows.filter((row) => row.supplier_id)
    if (!ready.length) { setNotice({ tone: "info", text: "Pick a vendor for these arrivals first; an arrival without a vendor cannot go on a PO." }); return }
    try {
      const result = await approve.mutateAsync({ entryIds: ready.map((row) => row.entry_id), supplierIds: Array.from(new Set(ready.map((row) => row.supplier_id!))) })
      const orders = result.purchase_orders
      const skipped = result.skipped.map((row) => row.reason)
      setNotice({
        tone: orders.length ? "success" : "info",
        text: `${result.approved.length} arrival${result.approved.length === 1 ? "" : "s"} approved. ${orders.length ? `${orders.length} PO draft${orders.length === 1 ? "" : "s"} ready to send: ${orders.map((row) => `${row.po_no} (${row.supplier_name})`).join(", ")}.` : ""}${orders.some((row) => row.rate_needed) ? " Some lines need a rate before sending." : ""}${skipped.length ? ` Not approved: ${skipped.join("; ")}.` : ""}`,
        href: orders.length ? "/purchase?tab=scheduled" : undefined, linkText: orders.length ? "Open drafts to send" : undefined,
      })
      setReviewOpen(false)
    } catch (failure) {
      setNotice({ tone: "error", text: apiErrorText(failure) })
    }
  }

  async function moveArrival(arrival: Arrival, day: string, confirm = false, qtyValue?: number) {
    if (!arrival.entry_id) return
    // The vendor already has this PO: ask before changing it (the server asks the same with a 409).
    if (!confirm && sentToVendor(arrival)) { setConfirmMove({ arrival, day, qty: qtyValue }); return }
    try {
      const result = await update.mutateAsync({ id: arrival.entry_id, entry_date: day, ...(qtyValue ? { qty: qtyValue } : {}), ...(confirm ? { confirm_po_change: true } : {}) })
      // A sent PO asks first ("PO already sent — change the PO?"); that is a question, not an error.
      if (result.needs_po_change) { setConfirmMove({ arrival, day, qty: qtyValue }); return }
      setNotice({ tone: "success", text: `Arrival moved to ${longDate(day)}.${confirm ? ` ${arrival.po_no} has a new revision; send it to the vendor again.` : ""}`,
        href: confirm && arrival.po_id ? `/purchase/${arrival.po_id}` : undefined, linkText: confirm ? `Open ${arrival.po_no}` : undefined })
      setConfirmMove(null)
    } catch (failure) {
      setNotice({ tone: "error", text: apiErrorText(failure) })
      setConfirmMove(null)
    }
  }

  async function runSuggest() {
    setSuggestions([])
    setSuggestOpen(true)
    try { setSuggestions(await suggestMutation.mutateAsync({ weeks, material_class: classTab })) } catch { /* shown in the sheet */ }
  }

  const openDetail = (material: CalendarMaterial, day?: string | null) => setDetail({ itemId: material.item_id, day: day || null })
  const excelButton = <button type="button" className={secondaryButton} onClick={() => setExcelOpen(true)} disabled={!data}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Excel</button>
  const headerActions = permissions.canPropose ? (
    <>
      {excelButton}
      <button type="button" className={secondaryButton} onClick={runSuggest} disabled={!data}><Lightbulb className="h-4 w-4" aria-hidden="true" />Suggest arrivals</button>
      <button type="button" className={primaryButton} onClick={() => setAddOpen(true)} disabled={!data}><Plus className="h-4 w-4" aria-hidden="true" />Add arrival</button>
    </>
  ) : <>{excelButton}<Link href="/purchase/supplier-deliveries" className={secondaryButton}><Truck className="h-4 w-4" aria-hidden="true" />Expected arrivals</Link></>

  return (
    <ProcurementShell eyebrow="Purchasing" title="RM inward calendar"
      description="What each material needs day by day, what is in stock and what is arriving. The Owner approves arrivals; they become draft POs ready to send."
      actions={headerActions}>
      {notice ? (
        <MessageBar tone={notice.tone}>
          <span>{notice.text}</span>
          {notice.href ? <Link data-no-mirror href={notice.href} className="ml-2 inline-flex min-h-[28px] items-center font-semibold underline underline-offset-2">{notice.linkText || "Open"}</Link> : null}
          <button data-no-mirror type="button" className="ml-3 inline-flex min-h-[28px] items-center text-[12px] underline underline-offset-2 opacity-80" onClick={() => setNotice(null)}>Dismiss</button>
        </MessageBar>
      ) : null}

      <section className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4 [&>*]:h-full [&_article]:h-full" aria-label="Summary">
        <KpiAction onClick={kpis?.short.length ? () => openDetail(kpis.short[0], kpis.short[0].first_short!.date) : undefined}>
          <SummaryCard label={classTab === "ALL" ? "Short materials" : `Short materials · ${classLabel}`} value={kpis ? kpis.short.length : "—"} icon={AlertTriangle} tone={!kpis ? "slate" : kpis.short.length ? "rose" : "emerald"}
            detail={!kpis ? notKnown : `${kpis.short.length ? `First: ${kpis.short[0].item_name} on ${shortDate(kpis.short[0].first_short!.date)}` : `None in ${weeks} weeks`}${allShort > kpis.short.length ? ` · ${allShort} in all classes` : ""}`} />
        </KpiAction>
        <KpiAction onClick={data?.pending_approval.count ? () => setReviewOpen(true) : undefined}>
          <SummaryCard label={permissions.isOwner ? "Waiting for you" : "Waiting for the Owner"} value={data ? data.pending_approval.count : "—"} icon={ShieldCheck} tone={data?.pending_approval.count ? "amber" : "slate"}
            detail={!data ? notKnown : data.pending_approval.count ? `${perUnit(data.pending_approval.qty_by_uom)} proposed` : "Nothing waits for approval"} />
        </KpiAction>
        {canOpenQueue ? (
          <Link href="/purchase?tab=scheduled" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <SummaryCard label="Drafts to send" value={queues.data ? queues.data.queues?.scheduled ?? 0 : "—"} icon={FileClock} tone={queues.data?.queues?.scheduled ? "cyan" : "slate"}
              detail={queues.isError ? "Not known: the queue did not load" : "Owner-scheduled, not yet sent"} />
          </Link>
        ) : (
          <div>
            <SummaryCard label="Drafts to send" value={queues.data ? queues.data.queues?.scheduled ?? 0 : "—"} icon={FileClock} tone={queues.data?.queues?.scheduled ? "cyan" : "slate"}
              detail="With the purchase desk" />
          </div>
        )}
        <Link href="/purchase/supplier-deliveries" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <SummaryCard label="Arriving in 7 days" value={kpis ? <PerUnitLines totals={kpis.arriving} /> : "—"} icon={Truck} tone={kpis ? "emerald" : "slate"} detail={kpis ? "Approved and on POs; stock in QC not included" : notKnown} />
        </Link>
      </section>

      <section className="erp-panel min-w-0 space-y-3 rounded-xl p-3 sm:p-4" aria-label="Calendar controls">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented fill label="Window" value={String(weeks)} onChange={(value) => setParams({ weeks: value === "8" ? null : value })}
            options={[{ id: "4", label: "4 weeks" }, { id: "8", label: "8 weeks" }, { id: "12", label: "12 weeks" }]} />
          <Segmented fill label="View" value={view} onChange={(value) => setParams({ view: value })}
            options={[{ id: "week", label: <><Rows3 className="h-4 w-4" aria-hidden="true" />Week</> }, { id: "month", label: <><CalendarDays className="h-4 w-4" aria-hidden="true" />Month</> }, { id: "list", label: <><LayoutList className="h-4 w-4" aria-hidden="true" />List</> }]} />
          <label className="relative ml-auto w-full min-w-0 sm:w-64">
            <span className="sr-only">Search materials</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input className={cn(fieldClass, "pl-9 max-sm:h-11")} type="search" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search material or code" aria-label="Search material or code" />
          </label>
        </div>
        <div>
          <Segmented fill label="Material class" value={classTab} onChange={(value) => setParams({ class: value === "PAPER" ? null : value })}
            options={CLASS_TABS.map((tab) => ({ id: tab.id, label: tab.label, count: data ? tabCounts[tab.id]?.count ?? 0 : undefined, short: data ? tabCounts[tab.id]?.short || 0 : 0 }))} />
        </div>
        <details className="group rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2" open={legendOpen} onToggle={(event) => setLegendOpen((event.currentTarget as HTMLDetailsElement).open)}>
          <summary className="flex min-h-11 cursor-pointer sm:min-h-8 list-none flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] font-semibold text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="sm:hidden">What the colours mean</span>
            <Legend compact className="hidden flex-1 group-open:hidden sm:flex" />
            <span className="ml-auto shrink-0 text-[11.5px] font-normal underline underline-offset-2 group-open:hidden">Explain</span>
            <span className="ml-auto hidden shrink-0 text-[11.5px] font-normal underline underline-offset-2 group-open:inline">Hide</span>
          </summary>
          <Legend className="mt-2" />
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
            Balance = yesterday&apos;s balance + counted arrivals − need, starting from usable stock now. Stock waiting for incoming QC counts from tomorrow (it is not an arrival). Received goods are stock, never counted twice. Late need (due before today) sits on today. Boxes, plastic and fadda for a card count until its Packing step closes (or closes by itself after Process), not until dispatch.
          </p>
        </details>
      </section>

      {data && (data.warnings.length || data.unmapped.length) ? <DemandNotes data={data} /> : null}

      {calendar.isLoading ? <LoadingState label="Working out need, stock and arrivals for every material…" /> : null}
      {calendar.isError ? <ErrorState title="The calendar could not be calculated" message={apiErrorText(calendar.error)} onRetry={() => calendar.refetch()} /> : null}
      {data && !materials.length ? (
        <EmptyQueryState title={search ? `Nothing matches “${search}”` : `No ${classTab === "ALL" ? "" : CLASS_TABS.find((tab) => tab.id === classTab)?.label.toLowerCase() + " "}needs, stock or arrivals`}
          message={search ? "Clear the search or pick another class." : `Nothing to plan for the next ${weeks} weeks in this class.`}
          action={search ? <button type="button" className={secondaryButton} onClick={() => setParams({ q: null })}>Clear search</button> : null} />
      ) : null}
      {data && materials.length ? (
        view === "week" ? (
          <WeekGrid data={data} materials={materials} permissions={permissions} weekIndex={weekIndex} onWeekChange={setWeekIndex}
            onOpen={openDetail} onMove={(arrival, day) => moveArrival(arrival, day)} approving={approve.isPending}
            onApproveWeek={(week) => approveRows(visiblePending.filter((row) => week.includes(row.date < data.today ? data.today : row.date)))} />
        ) : view === "month" ? (
          <MonthView data={data} materials={materials} onOpenDay={setDaySheet} />
        ) : (
          <ListView data={data} materials={materials} permissions={permissions} onOpen={openDetail} onAdd={(material) => setDetail({ itemId: material.item_id, day: material.first_short?.date || null })} />
        )
      ) : null}

      {data && permissions.isOwner ? (
        <OwnerBar pending={data.pending_approval} visible={visiblePending} busy={approve.isPending} onReview={() => setReviewOpen(true)} onApproveAll={() => approveRows(visiblePending)} />
      ) : data && data.pending_approval.count ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground"><ShieldCheck className="h-4 w-4 text-signal-violet-ink" aria-hidden="true" />{data.pending_approval.count} proposed arrival{data.pending_approval.count === 1 ? " waits" : "s wait"} for the Owner&apos;s approval.</p>
      ) : null}

      {data ? (
        <>
          <MaterialSheet open={Boolean(detailMaterial)} onOpenChange={(open) => { if (!open) setDetail(null) }} data={data} material={detailMaterial} day={detail?.day || null}
            vendors={vendors} permissions={permissions} onNotice={setNotice} onMoveConfirm={(arrival, day, qtyValue) => setConfirmMove({ arrival, day, qty: qtyValue })} />
          <DaySheet open={Boolean(daySheet)} onOpenChange={(open) => { if (!open) setDaySheet(null) }} data={data} day={daySheet} materials={materials}
            onPick={(material, day) => { setDaySheet(null); openDetail(material, day) }} />
          <Sheet open={addOpen} onOpenChange={setAddOpen} title="Add an arrival" eyebrow="RM inward calendar"
            description={permissions.isOwner ? "Propose it, or add and approve it at once: it goes on the vendor's draft PO for that week." : "It goes to the Owner for approval. Approved arrivals become draft POs."}>
            <ArrivalForm compact data={data} materials={classMaterials.length ? classMaterials : data.materials} vendors={vendors} permissions={permissions}
              onDone={(next) => { setNotice(next); setAddOpen(false) }} />
          </Sheet>
          <ReviewSheet open={reviewOpen} onOpenChange={setReviewOpen} pending={data.pending_approval.entries} today={data.today} busy={approve.isPending} onApprove={approveRows}
            canApprove={permissions.isOwner} canPropose={permissions.canPropose} vendors={vendors} onNotice={setNotice} />
          <SuggestSheet open={suggestOpen} onOpenChange={setSuggestOpen} suggestions={suggestions} loading={suggestMutation.isPending}
            error={suggestMutation.isError ? apiErrorText(suggestMutation.error) : ""} onDone={setNotice} vendors={vendors} />
          <ExcelSheet open={excelOpen} onOpenChange={setExcelOpen} data={data} materials={materials} classLabel={CLASS_TABS.find((tab) => tab.id === classTab)?.label || "All"}
            canImport={permissions.canPropose} vendors={vendors} onDone={setNotice} />
        </>
      ) : null}

      <Dialog open={Boolean(confirmMove)} onOpenChange={(open) => { if (!open) setConfirmMove(null) }}>
        <DialogContent>
          <DialogTitle>PO already sent — change the PO?</DialogTitle>
          <DialogDescription>
            {confirmMove ? `${confirmMove.arrival.po_no} was sent to ${confirmMove.arrival.supplier_name}. Moving this arrival to ${longDate(confirmMove.day)} makes a new PO revision with the new date (quantities and rates stay approved). Send the revision to the vendor again.` : ""}
          </DialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={() => setConfirmMove(null)}>Keep the date</button>
            <button type="button" className={primaryButton} disabled={update.isPending} onClick={() => confirmMove && moveArrival(confirmMove.arrival, confirmMove.day, true, confirmMove.qty)}>
              {update.isPending ? "Changing…" : "Change the PO"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </ProcurementShell>
  )
}

/** Per-unit totals one per line ("2,415 kg" / "130 pcs"), never one string that wraps mid-total. */
function PerUnitLines({ totals }: { totals: Record<string, number> }) {
  const parts = perUnitParts(totals)
  if (!parts.length) return <>0</>
  return <span className="flex flex-col">{parts.map((part) => <span key={part} className="whitespace-nowrap">{part}</span>)}</span>
}

function sentToVendor(arrival: Arrival): boolean {
  return Boolean(arrival.sent_at) && ["APPROVED", "PARTIALLY_RECEIVED"].includes(String(arrival.po_status))
}

function KpiAction({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  if (!onClick) return <div>{children}</div>
  return <button type="button" className="block rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick}>{children}</button>
}

function DemandNotes({ data }: { data: NonNullable<ReturnType<typeof useRmCalendar>["data"]> }) {
  const notCounted = data.warnings.filter((row) => row.not_counted)
  const other = data.warnings.filter((row) => !row.not_counted)
  return (
    <details className="rounded-xl border border-signal-amber-line bg-signal-amber-soft/60 px-4 py-3 text-signal-amber-ink">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Need is not fully known</span>
        <span className="font-normal">
          {[notCounted.length ? `${notCounted.length} order line${notCounted.length === 1 ? "" : "s"} not counted` : null,
            data.unmapped.length ? `${data.unmapped.length} material${data.unmapped.length === 1 ? "" : "s"} without a stock item` : null,
            other.length ? `${other.length} note${other.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
        </span>
        <span className="ml-auto text-[12px] font-normal underline underline-offset-2">Details</span>
      </summary>
      <div className="mt-3 grid gap-4 text-[12.5px] leading-5 lg:grid-cols-2">
        {data.unmapped.length ? (
          <div>
            <p className="flex items-center gap-1.5 font-semibold"><PackageX className="h-3.5 w-3.5" aria-hidden="true" />Needed, but no stock item to plan against</p>
            <ul className="mt-1.5 space-y-1">
              {data.unmapped.map((row) => <li key={row.key}><span className="font-semibold">{row.code}</span> · {qty(row.qty, row.uom)} · {row.order_nos.length} order{row.order_nos.length === 1 ? "" : "s"}</li>)}
            </ul>
            <Link href="/inventory/items" className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2 max-sm:min-h-11">Link them in Items</Link>
          </div>
        ) : null}
        {data.warnings.length ? (
          <div>
            <p className="flex items-center gap-1.5 font-semibold"><CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />Order and job card notes</p>
            <ul className="mt-1.5 space-y-1">
              {[...notCounted, ...other].slice(0, 12).map((row, index) => <li key={index}>{row.order_no ? <span className="font-semibold">{row.order_no}: </span> : null}{row.reason}</li>)}
              {data.warnings.length > 12 ? <li>…and {data.warnings.length - 12} more</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  )
}

