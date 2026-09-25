"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { StageQcFields } from "@/components/qc/StageQcFields"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useCompleteJobCardQc, useCreateQualityInspection, useJobQcTemplate, usePlanningJobCards } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { frozenStageRules, inspectionProfileRevision, qcExceptionIssues, type QcStageKey } from "@/lib/qc-measurement"

const STAGES: { value: QcStageKey; label: string }[] = [
  { value: "WINDER", label: "Winding" },
  { value: "OVEN", label: "Oven" },
  { value: "PROCESS", label: "Process" },
]

type StageDraft = {
  readings: Record<string, string>
  reasons: Record<string, string>
  reasonCodes: Record<string, string>
  containments: Record<string, string>
  assignees: Record<string, string>
  commonExplanation: string
  commonContainment: string
  commonAssignee: string
  sampleId: string
  measuredAt: string
  ovenCheckpoint: "PRE" | "POST"
  instrumentId: string
  calibrationDue: string
  calibrationStatus: string
  instrumentEvidence: string
}

function emptyDraft(): StageDraft {
  return {
    readings: {},
    reasons: {},
    reasonCodes: {},
    containments: {},
    assignees: {},
    commonExplanation: "",
    commonContainment: "",
    commonAssignee: "",
    sampleId: "",
    measuredAt: "",
    ovenCheckpoint: "PRE",
    instrumentId: "",
    calibrationDue: "",
    calibrationStatus: "",
    instrumentEvidence: "",
  }
}

function packedReasons(draft: StageDraft, failCodes: string[] = []) {
  const packed: Record<string, any> = {}
  const codes = new Set([...Object.keys(draft.reasons || {}), ...Object.keys(draft.reasonCodes || {})])
  codes.forEach((code) => {
    const reasonCode = String(draft.reasonCodes?.[code] || "")
    const explanation = String(draft.reasons?.[code] || "").trim()
    if (reasonCode === "CAUSE_UNDER_INVESTIGATION") {
      packed[code] = {
        code: "CAUSE_UNDER_INVESTIGATION",
        note: explanation,
        explanation,
        containment: String(draft.containments?.[code] || "").trim(),
        assignee: String(draft.assignees?.[code] || "").trim(),
      }
      return
    }
    if (explanation) packed[code] = explanation
  })
  const commonText = String(draft.commonExplanation || "").trim()
  if (commonText && failCodes.length >= 2) {
    const caseId = "COMMON"
    packed.__common__ = {
      id: caseId,
      explanation: commonText,
      note: commonText,
      containment: String(draft.commonContainment || "").trim(),
      assignee: String(draft.commonAssignee || "").trim(),
      applies_to: failCodes,
    }
    failCodes.forEach((code) => {
      const existing = packed[code]
      if (existing && typeof existing === "object") {
        packed[code] = { ...existing, common_cause_id: caseId, grouped: true }
      } else if (typeof existing === "string" && existing.trim()) {
        packed[code] = { explanation: existing, common_cause_id: caseId, grouped: true }
      } else {
        packed[code] = { common_cause_id: caseId, grouped: true }
      }
    })
  }
  return packed
}

function asArray(value: any) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.results)) return value.results
  return []
}

