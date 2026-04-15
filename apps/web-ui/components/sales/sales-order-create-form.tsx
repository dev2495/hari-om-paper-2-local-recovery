"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"

import { Panel } from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import { useCustomers, useParchments } from "@/hooks/use-master-data"
import { useCreateSalesOrder } from "@/hooks/use-sales"
import { useSpecs } from "@/hooks/use-specs"

type SalesLineForm = {
  localId: string
  approved_spec_id: string
  product_code: string
  size_label: string
  parchment_required: boolean
  parchment_color: string
  rate_per_pc: string
  qty: string
  due_date: string
}

type SalesOrderForm = {
  customer_id: string
  po_number: string
  po_date: string
  notes: string
  lines: SalesLineForm[]
}

function createLine(seed = 1): SalesLineForm {
  return {
    localId: `line-${Date.now()}-${seed}`,
    approved_spec_id: "",
    product_code: "",
    size_label: "",
    parchment_required: false,
    parchment_color: "",
    rate_per_pc: "",
    qty: "",
    due_date: "",
  }
}

const INITIAL_FORM: SalesOrderForm = {
  customer_id: "",
  po_number: "",
  po_date: "",
  notes: "",
  lines: [createLine()],
}

function specLabel(spec: any) {
  const parts = [
    spec?.product_code,
    spec?.customer_name,
    spec?.size_label,
    spec?.required_cs ? `CS ${spec.required_cs}` : null,
    spec?.target_tube_weight ? `Wt ${spec.target_tube_weight}` : null,
  ].filter(Boolean)
  return parts.join(" · ") || String(spec?.id || "")
}

