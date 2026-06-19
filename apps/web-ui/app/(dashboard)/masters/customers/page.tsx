"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"

import { useApp } from "@/context/AppContext"
import {
  CockpitShell,
  ConfirmDialog,
  ContactList,
  DataGrid,
  DetailDrawer,
  FilterField,
  KpiTile,
  LabeledInput,
  LabeledTextarea,
  MasterHero,
  Modal,
  Pill,
  SearchField,
  type GridColumn,
} from "@/components/master/master-cockpit"
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

type Customer = {
  id: string
  customer_code?: string
  name?: string
  gst_no?: string
  pan_no?: string
  address?: string
  category?: string
  is_active?: boolean
  credit_limit?: number | null
  payment_terms?: string | null
}

const CUSTOMER_CATEGORIES = ["Wholesale (B2B)", "Retail", "Distributor", "Export", "Other"] as const

function errorMessage(err: any) {
  return err?.response?.data?.detail || err?.response?.data?.message || err?.message || "Action failed"
}
function compact(v: unknown) {
  return String(v || "").trim()
}
function fmtINR(value?: number | null) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0) return "₹—"
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(n)
}
function matchesSearch(row: Customer, needle: string) {
  if (!needle) return true
  return [row.customer_code, row.name, row.gst_no, row.pan_no, row.address, row.category]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}

