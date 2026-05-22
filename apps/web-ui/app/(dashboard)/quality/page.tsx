"use client"

import dayjs from "dayjs"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  LockKeyhole,
  Search,
  ShieldCheck,
  UnlockKeyhole,
} from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import {
  EmptyState,
  ExecutiveHero,
  MetricCard,
  MetricRail,
  Panel,
  StatusBadge,
} from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateQualityHold,
  useCreateQualityInspection,
  usePlanningJobCards,
  useQualityHolds,
  useQualityInspections,
  useReleaseQualityHold,
} from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

const STAGES = [
  { value: "WINDER", label: "Winder QC" },
  { value: "OVEN", label: "Oven QC" },
  { value: "PROCESS", label: "Process QC" },
  { value: "PACKING", label: "Packing / final QC" },
]
const READING_FIELDS = [
  { key: "id", label: "ID mm" },
  { key: "od", label: "OD mm" },
  { key: "length", label: "Length mm" },
  { key: "weight", label: "Weight g" },
  { key: "cs", label: "CS n" },
  { key: "moisture_after", label: "Moisture %" },
]

function asArray(value: any) {
  return Array.isArray(value) ? value : []
}

function jobLabel(job: any) {
  if (!job) return ""
  return [
    job.job_card_no || job.job_no || String(job.id || "").slice(0, 8),
    job.product_code || job.spec_no || job.spec_code,
    job.current_stage || job.stage,
  ]
    .filter(Boolean)
    .join(" | ")
}

