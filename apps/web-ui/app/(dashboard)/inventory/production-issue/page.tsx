"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { ArrowRight, PackageCheck, RefreshCw, Search } from "lucide-react"

import { useCreateTransaction, useInventoryItems } from "@/hooks/use-inventory"
import { usePlanningJobCards } from "@/hooks/use-production"
import { jobCardRef, jobCardSearchText, jobCardSubtitle } from "@/lib/job-card-display"

export default function InventoryProductionIssuePage() {
  const { data: items = [], isLoading } = useInventoryItems()
  const createIssue = useCreateTransaction()
  const [jobSearch, setJobSearch] = useState("")
  const [itemSearch, setItemSearch] = useState("")
  const deferredJobSearch = useDeferredValue(jobSearch.trim())
  const jobCardsQuery = usePlanningJobCards(
    {
      limit: 80,
      ...(deferredJobSearch ? { search: deferredJobSearch } : {}),
    },
    true,
  )
  const [formData, setFormData] = useState({
    item_id: "",
    qty: "",
    production_job_id: "",
    reason_code: "NON_RECIPE_CONSUMABLE",
    external_ref: "",
    notes: "",
    allow_raw_paper_exception: false,
  })

  const rawItems = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase()
    return (Array.isArray(items) ? items : [])
      .filter((item: any) => String(item.type || item.category || "").toUpperCase() !== "FINISHED_GOOD")
      .filter((item: any) => {
        if (!needle) return true
        return [item.name, item.item_name, item.code, item.item_code, item.type, item.category]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      })
  }, [items, itemSearch])

  const openJobCards = useMemo(() => {
    const rows = Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []
    return rows.filter((job: any) => String(job.current_stage || "").toUpperCase() !== "DONE")
  }, [jobCardsQuery.data])

  const selectedItem = rawItems.find((item: any) => String(item.id) === formData.item_id)
  const selectedItemType = String(selectedItem?.type || selectedItem?.category || "").toUpperCase()
  const selectedJob = openJobCards.find((job: any) => String(job.id) === formData.production_job_id)

  useEffect(() => {
    if (selectedItemType !== "RAW_PAPER" && formData.allow_raw_paper_exception) {
      setFormData((current) => ({ ...current, allow_raw_paper_exception: false }))
    }
  }, [formData.allow_raw_paper_exception, selectedItemType])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!formData.item_id || !formData.qty || !formData.production_job_id) return

    await createIssue.mutateAsync({
      item_id: formData.item_id,
      qty: Number(formData.qty),
      production_job_id: formData.production_job_id,
      reason_code: formData.reason_code,
      allow_raw_paper_exception: Boolean(formData.allow_raw_paper_exception),
      external_ref: formData.external_ref || jobCardRef(selectedJob),
      notes: formData.notes || undefined,
    })

    setFormData((current) => ({
      ...current,
      qty: "",
      external_ref: "",
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
              Issue adhesive, parchment, packing, or controlled raw-paper exceptions against an actual job card. Stock and batch sufficiency are checked by the inventory service.
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
            Search Materials
            <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={itemSearch}
                onChange={(event) => setItemSearch(event.target.value)}
                placeholder="Paper, adhesive, parchment, code..."
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </label>

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
                  {item.item_code || item.code || item.id} - {item.name || item.item_name || "Unnamed item"}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Quantity / Weight
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={formData.qty}
              onChange={(event) => setFormData((current) => ({ ...current, qty: event.target.value }))}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
              required
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Search Job Cards
            <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={jobSearch}
                onChange={(event) => setJobSearch(event.target.value)}
                placeholder="Job card, customer, product..."
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Job Card
            <select
              value={formData.production_job_id}
              onChange={(event) => setFormData((current) => ({ ...current, production_job_id: event.target.value }))}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
              required
            >
              <option value="">{jobCardsQuery.isLoading ? "Loading job cards..." : "Select live job card"}</option>
              {openJobCards
                .filter((job: any) => !jobSearch.trim() || jobCardSearchText(job).includes(jobSearch.trim().toLowerCase()))
                .map((job: any) => (
                  <option key={job.id} value={job.id}>
                    {jobCardRef(job)} - {jobCardSubtitle(job)} - {Number(job.planned_qty || job.released_qty || 0).toLocaleString("en-IN")} pcs
                  </option>
                ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Reason Code
            <select
              value={formData.reason_code}
              onChange={(event) => setFormData((current) => ({ ...current, reason_code: event.target.value }))}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
              required
            >
              <option value="NON_RECIPE_CONSUMABLE">Non-recipe consumable</option>
              <option value="DIRECT_CORRECTION">Direct stock correction</option>
              <option value="CONTROLLED_FALLBACK">Controlled fallback issue</option>
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            External Reference
            <input
              value={formData.external_ref}
              onChange={(event) => setFormData((current) => ({ ...current, external_ref: event.target.value }))}
              placeholder={selectedJob ? jobCardRef(selectedJob) : "Optional store slip / issue note"}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
            />
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-900 lg:col-span-2">
            <input
              type="checkbox"
              checked={formData.allow_raw_paper_exception}
              onChange={(event) => setFormData((current) => ({ ...current, allow_raw_paper_exception: event.target.checked }))}
              disabled={selectedItemType !== "RAW_PAPER"}
              className="h-4 w-4 rounded border-amber-300"
            />
            Allow raw-paper manual exception. Normal raw paper must go through RM issue-to-section/reel issue, not this exception screen.
          </label>
        </div>

        {selectedJob ? (
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">
            <span className="font-semibold">{jobCardRef(selectedJob)}</span> selected for {jobCardSubtitle(selectedJob)}.
            Stage {selectedJob.current_stage || "-"} · Qty {Number(selectedJob.planned_qty || selectedJob.released_qty || 0).toLocaleString("en-IN")} pcs.
          </div>
        ) : null}

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
