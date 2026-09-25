"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"

import { Panel } from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import { useCustomers, useParchments } from "@/hooks/use-master-data"
import { useCreateSalesOrder, useSalesOrder, useUpdateSalesOrder } from "@/hooks/use-sales"
import { useSpecs } from "@/hooks/use-specs"
import {
  ORDER_ORIGIN_CUSTOMER_PO,
  ORDER_ORIGIN_INTERNAL,
  addCalendarDays,
  deliveryDateMustFollowCustomerPoDate,
  isCustomerPoOrigin,
} from "@/lib/sales-order-entry"

type SalesLineForm = {
  localId: string
  persistedId?: string
  approved_spec_id: string
  product_code: string
  size_label: string
  parchment_required: boolean
  parchment_color_id: string
  parchment_color: string
  rate_per_pc: string
  qty: string
  due_date: string
}

type SalesOrderForm = {
  origin: string
  customer_id: string
  po_number: string
  po_date: string
  internal_order_date: string
  /** Blank means "use the default": order date + 45 days. */
  expiry_date: string
  notes: string
  lines: SalesLineForm[]
}

const DEFAULT_EXPIRY_DAYS = 45

function createLine(seed = 1): SalesLineForm {
  return {
    localId: `line-${Date.now()}-${seed}`,
    approved_spec_id: "",
    product_code: "",
    size_label: "",
    parchment_required: false,
    parchment_color_id: "",
    parchment_color: "",
    rate_per_pc: "",
    qty: "",
    due_date: "",
  }
}

