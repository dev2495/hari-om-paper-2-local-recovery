"use client"

import { useMemo, useState } from "react"
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

type Vendor = {
  id: string
  supplier_code?: string
  name?: string
  gst_no?: string
  pan_no?: string
  address?: string
  category?: string
  category_label?: string
  is_active?: boolean
}

const VENDOR_CATEGORIES = ["Raw paper", "Parchment", "Adhesive", "Packaging", "Service", "Other"] as const

function errorMessage(error: any) {
  return error?.response?.data?.detail || error?.response?.data?.message || error?.message || "Action failed"
}

function compact(v: unknown) {
  return String(v || "").trim()
}

function vendorCategory(row: Vendor | null | undefined) {
  return compact(row?.category_label) || compact(row?.category) || "Other"
}

function matchesSearch(row: Vendor, needle: string) {
  if (!needle) return true
  return [row.supplier_code, row.name, row.gst_no, row.pan_no, row.address, vendorCategory(row)]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}

export default function VendorsPage() {
  const { showToast } = useApp()
  const vendorsQuery = useVendors()
  const createVendor = useCreateVendor()
  const updateVendor = useUpdateVendor()
  const deleteVendor = useDeleteVendor()
  const createContact = useCreateVendorContact()
  const updateContact = useUpdateVendorContact()
  const deleteContact = useDeleteVendorContact()

  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    supplier_code: "",
    name: "",
    category: "",
    gst_no: "",
    pan_no: "",
    address: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
  })
  const [createError, setCreateError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Vendor>({ id: "" })
  const [editError, setEditError] = useState<string | null>(null)

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
      return true
    })
  }, [vendors, search, categoryFilter, statusFilter])

  const selectedVendor = vendors.find((v) => v.id === selectedId) || null
  const contactsQuery = useVendorContacts(selectedId)
  const contacts = Array.isArray(contactsQuery.data) ? contactsQuery.data : []

  const kpis = useMemo(() => {
    const total = vendors.length
    const active = vendors.filter((v) => v.is_active !== false).length
    const inactive = total - active
    const categoriesUsed = new Set(vendors.map(vendorCategory)).size
    return { total, active, inactive, categoriesUsed }
  }, [vendors])

  const resetCreate = () => {
    setCreateForm({
      supplier_code: "",
      name: "",
      category: "",
      gst_no: "",
      pan_no: "",
      address: "",
      contact_name: "",
      contact_phone: "",
      contact_email: "",
    })
    setCreateError(null)
  }

  const submitCreate = async () => {
    setCreateError(null)
    if (!compact(createForm.supplier_code)) {
      setCreateError("Vendor code is required.")
      return
    }
    if (!compact(createForm.name)) {
      setCreateError("Vendor name is required.")
      return
    }
    try {
      const created = await createVendor.mutateAsync({
        supplier_code: createForm.supplier_code.trim(),
        name: createForm.name.trim(),
        gst_no: createForm.gst_no.trim() || undefined,
        pan_no: createForm.pan_no.trim() || undefined,
        address: createForm.address.trim() || undefined,
        category: createForm.category.trim() || undefined,
      })
      const vendorId = (created as any)?.data?.id || (created as any)?.id
      if (vendorId && compact(createForm.contact_name)) {
        await createContact.mutateAsync({
          vendorId,
          data: {
            contact_name: createForm.contact_name.trim(),
            contact_phone: createForm.contact_phone.trim() || undefined,
            contact_email: createForm.contact_email.trim() || undefined,
          },
        })
      }
      if (vendorId) setSelectedId(vendorId)
      setCreateOpen(false)
      resetCreate()
      showToast("Vendor created", "success")
    } catch (err) {
      setCreateError(errorMessage(err))
    }
  }

  const startEdit = () => {
    if (!selectedVendor) return
    setEditForm({ ...selectedVendor, category: vendorCategory(selectedVendor) === "Other" ? "" : vendorCategory(selectedVendor) })
    setEditError(null)
    setEditOpen(true)
  }

  const submitEdit = async () => {
    setEditError(null)
    if (!compact(editForm.supplier_code)) {
      setEditError("Vendor code is required.")
      return
    }
    if (!compact(editForm.name)) {
      setEditError("Vendor name is required.")
      return
    }
    try {
      await updateVendor.mutateAsync({
        id: editForm.id,
        data: {
          supplier_code: editForm.supplier_code?.trim(),
          name: editForm.name?.trim(),
          gst_no: editForm.gst_no?.trim() || undefined,
          pan_no: editForm.pan_no?.trim() || undefined,
          address: editForm.address?.trim() || undefined,
          category: editForm.category?.trim() || undefined,
        },
      })
      setEditOpen(false)
      showToast("Vendor updated", "success")
    } catch (err) {
      setEditError(errorMessage(err))
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
    const header = ["code", "name", "category", "gst", "pan", "address", "is_active"]
    const rows = filteredVendors.map((v) => [
      v.supplier_code || "",
      v.name || "",
      vendorCategory(v),
      v.gst_no || "",
      v.pan_no || "",
      (v.address || "").replace(/\s+/g, " "),
      v.is_active === false ? "no" : "yes",
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

  const columns: GridColumn<Vendor>[] = [
    {
      key: "supplier_code",
      label: "Code",
      width: "140px",
      sortAccessor: (r) => r.supplier_code || "",
      render: (r) => <span className="font-mono text-xs text-slate-700">{r.supplier_code || "—"}</span>,
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
      key: "category",
      label: "Category",
      width: "120px",
      sortAccessor: vendorCategory,
      render: (r) =>
        vendorCategory(r) !== "Other" ? <Pill tone="info">{vendorCategory(r)}</Pill> : <span className="text-[11px] text-slate-400">—</span>,
    },
    {
      key: "gst_no",
      label: "GST",
      width: "150px",
      sortAccessor: (r) => r.gst_no || "",
      render: (r) => <span className="font-mono text-xs text-slate-700">{r.gst_no || "—"}</span>,
    },
    {
      key: "pan_no",
      label: "PAN",
      width: "120px",
      sortAccessor: (r) => r.pan_no || "",
      render: (r) => <span className="font-mono text-xs text-slate-700">{r.pan_no || "—"}</span>,
    },
    {
      key: "is_active",
      label: "Status",
      width: "100px",
      sortAccessor: (r) => (r.is_active === false ? 0 : 1),
      render: (r) =>
        r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill>,
    },
  ]

  return (
    <CockpitShell
      hero={
        <MasterHero
          eyebrow="Vendor Master · cockpit"
          title={`${kpis.active} active vendors · ${kpis.categoriesUsed} categories`}
          description="Every supplier on one cockpit — GST, contacts, address, and the audit trail. Click any row to open the drawer with full detail and multi-contact management."
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
          <KpiTile
            label="Active"
            value={String(kpis.active)}
            tone="emerald"
            detail={`${kpis.inactive} inactive`}
          />
          <KpiTile
            label="Categories"
            value={String(kpis.categoriesUsed)}
            tone="violet"
            detail="Distinct categories in use"
          />
          <KpiTile
            label="With contacts"
            value={String(vendors.filter((v) => v.is_active !== false).length)}
            tone="amber"
            detail="Contacts populate as you add"
          />
        </>
      }
      filters={
        <>
          <FilterField label="Search">
            <SearchField value={search} onChange={setSearch} placeholder="name, code, GST, address…" />
          </FilterField>
          <FilterField label="Category">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-900"
            >
              <option value="ALL">All</option>
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-cyan-300 hover:text-cyan-800"
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
            + New vendor
          </button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]">
        <div className="space-y-3" data-testid="vendors-grid-region">
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
            { label: `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`, tone: "ok" as const },
          ] : []}
          tabs={selectedVendor ? [
            {
              key: "overview",
              label: "Overview",
              content: (
                <div className="space-y-3">
                  <FieldRow label="Code" value={<span className="font-mono">{selectedVendor.supplier_code || "—"}</span>} />
                  <FieldRow label="Category" value={vendorCategory(selectedVendor)} />
                  <FieldRow label="GST" value={<span className="font-mono text-xs">{selectedVendor.gst_no || "—"}</span>} />
                  <FieldRow label="PAN" value={<span className="font-mono text-xs">{selectedVendor.pan_no || "—"}</span>} />
                  <FieldRow label="Address" value={selectedVendor.address || "—"} />
                  <FieldRow
                    label="Status"
                    value={selectedVendor.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill>}
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
                Edit vendor
              </button>
            </div>
          ) : null}
        />
      </div>

      {/* + New vendor modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          resetCreate()
        }}
        eyebrow="Create"
        title="+ New vendor"
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
              disabled={createVendor.isPending || createContact.isPending}
              className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-50"
            >
              {createVendor.isPending ? "Creating…" : "Create vendor"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Code"
            required
            value={createForm.supplier_code}
            onChange={(v) => setCreateForm({ ...createForm, supplier_code: v })}
            placeholder="VEND-XXX"
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Category</span>
            <select
              value={createForm.category}
              onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-400 focus:outline-none"
            >
              <option value="">Choose…</option>
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Vendor name"
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
        </div>
        <div className="mt-3">
          <LabeledTextarea
            label="Address"
            value={createForm.address}
            onChange={(v) => setCreateForm({ ...createForm, address: v })}
          />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Primary contact (optional — you can add more later)</p>
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

      {/* Edit vendor modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        eyebrow="Edit"
        title={editForm.name || "Edit vendor"}
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
              disabled={updateVendor.isPending}
              className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-50"
            >
              {updateVendor.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Code"
            required
            value={editForm.supplier_code || ""}
            onChange={(v) => setEditForm({ ...editForm, supplier_code: v })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Category</span>
            <select
              value={editForm.category || ""}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-400 focus:outline-none"
            >
              <option value="">—</option>
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Name"
            required
            value={editForm.name || ""}
            onChange={(v) => setEditForm({ ...editForm, name: v })}
          />
          <LabeledInput
            label="GST"
            value={editForm.gst_no || ""}
            onChange={(v) => setEditForm({ ...editForm, gst_no: v })}
          />
          <LabeledInput
            label="PAN"
            value={editForm.pan_no || ""}
            onChange={(v) => setEditForm({ ...editForm, pan_no: v })}
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

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className="text-slate-900">{value}</span>
    </div>
  )
}
