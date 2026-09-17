"use client"

import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel, StatusBadge } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { RoleGate } from "@/components/workspace/role-gate"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateCustomerRejection,
  useCustomerRejections,
  useDisposeCustomerRejection,
  useInventoryItems,
  useInventoryLocations,
} from "@/hooks/use-inventory"
import {
  useCreateQualityHold,
  usePlanningJobCards,
  useQualityHolds,
  useQualityInspections,
  useReleaseQualityHold,
} from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function asArray(value: any) {
  return Array.isArray(value) ? value : []
}

function jobLabel(job: any) {
  return [job.job_card_no || job.job_no || String(job.id || "").slice(0, 8), job.product_code || job.spec_no]
    .filter(Boolean)
    .join(" | ")
}

function plantForJob(job: any) {
  const value = String(job?.plant_id || job?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

export default function QualityResultsPage() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const [selectedJobId, setSelectedJobId] = useState("")
  const [stageType, setStageType] = useState("WINDER")
  const [manualHoldReason, setManualHoldReason] = useState("")
  const [customerReturn, setCustomerReturn] = useState({
    item_id: "",
    rejected_qty: "",
    customer_name: "",
    reason_code: "CUSTOMER_REJECT",
    reason_notes: "",
    location_id: "",
  })
  const jobCardsQuery = usePlanningJobCards({ limit: 200 })
  const inspectionsQuery = useQualityInspections({ limit: 120 })
  const holdsQuery = useQualityHolds({ limit: 120 })
  const itemsQuery = useInventoryItems()
  const locationsQuery = useInventoryLocations()
  const customerRejectionsQuery = useCustomerRejections({ limit: 80 })
  const createHold = useCreateQualityHold()
  const releaseHold = useReleaseQualityHold()
  const createCustomerRejection = useCreateCustomerRejection()
  const disposeCustomerRejection = useDisposeCustomerRejection()
  const jobs = useMemo(() => asArray(jobCardsQuery.data), [jobCardsQuery.data])
  const inspections = useMemo(() => asArray(inspectionsQuery.data), [inspectionsQuery.data])
  const holds = useMemo(() => asArray(holdsQuery.data), [holdsQuery.data])
  const inventoryItems = useMemo(() => asArray(itemsQuery.data), [itemsQuery.data])
  const locations = useMemo(() => asArray(locationsQuery.data), [locationsQuery.data])
  const customerRejections = useMemo(() => asArray(customerRejectionsQuery.data), [customerRejectionsQuery.data])
  const finishedGoods = inventoryItems.filter((item: any) => String(item.type || "").toUpperCase() === "FINISHED_GOOD")
  const jobMap = useMemo(() => {
    const rows = new Map<string, any>()
    jobs.forEach((job: any) => rows.set(String(job.id), job))
    return rows
  }, [jobs])
  const activeHolds = holds.filter((hold: any) => String(hold.status || "").toUpperCase() === "HOLD")

  const mutationPlantForJob = (jobId: string) => {
    const jobPlant = plantForJob(jobMap.get(String(jobId)))
    if (jobPlant) return jobPlant
    if (activePlant && activePlant.toUpperCase() !== "ALL") return activePlant
    return undefined
  }

  const handleManualHoldSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedJobId || !manualHoldReason.trim()) {
      showToast("Select a job card and enter a hold reason.", "error")
      return
    }
    const plantId = mutationPlantForJob(selectedJobId)
    if (!plantId) {
      showToast("Switch to the job plant before creating quality records.", "error")
      return
    }
    try {
      await createHold.mutateAsync({
        plantId,
        data: { job_card_id: selectedJobId, stage_type: stageType, reason: manualHoldReason.trim() },
      })
      setManualHoldReason("")
      showToast("Quality hold created.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Hold creation failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleReleaseHold = async (hold: any) => {
    const plantId = mutationPlantForJob(String(hold.job_card_id || ""))
    if (!plantId) {
      showToast("Switch to the hold's plant before releasing it.", "error")
      return
    }
    try {
      await releaseHold.mutateAsync({ holdId: String(hold.id), plantId })
      showToast("Quality hold released.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Hold release failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  return (
    <RoleGate allow={["QC", "PlantManager", "Store", "Dispatch", "Sales"]}>
      <div className="space-y-6" data-testid="quality-results-page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.analytics}
          badge="Results / holds"
          title="Inspections, holds, and dispositions stay off the measurement form."
          description="This desk does not author a measured PASS. Release and customer dispositions are separate from incoming and stage readings."
        />
        <QualityDeskNav />
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Latest inspections" subtitle="Server verdicts from stage and incoming measurements.">
            {inspections.length === 0 ? (
              <EmptyState label="No inspections recorded." />
            ) : (
              inspections.slice(0, 12).map((row: any) => (
                <article key={row.id} className="mb-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">{row.stage_type || row.source || "Inspection"}</p>
                    <StatusBadge value={row.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {(row.evaluation?.frozen_rules || row.frozen_rules || []).map((rule: any) => rule.allowed_display).filter(Boolean).slice(0, 3).join(" · ") || "No frozen range displayed"}
                  </p>
                </article>
              ))
            )}
          </Panel>
          <Panel title="Active holds" subtitle="Holds open from FAIL measurements or a manual QC hold.">
            <form className="mb-4 grid gap-2 md:grid-cols-[1fr_8rem_1fr_auto]" onSubmit={handleManualHoldSubmit}>
              <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
                <option value="">Job card</option>
                {jobs.slice(0, 80).map((job: any) => (
                  <option key={job.id} value={job.id}>{jobLabel(job)}</option>
                ))}
              </select>
              <select value={stageType} onChange={(event) => setStageType(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
                {["WINDER", "OVEN", "PROCESS", "QC"].map((stage) => (
                  <option key={stage} value={stage}>{stage}</option>
                ))}
              </select>
              <input value={manualHoldReason} onChange={(event) => setManualHoldReason(event.target.value)} placeholder="Hold reason" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
              <button type="submit" className="rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white">Hold</button>
            </form>
            {activeHolds.length === 0 ? (
              <EmptyState label="No active holds." />
            ) : (
              activeHolds.map((hold: any) => (
                <article key={hold.id} className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{hold.stage_type}</p>
                    <p className="text-xs text-slate-600">{hold.reason}</p>
                  </div>
                  <button type="button" onClick={() => handleReleaseHold(hold)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold">
                    Release
                  </button>
                </article>
              ))
            )}
          </Panel>
        </div>
        <Panel title="Customer rejection dispositions" subtitle="Returned FG dispositions stay here, not on the incoming measurement form.">
          <form
            className="mb-4 grid gap-2 md:grid-cols-3"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!customerReturn.item_id || !customerReturn.customer_name || !customerReturn.rejected_qty) {
                showToast("Finished good, customer, and rejected qty are required.", "error")
                return
              }
              try {
                await createCustomerRejection.mutateAsync({
                  item_id: customerReturn.item_id,
                  rejected_qty: Number(customerReturn.rejected_qty),
                  customer_name: customerReturn.customer_name,
                  reason_code: customerReturn.reason_code,
                  reason_notes: customerReturn.reason_notes || undefined,
                  location_id: customerReturn.location_id || undefined,
                })
                showToast("Customer rejection recorded under QC hold.", "success")
              } catch (error: any) {
                const detail = error?.response?.data?.detail || error?.message || "Customer return failed."
                showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
              }
            }}
          >
            <select required value={customerReturn.item_id} onChange={(event) => setCustomerReturn((current) => ({ ...current, item_id: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
              <option value="">Finished good</option>
              {finishedGoods.map((item: any) => (
                <option key={item.id} value={item.id}>{item.item_code} - {item.name}</option>
              ))}
            </select>
            <input required type="number" min="0.001" step="0.001" placeholder="Rejected qty" value={customerReturn.rejected_qty} onChange={(event) => setCustomerReturn((current) => ({ ...current, rejected_qty: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input required placeholder="Customer name" value={customerReturn.customer_name} onChange={(event) => setCustomerReturn((current) => ({ ...current, customer_name: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <select value={customerReturn.location_id} onChange={(event) => setCustomerReturn((current) => ({ ...current, location_id: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
              <option value="">Location</option>
              {locations.map((row: any) => (
                <option key={row.id} value={row.id}>{row.code || row.name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-xl bg-rose-950 px-4 text-sm font-semibold text-white">Inward rejected FG</button>
          </form>
          {customerRejections.length === 0 ? (
            <EmptyState label="No customer rejections recorded." />
          ) : (
            customerRejections.slice(0, 8).map((row: any) => (
              <article key={row.id} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{row.customer_name} · qty {row.rejected_qty}</p>
                  <p className="text-xs text-slate-500">{row.reason_code}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge value={row.status} />
                  {["REWORK", "SCRAP", "BLOCK"].map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => disposeCustomerRejection.mutateAsync({ id: row.id, data: { disposition: action } })}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </article>
            ))
          )}
        </Panel>
      </div>
    </RoleGate>
  )
}
