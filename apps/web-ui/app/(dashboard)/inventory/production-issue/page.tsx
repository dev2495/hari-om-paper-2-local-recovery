"use client"

import { useState } from "react"
import { ArrowRight, PackageCheck, RefreshCw } from "lucide-react"

import { useCreateTransaction, useInventoryItems } from "@/hooks/use-inventory"

export default function InventoryProductionIssuePage() {
  const { data: items = [], isLoading } = useInventoryItems()
  const createIssue = useCreateTransaction()
  const [formData, setFormData] = useState({
    item_id: "",
    quantity: "",
    job_card_ref: "",
    lot_no: "",
    notes: "",
  })

  const rawItems = Array.isArray(items)
    ? items.filter((item: any) => String(item.type || item.category || "").toUpperCase() !== "FINISHED_GOOD")
    : []

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!formData.item_id || !formData.quantity) return

    await createIssue.mutateAsync({
      item_id: formData.item_id,
      quantity: Number(formData.quantity),
      job_card_ref: formData.job_card_ref || undefined,
      lot_no: formData.lot_no || undefined,
      notes: formData.notes || undefined,
      transaction_type: "production_issue",
    })

    setFormData((current) => ({
      ...current,
      quantity: "",
      job_card_ref: "",
      lot_no: "",
      notes: "",
    }))
  }

  return (
    <div className="space-y-6" data-testid="inventory-production-issue-form">
      <section className="rounded-2xl border border-amber-200/70 bg-gradient-to-r from-slate-950 via-cyan-950 to-amber-900 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-200">Store to Production</p>
            <h1 className="mt-2 text-3xl font-semibold">Production Issue</h1>
            <p className="mt-2 max-w-3xl text-sm text-cyan-50/80">
              Issue raw paper, adhesive, parchment, or packing material against a job-card reference with lot traceability.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-xs uppercase tracking-[0.18em]">
            FG inward remains auto-posted from job close.
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="glass grid gap-5 rounded-2xl border border-white/60 p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-900 p-3 text-white">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Issue Material</h2>
            <p className="text-sm text-slate-500">Posts to the inventory issue ledger through the live BFF.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Material
            <select
              value={formData.item_id}
              onChange={(event) => setFormData((current) => ({ ...current, item_id: event.target.value }))}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
              required
            >
              <option value="">{isLoading ? "Loading items..." : "Select inventory item"}</option>
              {rawItems.map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.name || item.item_name || item.code || item.id}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Quantity
            <input
              type="number"
              step="0.001"
              min="0"
              value={formData.quantity}
              onChange={(event) => setFormData((current) => ({ ...current, quantity: event.target.value }))}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
              required
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Job Card Reference
            <input
              value={formData.job_card_ref}
              onChange={(event) => setFormData((current) => ({ ...current, job_card_ref: event.target.value }))}
              placeholder="JC-0001"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Lot / Reel
            <input
              value={formData.lot_no}
              onChange={(event) => setFormData((current) => ({ ...current, lot_no: event.target.value }))}
              placeholder="LOT / REEL ID"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
            />
          </label>
        </div>

        <label className="space-y-2 text-sm font-medium text-slate-700">
          Notes
          <textarea
            value={formData.notes}
            onChange={(event) => setFormData((current) => ({ ...current, notes: event.target.value }))}
            rows={3}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
          />
        </label>

        {createIssue.isError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Issue failed. Check stock balance, item selection, and service logs.
          </div>
        ) : null}

        {createIssue.isSuccess ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Material issue posted successfully.
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={createIssue.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createIssue.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Post Issue
          </button>
        </div>
      </form>
    </div>
  )
}