export function SalesOrderCreateForm() {
  const router = useRouter()
  const { showToast } = useApp()
  const { data: customers } = useCustomers()
  const { data: specs } = useSpecs()
  const { data: parchments } = useParchments()
  const createOrder = useCreateSalesOrder()
  const [form, setForm] = useState<SalesOrderForm>(INITIAL_FORM)
  const effectiveWritePlant = true

  const approvedSpecs = useMemo(
    () => (Array.isArray(specs) ? specs : []).filter((spec: any) => spec.status === "approved" && spec.active),
    [specs],
  )

  const totalQty = useMemo(
    () => form.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    [form.lines],
  )

  const selectedSpecs = useMemo(() => {
    const map = new Map<string, any>()
    approvedSpecs.forEach((spec: any) => map.set(spec.id, spec))
    return map
  }, [approvedSpecs])

  function updateHeader<K extends keyof SalesOrderForm>(key: K, value: SalesOrderForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateLine(localId: string, field: keyof SalesLineForm, value: string | boolean) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.localId === localId
          ? {
              ...line,
              [field]: value,
              ...(field === "parchment_required" && !value ? { parchment_color: "" } : {}),
            }
          : line,
      ),
    }))
  }

  function updateSpec(localId: string, specId: string) {
    const selectedSpec = selectedSpecs.get(specId)
    const derivedSize =
      String(
        selectedSpec?.size_label ||
          [
            selectedSpec?.id_min_mm && selectedSpec?.id_max_mm ? Math.round((Number(selectedSpec.id_min_mm) + Number(selectedSpec.id_max_mm)) / 2) : null,
            selectedSpec?.od_min_mm && selectedSpec?.od_max_mm ? Math.round((Number(selectedSpec.od_min_mm) + Number(selectedSpec.od_max_mm)) / 2) : null,
            selectedSpec?.length_min_mm && selectedSpec?.length_max_mm ? Math.round((Number(selectedSpec.length_min_mm) + Number(selectedSpec.length_max_mm)) / 2) : null,
          ]
            .filter((value) => value !== null)
            .join(" x "),
      ).trim() || ""
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.localId === localId
          ? {
              ...line,
              approved_spec_id: specId,
              product_code: line.product_code || selectedSpec?.product_code || selectedSpec?.spec_reference || "",
              size_label: derivedSize,
            }
          : line,
      ),
    }))
  }

  function addLine() {
    setForm((current) => ({
      ...current,
      lines: [...current.lines, createLine(current.lines.length + 1)],
    }))
  }

  function removeLine(localId: string) {
    setForm((current) => ({
      ...current,
      lines: current.lines.length === 1 ? current.lines : current.lines.filter((line) => line.localId !== localId),
    }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const response = await createOrder.mutateAsync({
        customer_id: form.customer_id,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        notes: form.notes || null,
        lines: form.lines.map((line, index) => ({
          approved_spec_id: line.approved_spec_id,
          line_no: index + 1,
          product_code: line.product_code || null,
          size_label: line.size_label || null,
          parchment_required: line.parchment_required,
          parchment_color: line.parchment_required ? line.parchment_color || null : null,
          rate_per_pc: line.rate_per_pc ? Number(line.rate_per_pc) : null,
          qty: Number(line.qty),
          due_date: line.due_date,
        })),
      })
      const orderId = response?.data?.id || response?.data?.order?.id
      setForm(INITIAL_FORM)
      showToast("Sales PO created.", "success")
      router.push(orderId ? `/sales-orders/${orderId}` : "/sales-orders")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Unable to create sales order."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-white/70 bg-white/90 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sales PO Entry</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Create one PO with multiple production lines</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Enter the customer PO once, then add one line for each approved spec and parchment demand combination. Size is pulled directly from the selected spec so commercial lines stay aligned with production truth.
            </p>
          </div>
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Live Summary</p>
            <div className="mt-2 space-y-1 text-xs">
              <p>{form.lines.length} production line(s)</p>
              <p>{totalQty.toFixed(0)} pcs total order qty</p>
            </div>
          </div>
        </div>
      </section>

      <form data-testid="sales-orders:create-form" onSubmit={handleSubmit} className="space-y-6">
        <Panel title="PO Header" subtitle="Commercial header saved once for the entire customer order.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer</label>
              <select
                data-testid="sales-orders:customer"
                required
                value={form.customer_id}
                onChange={(event) => updateHeader("customer_id", event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Select customer</option>
                {(customers || []).map((customer: any) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.customer_code ? `${customer.customer_code} · ${customer.name}` : customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">PO Number</label>
              <input
                value={form.po_number}
                onChange={(event) => updateHeader("po_number", event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                placeholder="Customer PO number"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">PO Date</label>
              <input
                type="date"
                value={form.po_date}
                onChange={(event) => updateHeader("po_date", event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
              />
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Notes</label>
              <textarea
                data-testid="sales-orders:notes"
                rows={1}
                value={form.notes}
                onChange={(event) => updateHeader("notes", event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
                placeholder="Delivery notes or commercial remarks"
              />
            </div>
          </div>
        </Panel>

        <Panel title="PO Lines" subtitle="One line per size and parchment/color demand bucket.">
          <div className="space-y-4">
            {form.lines.map((line, index) => {
              const linkedSpec = selectedSpecs.get(line.approved_spec_id)
              return (
                <section key={line.localId} className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Line {index + 1}</p>
                      <p className="mt-1 text-sm text-slate-700">
                        {linkedSpec ? specLabel(linkedSpec) : "Select approved spec and commercial line details"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.localId)}
                      disabled={form.lines.length === 1 || !effectiveWritePlant}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="space-y-1 xl:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Approved Specification</label>
                      <select
                        data-testid={index === 0 ? "sales-orders:spec" : undefined}
                        required
                        value={line.approved_spec_id}
                        onChange={(event) => updateSpec(line.localId, event.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                      >
                        <option value="">Select approved spec</option>
                        {approvedSpecs.map((spec: any) => (
                          <option key={spec.id} value={spec.id}>
                            {specLabel(spec)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Product Code</label>
                      <input
                        required
                        value={line.product_code}
                        onChange={(event) => updateLine(line.localId, "product_code", event.target.value.toUpperCase())}
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                        placeholder="Customer-facing product code"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Size Label</label>
                      <input
                        value={line.size_label}
                        readOnly
                        className="h-11 w-full rounded-xl border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700"
                        placeholder="Auto-filled from selected spec"
                      />
                    </div>
                    <div className="space-y-1 xl:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Rate / Pc</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.rate_per_pc}
                        onChange={(event) => updateLine(line.localId, "rate_per_pc", event.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                        placeholder="12.60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Order Qty</label>
                      <input
                        data-testid={index === 0 ? "sales-orders:qty" : undefined}
                        required
                        type="number"
                        min="1"
                        disabled={!effectiveWritePlant}
                        value={line.qty}
                        onChange={(event) => updateLine(line.localId, "qty", event.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                        placeholder="2000"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Due Date</label>
                      <input
                        data-testid={index === 0 ? "sales-orders:due-date" : undefined}
                        required
                        type="date"
                        disabled={!effectiveWritePlant}
                        value={line.due_date}
                        onChange={(event) => updateLine(line.localId, "due_date", event.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                      />
                    </div>
                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        disabled={!effectiveWritePlant}
                        checked={line.parchment_required}
                        onChange={(event) => updateLine(line.localId, "parchment_required", event.target.checked)}
                      />
                      Parchment required
                    </label>
                    <div className="space-y-1 xl:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Parchment Color</label>
                      <select
                        data-testid={index === 0 ? "sales-orders:parchment" : undefined}
                        value={line.parchment_color}
                        onChange={(event) => updateLine(line.localId, "parchment_color", event.target.value)}
                        disabled={!effectiveWritePlant || !line.parchment_required}
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                      >
                        <option value="">{line.parchment_required ? "Select parchment color" : "Not required for this line"}</option>
                        {(parchments || []).map((parchment: any) => (
                          <option key={parchment.id} value={parchment.color_name}>
                            {parchment.vendor_name} · {parchment.color_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>
              )
            })}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={addLine}
                disabled={!effectiveWritePlant}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white"
              >
                <Plus className="h-4 w-4" />
                Add line
              </button>
              <div className="flex flex-wrap gap-3">
                <Link href="/sales-orders" className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Back to queue
                </Link>
                <button
                  data-testid="sales-orders:create-submit"
                  type="submit"
                  disabled={createOrder.isPending || !effectiveWritePlant}
                  className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createOrder.isPending ? "Creating..." : "Create sales PO"}
                </button>
              </div>
            </div>
          </div>
        </Panel>
      </form>
    </div>
  )
}
