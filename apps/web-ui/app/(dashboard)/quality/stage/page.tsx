"use client"

import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { StageQcFields } from "@/components/qc/StageQcFields"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useCompleteJobCardQc, useCreateQualityInspection, useJobQcTemplate, usePlanningJobCards } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { frozenStageRules, inspectionProfileRevision, type QcStageKey } from "@/lib/qc-measurement"

const STAGES: { value: QcStageKey; label: string }[] = [
  { value: "WINDER", label: "Winding" },
  { value: "OVEN", label: "Oven" },
  { value: "PROCESS", label: "Process" },
]

type StageDraft = {
  readings: Record<string, string>
  reasons: Record<string, string>
  sampleId: string
  ovenCheckpoint: "PRE" | "POST"
}

function emptyDraft(): StageDraft {
  return { readings: {}, reasons: {}, sampleId: "", ovenCheckpoint: "PRE" }
}

function asArray(value: any) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.results)) return value.results
  return []
}

function jobLabel(job: any) {
  return [job.job_card_no || job.job_no || String(job.id || "").slice(0, 8), job.product_code || job.spec_no, job.current_stage]
    .filter(Boolean)
    .join(" | ")
}

function jobMatchesSearch(job: any, needle: string) {
  if (!needle) return true
  const hay = [jobLabel(job), job.id, job.job_card_no, job.job_no, job.product_code, job.spec_no]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return hay.includes(needle)
}

