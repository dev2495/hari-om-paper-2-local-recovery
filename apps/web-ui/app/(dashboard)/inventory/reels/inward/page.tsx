"use client"

import dayjs from "dayjs"
import { Barcode, PlusCircle } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import { useApp } from "@/context/AppContext"
import { useCreateReelInward, useCreateReelScan, useInventoryItems, useInventoryLocations, useReels } from "@/hooks/use-inventory"
import { useSuppliers } from "@/hooks/use-master-data"

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
    supplier_name: "",
    location_id: "",
    inward_weight_kg: "",
    inward_date: dayjs().format("YYYY-MM-DD"),
  })
  const [logScanEvent, setLogScanEvent] = useState(true)

  const itemsQuery = useInventoryItems()
  const suppliersQuery = useSuppliers()
  const locationsQuery = useInventoryLocations()
  const reelsQuery = useReels()
  const createReelInward = useCreateReelInward()
  const createReelScan = useCreateReelScan()

  const paperItems = useMemo(() => {
    const rows = Array.isArray(itemsQuery.data) ? itemsQuery.data : []
    return rows.filter((item: any) => item.type === "RAW_PAPER")
  }, [itemsQuery.data])

  const reels = useMemo(() => {
    const rows = Array.isArray(reelsQuery.data) ? reelsQuery.data : []
    return rows.slice(0, 15)
  }, [reelsQuery.data])
  const suppliers = useMemo(() => (Array.isArray(suppliersQuery.data) ? suppliersQuery.data : []), [suppliersQuery.data])
  const locations = useMemo(() => (Array.isArray(locationsQuery.data) ? locationsQuery.data : []), [locationsQuery.data])
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

    try {
      const response = await createReelInward.mutateAsync({
        reel_code: form.reel_code,
        paper_id: form.paper_id,
        gsm: form.gsm ? Number(form.gsm) : null,
        bf: form.bf ? Number(form.bf) : null,
        supplier_name: form.supplier_name || null,
        location_id: form.location_id || null,
        inward_weight_kg: Number(form.inward_weight_kg),
        inward_date: form.inward_date,
      })

      const createdReelId = response?.data?.id
      if (createdReelId && logScanEvent) {
        await createReelScan.mutateAsync({
          reelId: createdReelId,
          data: {
            event_type: "INWARD_SCAN",
            source: "INVENTORY",
            metadata: { reel_code: form.reel_code },
          },
        })
      }

      showToast("Reel inward posted", "success")
      setForm((current) => ({
        ...current,
        reel_code: "",
        inward_weight_kg: "",
      }))
      reelsQuery.refetch()
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-cyan-200/70 bg-gradient-to-r from-slate-900 via-cyan-900 to-cyan-700 p-5 text-white shadow-xl">
        <h1 className="text-2xl font-semibold">Reel Inward (Barcode Assisted)</h1>
        <p className="mt-1 text-sm text-cyan-100">Scan or type reel code, confirm inward details, and post.</p>
      </section>

      <section className="glass rounded-2xl border border-white/60 p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Inward Entry</h2>
        <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reel code</label>
            <div className="flex items-center gap-2">
              <Barcode className="h-4 w-4 text-slate-500" />
              <input
                required
                autoFocus
                value={form.reel_code}
                onChange={(event) => setForm((current) => ({ ...current, reel_code: event.target.value.toUpperCase() }))}
                placeholder="Scan / type reel code"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Supplier</label>
            <select
              required
              value={form.supplier_name}
              onChange={(event) => setForm((current) => ({ ...current, supplier_name: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier: any) => (
                <option key={supplier.id} value={supplier.name}>
                  {supplier.supplier_code} - {supplier.name}
                </option>
              ))}
            </select>
            {!suppliers.length ? (
              <p className="mt-1 text-[11px] text-amber-700">Add suppliers from Master Data before posting live inwards.</p>
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
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={logScanEvent}
              onChange={(event) => setLogScanEvent(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Log scan event
          </label>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={createReelInward.isPending || createReelScan.isPending}
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
                <th className="py-2">Supplier</th>
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