function plantForJob(job: any) {
  const value = String(job?.plant_id || job?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

function readableDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM, HH:mm") : String(value)
}

function compactId(value?: string | null) {
  const text = String(value || "")
  return text.length > 10 ? text.slice(0, 8) : text || "-"
}

export default function QualityLifecyclePage() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedJobId, setSelectedJobId] = useState("")
  const [stageType, setStageType] = useState("WINDER")
  const [readings, setReadings] = useState<Record<string, string>>({})
  const [manualHoldReason, setManualHoldReason] = useState("")

  const jobCardsQuery = usePlanningJobCards({ limit: 200 })
  const inspectionsQuery = useQualityInspections({ limit: 120 })
  const holdsQuery = useQualityHolds({ limit: 120 })
  const createInspection = useCreateQualityInspection()
  const createHold = useCreateQualityHold()
  const releaseHold = useReleaseQualityHold()

  const jobs = useMemo(() => asArray(jobCardsQuery.data), [jobCardsQuery.data])
  const inspections = useMemo(() => asArray(inspectionsQuery.data), [inspectionsQuery.data])
  const holds = useMemo(() => asArray(holdsQuery.data), [holdsQuery.data])
  const selectedJob = jobs.find((job: any) => String(job.id) === selectedJobId) || null

  const jobMap = useMemo(() => {
    const rows = new Map<string, any>()
    jobs.forEach((job: any) => rows.set(String(job.id), job))
    return rows
  }, [jobs])

  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return jobs.slice(0, 80)
    return jobs
      .filter((job: any) => jobLabel(job).toLowerCase().includes(needle))
      .slice(0, 80)
  }, [jobs, search])

  const activeHolds = holds.filter((hold: any) => String(hold.status || "").toUpperCase() === "HOLD")
  const releasedHolds = holds.filter((hold: any) => String(hold.status || "").toUpperCase() === "RELEASED")
  const failedInspections = inspections.filter((row: any) => String(row.status || "").toUpperCase() === "FAIL")
  const passedInspections = inspections.filter((row: any) => String(row.status || "").toUpperCase() === "PASS")
  const passRate = inspections.length ? (passedInspections.length / inspections.length) * 100 : 100

  const mutationPlantForJob = (jobId: string) => {
    const jobPlant = plantForJob(jobMap.get(String(jobId)))
    if (jobPlant) return jobPlant
    if (activePlant && activePlant.toUpperCase() !== "ALL") return activePlant
    return undefined
  }

  const numericReadings = () =>
    Object.fromEntries(
      Object.entries(readings)
        .filter(([, value]) => String(value).trim() !== "")
        .map(([key, value]) => [key, Number(value)]),
    )

  const handleInspectionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedJobId) {
      showToast("Select a job card before saving inspection.", "error")
      return
    }
    const plantId = mutationPlantForJob(selectedJobId)
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
          readings: numericReadings(),
          create_hold_on_fail: true,
        },
      })
      const status = String(response?.data?.status || "PASS")
      showToast(status === "FAIL" ? "Inspection failed and a quality hold was opened." : "Inspection passed.", status === "FAIL" ? "error" : "success")
      setReadings({})
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Inspection save failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
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
        data: {
          job_card_id: selectedJobId,
          stage_type: stageType,
          reason: manualHoldReason.trim(),
        },
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
    <div className="space-y-6" data-testid="quality:page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.analytics}
        badge="Quality Lifecycle"
        title="Inspection, hold, disposition, and release in one quality rail."
        description="Quality now sits inside the production flow instead of being a report-only afterthought: inspect against spec snapshots, open holds automatically on failures, release with audit evidence, and keep dispatch blocked until stock is clean."
        aside={
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Live QC Gate
            </div>
            <p className="text-2xl font-semibold tracking-tight">{activeHolds.length} active hold(s)</p>
            <p className="text-sm text-slate-200/80">Pass rate {passRate.toFixed(1)}% across the current quality window.</p>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Active Holds" value={activeHolds.length} detail="Dispatch-blocking quality decisions" icon={LockKeyhole} tone={activeHolds.length ? "rose" : "emerald"} />
        <MetricCard label="Pass Rate" value={`${passRate.toFixed(1)}%`} detail="Latest inspection window" icon={CheckCircle2} tone="cyan" />
        <MetricCard label="Failures" value={failedInspections.length} detail="Auto-hold candidates from readings" icon={AlertTriangle} tone={failedInspections.length ? "amber" : "slate"} />
        <MetricCard label="Released Holds" value={releasedHolds.length} detail="Closed quality interventions" icon={UnlockKeyhole} tone="violet" />
      </MetricRail>

      <Panel
        title="Quality lifecycle framework"
        subtitle="Each job card moves through measurable checkpoints. Failures create holds; released holds return stock to normal flow."
      >
        <div className="grid gap-3 xl:grid-cols-5">
          {[
            ["1. Spec truth", "Job-card snapshot fixes target ID, OD, length, weight, CS, and moisture bands."],
            ["2. In-process QC", "Winder, oven, and process checks are captured against the running job card."],
            ["3. Final QC", "Packing / final QC captures the outgoing check before dispatch handoff."],
            ["4. Hold and disposition", "Out-of-range readings open an active QC hold with reason and audit trail."],
            ["5. Release gate", "Authorized release clears the hold and allows dispatchable stock to move forward."],
          ].map(([title, detail]) => (
            <article key={title} className="rounded-[1.4rem] border border-slate-200 bg-white/85 p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-950">{title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 2xl:grid-cols-[0.95fr_1.05fr]">
        <Panel
          title="Inspection entry"
          subtitle="Select a live job card, enter readings, and let the system decide pass or hold from the spec snapshot."
          actions={
            <div className="flex min-w-[18rem] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search job card..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          }
        >
          <form className="space-y-4" onSubmit={handleInspectionSubmit}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Job card</span>
                <select
                  value={selectedJobId}
                  onChange={(event) => setSelectedJobId(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Select job card</option>
                  {filteredJobs.map((job: any) => (
                    <option key={job.id} value={job.id}>
                      {jobLabel(job)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Stage</span>
                <select
                  value={stageType}
                  onChange={(event) => setStageType(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  {STAGES.map((stage) => (
                    <option key={stage.value} value={stage.value}>{stage.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {READING_FIELDS.map((field) => (
                <label key={field.key} className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{field.label}</span>
                  <input
                    type="number"
                    step="0.001"
                    value={readings[field.key] || ""}
                    onChange={(event) => setReadings((current) => ({ ...current, [field.key]: event.target.value }))}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                </label>
              ))}
            </div>

            <button
              type="submit"
              disabled={createInspection.isPending}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save inspection and apply QC gate
            </button>
          </form>

          <form className="mt-5 rounded-[1.4rem] border border-amber-200 bg-amber-50/70 p-4" onSubmit={handleManualHoldSubmit}>
            <p className="text-sm font-semibold text-amber-950">Manual hold</p>
            <p className="mt-1 text-sm text-amber-800">Use this for visual defects, customer-specific checks, or process issues that are not numeric tolerance failures.</p>
            <textarea
              value={manualHoldReason}
              onChange={(event) => setManualHoldReason(event.target.value)}
              placeholder="Reason for hold..."
              className="mt-3 min-h-24 w-full rounded-2xl border border-amber-200 bg-white/90 px-3 py-3 text-sm outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
            <button
              type="submit"
              disabled={createHold.isPending}
              className="mt-3 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:-translate-y-0.5 hover:shadow-sm disabled:opacity-60"
            >
              Open manual hold
            </button>
          </form>
        </Panel>

        <Panel title="Active quality holds" subtitle="Release only after disposition is complete. These are the blocks that should stay visible before dispatch.">
          {holdsQuery.isLoading ? (
            <EmptyState label="Loading quality holds..." />
          ) : activeHolds.length === 0 ? (
            <EmptyState label="No active quality holds in the current window." />
          ) : (
            <div className="space-y-3">
              {activeHolds.slice(0, 16).map((hold: any) => {
                const job = jobMap.get(String(hold.job_card_id))
                return (
                  <article key={hold.id} className="rounded-[1.45rem] border border-rose-200 bg-rose-50/60 p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge value="HOLD" />
                          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">{hold.stage_type}</span>
                        </div>
                        <p className="mt-3 text-sm font-semibold text-slate-950">{jobLabel(job) || compactId(hold.job_card_id)}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-700">{hold.reason}</p>
                        <p className="mt-2 text-xs text-slate-500">Opened {readableDate(hold.created_at)} by {hold.created_by || "system"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleReleaseHold(hold)}
                        disabled={releaseHold.isPending}
                        className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-60"
                      >
                        Release hold
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent inspection evidence" subtitle="Audit-ready view of the latest readings and failures by stage.">
        {inspectionsQuery.isLoading ? (
          <EmptyState label="Loading inspections..." />
        ) : inspections.length === 0 ? (
          <EmptyState label="No inspections have been recorded yet." />
        ) : (
          <div className="overflow-hidden rounded-[1.35rem] border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-950 text-[11px] uppercase tracking-[0.16em] text-white">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Job card</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Failures</th>
                  <th className="px-4 py-3">Readings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {inspections.slice(0, 30).map((inspection: any) => {
                  const failures = asArray(inspection.failures)
                  return (
                    <tr key={inspection.id} className="align-top">
                      <td className="px-4 py-3 text-slate-600">{readableDate(inspection.created_at)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-950">{jobLabel(jobMap.get(String(inspection.job_card_id))) || compactId(inspection.job_card_id)}</td>
                      <td className="px-4 py-3 text-slate-700">{inspection.stage_type}</td>
                      <td className="px-4 py-3"><StatusBadge value={inspection.status} /></td>
                      <td className="px-4 py-3 text-slate-600">
                        {failures.length ? failures.map((item: any) => item.label || "Failure").join(", ") : "Within tolerance"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{JSON.stringify(inspection.readings || {})}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="What this closes" subtitle="Quality is now a lifecycle surface, not just an analytics report.">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[1.2rem] border border-cyan-200 bg-cyan-50/70 p-4">
            <FlaskConical className="h-5 w-5 text-cyan-700" />
            <p className="mt-3 font-semibold text-slate-950">Spec-backed readings</p>
            <p className="mt-1 text-sm text-slate-600">The backend compares entries to job-card spec snapshots and stores exact failures.</p>
          </div>
          <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50/70 p-4">
            <LockKeyhole className="h-5 w-5 text-rose-700" />
            <p className="mt-3 font-semibold text-slate-950">Hold control</p>
            <p className="mt-1 text-sm text-slate-600">Failures create visible holds that can be released only through the quality route.</p>
          </div>
          <div className="rounded-[1.2rem] border border-emerald-200 bg-emerald-50/70 p-4">
            <ClipboardCheck className="h-5 w-5 text-emerald-700" />
            <p className="mt-3 font-semibold text-slate-950">Audit trail</p>
            <p className="mt-1 text-sm text-slate-600">Every inspection, hold, and release writes audit evidence for client review.</p>
          </div>
        </div>
      </Panel>
    </div>
  )
}
