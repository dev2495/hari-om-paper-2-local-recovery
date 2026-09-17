"use client"

import Link from "next/link"
import { useMemo, useState, useRef } from "react"
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
import { PageHeader } from "@/components/workspace/page-header"
import { Button } from "@/components/ui/button"
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

function emptyPurchaseLine() {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    item_id: "",
    qty: "",
    unit_cost: "",
    width_mm: "",
    gsm: "",
    plybond: "",
    bulk: "",
    cobb: "",
    description: "",
  }
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
  const schedulesQuery = useQuery({
    queryKey: ["purchase", "schedules", activePlant],
    queryFn: () => safePurchaseGet("/api/purchase/schedules"),
    enabled: concretePlant,
  })

  const [poForm, setPoForm] = useState({
    po_no: "",
    po_date: today(),
    vendor_id: "",
    supplier_contact: "",
    supplier_address: "",
    supplier_gst_no: "",
    needed_date: today(),
    notes: "",
    freight_terms: "Freight included in landed rate.",
    tax_terms: "GST extra as applicable.",
    payment_terms: "60 days from invoice date.",
    delivery_terms: "Delivery as per agreed schedule.",
    test_report_terms: "Attach test report with delivery challan copy for PB/GSM/RCT/COBB.",
    special_instruction: "FOR AMIGO INDUSTRIES UNIT-2",
  })
  const [poLines, setPoLines] = useState(() => [emptyPurchaseLine(), emptyPurchaseLine()])
  const grnRequestId = useRef<string | null>(null)
  const [grnForm, setGrnForm] = useState({
    purchase_order_id: "",
    po_line_id: "",
    qty: "",
    grn_date: today(),
    batch_no: "",
    schedule_id: "",
  })
  const [scheduleForm, setScheduleForm] = useState({
    purchase_order_id: "",
    po_line_id: "",
    scheduled_qty: "",
    promised_date: today(),
    current_date: today(),
    confirmation_status: "TENTATIVE",
  })
  const [allocateForm, setAllocateForm] = useState({
    receipt_line_id: "",
    schedule_id: "",
    allocated_qty: "",
  })
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null)

  const selectedRequestVendor = vendors.find((row: any) => String(row.id) === poForm.vendor_id)

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
      queryClient.invalidateQueries({ queryKey: ["purchase", "schedules"] })
    },
  })
  const commitSchedules = useMutation({
    mutationFn: async (payload: { poId: string; body: any }) => purchaseApi.commitSchedules(payload.poId, payload.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase", "orders"] })
      queryClient.invalidateQueries({ queryKey: ["purchase", "schedules"] })
    },
  })
  const allocateSchedule = useMutation({
    mutationFn: async (payload: { lineId: string; body: any }) => purchaseApi.allocateReceiptSchedule(payload.lineId, payload.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase", "receipts"] })
      queryClient.invalidateQueries({ queryKey: ["purchase", "schedules"] })
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
  const schedules = schedulesQuery.data?.rows || []
  const endpointPending = [ordersQuery.data, receiptsQuery.data, schedulesQuery.data].some((state) => state && !state.available)
  const selectedOrder = orders.find((row: any) => String(row.id) === grnForm.purchase_order_id) || null
  const selectedOrderLines = Array.isArray(selectedOrder?.lines)
    ? selectedOrder.lines.filter((line: any) => String(line.line_status || "").toUpperCase() !== "CLOSED")
    : []
  const selectedScheduleOrder = orders.find((row: any) => String(row.id) === scheduleForm.purchase_order_id) || null
  const selectedScheduleLines = Array.isArray(selectedScheduleOrder?.lines) ? selectedScheduleOrder.lines : []
  const lineSchedules = schedules.filter((row: any) => String(row.purchase_order_line_id) === grnForm.po_line_id)
  const receiptLines = receipts.flatMap((receipt: any) => (receipt.lines || []).map((line: any) => ({ ...line, grn_no: receipt.grn_no, po_no: receipt.po_no })))

  async function submitPurchaseOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    if (!selectedRequestVendor) {
      setMessage({ tone: "error", text: "Select vendor before creating a purchase order." })
      return
    }
    const preparedLines = poLines
      .map((line) => {
        const item = items.find((row: any) => String(row.id) === line.item_id)
        return {
          item,
          item_id: line.item_id,
          qty_ordered: Number(line.qty),
          unit_cost: Number(line.unit_cost),
          incoming_qc_required: true,
          description: line.description || item?.name,
          width_mm: line.width_mm ? Number(line.width_mm) : undefined,
          gsm: line.gsm ? Number(line.gsm) : undefined,
          plybond: line.plybond ? Number(line.plybond) : undefined,
          bulk: line.bulk ? Number(line.bulk) : undefined,
          cobb: line.cobb || undefined,
        }
      })
      .filter((line) => line.item_id && Number.isFinite(line.qty_ordered) && line.qty_ordered > 0)
    if (preparedLines.length < 1) {
      setMessage({ tone: "error", text: "Add at least one purchase line with material and quantity." })
      return
    }
    if (preparedLines.some((line) => !line.item || !Number.isFinite(line.unit_cost) || line.unit_cost < 0)) {
      setMessage({ tone: "error", text: "Every line needs a valid material and unit cost." })
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
        lines: preparedLines.map(({ item, ...line }) => line),
      })
      setPoForm((current) => ({ ...current, po_no: "", notes: "" }))
      setPoLines([emptyPurchaseLine(), emptyPurchaseLine()])
      setMessage({ tone: "success", text: `Purchase order created with ${preparedLines.length} line(s). Approve it before posting GRN.` })
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
      grnRequestId.current ||= crypto.randomUUID()
      await createGrn.mutateAsync({
        purchase_order_id: grnForm.purchase_order_id || undefined,
        body: {
          request_id: grnRequestId.current,
          received_date: grnForm.grn_date,
          lines: [
            {
              po_line_id: grnForm.po_line_id,
              qty_received: Number(grnForm.qty),
              batch_no: grnForm.batch_no || undefined,
              schedule_id: grnForm.schedule_id || undefined,
            },
          ],
        },
      })
      grnRequestId.current = null
      setGrnForm((current) => ({ ...current, qty: "", batch_no: "", schedule_id: "" }))
      setMessage({ tone: "success", text: "GRN posted into stock with vendor, batch cost, and incoming QC status." })
    } catch (error: any) {
      setMessage({ tone: "error", text: errorMessage(error) })
    }
  }

  async function submitSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    if (!scheduleForm.purchase_order_id || !scheduleForm.po_line_id) {
      setMessage({ tone: "error", text: "Select a PO line before committing a supplier delivery schedule." })
      return
    }
    try {
      await commitSchedules.mutateAsync({
        poId: scheduleForm.purchase_order_id,
        body: {
          rows: [
            {
              purchase_order_line_id: scheduleForm.po_line_id,
              scheduled_qty: Number(scheduleForm.scheduled_qty),
              promised_date: scheduleForm.promised_date,
              current_date: scheduleForm.current_date || scheduleForm.promised_date,
              confirmation_status: scheduleForm.confirmation_status,
            },
          ],
        },
      })
      setScheduleForm((current) => ({ ...current, scheduled_qty: "" }))
      setMessage({ tone: "success", text: "Supplier delivery schedule saved. This is a commitment, not a stock posting." })
    } catch (error: any) {
      setMessage({ tone: "error", text: errorMessage(error) })
    }
  }

  async function submitAllocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    if (!allocateForm.receipt_line_id || !allocateForm.schedule_id) {
      setMessage({ tone: "error", text: "Select a receipt line and a schedule row to allocate." })
      return
    }
    try {
      const result = await allocateSchedule.mutateAsync({
        lineId: allocateForm.receipt_line_id,
        body: {
          schedule_id: allocateForm.schedule_id,
          allocated_qty: allocateForm.allocated_qty ? Number(allocateForm.allocated_qty) : undefined,
        },
      })
      const replayed = Boolean((result as any)?.data?.idempotent)
      setMessage({
        tone: "success",
        text: replayed
          ? "Receipt replay did not double-allocate. Existing allocation returned."
          : "Partial receipt allocated to the supplier schedule.",
      })
    } catch (error: any) {
      setMessage({ tone: "error", text: errorMessage(error) })
    }
  }

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden" data-testid="purchase-flow-page">
      <PageHeader
        variant="hero"
        eyebrow="Purchase to GRN control"
        title="Purchase orders, GRN stock posting, and supplier schedules."
        description="Create vendor-linked purchase orders, approve buying, then post GRN into priced inventory batches. Incoming QC verdicts stay with QC/inventory; this desk cannot set PASS or UNRESTRICTED."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild className="rounded-xl bg-white text-slate-950 hover:bg-slate-100">
              <Link href="/inventory/raw-material-inward">Direct bulk GRN</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl border-white/20 bg-transparent text-white hover:bg-white/10">
              <Link href="/inventory/reels/inward">Reel GRN</Link>
            </Button>
          </div>
        }
      />

      <section className="flex flex-wrap gap-2">
        <EndpointChip label="Purchase orders" state={ordersQuery.data} />
        <EndpointChip label="GRNs" state={receiptsQuery.data} />
        <EndpointChip label="Supplier schedules" state={schedulesQuery.data} />
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
          subtitle="Vendor header plus multiple material lines. The API already accepted a lines array; this desk now sends every row."
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
            <div className="md:col-span-2 space-y-3" data-testid="purchase-multiline-editor">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>Purchase lines</FieldLabel>
                <button
                  type="button"
                  onClick={() => setPoLines((current) => [...current, emptyPurchaseLine()])}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-800"
                >
                  Add line
                </button>
              </div>
              {poLines.map((line, index) => {
                const selectedItem = items.find((row: any) => String(row.id) === line.item_id)
                return (
                  <div key={line.key} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                    <div className="md:col-span-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Line {index + 1}</p>
                      <button
                        type="button"
                        disabled={poLines.length <= 1}
                        onClick={() => setPoLines((current) => current.filter((row) => row.key !== line.key))}
                        className="text-xs font-semibold text-rose-800 disabled:opacity-40"
                        aria-label={`Remove line ${index + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                    <label className="space-y-1">
                      <FieldLabel>Material</FieldLabel>
                      <select value={line.item_id} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, item_id: event.target.value } : row))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                        <option value="">Select material</option>
                        {items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <FieldLabel>Description</FieldLabel>
                      <input value={line.description} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, description: event.target.value } : row))} placeholder={selectedItem?.name || "KRAFT BOARD"} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                    </label>
                    <label className="space-y-1">
                      <FieldLabel>Qty</FieldLabel>
                      <input type="number" min="0.001" step="0.001" value={line.qty} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, qty: event.target.value } : row))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                    </label>
                    <label className="space-y-1">
                      <FieldLabel>Unit cost</FieldLabel>
                      <input type="number" min="0.01" step="0.01" value={line.unit_cost} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, unit_cost: event.target.value } : row))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                    </label>
                    <div className="grid gap-3 md:col-span-2 md:grid-cols-5">
                      <label className="space-y-1">
                        <FieldLabel>Width mm</FieldLabel>
                        <input type="number" min="0" step="0.01" value={line.width_mm} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, width_mm: event.target.value } : row))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                      </label>
                      <label className="space-y-1">
                        <FieldLabel>GSM</FieldLabel>
                        <input type="number" min="0" step="0.01" value={line.gsm} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, gsm: event.target.value } : row))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                      </label>
                      <label className="space-y-1">
                        <FieldLabel>PB</FieldLabel>
                        <input type="number" min="0" step="0.01" value={line.plybond} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, plybond: event.target.value } : row))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                      </label>
                      <label className="space-y-1">
                        <FieldLabel>Bulk</FieldLabel>
                        <input type="number" min="0" step="0.001" value={line.bulk} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, bulk: event.target.value } : row))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                      </label>
                      <label className="space-y-1">
                        <FieldLabel>COBB</FieldLabel>
                        <input value={line.cobb} onChange={(event) => setPoLines((current) => current.map((row) => row.key === line.key ? { ...row, cobb: event.target.value.toUpperCase() } : row))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                      </label>
                    </div>
                  </div>
                )
              })}
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
                  {poLines.map((line) => {
                    const selectedItem = items.find((row: any) => String(row.id) === line.item_id)
                    return (
                      <tr key={line.key} className="border-b border-slate-100">
                        <td className="py-2 pr-3">{selectedItem?.item_code || "-"}</td>
                        <td className="py-2 pr-3">{line.description || selectedItem?.name || "-"}</td>
                        <td className="py-2 pr-3">{line.width_mm || "-"}</td>
                        <td className="py-2 pr-3">{line.gsm || "-"}</td>
                        <td className="py-2 pr-3">{line.plybond || "-"}</td>
                        <td className="py-2 pr-3">{line.bulk || "-"}</td>
                        <td className="py-2 pr-3">{line.cobb || "-"}</td>
                        <td className="py-2 pr-3">{line.qty || "-"}</td>
                        <td className="py-2 pr-3">{line.unit_cost || "-"}</td>
                        <td className="py-2 pr-3 font-semibold text-slate-950">{formatCurrency(Number(line.qty || 0) * Number(line.unit_cost || 0))}</td>
                      </tr>
                    )
                  })}
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
              <FieldLabel>Schedule row optional</FieldLabel>
              <select value={grnForm.schedule_id} onChange={(event) => setGrnForm((current) => ({ ...current, schedule_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Do not allocate on post</option>
                {lineSchedules.filter((row: any) => String(row.confirmation_status || "").toUpperCase() !== "CANCELLED").map((row: any) => (
                  <option key={row.id} value={row.id}>{row.current_date} · remain {formatNumber(row.remaining_qty, 2)}</option>
                ))}
              </select>
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

      <section className="grid min-w-0 gap-4 xl:grid-cols-2" data-testid="supplier-schedule-panel">
        <Panel title="Supplier delivery schedule" subtitle="Dated commitments on a purchase line. Separate from GRN and incoming QC.">
          <form onSubmit={submitSchedule} className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <FieldLabel>Purchase order</FieldLabel>
              <select required value={scheduleForm.purchase_order_id} onChange={(event) => setScheduleForm((current) => ({ ...current, purchase_order_id: event.target.value, po_line_id: "" }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select PO</option>
                {orders.map((order: any) => <option key={order.id} value={order.id}>{order.po_no} · {order.supplier_name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>PO line</FieldLabel>
              <select required value={scheduleForm.po_line_id} onChange={(event) => setScheduleForm((current) => ({ ...current, po_line_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select line</option>
                {selectedScheduleLines.map((line: any) => (
                  <option key={line.id} value={line.id}>{line.item_code} · ordered {formatNumber(line.qty_ordered, 2)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Scheduled qty</FieldLabel>
              <input required type="number" min="0.001" step="0.001" value={scheduleForm.scheduled_qty} onChange={(event) => setScheduleForm((current) => ({ ...current, scheduled_qty: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>Confirmation</FieldLabel>
              <select value={scheduleForm.confirmation_status} onChange={(event) => setScheduleForm((current) => ({ ...current, confirmation_status: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="TENTATIVE">Tentative</option>
                <option value="CONFIRMED">Confirmed</option>
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Promised date</FieldLabel>
              <input required type="date" value={scheduleForm.promised_date} onChange={(event) => setScheduleForm((current) => ({ ...current, promised_date: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <FieldLabel>Current expected date</FieldLabel>
              <input required type="date" value={scheduleForm.current_date} onChange={(event) => setScheduleForm((current) => ({ ...current, current_date: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <button disabled={commitSchedules.isPending} className="md:col-span-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {commitSchedules.isPending ? "Saving schedule..." : "Commit schedule row"}
            </button>
          </form>
          <div className="mt-4 space-y-2">
            {schedules.slice(0, 8).map((row: any) => (
              <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-950">{row.po_no || "PO"} · {row.item_code || row.purchase_order_line_id}</span>
                  <StatusBadge value={row.confirmation_status || "TENTATIVE"} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {row.current_date} · scheduled {formatNumber(row.scheduled_qty, 2)} · allocated {formatNumber(row.allocated_qty, 2)} · remain {formatNumber(row.remaining_qty, 2)}
                </p>
              </div>
            ))}
            {!schedules.length ? <EmptyState label="No supplier schedule rows yet." /> : null}
          </div>
        </Panel>
        <Panel title="Receipt-to-schedule allocation" subtitle="Partial receipts allocate explicitly. Replaying the same receipt line does not allocate twice.">
          <form onSubmit={submitAllocation} className="grid gap-3">
            <label className="space-y-1">
              <FieldLabel>Receipt line</FieldLabel>
              <select required value={allocateForm.receipt_line_id} onChange={(event) => setAllocateForm((current) => ({ ...current, receipt_line_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select GRN line</option>
                {receiptLines.map((line: any) => (
                  <option key={line.id} value={line.id}>{line.grn_no} · {line.item_code} · {formatNumber(line.qty_received, 2)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Schedule row</FieldLabel>
              <select required value={allocateForm.schedule_id} onChange={(event) => setAllocateForm((current) => ({ ...current, schedule_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select schedule</option>
                {schedules.filter((row: any) => String(row.confirmation_status || "").toUpperCase() !== "CANCELLED").map((row: any) => (
                  <option key={row.id} value={row.id}>{row.po_no} · {row.current_date} · remain {formatNumber(row.remaining_qty, 2)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <FieldLabel>Allocated qty optional</FieldLabel>
              <input type="number" min="0.001" step="0.001" value={allocateForm.allocated_qty} onChange={(event) => setAllocateForm((current) => ({ ...current, allocated_qty: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <button disabled={allocateSchedule.isPending} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {allocateSchedule.isPending ? "Allocating..." : "Allocate receipt to schedule"}
            </button>
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
                    <p className="mt-2 text-xs text-slate-500" data-testid="purchase-qc-no-pass-shortcut">
                      Pending for QC/inventory. Purchase cannot set PASS or UNRESTRICTED.
                    </p>
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
