"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Boxes, PencilLine, Plus, Save } from "lucide-react"

import { useCreateItem, useInventoryBalances, useInventoryItems, useUpdateItem } from "@/hooks/use-inventory"

const formatNumber = (value: unknown, digits = 2) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

const itemTypes = ["RAW_PAPER", "ADHESIVE", "PARCHMENT", "FINISHED_GOOD"]
const uoms = ["KG", "PCS"]
const trackingModes = ["BULK", "REEL"]

export default function InventoryItemsPage() {
  const { data: items = [], isLoading } = useInventoryItems()
  const { data: balances = [] } = useInventoryBalances()
  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
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
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-950 via-cyan-950 to-slate-800 p-6 text-white shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">Inventory master</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Items and stock policy</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-cyan-50/78">
              Create RM, FG, adhesive, and parchment items with tracking mode, UOM, reorder, safety, and lead-time controls.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4 xl:w-[560px]">
            {itemTypes.map((type) => (
              <div key={type} className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-100/70">{type.replace(/_/g, " ")}</p>
                <p className="mt-1 text-xl font-semibold">{typeCounts[type] || 0}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
        <form onSubmit={handleSubmit} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Create</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">New item</h2>
            </div>
            <div className="rounded-2xl bg-cyan-950 p-3 text-white">
              <Boxes className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Item code
              <input required value={form.item_code} onChange={(event) => setForm((current) => ({ ...current, item_code: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" placeholder="KRAFT-180-BF18" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Item name
              <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" placeholder="Kraft paper 180 GSM" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                Type
                <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value, tracking_mode: event.target.value === "RAW_PAPER" ? "REEL" : "BULK" }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700">
                  {itemTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                UOM
                <select value={form.uom} onChange={(event) => setForm((current) => ({ ...current, uom: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700">
                  {uoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
                </select>
              </label>
            </div>
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Tracking mode
              <select value={form.tracking_mode} onChange={(event) => setForm((current) => ({ ...current, tracking_mode: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700">
                {trackingModes.map((mode) => <option key={mode} value={mode} disabled={mode === "REEL" && form.type !== "RAW_PAPER"}>{mode}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                Reorder
                <input type="number" step="0.001" value={form.reorder_level} onChange={(event) => setForm((current) => ({ ...current, reorder_level: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" placeholder="0" />
              </label>
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                Safety
                <input type="number" step="0.001" value={form.safety_stock} onChange={(event) => setForm((current) => ({ ...current, safety_stock: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" placeholder="0" />
              </label>
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                Lead days
                <input type="number" step="0.1" value={form.lead_time_days} onChange={(event) => setForm((current) => ({ ...current, lead_time_days: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" placeholder="0" />
              </label>
            </div>
          </div>
          {createItem.isError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Item save failed. Check duplicate code and plant scope.</div> : null}
          <button disabled={createItem.isPending} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
            <Plus className="h-4 w-4" />
            Create item
          </button>
        </form>

        <form onSubmit={savePolicy} className="rounded-[2rem] border border-cyan-200 bg-cyan-50/70 p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-800/70">Governance</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">MRP policy</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">Select a row to edit reorder, safety stock, and lead time used by MRP and stock-close risk.</p>
            </div>
            <div className="rounded-2xl bg-cyan-950 p-3 text-white">
              <PencilLine className="h-5 w-5" />
            </div>
          </div>
          {selectedItem ? (
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-cyan-200 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-slate-950">{selectedItem.item_code}</p>
                <p className="text-xs text-slate-500">{selectedItem.name}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input type="number" step="0.001" value={policyForm.reorder_level} onChange={(event) => setPolicyForm((current) => ({ ...current, reorder_level: event.target.value }))} className="h-11 rounded-xl border border-cyan-200 px-3 text-sm outline-none focus:border-cyan-700" placeholder="Reorder" />
                <input type="number" step="0.001" value={policyForm.safety_stock} onChange={(event) => setPolicyForm((current) => ({ ...current, safety_stock: event.target.value }))} className="h-11 rounded-xl border border-cyan-200 px-3 text-sm outline-none focus:border-cyan-700" placeholder="Safety" />
                <input type="number" step="0.1" value={policyForm.lead_time_days} onChange={(event) => setPolicyForm((current) => ({ ...current, lead_time_days: event.target.value }))} className="h-11 rounded-xl border border-cyan-200 px-3 text-sm outline-none focus:border-cyan-700" placeholder="Lead days" />
              </div>
              <button disabled={updateItem.isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-950 text-sm font-semibold text-white transition hover:bg-cyan-900 disabled:opacity-50">
                <Save className="h-4 w-4" />
                Save policy
              </button>
              {policyError ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{policyError}</p> : null}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-cyan-200 bg-white/70 p-5 text-sm text-slate-500">Select an item from the catalog to govern alerts.</div>
          )}
        </form>
        </div>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Catalog</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Inventory item master</h2>
            </div>
            <Link href="/analytics/mrp" className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-900">
              MRP <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Tracking</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3">Policy</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading items...</td></tr>
                ) : itemRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No items found.</td></tr>
                ) : (
                  itemRows.map((item: any) => {
                    const balance = balanceMap.get(String(item.id)) || {}
                    return (
                      <tr key={item.id} className="transition hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-950">{item.item_code}</p>
                          <p className="text-xs text-slate-500">{item.name}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{item.type}</td>
                        <td className="px-4 py-3 text-slate-700">{item.tracking_mode}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatNumber(balance.available_qty ?? balance.balance ?? 0)} {item.uom}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <p>R {formatNumber(item.reorder_level, 2)} · S {formatNumber(item.safety_stock, 2)}</p>
                          <p>Lead {formatNumber(item.lead_time_days, 1)} d</p>
                        </td>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => setSelectedItemId(item.id)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-900">
                            Edit
                          </button>
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
