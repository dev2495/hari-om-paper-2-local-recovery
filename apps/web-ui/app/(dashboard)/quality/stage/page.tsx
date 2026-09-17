"use client"

import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { StageQcFields } from "@/components/qc/StageQcFields"
import { RoleGate } from "@/components/workspace/role-gate"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useCreateQualityInspection, useJobQcTemplate, usePlanningJobCards } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { frozenStageRules, type QcStageKey } from "@/lib/qc-measurement"

const STAGES: { value: QcStageKey; label: string }[] = [
  { value: "WINDER", label: "Winding" },
  { value: "OVEN", label: "Oven" },
  { value: "PROCESS", label: "Process" },
]

function asArray(value: any) {
  return Array.isArray(value) ? value : []
}

function jobLabel(job: any) {
  return [job.job_card_no || job.job_no || String(job.id || "").slice(0, 8), job.product_code || job.spec_no, job.current_stage]
    .filter(Boolean)
    .join(" | ")
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
  const jobCardsQuery = usePlanningJobCards({ limit: 200 })
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

  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = needle ? jobs.filter((job: any) => jobLabel(job).toLowerCase().includes(needle)) : jobs
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
          .filter(([, value]) => String(value).trim() !== "")
          .map(([key, value]) => {
            const number = Number(value)
            return [key, Number.isFinite(number) ? number : value]
          }),
      )
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
      showToast(`Server verdict: ${status}`, status === "FAIL" ? "error" : "success")
      setReadings({})
      setReasons({})
      setSampleId("")
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
        <Panel title="Job-card stage inspection" subtitle="Frozen ranges come from the job's spec snapshot QC profile.">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Job card</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search job card"
                  className="mb-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                />
                <select
                  value={selectedJobId}
                  onChange={(event) => {
                    setSelectedJobId(event.target.value)
                    setReadings({})
                    setReasons({})
                  }}
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
                  }}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm"
                >
                  {STAGES.map((stage) => (
                    <option key={stage.value} value={stage.value}>{stage.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {selectedJobId ? (
              <StageQcFields
                rules={rules}
                readings={readings}
                reasons={reasons}
                sampleId={sampleId}
                paired={stageType === "OVEN"}
                onReadingChange={(code, value) => setReadings((current) => ({ ...current, [code]: value }))}
                onReasonChange={(code, value) => setReasons((current) => ({ ...current, [code]: value }))}
                onSampleIdChange={setSampleId}
              />
            ) : (
              <EmptyState label="Select a job card to load frozen Allowed ranges." />
            )}
            <button
              type="submit"
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