function plantForJob(job: any) {
  const value = String(job?.plant_id || job?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

function numericReadings(stageType: QcStageKey, draft: StageDraft) {
  const numeric: Record<string, string | number> = Object.fromEntries(
    Object.entries(draft.readings)
      .filter(([key, value]) => {
        if (String(value).trim() === "") return false
        if (stageType === "OVEN" && draft.ovenCheckpoint === "PRE" && String(key).startsWith("post_")) return false
        if (stageType === "OVEN" && draft.ovenCheckpoint === "POST" && (key === "pre_weight" || key === "pre_moisture")) return false
        return true
      })
      .map(([key, value]) => {
        const number = Number(value)
        return [key, Number.isFinite(number) ? number : value]
      }),
  )
  if (stageType === "OVEN") {
    numeric.oven_checkpoint = draft.ovenCheckpoint
    if (draft.sampleId) {
      numeric.sample_id = draft.sampleId
      if (draft.ovenCheckpoint === "PRE") numeric.pre_specimen_id = draft.sampleId
      if (draft.ovenCheckpoint === "POST") {
        numeric.post_specimen_id = draft.sampleId
        numeric.pre_specimen_id = draft.sampleId
      }
    }
  }
  return numeric
}

export default function StageQualityPage() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedJobId, setSelectedJobId] = useState("")
  const [stageType, setStageType] = useState<QcStageKey>("WINDER")
  const [drafts, setDrafts] = useState<Record<QcStageKey, StageDraft>>({
    WINDER: emptyDraft(),
    OVEN: emptyDraft(),
    PROCESS: emptyDraft(),
  })
  const [lastVerdict, setLastVerdict] = useState("")
  const [cardIssues, setCardIssues] = useState<any[]>([])
  const jobCardsQuery = usePlanningJobCards({ limit: 80, search: search.trim() || undefined })
  const createInspection = useCreateQualityInspection()
  const completeCard = useCompleteJobCardQc()
  const jobs = useMemo(() => asArray(jobCardsQuery.data), [jobCardsQuery.data])
  const selectedJob = jobs.find((job: any) => String(job.id) === selectedJobId) || null
  const plantId = plantForJob(selectedJob) || (activePlant && activePlant.toUpperCase() !== "ALL" ? activePlant : undefined)
  const templateQuery = useJobQcTemplate(selectedJobId || undefined, stageType, plantId)
  const snapshotProfile = selectedJob?.spec_snapshot?.qc_profile || templateQuery.data?.qc_profile
  const stageBlock = templateQuery.data?.stages?.[stageType]
  const rules = asArray(stageBlock?.parameters).length
    ? stageBlock.parameters
    : frozenStageRules(snapshotProfile, stageType)
  const profileRevision = inspectionProfileRevision(null, snapshotProfile || templateQuery.data)
  const draft = drafts[stageType]
  const checkpoint = stageType === "OVEN"
    ? (draft.ovenCheckpoint === "POST" ? "Oven post" : "Oven pre")
    : STAGES.find((stage) => stage.value === stageType)?.label

  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = needle ? jobs.filter((job: any) => jobMatchesSearch(job, needle)) : jobs
    return rows.slice(0, 80)
  }, [jobs, search])

  const updateDraft = (stage: QcStageKey, patch: Partial<StageDraft> | ((current: StageDraft) => StageDraft)) => {
    setDrafts((current) => {
      const prior = current[stage] || emptyDraft()
      const next = typeof patch === "function" ? patch(prior) : { ...prior, ...patch }
      return { ...current, [stage]: next }
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedJobId) {
      showToast("Select a job card before saving inspection.", "error")
      return
    }
    if (!plantId) {
      showToast("Switch to the job plant before creating quality records.", "error")
      return
    }
    try {
      const response = await createInspection.mutateAsync({
        plantId,
        data: {
          job_card_id: selectedJobId,
          stage_type: stageType,
          readings: numericReadings(stageType, draft),
          reasons: draft.reasons,
          sample_id: draft.sampleId || undefined,
          create_hold_on_fail: true,
        },
      })
      const status = String(response?.data?.status || "")
      setLastVerdict(status)
      showToast(`Server verdict: ${status}`, status === "FAIL" || status === "INCOMPLETE" || status === "INVALID" ? "error" : "success")
      updateDraft(stageType, (current) => {
        if (stageType !== "OVEN") return { ...emptyDraft(), sampleId: current.sampleId }
        const nextReadings: Record<string, string> = {}
        if (current.ovenCheckpoint === "PRE") {
          for (const [key, value] of Object.entries(current.readings)) {
            if (String(key).startsWith("pre_")) nextReadings[key] = value
          }
        }
        return { ...current, readings: nextReadings, reasons: {} }
      })
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Inspection save failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleCompleteCard = async () => {
    if (!selectedJobId) {
      showToast("Select a job card before submitting the complete card.", "error")
      return
    }
    if (!plantId) {
      showToast("Switch to the job plant before submitting the complete card.", "error")
      return
    }
    try {
      const response = await completeCard.mutateAsync({
        jobCardId: selectedJobId,
        plantId,
        data: {
          visible_stage: stageType,
          stages: STAGES.map((stage) => ({
            stage_type: stage.value,
            readings: numericReadings(stage.value, drafts[stage.value]),
            reasons: drafts[stage.value].reasons,
            sample_id: drafts[stage.value].sampleId || undefined,
          })),
        },
      })
      const body = response?.data || {}
      const issues = asArray(body.issues)
      setCardIssues(issues)
      const accepted = Boolean(body.accepted)
      setLastVerdict(accepted ? "PASS" : "INCOMPLETE")
      showToast(
        accepted ? "Complete job card accepted." : `Server returned ${issues.length} stage/sample issue(s). Form data was kept.`,
        accepted ? "success" : "error",
      )
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Complete job card submit failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  return (
    <RoleGate allow={["QC", "PlantManager"]}>
      <div className="space-y-6" data-testid="quality-stage-page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.analytics}
          badge="Stage QC"
          title="Exact winding, oven, and process fields against frozen Allowed ranges."
          description="Winding uses Height, not Length. Oven pre/post pairs share one sample ID. Process notch fields appear only when applicable. Verdicts are never taken from the client."
        />
        <QualityDeskNav />
        {jobCardsQuery.isLoading ? <LoadingState label="Loading job cards for stage QC…" /> : null}
        {jobCardsQuery.isError ? (
          <ErrorState
            message="Job cards for stage QC could not be loaded."
            onRetry={() => {
              void jobCardsQuery.refetch()
            }}
          />
        ) : null}
        <Panel title="Job-card stage inspection" subtitle="Frozen ranges come from the job's spec snapshot QC profile.">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Job card</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search job card"
                  data-testid="quality-stage-job-search"
                  className="mb-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                />
                <select
                  value={selectedJobId}
                  onChange={(event) => {
                    setSelectedJobId(event.target.value)
                    setDrafts({ WINDER: emptyDraft(), OVEN: emptyDraft(), PROCESS: emptyDraft() })
                    setLastVerdict("")
                    setCardIssues([])
                  }}
                  data-testid="quality-stage-job"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Select job card</option>
                  {filteredJobs.map((job: any) => (
                    <option key={job.id} value={job.id}>{jobLabel(job)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Stage</span>
                <select
                  value={stageType}
                  onChange={(event) => {
                    setStageType(event.target.value as QcStageKey)
                    setLastVerdict("")
                  }}
                  data-testid="quality-stage-type"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm"
                >
                  {STAGES.map((stage) => (
                    <option key={stage.value} value={stage.value}>{stage.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="quality-stage-tabs">
              {STAGES.map((stage) => (
                <button
                  key={stage.value}
                  type="button"
                  data-testid={`quality-stage-tab-${stage.value}`}
                  aria-pressed={stageType === stage.value}
                  onClick={() => {
                    setStageType(stage.value)
                    setLastVerdict("")
                  }}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                    stageType === stage.value ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {stage.label}
                </button>
              ))}
            </div>
            {stageType === "OVEN" ? (
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Oven checkpoint</span>
                <select
                  value={draft.ovenCheckpoint}
                  onChange={(event) => {
                    const next = event.target.value as "PRE" | "POST"
                    setLastVerdict("")
                    updateDraft("OVEN", (current) => {
                      const readings = { ...current.readings }
                      if (next === "POST") {
                        delete readings.pre_weight
                        delete readings.pre_moisture
                      }
                      return { ...current, ovenCheckpoint: next, readings }
                    })
                  }}
                  data-testid="quality-stage-checkpoint"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm md:max-w-sm"
                >
                  <option value="PRE">Before oven — pre-weight / pre-moisture</option>
                  <option value="POST">After oven — post-weight / post-moisture</option>
                </select>
                <p className="text-xs text-slate-500">
                  Post fields are not due at the pre checkpoint. The later post checkpoint requires the same sample / pair ID.
                </p>
              </label>
            ) : null}
            {selectedJobId ? (
              <StageQcFields
                rules={rules}
                readings={draft.readings}
                reasons={draft.reasons}
                sampleId={draft.sampleId}
                paired={stageType === "OVEN"}
                profileRevision={profileRevision}
                checkpoint={checkpoint}
                dueTiming={stageType === "OVEN" ? draft.ovenCheckpoint : null}
                onReadingChange={(code, value) => updateDraft(stageType, (current) => ({ ...current, readings: { ...current.readings, [code]: value } }))}
                onReasonChange={(code, value) => updateDraft(stageType, (current) => ({ ...current, reasons: { ...current.reasons, [code]: value } }))}
                onSampleIdChange={(value) => updateDraft(stageType, { sampleId: value })}
              />
            ) : (
              <EmptyState label="Select a job card to load frozen Allowed ranges." />
            )}
            {lastVerdict ? (
              <div className="text-sm font-semibold text-slate-900" data-testid="quality-stage-verdict">
                {lastVerdict}
              </div>
            ) : null}
            {cardIssues.length ? (
              <ul className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-800" data-testid="quality-card-issues">
                {cardIssues.map((issue, index) => (
                  <li
                    key={`${issue.stage}-${issue.parameter}-${issue.sample || ""}-${index}`}
                    data-testid={`quality-card-issue-${issue.stage}-${issue.parameter}`}
                  >
                    {issue.stage} / {issue.parameter}
                    {issue.sample ? ` / sample ${issue.sample}` : ""}: {issue.outcome}
                    {issue.approved_rule ? ` (${issue.approved_rule})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                data-testid="quality-stage-submit"
                disabled={!selectedJobId || createInspection.isPending}
                className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Submit stage readings
              </button>
              <button
                type="button"
                data-testid="quality-card-submit"
                disabled={!selectedJobId || completeCard.isPending}
                onClick={() => {
                  void handleCompleteCard()
                }}
                className="rounded-xl border border-slate-900 px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-60"
              >
                Submit complete job card
              </button>
            </div>
          </form>
        </Panel>
      </div>
    </RoleGate>
  )
}