const INITIAL_FORM: SalesOrderForm = {
  origin: ORDER_ORIGIN_CUSTOMER_PO,
  customer_id: "",
  po_number: "",
  po_date: "",
  internal_order_date: "",
  expiry_date: "",
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

function isoDate(value?: string | null) {
  if (!value) return ""
  return String(value).slice(0, 10)
}

export function SalesOrderCreateForm({ orderId }: { orderId?: string }) {
  const router = useRouter()
  const { showToast } = useApp()
  const { data: customers } = useCustomers()
  const { data: specs } = useSpecs()
  const { data: parchments } = useParchments()
  const existingOrder = useSalesOrder(orderId)
  const createOrder = useCreateSalesOrder()
  const updateOrder = useUpdateSalesOrder()
  const [form, setForm] = useState<SalesOrderForm>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [hydratedOrderId, setHydratedOrderId] = useState<string | null>(null)

  const editing = Boolean(orderId)
  const saving = createOrder.isPending || updateOrder.isPending

  const approvedSpecs = useMemo(
    () => (Array.isArray(specs) ? specs : []).filter((spec: any) => spec.status === "approved" && spec.active),
    [specs],
  )

  const selectedSpecs = useMemo(() => {
    const map = new Map<string, any>()
    approvedSpecs.forEach((spec: any) => map.set(spec.id, spec))
    return map
  }, [approvedSpecs])

  const parchmentOptions = useMemo(
    () =>
      (Array.isArray(parchments) ? parchments : []).filter(
        (parchment: any) => parchment?.color_name && parchment?.id && !String(parchment.id).startsWith("vendor:"),
      ),
    [parchments],
  )

  const customerPoMode = isCustomerPoOrigin(form.origin)
  const deliveryMinDate = customerPoMode && form.po_date ? addCalendarDays(form.po_date, 1) : undefined
  const orderBaseDate = customerPoMode ? form.po_date : form.internal_order_date
  const defaultExpiry = addCalendarDays(orderBaseDate || new Date().toISOString().slice(0, 10), DEFAULT_EXPIRY_DAYS)

  useEffect(() => {
    if (!orderId || !existingOrder.data || hydratedOrderId === orderId) return
    const order = existingOrder.data
    const origin = String(order.origin || ORDER_ORIGIN_CUSTOMER_PO).toUpperCase() === ORDER_ORIGIN_INTERNAL
      ? ORDER_ORIGIN_INTERNAL
      : ORDER_ORIGIN_CUSTOMER_PO
    setForm({
      origin,
      customer_id: String(order.customer_id || ""),
      po_number: origin === ORDER_ORIGIN_CUSTOMER_PO ? String(order.po_number || "") : "",
      po_date: origin === ORDER_ORIGIN_CUSTOMER_PO ? isoDate(order.po_date) : "",
      internal_order_date: origin === ORDER_ORIGIN_INTERNAL ? isoDate(order.internal_order_date || order.created_at) : "",
      expiry_date: isoDate(order.expiry_date),
      notes: String(order.notes || ""),
      lines: (order.lines || []).length
        ? order.lines.map((line: any, index: number) => ({
            localId: String(line.id || `line-${index + 1}`),
            persistedId: line.id ? String(line.id) : undefined,
            approved_spec_id: String(line.approved_spec_id || ""),
            product_code: String(line.product_code || ""),
            size_label: String(line.size_label || ""),
            parchment_required: Boolean(line.parchment_required),
            parchment_color_id: line.parchment_required ? String(line.parchment_color_id || "") : "",
            parchment_color: line.parchment_required ? String(line.parchment_color || "") : "",
            rate_per_pc: line.rate_per_pc == null ? "" : String(line.rate_per_pc),
            qty: line.qty == null ? "" : String(line.qty),
            due_date: isoDate(line.due_date),
          }))
        : [createLine()],
    })
    setHydratedOrderId(orderId)
  }, [existingOrder.data, hydratedOrderId, orderId])

  function updateHeader<K extends keyof SalesOrderForm>(key: K, value: SalesOrderForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[String(key)]
      return next
    })
  }

  function setOrigin(origin: string) {
    setForm((current) => ({
      ...current,
      origin,
      ...(origin === ORDER_ORIGIN_INTERNAL
        ? { po_number: "", po_date: "" }
        : { internal_order_date: "" }),
    }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next.origin
      delete next.po_number
      delete next.po_date
      delete next.internal_order_date
      Object.keys(next).forEach((key) => {
        if (key.startsWith("due_date:")) delete next[key]
      })
      return next
    })
  }

  function updateLine(localId: string, field: keyof SalesLineForm, value: string | boolean) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.localId === localId
          ? {
              ...line,
              [field]: value,
              ...(field === "parchment_required" && !value
                ? { parchment_color: "", parchment_color_id: "" }
                : {}),
            }
          : line,
      ),
    }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[`${String(field)}:${localId}`]
      if (field === "due_date") delete next[`due_date:${localId}`]
      return next
    })
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

  function updateParchment(localId: string, parchmentId: string) {
    const selected = parchmentOptions.find((parchment: any) => String(parchment.id) === parchmentId)
    const snapshot = selected
      ? String(selected.display_name || [selected.color_name, selected.vendor_name].filter(Boolean).join(" / ") || selected.color_name || "")
      : ""
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.localId === localId
          ? {
              ...line,
              parchment_color_id: parchmentId,
              parchment_color: snapshot,
            }
          : line,
      ),
    }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[`parchment_color:${localId}`]
      return next
    })
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

  function validateForm() {
    const errors: Record<string, string> = {}
    if (!form.customer_id) errors.customer_id = "Customer is required."
    if (customerPoMode) {
      if (!form.po_number.trim()) errors.po_number = "Customer PO number is required for customer PO orders."
      if (!form.po_date) errors.po_date = "Customer PO Date is required for customer PO orders."
    } else if (!form.internal_order_date) {
      errors.internal_order_date = "Internal order date is required for internal sales orders."
    }

    form.lines.forEach((line, index) => {
      const dateError = deliveryDateMustFollowCustomerPoDate(line.due_date, form.po_date, form.origin)
      if (dateError) errors[`due_date:${line.localId}`] = `Line ${index + 1}: ${dateError}`
      if (line.parchment_required && !line.parchment_color_id && !line.parchment_color) {
        errors[`parchment_color:${line.localId}`] = `Line ${index + 1}: Parchment color is required when parchment is required.`
      }
    })
    setFieldErrors(errors)
    return errors
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateForm()
    if (Object.keys(errors).length > 0) {
      const first = Object.values(errors)[0]
      showToast(first, "error")
      return
    }
    const payload = {
      origin: form.origin,
      customer_id: form.customer_id,
      po_number: customerPoMode ? form.po_number : null,
      po_date: customerPoMode ? form.po_date || null : null,
      internal_order_date: customerPoMode ? null : form.internal_order_date || null,
      expiry_date: form.expiry_date || defaultExpiry || null,
      notes: form.notes || null,
      lines: form.lines.map((line, index) => ({
        id: line.persistedId || undefined,
        approved_spec_id: line.approved_spec_id,
        line_no: index + 1,
        product_code: line.product_code || deriveProductCode(selectedSpecs.get(line.approved_spec_id), index + 1),
        size_label: line.size_label || deriveSizeLabel(selectedSpecs.get(line.approved_spec_id)) || null,
        parchment_required: Boolean(line.parchment_required),
        parchment_color_id: line.parchment_required ? line.parchment_color_id || null : null,
        parchment_color: line.parchment_required ? line.parchment_color || null : null,
        rate_per_pc: line.rate_per_pc ? Number(line.rate_per_pc) : null,
        qty: Number(line.qty),
        due_date: line.due_date,
      })),
    }
    try {
      const response = editing
        ? await updateOrder.mutateAsync({ orderId: String(orderId), data: payload })
        : await createOrder.mutateAsync(payload)
      const savedId = response?.data?.id || response?.data?.order?.id || orderId
      if (!editing) setForm(INITIAL_FORM)
      showToast(editing ? "Sales order updated." : "Sales order created.", "success")
      router.push(savedId ? `/sales-orders/${savedId}` : "/sales-orders")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Unable to save sales order."
      const message = typeof detail === "string" ? detail : JSON.stringify(detail)
      showToast(message, "error")
      if (typeof detail === "string" && /delivery date/i.test(detail)) {
        const match = detail.match(/Line (\d+)/i)
        const lineIndex = match ? Number(match[1]) - 1 : 0
        const line = form.lines[lineIndex]
        if (line) setFieldErrors((current) => ({ ...current, [`due_date:${line.localId}`]: detail }))
      }
    }
  }

  if (editing && existingOrder.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading sales order...</p>
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sales</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {editing ? "Edit sales order" : "New sales order"}
          </h1>
        </div>
        <Link href="/sales-orders" className="text-sm font-semibold text-muted-foreground hover:text-foreground">
          Back to sales queue
        </Link>
      </header>

      <form data-testid="sales-orders:create-form" onSubmit={handleSubmit} className="space-y-6">
        <Panel title="Order header" subtitle="Customer stays on both customer PO and internal orders. External PO fields stay empty for internal orders.">
          <div className="space-y-4">
            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Order source</legend>
              <div className="mt-2 inline-flex rounded-xl border border-border bg-muted p-1">
                <button
                  type="button"
                  data-testid="sales-orders:origin-customer-po"
                  aria-pressed={customerPoMode}
                  onClick={() => setOrigin(ORDER_ORIGIN_CUSTOMER_PO)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${customerPoMode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  Customer PO
                </button>
                <button
                  type="button"
                  data-testid="sales-orders:origin-internal"
                  aria-pressed={!customerPoMode}
                  onClick={() => setOrigin(ORDER_ORIGIN_INTERNAL)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${!customerPoMode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  Internal sales order
                </button>
              </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Customer</label>
                <select
                  data-testid="sales-orders:customer"
                  required
                  value={form.customer_id}
                  onChange={(event) => updateHeader("customer_id", event.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                >
                  <option value="">Select customer</option>
                  {(customers || []).map((customer: any) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.customer_code ? `${customer.customer_code} · ${customer.name}` : customer.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.customer_id ? <p className="text-xs text-signal-rose-ink">{fieldErrors.customer_id}</p> : null}
              </div>
              {customerPoMode ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Customer PO number</label>
                    <input
                      data-testid="sales-orders:po-number"
                      required={customerPoMode}
                      value={form.po_number}
                      onChange={(event) => updateHeader("po_number", event.target.value)}
                      className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      placeholder="Customer PO number"
                    />
                    {fieldErrors.po_number ? <p className="text-xs text-signal-rose-ink">{fieldErrors.po_number}</p> : null}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Customer PO Date</label>
                    <input
                      data-testid="sales-orders:po-date"
                      type="date"
                      required={customerPoMode}
                      value={form.po_date}
                      onChange={(event) => updateHeader("po_date", event.target.value)}
                      className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    />
                    {fieldErrors.po_date ? <p className="text-xs text-signal-rose-ink">{fieldErrors.po_date}</p> : null}
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Internal order date</label>
                  <input
                    data-testid="sales-orders:internal-order-date"
                    type="date"
                    required={!customerPoMode}
                    value={form.internal_order_date}
                    onChange={(event) => updateHeader("internal_order_date", event.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  />
                  {fieldErrors.internal_order_date ? <p className="text-xs text-signal-rose-ink">{fieldErrors.internal_order_date}</p> : null}
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="sales-order-expiry" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">SO expiry date</label>
                <input
                  id="sales-order-expiry"
                  data-testid="sales-orders:expiry-date"
                  type="date"
                  value={form.expiry_date || defaultExpiry}
                  min={orderBaseDate || undefined}
                  onChange={(event) => updateHeader("expiry_date", event.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {form.expiry_date && form.expiry_date !== defaultExpiry
                    ? <>Custom date. <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => updateHeader("expiry_date", "")}>Reset to {DEFAULT_EXPIRY_DAYS} days</button></>
                    : `Default: ${DEFAULT_EXPIRY_DAYS} days from the ${customerPoMode ? "PO" : "order"} date.`}
                </p>
              </div>
              <div className="space-y-1 md:col-span-2 xl:col-span-1">
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notes</label>
                <textarea
                  data-testid="sales-orders:notes"
                  rows={1}
                  value={form.notes}
                  onChange={(event) => updateHeader("notes", event.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-sm"
                  placeholder="Delivery notes or commercial remarks"
                />
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Order lines" subtitle="Each line keeps a stable identity. Add or remove lines without using the row number as the database key.">
          <div className="space-y-4">
            {form.lines.map((line, index) => {
              const lineNumber = index + 1
              const dueError = fieldErrors[`due_date:${line.localId}`]
              const parchmentError = fieldErrors[`parchment_color:${line.localId}`]
              return (
                <section key={line.localId} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-muted-foreground">
                      <span className="sr-only">Sales order </span>Line {lineNumber}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeLine(line.localId)}
                      disabled={form.lines.length === 1}
                      aria-label={`Remove line ${lineNumber}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="space-y-1 xl:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Approved Specification</label>
                      <select
                        data-testid={index === 0 ? "sales-orders:spec" : undefined}
                        required
                        value={line.approved_spec_id}
                        onChange={(event) => updateSpec(line.localId, event.target.value)}
                        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
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
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Product Code</label>
                      <input
                        required
                        value={line.product_code}
                        onChange={(event) => updateLine(line.localId, "product_code", event.target.value.toUpperCase())}
                        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                        placeholder="Customer-facing product code"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Size Label</label>
                      <input
                        value={line.size_label}
                        readOnly
                        className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-muted-foreground"
                        placeholder="Auto-filled from selected spec"
                      />
                    </div>
                    <div className="space-y-1 xl:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Rate / Pc</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.rate_per_pc}
                        onChange={(event) => updateLine(line.localId, "rate_per_pc", event.target.value)}
                        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                        placeholder="12.60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Order Qty</label>
                      <input
                        data-testid={index === 0 ? "sales-orders:qty" : undefined}
                        required
                        type="number"
                        min="1"
                        value={line.qty}
                        onChange={(event) => updateLine(line.localId, "qty", event.target.value)}
                        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                        placeholder="2000"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Delivery Date</label>
                      <input
                        data-testid={index === 0 ? "sales-orders:due-date" : `sales-orders:due-date-${index}`}
                        required
                        type="date"
                        min={deliveryMinDate}
                        value={line.due_date}
                        onChange={(event) => updateLine(line.localId, "due_date", event.target.value)}
                        className={`h-11 w-full rounded-xl border bg-card px-3 text-sm ${dueError ? "border-signal-rose-line" : "border-border"}`}
                      />
                      {dueError ? <p className="text-xs text-signal-rose-ink">{dueError}</p> : null}
                    </div>
                    <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                      <input
                        data-testid={index === 0 ? "sales-orders:parchment-required" : undefined}
                        type="checkbox"
                        checked={line.parchment_required}
                        onChange={(event) => updateLine(line.localId, "parchment_required", event.target.checked)}
                      />
                      Parchment required
                    </label>
                    <div className="space-y-1 xl:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Parchment Color</label>
                      <select
                        data-testid={index === 0 ? "sales-orders:parchment" : undefined}
                        value={line.parchment_color_id}
                        onChange={(event) => updateParchment(line.localId, event.target.value)}
                        disabled={!line.parchment_required}
                        required={line.parchment_required}
                        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm disabled:bg-muted"
                      >
                        <option value="">{line.parchment_required ? "Select parchment color" : "Not required for this line"}</option>
                        {parchmentOptions.map((parchment: any) => (
                          <option key={parchment.id} value={parchment.id}>
                            {parchment.display_name || `${parchment.color_name} / ${parchment.vendor_name || ""}`.trim()}
                          </option>
                        ))}
                      </select>
                      {parchmentError ? <p className="text-xs text-signal-rose-ink">{parchmentError}</p> : null}
                    </div>
                  </div>
                </section>
              )
            })}

            <button
              type="button"
              onClick={addLine}
              data-testid="sales-orders:add-line"
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-card"
            >
              <Plus className="h-4 w-4" />
              Add line
            </button>
          </div>
        </Panel>

        <div className="flex flex-wrap items-center gap-3">
          <button
            data-testid="sales-orders:create-submit"
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : editing ? "Save sales order" : "Create sales order"}
          </button>
          <Link
            href="/sales-orders"
            className="inline-flex items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
