"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Pencil } from "lucide-react"

import { useApp } from "@/context/AppContext"
import {
  CockpitShell,
  ConfirmDialog,
  ContactList,
  DataGrid,
  DetailDrawer,
  FilterField,
  KpiTile,
  MasterHero,
  Pill,
  SearchField,
  type GridColumn,
} from "@/components/master/master-cockpit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCustomer360 } from "@/hooks/use-analytics"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateCustomer,
  useCreateCustomerContact,
  useCustomerContacts,
  useCustomers,
  useDeleteCustomer,
  useDeleteCustomerContact,
  useUpdateCustomer,
  useUpdateCustomerContact,
} from "@/hooks/use-master-data"
import {
  CUSTOMER_CATEGORIES,
  CustomerFormFields,
  customerChallanStatus,
  customerFormErrors,
  emptyCustomerForm,
  formFromCustomer,
  payloadFromCustomerForm,
  type Customer,
  type CustomerForm,
} from "./customer-form"

function errorMessage(err: any) {
  const detail = err?.response?.data?.detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return detail || err?.response?.data?.message || err?.message || "Action failed"
}
function compact(v: unknown) {
  return String(v || "").trim()
}
function fmtINR(value?: number | null) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0) return "₹—"
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(n)
}
function dispatchPlace(c: Customer) {
  const separate = compact(c.shipping_city) || compact(c.shipping_state)
  return [separate ? c.shipping_city : c.billing_city, separate ? c.shipping_state : c.billing_state].map(compact).filter(Boolean).join(", ")
}
function contactLine(c: Customer) {
  return [c.primary_contact_name, c.primary_contact_phone].map(compact).filter(Boolean).join(" · ")
}
function matchesSearch(row: Customer, needle: string) {
  if (!needle) return true
  return [row.customer_code, row.name, row.gst_no, row.pan_no, row.address, row.billing_city, row.shipping_city, row.billing_state, row.shipping_state, row.billing_pin_code, row.shipping_pin_code, row.primary_contact_name, row.primary_contact_phone, row.primary_contact_email, row.category]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}

const filterSelect = "h-11 w-full rounded-md border border-border bg-card px-2 text-base font-medium text-foreground sm:h-9 sm:w-auto sm:text-sm"
const actionBtn = "inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold sm:min-h-9 sm:px-3 sm:text-xs"

