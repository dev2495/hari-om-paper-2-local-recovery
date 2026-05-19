"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, CalendarClock, Layers3, Plus, ScrollText, Sparkles, Trash2 } from "lucide-react"

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

function averageDimension(min: unknown, max: unknown) {
  const low = Number(min)
  const high = Number(max)
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  return Math.round((low + high) / 2)
}

function deriveSizeLabel(spec: any) {
  return String(
    spec?.size_label ||
      [
        averageDimension(spec?.id_min_mm, spec?.id_max_mm),
        averageDimension(spec?.od_min_mm, spec?.od_max_mm),
        averageDimension(spec?.length_min_mm, spec?.length_max_mm),
      ]
        .filter((value) => value !== null)
        .join(" x "),
  ).trim()
}

function deriveProductCode(spec: any, fallbackIndex = 1) {
  const explicit = String(spec?.product_code || spec?.spec_reference || "").trim()
  if (explicit) return explicit.toUpperCase()

  const dimensions = [
    averageDimension(spec?.id_min_mm, spec?.id_max_mm),
    averageDimension(spec?.od_min_mm, spec?.od_max_mm),
    averageDimension(spec?.length_min_mm, spec?.length_max_mm),
  ].filter((value) => value !== null)
  if (dimensions.length === 3) return `FG-${dimensions.join("-")}`.toUpperCase()

  const id = String(spec?.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()
  return id ? `SPEC-${id}` : `LINE-${fallbackIndex}`
}

export function SalesOrderCreateForm() {
  const router = useRouter()
  const { showToast } = useApp()
  const { data: customers } = useCustomers()
  const { data: specs } = useSpecs()
  const { data: parchments } = useParchments()
  const createOrder = useCreateSalesOrder()
  const [form, setForm] = useState<SalesOrderForm>(INITIAL_FORM)

  const approvedSpecs = useMemo(
    () => (Array.isArray(specs) ? specs : []).filter((spec: any) => spec.status === "approved" && spec.active),
    [specs],
  )

  const selectedSpecs = useMemo(() => {
    const map = new Map<string, any>()
    approvedSpecs.forEach((spec: any) => map.set(spec.id, spec))
    return map
  }, [approvedSpecs])

  const totalQty = useMemo(
    () => form.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    [form.lines],
  )

  const parchmentLineCount = useMemo(
    () => form.lines.filter((line) => line.parchment_required).length,
    [form.lines],
  )

  const codedLines = useMemo(
    () => form.lines.filter((line) => line.product_code.trim()).length,
    [form.lines],
  )

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
    const derivedSize = deriveSizeLabel(selectedSpec) || ""

    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.localId === localId
          ? {
              ...line,
              approved_spec_id: specId,
              product_code: line.product_code || deriveProductCode(selectedSpec),
              size_label: derivedSize,
            }
          : line,
      ),
    }))
  }

  function addLine() {
    setForm((current) => ({ ...current, lines: [...current.lines, createLine(current.lines.length + 1)] }))
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
          product_code: line.product_code || deriveProductCode(selectedSpecs.get(line.approved_spec_id), index + 1),
          size_label: line.size_label || deriveSizeLabel(selectedSpecs.get(line.approved_spec_id)) || null,
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
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_58%,#164e63_100%)] p-6 text-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">Sales PO Entry</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Enter one long-horizon PO, then release exact line buckets later.</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-200/85">
              This is the commercial source of truth. Each line remains its own product bucket with its own product code, spec, parchment condition, and due date so production releases stay exact weeks later.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-xs text-cyan-50/90">
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5">Header once</span>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5">Multiple product buckets</span>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5">Release later by line</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-[1.35rem] border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-cyan-100">
                <Layers3 className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Commercial Lines</p>
              </div>
              <p className="mt-2 text-3xl font-semibold">{form.lines.length}</p>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-cyan-100">
                <Sparkles className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Parchment Lines</p>
              </div>
              <p className="mt-2 text-3xl font-semibold">{parchmentLineCount}</p>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-cyan-100">
                <ScrollText className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.16em]">Order Qty</p>
              </div>
              <p className="mt-2 text-3xl font-semibold">{totalQty.toFixed(0)}</p>
            </div>
          </div>
        </div>
      </section>

      <form data-testid="sales-orders:create-form" onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
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
                  <section
                    key={line.localId}
                    className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="border-b border-slate-200 bg-[linear-gradient(90deg,#f8fafc_0%,#ecfeff_100%)] px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Line {index + 1}</p>
                          <p className="mt-1 text-sm text-slate-700">
                            {linkedSpec ? specLabel(linkedSpec) : "Select approved spec and commercial line details"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.localId)}
                          disabled={form.lines.length === 1}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
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
                          value={line.due_date}
                          onChange={(event) => updateLine(line.localId, "due_date", event.target.value)}
                          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                        />
                      </div>
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
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
                          disabled={!line.parchment_required}
                          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                        >
                          <option value="">{line.parchment_required ? "Select parchment color" : "Not required for this line"}</option>
                          {(parchments || []).map((parchment: any) => (
                            <option key={parchment.id} value={parchment.color_name}>
                              {parchment.color_name} / {parchment.vendor_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                      {line.product_code ? `Release bucket ${line.product_code}` : "Product code pending"} · {line.qty ? `${Number(line.qty).toFixed(0)} pcs` : "Qty pending"} · {line.due_date || "Due date pending"}
                    </div>
                  </section>
                )
              })}

              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white"
              >
                <Plus className="h-4 w-4" />
                Add another PO line
              </button>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Release Readiness</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Next Step</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Approve the PO, then release exact quantities by line into the planner.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Product Codes</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{codedLines} / {form.lines.length} filled</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Earliest Due</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {form.lines.map((line) => line.due_date).filter(Boolean).sort()[0] || "Not set"}
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm text-slate-600">
              <div className="flex items-start gap-3 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
                <CalendarClock className="mt-0.5 h-4 w-4 text-cyan-700" />
                <p>Use separate lines even for the same size when product code or parchment changes.</p>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <ArrowRight className="mt-0.5 h-4 w-4 text-slate-700" />
                <p>Release popup will later ask target winder and release qty per line before planning starts.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <button
              data-testid="sales-orders:create-submit"
              type="submit"
              disabled={createOrder.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createOrder.isPending ? "Creating PO..." : "Create sales PO"}
            </button>
            <Link
              href="/sales-orders"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Back to sales queue
            </Link>
          </div>
        </aside>
      </form>
    </div>
  )
}