function jobLabel(job: any) {
  const missing = job?.spec_snapshot?.missing_qc_setup || job?.spec_snapshot?.missing_profile_marker
  return [
    job.job_card_no || job.job_no || String(job.id || "").slice(0, 8),
    job.product_code || job.spec_no,
    job.current_stage,
    missing ? "MISSING QC" : "",
  ]
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

function reconnectConflict(error: any) {
  const data = error?.response?.data
  const detail = data?.detail ?? data
  const code = String(detail?.code || "")
  if (code === "STALE_CONTEXT" || code === "OFFLINE_RELEASE_FORBIDDEN" || code === "MISSING_QC_SETUP" || code === "INVALID_INSTRUMENT") return detail
  return null
}

function numericReadings(stageType: QcStageKey, draft: StageDraft) {
  const numeric: Record<string, any> = Object.fromEntries(
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
  const instrumentId = String(draft.instrumentId || "").trim()
  const calibrationDue = String(draft.calibrationDue || "").trim()
  const calibrationStatus = String(draft.calibrationStatus || "").trim()
  const evidenceRef = String(draft.instrumentEvidence || "").trim()
  if (instrumentId || calibrationDue || calibrationStatus || evidenceRef) {
    numeric.instrument = {
      instrument_id: instrumentId || undefined,
      calibration_due: calibrationDue || undefined,
      calibration_status: calibrationStatus || undefined,
      evidence_ref: evidenceRef || undefined,
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
  const [lastGatingPolicy, setLastGatingPolicy] = useState("")
  const [lastMovementGate, setLastMovementGate] = useState("")
  const [investigationStatus, setInvestigationStatus] = useState("")
  const [groupedCaseId, setGroupedCaseId] = useState("")
  const [originalInspection, setOriginalInspection] = useState<{
    id: string
    status: string
    readings: Record<string, any>
    holdId?: string
    revision: number
    sampleId?: string
  } | null>(null)
  const [correctionReason, setCorrectionReason] = useState("")
  const [lastOriginalStatus, setLastOriginalStatus] = useState("")
  const [lastCorrectionRevision, setLastCorrectionRevision] = useState("")
  const [cardIssues, setCardIssues] = useState<any[]>([])
  const [lastLateException, setLastLateException] = useState<any>(null)
  const [draftContext, setDraftContext] = useState<any>(null)
  const [offlineDraftKept, setOfflineDraftKept] = useState(false)
  const [staleConflict, setStaleConflict] = useState<any>(null)
  const jobCardsQuery = usePlanningJobCards({ limit: 80, search: search.trim() || undefined })
  const createInspection = useCreateQualityInspection()
  const completeCard = useCompleteJobCardQc()
  const jobs = useMemo(() => asArray(jobCardsQuery.data), [jobCardsQuery.data])
  const selectedJob = jobs.find((job: any) => String(job.id) === selectedJobId) || null
  const plantId = plantForJob(selectedJob) || (activePlant && activePlant.toUpperCase() !== "ALL" ? activePlant : undefined)
  const templateQuery = useJobQcTemplate(selectedJobId || undefined, stageType, plantId)
  const snapshotProfile = selectedJob?.spec_snapshot?.qc_profile || templateQuery.data?.qc_profile
  const missingSetup = Boolean(
    selectedJob?.spec_snapshot?.missing_qc_setup
    || selectedJob?.spec_snapshot?.missing_profile_marker
    || templateQuery.data?.missing_qc_setup,
  )
  const stageBlock = templateQuery.data?.stages?.[stageType]
  const rules = asArray(stageBlock?.parameters).length
    ? stageBlock.parameters
    : frozenStageRules(snapshotProfile, stageType)
  const profileRevision = inspectionProfileRevision(null, snapshotProfile || templateQuery.data)
  const draft = drafts[stageType]
  const failCodes = qcExceptionIssues(rules, draft.readings).map((row) => row.code)
  const requiresInstrument = rules.some((row: any) => Boolean(row?.requires_instrument || row?.instrument_required))
    || Boolean(templateQuery.data?.requires_instrument)
  const checkpoint = stageType === "OVEN"
    ? (draft.ovenCheckpoint === "POST" ? "Oven post" : "Oven pre")
    : STAGES.find((stage) => stage.value === stageType)?.label

  useEffect(() => {
    setDraftContext(null)
    setOfflineDraftKept(false)
    setStaleConflict(null)
  }, [selectedJobId])

  useEffect(() => {
    const ctx = templateQuery.data?.signed_profile_context
    if (ctx && !draftContext) setDraftContext(ctx)
  }, [templateQuery.data, draftContext])

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
          reasons: packedReasons(draft, failCodes),
          sample_id: draft.sampleId || undefined,
          create_hold_on_fail: true,
          ...(draft.measuredAt
            ? { measured_at: new Date(draft.measuredAt).toISOString() }
            : {}),
          ...(draftContext
            ? {
                expected_context_version: draftContext.quality_context_version,
                signed_profile_fingerprint: draftContext.fingerprint,
              }
            : {}),
          ...(originalInspection
            ? {
                parent_inspection_id: originalInspection.id,
                correction_reason: correctionReason.trim() || undefined,
                expected_revision: originalInspection.revision,
              }
            : {}),
        },
      })
      const body = response?.data || {}
      const status = String(body.status || "")
      setStaleConflict(null)
      setLastVerdict(status)
      setLastGatingPolicy(String(body.evaluation?.gating || "").toUpperCase())
      setLastMovementGate(String(body.evaluation?.movement_gate || "").toUpperCase())
      setInvestigationStatus(String(body.investigation_status || ""))
      setGroupedCaseId(String(body.grouped_case_id || ""))
      setLastLateException(body.late_quality_exception ? body : null)
      if (body.correction_revision || body.original_status) {
        setLastOriginalStatus(String(body.original_status || originalInspection?.status || ""))
        setLastCorrectionRevision(String(body.correction_revision || ""))
      } else if (status === "FAIL") {
        setOriginalInspection({
          id: String(body.id),
          status,
          readings: body.readings || {},
          holdId: body.hold_id,
          revision: Number(body.evaluation?.measurement_revision || 1),
          sampleId: body.sample_id,
        })
        setLastOriginalStatus(status)
        setLastCorrectionRevision("")
      }
      showToast(`Server verdict: ${status}`, status === "FAIL" || status === "INCOMPLETE" || status === "INVALID" ? "error" : "success")
      updateDraft(stageType, (current) => {
        if (stageType !== "OVEN") return { ...emptyDraft(), sampleId: current.sampleId }
        const nextReadings: Record<string, string> = {}
        if (current.ovenCheckpoint === "PRE") {
          for (const [key, value] of Object.entries(current.readings)) {
            if (String(key).startsWith("pre_")) nextReadings[key] = value
          }
        }
        return { ...current, readings: nextReadings, reasons: {}, reasonCodes: {}, containments: {}, assignees: {} }
      })
    } catch (error: any) {
      const conflict = reconnectConflict(error)
      if (conflict) {
        setStaleConflict(conflict)
        setLastVerdict("")
        showToast(conflict.message || "Quality checkpoint was not released.", "error")
        return
      }
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
          stages: STAGES.map((stage) => {
            const stageDraft = drafts[stage.value]
            const stageRules = asArray(templateQuery.data?.stages?.[stage.value]?.parameters).length
              ? templateQuery.data.stages[stage.value].parameters
              : frozenStageRules(snapshotProfile, stage.value)
            return {
              stage_type: stage.value,
              readings: numericReadings(stage.value, stageDraft),
              reasons: packedReasons(
                stageDraft,
                qcExceptionIssues(stageRules, stageDraft.readings).map((row) => row.code),
              ),
              sample_id: stageDraft.sampleId || undefined,
            }
          }),
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
          title="Production inspection"
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
                <span className="text-[12px] font-semibold text-muted-foreground">Job card</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search job card"
                  data-testid="quality-stage-job-search"
                  className="mb-2 h-10 w-full rounded-xl border border-border px-3 text-sm"
                />
                <select
                  value={selectedJobId}
                  onChange={(event) => {
                    setSelectedJobId(event.target.value)
                    setDrafts({ WINDER: emptyDraft(), OVEN: emptyDraft(), PROCESS: emptyDraft() })
                    setLastVerdict("")
                    setLastGatingPolicy("")
                    setLastMovementGate("")
                    setCardIssues([])
                    setOriginalInspection(null)
                    setCorrectionReason("")
                    setLastOriginalStatus("")
                    setLastCorrectionRevision("")
                  }}
                  data-testid="quality-stage-job"
                  className="h-12 w-full rounded-2xl border border-border bg-card px-3 text-sm"
                >
                  <option value="">Select job card</option>
                  {filteredJobs.map((job: any) => (
                    <option key={job.id} value={job.id}>{jobLabel(job)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Stage</span>
                <select
                  value={stageType}
                  onChange={(event) => {
                    setStageType(event.target.value as QcStageKey)
                    setLastVerdict("")
                  }}
                  data-testid="quality-stage-type"
                  className="h-12 w-full rounded-2xl border border-border bg-card px-3 text-sm"
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
                    stageType === stage.value ? "bg-foreground text-background" : "border border-border bg-card text-foreground"
                  }`}
                >
                  {stage.label}
                </button>
              ))}
            </div>
            {stageType === "OVEN" ? (
              <label className="block space-y-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Oven checkpoint</span>
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
                  className="h-12 w-full rounded-2xl border border-border bg-card px-3 text-sm md:max-w-sm"
                >
                  <option value="PRE">Before oven — pre-weight / pre-moisture</option>
                  <option value="POST">After oven — post-weight / post-moisture</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Post fields are not due at the pre checkpoint. The later post checkpoint requires the same sample / pair ID.
                </p>
              </label>
            ) : null}
            {selectedJobId ? (
              <>
                <label className="block space-y-1">
                  <span className="text-[12px] font-semibold text-muted-foreground">Measured at</span>
                  <input
                    type="datetime-local"
                    data-testid="quality-stage-measured-at"
                    value={draft.measuredAt}
                    onChange={(event) => updateDraft(stageType, { measuredAt: event.target.value })}
                    className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm md:max-w-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Physical measurement time. Recorded time is stored separately when this is saved after later work or dispatch.
                  </p>
                </label>
                <StageQcFields
                rules={rules}
                readings={draft.readings}
                reasons={draft.reasons}
                reasonCodes={draft.reasonCodes}
                containments={draft.containments}
                assignees={draft.assignees}
                sampleId={draft.sampleId}
                paired={stageType === "OVEN"}
                profileRevision={profileRevision}
                checkpoint={checkpoint}
                dueTiming={stageType === "OVEN" ? draft.ovenCheckpoint : null}
                allowUnknownCause
                onReadingChange={(code, value) => updateDraft(stageType, (current) => ({ ...current, readings: { ...current.readings, [code]: value } }))}
                onReasonChange={(code, value) => updateDraft(stageType, (current) => ({ ...current, reasons: { ...current.reasons, [code]: value } }))}
                onReasonCodeChange={(code, value) => updateDraft(stageType, (current) => ({ ...current, reasonCodes: { ...current.reasonCodes, [code]: value } }))}
                onContainmentChange={(code, value) => updateDraft(stageType, (current) => ({ ...current, containments: { ...current.containments, [code]: value } }))}
                onAssigneeChange={(code, value) => updateDraft(stageType, (current) => ({ ...current, assignees: { ...current.assignees, [code]: value } }))}
                onSampleIdChange={(value) => updateDraft(stageType, { sampleId: value })}
              />
              </>
            ) : (
              <EmptyState label="Select a job card to load frozen Allowed ranges." />
            )}
            {selectedJobId && failCodes.length >= 2 ? (
              <div className="space-y-2 rounded-2xl border border-foreground/80 bg-card p-4" data-testid="quality-stage-common-cause">
                <div className="text-[12px] font-semibold text-muted-foreground">Common cause for related failures</div>
                <p className="text-xs text-muted-foreground">One explanation can cover {failCodes.join(", ")}. Each failed parameter stays listed.</p>
                <label className="block space-y-1">
                  <span className="text-[11.5px] font-semibold text-muted-foreground">Common-cause explanation</span>
                  <input
                    data-testid="stage-qc-common-explanation"
                    value={draft.commonExplanation}
                    onChange={(event) => updateDraft(stageType, { commonExplanation: event.target.value })}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                    placeholder="Link one cause to all related failing fields"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11.5px] font-semibold text-muted-foreground">Containment</span>
                  <input
                    data-testid="stage-qc-common-containment"
                    value={draft.commonContainment}
                    onChange={(event) => updateDraft(stageType, { commonContainment: event.target.value })}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                    placeholder="Immediate containment / affected scope"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11.5px] font-semibold text-muted-foreground">Assignee</span>
                  <input
                    data-testid="stage-qc-common-assignee"
                    value={draft.commonAssignee}
                    onChange={(event) => updateDraft(stageType, { commonAssignee: event.target.value })}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                    placeholder="Responsible person"
                  />
                </label>
              </div>
            ) : null}
            {originalInspection && String(originalInspection.status).toUpperCase() === "FAIL" ? (
              <div className="space-y-2 rounded-2xl border border-foreground/80 bg-card p-4" data-testid="quality-stage-correction">
                <div className="text-[12px] font-semibold text-muted-foreground">Correction of a recorded FAIL</div>
                <p className="text-xs text-muted-foreground">
                  Original value stays on the FAIL record. Changing a failing number to a passing one needs a reason, actor, time, and revision. The hold is not cleared.
                </p>
                <div className="text-sm text-foreground" data-testid="quality-stage-original-status">
                  {originalInspection.status}
                </div>
                <div className="text-sm text-foreground" data-testid="quality-stage-original-height">
                  {String(originalInspection.readings?.height ?? "")}
                </div>
                <label className="block space-y-1">
                  <span className="text-[11.5px] font-semibold text-muted-foreground">Correction reason</span>
                  <input
                    data-testid="quality-stage-correction-reason"
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                    placeholder="Why the previously recorded number is being corrected"
                  />
                </label>
              </div>
            ) : null}
            {draftContext ? (
              <div className="text-xs text-muted-foreground" data-testid="quality-stage-draft-context-version">
                {String(draftContext.quality_context_version)}
              </div>
            ) : null}
            {missingSetup ? (
              <div className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft p-4 text-sm text-signal-amber-ink" data-testid="quality-stage-missing-setup">
                Missing QC setup. Queue admission succeeded with a missing-setup flag. This checkpoint requires an approved resolution. Empty setup is not measured PASS.
              </div>
            ) : null}
            {requiresInstrument ? (
              <div className="space-y-3 rounded-2xl border border-foreground/80 bg-card p-4" data-testid="quality-stage-instrument-required">
                <div className="text-sm text-foreground">
                  Required instrument evidence controls readiness. Missing or expired instrument is not measured PASS, and calibration is not invented.
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Instrument ID</span>
                  <input
                    data-testid="quality-stage-instrument-id"
                    value={draft.instrumentId}
                    onChange={(event) => updateDraft(stageType, { instrumentId: event.target.value })}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Calibration due</span>
                  <input
                    type="date"
                    data-testid="quality-stage-calibration-due"
                    value={draft.calibrationDue}
                    onChange={(event) => updateDraft(stageType, { calibrationDue: event.target.value })}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Instrument status</span>
                  <input
                    data-testid="quality-stage-calibration-status"
                    value={draft.calibrationStatus}
                    onChange={(event) => updateDraft(stageType, { calibrationStatus: event.target.value })}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                    placeholder="valid / expired / missing"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Calibration evidence</span>
                  <input
                    data-testid="quality-stage-instrument-evidence"
                    value={draft.instrumentEvidence}
                    onChange={(event) => updateDraft(stageType, { instrumentEvidence: event.target.value })}
                    className="h-10 w-full rounded-xl border border-foreground/80 px-3 text-sm text-foreground"
                    placeholder="Certificate or documented evidence ref"
                  />
                </label>
              </div>
            ) : null}
            {staleConflict?.code === "MISSING_QC_SETUP" ? (
              <div className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft p-4 text-sm text-signal-amber-ink" data-testid="quality-stage-missing-setup-conflict">
                {staleConflict.message}
              </div>
            ) : null}
            {staleConflict?.code === "INVALID_INSTRUMENT" ? (
              <div className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft p-4 text-sm text-signal-amber-ink" data-testid="quality-stage-instrument-conflict">
                {staleConflict.message} Status: {String(staleConflict.instrument_status || "")}. Invented calibration: no.
              </div>
            ) : null}
            {offlineDraftKept ? (
              <div className="rounded-2xl border border-border bg-muted p-4 text-sm text-foreground" data-testid="quality-stage-offline-draft">
                Paper/offline draft kept locally. This is not a quality release.
              </div>
            ) : null}
            {staleConflict && staleConflict.code !== "MISSING_QC_SETUP" && staleConflict.code !== "INVALID_INSTRUMENT" ? (
              <div className="space-y-2 rounded-2xl border border-signal-amber-line bg-signal-amber-soft p-4 text-sm text-signal-amber-ink" data-testid="quality-stage-stale-conflict">
                <div className="font-semibold">{staleConflict.message}</div>
                <div data-testid="quality-stage-retained-height">
                  Height {String(staleConflict.observations?.readings?.height ?? draft.readings.height ?? "")}
                </div>
                <div data-testid="quality-stage-signed-profile">
                  Signed profile v{String(staleConflict.signed_profile_context?.quality_context_version ?? "")} {String(staleConflict.signed_profile_context?.fingerprint || "").slice(0, 12)}
                </div>
                <div>Offline release: {staleConflict.offline_release ? "yes" : "no"}</div>
              </div>
            ) : null}
            {lastVerdict ? (
              <div className="text-sm font-semibold text-foreground" data-testid="quality-stage-verdict">
                {lastVerdict}
              </div>
            ) : null}
            {lastGatingPolicy ? (
              <div className="text-sm text-foreground" data-testid="quality-stage-gating-policy">
                {lastGatingPolicy}
              </div>
            ) : null}
            {lastMovementGate ? (
              <div className="text-sm text-foreground" data-testid="quality-stage-movement-gate">
                {lastMovementGate}
              </div>
            ) : null}
            {lastLateException ? (
              <div className="space-y-2 rounded-2xl border border-signal-amber-line bg-signal-amber-soft p-4 text-sm text-signal-amber-ink" data-testid="late-quality-exception">
                <div className="font-semibold">{lastLateException.late_exception_label || "Late quality exception"}</div>
                <p>
                  Measured and recorded clocks are stored separately. Surviving stock is traced. Earlier shipment remains as it occurred.
                </p>
                <div data-testid="qc-measured-at">Measured {String(lastLateException.measured_at || "")}</div>
                <div data-testid="qc-recorded-at">Recorded {String(lastLateException.recorded_at || "")}</div>
                {(lastLateException.surviving_stock || []).length ? (
                  <div data-testid="surviving-stock">
                    Surviving {(lastLateException.surviving_stock || []).map((row: any) => `${row.kind} ${row.qty}`).join(" · ")}
                  </div>
                ) : null}
                {(lastLateException.earlier_shipments || []).length ? (
                  <div data-testid="earlier-shipment">
                    Earlier shipment {(lastLateException.earlier_shipments || []).map((row: any) => `${row.status} ${row.qty}`).join(" · ")}
                  </div>
                ) : null}
              </div>
            ) : null}
            {lastOriginalStatus ? (
              <div className="text-sm text-foreground" data-testid="quality-stage-retained-status">
                {lastOriginalStatus}
              </div>
            ) : null}
            {lastCorrectionRevision ? (
              <div className="text-sm text-foreground" data-testid="quality-stage-correction-revision">
                {lastCorrectionRevision}
              </div>
            ) : null}
            {investigationStatus ? (
              <div className="text-sm text-foreground" data-testid="quality-stage-investigation">
                {investigationStatus}
              </div>
            ) : null}
            {groupedCaseId ? (
              <div className="text-sm text-foreground" data-testid="quality-stage-grouped-case">
                {groupedCaseId}
              </div>
            ) : null}
            {cardIssues.length ? (
              <ul className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm text-foreground" data-testid="quality-card-issues">
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
                type="button"
                data-testid="quality-stage-keep-offline-draft"
                disabled={!selectedJobId}
                onClick={() => {
                  setOfflineDraftKept(true)
                  setStaleConflict(null)
                  showToast("Paper/offline draft kept. Not a quality release.", "success")
                }}
                className="rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-60"
              >
                Keep paper/offline draft
              </button>
              <button
                type="submit"
                data-testid="quality-stage-submit"
                disabled={!selectedJobId || createInspection.isPending}
                className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
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
                className="rounded-xl border border-foreground/80 px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-60"
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