function CustomersBody() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const customersQuery = useCustomers({ include_inactive: true })
  const createCustomer = useCreateCustomer()
  const updateCustomer = useUpdateCustomer()
  const deleteCustomer = useDeleteCustomer()
  const createContact = useCreateCustomerContact()
  const updateContact = useUpdateCustomerContact()
  const deleteContact = useDeleteCustomerContact()

  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  const { data: customer360 } = useCustomer360({ startDate, endDate: today, plant: activePlant || undefined })

  // Index the customer-360 rows by customer name/id so we can decorate the master.
  const performance = useMemo(() => {
    const rows: any[] = Array.isArray((customer360 as any)?.rows) ? (customer360 as any).rows : []
    const byKey = new Map<string, any>()
    for (const r of rows) {
      const keys = [r.customer_id, r.customer_name].filter(Boolean).map((k: any) => String(k).toLowerCase())
      for (const k of keys) byKey.set(k, r)
    }
    return byKey
  }, [customer360])

  const lookupPerf = useCallback((c: Customer): any | undefined => {
    if (!c) return undefined
    return (
      performance.get(String(c.id).toLowerCase()) ||
      performance.get(String(c.customer_code || "").toLowerCase()) ||
      performance.get(String(c.name || "").toLowerCase())
    )
  }, [performance])

  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE")
  const [challanFilter, setChallanFilter] = useState<"ALL" | "READY" | "MISSING">("ALL")
  const [riskFilter, setRiskFilter] = useState<"all" | "watch" | "critical">("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const drawerRef = useRef<HTMLDivElement | null>(null)

  // One form for "+ New customer" and "Edit customer".
  const [formMode, setFormMode] = useState<null | "create" | "edit">(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [showFieldErrors, setShowFieldErrors] = useState(false)

  const [confirmKind, setConfirmKind] = useState<null | "deactivate" | "delete">(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const customers: Customer[] = useMemo(
    () => (Array.isArray(customersQuery.data) ? customersQuery.data : []),
    [customersQuery.data],
  )

  const filteredCustomers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return customers.filter((c) => {
      if (!matchesSearch(c, needle)) return false
      if (categoryFilter !== "ALL" && (c.category || "Other") !== categoryFilter) return false
      const active = c.is_active !== false
      if (statusFilter === "ACTIVE" && !active) return false
      if (statusFilter === "INACTIVE" && active) return false
      const ready = customerChallanStatus(c).ready
      if (challanFilter === "READY" && !ready) return false
      if (challanFilter === "MISSING" && ready) return false
      if (riskFilter !== "all") {
        const risk = lookupPerf(c)?.risk
        if (riskFilter === "critical" && risk !== "critical") return false
        if (riskFilter === "watch" && risk !== "critical" && risk !== "watch") return false
      }
      return true
    })
  }, [customers, search, categoryFilter, statusFilter, challanFilter, riskFilter, lookupPerf])

  const selectedCustomer = customers.find((c) => c.id === selectedId) || null
  const contactsQuery = useCustomerContacts(selectedId)
  const contacts = Array.isArray(contactsQuery.data) ? contactsQuery.data : []
  const selectedPerf = selectedCustomer ? lookupPerf(selectedCustomer) : undefined

  const kpis = useMemo(() => {
    const total = customers.length
    const activeRows = customers.filter((c) => c.is_active !== false)
    const active = activeRows.length
    const ready = activeRows.filter((c) => customerChallanStatus(c).ready).length
    const withGst = activeRows.filter((c) => compact(c.gst_no || c.tax_id)).length
    const perfRows: any[] = Array.isArray((customer360 as any)?.rows) ? (customer360 as any).rows : []
    const otifAvg = perfRows.length ? perfRows.reduce((sum, r) => sum + Number(r.otif_percent || 0), 0) / perfRows.length : 0
    const atRisk = activeRows.filter((c) => ["watch", "critical"].includes(lookupPerf(c)?.risk)).length
    const openAr = activeRows.reduce((sum, c) => sum + Number(lookupPerf(c)?.open_value || 0), 0)
    return { total, active, inactive: total - active, ready, withGst, otifAvg, hasPerf: perfRows.length > 0, atRisk, openAr }
  }, [customers, customer360, lookupPerf])
  // Counts are worked out from the loaded list only; before it arrives (or if it fails) the page says so
  // instead of showing "0 ready for challan · Every active customer has one".
  const listState: "loading" | "error" | "ready" = Array.isArray(customersQuery.data)
    ? "ready"
    : customersQuery.isError
      ? "error"
      : "loading"

  const fieldErrors = useMemo(() => customerFormErrors(form), [form])
  const saving = createCustomer.isPending || createContact.isPending || updateCustomer.isPending

  const openCreate = () => {
    setForm(emptyCustomerForm())
    setEditingId(null)
    setFormError(null)
    setShowFieldErrors(false)
    setFormMode("create")
  }

  const openEdit = (customer: Customer) => {
    setSelectedId(customer.id)
    setEditingId(customer.id)
    setForm(formFromCustomer(customer))
    setFormError(null)
    setShowFieldErrors(false)
    setFormMode("edit")
  }

  // /masters/customers?edit=<id> opens that customer's form (the challan links here when details are missing).
  const editParam = searchParams?.get("edit") || ""
  const openedFromLink = useRef<string | null>(null)
  const formDialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!editParam || openedFromLink.current === editParam || !customers.length) return
    const customer = customers.find((c) => c.id === editParam || compact(c.customer_code).toUpperCase() === editParam.toUpperCase())
    if (!customer) return
    openedFromLink.current = editParam
    setStatusFilter("ALL")
    setSelectedId(customer.id)
    setEditingId(customer.id)
    setForm(formFromCustomer(customer))
    setFormError(null)
    setShowFieldErrors(false)
    setFormMode("edit")
  }, [editParam, customers])

  const closeForm = () => {
    setFormMode(null)
    setFormError(null)
    if (editParam) router.replace("/masters/customers")
  }

  const submitForm = async () => {
    setFormError(null)
    if (!compact(form.customer_code)) {
      setFormError("Customer code is required.")
      return
    }
    if (!compact(form.name)) {
      setFormError("Customer name is required.")
      return
    }
    const problems = Object.values(fieldErrors)
    if (problems.length) {
      setShowFieldErrors(true)
      // Each message shows once, under its field; the summary only counts them.
      setFormError(`Fix the ${problems.length === 1 ? "marked field" : `${problems.length} marked fields`} before saving.`)
      window.requestAnimationFrame(() => (document.querySelector('[data-testid="customer-form"] [aria-invalid="true"]') as HTMLElement | null)?.focus())
      return
    }
    const body = payloadFromCustomerForm(form)
    try {
      if (formMode === "edit" && editingId) {
        await updateCustomer.mutateAsync({ id: editingId, data: body })
        showToast("Customer saved. Challans not sealed yet use the new details.", "success")
      } else {
        const created = await createCustomer.mutateAsync(body)
        const customerId = (created as any)?.data?.id || (created as any)?.id
        // The main contact also starts the customer's contact list (more people can be added there).
        if (customerId && compact(form.primary_contact_name)) {
          await createContact.mutateAsync({
            customerId,
            data: {
              contact_name: form.primary_contact_name.trim(),
              contact_phone: form.primary_contact_phone.trim() || undefined,
              contact_email: form.primary_contact_email.trim() || undefined,
            },
          })
        }
        if (customerId) setSelectedId(customerId)
        showToast("Customer created", "success")
      }
      closeForm()
    } catch (err) {
      setFormError(errorMessage(err))
    }
  }

  const runConfirm = async () => {
    if (!selectedCustomer) return
    setConfirmBusy(true)
    try {
      if (confirmKind === "deactivate") {
        await updateCustomer.mutateAsync({ id: selectedCustomer.id, data: { is_active: false } })
        showToast("Customer deactivated", "success")
      } else if (confirmKind === "delete") {
        await deleteCustomer.mutateAsync(selectedCustomer.id)
        setSelectedId(null)
        showToast("Customer deleted", "success")
      }
      setConfirmKind(null)
    } catch (err) {
      showToast(errorMessage(err), "error")
    } finally {
      setConfirmBusy(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = (on: boolean) => {
    if (on) setSelection(new Set(filteredCustomers.map((c) => c.id)))
    else setSelection(new Set())
  }

  const bulkSetActive = async (active: boolean) => {
    if (!selection.size) return
    try {
      await Promise.all(Array.from(selection).map((id) => updateCustomer.mutateAsync({ id, data: { is_active: active } })))
      showToast(`${active ? "Activated" : "Deactivated"} ${selection.size} customers`, "success")
      setSelection(new Set())
    } catch (err) {
      showToast(errorMessage(err), "error")
    }
  }

  const exportFilteredCsv = () => {
    if (!filteredCustomers.length) {
      showToast("No customers to export", "info")
      return
    }
    const header = [
      "code", "name", "category", "gstin", "pan", "billing_address", "billing_city", "billing_state", "billing_pin",
      "dispatch_address", "contact_person", "phone", "email", "dispatch_contact", "dispatch_phone", "credit_limit", "payment_terms", "is_active",
    ]
    const rows = filteredCustomers.map((c) => {
      const status = customerChallanStatus(c)
      return [
        c.customer_code || "", c.name || "", c.category || "", c.gst_no || "", c.pan_no || "",
        (c.billing_address || c.address || "").replace(/\s+/g, " "), c.billing_city || "", c.billing_state || "", c.billing_pin_code || "",
        status.dispatchAddress, c.primary_contact_name || "", c.primary_contact_phone || "", c.primary_contact_email || "",
        c.dispatch_contact_name || "", c.dispatch_contact_phone || "",
        c.credit_limit != null ? String(c.credit_limit) : "", c.payment_terms || "", c.is_active === false ? "no" : "yes",
      ]
    })
    const csv = [header, ...rows]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const challanPill = (c: Customer) => customerChallanStatus(c).ready
    ? <Pill tone="ok"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Ready</Pill>
    : <Pill tone="warn"><AlertTriangle className="h-3 w-3" aria-hidden="true" />No dispatch address</Pill>

  const riskPill = (r: Customer) => {
    const perf = lookupPerf(r)
    if (perf?.risk === "critical") return <Pill tone="critical">Many late</Pill>
    if (perf?.risk === "watch") return <Pill tone="warn">Some late</Pill>
    if (perf) return <Pill tone="ok">None</Pill>
    return <span className="text-[11px] text-muted-foreground">—</span>
  }
  const otifPill = (r: Customer) => {
    const perf = lookupPerf(r)
    if (!perf) return <span className="text-[11px] text-muted-foreground">—</span>
    const otif = Number(perf.otif_percent || 0)
    return <Pill tone={otif >= 92 ? "ok" : otif >= 80 ? "warn" : "critical"}>{otif.toFixed(0)}%</Pill>
  }
  // With a customer open beside the list (desktop), the list keeps the columns that fit;
  // GSTIN moves under the name and open orders stay in the detail panel.
  const narrow = Boolean(selectedCustomer)

  const columns: GridColumn<Customer>[] = [
    {
      key: "name",
      label: "Customer",
      sortAccessor: (r) => r.name || "",
      render: (r) => (
        <div className="min-w-0 max-w-[300px]">
          <div className="truncate font-mono text-[11px] text-muted-foreground">{r.customer_code || "—"}</div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{r.name || "—"}</span>
            {r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : null}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{[dispatchPlace(r) || compact(r.address), contactLine(r)].filter(Boolean).join(" · ") || "No address yet"}</div>
          {narrow ? <div className="truncate text-[11px] text-muted-foreground">GSTIN <span className="font-mono text-foreground">{r.gst_no || "not given"}</span></div> : null}
          <div className="mt-1">{challanPill(r)}</div>
        </div>
      ),
    },
    ...(narrow ? [] : [{
      key: "gst_no",
      label: "GSTIN",
      width: "140px",
      sortAccessor: (r: Customer) => r.gst_no || "",
      render: (r: Customer) => r.gst_no ? <span className="font-mono text-xs text-foreground">{r.gst_no}</span> : <span className="text-[11px] text-muted-foreground">Not given</span>,
    }]),
    {
      key: "risk",
      label: "Late orders",
      width: "104px",
      sortAccessor: (r) => {
        const risk = lookupPerf(r)?.risk
        return risk === "critical" ? 0 : risk === "watch" ? 1 : 2
      },
      // The chip stays on one line ("Some late" broke in two at 1280 with the sidebar open).
      render: (r) => <span className="inline-flex whitespace-nowrap">{riskPill(r)}</span>,
    },
    ...(narrow ? [] : [
      {
        key: "open_orders",
        label: "Open",
        width: "64px",
        align: "right" as const,
        sortAccessor: (r: Customer) => Number(lookupPerf(r)?.orders_open || 0),
        render: (r: Customer) => <span className="font-semibold text-foreground">{lookupPerf(r)?.orders_open ?? 0}</span>,
      },
      {
        key: "outstanding",
        label: "Open ₹",
        width: "96px",
        align: "right" as const,
        sortAccessor: (r: Customer) => Number(lookupPerf(r)?.open_value || 0),
        render: (r: Customer) => <span className="font-semibold text-foreground">{fmtINR(Number(lookupPerf(r)?.open_value || 0))}</span>,
      },
    ]),
    {
      key: "otif",
      label: "On time",
      width: "72px",
      align: "right",
      sortAccessor: (r) => Number(lookupPerf(r)?.otif_percent || 0),
      render: otifPill,
    },
    {
      key: "edit",
      label: "",
      width: "76px",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openEdit(r) }}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground hover:border-signal-emerald-line hover:text-signal-emerald-ink"
          aria-label={`Edit ${r.name}`}
          data-testid={`customer-row-edit-${r.customer_code}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit
        </button>
      ),
    },
  ]

  const selectOnPhone = (id: string) => {
    setSelectedId(id)
    window.requestAnimationFrame(() => drawerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  return (
    <CockpitShell
      hero={
        <MasterHero
          eyebrow={
            listState === "ready"
              ? `Parties · ${kpis.active} active · ${kpis.ready} ready for challan`
              : listState === "loading"
                ? "Parties · loading…"
                : "Parties · list not loaded"
          }
          title="Customers"
          description="GSTIN, billing address and dispatch (ship-to) address with state and PIN, plus contacts. The delivery challan prints these from here, so keep them up to date. Use Edit on any row."
          accent="emerald"
          chips={(listState === "ready"
            ? [
                { label: `${kpis.total} total`, tone: "neutral" },
                { label: `${kpis.active} active`, tone: "ok" },
                kpis.active - kpis.ready ? { label: `${kpis.active - kpis.ready} without dispatch address`, tone: "warn" } : null,
                kpis.atRisk ? { label: `${kpis.atRisk} with late or delayed orders`, tone: "warn" } : null,
                kpis.openAr ? { label: `${fmtINR(kpis.openAr)} open orders`, tone: "neutral" } : null,
                { label: "Owner / Admin can edit", tone: "neutral" },
              ]
            : [
                listState === "loading"
                  ? { label: "Loading customers…", tone: "neutral" }
                  : { label: "Could not load customers", tone: "critical" },
                { label: "Owner / Admin can edit", tone: "neutral" },
              ]
          ).filter(Boolean) as any}
        />
      }
      kpis={
        listState !== "ready" ? (
          <>
            {["Active customers", "Ready for challan", "With GSTIN", "Delivered on time (30 days)"].map((label) => (
              <KpiTile
                key={label}
                label={label}
                value="—"
                tone="slate"
                detail={listState === "loading" ? "Loading customers…" : "Not available until the list loads"}
              />
            ))}
          </>
        ) : (
          <>
            <KpiTile label="Active customers" value={String(kpis.active)} tone="emerald" detail={`${kpis.inactive} inactive`} />
            <KpiTile
              label="Ready for challan"
              value={String(kpis.ready)}
              tone={kpis.active === 0 ? "slate" : kpis.ready === kpis.active ? "emerald" : "amber"}
              detail={kpis.active === 0 ? "No active customers yet" : kpis.active - kpis.ready ? `${kpis.active - kpis.ready} need a dispatch address` : "Every active customer has one"}
            />
            <KpiTile
              label="With GSTIN"
              value={String(kpis.withGst)}
              tone={kpis.active === 0 ? "slate" : "violet"}
              detail={kpis.active === 0 ? "No active customers yet" : kpis.active - kpis.withGst ? `${kpis.active - kpis.withGst} active without GSTIN` : "Every active customer has one"}
            />
            <KpiTile
              label="Delivered on time (30 days)"
              value={kpis.hasPerf ? `${kpis.otifAvg.toFixed(1)}%` : "—"}
              tone={!kpis.hasPerf ? "slate" : kpis.otifAvg >= 92 ? "emerald" : "rose"}
              detail={kpis.hasPerf ? "Average share of orders delivered in full and on time" : "No delivery figures for the last 30 days yet"}
            />
          </>
        )
      }
      filters={
        <>
          <FilterField label="Search" stackOnPhone>
            <SearchField value={search} onChange={setSearch} placeholder="name, code, GSTIN, city, contact…" fullWidthOnPhone />
          </FilterField>
          <FilterField label="Category" stackOnPhone>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={filterSelect}>
              <option value="ALL">All</option>
              {CUSTOMER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FilterField>
          <FilterField label="Challan" stackOnPhone>
            <select value={challanFilter} onChange={(e) => setChallanFilter(e.target.value as any)} className={filterSelect} data-testid="customer-challan-filter">
              <option value="ALL">All</option>
              <option value="MISSING">Dispatch address missing</option>
              <option value="READY">Ready</option>
            </select>
          </FilterField>
          <FilterField label="Late orders" stackOnPhone>
            <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as any)} className={filterSelect} data-testid="customer-risk-filter">
              <option value="all">All</option>
              <option value="watch">Any late or delayed order</option>
              <option value="critical">Many late orders</option>
            </select>
          </FilterField>
          <FilterField label="Status" stackOnPhone>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className={filterSelect}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALL">All</option>
            </select>
          </FilterField>
          <span className="ml-auto" />
          <button type="button" onClick={exportFilteredCsv} className={`${actionBtn} border-border bg-card text-muted-foreground hover:border-signal-emerald-line hover:text-signal-emerald-ink`}>
            Export CSV
          </button>
          <button type="button" onClick={openCreate} className={`${actionBtn} border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/90`} data-testid="customer-new">
            + New customer
          </button>
        </>
      }
    >
      <div className={`grid gap-4 ${selectedCustomer ? "xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]" : ""}`}>
        <div className="min-w-0 space-y-3" data-testid="customers-grid-region">
          <div className="hidden md:block">
            <DataGrid<Customer>
              columns={columns}
              rows={filteredCustomers}
              selectedId={selectedId}
              onSelect={(r) => setSelectedId(r.id)}
              selection={selection}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              emptyHint={
                listState === "loading"
                  ? "Loading customers…"
                  : listState === "error"
                    ? "Could not load customers. Refresh the page to try again."
                    : customers.length === 0
                    ? "No customers yet — click + New customer to add one."
                    : "No customers match the current filters."
              }
            />
          </div>
          {/* Phone: one card per customer with the details the challan needs and an Edit button. */}
          <ul className="space-y-2 md:hidden" data-testid="customer-cards">
            {filteredCustomers.map((c) => {
              const status = customerChallanStatus(c)
              return (
                <li key={c.id} className={`rounded-xl border bg-card p-3 ${selectedId === c.id ? "border-signal-emerald-line" : "border-border"}`}>
                  <button type="button" className="block w-full min-w-0 text-left" onClick={() => selectOnPhone(c.id)}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-muted-foreground">{c.customer_code}</span>
                        <span className="block break-words text-sm font-semibold text-foreground">{c.name}</span>
                      </span>
                      {challanPill(c)}
                    </span>
                    <span className="mt-1.5 block text-xs text-muted-foreground">GSTIN <span className="font-mono text-foreground">{c.gst_no || "not given"}</span></span>
                    <span className="mt-0.5 block break-words text-xs text-muted-foreground">Dispatch to: <span className="text-foreground">{status.dispatchAddress || "missing"}</span></span>
                    {contactLine(c) ? <span className="mt-0.5 block text-xs text-muted-foreground">{contactLine(c)}</span> : null}
                  </button>
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" className="min-h-11" onClick={() => openEdit(c)} data-testid={`customer-card-edit-${c.customer_code}`}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>
                  </div>
                </li>
              )
            })}
            {!filteredCustomers.length ? <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{listState === "loading" ? "Loading customers…" : listState === "error" ? "Could not load customers. Refresh the page to try again." : customers.length === 0 ? "No customers yet — tap + New customer to add one." : "No customers match the current filters."}</li> : null}
          </ul>
          {selection.size ? (
            <div className="hidden flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-xs md:flex">
              <span className="font-semibold text-muted-foreground">{selection.size} selected</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => bulkSetActive(true)} className={`${actionBtn} border-border bg-card text-muted-foreground hover:border-signal-emerald-line hover:text-signal-emerald-ink`}>Activate</button>
                <button type="button" onClick={() => bulkSetActive(false)} className={`${actionBtn} border-border bg-card text-muted-foreground hover:border-signal-amber-line hover:text-signal-amber-ink`}>Deactivate</button>
                <button type="button" onClick={() => setSelection(new Set())} className={`${actionBtn} border-border bg-card text-muted-foreground hover:border-input`}>Clear</button>
              </span>
            </div>
          ) : null}
          <p className={listState === "ready" ? "px-1 text-[11px] text-muted-foreground" : "hidden"}>
            Showing {filteredCustomers.length} of {customers.length} customers
            {selection.size ? ` · ${selection.size} selected` : ""}.
            {selectedCustomer ? "" : " Select a customer to see its addresses, contacts and performance."}
          </p>
        </div>

        <div ref={drawerRef} className={selectedCustomer ? "min-w-0 scroll-mt-20" : "hidden"}>
        <DetailDrawer
          open={Boolean(selectedCustomer)}
          onClose={() => setSelectedId(null)}
          title={selectedCustomer?.name || "—"}
          subtitle={selectedCustomer ? `${selectedCustomer.customer_code || "no code"} · ${selectedCustomer.category || "uncategorised"}` : undefined}
          accent="emerald"
          chips={selectedCustomer ? [
            selectedCustomer.is_active === false ? { label: "INACTIVE", tone: "warn" as const } : { label: "ACTIVE", tone: "ok" as const },
            customerChallanStatus(selectedCustomer).ready ? { label: "READY FOR CHALLAN", tone: "ok" as const } : { label: "NO DISPATCH ADDRESS", tone: "warn" as const },
            selectedCustomer.gst_no ? { label: "GSTIN GIVEN", tone: "ok" as const } : { label: "NO GSTIN", tone: "warn" as const },
          ] : []}
          tabs={selectedCustomer ? [
            {
              key: "overview",
              label: "Overview",
              content: <CustomerOverview customer={selectedCustomer} />,
            },
            {
              key: "contacts",
              label: "Contacts",
              count: contacts.length,
              content: (
                <ContactList
                  contacts={contacts as any}
                  loading={contactsQuery.isLoading}
                  busy={createContact.isPending || updateContact.isPending || deleteContact.isPending}
                  onAdd={async (data) => {
                    await createContact.mutateAsync({ customerId: selectedCustomer.id, data })
                  }}
                  onUpdate={async (contactId, data) => {
                    await updateContact.mutateAsync({ customerId: selectedCustomer.id, contactId, data })
                  }}
                  onDelete={async (contactId) => {
                    await deleteContact.mutateAsync({ customerId: selectedCustomer.id, contactId })
                  }}
                  onMakePrimary={async (contactId) => {
                    await Promise.all(
                      (contacts as any[]).map((c: any) =>
                        updateContact.mutateAsync({
                          customerId: selectedCustomer.id,
                          contactId: c.id,
                          data: { is_primary: c.id === contactId },
                        }),
                      ),
                    )
                  }}
                />
              ),
            },
            {
              key: "performance",
              label: "Performance",
              content: (
                <div className="space-y-3">
                  {selectedPerf ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <PerfCard label="Delivered on time" value={`${Number(selectedPerf.otif_percent || 0).toFixed(0)}%`} tone={Number(selectedPerf.otif_percent || 0) >= 92 ? "ok" : "warn"} />
                        <PerfCard label="Open ₹" value={fmtINR(Number(selectedPerf.open_value || 0))} tone="warn" />
                        <PerfCard label="Dispatched ₹" value={fmtINR(Number(selectedPerf.dispatched_value || 0))} tone="ok" />
                        <PerfCard label="Open orders" value={String(selectedPerf.orders_open || 0)} tone="neutral" />
                        <PerfCard label="Closed orders" value={String(selectedPerf.orders_closed || 0)} tone="ok" />
                        <PerfCard label="Delayed" value={String(selectedPerf.orders_delayed || 0)} tone={Number(selectedPerf.orders_delayed || 0) > 0 ? "critical" : "ok"} />
                      </div>
                      <Link href={`/reports/customer-360?customer=${encodeURIComponent(selectedCustomer.id)}`} className="inline-flex min-h-11 items-center text-xs font-semibold text-signal-emerald-ink hover:underline sm:min-h-0">
                        Open full customer-360 →
                      </Link>
                    </>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border bg-muted px-3 py-4 text-center text-[11px] text-muted-foreground">
                      No 30-day customer-360 data yet — performance shows once orders flow through.
                    </p>
                  )}
                </div>
              ),
            },
          ] : []}
          footer={selectedCustomer ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedCustomer.is_active === false ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await updateCustomer.mutateAsync({ id: selectedCustomer.id, data: { is_active: true } })
                      showToast("Customer reactivated", "success")
                    } catch (err) {
                      showToast(errorMessage(err), "error")
                    }
                  }}
                  className={`${actionBtn} border-signal-emerald-line bg-card text-signal-emerald-ink hover:bg-signal-emerald-soft`}
                >
                  Reactivate
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmKind("deactivate")} className={`${actionBtn} border-signal-amber-line bg-card text-signal-amber-ink hover:bg-signal-amber-soft`}>
                  Deactivate
                </button>
              )}
              <button type="button" onClick={() => setConfirmKind("delete")} className={`${actionBtn} border-signal-rose-line bg-card text-signal-rose-ink hover:bg-signal-rose-soft`}>
                Delete
              </button>
              <button type="button" onClick={() => openEdit(selectedCustomer)} className={`${actionBtn} border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/90`} data-testid="customer-edit">
                Edit customer
              </button>
            </div>
          ) : null}
        />
        </div>
      </div>

      <Dialog open={formMode !== null} onOpenChange={(next) => { if (!next) closeForm() }}>
        {/* The form scrolls between a fixed header and a fixed footer, so Save stays in view on a phone (same as the
            vendor dialog). Editing opens on the dialog itself, not inside Code with its text selected: the first key
            press must not replace the customer code (checker round 4, 28 Oct). cn() only joins classes, so the
            dialog's own "grid gap-4 p-6 overflow:auto" is overridden with "!". */}
        <DialogContent
          ref={formDialogRef}
          className="max-h-[92dvh] max-w-2xl !flex !flex-col !gap-0 !overflow-hidden !p-0 focus:outline-none"
          onOpenAutoFocus={(event) => {
            if (formMode !== "edit") return
            event.preventDefault()
            formDialogRef.current?.focus()
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pr-14 pt-6">
            <DialogTitle>{formMode === "edit" ? `Edit ${form.name || "customer"}` : "New customer"}</DialogTitle>
            <DialogDescription>Only code and name are required. GSTIN and the dispatch address print on the delivery challan.</DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void submitForm() }}>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4" data-testid="customer-form-body">
            <CustomerFormFields
              form={form}
              setForm={setForm}
              errors={showFieldErrors ? fieldErrors : {}}
              sameGstin={customers.find((c) => c.gst_no && c.gst_no === form.gst_no.replace(/\s+/g, "").toUpperCase() && c.id !== editingId) || null}
            />
            {formError ? (
              <p role="alert" data-no-mirror className="mt-4 flex items-start gap-1.5 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm font-medium text-signal-rose-ink" data-testid="customer-form-error">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {formError}
              </p>
            ) : null}
            </div>
            <DialogFooter className="shrink-0 border-t border-border bg-muted/70 px-6 py-3" data-testid="customer-form-footer">
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={closeForm}>Cancel</Button>
              <Button type="submit" className="min-h-11 sm:min-h-0" disabled={saving} data-testid="customer-save">
                {saving ? "Saving…" : formMode === "edit" ? "Save customer" : "Create customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmKind === "deactivate"}
        title="Deactivate customer?"
        body={
          <>
            <strong>{selectedCustomer?.name}</strong> will be hidden from active lists. Existing orders and invoices are preserved. You can reactivate any time.
          </>
        }
        confirmLabel="Deactivate"
        tone="warn"
        busy={confirmBusy}
        onClose={() => setConfirmKind(null)}
        onConfirm={runConfirm}
      />
      <ConfirmDialog
        open={confirmKind === "delete"}
        title="Delete customer?"
        body={
          <>
            <strong>{selectedCustomer?.name}</strong> will be permanently removed. This cannot be undone. If open orders exist, the backend will reject the delete and you should deactivate instead.
          </>
        }
        confirmLabel="Delete customer"
        tone="critical"
        busy={confirmBusy}
        onClose={() => setConfirmKind(null)}
        onConfirm={runConfirm}
      />
    </CockpitShell>
  )
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading customers…</div>}>
      <CustomersBody />
    </Suspense>
  )
}

function CustomerOverview({ customer }: { customer: Customer }) {
  const status = customerChallanStatus(customer)
  const state = (name?: string | null, code?: string | null) => (name ? `${name}${code ? ` (${code})` : ""}` : "—")
  const separate = status.dispatchAddress && status.dispatchAddress !== status.billingAddress
  return (
    <div className="space-y-4" data-testid="customer-overview">
      {!status.ready ? (
        <p className="flex items-start gap-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-xs text-signal-amber-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />No dispatch address: a delivery challan for this customer cannot be sealed. Use Edit customer to add it.
        </p>
      ) : null}
      <OverviewGroup title="Tax">
        <FieldRow label="GSTIN" value={customer.gst_no ? <span className="font-mono text-xs">{customer.gst_no}</span> : <span className="text-muted-foreground">Not given</span>} />
        <FieldRow label="PAN" value={<span className="font-mono text-xs">{customer.pan_no || "—"}</span>} />
      </OverviewGroup>
      <OverviewGroup title="Billing address">
        <FieldRow label="Address" value={status.billingAddress || "—"} />
        <FieldRow label="State" value={state(customer.billing_state, customer.billing_state_code)} />
      </OverviewGroup>
      <OverviewGroup title="Dispatch (ship-to) address">
        <FieldRow label="Address" value={status.dispatchAddress ? (separate ? status.dispatchAddress : <>Same as billing<span className="block text-xs text-muted-foreground">{status.dispatchAddress}</span></>) : <span className="font-semibold text-signal-amber-ink">Missing</span>} />
        <FieldRow label="Contact" value={[customer.dispatch_contact_name, customer.dispatch_contact_phone].filter(Boolean).join(" · ") || "—"} />
      </OverviewGroup>
      <OverviewGroup title="Main contact">
        <FieldRow label="Person" value={customer.primary_contact_name || "—"} />
        <FieldRow label="Phone" value={customer.primary_contact_phone || "—"} />
        <FieldRow label="Email" value={customer.primary_contact_email || "—"} />
      </OverviewGroup>
      <OverviewGroup title="Payment">
        <FieldRow label="Credit limit" value={customer.credit_limit != null ? `₹${Number(customer.credit_limit).toLocaleString("en-IN")}` : "—"} />
        <FieldRow label="Payment terms" value={customer.payment_terms || "—"} />
      </OverviewGroup>
      <FieldRow label="Status" value={customer.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill>} />
    </div>
  )
}

function OverviewGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border pb-3 last:border-b-0">
      <h3 className="text-[11.5px] font-semibold text-signal-emerald-ink">{title}</h3>
      {children}
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-sm">
      <span className="text-[11.5px] font-semibold text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  )
}

function PerfCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "ok" | "warn" | "critical" | "neutral" }) {
  const cls =
    tone === "ok"
      ? "border-signal-emerald-line bg-signal-emerald-soft"
      : tone === "warn"
        ? "border-signal-amber-line bg-signal-amber-soft"
        : tone === "critical"
          ? "border-signal-rose-line bg-signal-rose-soft"
          : "border-border bg-muted"
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <p className="text-[11.5px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-bold text-foreground">{value}</p>
    </div>
  )
}
