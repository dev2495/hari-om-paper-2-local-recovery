"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { useCreateInward, useInventoryItems, useInventoryLocations } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"

export default function RawMaterialInwardPage() {
  const { data: items } = useInventoryItems()
  const { data: locations = [] } = useInventoryLocations()
  const { data: vendors = [] } = useVendors()
  const createInward = useCreateInward()
  const [inward, setInward] = useState({
    item_id: "",
    batch_no: "",
    qty: "",
    unit_cost: "",
    supplier_id: "",
    location: "",
    external_ref: "",
    stock_status: "QC_HOLD",
  })
  const [submitError, setSubmitError] = useState("")

  const rmItems = useMemo(
    () => (items || []).filter((item: any) => item.type !== "FINISHED_GOOD"),
    [items]
  )
  const selectedVendor = useMemo(
    () => (vendors || []).find((vendor: any) => String(vendor.id) === inward.supplier_id) || null,
    [inward.supplier_id, vendors],
  )
  const incomingQc = inward.stock_status === "QC_HOLD"

  return (
    <div className="space-y-6">
      <section className="rounded-[1.6rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-xl shadow-slate-900/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/80">Stores receipt / direct GRN</p>
            <h1 className="mt-2 text-2xl font-semibold">Raw Material Inward</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Post bulk adhesive, parchment, packing, and non-reel material receipts with vendor id, batch/rate, location, and mandatory incoming QC hold.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/purchase" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-white/10">
              Purchase flow
            </Link>
            <Link href="/inventory/reels/inward" className="rounded-xl bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-950">
              Reel inward
            </Link>
          </div>
        </div>
      </section>
      <section className="grid gap-3 md:grid-cols-4">
        {[
          ["1", "Purchase reference", "PO/GRN number stays on the ledger external reference."],
          ["2", "Receipt posting", "Vendor id, cost, and location are mandatory for a priced batch."],
          ["3", "Incoming QC", "Every receipt stays on QC hold until inspection passes."],
          ["4", "Stock use", "Only QC-approved batches become available to production issue."],
        ].map(([step, title, detail]) => (
          <div key={step} className="rounded-[1.1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700">Step {step}</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
          </div>
        ))}
      </section>
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setSubmitError("")
            if (!selectedVendor) {
              setSubmitError("Vendor is required before posting inward.")
              return
            }
            if (!inward.unit_cost) {
              setSubmitError("Inward rate is required so this batch carries its purchase price.")
              return
            }
            try {
              await createInward.mutateAsync({
                item_id: inward.item_id,
                batch_no: inward.batch_no || undefined,
                qty: Number(inward.qty),
                supplier_id: inward.supplier_id,
                supplier_name: selectedVendor.name,
                unit_cost: Number(inward.unit_cost),
                cost_source: "SUPPLIER",
                stock_status: inward.stock_status,
                location_id: inward.location || null,
                reference_type: "PURCHASE",
                external_ref: inward.external_ref || undefined,
              })
              setInward((current) => ({ ...current, batch_no: "", qty: "", unit_cost: "", external_ref: "", stock_status: "QC_HOLD" }))
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
            type="text"
            placeholder="Batch no optional"
            value={inward.batch_no}
            onChange={(e) => setInward((s) => ({ ...s, batch_no: e.target.value.toUpperCase() }))}
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
            value={inward.supplier_id}
            onChange={(e) => setInward((s) => ({ ...s, supplier_id: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          >
            <option value="">Select vendor</option>
            {(vendors || []).map((vendor: any) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.supplier_code} · {vendor.name}
              </option>
            ))}
          </select>
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Inward rate"
            value={inward.unit_cost}
            onChange={(e) => setInward((s) => ({ ...s, unit_cost: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          />
          {(vendors || []).length === 0 ? (
            <p className="md:col-span-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Add vendors from Master Data before posting inward.
            </p>
          ) : null}
          <select
            value={inward.stock_status}
            onChange={(e) => setInward((s) => ({ ...s, stock_status: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          >
            <option value="QC_HOLD">Incoming QC hold</option>
            <option value="BLOCKED">Blocked stock</option>
          </select>
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
          <input
            type="text"
            placeholder="PO / GRN reference"
            value={inward.external_ref}
            onChange={(e) => setInward((s) => ({ ...s, external_ref: e.target.value }))}
            className="h-11 rounded-xl border border-slate-200 px-3"
          />
          <button disabled={createInward.isPending} className="h-11 rounded-xl bg-cyan-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {createInward.isPending ? "Posting..." : "Post inward"}
          </button>
        </form>
        {incomingQc ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This receipt will enter stock as <strong>QC_HOLD</strong>. Release/inspection is visible from the quality desk before production issue.
          </p>
        ) : null}
        {submitError ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitError}</p> : null}
        {createInward.isSuccess ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Inward posted successfully. Batch {createInward.data?.data?.batch_no}
          </p>
        ) : null}
      </section>
    </div>
  )
}
