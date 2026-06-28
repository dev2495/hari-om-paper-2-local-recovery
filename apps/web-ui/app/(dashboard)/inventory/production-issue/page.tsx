"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { ArrowRight, Barcode, PackageCheck, RefreshCw, Search } from "lucide-react"

import {
  useCreateTransaction,
  useInventoryItemBalance,
  useInventoryItems,
  useInventoryLocations,
  useIssueBatchToWip,
} from "@/hooks/use-inventory"
import { usePlanningJobCards } from "@/hooks/use-production"
import { inventoryApi } from "@/lib/api"
import { jobCardRef, jobCardSearchText, jobCardSubtitle } from "@/lib/job-card-display"

const STAGE_OPTIONS = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING"]

function normalizeStage(value: any) {
  const normalized = String(value || "").trim().toUpperCase()
  return STAGE_OPTIONS.includes(normalized) ? normalized : "PROCESS"
}

function parseInventoryQr(raw: string) {
  const trimmed = raw.trim()
  const parts = trimmed.split("|")
  if (parts.length >= 5 && parts[0].toUpperCase() === "HARIOM") {
    return {
      entityType: parts[1].toUpperCase(),
      entityId: parts[3],
      code: parts[4],
    }
  }
  return { entityType: "", entityId: "", code: trimmed }
}

