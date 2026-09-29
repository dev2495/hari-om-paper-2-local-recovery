"use client"

import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel, StatusBadge } from "@/components/erp/shell"
import { CustomerReturnsPanel } from "@/components/qc/CustomerReturnsPanel"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useInventoryQualityInspections } from "@/hooks/use-inventory"
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

function errorText(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || fallback
}

const EMPTY_RELEASE = { reason: "", disposition: "RELEASE_AS_IS", affected_qty: "" }

export default function QualityResultsPage() {
  const { showToast } = useApp()
  const { activePlant, user } = useAuth()
  const roles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const canManageHolds = ["Owner", "Admin", "PlantManager", "QC"].some((role) => roles.has(role))
  const [selectedJobId, setSelectedJobId] = useState("")
  const [stageType, setStageType] = useState("WINDER")
  const [manualHoldReason, setManualHoldReason] = useState("")
  const [releasing, setReleasing] = useState<string | null>(null)
  const [release, setRelease] = useState(EMPTY_RELEASE)
  const [incomingPage, setIncomingPage] = useState(0)
  const incomingQuery = useInventoryQualityInspections({ limit: 25, offset: incomingPage * 25 })
  const jobCardsQuery = usePlanningJobCards({ limit: 200 })
  const inspectionsQuery = useQualityInspections({ limit: 120 })
  const holdsQuery = useQualityHolds({ limit: 120 })
  const createHold = useCreateQualityHold()
  const releaseHold = useReleaseQualityHold()
  const jobs = useMemo(() => asArray(jobCardsQuery.data), [jobCardsQuery.data])
  const inspections = useMemo(() => asArray(inspectionsQuery.data), [inspectionsQuery.data])
  const holds = useMemo(() => asArray(holdsQuery.data), [holdsQuery.data])
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
      showToast(errorText(error, "Hold creation failed."), "error")
    }
  }

  const handleReleaseHold = async (hold: any) => {
    const plantId = mutationPlantForJob(String(hold.job_card_id || ""))
    if (!plantId) {
      showToast("Switch to the hold's plant before releasing it.", "error")
      return
    }
    if (release.reason.trim().length < 3) {
      showToast("Say why the hold can be released and what was done with the material.", "error")
      return
    }
    try {
      await releaseHold.mutateAsync({
        holdId: String(hold.id),
        plantId,
        data: {
          reason: release.reason.trim(),
          disposition: release.disposition,
          affected_qty: release.affected_qty ? Number(release.affected_qty) : undefined,
        },
      })
      setReleasing(null)
      setRelease(EMPTY_RELEASE)
      showToast("Quality hold released.", "success")
    } catch (error: any) {
      showToast(errorText(error, "Hold release failed."), "error")
    }
  }

  return (
    <RoleGate allow={["QC", "PlantManager", "Store", "Dispatch", "Sales"]}>
      <div className="space-y-6" data-testid="quality-results-page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.analytics}
          badge="Results / holds"
          title="Results & dispositions"
          description="Review recorded results, release production holds with a reason, and receive and decide customer returns. Measured PASS/FAIL is only ever recorded on the incoming and stage desks."
        />
        <QualityDeskNav />
        <Panel title="Incoming inspection register" subtitle="Original results, measurements and inspector notes remain visible after a lot is released.">
          {incomingQuery.isLoading ? (
            <LoadingState label="Loading incoming history…" />
          ) : incomingQuery.isError ? (
            <ErrorState message="Incoming history could not load." onRetry={() => incomingQuery.refetch()} />
          ) : !(incomingQuery.data || []).length ? (
            <p className="text-sm text-muted-foreground">No incoming inspections on this page.</p>
          ) : (
            <div className="space-y-2">
              {(incomingQuery.data || []).map((row: any) => (
                <details key={row.id} className="rounded-lg border border-border p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                    <span className="mr-auto font-medium">{row.entity_label || `${row.material_type} · ${String(row.entity_id).slice(0, 8)}`}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(/Z$|[+-]\d{2}:\d{2}$/.test(row.created_at) ? row.created_at : `${row.created_at}Z`).toLocaleString("en-IN")}
                    </span>
                    <StatusBadge value={row.status} />
                  </summary>
                  <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">Recorded measurements</p>
                      <dl className="mt-2 space-y-1">
                        {Object.entries(row.readings || {}).map(([key, value]) => (
                          <div className="flex justify-between text-sm" key={key}>
                            <dt>{key.replaceAll("_", " ")}</dt>
                            <dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    <div className="text-sm">
                      <p><strong>Inspector:</strong> {row.created_by || "Recorded"}</p>
                      <p className="mt-2"><strong>Notes:</strong> {row.notes || "—"}</p>
                      <p className="mt-2"><strong>Disposition:</strong> {row.disposition || "Measured result"}</p>
                      {row.evaluation?.resolved_hold_ids?.length ? (
                        <p className="mt-2">Resolved {row.evaluation.resolved_hold_ids.length} prior inspection hold(s) after reinspection.</p>
                      ) : null}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-3 text-sm">
            <button className="erp-btn-secondary" disabled={!incomingPage || incomingQuery.isFetching} onClick={() => setIncomingPage(incomingPage - 1)}>Previous</button>
            <span className="self-center">Page {incomingPage + 1}</span>
            <button className="erp-btn-secondary" disabled={(incomingQuery.data || []).length < 25 || incomingQuery.isFetching} onClick={() => setIncomingPage(incomingPage + 1)}>Next</button>
          </div>
        </Panel>
        {inspectionsQuery.isLoading || holdsQuery.isLoading ? <LoadingState label="Loading quality results…" /> : null}
        {inspectionsQuery.isError || holdsQuery.isError ? (
          <ErrorState
            message="Quality results could not be loaded. Empty lists here are not proof that holds are clear."
            onRetry={() => {
              void inspectionsQuery.refetch()
              void holdsQuery.refetch()
            }}
          />
        ) : null}
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Latest inspections" subtitle="Production inspection verdicts and frozen specification ranges.">
            {inspectionsQuery.isLoading ? (
              <LoadingState label="Loading inspections…" />
            ) : inspections.length === 0 ? (
              <EmptyState label="No inspections recorded." />
            ) : (
              inspections.slice(0, 12).map((row: any) => (
                <article key={row.id} className="mb-2 rounded-2xl border border-border bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      {row.stage_type === "QC" ? "Final QC" : row.stage_type || row.source || "Inspection"}
                      {row.job_card_id && jobMap.get(String(row.job_card_id)) ? ` · ${jobLabel(jobMap.get(String(row.job_card_id)))}` : ""}
                    </p>
                    <StatusBadge value={row.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {(row.evaluation?.frozen_rules || row.frozen_rules || []).map((rule: any) => rule.allowed_display).filter(Boolean).slice(0, 3).join(" · ") || "No frozen range displayed"}
                  </p>
                </article>
              ))
            )}
          </Panel>
          <Panel title="Active holds" subtitle="Holds open from FAIL measurements or a manual QC hold. Releasing records why and what was done.">
            {canManageHolds ? (
              <form className="mb-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto]" onSubmit={handleManualHoldSubmit}>
                <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)} className="h-11 rounded-xl border border-border px-3 text-sm">
                  <option value="">Job card</option>
                  {jobs.slice(0, 80).map((job: any) => (
                    <option key={job.id} value={job.id}>{jobLabel(job)}</option>
                  ))}
                </select>
                <select value={stageType} onChange={(event) => setStageType(event.target.value)} className="h-11 rounded-xl border border-border px-3 text-sm">
                  {[
                    { value: "WINDER", label: "Winding" },
                    { value: "OVEN", label: "Oven" },
                    { value: "PROCESS", label: "Process" },
                    { value: "QC", label: "Final QC" },
                  ].map((stage) => (
                    <option key={stage.value} value={stage.value}>{stage.label}</option>
                  ))}
                </select>
                <input value={manualHoldReason} onChange={(event) => setManualHoldReason(event.target.value)} placeholder="Hold reason" className="h-11 rounded-xl border border-border px-3 text-sm" />
                <button type="submit" disabled={createHold.isPending} className="rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">Hold</button>
              </form>
            ) : null}
            {activeHolds.length === 0 ? (
              <EmptyState label="No active holds." />
            ) : (
              activeHolds.map((hold: any) => (
                <article key={hold.id} className="mb-2 rounded-2xl border border-signal-rose-line bg-signal-rose-soft px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {hold.stage_type === "QC" ? "Final QC" : hold.stage_type} ·{" "}
                        {jobMap.get(String(hold.job_card_id)) ? jobLabel(jobMap.get(String(hold.job_card_id))) : String(hold.job_card_id || "").slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">{hold.reason}</p>
                    </div>
                    {canManageHolds ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRelease(EMPTY_RELEASE)
                          setReleasing(releasing === String(hold.id) ? null : String(hold.id))
                        }}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold"
                      >
                        {releasing === String(hold.id) ? "Cancel" : "Release…"}
                      </button>
                    ) : null}
                  </div>
                  {releasing === String(hold.id) ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem_8rem_auto]" data-testid="hold-release-form">
                      <input value={release.reason} onChange={(event) => setRelease((current) => ({ ...current, reason: event.target.value }))} placeholder="Why it can be released" className="h-10 rounded-xl border border-border bg-card px-3 text-sm" />
                      <select value={release.disposition} onChange={(event) => setRelease((current) => ({ ...current, disposition: event.target.value }))} className="h-10 rounded-xl border border-border bg-card px-2 text-sm">
                        <option value="RELEASE_AS_IS">Released as is</option>
                        <option value="REWORKED">Reworked, now OK</option>
                        <option value="SORTED">Sorted / segregated</option>
                        <option value="PARTLY_SCRAPPED">Part scrapped</option>
                      </select>
                      <input type="number" min={0} value={release.affected_qty} onChange={(event) => setRelease((current) => ({ ...current, affected_qty: event.target.value }))} placeholder="Qty affected" className="h-10 rounded-xl border border-border bg-card px-3 text-sm" />
                      <button type="button" disabled={releaseHold.isPending} onClick={() => void handleReleaseHold(hold)} className="h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                        Release hold
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </Panel>
        </div>
        <CustomerReturnsPanel />
      </div>
    </RoleGate>
  )
}
