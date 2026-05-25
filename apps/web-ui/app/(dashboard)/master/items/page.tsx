"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, Edit3, Filter, Layers, Package, Plus, Search, Trash2, X } from "lucide-react"

import {
  useCreateItem,
  useDeleteItem,
  useInventoryItems,
  useUpdateItem,
} from "@/hooks/use-inventory"
import { cn } from "@/lib/utils"

const TYPE_OPTIONS = [
  { value: "FINISHED_GOOD", label: "Finished Good" },
  { value: "RAW_PAPER", label: "Raw Paper" },
  { value: "ADHESIVE", label: "Adhesive" },
  { value: "PARCHMENT", label: "Parchment Lot" },
  { value: "PACKAGING", label: "Packaging" },
  { value: "INK", label: "Ink" },
  { value: "OTHER", label: "Other" },
]
const UOM_OPTIONS = ["KG", "PCS", "MTR", "ROLL", "LTR", "GM"]

const formatNumber = (value: unknown, digits = 2) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

type ItemForm = {
  item_code: string
  name: string
  type: string
  uom: string
  unit_cost: string
  reorder_level: string
  safety_stock: string
  lead_time_days: string
}

const EMPTY_FORM: ItemForm = {
  item_code: "",
  name: "",
  type: "FINISHED_GOOD",
  uom: "KG",
  unit_cost: "",
  reorder_level: "",
  safety_stock: "",
  lead_time_days: "",
}

