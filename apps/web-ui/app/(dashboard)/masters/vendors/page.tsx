"use client"

import { Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
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
  Modal,
  Pill,
  SearchField,
  type GridColumn,
} from "@/components/master/master-cockpit"
import {
  useCreateVendor,
  useCreateVendorContact,
  useDeleteVendor,
  useDeleteVendorContact,
  useUpdateVendor,
  useUpdateVendorContact,
  useVendorContacts,
  useVendors,
} from "@/hooks/use-master-data"
import { GST_STATES, fromGstin, gstinError, stateName, vendorAddress, vendorFormErrors } from "@/lib/party-formats"

type Vendor = {
  id: string
  supplier_code?: string
  name?: string
  gst_no?: string | null
  pan_no?: string | null
  address?: string | null
  category?: string
  category_label?: string
  is_active?: boolean
  legal_name?: string | null
  trade_name?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  alt_phone?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  state_code?: string | null
  pin_code?: string | null
  country?: string | null
  full_address?: string | null
  payment_terms_days?: number | null
  credit_days?: number | null
  credit_limit?: number | null
  bank_name?: string | null
  bank_account_no?: string | null
  bank_ifsc?: string | null
  msme_no?: string | null
  notes?: string | null
}

const VENDOR_CATEGORIES = ["Raw paper", "Parchment", "Adhesive", "Packaging", "Service", "Other"] as const

// Every vendor detail is optional (client 2026-10-27); only code and name are needed to save.
const FORM_FIELDS = [
  "supplier_code", "name", "category", "legal_name", "trade_name", "gst_no", "pan_no", "msme_no",
  "address", "address_line2", "city", "state", "state_code", "pin_code", "country",
  "contact_name", "contact_phone", "alt_phone", "contact_email",
  "payment_terms_days", "credit_days", "credit_limit", "bank_name", "bank_account_no", "bank_ifsc", "notes",
] as const
type VendorForm = Record<(typeof FORM_FIELDS)[number], string>
const NUMBER_FIELDS = new Set(["payment_terms_days", "credit_days", "credit_limit"])
const UPPER_FIELDS = new Set(["gst_no", "pan_no", "bank_ifsc", "msme_no"])

function emptyForm(): VendorForm {
  return Object.fromEntries(FORM_FIELDS.map((key) => [key, key === "country" ? "India" : ""])) as VendorForm
}

function formFromVendor(vendor: Vendor): VendorForm {
  const form = emptyForm()
  for (const key of FORM_FIELDS) {
    const value = (vendor as any)[key]
    form[key] = value == null ? (key === "country" ? "India" : "") : String(value)
  }
  form.category = vendorCategory(vendor) === "Other" ? "" : vendorCategory(vendor)
  return form
}

/** Body for create/update: blanks go as null so a cleared field is cleared on the server. */
function payloadFromForm(form: VendorForm) {
  const body: Record<string, any> = {}
  for (const key of FORM_FIELDS) {
    const raw = String(form[key] ?? "").trim()
    if (key === "category") {
      if (raw) body.category = raw
      continue
    }
    if (NUMBER_FIELDS.has(key)) body[key] = raw === "" ? null : Number(raw)
    else body[key] = raw === "" ? null : UPPER_FIELDS.has(key) ? raw.replace(/\s+/g, "").toUpperCase() : raw
  }
  return body
}

function errorMessage(error: any) {
  const detail = error?.response?.data?.detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return detail || error?.response?.data?.message || error?.message || "Action failed"
}

function compact(v: unknown) {
  return String(v || "").trim()
}

// The service keeps a canonical category (RAW_MATERIAL …) next to the label typed on this page.
const CATEGORY_LABEL: Record<string, string> = { RAW_MATERIAL: "Raw paper", PARCHMENT: "Parchment", ADHESIVE: "Adhesive", PACKAGING: "Packaging", SERVICE: "Service", OTHER: "Other" }

function vendorCategory(row: Vendor | null | undefined) {
  const value = compact(row?.category_label) || compact(row?.category) || "Other"
  return CATEGORY_LABEL[value] || value
}

function place(row: Vendor) {
  return [row.city, row.state].map(compact).filter(Boolean).join(", ")
}

function matchesSearch(row: Vendor, needle: string) {
  if (!needle) return true
  return [row.supplier_code, row.name, row.legal_name, row.trade_name, row.gst_no, row.pan_no, row.address, row.city, row.state, row.pin_code, row.contact_name, row.contact_phone, vendorCategory(row)]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}