export default function CustomersPage() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const customersQuery = useCustomers()
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
  const [riskFilter, setRiskFilter] = useState<"all" | "watch" | "critical">("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    customer_code: "",
    name: "",
    category: "",
    gst_no: "",
    pan_no: "",
    address: "",
    credit_limit: "",
    payment_terms: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
  })
  const [createError, setCreateError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Customer>({ id: "" })
  const [editError, setEditError] = useState<string | null>(null)

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
      if (riskFilter !== "all") {
        const perf = lookupPerf(c)
        const risk = String(perf?.risk || "ok").toLowerCase()
        if (riskFilter === "watch" && risk !== "watch" && risk !== "critical") return false
        if (riskFilter === "critical" && risk !== "critical") return false
      }
      return true
    })
  }, [customers, search, categoryFilter, statusFilter, riskFilter, lookupPerf])

  const selectedCustomer = customers.find((c) => c.id === selectedId) || null
  const contactsQuery = useCustomerContacts(selectedId)
  const contacts = Array.isArray(contactsQuery.data) ? contactsQuery.data : []
  const selectedPerf = selectedCustomer ? lookupPerf(selectedCustomer) : undefined

  const kpis = useMemo(() => {
    const total = customers.length
    const active = customers.filter((c) => c.is_active !== false).length
    const inactive = total - active
    const perfRows: any[] = Array.isArray((customer360 as any)?.rows) ? (customer360 as any).rows : []
    const openAr = perfRows.reduce((sum, r) => sum + Number(r.open_value || 0), 0)
    const atRisk = perfRows.filter((r) => r.risk === "critical" || r.risk === "watch").length
    const otifAvg = perfRows.length
      ? perfRows.reduce((sum, r) => sum + Number(r.otif_percent || 0), 0) / perfRows.length
      : 0
    return { total, active, inactive, openAr, atRisk, otifAvg }
  }, [customers, customer360])

  const resetCreate = () => {
    setCreateForm({
      customer_code: "",
      name: "",
      category: "",
      gst_no: "",
      pan_no: "",
      address: "",
      credit_limit: "",
      payment_terms: "",
      contact_name: "",
      contact_phone: "",
      contact_email: "",
    })
    setCreateError(null)
  }

  const submitCreate = async () => {
    setCreateError(null)
    if (!compact(createForm.customer_code)) {
      setCreateError("Customer code is required.")
      return
    }
    if (!compact(createForm.name)) {
      setCreateError("Customer name is required.")
      return
    }
    try {
      const created = await createCustomer.mutateAsync({
        customer_code: createForm.customer_code.trim(),
        name: createForm.name.trim(),
        gst_no: createForm.gst_no.trim() || undefined,
        pan_no: createForm.pan_no.trim() || undefined,
        address: createForm.address.trim() || undefined,
        category: createForm.category.trim() || undefined,
        credit_limit: createForm.credit_limit ? Number(createForm.credit_limit) : undefined,
        payment_terms: createForm.payment_terms.trim() || undefined,
      })
      const customerId = (created as any)?.data?.id || (created as any)?.id
      if (customerId && compact(createForm.contact_name)) {
        await createContact.mutateAsync({
          customerId,
          data: {
            contact_name: createForm.contact_name.trim(),
            contact_phone: createForm.contact_phone.trim() || undefined,
            contact_email: createForm.contact_email.trim() || undefined,
          },
        })
      }
      if (customerId) setSelectedId(customerId)
      setCreateOpen(false)
      resetCreate()
      showToast("Customer created", "success")
    } catch (err) {
      setCreateError(errorMessage(err))
    }
  }

  const startEdit = () => {
    if (!selectedCustomer) return
    setEditForm({ ...selectedCustomer })
    setEditError(null)
    setEditOpen(true)
  }

  const submitEdit = async () => {
    setEditError(null)
    if (!compact(editForm.customer_code)) {
      setEditError("Customer code is required.")
      return
    }
    if (!compact(editForm.name)) {
      setEditError("Customer name is required.")
      return
    }
    try {
      await updateCustomer.mutateAsync({
        id: editForm.id,
        data: {
          customer_code: editForm.customer_code?.trim(),
          name: editForm.name?.trim(),
          gst_no: editForm.gst_no?.trim() || undefined,
          pan_no: editForm.pan_no?.trim() || undefined,
          address: editForm.address?.trim() || undefined,
          category: editForm.category?.trim() || undefined,
          credit_limit: editForm.credit_limit ?? undefined,
          payment_terms: editForm.payment_terms || undefined,
        },
      })
      setEditOpen(false)
      showToast("Customer updated", "success")
    } catch (err) {
      setEditError(errorMessage(err))
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

  const bulkActivate = async () => {
    if (!selection.size) return
    try {
      await Promise.all(Array.from(selection).map((id) => updateCustomer.mutateAsync({ id, data: { is_active: true } })))
      setSelection(new Set())
      showToast(`Activated ${selection.size} customers`, "success")
    } catch (err) {
      showToast(errorMessage(err), "error")
    }
  }
  const bulkDeactivate = async () => {
    if (!selection.size) return
    try {
      await Promise.all(Array.from(selection).map((id) => updateCustomer.mutateAsync({ id, data: { is_active: false } })))
      setSelection(new Set())
      showToast(`Deactivated ${selection.size} customers`, "success")
    } catch (err) {
      showToast(errorMessage(err), "error")
    }
  }

  const exportFilteredCsv = () => {
    if (!filteredCustomers.length) {
      showToast("No customers to export", "info")
      return
    }
    const header = ["code", "name", "category", "gst", "pan", "address", "credit_limit", "payment_terms", "is_active"]
    const rows = filteredCustomers.map((c) => [
      c.customer_code || "",
      c.name || "",
      c.category || "",
      c.gst_no || "",
      c.pan_no || "",
      (c.address || "").replace(/\s+/g, " "),
      c.credit_limit != null ? String(c.credit_limit) : "",
      c.payment_terms || "",
      c.is_active === false ? "no" : "yes",
    ])
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

  const columns: GridColumn<Customer>[] = [
    {
      key: "customer_code",
      label: "Code",
      width: "140px",
      sortAccessor: (r) => r.customer_code || "",
      render: (r) => <span className="font-mono text-xs text-slate-700">{r.customer_code || "—"}</span>,
    },
    {
      key: "name",
      label: "Name",
      sortAccessor: (r) => r.name || "",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{r.name || "—"}</div>
          <div className="truncate text-[11px] text-slate-500">{r.address || "—"}</div>
        </div>
      ),
    },
    {
      key: "risk",
      label: "Risk",
      width: "90px",
      sortAccessor: (r) => {
        const perf = lookupPerf(r)
        return perf?.risk === "critical" ? 0 : perf?.risk === "watch" ? 1 : 2
      },
      render: (r) => {
        const perf = lookupPerf(r)
        const risk = perf?.risk
        if (risk === "critical") return <Pill tone="critical">Critical</Pill>
        if (risk === "watch") return <Pill tone="warn">Watch</Pill>
        if (perf) return <Pill tone="ok">OK</Pill>
        return <span className="text-[11px] text-slate-400">—</span>
      },
    },
    {
      key: "open_orders",
      label: "Open",
      width: "70px",
      align: "right",
      sortAccessor: (r) => Number(lookupPerf(r)?.orders_open || 0),
      render: (r) => {
        const perf = lookupPerf(r)
        return <span className="font-semibold text-slate-800">{perf?.orders_open ?? 0}</span>
      },
    },
    {
      key: "outstanding",
      label: "Open ₹",
      width: "110px",
      align: "right",
      sortAccessor: (r) => Number(lookupPerf(r)?.open_value || 0),
      render: (r) => {
        const perf = lookupPerf(r)
        const v = Number(perf?.open_value || 0)
        return <span className="font-semibold text-slate-900">{fmtINR(v)}</span>
      },
    },
    {
      key: "otif",
      label: "OTIF",
      width: "85px",
      align: "right",
      sortAccessor: (r) => Number(lookupPerf(r)?.otif_percent || 0),
      render: (r) => {
        const perf = lookupPerf(r)
        const otif = Number(perf?.otif_percent || 0)
        if (!perf) return <span className="text-[11px] text-slate-400">—</span>
        const tone = otif >= 92 ? "ok" : otif >= 80 ? "warn" : "critical"
        return <Pill tone={tone}>{otif.toFixed(0)}%</Pill>
      },
    },
    {
      key: "is_active",
      label: "Status",
      width: "100px",
      sortAccessor: (r) => (r.is_active === false ? 0 : 1),
      render: (r) => (r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill>),
    },
  ]

  return (
    <CockpitShell
      hero={
        <MasterHero
          eyebrow="Customer Master · cockpit"
          title={`${kpis.active} active customers · ${fmtINR(kpis.openAr)} open AR`}
          description="Every customer on one cockpit — GST, contacts, addresses, open orders, OTIF, risk, audit. Click any row to open the drawer with full detail and multi-contact management."
          accent="emerald"
          chips={[
            { label: `${kpis.total} total`, tone: "neutral" },
            { label: `${kpis.active} active`, tone: "ok" },
            kpis.atRisk ? { label: `${kpis.atRisk} at risk`, tone: "warn" } : null,
            kpis.otifAvg ? { label: `Avg OTIF ${kpis.otifAvg.toFixed(1)}%`, tone: kpis.otifAvg >= 92 ? "ok" : "warn" } : null,
          ].filter(Boolean) as any}
        />
      }
      kpis={
        <>
          <KpiTile
            label="Active customers"
            value={String(kpis.active)}
            tone="emerald"
            detail={`${kpis.inactive} inactive`}
          />
          <KpiTile
            label="Open AR"
            value={fmtINR(kpis.openAr)}
            tone="amber"
            detail={kpis.openAr ? "Open commercial demand" : "No outstanding tracked"}
          />
          <KpiTile
            label="Avg OTIF (30d)"
            value={kpis.otifAvg ? `${kpis.otifAvg.toFixed(1)}%` : "—"}
            tone={kpis.otifAvg >= 92 ? "emerald" : "rose"}
            detail="From customer-360 feed"
          />
          <KpiTile
            label="At risk"
            value={String(kpis.atRisk)}
            tone={kpis.atRisk ? "rose" : "emerald"}
            detail="Watch + critical"
          />
        </>
      }
      filters={
        <>
          <FilterField label="Search">
            <SearchField value={search} onChange={setSearch} placeholder="name, code, GST, contact…" />
          </FilterField>
          <FilterField label="Category">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
            >
              <option value="ALL">All</option>
              {CUSTOMER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Risk">
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value as any)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
            >
              <option value="all">All</option>
              <option value="watch">Watch + Critical</option>
              <option value="critical">Critical only</option>
            </select>
          </FilterField>
          <FilterField label="Status">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALL">All</option>
            </select>
          </FilterField>
          <span className="ml-auto" />
          <button
            type="button"
            onClick={exportFilteredCsv}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-800"
          >
            ⇡ Export CSV
          </button>
          <button
            type="button"
            onClick={() => {
              resetCreate()
              setCreateOpen(true)
            }}
            className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900"
          >
            + New customer
          </button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]">
        <div className="space-y-3" data-testid="customers-grid-region">
          <DataGrid<Customer>
            columns={columns}
            rows={filteredCustomers}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId(r.id)}
            selection={selection}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            emptyHint={
              customersQuery.isLoading
                ? "Loading customers…"
                : customers.length === 0
                  ? "No customers yet — click + New customer to add one."
                  : "No customers match the current filters."
            }
          />
          {selection.size ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[1.2rem] border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="font-semibold text-slate-700">{selection.size} selected</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={bulkActivate}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                >
                  Activate
                </button>
                <button
                  type="button"
                  onClick={bulkDeactivate}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-amber-300 hover:text-amber-700"
                >
                  Deactivate
                </button>
                <button
                  type="button"
                  onClick={() => setSelection(new Set())}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-400"
                >
                  Clear
                </button>
              </span>
            </div>
          ) : null}
          <p className="px-1 text-[11px] text-slate-500">
            Showing {filteredCustomers.length} of {customers.length} customers
            {selection.size ? ` · ${selection.size} selected` : ""}.
          </p>
        </div>

        <DetailDrawer
          open={Boolean(selectedCustomer)}
          onClose={() => setSelectedId(null)}
          title={selectedCustomer?.name || "—"}
          subtitle={selectedCustomer ? `${selectedCustomer.customer_code || "no code"} · ${selectedCustomer.category || "uncategorised"}` : undefined}
          accent="emerald"
          chips={selectedCustomer ? [
            selectedCustomer.is_active === false ? { label: "INACTIVE", tone: "warn" as const } : { label: "ACTIVE", tone: "ok" as const },
            selectedPerf?.risk === "critical"
              ? { label: "CRITICAL", tone: "critical" as const }
              : selectedPerf?.risk === "watch"
                ? { label: "WATCH", tone: "warn" as const }
                : selectedPerf
                  ? { label: "OK", tone: "ok" as const }
                  : null,
            { label: `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`, tone: "ok" as const },
          ].filter(Boolean) as any[] : []}
          tabs={selectedCustomer ? [
            {
              key: "overview",
              label: "Overview",
              content: (
                <div className="space-y-3">
                  <FieldRow label="Code" value={<span className="font-mono">{selectedCustomer.customer_code || "—"}</span>} />
                  <FieldRow label="Category" value={selectedCustomer.category || "—"} />
                  <FieldRow label="GST" value={<span className="font-mono text-xs">{selectedCustomer.gst_no || "—"}</span>} />
                  <FieldRow label="PAN" value={<span className="font-mono text-xs">{selectedCustomer.pan_no || "—"}</span>} />
                  <FieldRow label="Address" value={selectedCustomer.address || "—"} />
                  <FieldRow
                    label="Credit limit"
                    value={selectedCustomer.credit_limit != null ? fmtINR(Number(selectedCustomer.credit_limit)) : "—"}
                  />
                  <FieldRow label="Payment terms" value={selectedCustomer.payment_terms || "—"} />
                  <FieldRow
                    label="Status"
                    value={selectedCustomer.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill>}
                  />
                </div>
              ),
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
                      <div className="grid grid-cols-3 gap-2">
                        <PerfCard label="OTIF" value={`${Number(selectedPerf.otif_percent || 0).toFixed(0)}%`} tone={Number(selectedPerf.otif_percent || 0) >= 92 ? "ok" : "warn"} />
                        <PerfCard label="Open ₹" value={fmtINR(Number(selectedPerf.open_value || 0))} tone="warn" />
                        <PerfCard label="Dispatched ₹" value={fmtINR(Number(selectedPerf.dispatched_value || 0))} tone="ok" />
                        <PerfCard label="Open orders" value={String(selectedPerf.orders_open || 0)} tone="neutral" />
                        <PerfCard label="Closed orders" value={String(selectedPerf.orders_closed || 0)} tone="ok" />
                        <PerfCard label="Delayed" value={String(selectedPerf.orders_delayed || 0)} tone={Number(selectedPerf.orders_delayed || 0) > 0 ? "critical" : "ok"} />
                      </div>
                      <Link href={`/reports/customer-360?customer=${encodeURIComponent(selectedCustomer.id)}`} className="block text-xs font-semibold text-emerald-700 hover:underline">
                        Open full customer-360 →
                      </Link>
                    </>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-500">
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
                  className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  Reactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmKind("deactivate")}
                  className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                >
                  Deactivate
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmKind("delete")}
                className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={startEdit}
                className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900"
              >
                Edit customer
              </button>
            </div>
          ) : null}
        />
      </div>

      {/* + New customer modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          resetCreate()
        }}
        eyebrow="Create"
        title="+ New customer"
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false)
                resetCreate()
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitCreate}
              disabled={createCustomer.isPending || createContact.isPending}
              className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-50"
            >
              {createCustomer.isPending ? "Creating…" : "Create customer"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Code"
            required
            value={createForm.customer_code}
            onChange={(v) => setCreateForm({ ...createForm, customer_code: v })}
            placeholder="CUST-XXX"
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Category</span>
            <select
              value={createForm.category}
              onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-emerald-400 focus:outline-none"
            >
              <option value="">Choose…</option>
              {CUSTOMER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Customer name"
            required
            value={createForm.name}
            onChange={(v) => setCreateForm({ ...createForm, name: v })}
          />
          <LabeledInput
            label="GST"
            value={createForm.gst_no}
            onChange={(v) => setCreateForm({ ...createForm, gst_no: v })}
          />
          <LabeledInput
            label="PAN"
            value={createForm.pan_no}
            onChange={(v) => setCreateForm({ ...createForm, pan_no: v })}
          />
          <LabeledInput
            label="Credit limit"
            value={createForm.credit_limit}
            onChange={(v) => setCreateForm({ ...createForm, credit_limit: v })}
            placeholder="₹ — optional"
          />
          <LabeledInput
            label="Payment terms"
            value={createForm.payment_terms}
            onChange={(v) => setCreateForm({ ...createForm, payment_terms: v })}
            placeholder="e.g. Net 30"
          />
        </div>
        <div className="mt-3">
          <LabeledTextarea
            label="Address"
            value={createForm.address}
            onChange={(v) => setCreateForm({ ...createForm, address: v })}
          />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Primary contact (optional — add more later)</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <LabeledInput
              label="Name"
              value={createForm.contact_name}
              onChange={(v) => setCreateForm({ ...createForm, contact_name: v })}
            />
            <LabeledInput
              label="Phone"
              value={createForm.contact_phone}
              onChange={(v) => setCreateForm({ ...createForm, contact_phone: v })}
            />
            <LabeledInput
              label="Email"
              value={createForm.contact_email}
              onChange={(v) => setCreateForm({ ...createForm, contact_email: v })}
            />
          </div>
        </div>
        {createError ? <p className="mt-3 text-xs font-medium text-rose-700">{createError}</p> : null}
      </Modal>

      {/* Edit customer modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        eyebrow="Edit"
        title={editForm.name || "Edit customer"}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitEdit}
              disabled={updateCustomer.isPending}
              className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-50"
            >
              {updateCustomer.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Code"
            required
            value={editForm.customer_code || ""}
            onChange={(v) => setEditForm({ ...editForm, customer_code: v })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Category</span>
            <select
              value={editForm.category || ""}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-emerald-400 focus:outline-none"
            >
              <option value="">—</option>
              {CUSTOMER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Name" required value={editForm.name || ""} onChange={(v) => setEditForm({ ...editForm, name: v })} />
          <LabeledInput label="GST" value={editForm.gst_no || ""} onChange={(v) => setEditForm({ ...editForm, gst_no: v })} />
          <LabeledInput label="PAN" value={editForm.pan_no || ""} onChange={(v) => setEditForm({ ...editForm, pan_no: v })} />
          <LabeledInput
            label="Credit limit"
            value={editForm.credit_limit == null ? "" : String(editForm.credit_limit)}
            onChange={(v) => setEditForm({ ...editForm, credit_limit: v ? Number(v) : null })}
          />
          <LabeledInput
            label="Payment terms"
            value={editForm.payment_terms || ""}
            onChange={(v) => setEditForm({ ...editForm, payment_terms: v })}
          />
        </div>
        <div className="mt-3">
          <LabeledTextarea
            label="Address"
            value={editForm.address || ""}
            onChange={(v) => setEditForm({ ...editForm, address: v })}
          />
        </div>
        {editError ? <p className="mt-3 text-xs font-medium text-rose-700">{editError}</p> : null}
      </Modal>

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

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 text-sm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className="text-slate-900">{value}</span>
    </div>
  )
}

function PerfCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "ok" | "warn" | "critical" | "neutral" }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50"
        : tone === "critical"
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-slate-50"
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-950">{value}</p>
    </div>
  )
}