export default function ItemMasterPage() {
  const { data: itemsRaw, isLoading } = useInventoryItems()
  const items: any[] = useMemo(() => (Array.isArray(itemsRaw) ? itemsRaw : []), [itemsRaw])
  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
  const deleteItem = useDeleteItem()

  const [form, setForm] = useState<ItemForm>(EMPTY_FORM)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("ALL")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<ItemForm>(EMPTY_FORM)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items.filter((row) => {
      const isActive = String(row.active ?? "true").toLowerCase() !== "false"
      if (!isActive && typeFilter !== "INACTIVE") return false
      if (typeFilter === "INACTIVE") return !isActive
      if (typeFilter !== "ALL" && String(row.type || "").toUpperCase() !== typeFilter) return false
      if (!needle) return true
      return `${row.item_code || ""} ${row.name || ""} ${row.type || ""}`.toLowerCase().includes(needle)
    })
  }, [items, search, typeFilter])

  const counts = useMemo(() => {
    const acc = { all: 0, fg: 0, rm: 0, parchment: 0, packaging: 0, inactive: 0 }
    items.forEach((it: any) => {
      const isActive = String(it.active ?? "true").toLowerCase() !== "false"
      if (!isActive) {
        acc.inactive += 1
        return
      }
      acc.all += 1
      const t = String(it.type || "").toUpperCase()
      if (t === "FINISHED_GOOD") acc.fg += 1
      else if (t === "RAW_PAPER" || t === "ADHESIVE") acc.rm += 1
      else if (t === "PARCHMENT") acc.parchment += 1
      else if (t === "PACKAGING") acc.packaging += 1
    })
    return acc
  }, [items])

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.item_code || !form.name) return
    createItem.mutate(
      {
        item_code: form.item_code.trim().toUpperCase(),
        name: form.name.trim(),
        type: form.type,
        uom: form.uom,
        unit_cost: form.unit_cost ? Number(form.unit_cost) : undefined,
        reorder_level: form.reorder_level ? Number(form.reorder_level) : undefined,
        safety_stock: form.safety_stock ? Number(form.safety_stock) : undefined,
        lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : undefined,
      },
      { onSuccess: () => setForm(EMPTY_FORM) },
    )
  }

  function openEdit(item: any) {
    setEditingId(String(item.id))
    setEditForm({
      item_code: item.item_code || "",
      name: item.name || "",
      type: item.type || "FINISHED_GOOD",
      uom: item.uom || "KG",
      unit_cost: item.unit_cost != null ? String(item.unit_cost) : "",
      reorder_level: item.reorder_level != null ? String(item.reorder_level) : "",
      safety_stock: item.safety_stock != null ? String(item.safety_stock) : "",
      lead_time_days: item.lead_time_days != null ? String(item.lead_time_days) : "",
    })
  }

  function handleEditSave() {
    if (!editingId) return
    updateItem.mutate(
      {
        id: editingId,
        data: {
          name: editForm.name.trim(),
          type: editForm.type,
          uom: editForm.uom,
          unit_cost: editForm.unit_cost ? Number(editForm.unit_cost) : null,
          reorder_level: editForm.reorder_level ? Number(editForm.reorder_level) : null,
          safety_stock: editForm.safety_stock ? Number(editForm.safety_stock) : null,
          lead_time_days: editForm.lead_time_days ? Number(editForm.lead_time_days) : null,
        },
      },
      { onSuccess: () => setEditingId(null) },
    )
  }

  function confirmDelete() {
    if (!deletingId) return
    deleteItem.mutate(deletingId, {
      onSuccess: () => setDeletingId(null),
    })
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-premium">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <Layers className="h-3.5 w-3.5" />
          Item Master
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          Item Master — FG, RM, parchments, packaging
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Canonical list of every item the system tracks. Soft-delete preserves historical transactions; cost
          + reorder + safety policy edits update MRP signals immediately. Item codes are immutable once created.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiTile label="Active" value={counts.all} tone="emerald" />
          <KpiTile label="Finished Goods" value={counts.fg} tone="cyan" />
          <KpiTile label="Raw + Adhesive" value={counts.rm} tone="amber" />
          <KpiTile label="Parchment" value={counts.parchment} tone="violet" />
          <KpiTile label="Packaging" value={counts.packaging} tone="rose" />
          <KpiTile label="Inactive" value={counts.inactive} tone="slate" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
        {/* Create */}
        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm h-fit xl:sticky xl:top-24">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-cyan-50 p-2 text-cyan-700">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Add new item</h2>
              <p className="text-[12px] text-slate-500">Code is uppercase + immutable.</p>
            </div>
          </div>

          <form onSubmit={handleCreate} className="mt-5 grid gap-3">
            <Field label="Item code *" required>
              <input
                required
                value={form.item_code}
                onChange={(e) => setForm({ ...form, item_code: e.target.value })}
                placeholder="RP-001"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono uppercase tracking-wider"
              />
            </Field>
            <Field label="Item name *">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Raw Paper 120 GSM"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="UOM">
                <select
                  value={form.uom}
                  onChange={(e) => setForm({ ...form, uom: e.target.value })}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                >
                  {UOM_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                MRP policy (optional)
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Unit cost">
                  <input
                    type="number"
                    step="0.01"
                    value={form.unit_cost}
                    onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
                <Field label="Lead days">
                  <input
                    type="number"
                    value={form.lead_time_days}
                    onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
                <Field label="Reorder level">
                  <input
                    type="number"
                    value={form.reorder_level}
                    onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
                <Field label="Safety stock">
                  <input
                    type="number"
                    value={form.safety_stock}
                    onChange={(e) => setForm({ ...form, safety_stock: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
              </div>
            </details>

            <button
              type="submit"
              disabled={createItem.isPending || !form.item_code || !form.name}
              className={cn(
                "mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold uppercase tracking-[0.1em] shadow-md transition",
                createItem.isPending || !form.item_code || !form.name
                  ? "cursor-not-allowed bg-slate-200 text-slate-500"
                  : "bg-slate-950 text-white hover:bg-slate-800",
              )}
            >
              <Plus className="h-4 w-4" />
              {createItem.isPending ? "Saving…" : "Add to master"}
            </button>
            {createItem.isError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                Could not save — code may already exist or be invalid.
              </p>
            ) : null}
            {createItem.isSuccess && !createItem.isPending ? (
              <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Item added.
              </p>
            ) : null}
          </form>
        </section>

        {/* List */}
        <section className="rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <h3 className="text-base font-semibold text-slate-950">All items</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-600">
              {filtered.length} of {items.length}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search code or name…"
                  className="h-9 w-52 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[12.5px]"
                />
              </div>
              <div className="relative">
                <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[12.5px] font-semibold"
                >
                  <option value="ALL">All active</option>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                  <option value="INACTIVE">Inactive only</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left">Code</th>
                    <th className="px-3 py-3 text-left">Name</th>
                    <th className="px-3 py-3 text-left">Type</th>
                    <th className="px-3 py-3 text-left">UOM</th>
                    <th className="px-3 py-3 text-right">Unit cost</th>
                    <th className="px-3 py-3 text-right">Reorder</th>
                    <th className="px-3 py-3 text-right">Safety</th>
                    <th className="px-3 py-3 text-center">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                        Loading master…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                        No items match the current filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row: any) => {
                      const isActive = String(row.active ?? "true").toLowerCase() !== "false"
                      return (
                        <tr key={row.id} className="border-t border-slate-100 hover:bg-cyan-50/30">
                          <td className="px-4 py-2.5 font-mono text-[12.5px] font-bold text-cyan-800">{row.item_code}</td>
                          <td className="px-3 py-2.5 text-slate-900">{row.name}</td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-700">
                              {row.type}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11.5px] uppercase text-slate-500">{row.uom}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{row.unit_cost != null ? formatNumber(row.unit_cost) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{row.reorder_level != null ? formatNumber(row.reorder_level) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{row.safety_stock != null ? formatNumber(row.safety_stock) : "—"}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em]",
                                isActive
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-500",
                              )}
                            >
                              <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-500" : "bg-slate-400")} />
                              {isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => openEdit(row)}
                                disabled={!isActive}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-30"
                                title="Edit"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeletingId(String(row.id))}
                                disabled={!isActive}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-30"
                                title="Deactivate"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {/* Edit modal */}
      {editingId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
          onClick={() => setEditingId(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">Edit item</p>
                <h3 className="mt-1 font-mono text-lg font-bold text-slate-900">{editForm.item_code}</h3>
              </div>
              <button onClick={() => setEditingId(null)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 grid gap-3">
              <Field label="Name">
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select
                    value={editForm.type}
                    onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="UOM">
                  <select
                    value={editForm.uom}
                    onChange={(e) => setEditForm({ ...editForm, uom: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  >
                    {UOM_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Unit cost">
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.unit_cost}
                    onChange={(e) => setEditForm({ ...editForm, unit_cost: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
                <Field label="Lead days">
                  <input
                    type="number"
                    value={editForm.lead_time_days}
                    onChange={(e) => setEditForm({ ...editForm, lead_time_days: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
                <Field label="Reorder level">
                  <input
                    type="number"
                    value={editForm.reorder_level}
                    onChange={(e) => setEditForm({ ...editForm, reorder_level: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
                <Field label="Safety stock">
                  <input
                    type="number"
                    value={editForm.safety_stock}
                    onChange={(e) => setEditForm({ ...editForm, safety_stock: e.target.value })}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </Field>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingId(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={updateItem.isPending}
                className="rounded-xl bg-slate-950 px-4 py-2 text-[12.5px] font-bold uppercase tracking-[0.1em] text-white shadow-md hover:bg-slate-800 disabled:opacity-50"
              >
                {updateItem.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete confirm */}
      {deletingId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
          onClick={() => setDeletingId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-rose-50 p-2 text-rose-700">
                <Trash2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-950">Deactivate item?</h3>
                <p className="mt-1 text-[12.5px] text-slate-600">
                  This is a <strong>soft delete</strong> — historical stock transactions remain intact. The item
                  is hidden from create / issue / dispatch dropdowns. Reactivation requires backend edit.
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setDeletingId(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteItem.isPending}
                className="rounded-xl bg-rose-700 px-4 py-2 text-[12.5px] font-bold uppercase tracking-[0.1em] text-white shadow-md hover:bg-rose-800 disabled:opacity-50"
              >
                {deleteItem.isPending ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
        {required ? <span className="ml-1 text-rose-500">*</span> : null}
      </span>
      {children}
    </label>
  )
}

function KpiTile({ label, value, tone = "cyan" }: { label: string; value: number; tone?: "cyan" | "emerald" | "amber" | "rose" | "violet" | "slate" }) {
  const toneClass: Record<string, string> = {
    cyan: "border-cyan-200 bg-cyan-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    rose: "border-rose-200 bg-rose-50/70",
    violet: "border-violet-200 bg-violet-50/70",
    slate: "border-slate-200 bg-slate-50",
  }
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 shadow-sm", toneClass[tone])}>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-none tabular-nums text-slate-950">{value}</p>
    </div>
  )
}
