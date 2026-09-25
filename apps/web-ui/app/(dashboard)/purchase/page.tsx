"use client"

import Link from "next/link"
import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Pagination } from "@/components/ui/pagination"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Boxes, FileCheck2, PackageCheck, Plus, Scale } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useAuth } from "@/context/AuthContext"
import { purchaseApi } from "@/lib/api"
import type { PurchaseOrder } from "@/lib/procurement-types"

const rows = (data: any): PurchaseOrder[] => data?.data?.items || []

export default function PurchaseRegisterPage() {
  return <Suspense fallback={<LoadingState label="Loading purchase register…" />}><PurchaseRegister /></Suspense>
}

function PurchaseRegister() {
  const { activePlant } = useAuth()
  const params = useSearchParams(), router = useRouter(), pathname = usePathname()
  const search = params.get("q") || "", status = params.get("status") || "ALL"
  const requestedPage = Number(params.get("page"))
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const requestedSize = Number(params.get("size")) || 25
  const pageSize = [10,25,50,100].includes(requestedSize) ? requestedSize : 25
  const [draftSearch, setDraftSearch] = useState(search)
  const updateView = (values: Record<string,string>) => {
    const next = new URLSearchParams(params.toString())
    Object.entries(values).forEach(([key,value]) => value ? next.set(key,value) : next.delete(key))
    router.replace(`${pathname}?${next}`, { scroll: false })
  }
  useEffect(() => { setDraftSearch(search) }, [search])
  useEffect(() => {
    if (draftSearch === search) return
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());next.set("q",draftSearch);next.set("page","1")
      router.replace(`${pathname}?${next}`, { scroll: false })
    }, 250)
    return () => clearTimeout(timer)
  }, [draftSearch, search, params, pathname, router])
  const orders = useQuery({ queryKey: ["purchase-v2", "orders", activePlant, search, status, page, pageSize],
    queryFn: () => purchaseApi.getOrders({ q: search || undefined, status: status === "ALL" ? undefined : status, limit: pageSize, offset: (page-1)*pageSize }),
    enabled: Boolean(activePlant && activePlant !== "ALL") })
  const priorPlant = useRef(activePlant)
  useEffect(() => {
    if (priorPlant.current === activePlant) return
    priorPlant.current = activePlant
    const next = new URLSearchParams(params.toString()); next.set("page", "1")
    router.replace(`${pathname}?${next}`, { scroll: false })
  }, [activePlant, params, pathname, router])
  useEffect(() => {
    if (!orders.isSuccess || orders.isFetching) return
    const lastPage = Math.max(1, Math.ceil(Number(orders.data?.data?.total || 0) / pageSize))
    if (page <= lastPage) return
    const next = new URLSearchParams(params.toString()); next.set("page", String(lastPage))
    router.replace(`${pathname}?${next}`, { scroll: false })
  }, [orders.isSuccess, orders.isFetching, orders.data, page, pageSize, params, pathname, router])
  const items = rows(orders.data)
  const total = orders.data?.data?.total || 0
  const summary = orders.data?.data?.summary
  const awaiting = summary?.awaiting_approval
  const approved = summary?.receivable
  const openQuantity = summary ? Object.entries(summary.open_by_uom || {}).map(([uom,qty]) => `${Number(qty).toLocaleString("en-IN")} ${uom}`).join(" + ") || "0" : "—"

  return (
    <ProcurementShell eyebrow="Procurement control book" title="Purchase orders"
      description="Review commitments, approve revisions and receive against the correct order. Search and totals include every matching order in this plant."
      actions={<><Link href="/purchase/new" className={primaryButton}><Plus className="h-4 w-4" /> New purchase order</Link><a href={purchaseApi.registerExportUrl("po-lines")} className={secondaryButton}>Export full register</a></>}>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Purchase orders" value={orders.isSuccess ? total : "—"} detail="Matching orders across every page" icon={FileCheck2} tone="slate" />
        <SummaryCard label="Awaiting approval" value={awaiting ?? "—"} detail="Maker-checker decisions pending" icon={AlertTriangle} tone="amber" />
        <SummaryCard label="Receivable" value={approved ?? "—"} detail="Approved POs with stock handoff" icon={PackageCheck} tone="emerald" />
        <SummaryCard label="Open requirement" value={openQuantity} detail="Open by unit; excludes cancelled and rejected orders" icon={Scale} tone="cyan" />
      </section>
      <div className="tube-filter"><input aria-label="Search purchase orders" className={`${fieldClass} max-w-md`} placeholder="Search PO, vendor or material" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} /><select aria-label="PO status" className={`${fieldClass} max-w-xs`} value={status} onChange={(event) => updateView({ status: event.target.value, page: "1" })}><option value="ALL">All statuses</option>{["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "SHORT_CLOSED", "CANCELLED", "REJECTED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
      <WorkPanel title="PO line register" description="One row per line in this page of orders. Each material retains its own unit; physical lot counts are shown separately."
        action={<Link href="/purchase/registers" className={secondaryButton}>Print and exports</Link>}>
        {orders.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : orders.isError ? <ErrorState message="Purchase orders could not be loaded. Totals are unavailable until this request succeeds." onRetry={() => orders.refetch()} /> : items.length ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="sticky top-0 bg-muted text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><tr>
                {['PO / revision','Vendor','Material','Ordered','Received','Open','Expected units','Rate / unit','Amount','Approval','Next'].map((head) => <th key={head} className="border-b border-border px-3 py-3">{head}</th>)}
              </tr></thead>
              <tbody>{items.flatMap((order) => order.lines.map((line) => ({ order, line }))).map(({ order, line }) => {
                const open = Math.max(0, line.qty_ordered - line.qty_received - line.qty_short_closed)
                return <tr key={`${order.id}-${line.id}`} className="border-b border-border last:border-0 hover:bg-signal-cyan-soft/35">
                  <td className="px-3 py-3"><Link href={`/purchase/${order.id}`} className="font-semibold text-signal-cyan-ink hover:underline">{order.po_no}</Link><div className="mt-1 text-xs text-muted-foreground">Revision {order.current_revision_no} · {order.category === "RM_PM" ? "RM / PM" : "Other"}</div></td>
                  <td className="max-w-[180px] px-3 py-3 font-medium text-foreground">{order.supplier_name}</td>
                  <td className="px-3 py-3"><span className="font-semibold text-foreground">{line.item_code}</span><div className="text-xs text-muted-foreground">{line.item_name}</div></td>
                  <td className="px-3 py-3 tabular-nums">{line.qty_ordered.toLocaleString("en-IN")} {line.uom.toLowerCase()}</td>
                  <td className="px-3 py-3 tabular-nums">{line.qty_received.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3 font-semibold tabular-nums text-signal-cyan-ink">{open.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3 tabular-nums">{line.expected_unit_count ? `${line.expected_unit_count} ${line.count_basis?.toLowerCase()}` : "Not planned"}</td>
                  <td className="px-3 py-3 tabular-nums">₹{line.unit_cost.toLocaleString("en-IN", { maximumFractionDigits: 4 })}</td>
                  <td className="px-3 py-3 font-semibold tabular-nums">₹{(line.qty_ordered * line.unit_cost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-3"><StateBadge value={order.status} /></td>
                  <td className="px-3 py-3"><Link href={['APPROVED','PARTIALLY_RECEIVED'].includes(order.status) ? `/purchase/inward?po=${order.id}&line=${line.id}` : `/purchase/${order.id}`} className="text-xs font-semibold text-signal-cyan-ink hover:underline">{['APPROVED','PARTIALLY_RECEIVED'].includes(order.status) ? "Receive" : "Open"}</Link></td>
                </tr>
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState label="No orders match this view. Clear the filters or create a purchase order." />}
        {orders.isSuccess ? <Pagination page={page} pageSize={pageSize} total={total} noun="orders" busy={orders.isFetching} onPageChange={value => updateView({page:String(value)})} onPageSizeChange={value => updateView({size:String(value),page:"1"})} /> : null}
      </WorkPanel>
      <section className="grid gap-3 md:grid-cols-3">
        {[
          { href: "/purchase/inward", icon: Boxes, title: "Paper inward", copy: "Record invoice facts and one unique AT label for every received reel or coil." },
          { href: "/purchase/discrepancies", icon: AlertTriangle, title: "Rate review", copy: "Keep invoice rates separate from approved PO rates and resolve every difference." },
          { href: "/purchase/supplier-deliveries", icon: Scale, title: "Supplier deliveries", copy: "Confirm arrivals, revise dates and track partial GRNs." },
          { href: "/purchase/scheduler", icon: Scale, title: "Schedule by kg", copy: "Plan the month from demand, stock and approved open supply without double counting." },
        ].map((card) => <Link href={card.href} key={card.href} className="rounded-xl border border-border bg-card p-5 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-signal-cyan-line"><card.icon className="h-5 w-5 text-signal-cyan-ink" /><h2 className="mt-4 font-semibold text-foreground">{card.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{card.copy}</p></Link>)}
      </section>
    </ProcurementShell>
  )
}
