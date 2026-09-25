"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Boxes, PencilLine, Plus, Save } from "lucide-react"

import { useCreateItem, useDeleteItem, useInventoryBalances, useInventoryItems, useUpdateItem, useUpsertItemQualityProfile, useCopyItemQualityTemplate, useApproveItemQualityProfile } from "@/hooks/use-inventory"
import { ItemQualityProfileForm } from "@/components/qc/ItemQualityProfileForm"

const formatNumber = (value: unknown, digits = 2) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

const itemTypes = ["RAW_PAPER", "ADHESIVE", "PARCHMENT", "PACKAGING", "TOOL", "FINISHED_GOOD", "OTHER"]
const uoms = ["KG", "PCS"]
const trackingModes = ["BULK", "REEL"]

export default function InventoryItemsPage() {
  const { data: items = [], isLoading } = useInventoryItems()
  const { data: balances = [] } = useInventoryBalances()
  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
  const upsertQualityProfile = useUpsertItemQualityProfile()
  const copyQualityTemplate = useCopyItemQualityTemplate()
  const approveQualityProfile = useApproveItemQualityProfile()
  const deleteItem = useDeleteItem()
  const [selectedItemId, setSelectedItemId] = useState("")
  const [form, setForm] = useState({
    item_code: "",
    name: "",
    type: "RAW_PAPER",
    tracking_mode: "REEL",
    uom: "KG",
    reorder_level: "",
    safety_stock: "",
    lead_time_days: "",
  })
  const [policyForm, setPolicyForm] = useState({
    reorder_level: "",
    safety_stock: "",
    lead_time_days: "",
  })
  const [policyError, setPolicyError] = useState("")

  const balanceMap = useMemo(
    () => new Map((Array.isArray(balances) ? balances : []).map((row: any) => [String(row.item_id), row])),
    [balances],
  )
  const itemRows = Array.isArray(items) ? items : []
  const selectedItem = itemRows.find((item: any) => String(item.id) === selectedItemId)
  const typeCounts = itemRows.reduce((acc: Record<string, number>, item: any) => {
    const key = String(item.type || "UNKNOWN").toUpperCase()
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await createItem.mutateAsync({
      item_code: form.item_code,
      name: form.name,
      type: form.type,
      tracking_mode: form.tracking_mode,
      uom: form.uom,
      reorder_level: form.reorder_level ? Number(form.reorder_level) : 0,
      safety_stock: form.safety_stock ? Number(form.safety_stock) : 0,
      lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : 0,
    })
    setForm((current) => ({ ...current, item_code: "", name: "", reorder_level: "", safety_stock: "", lead_time_days: "" }))
  }

  useEffect(() => {
    if (!selectedItem) return
    setPolicyForm({
      reorder_level: selectedItem.reorder_level ? String(selectedItem.reorder_level) : "",
      safety_stock: selectedItem.safety_stock ? String(selectedItem.safety_stock) : "",
      lead_time_days: selectedItem.lead_time_days ? String(selectedItem.lead_time_days) : "",
    })
  }, [selectedItem])

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedItem) return
    setPolicyError("")
    try {
      await updateItem.mutateAsync({
        id: selectedItem.id,
        data: {
          reorder_level: policyForm.reorder_level ? Number(policyForm.reorder_level) : 0,
          safety_stock: policyForm.safety_stock ? Number(policyForm.safety_stock) : 0,
          lead_time_days: policyForm.lead_time_days ? Number(policyForm.lead_time_days) : 0,
        },
      })
    } catch (error: any) {
      setPolicyError(error?.response?.data?.detail || error?.message || "Policy update failed.")
    }
  }

  return (
    <div className="space-y-5" data-testid="inventory-items-page">
      <section className="rounded-[2rem] border border-border bg-gradient-to-br from-foreground via-cyan-950 to-foreground p-6 text-white shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">Inventory master</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Items and stock policy</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Create RM, FG, adhesive, parchment, packaging, tool, and OTHER items with tracking mode, UOM, reorder, safety, and lead-time controls.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4 xl:w-[560px]">
            {itemTypes.map((type) => (
              <div key={type} className="rounded-2xl border border-border/15 bg-card/10 px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{type.replace(/_/g, " ")}</p>
                <p className="mt-1 text-xl font-semibold">{typeCounts[type] || 0}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
        <form onSubmit={handleSubmit} className="rounded-[2rem] border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Create</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">New item</h2>
            </div>
            <div className="rounded-2xl bg-primary p-3 text-primary-foreground">
              <Boxes className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <label className="space-y-1 text-sm font-semibold text-muted-foreground">
              Item code
              <input required value={form.item_code} onChange={(event) => setForm((current) => ({ ...current, item_code: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40" placeholder="KRAFT-180-BF18" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-muted-foreground">
              Item name
              <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40" placeholder="Kraft paper 180 GSM" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm font-semibold text-muted-foreground">
                Type
                <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value, tracking_mode: event.target.value === "RAW_PAPER" ? "REEL" : "BULK" }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40">
                  {itemTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-semibold text-muted-foreground">
                UOM
                <select value={form.uom} onChange={(event) => setForm((current) => ({ ...current, uom: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40">
                  {uoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
                </select>
              </label>
            </div>
            <label className="space-y-1 text-sm font-semibold text-muted-foreground">
              Tracking mode
              <select value={form.tracking_mode} onChange={(event) => setForm((current) => ({ ...current, tracking_mode: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40">
                {trackingModes.map((mode) => <option key={mode} value={mode} disabled={mode === "REEL" && form.type !== "RAW_PAPER"}>{mode}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1 text-sm font-semibold text-muted-foreground">
                Reorder
                <input type="number" step="0.001" value={form.reorder_level} onChange={(event) => setForm((current) => ({ ...current, reorder_level: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40" placeholder="0" />
              </label>
              <label className="space-y-1 text-sm font-semibold text-muted-foreground">
                Safety
                <input type="number" step="0.001" value={form.safety_stock} onChange={(event) => setForm((current) => ({ ...current, safety_stock: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40" placeholder="0" />
              </label>
              <label className="space-y-1 text-sm font-semibold text-muted-foreground">
                Lead days
                <input type="number" step="0.1" value={form.lead_time_days} onChange={(event) => setForm((current) => ({ ...current, lead_time_days: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 outline-none focus:border-signal-cyan-ink/40" placeholder="0" />
              </label>
            </div>
          </div>
          {createItem.isError ? <div className="mt-4 rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">Item save failed. Check duplicate code and plant scope.</div> : null}
          <button disabled={createItem.isPending} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
            <Plus className="h-4 w-4" />
            Create item
          </button>
        </form>

        <form onSubmit={savePolicy} className="rounded-[2rem] border border-signal-cyan-line bg-signal-cyan-soft/70 p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-cyan-ink/70">Governance</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">MRP policy</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Select a row to edit reorder, safety stock, and lead time used by MRP and stock-close risk.</p>
            </div>
            <div className="rounded-2xl bg-primary p-3 text-primary-foreground">
              <PencilLine className="h-5 w-5" />
            </div>
          </div>
          {selectedItem ? (
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-signal-cyan-line bg-card px-3 py-2">
                <p className="text-sm font-semibold text-foreground">{selectedItem.item_code}</p>
                <p className="text-xs text-muted-foreground">{selectedItem.name}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input type="number" step="0.001" value={policyForm.reorder_level} onChange={(event) => setPolicyForm((current) => ({ ...current, reorder_level: event.target.value }))} className="h-11 rounded-xl border border-signal-cyan-line px-3 text-sm outline-none focus:border-signal-cyan-ink/40" placeholder="Reorder" />
                <input type="number" step="0.001" value={policyForm.safety_stock} onChange={(event) => setPolicyForm((current) => ({ ...current, safety_stock: event.target.value }))} className="h-11 rounded-xl border border-signal-cyan-line px-3 text-sm outline-none focus:border-signal-cyan-ink/40" placeholder="Safety" />
                <input type="number" step="0.1" value={policyForm.lead_time_days} onChange={(event) => setPolicyForm((current) => ({ ...current, lead_time_days: event.target.value }))} className="h-11 rounded-xl border border-signal-cyan-line px-3 text-sm outline-none focus:border-signal-cyan-ink/40" placeholder="Lead days" />
              </div>
              <button disabled={updateItem.isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
                <Save className="h-4 w-4" />
                Save policy
              </button>
              {policyError ? <p className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">{policyError}</p> : null}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-signal-cyan-line bg-card/70 p-5 text-sm text-muted-foreground">Select an item from the catalog to govern alerts.</div>
          )}
        </form>
        {selectedItem ? (
          <div className="mt-5 rounded-2xl border border-signal-cyan-line bg-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-cyan-ink/70">Incoming QC profile</p>
            <p className="mt-1 text-xs text-muted-foreground">Owned item rules used by incoming QC. No invented thresholds.</p>
            <div className="mt-3">
              <ItemQualityProfileForm
                item={selectedItem}
                saving={upsertQualityProfile.isPending || copyQualityTemplate.isPending || approveQualityProfile.isPending}
                onSave={async (profile) => {
                  await upsertQualityProfile.mutateAsync({
                    id: String(selectedItem.id),
                    data: { quality_profile: profile, setup_status: profile.setup_status || profile.status },
                  })
                }}
                onCopyTemplate={async () => {
                  await copyQualityTemplate.mutateAsync({ id: String(selectedItem.id) })
                }}
                onApprove={async (exemption?: boolean) => {
                  const revision = Number(selectedItem.quality_profile?.revision || 1)
                  await approveQualityProfile.mutateAsync({
                    id: String(selectedItem.id),
                    data: { expected_revision: revision, exemption: Boolean(exemption) },
                  })
                }}
              />
            </div>
          </div>
        ) : null}
        </div>

        <section className="min-w-0 rounded-[2rem] border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Catalog</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">Inventory item master</h2>
            </div>
            <Link href="/analytics/mrp" className="inline-flex items-center gap-1 text-sm font-semibold text-signal-cyan-ink">
              MRP <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Tracking</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3">Policy</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading items...</td></tr>
                ) : itemRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No items found.</td></tr>
                ) : (
                  itemRows.map((item: any) => {
                    const balance = balanceMap.get(String(item.id)) || {}
                    return (
                      <tr key={item.id} className="transition hover:bg-muted">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">{item.item_code}</p>
                          <p className="text-xs text-muted-foreground">{item.name}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{item.type}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.tracking_mode}</td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{formatNumber(balance.available_qty ?? balance.balance ?? 0)} {item.uom}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <p>R {formatNumber(item.reorder_level, 2)} · S {formatNumber(item.safety_stock, 2)}</p>
                          <p>Lead {formatNumber(item.lead_time_days, 1)} d</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedItemId(item.id)}
                              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-signal-cyan-line hover:text-signal-cyan-ink"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (typeof window !== "undefined" && window.confirm(`Soft-delete item ${item.item_code}? Historical ledger transactions remain intact.`)) {
                                  deleteItem.mutate(item.id)
                                }
                              }}
                              disabled={deleteItem.isPending}
                              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-signal-rose-line hover:text-signal-rose-ink disabled:opacity-40"
                              title="Soft-delete this item"
                            >
                              {deleteItem.isPending && deleteItem.variables === item.id ? "…" : "Delete"}
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
        </section>
      </div>
    </div>
  )
}
