"use client"

import { useMemo, useState } from "react"

import { useCreateInward, useInventoryItems } from "@/hooks/use-inventory"

export default function RawMaterialInwardPage() {
  const { data: items } = useInventoryItems()
  const createInward = useCreateInward()
  const [inward, setInward] = useState({ item_id: "", batch_no: "", qty: "", location: "" })

  const rmItems = useMemo(
    () => (items || []).filter((item: any) => item.type !== "FINISHED_GOOD"),
    [items]
  )

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl border border-white/60 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold">Raw Material Inward</h1>
        <p className="mt-1 text-sm text-slate-600">Store inward for paper, adhesive and parchment lots.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createInward.mutate({
              item_id: inward.item_id,
              batch_no: inward.batch_no,
              qty: Number(inward.qty),
              location: inward.location || null,
            })
          }}
          className="mt-4 grid gap-3 md:grid-cols-4"
        >
          <select
            required
            value={inward.item_id}
            onChange={(e) => setInward((s) => ({ ...s, item_id: e.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3"
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
            className="h-10 rounded-lg border border-slate-200 px-3"
          />
          <input
            required
            type="number"
            placeholder="Qty"
            value={inward.qty}
            onChange={(e) => setInward((s) => ({ ...s, qty: e.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3"
          />
          <div className="flex gap-2">
            <input
              placeholder="Location"
              value={inward.location}
              onChange={(e) => setInward((s) => ({ ...s, location: e.target.value }))}
              className="h-10 flex-1 rounded-lg border border-slate-200 px-3"
            />
            <button className="h-10 rounded-lg bg-cyan-800 px-4 text-sm font-medium text-white">Post</button>
          </div>
        </form>
      </section>
    </div>
  )
}
