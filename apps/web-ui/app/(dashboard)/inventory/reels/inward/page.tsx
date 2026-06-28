"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { Barcode, PlusCircle } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import { InventoryLabelPrint } from "@/components/inventory/InventoryLabelPrint"
import { useApp } from "@/context/AppContext"
import { useCreateReelInward, useInventoryItems, useInventoryLocations, useReels } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"

function getErrorMessage(error: any): string {
  return (
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    "Action failed"
  )
}

export default function ReelInwardPage() {
  const { showToast } = useApp()
  const [form, setForm] = useState({
    reel_code: "",
    paper_id: "",
    gsm: "",
    bf: "",
    supplier_id: "",
    location_id: "",
    inward_weight_kg: "",
    unit_cost: "",
    inward_date: dayjs().format("YYYY-MM-DD"),
    stock_status: "QC_HOLD",
  })
  const itemsQuery = useInventoryItems()
  const vendorsQuery = useVendors()
  const locationsQuery = useInventoryLocations()
  const reelsQuery = useReels()
  const createReelInward = useCreateReelInward()
  const [lastLabel, setLastLabel] = useState<any>(null)

  const paperItems = useMemo(() => {
    const rows = Array.isArray(itemsQuery.data) ? itemsQuery.data : []
    return rows.filter((item: any) => item.type === "RAW_PAPER")
  }, [itemsQuery.data])

  const reels = useMemo(() => {
    const rows = Array.isArray(reelsQuery.data) ? reelsQuery.data : []
    return rows.slice(0, 15)
  }, [reelsQuery.data])
  const vendors = useMemo(() => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []), [vendorsQuery.data])
  const locations = useMemo(() => (Array.isArray(locationsQuery.data) ? locationsQuery.data : []), [locationsQuery.data])
  const selectedVendor = useMemo(
    () => vendors.find((vendor: any) => String(vendor.id) === form.supplier_id) || null,
    [form.supplier_id, vendors],
  )
  const locationById = useMemo(
    () => new Map(locations.map((location: any) => [String(location.id), location])),
    [locations],
  )

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.paper_id) {
      showToast("Select a raw paper item", "error")
      return
    }
    if (!selectedVendor) {
      showToast("Select a vendor before posting reel inward", "error")
      return
    }
    if (!form.unit_cost) {
      showToast("Enter inward rate so this reel carries its purchase price", "error")
      return
    }

    try {
      const result = await createReelInward.mutateAsync({
        reel_code: null,
        paper_id: form.paper_id,
        gsm: form.gsm ? Number(form.gsm) : null,
        bf: form.bf ? Number(form.bf) : null,
        supplier_id: form.supplier_id,
        supplier_name: selectedVendor.name,
        location_id: form.location_id || null,
        inward_weight_kg: Number(form.inward_weight_kg),
        unit_cost: Number(form.unit_cost),
        cost_source: "SUPPLIER",
        inward_date: form.inward_date,
        stock_status: form.stock_status,
      })
      setLastLabel(result?.data?.qr_payload || null)

      showToast("Reel inward posted", "success")
      setForm((current) => ({
        ...current,
        reel_code: "",
        inward_weight_kg: "",
        unit_cost: "",
        stock_status: "QC_HOLD",
      }))
      reelsQuery.refetch()
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-cyan-200/70 bg-gradient-to-r from-slate-900 via-cyan-900 to-cyan-700 p-5 text-white shadow-xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Reel Inward (Barcode Assisted)</h1>
            <p className="mt-1 text-sm text-cyan-100">Confirm vendor id, rate, weight, location, and incoming QC hold. The system generates the reel code.</p>
          </div>
          <Link href="/purchase" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-white/10">
            Purchase flow
          </Link>
        </div>
      </section>

      <InventoryLabelPrint label={lastLabel} title="Reel QR Label" />

      <section className="glass rounded-2xl border border-white/60 p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Inward Entry</h2>
        <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reel code</label>
            <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
              <Barcode className="h-4 w-4 text-slate-500" />
              System generated after posting
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Inward date</label>
            <input
              required
              type="date"
              value={form.inward_date}
              onChange={(event) => setForm((current) => ({ ...current, inward_date: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Paper item</label>
            <select
              required
              value={form.paper_id}
              onChange={(event) => setForm((current) => ({ ...current, paper_id: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Select raw paper</option>
              {paperItems.map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.item_code} - {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Inward weight (kg)</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={form.inward_weight_kg}
              onChange={(event) => setForm((current) => ({ ...current, inward_weight_kg: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Inward rate / kg</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={form.unit_cost}
              onChange={(event) => setForm((current) => ({ ...current, unit_cost: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</label>
            <select
              required
              value={form.supplier_id}
              onChange={(event) => setForm((current) => ({ ...current, supplier_id: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Select vendor</option>
              {vendors.map((vendor: any) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.supplier_code} - {vendor.name}
                </option>
              ))}
            </select>
            {!vendors.length ? (
              <p className="mt-1 text-[11px] text-amber-700">Add vendors from Master Data before posting live inwards.</p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Location</label>
            <select
              required
              value={form.location_id}
              onChange={(event) => setForm((current) => ({ ...current, location_id: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Select location</option>
              {locations.map((location: any) => (
                <option key={location.id} value={location.id}>
                  {location.code} - {location.warehouse}
                </option>
              ))}
            </select>
            {!locations.length ? (
              <p className="mt-1 text-[11px] text-amber-700">Create locations in System before posting store stock.</p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt stock status</label>
            <select
              value={form.stock_status}
              onChange={(event) => setForm((current) => ({ ...current, stock_status: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="QC_HOLD">Incoming QC hold</option>
              <option value="BLOCKED">Blocked stock</option>
            </select>
            <p className="mt-1 text-[11px] text-amber-700">Reel remains held until incoming QC is cleared.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">GSM</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.gsm}
              onChange={(event) => setForm((current) => ({ ...current, gsm: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">BF</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.bf}
              onChange={(event) => setForm((current) => ({ ...current, bf: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={createReelInward.isPending}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              <PlusCircle className="h-4 w-4" />
              Post Reel Inward
            </button>
          </div>
        </form>
      </section>

      <section className="glass rounded-2xl border border-white/60 p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Recent Reels</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Code</th>
                <th className="py-2">Status</th>
                <th className="py-2">Current kg</th>
                <th className="py-2">Vendor</th>
                <th className="py-2">Location</th>
                <th className="py-2">Inward date</th>
              </tr>
            </thead>
            <tbody>
              {reels.map((reel: any) => (
                <tr key={reel.id} className="border-b border-slate-100">
                  <td className="py-2 font-semibold text-slate-800">{reel.reel_code}</td>
                  <td className="py-2">{reel.status}</td>
                  <td className="py-2">{Number(reel.current_weight_kg || 0).toFixed(2)}</td>
                  <td className="py-2">{reel.supplier_name || "-"}</td>
                  <td className="py-2">{locationById.get(String(reel.location_id))?.code || "-"}</td>
                  <td className="py-2">{reel.inward_date || "-"}</td>
                </tr>
              ))}
              {reels.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500">
                    No reels available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
