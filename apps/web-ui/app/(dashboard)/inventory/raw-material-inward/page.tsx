"use client"

import { useMemo, useState } from "react"

import { useCreateInward, useInventoryItems, useInventoryLocations } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"

export default function RawMaterialInwardPage() {
  const { data: items } = useInventoryItems()
  const { data: locations = [] } = useInventoryLocations()
  const { data: vendors = [] } = useVendors()
  const createInward = useCreateInward()
  const [inward, setInward] = useState({ item_id: "", batch_no: "", qty: "", supplier_name: "", location: "" })
  const [submitError, setSubmitError] = useState("")

  const rmItems = useMemo(
    () => (items || []).filter((item: any) => item.type !== "FINISHED_GOOD"),
    [items]
  )

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-950 via-cyan-950 to-amber-900 p-6 text-white shadow-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">Stores receipt</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Raw Material Inward</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-cyan-50/78">Post purchase/store receipts for paper, adhesive and parchment lots with location control.</p>
      </section>
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setSubmitError("")
            const vendorName = inward.supplier_name.trim()
            if (!vendorName) {
              setSubmitError("Vendor is required before posting inward.")
              return
            }
            try {
              await createInward.mutateAsync({
                item_id: inward.item_id,
                batch_no: inward.batch_no,
                qty: Number(inward.qty),
                supplier_name: vendorName,
                location_id: inward.location || null,
              })
            } catch (error: any) {
              setSubmitError(error?.response?.data?.detail || error?.message || "Inward posting failed.")
            }
          }}
          className="grid gap-3 md:grid-cols-6"
        >
          <select
            required
            value={inward.item_id}
            onChange={(e) => setInward((s) => ({ ...s, item_id: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          >
            <option value="">Select RM item</option>
            {rmItems.map((item: any) => (
              <option key={item.id} value={item.id}>
                {item.item_code} - {item.name}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="Batch no"
            value={inward.batch_no}
            onChange={(e) => setInward((s) => ({ ...s, batch_no: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          />
          <input
            required
            type="number"
            min="0.001"
            step="0.001"
            placeholder="Qty"
            value={inward.qty}
            onChange={(e) => setInward((s) => ({ ...s, qty: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          />
          <select
            required
            value={inward.supplier_name}
            onChange={(e) => setInward((s) => ({ ...s, supplier_name: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          >
            <option value="">Select vendor</option>
            {(vendors || []).map((vendor: any) => (
              <option key={vendor.id} value={vendor.name}>
                {vendor.supplier_code} · {vendor.name}
              </option>
            ))}
          </select>
          {(vendors || []).length === 0 ? (
            <p className="md:col-span-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Add vendors from Master Data before posting inward.
            </p>
          ) : null}
          <select
            required
            value={inward.location}
            onChange={(e) => setInward((s) => ({ ...s, location: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          >
            <option value="">Select location</option>
            {(locations || []).map((location: any) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.warehouse}
              </option>
            ))}
          </select>
          <button disabled={createInward.isPending} className="h-11 rounded-xl bg-cyan-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {createInward.isPending ? "Posting..." : "Post inward"}
          </button>
        </form>
        {submitError ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitError}</p> : null}
        {createInward.isSuccess ? <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Inward posted successfully.</p> : null}
      </section>
    </div>
  )
}
