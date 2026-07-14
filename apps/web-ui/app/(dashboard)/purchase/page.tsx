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
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { usePlants } from "@/hooks/use-system"
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
  const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message
  if (typeof detail === "string") return detail
  return detail ? JSON.stringify(detail) : "The purchase request failed."
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
      {label}: {available ? "connected" : state?.status ? `error (${state.status})` : "unavailable"}
    </span>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{children}</span>
}

export default function PurchaseFlowPage() {
  const queryClient = useQueryClient()
  const { activePlant, setActivePlant } = useAuth()
  const { data: plants = [] } = usePlants()
  const concretePlant = Boolean(activePlant && activePlant.toUpperCase() !== "ALL")
  const vendorsQuery = useVendors()
  const itemsQuery = useInventoryItems()
  const vendors = useMemo(() => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []), [vendorsQuery.data])
  const items = useMemo(
    () => (Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((item: any) => String(item.type || "").toUpperCase() !== "FINISHED_GOOD") : []),
    [itemsQuery.data],
  )

  const ordersQuery = useQuery({
    queryKey: ["purchase", "orders", activePlant],
    queryFn: () => safePurchaseGet("/api/purchase/orders"),
    enabled: concretePlant,
  })
  const receiptsQuery = useQuery({
    queryKey: ["purchase", "receipts", activePlant],
    queryFn: () => safePurchaseGet("/api/purchase/receipts"),
    enabled: concretePlant,
  })

  const [poForm, setPoForm] = useState({
    po_no: "",
    po_date: today(),
    vendor_id: "",
    supplier_contact: "",
    supplier_address: "",
    supplier_gst_no: "",
    item_id: "",
    qty: "",
    unit_cost: "",
    width_mm: "",
    gsm: "",
    plybond: "",
    bulk: "",
    cobb: "",
    description: "",
    needed_date: today(),
    notes: "",
    freight_terms: "Freight included in landed rate.",
    tax_terms: "GST extra as applicable.",
    payment_terms: "60 days from invoice date.",
    delivery_terms: "Delivery as per agreed schedule.",
    test_report_terms: "Attach test report with delivery challan copy for PB/GSM/RCT/COBB.",
    special_instruction: "FOR AMIGO INDUSTRIES UNIT-2",
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

  if (!concretePlant) {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-cyan-200 bg-cyan-50 p-6">
        <ShieldCheck className="h-7 w-7 text-cyan-800" />
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Select one plant for Purchase and GRN</h1>
        <p className="mt-2 text-sm text-slate-700">Purchase orders, receipts, batch costing, and incoming QC are plant-owned records. Select the receiving plant before reading or posting them.</p>
        <select className="mt-5 h-11 w-full rounded-xl border border-cyan-200 bg-white px-3" value="" onChange={(event) => { if (event.target.value) { setActivePlant(event.target.value); window.location.reload() } }}>
          <option value="">Select plant</option>
          {plants.filter((plant: any) => plant.is_active !== false).map((plant: any) => <option key={plant.id} value={plant.id}>{plant.code} · {plant.name}</option>)}
        </select>
      </section>
    )
  }

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
        po_no: poForm.po_no || undefined,
        po_date: poForm.po_date,
        supplier_id: poForm.vendor_id,
        supplier_name: selectedRequestVendor.name,
        supplier_contact: poForm.supplier_contact || undefined,
        supplier_address: poForm.supplier_address || undefined,
        supplier_gst_no: poForm.supplier_gst_no || undefined,
        expected_date: poForm.needed_date,
        notes: poForm.notes || undefined,
        freight_terms: poForm.freight_terms || undefined,
        tax_terms: poForm.tax_terms || undefined,
        payment_terms: poForm.payment_terms || undefined,
        delivery_terms: poForm.delivery_terms || undefined,
        test_report_terms: poForm.test_report_terms || undefined,
        special_instruction: poForm.special_instruction || undefined,
        lines: [
          {
            item_id: poForm.item_id,
            qty_ordered: Number(poForm.qty),
            unit_cost: Number(poForm.unit_cost),
            incoming_qc_required: true,
            description: poForm.description || selectedRequestItem.name,
            width_mm: poForm.width_mm ? Number(poForm.width_mm) : undefined,
            gsm: poForm.gsm ? Number(poForm.gsm) : undefined,
            plybond: poForm.plybond ? Number(poForm.plybond) : undefined,
            bulk: poForm.bulk ? Number(poForm.bulk) : undefined,
            cobb: poForm.cobb || undefined,
          },
        ],
      })
      setPoForm((current) => ({ ...current, po_no: "", qty: "", unit_cost: "", width_mm: "", gsm: "", plybond: "", bulk: "", cobb: "", description: "", notes: "" }))
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
    <div className="min-w-0 space-y-5 overflow-x-hidden" data-testid="purchase-flow-page">
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
          A purchase API request failed. Review the error shown on the affected section and retry after the service is healthy.
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

      <section className="grid min-w-0 gap-4 xl:grid-cols-[0.92fr_1.08fr] [&>*]:min-w-0">
        <Panel
          title="Create Purchase Order"
          subtitle="Vendor, material, quantity, rate, expected date, and incoming QC requirement are captured before GRN."
          actions={<StatusBadge value={ordersQuery.data?.available ? "CONNECTED" : "ERROR"} />}
        >
          <form onSubmit={submitPurchaseOrder} className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <FieldLabel>PO no optional</FieldLabel>
              <input value={poForm.po_no} onChange={(event) => setPoForm((current) => ({ ...current, po_no: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>PO date</FieldLabel>
              <input required type="date" value={poForm.po_date} onChange={(event) => setPoForm((current) => ({ ...current, po_date: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
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
              <FieldLabel>Contact person</FieldLabel>
              <input value={poForm.supplier_contact} onChange={(event) => setPoForm((current) => ({ ...current, supplier_contact: event.target.value }))} placeholder="Mr. Sundeepji" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>GST no</FieldLabel>
              <input value={poForm.supplier_gst_no} onChange={(event) => setPoForm((current) => ({ ...current, supplier_gst_no: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1 md:col-span-2">
              <FieldLabel>Vendor address</FieldLabel>
              <textarea value={poForm.supplier_address} onChange={(event) => setPoForm((current) => ({ ...current, supplier_address: event.target.value }))} rows={2} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>Material</FieldLabel>
              <select required value={poForm.item_id} onChange={(event) => setPoForm((current) => ({ ...current, item_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select material</option>
                {items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Description</FieldLabel>
              <input value={poForm.description} onChange={(event) => setPoForm((current) => ({ ...current, description: event.target.value }))} placeholder={selectedRequestItem?.name || "KRAFT BOARD"} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>Qty</FieldLabel>
              <input required type="number" min="0.001" step="0.001" value={poForm.qty} onChange={(event) => setPoForm((current) => ({ ...current, qty: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1 md:col-span-2">
              <FieldLabel>Unit cost</FieldLabel>
              <input required type="number" min="0.01" step="0.01" value={poForm.unit_cost} onChange={(event) => setPoForm((current) => ({ ...current, unit_cost: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <div className="grid gap-3 md:col-span-2 md:grid-cols-5">
              <label className="space-y-1">
                <FieldLabel>Width mm</FieldLabel>
                <input type="number" min="0" step="0.01" value={poForm.width_mm} onChange={(event) => setPoForm((current) => ({ ...current, width_mm: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <FieldLabel>GSM</FieldLabel>
                <input type="number" min="0" step="0.01" value={poForm.gsm} onChange={(event) => setPoForm((current) => ({ ...current, gsm: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <FieldLabel>PB</FieldLabel>
                <input type="number" min="0" step="0.01" value={poForm.plybond} onChange={(event) => setPoForm((current) => ({ ...current, plybond: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <FieldLabel>Bulk</FieldLabel>
                <input type="number" min="0" step="0.001" value={poForm.bulk} onChange={(event) => setPoForm((current) => ({ ...current, bulk: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <FieldLabel>COBB</FieldLabel>
                <input value={poForm.cobb} onChange={(event) => setPoForm((current) => ({ ...current, cobb: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
            </div>
            <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
              <label className="space-y-1">
                <FieldLabel>Freight terms</FieldLabel>
                <input value={poForm.freight_terms} onChange={(event) => setPoForm((current) => ({ ...current, freight_terms: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <FieldLabel>Payment terms</FieldLabel>
                <input value={poForm.payment_terms} onChange={(event) => setPoForm((current) => ({ ...current, payment_terms: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <FieldLabel>Test report terms</FieldLabel>
                <input value={poForm.test_report_terms} onChange={(event) => setPoForm((current) => ({ ...current, test_report_terms: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <FieldLabel>Special instruction</FieldLabel>
                <input value={poForm.special_instruction} onChange={(event) => setPoForm((current) => ({ ...current, special_instruction: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </label>
            </div>
            <label className="space-y-1 md:col-span-2">
              <FieldLabel>Notes</FieldLabel>
              <textarea value={poForm.notes} onChange={(event) => setPoForm((current) => ({ ...current, notes: event.target.value }))} rows={3} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <button disabled={createOrder.isPending} className="md:col-span-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {createOrder.isPending ? "Creating PO..." : "Create purchase order"}
            </button>
          </form>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 print:bg-white">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Printable PO Preview</p>
                <h3 className="mt-1 text-base font-semibold text-slate-950">Amigo Industries Unit-2 Purchase Order</h3>
              </div>
              <button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-800">
                Print PO
              </button>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PO</p>
                <p className="mt-1 font-semibold text-slate-950">{poForm.po_no || "System generated"} · {poForm.po_date}</p>
                <p className="mt-1 text-slate-600">Expected {poForm.needed_date || "-"}</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</p>
                <p className="mt-1 font-semibold text-slate-950">{selectedRequestVendor?.name || "Select vendor"}</p>
                <p className="mt-1 text-slate-600">{poForm.supplier_contact || "-"} · GST {poForm.supplier_gst_no || "-"}</p>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {["Item", "Description", "Width", "GSM", "PB", "Bulk", "COBB", "Qty", "Rate", "Amount"].map((head) => <th key={head} className="py-2 pr-3">{head}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100">
                    <td className="py-2 pr-3">{selectedRequestItem?.item_code || "-"}</td>
                    <td className="py-2 pr-3">{poForm.description || selectedRequestItem?.name || "-"}</td>
                    <td className="py-2 pr-3">{poForm.width_mm || "-"}</td>
                    <td className="py-2 pr-3">{poForm.gsm || "-"}</td>
                    <td className="py-2 pr-3">{poForm.plybond || "-"}</td>
                    <td className="py-2 pr-3">{poForm.bulk || "-"}</td>
                    <td className="py-2 pr-3">{poForm.cobb || "-"}</td>
                    <td className="py-2 pr-3">{poForm.qty || "-"}</td>
                    <td className="py-2 pr-3">{poForm.unit_cost || "-"}</td>
                    <td className="py-2 pr-3 font-semibold text-slate-950">{formatCurrency(Number(poForm.qty || 0) * Number(poForm.unit_cost || 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
              <p><strong>Freight:</strong> {poForm.freight_terms || "-"}</p>
              <p><strong>Tax:</strong> {poForm.tax_terms || "-"}</p>
              <p><strong>Payment:</strong> {poForm.payment_terms || "-"}</p>
              <p><strong>Delivery:</strong> {poForm.delivery_terms || "-"}</p>
              <p className="md:col-span-2"><strong>Test report:</strong> {poForm.test_report_terms || "-"}</p>
              <p className="md:col-span-2"><strong>Instruction:</strong> {poForm.special_instruction || "-"}</p>
            </div>
          </div>
        </Panel>

        <Panel
          title="Post GRN Against PO"
          subtitle="Approved PO lines receive into inventory batches. Incoming QC lines remain QC_HOLD until released."
          actions={<StatusBadge value={receiptsQuery.data?.available ? "CONNECTED" : "ERROR"} />}
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