export default function InventoryProductionIssuePage() {
  const { data: items = [], isLoading } = useInventoryItems()
  const { data: locations = [] } = useInventoryLocations()
  const createIssue = useCreateTransaction()
  const issueBatchToWip = useIssueBatchToWip()
  const [jobSearch, setJobSearch] = useState("")
  const [itemSearch, setItemSearch] = useState("")
  const [batchScan, setBatchScan] = useState("")
  const [batchScanMessage, setBatchScanMessage] = useState("")
  const [pendingBatchId, setPendingBatchId] = useState("")
  const deferredJobSearch = useDeferredValue(jobSearch.trim())
  const jobCardsQuery = usePlanningJobCards(
    {
      limit: 80,
      ...(deferredJobSearch ? { search: deferredJobSearch } : {}),
    },
    true,
  )
  const [formData, setFormData] = useState({
    movement_mode: "WIP",
    item_id: "",
    batch_id: "",
    qty: "",
    production_job_id: "",
    stage: "PROCESS",
    wip_location_id: "",
    reason_code: "NON_RECIPE_CONSUMABLE",
    external_ref: "",
    notes: "",
    allow_raw_paper_exception: false,
  })
  const itemBalanceQuery = useInventoryItemBalance(formData.item_id, Boolean(formData.item_id))

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
  const itemBatches = useMemo(() => {
    const rows = Array.isArray(itemBalanceQuery.data?.batches) ? itemBalanceQuery.data.batches : []
    return rows.filter((batch: any) => {
      const status = String(batch.stock_status || "").toUpperCase()
      return Number(batch.available_qty ?? batch.current_balance ?? 0) > 0 && ["UNRESTRICTED", "WIP"].includes(status)
    })
  }, [itemBalanceQuery.data])
  const selectedBatch = itemBatches.find((batch: any) => String(batch.batch_id) === formData.batch_id)
  const wipLocations = useMemo(() => {
    return (Array.isArray(locations) ? locations : []).filter((location: any) =>
      [location.purpose, location.location_type, location.code, location.name]
        .filter(Boolean)
        .join(" ")
        .toUpperCase()
        .includes("WIP"),
    )
  }, [locations])
  const isWipMode = formData.movement_mode === "WIP"
  const actionPending = isWipMode ? issueBatchToWip.isPending : createIssue.isPending
  const actionError = isWipMode ? issueBatchToWip.isError : createIssue.isError
  const actionSuccess = isWipMode ? issueBatchToWip.isSuccess : createIssue.isSuccess

  useEffect(() => {
    if (selectedItemType !== "RAW_PAPER" && formData.allow_raw_paper_exception) {
      setFormData((current) => ({ ...current, allow_raw_paper_exception: false }))
    }
  }, [formData.allow_raw_paper_exception, selectedItemType])

  useEffect(() => {
    setFormData((current) => ({ ...current, batch_id: "" }))
  }, [formData.item_id])

  useEffect(() => {
    if (!pendingBatchId || !itemBatches.length) return
    const pending = pendingBatchId.toUpperCase()
    const matched = itemBatches.find((batch: any) =>
      String(batch.batch_id || "").toUpperCase() === pending ||
      String(batch.batch_no || "").toUpperCase() === pending
    )
    if (!matched) return
    setFormData((current) => ({ ...current, batch_id: matched.batch_id }))
    setBatchScanMessage(`Batch ${matched.batch_no || matched.batch_id} selected.`)
    setPendingBatchId("")
  }, [itemBatches, pendingBatchId])

  useEffect(() => {
    if (selectedJob) {
      setFormData((current) => ({ ...current, stage: normalizeStage(selectedJob.current_stage || current.stage) }))
    }
  }, [selectedJob])

  async function resolveBatchScan() {
    const parsed = parseInventoryQr(batchScan)
    const scanId = parsed.entityId.trim()
    const scanCode = parsed.code.trim().toUpperCase()
    setBatchScanMessage("")

    if (parsed.entityType && parsed.entityType !== "BATCH") {
      setBatchScanMessage("Scan a batch QR label for bulk production issue.")
      return
    }

    if (scanId) {
      try {
        const { data } = await inventoryApi.getBatchLabel(scanId)
        const itemId = data?.item_id
        const batchId = data?.entity_id || scanId
        if (!itemId || !batchId) {
          setBatchScanMessage("Batch QR could not be resolved.")
          return
        }
        setItemSearch(data?.item_code || data?.item_name || "")
        setPendingBatchId(batchId)
        setFormData((current) => ({ ...current, item_id: itemId, batch_id: "" }))
        return
      } catch (error: any) {
        setBatchScanMessage(error?.response?.data?.detail || error?.message || "Batch QR lookup failed.")
        return
      }
    }

    const matched = itemBatches.find((batch: any) =>
      String(batch.batch_id || "").toUpperCase() === scanCode ||
      String(batch.batch_no || "").toUpperCase() === scanCode
    )
    if (!matched) {
      setBatchScanMessage(formData.item_id ? "Batch not available for the selected material." : "Select material first or scan the printed batch QR.")
      return
    }
    setFormData((current) => ({ ...current, batch_id: matched.batch_id }))
    setBatchScanMessage(`Batch ${matched.batch_no || matched.batch_id} selected.`)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!formData.item_id || !formData.qty || !formData.production_job_id) return

    if (isWipMode) {
      if (!formData.batch_id) return
      await issueBatchToWip.mutateAsync({
        item_id: formData.item_id,
        batch_id: formData.batch_id,
        qty: Number(formData.qty),
        job_card_id: formData.production_job_id,
        stage: formData.stage,
        wip_location_id: formData.wip_location_id || undefined,
        external_ref: formData.external_ref || `${jobCardRef(selectedJob)}:${selectedBatch?.batch_no || "WIP"}`,
      })
    } else {
      await createIssue.mutateAsync({
        item_id: formData.item_id,
        qty: Number(formData.qty),
        production_job_id: formData.production_job_id,
        reason_code: formData.reason_code,
        allow_raw_paper_exception: Boolean(formData.allow_raw_paper_exception),
        external_ref: formData.external_ref || jobCardRef(selectedJob),
        notes: formData.notes || undefined,
      })
    }

    setFormData((current) => ({
      ...current,
      batch_id: "",
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
              Issue material from a selected batch into WIP against a job card. Controlled manual issue remains available for corrections only.
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
            <p className="text-sm text-slate-500">Default posting creates Store Out and WIP In ledger rows from the same batch.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setFormData((current) => ({ ...current, movement_mode: "WIP" }))}
                className={`rounded-lg px-4 py-2 transition ${isWipMode ? "bg-cyan-900 text-white shadow" : "hover:bg-slate-50"}`}
              >
                Issue to WIP
              </button>
              <button
                type="button"
                onClick={() => setFormData((current) => ({ ...current, movement_mode: "MANUAL" }))}
                className={`rounded-lg px-4 py-2 transition ${!isWipMode ? "bg-cyan-900 text-white shadow" : "hover:bg-slate-50"}`}
              >
                Manual exception
              </button>
            </div>
          </div>

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
              onChange={(event) => setFormData((current) => ({ ...current, item_id: event.target.value, batch_id: "" }))}
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

          {isWipMode ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Batch / Lot</label>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
                  <Barcode className="h-4 w-4 text-slate-400" />
                  <input
                    value={batchScan}
                    onChange={(event) => setBatchScan(event.target.value)}
                    placeholder="Scan batch QR or enter batch no"
                    className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={resolveBatchScan}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-900"
                >
                  Select
                </button>
              </div>
              <select
                value={formData.batch_id}
                onChange={(event) => setFormData((current) => ({ ...current, batch_id: event.target.value }))}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
                required
              >
                <option value="">{itemBalanceQuery.isLoading ? "Loading batches..." : "Select available batch"}</option>
                {itemBatches.map((batch: any) => (
                  <option key={batch.batch_id} value={batch.batch_id}>
                    {batch.batch_no || batch.batch_id} - {Number(batch.available_qty ?? 0).toLocaleString("en-IN")} available - {batch.stock_status}
                  </option>
                ))}
              </select>
              {batchScanMessage ? <p className="text-xs font-semibold text-cyan-800">{batchScanMessage}</p> : null}
            </div>
          ) : null}

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

          {isWipMode ? (
            <>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Production Stage
                <select
                  value={formData.stage}
                  onChange={(event) => setFormData((current) => ({ ...current, stage: event.target.value }))}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
                  required
                >
                  {STAGE_OPTIONS.map((stage) => (
                    <option key={stage} value={stage}>{stage}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                WIP Location
                <select
                  value={formData.wip_location_id}
                  onChange={(event) => setFormData((current) => ({ ...current, wip_location_id: event.target.value }))}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
                >
                  <option value="">System WIP bucket</option>
                  {wipLocations.map((location: any) => (
                    <option key={location.id} value={location.id}>
                      {location.code || location.name || location.id} - {location.warehouse || location.purpose || "WIP"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
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
          )}

          <label className="space-y-2 text-sm font-medium text-slate-700">
            External Reference
            <input
              value={formData.external_ref}
              onChange={(event) => setFormData((current) => ({ ...current, external_ref: event.target.value }))}
              placeholder={selectedJob ? jobCardRef(selectedJob) : "Optional store slip / issue note"}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-700"
            />
          </label>

          {!isWipMode ? (
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
          ) : null}
        </div>

        {isWipMode && selectedBatch ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Batch <span className="font-semibold">{selectedBatch.batch_no || selectedBatch.batch_id}</span> has{" "}
            {Number(selectedBatch.available_qty ?? 0).toLocaleString("en-IN")} available at {selectedBatch.location || "store"}.
          </div>
        ) : null}

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

        {actionError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Issue failed. Check stock balance, item selection, and service logs.
          </div>
        ) : null}

        {actionSuccess ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Material issue posted successfully.
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={actionPending}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {isWipMode ? "Post WIP Issue" : "Post Manual Issue"}
          </button>
        </div>
      </form>
    </div>
  )
}
