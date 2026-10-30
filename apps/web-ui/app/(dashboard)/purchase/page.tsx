"use client"

import Link from "next/link"
import { Suspense, useEffect, useRef, useState, type MouseEvent } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Boxes, CalendarRange, ClipboardList, FileClock, PackageCheck, Plus, Scale, Search, Send, Truck } from "lucide-react"

import { Pagination } from "@/components/ui/pagination"
import { EmptyQueryState, ErrorState, LoadingState } from "@/components/workspace/query-state"
import { ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { OrderFacts, SendStateWords, SentChip, SourceBadge, deliveryRows } from "@/components/procurement/rm-calendar/desk"
import { istDay, longDate, perUnitParts, qty as qtyText, shortDate } from "@/components/procurement/rm-calendar/format"
import { Segmented } from "@/components/procurement/rm-calendar/atoms"
import { useAuth } from "@/context/AuthContext"
import { usePurchaseQueue, useQueueCounts } from "@/hooks/use-rm-calendar"
import { api, purchaseApi } from "@/lib/api"
import type { DeskOrder, QueueKey } from "@/lib/api-rm-calendar"
import { cn } from "@/lib/utils"

const TABS: Array<{ id: QueueKey; label: string; empty: string }> = [
  { id: "scheduled", label: "Scheduled drafts to send", empty: "No scheduled draft is waiting. When the Owner approves arrivals on the RM inward calendar, their draft POs land here." },
  { id: "waiting", label: "Waiting approval", empty: "No PO waits for the Owner's approval." },
  { id: "returned", label: "Sent back by Owner", empty: "No PO was sent back. When the Owner rejects one, revise it here or cancel it." },
  { id: "unsent", label: "Approved – not sent", empty: "Every approved PO has gone to its vendor." },
  { id: "sent", label: "Sent – waiting delivery", empty: "No sent PO is waiting for delivery." },
  { id: "all", label: "All", empty: "No orders match this view. Clear the search or create a purchase order." },
]

export default function PurchaseQueuePage() {
  return <Suspense fallback={<LoadingState label="Loading purchase orders…" />}><PurchaseQueue /></Suspense>
}

// The server creates POs for these roles only (Owner and Admin included); others never see the button.
const CREATE_ROLES = ["Store", "PlantManager", "Owner", "Admin"]

function PurchaseQueue() {
  const { activePlant, user, activeRole } = useAuth()
  const roles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  const canCreate = CREATE_ROLES.some((role) => roles.has(role))
  const params = useSearchParams(), router = useRouter(), pathname = usePathname()
  const search = params.get("q") || ""
  const requestedPage = Number(params.get("page"))
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const requestedSize = Number(params.get("size")) || 25
  const pageSize = [10, 25, 50, 100].includes(requestedSize) ? requestedSize : 25
  const counts = useQueueCounts()
  const queues = counts.data?.queues || {}
  const requestedTab = params.get("tab") as QueueKey | null
  // The desk lands on what needs sending; with nothing scheduled, on everything.
  const tab: QueueKey = requestedTab && TABS.some((row) => row.id === requestedTab) ? requestedTab : (queues.scheduled ? "scheduled" : "all")
  const [draftSearch, setDraftSearch] = useState(search)
  const updateView = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    Object.entries(values).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
    router.replace(`${pathname}?${next}`, { scroll: false })
  }
  useEffect(() => { setDraftSearch(search) }, [search])
  useEffect(() => {
    if (draftSearch === search) return
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString()); next.set("q", draftSearch); next.set("page", "1")
      router.replace(`${pathname}?${next}`, { scroll: false })
    }, 250)
    return () => clearTimeout(timer)
  }, [draftSearch, search, params, pathname, router])
  const orders = usePurchaseQueue(tab, search, page, pageSize)
  const priorPlant = useRef(activePlant)
  useEffect(() => {
    if (priorPlant.current === activePlant) return
    priorPlant.current = activePlant
    updateView({ page: "1" })
  }, [activePlant]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!orders.isSuccess || orders.isFetching) return
    const lastPage = Math.max(1, Math.ceil(Number(orders.data?.total || 0) / pageSize))
    if (page > lastPage) updateView({ page: String(lastPage) })
  }, [orders.isSuccess, orders.isFetching, orders.data, page, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps
  const items: DeskOrder[] = orders.data?.items || []
  const total = orders.data?.total || 0
  const summary = counts.data
  const requisitions = useQuery({ queryKey: ["purchase-requisitions", activePlant, "SUBMITTED"], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => api.get("/api/purchase/requisitions", { params: { status: "SUBMITTED" } }) })
  const pendingRequisitions = (requisitions.data?.data?.items || []).length
  const current = TABS.find((row) => row.id === tab)!
  const queueOptions = TABS.filter((row) => row.id !== "returned" || Number(queues.returned || 0) > 0 || tab === "returned")
    .map((row) => ({ id: row.id, label: row.label, count: row.id === "all" ? undefined : counts.isSuccess ? Number(queues[row.id] || 0) : undefined, flag: queueFlag(row.id, Number(queues[row.id] || 0)) }))
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    const strip = stripRef.current
    if (!active || !strip || strip.scrollWidth <= strip.clientWidth) return
    // Scroll the strip only (never the page), so the chosen tab sits in view.
    strip.scrollTo({ left: Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2), behavior: "smooth" })
  }, [tab, counts.isSuccess])

  return (
    <ProcurementShell eyebrow="Purchasing" title="Purchase orders"
      description="Send the Owner's scheduled drafts, follow approvals and deliveries, and receive against the right order. Totals include every matching order in this plant."
      actions={<>{canCreate ? <Link href="/purchase/new" className={primaryButton}><Plus className="h-4 w-4" aria-hidden="true" /> New purchase order</Link> : null}<a href={purchaseApi.registerExportUrl("po-lines")} className={secondaryButton}>Export full register</a></>}>
      {/* Five tiles: two per row on phones and tablets, the last one full width so no cell is left empty. */}
      <section className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5 [&>*]:h-full [&_article]:h-full [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1" aria-label="Summary">
        <Link href="/purchase?tab=scheduled" className="block rounded-xl"><SummaryCard label="Drafts to send" value={counts.isSuccess ? queues.scheduled ?? 0 : "—"} detail="Scheduled by the Owner" icon={FileClock} tone={queues.scheduled ? "cyan" : "slate"} /></Link>
        {/* PO approvals is the Owner's page; everyone else follows the same orders on the "Waiting approval" tab. */}
        <Link href={roles.has("Owner") ? "/purchase/approvals" : "/purchase?tab=waiting"} className="block rounded-xl"><SummaryCard label="Waiting approval" value={counts.isSuccess ? queues.waiting ?? 0 : "—"} detail="Owner decides" icon={AlertTriangle} tone={queues.waiting ? "amber" : "slate"} /></Link>
        <Link href="/purchase?tab=sent" className="block rounded-xl"><SummaryCard label="Sent, waiting delivery" value={counts.isSuccess ? queues.sent ?? 0 : "—"} detail="With the vendor" icon={Truck} tone="emerald" /></Link>
        <Link href="/purchase/requisitions" className="block rounded-xl"><SummaryCard label="Requisitions to approve" value={requisitions.isSuccess ? pendingRequisitions : "—"} detail="Tools, spares, other" icon={ClipboardList} tone={pendingRequisitions ? "amber" : "slate"} /></Link>
        <SummaryCard label="Open to receive" value={summary ? <PerUnitLines totals={summary.open_by_uom || {}} /> : "—"} detail={counts.isError ? "Not known: orders did not load" : "Per unit, live orders"} icon={Scale} tone="slate" />
      </section>

      <section className="space-y-3" aria-label="Purchase queue">
        {/* Phone: one full-width "Show" picker, so the chosen queue is always in sight (checker 2026-10-29:
            the strip hid "All" off-screen). From the small breakpoint up: the strip, the chosen tab kept in view. */}
        <label className="block sm:hidden">
          <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Show</span>
          <select className={cn(fieldClass, "max-sm:h-11 font-semibold")} value={tab} onChange={(event) => updateView({ tab: event.target.value, page: "1" })}>
            {queueOptions.map((row) => <option key={row.id} value={row.id}>{row.label}{row.count !== undefined ? ` (${row.count})` : ""}</option>)}
          </select>
        </label>
        <div ref={stripRef} className="relative -mx-1 hidden overflow-x-auto px-1 pb-0.5 sm:block">
          <Segmented label="Queue" value={tab} onChange={(value) => updateView({ tab: value, page: "1" })} options={queueOptions} />
        </div>
        <label className="relative block w-full sm:max-w-md">
          <span className="sr-only">Search purchase orders</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input className={cn(fieldClass, "pl-9 max-sm:h-11")} type="search" placeholder="Search PO, vendor or material" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} />
        </label>
      </section>

      <WorkPanel title={current.label} description={tab === "scheduled" ? "Drafts made from arrivals the Owner approved on the RM inward calendar, one per vendor per week. Check the rate, then send." : tab === "returned" ? "The Owner rejected these. Their arrivals no longer count as cover on the RM inward calendar until a revision is approved." : tab === "unsent" ? "Approved and not with the vendor yet, or revised since it was sent. Older POs whose goods already came count as sent." : "One row per purchase order. Every material keeps its own unit."}
        action={<Link href="/purchase/registers" className={secondaryButton}>Print and exports</Link>}>
        {orders.isLoading || counts.isLoading ? <LoadingState label="Loading orders…" /> : orders.isError ? <ErrorState message="Purchase orders could not be loaded. Totals are unavailable until this request succeeds." onRetry={() => orders.refetch()} />
          : items.length ? (tab === "scheduled" ? <ScheduledCards items={items} isOwner={roles.has("Owner")} /> : <OrderTable items={items} />)
          : <EmptyQueryState title="Nothing here" message={search ? `Nothing matches “${search}”.` : current.empty}
              action={tab === "scheduled" ? <Link href="/purchase/scheduler" className={secondaryButton}><CalendarRange className="h-4 w-4" aria-hidden="true" />Open the RM inward calendar</Link> : null} />}
        {/* The shared pager is 36 px; on a phone its buttons and rows picker get 44 px tap targets here. */}
        {orders.isSuccess && total > pageSize ? <div className="max-sm:[&_button]:h-11 max-sm:[&_button]:w-11 max-sm:[&_select]:h-11"><Pagination page={page} pageSize={pageSize} total={total} noun="orders" busy={orders.isFetching} onPageChange={(value) => updateView({ page: String(value) })} onPageSizeChange={(value) => updateView({ size: String(value), page: "1" })} /></div> : null}
      </WorkPanel>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { href: "/purchase/scheduler", icon: CalendarRange, title: "RM inward calendar", copy: "Need, stock and arrivals day by day. The Owner approves arrivals into draft POs." },
          { href: "/purchase/supplier-deliveries", icon: Truck, title: "Expected arrivals", copy: "Overdue, today and this week: confirm dates and make the GRN." },
          { href: "/purchase/inward", icon: Boxes, title: "Goods inward (GRN)", copy: "Receive against the PO line into the RM store; incoming QC follows." },
          { href: "/purchase/discrepancies", icon: AlertTriangle, title: "Rate review", copy: "Keep invoice rates apart from approved PO rates and settle every difference." },
        ].map((card) => <Link href={card.href} key={card.href} className="rounded-xl border border-border bg-card p-5 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-signal-cyan-line"><card.icon className="h-5 w-5 text-signal-cyan-ink" aria-hidden="true" /><h2 className="mt-4 font-semibold text-foreground">{card.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{card.copy}</p></Link>)}
      </section>
    </ProcurementShell>
  )
}