const inr = (value?: number | null) => (value == null ? "—" : `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`)
const days = (value?: number | null) => (value == null ? "—" : `${value} day${value === 1 ? "" : "s"}`)

export default function VendorsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading vendors…</div>}>
      <VendorsBody />
    </Suspense>
  )
}

function VendorsBody() {
  const { showToast } = useApp()
  const router = useRouter()
  const searchParams = useSearchParams()
  const vendorsQuery = useVendors({ include_inactive: true })
  const createVendor = useCreateVendor()
  const updateVendor = useUpdateVendor()
  const deleteVendor = useDeleteVendor()
  const createContact = useCreateVendorContact()
  const updateContact = useUpdateVendorContact()
  const deleteContact = useDeleteVendorContact()

  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE")
  const [gstFilter, setGstFilter] = useState<"ALL" | "WITH" | "WITHOUT">("ALL")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())

  // One form for "+ New vendor" and "Edit vendor".
  const [formMode, setFormMode] = useState<null | "create" | "edit">(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<VendorForm>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [showFieldErrors, setShowFieldErrors] = useState(false)

  const [confirmKind, setConfirmKind] = useState<null | "deactivate" | "delete">(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const vendors: Vendor[] = useMemo(
    () => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []),
    [vendorsQuery.data],
  )

  const filteredVendors = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return vendors.filter((v) => {
      if (!matchesSearch(v, needle)) return false
      if (categoryFilter !== "ALL" && vendorCategory(v) !== categoryFilter) return false
      const active = v.is_active !== false
      if (statusFilter === "ACTIVE" && !active) return false
      if (statusFilter === "INACTIVE" && active) return false
      if (gstFilter === "WITH" && !v.gst_no) return false
      if (gstFilter === "WITHOUT" && v.gst_no) return false
      return true
    })
  }, [vendors, search, categoryFilter, statusFilter, gstFilter])

  const selectedVendor = vendors.find((v) => v.id === selectedId) || null
  const contactsQuery = useVendorContacts(selectedId)
  const contacts = Array.isArray(contactsQuery.data) ? contactsQuery.data : []

  const kpis = useMemo(() => {
    const total = vendors.length
    const activeRows = vendors.filter((v) => v.is_active !== false)
    const active = activeRows.length
    const inactive = total - active
    const categoriesUsed = new Set(vendors.map(vendorCategory)).size
    const withGst = activeRows.filter((v) => v.gst_no).length
    return { total, active, inactive, categoriesUsed, withGst, withoutGst: active - withGst }
  }, [vendors])

  const fieldErrors = useMemo(() => vendorFormErrors(form), [form])
  const saving = createVendor.isPending || createContact.isPending || updateVendor.isPending

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setFormError(null)
    setShowFieldErrors(false)
    setFormMode("create")
  }

  const startEdit = (vendor: Vendor | null = selectedVendor) => {
    if (!vendor) return
    setSelectedId(vendor.id)
    setEditingId(vendor.id)
    setForm(formFromVendor(vendor))
    setFormError(null)
    setShowFieldErrors(false)
    setFormMode("edit")
  }

  const closeForm = () => {
    setFormMode(null)
    setFormError(null)
    if (editParam) router.replace("/masters/vendors")
  }

  // /masters/vendors?edit=<id or code> opens that vendor's form.
  const editParam = searchParams?.get("edit") || ""
  const openedFromLink = useRef<string | null>(null)
  useEffect(() => {
    if (!editParam || openedFromLink.current === editParam || !vendors.length) return
    const vendor = vendors.find((v) => v.id === editParam || compact(v.supplier_code).toUpperCase() === editParam.toUpperCase())
    if (!vendor) return
    openedFromLink.current = editParam
    setStatusFilter("ALL")
    setSelectedId(vendor.id)
    setEditingId(vendor.id)
    setForm(formFromVendor(vendor))
    setFormError(null)
    setShowFieldErrors(false)
    setFormMode("edit")
  }, [editParam, vendors])

  const submitForm = async () => {
    setFormError(null)
    if (!compact(form.supplier_code)) {
      setFormError("Vendor code is required.")
      return
    }
    if (!compact(form.name)) {
      setFormError("Vendor name is required.")
      return
    }
    const problems = Object.values(fieldErrors)
    if (problems.length) {
      setShowFieldErrors(true)
      setFormError(`Fix ${problems.length === 1 ? "this" : "these"} before saving: ${problems.join(" · ")}`)
      return
    }
    const body = payloadFromForm(form)
    try {
      if (formMode === "edit" && editingId) {
        await updateVendor.mutateAsync({ id: editingId, data: body })
        showToast("Vendor updated", "success")
      } else {
        const created = await createVendor.mutateAsync(body)
        const vendorId = (created as any)?.data?.id || (created as any)?.id
        // The main contact also starts the vendor's contact list (more people can be added there).
        if (vendorId && compact(form.contact_name)) {
          await createContact.mutateAsync({
            vendorId,
            data: {
              contact_name: form.contact_name.trim(),
              contact_phone: form.contact_phone.trim() || undefined,
              contact_email: form.contact_email.trim() || undefined,
            },
          })
        }
        if (vendorId) setSelectedId(vendorId)
        showToast("Vendor created", "success")
      }
      setFormMode(null)
    } catch (err) {
      setFormError(errorMessage(err))
    }
  }

  const runConfirm = async () => {
    if (!selectedVendor) return
    setConfirmBusy(true)
    try {
      if (confirmKind === "deactivate") {
        await updateVendor.mutateAsync({ id: selectedVendor.id, data: { is_active: false } })
        showToast("Vendor deactivated", "success")
      } else if (confirmKind === "delete") {
        await deleteVendor.mutateAsync(selectedVendor.id)
        setSelectedId(null)
        showToast("Vendor deleted", "success")
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
    if (on) setSelection(new Set(filteredVendors.map((v) => v.id)))
    else setSelection(new Set())
  }

  const bulkDeactivate = async () => {
    if (!selection.size) return
    try {
      await Promise.all(Array.from(selection).map((id) => updateVendor.mutateAsync({ id, data: { is_active: false } })))
      setSelection(new Set())
      showToast(`Deactivated ${selection.size} vendors`, "success")
    } catch (err) {
      showToast(errorMessage(err), "error")
    }
  }
  const bulkActivate = async () => {
    if (!selection.size) return
    try {
      await Promise.all(Array.from(selection).map((id) => updateVendor.mutateAsync({ id, data: { is_active: true } })))
      setSelection(new Set())
      showToast(`Activated ${selection.size} vendors`, "success")
    } catch (err) {
      showToast(errorMessage(err), "error")
    }
  }

  const exportFilteredCsv = () => {
    if (!filteredVendors.length) {
      showToast("No vendors to export", "info")
      return
    }
    const header = [
      "code", "name", "legal_name", "trade_name", "category", "gstin", "pan", "msme_udyam", "address_line_1", "address_line_2",
      "city", "state", "state_code", "pin_code", "country", "contact_person", "phone", "alternate_phone", "email",
      "payment_terms_days", "credit_days", "credit_limit", "bank_name", "bank_account_no", "ifsc", "notes", "is_active",
    ]
    const rows = filteredVendors.map((v) => [
      v.supplier_code || "", v.name || "", v.legal_name || "", v.trade_name || "", vendorCategory(v), v.gst_no || "", v.pan_no || "", v.msme_no || "",
      (v.address || "").replace(/\s+/g, " "), (v.address_line2 || "").replace(/\s+/g, " "), v.city || "", v.state || "", v.state_code || "", v.pin_code || "",
      v.country || "India", v.contact_name || "", v.contact_phone || "", v.alt_phone || "", v.contact_email || "",
      v.payment_terms_days ?? "", v.credit_days ?? "", v.credit_limit ?? "", v.bank_name || "", v.bank_account_no || "", v.bank_ifsc || "",
      (v.notes || "").replace(/\s+/g, " "), v.is_active === false ? "no" : "yes",
    ])
    const csv = [header, ...rows]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `vendors-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Code and category sit above the name so the list fits beside the detail panel at 1280 px.
  const columns: GridColumn<Vendor>[] = [
    {
      key: "name",
      label: "Vendor",
      sortAccessor: (r) => r.name || "",
      render: (r) => (
        <div className="min-w-0 max-w-[260px]">
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={r.supplier_code || ""}>{r.supplier_code || "—"} · <span className="font-sans text-signal-cyan-ink">{vendorCategory(r)}</span></div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{r.name || "—"}</span>
            {r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : null}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{[place(r) || r.address, r.contact_name && `${r.contact_name}${r.contact_phone ? ` · ${r.contact_phone}` : ""}`].filter(Boolean).join(" · ") || "No address yet"}</div>
          {r.contact_email ? <div className="truncate text-[11px] text-muted-foreground" title={r.contact_email}>{r.contact_email}</div> : null}
        </div>
      ),
    },
    {
      key: "gst_no",
      label: "GSTIN",
      width: "136px",
      sortAccessor: (r) => r.gst_no || "",
      render: (r) => r.gst_no ? <span className="font-mono text-xs text-foreground">{r.gst_no}</span> : <span className="text-[11px] text-muted-foreground">Not given</span>,
    },
    {
      key: "edit",
      label: "",
      width: "76px",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); startEdit(r) }}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground hover:border-signal-cyan-line hover:text-signal-cyan-ink"
          aria-label={`Edit ${r.name}`}
          data-testid={`vendor-row-edit-${r.supplier_code}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit
        </button>
      ),
    },
  ]

  return (
    <CockpitShell
      hero={
        <MasterHero
          eyebrow={`Parties · ${kpis.active} active · ${kpis.categoriesUsed} categories`}
          title="Vendors"
          description="Every vendor (supplier) on one page: GSTIN, PAN, address, contacts, payment terms and bank. Only code and name are needed; the rest is optional and prints on the PO when filled."
          accent="cyan"
          chips={[
            { label: `${kpis.total} total`, tone: "neutral" },
            { label: `${kpis.active} active`, tone: "ok" },
            kpis.inactive ? { label: `${kpis.inactive} inactive`, tone: "warn" } : null,
            { label: "Owner / Admin write access", tone: "neutral" },
          ].filter(Boolean) as any}
        />
      }
      kpis={
        <>
          <KpiTile label="Total vendors" value={String(kpis.total)} tone="cyan" detail="All categories" />
          <KpiTile label="Active" value={String(kpis.active)} tone="emerald" detail={`${kpis.inactive} inactive`} />
          <KpiTile label="With GSTIN" value={String(kpis.withGst)} tone="violet" detail={kpis.withoutGst ? `${kpis.withoutGst} active without GSTIN` : "Every active vendor has one"} />
          <KpiTile label="Categories" value={String(kpis.categoriesUsed)} tone="amber" detail="Distinct categories in use" />
        </>
      }
      filters={
        <>
          <FilterField label="Search" stackOnPhone>
            <SearchField value={search} onChange={setSearch} placeholder="name, code, GSTIN, city, contact…" fullWidthOnPhone />
          </FilterField>
          <FilterField label="Category" stackOnPhone>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-11 w-full rounded-md border border-border bg-card px-2 text-base font-medium text-foreground sm:h-9 sm:w-auto sm:text-sm"
            >
              <option value="ALL">All</option>
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="GSTIN" stackOnPhone>
            <select
              value={gstFilter}
              onChange={(e) => setGstFilter(e.target.value as any)}
              className="h-11 w-full rounded-md border border-border bg-card px-2 text-base font-medium text-foreground sm:h-9 sm:w-auto sm:text-sm"
            >
              <option value="ALL">All</option>
              <option value="WITH">Given</option>
              <option value="WITHOUT">Not given</option>
            </select>
          </FilterField>
          <FilterField label="Status" stackOnPhone>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-11 w-full rounded-md border border-border bg-card px-2 text-base font-medium text-foreground sm:h-9 sm:w-auto sm:text-sm"
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
            className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-muted-foreground hover:border-signal-cyan-line hover:text-signal-cyan-ink"
          >
            ⇡ Export CSV
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90"
          >
            + New vendor
          </button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]">
        <div className="min-w-0 space-y-3" data-testid="vendors-grid-region">
          {/* Phone: one card per vendor with GSTIN, place, contact and an Edit button. */}
          <ul className="space-y-2 md:hidden" data-testid="vendor-cards">
            {filteredVendors.map((v) => (
              <li key={v.id} className={`rounded-xl border bg-card p-3 ${selectedId === v.id ? "border-signal-cyan-line" : "border-border"}`}>
                <button type="button" className="block w-full min-w-0 text-left" onClick={() => setSelectedId(v.id)}>
                  <span className="block font-mono text-[11px] text-muted-foreground">{v.supplier_code} · {vendorCategory(v)}</span>
                  <span className="block break-words text-sm font-semibold text-foreground">{v.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">GSTIN <span className="font-mono text-foreground">{v.gst_no || "not given"}</span></span>
                  <span className="mt-0.5 block break-words text-xs text-muted-foreground">{vendorAddress(v) || "No address yet"}</span>
                  {v.contact_name || v.contact_phone || v.contact_email ? <span className="mt-0.5 block break-words text-xs text-muted-foreground">{[v.contact_name, v.contact_phone, v.contact_email].filter(Boolean).join(" · ")}</span> : null}
                </button>
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => startEdit(v)} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground" data-testid={`vendor-card-edit-${v.supplier_code}`}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />Edit
                  </button>
                </div>
              </li>
            ))}
            {!filteredVendors.length ? <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{vendorsQuery.isLoading ? "Loading vendors…" : "No vendors match the current filters."}</li> : null}
          </ul>
          <div className="hidden md:block">
          <DataGrid<Vendor>
            columns={columns}
            rows={filteredVendors}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId(r.id)}
            selection={selection}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            emptyHint={
              vendorsQuery.isLoading
                ? "Loading vendors…"
                : vendors.length === 0
                  ? "No vendors yet — click + New vendor to add one."
                  : "No vendors match the current filters."
            }
          />
          </div>
          {selection.size ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[1.2rem] border border-border bg-muted px-3 py-2 text-xs">
              <span className="font-semibold text-muted-foreground">{selection.size} selected</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={bulkActivate}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 sm:min-h-9 sm:px-3 font-semibold text-muted-foreground hover:border-signal-emerald-line hover:text-signal-emerald-ink"
                >
                  Activate
                </button>
                <button
                  type="button"
                  onClick={bulkDeactivate}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 sm:min-h-9 sm:px-3 font-semibold text-muted-foreground hover:border-signal-amber-line hover:text-signal-amber-ink"
                >
                  Deactivate
                </button>
                <button
                  type="button"
                  onClick={() => setSelection(new Set())}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 sm:min-h-9 sm:px-3 font-semibold text-muted-foreground hover:border-input"
                >
                  Clear
                </button>
              </span>
            </div>
          ) : null}
          <p className="px-1 text-[11px] text-muted-foreground">
            Showing {filteredVendors.length} of {vendors.length} vendors{selection.size ? ` · ${selection.size} selected` : ""}.
          </p>
        </div>

        <DetailDrawer
          open={Boolean(selectedVendor)}
          onClose={() => setSelectedId(null)}
          title={selectedVendor?.name || "—"}
          subtitle={selectedVendor ? `${selectedVendor.supplier_code || "no code"} · ${vendorCategory(selectedVendor)}` : undefined}
          accent="cyan"
          chips={selectedVendor ? [
            selectedVendor.is_active === false ? { label: "INACTIVE", tone: "warn" as const } : { label: "ACTIVE", tone: "ok" as const },
            selectedVendor.gst_no ? { label: "GSTIN GIVEN", tone: "ok" as const } : { label: "NO GSTIN", tone: "warn" as const },
            { label: `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`, tone: "ok" as const },
          ] : []}
          tabs={selectedVendor ? [
            {
              key: "overview",
              label: "Overview",
              content: <VendorOverview vendor={selectedVendor} />,
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
                    await createContact.mutateAsync({ vendorId: selectedVendor.id, data })
                  }}
                  onUpdate={async (contactId, data) => {
                    await updateContact.mutateAsync({ vendorId: selectedVendor.id, contactId, data })
                  }}
                  onDelete={async (contactId) => {
                    await deleteContact.mutateAsync({ vendorId: selectedVendor.id, contactId })
                  }}
                  onMakePrimary={async (contactId) => {
                    // Promote: set this contact primary, demote others
                    await Promise.all(
                      (contacts as any[]).map((c: any) =>
                        updateContact.mutateAsync({
                          vendorId: selectedVendor.id,
                          contactId: c.id,
                          data: { is_primary: c.id === contactId },
                        }),
                      ),
                    )
                  }}
                />
              ),
            },
          ] : []}
          footer={selectedVendor ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedVendor.is_active === false ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await updateVendor.mutateAsync({ id: selectedVendor.id, data: { is_active: true } })
                      showToast("Vendor reactivated", "success")
                    } catch (err) {
                      showToast(errorMessage(err), "error")
                    }
                  }}
                  className="inline-flex min-h-11 items-center rounded-full border border-signal-emerald-line bg-card px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-signal-emerald-ink hover:bg-signal-emerald-soft"
                >
                  Reactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmKind("deactivate")}
                  className="inline-flex min-h-11 items-center rounded-full border border-signal-amber-line bg-card px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-signal-amber-ink hover:bg-signal-amber-soft"
                >
                  Deactivate
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmKind("delete")}
                className="inline-flex min-h-11 items-center rounded-full border border-signal-rose-line bg-card px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-signal-rose-ink hover:bg-signal-rose-soft"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => startEdit()}
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90"
                data-testid="vendor-edit"
              >
                Edit vendor
              </button>
            </div>
          ) : null}
        />
      </div>

      <Modal
        open={formMode !== null}
        onClose={closeForm}
        eyebrow={formMode === "edit" ? "Edit" : "Create"}
        title={formMode === "edit" ? form.name || "Edit vendor" : "+ New vendor"}
        size="lg"
        footer={
          <>
            <p className="mr-auto text-[11.5px] text-muted-foreground">Only code and name are required.</p>
            <button
              type="button"
              onClick={closeForm}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-muted-foreground hover:border-input"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitForm}
              disabled={saving}
              data-testid="vendor-save"
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 sm:min-h-9 sm:px-3 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : formMode === "edit" ? "Save changes" : "Create vendor"}
            </button>
          </>
        }
      >
        <VendorFormFields
          form={form}
          setForm={setForm}
          errors={showFieldErrors ? fieldErrors : {}}
          creating={formMode === "create"}
          sameGstin={vendors.find((v) => v.gst_no && v.gst_no === form.gst_no.replace(/\s+/g, "").toUpperCase() && (formMode === "create" || v.id !== editingId)) || null}
        />
        {formError ? (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-xs font-medium text-signal-rose-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {formError}
          </p>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmKind === "deactivate"}
        title="Deactivate vendor?"
        body={
          <>
            <strong>{selectedVendor?.name}</strong> will be hidden from active lists. Existing GRNs and orders are preserved. You can reactivate any time.
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
        title="Delete vendor?"
        body={
          <>
            <strong>{selectedVendor?.name}</strong> will be permanently removed. This cannot be undone. If transactions exist, the backend will reject the delete and you should deactivate instead.
          </>
        }
        confirmLabel="Delete vendor"
        tone="critical"
        busy={confirmBusy}
        onClose={() => setConfirmKind(null)}
        onConfirm={runConfirm}
      />
    </CockpitShell>
  )
}

