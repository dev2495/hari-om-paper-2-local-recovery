"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
} from "lucide-react"

import { EmptyState, Panel, StatusBadge } from "@/components/erp/shell"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { api, purchaseApi } from "@/lib/api"

type EndpointState = {
  available: boolean
  status?: number
  message?: string
  rows: any[]
  raw?: any
}

const today = () => new Date().toISOString().slice(0, 10)
const formatNumber = (value: unknown, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const formatCurrency = (value: unknown) => `Rs ${formatNumber(value, 0)}`

function normalizeRows(raw: any) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.rows) ? raw.rows : []
}

function errorMessage(error: any) {
  if (error?.response?.status === 404) return "Purchase endpoint pending in backend."
  const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message
  if (typeof detail === "string") return detail
  return detail ? JSON.stringify(detail) : "Purchase endpoint is not available yet."
}

async function safePurchaseGet(path: string): Promise<EndpointState> {
  try {
    const { data } = await api.get(path)
    return { available: true, rows: normalizeRows(data), raw: data }
  } catch (error: any) {
    return {
      available: false,
      status: error?.response?.status,
      message: errorMessage(error),
      rows: [],
    }
  }
}

function EndpointChip({ label, state }: { label: string; state?: EndpointState }) {
  const available = Boolean(state?.available)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
      available
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-amber-200 bg-amber-50 text-amber-800"
    }`}>
      {available ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {label}: {available ? "connected" : state?.status ? `pending (${state.status})` : "pending"}
    </span>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{children}</span>
}

export default function PurchaseFlowPage() {
  const queryClient = useQueryClient()
  const vendorsQuery = useVendors()
  const itemsQuery = useInventoryItems()
  const vendors = useMemo(() => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []), [vendorsQuery.data])
  const items = useMemo(
    () => (Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((item: any) => String(item.type || "").toUpperCase() !== "FINISHED_GOOD") : []),
    [itemsQuery.data],
  )

  const ordersQuery = useQuery({
    queryKey: ["purchase", "orders"],
    queryFn: () => safePurchaseGet("/api/purchase/orders"),
  })
  const receiptsQuery = useQuery({
    queryKey: ["purchase", "receipts"],
    queryFn: () => safePurchaseGet("/api/purchase/receipts"),
  })

  const [poForm, setPoForm] = useState({
    vendor_id: "",
    item_id: "",
    qty: "",
    unit_cost: "",
    needed_date: today(),
    notes: "",
  })
  const [grnForm, setGrnForm] = useState({
    purchase_order_id: "",
    po_line_id: "",
    qty: "",
    grn_date: today(),
    batch_no: "",
  })
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null)

  const selectedRequestVendor = vendors.find((row: any) => String(row.id) === poForm.vendor_id)
  const selectedRequestItem = items.find((row: any) => String(row.id) === poForm.item_id)

  const createOrder = useMutation({
    mutationFn: async (payload: any) => purchaseApi.createOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase", "orders"] })
    },
  })
  const approveOrder = useMutation({
    mutationFn: async (id: string) => purchaseApi.approveOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase", "orders"] })
    },
  })
  const createGrn = useMutation({
    mutationFn: async (payload: any) => purchaseApi.postGrn(payload.purchase_order_id, payload.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase", "orders"] })
      queryClient.invalidateQueries({ queryKey: ["purchase", "receipts"] })
    },
  })
  const updateReceiptQc = useMutation({
    mutationFn: async ({ lineId, status }: { lineId: string; status: "PASS" | "HOLD" }) =>
      purchaseApi.updateReceiptQc(lineId, {
        status,
        notes: status === "PASS" ? "Incoming QC cleared from purchase desk." : "Incoming QC hold from purchase desk.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase", "receipts"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-balances"] })
      queryClient.invalidateQueries({ queryKey: ["inventory-stock-statement"] })
    },
  })

  const orders = ordersQuery.data?.rows || []
  const receipts = receiptsQuery.data?.rows || []
  const endpointPending = [ordersQuery.data, receiptsQuery.data].some((state) => state && !state.available)
  const selectedOrder = orders.find((row: any) => String(row.id) === grnForm.purchase_order_id) || null
  const selectedOrderLines = Array.isArray(selectedOrder?.lines)
    ? selectedOrder.lines.filter((line: any) => String(line.line_status || "").toUpperCase() !== "CLOSED")
    : []

  async function submitPurchaseOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    if (!selectedRequestVendor || !selectedRequestItem) {
      setMessage({ tone: "error", text: "Select vendor and material before creating a purchase order." })
      return
    }
    try {
      await createOrder.mutateAsync({
        supplier_id: poForm.vendor_id,
        supplier_name: selectedRequestVendor.name,
        expected_date: poForm.needed_date,
        notes: poForm.notes || undefined,
        lines: [
          {
            item_id: poForm.item_id,
            qty_ordered: Number(poForm.qty),
            unit_cost: Number(poForm.unit_cost),
            incoming_qc_required: true,
          },
        ],
      })
      setPoForm((current) => ({ ...current, qty: "", unit_cost: "", notes: "" }))
      setMessage({ tone: "success", text: "Purchase order created. Approve it before posting GRN." })
    } catch (error: any) {
      setMessage({ tone: "error", text: errorMessage(error) })
    }
  }

  async function submitGrn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    if (!selectedOrder || !grnForm.po_line_id) {
      setMessage({ tone: "error", text: "Select an approved PO and an open line before posting GRN." })
      return
    }
    try {
      await createGrn.mutateAsync({
        purchase_order_id: grnForm.purchase_order_id || undefined,
        body: {
          received_date: grnForm.grn_date,
          lines: [
            {
              po_line_id: grnForm.po_line_id,
              qty_received: Number(grnForm.qty),
              batch_no: grnForm.batch_no || undefined,
            },
          ],
        },
      })
      setGrnForm((current) => ({ ...current, qty: "", batch_no: "" }))
      setMessage({ tone: "success", text: "GRN posted into stock with vendor, batch cost, and incoming QC status." })
    } catch (error: any) {
      setMessage({ tone: "error", text: errorMessage(error) })
    }
  }

  return (
    <div className="space-y-5" data-testid="purchase-flow-page">
      <section className="rounded-[1.6rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-xl shadow-slate-900/10">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/80">Purchase to GRN control</p>
            <h1 className="mt-2 text-2xl font-semibold">Purchase orders, GRN stock posting, and incoming QC.</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-200">
              Create vendor-linked purchase orders, approve buying, then post GRN into priced inventory batches that stay on QC hold until cleared.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/inventory/raw-material-inward" className="rounded-xl bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-950">
              Direct bulk GRN
            </Link>
            <Link href="/inventory/reels/inward" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-white/10">
              Reel GRN
            </Link>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        <EndpointChip label="Purchase orders" state={ordersQuery.data} />
        <EndpointChip label="GRNs" state={receiptsQuery.data} />
      </section>

      {endpointPending ? (
        <section className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Purchase-service routes are not fully connected in this checkout. Use direct bulk/reel GRN for live stock posting until `/api/purchase/*` is available.
        </section>
      ) : null}

      {message ? (
        <section className={`rounded-[1.2rem] border px-4 py-3 text-sm ${
          message.tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-rose-200 bg-rose-50 text-rose-800"
        }`}>
          {message.text}
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <Panel
          title="Create Purchase Order"
          subtitle="Vendor, material, quantity, rate, expected date, and incoming QC requirement are captured before GRN."
          actions={<StatusBadge value={ordersQuery.data?.available ? "CONNECTED" : "PENDING"} />}
        >
          <form onSubmit={submitPurchaseOrder} className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <FieldLabel>Vendor</FieldLabel>
              <select required value={poForm.vendor_id} onChange={(event) => setPoForm((current) => ({ ...current, vendor_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select vendor</option>
                {vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.supplier_code} · {vendor.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Needed date</FieldLabel>
              <input required type="date" value={poForm.needed_date} onChange={(event) => setPoForm((current) => ({ ...current, needed_date: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>Material</FieldLabel>
              <select required value={poForm.item_id} onChange={(event) => setPoForm((current) => ({ ...current, item_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select material</option>
                {items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Qty</FieldLabel>
              <input required type="number" min="0.001" step="0.001" value={poForm.qty} onChange={(event) => setPoForm((current) => ({ ...current, qty: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1 md:col-span-2">
              <FieldLabel>Unit cost</FieldLabel>
              <input required type="number" min="0.01" step="0.01" value={poForm.unit_cost} onChange={(event) => setPoForm((current) => ({ ...current, unit_cost: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1 md:col-span-2">
              <FieldLabel>Notes</FieldLabel>
              <textarea value={poForm.notes} onChange={(event) => setPoForm((current) => ({ ...current, notes: event.target.value }))} rows={3} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <button disabled={createOrder.isPending} className="md:col-span-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {createOrder.isPending ? "Creating PO..." : "Create purchase order"}
            </button>
          </form>
        </Panel>

        <Panel
          title="Post GRN Against PO"
          subtitle="Approved PO lines receive into inventory batches. Incoming QC lines remain QC_HOLD until released."
          actions={<StatusBadge value={receiptsQuery.data?.available ? "CONNECTED" : "PENDING"} />}
        >
          <form onSubmit={submitGrn} className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <FieldLabel>Approved PO</FieldLabel>
              <select required value={grnForm.purchase_order_id} onChange={(event) => setGrnForm((current) => ({ ...current, purchase_order_id: event.target.value, po_line_id: "" }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select PO</option>
                {orders.filter((order: any) => ["APPROVED", "PARTIALLY_RECEIVED"].includes(String(order.status || "").toUpperCase())).map((order: any) => (
                  <option key={order.id} value={order.id}>{order.po_no} · {order.supplier_name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>GRN date</FieldLabel>
              <input required type="date" value={grnForm.grn_date} onChange={(event) => setGrnForm((current) => ({ ...current, grn_date: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>PO line</FieldLabel>
              <select required value={grnForm.po_line_id} onChange={(event) => setGrnForm((current) => ({ ...current, po_line_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select line</option>
                {selectedOrderLines.map((line: any) => (
                  <option key={line.id} value={line.id}>{line.item_code} · balance {formatNumber(Number(line.qty_ordered || 0) - Number(line.qty_received || 0), 2)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Qty received</FieldLabel>
              <input required type="number" min="0.001" step="0.001" value={grnForm.qty} onChange={(event) => setGrnForm((current) => ({ ...current, qty: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>Batch no optional</FieldLabel>
              <input value={grnForm.batch_no} onChange={(event) => setGrnForm((current) => ({ ...current, batch_no: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <button disabled={createGrn.isPending} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {createGrn.isPending ? "Posting GRN..." : "Post purchase GRN"}
            </button>
            <Link href="/inventory/raw-material-inward" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Live stock inward <ArrowRight className="h-4 w-4" />
            </Link>
          </form>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {[
          { title: "Purchase orders", icon: FileText, rows: orders, state: ordersQuery.data },
          { title: "GRN documents", icon: ReceiptText, rows: receipts, state: receiptsQuery.data },
          { title: "Incoming QC", icon: ShieldCheck, rows: receipts.flatMap((receipt: any) => (receipt.lines || []).map((line: any) => ({ ...line, grn_no: receipt.grn_no, po_no: receipt.po_no }))).filter((line: any) => line.qc_status === "PENDING"), state: receiptsQuery.data },
        ].map((section) => (
          <div key={section.title} className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{section.state?.available ? "Live queue" : "Expected endpoint"}</p>
                <h2 className="mt-1 text-base font-semibold text-slate-950">{section.title}</h2>
              </div>
              <section.icon className="h-5 w-5 text-cyan-800" />
            </div>
            <div className="mt-3 space-y-2">
              {section.rows.slice(0, 4).map((row: any, index: number) => (
                <div key={row.id || row.document_no || index} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-950">{row.grn_no || row.po_no || row.batch_no || row.id || "Draft"}</span>
                    <StatusBadge value={row.qc_status || row.status || "OPEN"} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{row.supplier_name || row.vendor_name || "-"} · {row.total_value ? formatCurrency(row.total_value) : `${row.line_count || row.lines?.length || 0} line(s)`}</p>
                  {section.title === "Purchase orders" && String(row.status || "").toUpperCase() === "DRAFT" ? (
                    <button
                      type="button"
                      disabled={approveOrder.isPending}
                      onClick={() => approveOrder.mutate(String(row.id))}
                      className="mt-2 inline-flex h-8 items-center rounded-lg bg-cyan-900 px-3 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Approve PO
                    </button>
                  ) : null}
                  {section.title === "Incoming QC" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={updateReceiptQc.isPending}
                        onClick={() => updateReceiptQc.mutate({ lineId: String(row.id), status: "PASS" })}
                        className="inline-flex h-8 items-center rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Pass QC
                      </button>
                      <button
                        type="button"
                        disabled={updateReceiptQc.isPending}
                        onClick={() => updateReceiptQc.mutate({ lineId: String(row.id), status: "HOLD" })}
                        className="inline-flex h-8 items-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-900 disabled:opacity-60"
                      >
                        Hold
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {!section.rows.length ? (
                <EmptyState label={section.state?.available ? "No rows returned yet." : section.state?.message || "Endpoint pending."} />
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {[
          { icon: ClipboardList, title: "Request", detail: "Shortage or manual demand becomes a purchase request." },
          { icon: FileText, title: "PO", detail: "Approved supplier price and expected delivery." },
          { icon: PackageCheck, title: "GRN", detail: "Receipt posts priced batch or reel through inventory inward." },
          { icon: ShieldCheck, title: "Incoming QC", detail: "QC-hold receipts stay blocked until cleared for production issue." },
        ].map((step) => (
          <div key={step.title} className="rounded-[1.1rem] border border-slate-200 bg-slate-50 p-4">
            <step.icon className="h-5 w-5 text-cyan-800" />
            <p className="mt-3 text-sm font-semibold text-slate-950">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{step.detail}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