/** The count stays neutral; a queue that needs action adds an amber icon with its words (never colour alone). */
function queueFlag(id: QueueKey, count: number): string | undefined {
  if (!count) return undefined
  if (id === "scheduled") return `${count} ${count === 1 ? "draft" : "drafts"} to send`
  if (id === "returned") return `${count} sent back by the Owner`
  return undefined
}

/** Per-unit totals one per line ("2,415 kg" / "130 pcs"): never a total that wraps on its separator. */
function PerUnitLines({ totals }: { totals: Record<string, number> }) {
  const parts = perUnitParts(totals)
  if (!parts.length) return <>0</>
  return <span className="flex flex-col">{parts.map((part) => <span key={part} className="whitespace-nowrap">{part}</span>)}</span>
}

function ScheduledCards({ items, isOwner }: { items: DeskOrder[]; isOwner: boolean }) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2" data-testid="scheduled-drafts">
      {items.map((order) => {
        const ready = order.send_check?.mode === "SEND_ON_SCHEDULE"
        const rateNeeded = Boolean(order.send_check?.rate_needed?.length)
        const value = order.lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0)
        return (
          <li key={order.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/purchase/${order.id}`} className="inline-flex min-h-8 items-center text-[15px] font-semibold text-signal-cyan-ink hover:underline max-sm:min-h-11">{order.po_no}</Link>
                <p className="truncate text-[13.5px] font-semibold text-foreground">{order.supplier_name}</p>
              </div>
              <SourceBadge order={order} />
            </div>
            <OrderFacts order={order} />
            <ul className="flex flex-wrap gap-1.5" aria-label="Delivery dates">
              {deliveryRows(order).slice(0, 6).map((row) => (
                <li key={row.id} className="max-w-full truncate rounded-md border border-signal-teal-line bg-signal-teal-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-signal-teal-ink" title={`${row.item_name} · ${row.item_code}`}>{shortDate(row.date)} · {row.item_name || row.item_code} · {qtyText(row.qty, row.uom)}</li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <div className="min-w-0">
                <SendStateWords order={order} />
                <p className="text-[12px] text-muted-foreground">{value ? `${rateNeeded ? "Value so far" : "Value"} ₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "Value known once every rate is in"}{order.schedule_week ? ` · week of ${shortDate(order.schedule_week)}` : ""}</p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Link href={`/purchase/${order.id}`} className={cn(ready ? primaryButton : secondaryButton, "flex-1 sm:flex-none")}><Send className="h-4 w-4" aria-hidden="true" />{ready ? "Check & send" : rateNeeded ? "Fill the rate" : isOwner ? "Open & approve" : "Open & submit"}</Link>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function OrderTable({ items }: { items: DeskOrder[] }) {
  const router = useRouter()
  // The whole row opens the PO; its own links and buttons keep their job.
  const openRow = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if ((event.target as HTMLElement).closest("a,button,input,select,label")) return
    router.push(`/purchase/${id}`)
  }
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {items.map((order) => (
          <li key={order.id}>
            <Link href={`/purchase/${order.id}`} className="block rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-signal-cyan-line">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-semibold text-signal-cyan-ink">{order.po_no}</p><p className="truncate text-[13px] font-medium text-foreground">{order.supplier_name}</p></div>
                <StateBadge value={order.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5"><SourceBadge order={order} /><SentChip order={order} /></div>
              <div className="mt-2"><OrderFacts order={order} /></div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-muted text-[11.5px] font-semibold text-muted-foreground"><tr>
            {["PO", "Vendor", "Materials", "Next delivery", "Status", "Sent", "Amount", ""].map((head) => <th key={head} className="border-b border-border px-3 py-3">{head}</th>)}
          </tr></thead>
          <tbody>{items.map((order) => {
            const next = deliveryRows(order).find((row) => row.open > 0)
            const amount = order.lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0)
            const receivable = ["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status)
            return (
              <tr key={order.id} onClick={(event) => openRow(event, order.id)} className="cursor-pointer border-b border-border align-top last:border-0 hover:bg-signal-cyan-soft/35">
                <td className="px-3 py-2"><Link href={`/purchase/${order.id}`} className="inline-flex min-h-8 items-center font-semibold text-signal-cyan-ink hover:underline">{order.po_no}</Link><div className="mt-0.5"><SourceBadge order={order} /></div></td>
                <td className="max-w-[200px] px-3 py-3 font-medium text-foreground">{order.supplier_name}<div className="mt-1 text-xs font-normal text-muted-foreground">PO date {longDate(order.po_date || null)}</div></td>
                <td className="max-w-[260px] px-3 py-3"><OrderFacts order={order} /></td>
                <td className="px-3 py-3 text-[12.5px]">{next ? <><span className="font-semibold text-foreground">{longDate(next.date)}</span><div className="text-xs text-muted-foreground">{next.confirmation === "CONFIRMED" ? "Confirmed" : "To confirm"}</div></>
                  : receivable && order.expected_date ? <><span className="font-semibold text-foreground">{longDate(order.expected_date)}</span><div className="text-xs text-muted-foreground">PO date, no dated row</div></>
                  : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-3"><StateBadge value={order.status} /></td>
                <td className="px-3 py-3"><SentChip order={order} />{!order.sent_at ? <span className="text-xs text-muted-foreground">{!receivable ? "—" : order.metadata_json?.resend_reason ? "Send again" : order.lines.some((line) => line.qty_received > 0) ? "With the vendor (goods came)" : "Not sent"}</span> : <div className="mt-1 text-xs text-muted-foreground">{shortDate(istDay(order.sent_at))}</div>}</td>
                <td className="px-3 py-3 font-semibold tabular-nums">₹{amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                <td className="px-3 py-2">{receivable
                  ? <Link href={`/purchase/inward?po=${order.id}`} className="erp-btn-secondary" aria-label={`Receive goods against ${order.po_no}`}><PackageCheck className="h-4 w-4" aria-hidden="true" />Receive</Link>
                  : <Link href={`/purchase/${order.id}`} className="erp-btn-secondary" aria-label={`Open ${order.po_no}`}>Open</Link>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </>
  )
}
