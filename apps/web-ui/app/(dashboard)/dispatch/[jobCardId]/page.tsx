"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"

import { DispatchDocument } from "@/components/dispatch/dispatch-document"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { useDispatchByJobCard, useCreateOrUpdateDispatch } from "@/hooks/use-dispatch"
import { useLotAvailability } from "@/hooks/use-inventory"
import { useCustomers } from "@/hooks/use-master-data"
import { usePlanningJobCard } from "@/hooks/use-production"
import { usePlants } from "@/hooks/use-system"
import { buildDispatchDocumentData } from "@/lib/dispatch-document"

export default function DispatchJobCardPage() {
  const params = useParams<{ jobCardId: string }>()
  const router = useRouter()
  const jobCardId = String(params?.jobCardId || "")
  const { activePlant, user } = useAuth()
  const [writePlant, setWritePlant] = useState("")

  const { data: jobCard, isLoading: loadingJob } = usePlanningJobCard(jobCardId || "")
  const { data: existingDispatch, isLoading: loadingDispatch } = useDispatchByJobCard(jobCardId || "")
  const { data: customers } = useCustomers()
  const { data: plants } = usePlants()
  const updateDispatch = useCreateOrUpdateDispatch()
  const [dispatchData, setDispatchData] = useState<any>(null)
  const fgItemId = dispatchData?.fg_item_id || jobCard?.packing_record?.fg_item_id || ""
  const specId = jobCard?.spec_id || jobCard?.spec_snapshot?.spec_id || undefined
  const lotAvailabilityQuery = useLotAvailability(fgItemId || undefined, specId)
  const allowedPlants = Array.isArray(user?.allowed_plant_ids) ? user.allowed_plant_ids.filter(Boolean) : []
  const effectiveWritePlant = activePlant === "ALL" ? writePlant : activePlant || ""

  useEffect(() => {
    if (!jobCard || !customers || !plants || loadingDispatch) return
    setDispatchData(
      buildDispatchDocumentData({
        jobCard,
        dispatchRecord: existingDispatch || undefined,
        customers,
        plants,
      }),
    )
  }, [customers, existingDispatch, jobCard, loadingDispatch, plants])

  if (!jobCardId) return <div className="p-6 text-sm text-slate-500">No job card selected.</div>
  if (loadingJob || loadingDispatch || !dispatchData) return <div className="p-6 text-sm text-slate-500">Loading dispatch details...</div>

  const isSealed = existingDispatch?.status === "SEALED"
  const stages = Array.isArray(jobCard?.stages) ? jobCard.stages : []
  const packingStage = stages.find((stage: any) => stage.stage_type === "PACKING")
  const qcStage = stages.find((stage: any) => stage.stage_type === "QC")
  const activeHoldCount = (jobCard?.quality_holds || []).filter((hold: any) => String(hold?.status || "").toUpperCase() === "HOLD").length
  const lots = Array.isArray(lotAvailabilityQuery.data) ? lotAvailabilityQuery.data : []
  const batchRequired = !isSealed && Number(dispatchData?.summary?.total_pcs || 0) > 0
  const blockingReasons = [
    !jobCard?.packing_record ? "Packing record not completed" : "",
    packingStage && String(packingStage.status || "").toUpperCase() !== "COMPLETED" ? "Packing stage is incomplete" : "",
    qcStage && String(qcStage.status || "").toUpperCase() !== "COMPLETED" ? "QC stage is incomplete" : "",
    activeHoldCount > 0 ? `${activeHoldCount} QC hold(s) active` : "",
    batchRequired && !dispatchData?.fg_batch_id ? "FG lot / batch not selected" : "",
  ].filter(Boolean)
  const dispatchBlocked = !isSealed && blockingReasons.length > 0

  const handleBatchChange = (batchId: string) => {
    const selected = lots.find((row: any) => String(row.batch_id) === String(batchId))
    setDispatchData((current: any) => ({
      ...(current || {}),
      fg_batch_id: batchId,
      selected_batch: selected
        ? {
            batch_id: selected.batch_id,
            batch_no: selected.batch_no,
            available_qty: selected.available_qty,
            lot_no: selected.lot_no || selected.batch_no,
          }
        : null,
    }))
  }

  const handleSave = (status: "DRAFT" | "SEALED") => {
    if (!effectiveWritePlant) {
      alert("Select one plant before drafting or sealing dispatch.")
      return
    }
    if (dispatchBlocked) {
      alert(`Dispatch blocked: ${blockingReasons.join(", ")}`)
      return
    }
    if (status === "SEALED" && !confirm("Seal this dispatch and lock further edits?")) return

    const summary = dispatchData?.summary || {}
    const dispatchQty = Number(summary.total_pcs || summary.total_units || 0) || undefined
    const salesOrderLineId = dispatchData?.sales_order_line_id || jobCard?.sales_order_line_id || jobCard?.sales_order?.line_id
    const fgItemId = dispatchData?.fg_item_id || undefined
    const fgBatchId = dispatchData?.fg_batch_id || undefined
    const existingRequestId = dispatchData?.dispatch_request_id || existingDispatch?.dispatch_snapshot?.dispatch_request_id
    const generatedRequestId = `dispatch-${jobCardId}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}`}`
    const dispatchRequestId = status === "SEALED" ? existingRequestId || generatedRequestId : undefined

    updateDispatch.mutate(
      {
        plantId: effectiveWritePlant,
        data: {
        job_card_id: jobCardId,
        dispatch_snapshot: dispatchData,
        status,
        dispatch_request_id: dispatchRequestId,
        sales_order_line_id: salesOrderLineId || undefined,
        fg_item_id: fgItemId,
        fg_batch_id: fgBatchId,
        dispatch_qty: dispatchQty,
        },
      },
      {
        onSuccess: () => {
          if (status === "SEALED") {
            router.push(`/dispatch/${jobCardId}/print`)
            return
          }
          router.push("/dispatch")
        },
        onError: (error: any) => {
          alert(`Error saving dispatch: ${error.response?.data?.detail || error.message}`)
        },
      },
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-white/70 bg-white/90 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Dispatch Workbench</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              {isSealed ? "View sealed dispatch" : "Draft and seal dispatch"}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              The dispatch snapshot is generated from the released job card and finished-goods truth. Seal only after the packed quantity and customer handoff details are correct.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="dispatch-new:cancel" variant="outline" onClick={() => router.push("/dispatch")}>
              Back to queue
            </Button>
            {!isSealed ? (
              <>
                <Button data-testid="dispatch-new:save-draft" variant="secondary" onClick={() => handleSave("DRAFT")} disabled={updateDispatch.isPending || dispatchBlocked}>
                  Save draft
                </Button>
                <Button data-testid="dispatch-new:seal" onClick={() => handleSave("SEALED")} disabled={updateDispatch.isPending || dispatchBlocked} className="bg-slate-900 text-white hover:bg-slate-800">
                  Seal dispatch
                </Button>
              </>
            ) : (
              <Button data-testid="dispatch-new:print" onClick={() => router.push(`/dispatch/${jobCardId}/print`)} className="bg-slate-900 text-white hover:bg-slate-800">
                Print challan
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-4 shadow-lg">
        {dispatchBlocked ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Dispatch is blocked until the job card is fully ready. {blockingReasons.join(", ")}.
          </div>
        ) : null}
        {activePlant === "ALL" ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Owner/Admin all-plants scope stays read-only for queries. Select one plant below for this dispatch write.
          </div>
        ) : null}
        {activePlant === "ALL" ? (
          <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:max-w-md">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Write Plant</label>
            <select
              value={writePlant}
              onChange={(event) => setWritePlant(event.target.value)}
              className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">Select plant for dispatch</option>
              {allowedPlants.map((plantId) => (
                <option key={plantId} value={plantId}>
                  {plantId}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="mb-4 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dispatch FG Allocation</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">Select finished-good lot at dispatch</h2>
            <p className="mt-1 text-sm text-slate-600">
              Made-to-order flow consumes FG lots directly during dispatch. The legacy standalone FG pre-allocation step is removed.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">FG Lot / Batch</label>
            <select
              value={dispatchData?.fg_batch_id || ""}
              onChange={(event) => handleBatchChange(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
              disabled={isSealed || lotAvailabilityQuery.isLoading}
            >
              <option value="">Select finished-good lot</option>
              {lots.map((lot: any) => (
                <option key={lot.batch_id} value={lot.batch_id}>
                  {(lot.batch_no || lot.lot_no || String(lot.batch_id).slice(0, 8))} | Avl {Number(lot.available_qty || 0).toFixed(0)}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              {dispatchData?.selected_batch?.batch_no
                ? `Selected ${dispatchData.selected_batch.batch_no} with ${Number(dispatchData.selected_batch.available_qty || 0).toFixed(0)} available`
                : "Pick the exact FG lot that will be consumed by this dispatch."}
            </p>
          </div>
        </div>
        <DispatchDocument dispatchData={dispatchData} onChange={isSealed ? undefined : setDispatchData} printMode={false} />
      </div>
    </div>
  )
}