function VendorOverview({ vendor }: { vendor: Vendor }) {
  const address = vendorAddress(vendor)
  return (
    <div className="space-y-4" data-testid="vendor-overview">
      <OverviewGroup title="Tax">
        <FieldRow label="GSTIN" value={vendor.gst_no ? <span className="font-mono text-xs">{vendor.gst_no}</span> : <span className="text-muted-foreground">Not given</span>} />
        <FieldRow label="PAN" value={<span className="font-mono text-xs">{vendor.pan_no || "—"}</span>} />
        <FieldRow label="MSME / Udyam" value={<span className="font-mono text-xs">{vendor.msme_no || "—"}</span>} />
        {vendor.legal_name ? <FieldRow label="Legal name" value={vendor.legal_name} /> : null}
        {vendor.trade_name ? <FieldRow label="Trade name" value={vendor.trade_name} /> : null}
      </OverviewGroup>
      <OverviewGroup title="Address">
        <FieldRow label="Address" value={address || "—"} />
        <FieldRow label="State" value={vendor.state ? `${vendor.state}${vendor.state_code ? ` (${vendor.state_code})` : ""}` : "—"} />
        <FieldRow label="Country" value={vendor.country || "India"} />
      </OverviewGroup>
      <OverviewGroup title="Main contact">
        <FieldRow label="Person" value={vendor.contact_name || "—"} />
        <FieldRow label="Phone" value={[vendor.contact_phone, vendor.alt_phone].filter(Boolean).join(" · ") || "—"} />
        <FieldRow label="Email" value={vendor.contact_email || "—"} />
      </OverviewGroup>
      <OverviewGroup title="Payment">
        <FieldRow label="Payment terms" value={days(vendor.payment_terms_days)} />
        <FieldRow label="Credit" value={vendor.credit_days == null && vendor.credit_limit == null ? "—" : `${days(vendor.credit_days)} · limit ${inr(vendor.credit_limit)}`} />
        <FieldRow label="Bank" value={vendor.bank_name || vendor.bank_account_no || vendor.bank_ifsc ? <span>{vendor.bank_name || "—"}<span className="block font-mono text-xs text-muted-foreground">{[vendor.bank_account_no, vendor.bank_ifsc].filter(Boolean).join(" · IFSC ")}</span></span> : "—"} />
      </OverviewGroup>
      {vendor.notes ? (
        <OverviewGroup title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{vendor.notes}</p>
        </OverviewGroup>
      ) : null}
      <FieldRow label="Status" value={vendor.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill>} />
    </div>
  )
}

function OverviewGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border pb-3 last:border-b-0">
      <h3 className="text-[11.5px] font-semibold text-signal-cyan-ink">{title}</h3>
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

// Phone: 44 px fields with 16 px text (iOS does not zoom in on focus); desktop keeps the compact size.
const inputClass = "h-11 w-full min-w-0 rounded-md border bg-card px-3 text-base font-medium text-foreground focus:border-signal-cyan-line focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:text-sm"
const textareaClass = "w-full min-w-0 rounded-md border bg-card px-3 py-2 text-base font-medium text-foreground focus:border-signal-cyan-line focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"

function FormField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  required,
  mono,
  inputMode,
  maxLength,
  testId,
  className,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  error?: string
  hint?: ReactNode
  placeholder?: string
  required?: boolean
  mono?: boolean
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email"
  maxLength?: number
  testId?: string
  className?: string
}) {
  const noteId = useId()
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-sm ${className || ""}`}>
      <span className="text-xs font-semibold text-muted-foreground">
        {label} {required ? <span className="text-signal-rose-ink">*</span> : null}
      </span>
      <input
        aria-describedby={error || hint ? noteId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        data-testid={testId}
        className={`${inputClass} ${mono ? "font-mono uppercase tracking-wide" : ""} ${error ? "border-signal-rose-line" : "border-border"}`}
      />
      {error ? (
        <span id={noteId} className="flex items-start gap-1 text-xs font-medium text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{error}</span>
      ) : hint ? (
        <span id={noteId} className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="mt-4 first:mt-0">
      <legend className="text-[12px] font-semibold text-foreground">{title}{hint ? <span className="ml-2 font-normal text-muted-foreground">{hint}</span> : null}</legend>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

function VendorFormFields({
  form,
  setForm,
  errors,
  creating,
  sameGstin,
}: {
  form: VendorForm
  setForm: (next: VendorForm) => void
  errors: Record<string, string>
  creating: boolean
  sameGstin?: Vendor | null
}) {
  const set = (key: keyof VendorForm) => (value: string) => setForm({ ...form, [key]: value })
  const gst = fromGstin(form.gst_no)
  const gstProblem = gstinError(form.gst_no)
  // PAN and state that are not the GSTIN's are refused on save (here and by the server); shown as you type.
  const liveErrors = vendorFormErrors(form)
  const stateError = errors.state_code || liveErrors.state_code
  const stateNoteId = useId()

  // A complete GSTIN fills PAN and state when they are empty or still the old GSTIN's (the server does the same),
  // so a new GSTIN never leaves the old PAN and state behind.
  const onGstin = (raw: string) => {
    const value = raw.toUpperCase()
    const next = { ...form, gst_no: value }
    const derived = fromGstin(value)
    const previous = fromGstin(form.gst_no)
    if (derived.pan) {
      const pan = form.pan_no.replace(/\s+/g, "").toUpperCase()
      if (!pan || pan === previous.pan) next.pan_no = derived.pan
      if (!form.state_code || form.state_code === previous.stateCode) {
        next.state_code = derived.stateCode
        next.state = derived.state
      }
    }
    setForm(next)
  }

  const gstHint = form.gst_no.trim()
    ? gstProblem
      ? null
      : sameGstin ? (
        <span className="flex items-center gap-1 text-signal-amber-ink"><AlertTriangle className="h-3 w-3" aria-hidden="true" />{sameGstin.name} ({sameGstin.supplier_code}) already has this GSTIN</span>
      ) : (
        <span className="flex items-center gap-1 text-signal-emerald-ink"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Format OK · {gst.state} ({gst.stateCode}) · PAN {gst.pan}</span>
      )
    : "15 characters, e.g. 24ABCDE1234F1Z5. Fills PAN and state."

  return (
    <div data-testid="vendor-form">
      <FormSection title="Vendor">
        <FormField label="Code" required value={form.supplier_code} onChange={set("supplier_code")} placeholder="VEND-XXX" testId="vendor-code" />
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">Category</span>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className={`${inputClass} border-border`}
          >
            <option value="">{creating ? "Choose…" : "—"}</option>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <FormField label="Vendor name" required value={form.name} onChange={set("name")} className="sm:col-span-2" testId="vendor-name" />
        <FormField label="Legal name" value={form.legal_name} onChange={set("legal_name")} placeholder="As on the GST certificate" />
        <FormField label="Trade name" value={form.trade_name} onChange={set("trade_name")} />
      </FormSection>

      <FormSection title="Tax" hint="optional">
        <FormField label="GSTIN" value={form.gst_no} onChange={onGstin} mono maxLength={18} error={errors.gst_no || gstProblem} hint={gstHint} testId="vendor-gstin" />
        <FormField
          label="PAN"
          value={form.pan_no}
          onChange={(v) => setForm({ ...form, pan_no: v.toUpperCase() })}
          mono
          maxLength={12}
          error={errors.pan_no || liveErrors.pan_no}
          hint="10 characters, e.g. ABCDE1234F"
          testId="vendor-pan"
        />
        <FormField label="MSME / Udyam number" value={form.msme_no} onChange={(v) => setForm({ ...form, msme_no: v.toUpperCase() })} mono placeholder="UDYAM-GJ-01-0012345" />
      </FormSection>

      <FormSection title="Address" hint="optional">
        <FormField label="Address line 1" value={form.address} onChange={set("address")} className="sm:col-span-2" placeholder="Plot / building, street" testId="vendor-address1" />
        <FormField label="Address line 2" value={form.address_line2} onChange={set("address_line2")} className="sm:col-span-2" placeholder="Area, landmark" />
        <FormField label="City" value={form.city} onChange={set("city")} testId="vendor-city" />
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">State (GST code)</span>
          <select
            value={form.state_code}
            onChange={(e) => setForm({ ...form, state_code: e.target.value, state: stateName(e.target.value) })}
            className={`${inputClass} ${stateError ? "border-signal-rose-line" : "border-border"}`}
            aria-invalid={stateError ? true : undefined}
            aria-describedby={stateError ? stateNoteId : undefined}
            data-testid="vendor-state"
          >
            <option value="">{form.state && !form.state_code ? form.state : "Choose state…"}</option>
            {GST_STATES.map((row) => (
              <option key={row.code} value={row.code}>
                {row.code} · {row.name}
              </option>
            ))}
          </select>
          {stateError ? <span id={stateNoteId} className="flex items-start gap-1 text-xs font-medium text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{stateError}</span> : null}
        </label>
        <FormField label="PIN code" value={form.pin_code} onChange={set("pin_code")} inputMode="numeric" maxLength={6} error={errors.pin_code} testId="vendor-pin" />
        <FormField label="Country" value={form.country} onChange={set("country")} />
      </FormSection>

      <FormSection title="Main contact" hint={creating ? "prints on the PO; more people can be added later" : "prints on the PO"}>
        <FormField label="Contact person" value={form.contact_name} onChange={set("contact_name")} testId="vendor-contact" />
        <FormField label="Email" value={form.contact_email} onChange={set("contact_email")} inputMode="email" error={errors.contact_email} />
        <FormField label="Phone" value={form.contact_phone} onChange={set("contact_phone")} inputMode="tel" error={errors.contact_phone} testId="vendor-phone" />
        <FormField label="Alternate phone" value={form.alt_phone} onChange={set("alt_phone")} inputMode="tel" error={errors.alt_phone} />
      </FormSection>

      <FormSection title="Payment" hint="optional">
        <FormField label="Payment terms (days)" value={form.payment_terms_days} onChange={set("payment_terms_days")} inputMode="numeric" error={errors.payment_terms_days} placeholder="e.g. 60" />
        <FormField label="Credit days" value={form.credit_days} onChange={set("credit_days")} inputMode="numeric" error={errors.credit_days} />
        <FormField label="Credit limit (₹)" value={form.credit_limit} onChange={set("credit_limit")} inputMode="decimal" error={errors.credit_limit} />
      </FormSection>

      <FormSection title="Bank" hint="optional">
        <FormField label="Bank name" value={form.bank_name} onChange={set("bank_name")} />
        <FormField label="Account number" value={form.bank_account_no} onChange={set("bank_account_no")} inputMode="numeric" mono error={errors.bank_account_no} />
        <FormField label="IFSC" value={form.bank_ifsc} onChange={(v) => setForm({ ...form, bank_ifsc: v.toUpperCase() })} mono maxLength={11} error={errors.bank_ifsc} hint="e.g. SBIN0001234" testId="vendor-ifsc" />
      </FormSection>

      <fieldset className="mt-4">
        <legend className="text-[12px] font-semibold text-foreground">Notes</legend>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={`${textareaClass} mt-2 border-border`}
          placeholder="Delivery days, rate agreements, anything the team should know"
        />
      </fieldset>
    </div>
  )
}
