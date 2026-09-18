"use client"

import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { StageQcFields } from "@/components/qc/StageQcFields"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useCreateQualityInspection, useJobQcTemplate, usePlanningJobCards } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { frozenStageRules, inspectionProfileRevision, type QcStageKey } from "@/lib/qc-measurement"

const STAGES: { value: QcStageKey; label: string }[] = [
  { value: "WINDER", label: "Winding" },
  { value: "OVEN", label: "Oven" },
  { value: "PROCESS", label: "Process" },
]

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

export default function StageQualityPage() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedJobId, setSelectedJobId] = useState("")
  const [stageType, setStageType] = useState<QcStageKey>("WINDER")
  const [readings, setReadings] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [sampleId, setSampleId] = useState("")
  const [ovenCheckpoint, setOvenCheckpoint] = useState<"PRE" | "POST">("PRE")
  const [lastVerdict, setLastVerdict] = useState("")
  const jobCardsQuery = usePlanningJobCards({ limit: 80, search: search.trim() || undefined })
  const createInspection = useCreateQualityInspection()
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
  const checkpoint = stageType === "OVEN"
    ? (ovenCheckpoint === "POST" ? "Oven post" : "Oven pre")
    : STAGES.find((stage) => stage.value === stageType)?.label

  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = needle ? jobs.filter((job: any) => jobMatchesSearch(job, needle)) : jobs
    return rows.slice(0, 80)
  }, [jobs, search])

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
      const numericReadings = Object.fromEntries(
        Object.entries(readings)
          .filter(([key, value]) => {
            if (String(value).trim() === "") return false
            if (stageType === "OVEN" && ovenCheckpoint === "PRE" && String(key).startsWith("post_")) return false
            if (stageType === "OVEN" && ovenCheckpoint === "POST" && (key === "pre_weight" || key === "pre_moisture")) return false
            return true
          })
          .map(([key, value]) => {
            const number = Number(value)
            return [key, Number.isFinite(number) ? number : value]
          }),
      )
      if (stageType === "OVEN") {
        numericReadings.oven_checkpoint = ovenCheckpoint
        if (sampleId) {
          numericReadings.sample_id = sampleId
          if (ovenCheckpoint === "PRE") numericReadings.pre_specimen_id = sampleId
          if (ovenCheckpoint === "POST") {
            numericReadings.post_specimen_id = sampleId
            numericReadings.pre_specimen_id = sampleId
          }
        }
      }
      const response = await createInspection.mutateAsync({
        plantId,
        data: {
          job_card_id: selectedJobId,
          stage_type: stageType,
          readings: numericReadings,
          reasons,
          sample_id: sampleId || undefined,
          create_hold_on_fail: true,
        },
      })
      const status = String(response?.data?.status || "")
      setLastVerdict(status)
      showToast(`Server verdict: ${status}`, status === "FAIL" || status === "INCOMPLETE" || status === "INVALID" ? "error" : "success")
      setReadings((current) => {
        if (stageType !== "OVEN") return {}
        const next: Record<string, string> = {}
        if (ovenCheckpoint === "PRE") {
          for (const [key, value] of Object.entries(current)) {
            if (String(key).startsWith("pre_")) next[key] = value
          }
        }
        return next
      })
      setReasons({})
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Inspection save failed."
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
                    setReadings({})
                    setReasons({})
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
                    setReadings({})
                    setReasons({})
                    setSampleId("")
                    setOvenCheckpoint("PRE")
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
            {stageType === "OVEN" ? (
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Oven checkpoint</span>
                <select
                  value={ovenCheckpoint}
                  onChange={(event) => {
                    setOvenCheckpoint(event.target.value as "PRE" | "POST")
                    setLastVerdict("")
                    if (event.target.value === "POST") {
                      setReadings((current) => {
                        const next: Record<string, string> = {}
                        for (const [key, value] of Object.entries(current)) {
                          if (key === "pre_weight" || key === "pre_moisture") continue
                          next[key] = value
                        }
                        return next
                      })
                    }
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
                readings={readings}
                reasons={reasons}
                sampleId={sampleId}
                paired={stageType === "OVEN"}
                profileRevision={profileRevision}
                checkpoint={checkpoint}
                dueTiming={stageType === "OVEN" ? ovenCheckpoint : null}
                onReadingChange={(code, value) => setReadings((current) => ({ ...current, [code]: value }))}
                onReasonChange={(code, value) => setReasons((current) => ({ ...current, [code]: value }))}
                onSampleIdChange={setSampleId}
              />
            ) : (
              <EmptyState label="Select a job card to load frozen Allowed ranges." />
            )}
            {lastVerdict ? (
              <div className="text-sm font-semibold text-slate-900" data-testid="quality-stage-verdict">
                {lastVerdict}
              </div>
            ) : null}
            <button
              type="submit"
              data-testid="quality-stage-submit"
              disabled={!selectedJobId || createInspection.isPending}
              className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Submit stage readings
            </button>
          </form>
        </Panel>
      </div>
    </RoleGate>
  )
}
