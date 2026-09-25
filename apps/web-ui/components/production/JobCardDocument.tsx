"use client"

import Link from "next/link"
import { CheckCircle2, ExternalLink, Printer, Save, Smartphone } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { Fragment, useEffect, useMemo, useState } from "react"

import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useIssueToolAsset, useReelIssues, useToolAssets } from "@/hooks/use-inventory"
import { useEmployees, useMandrels, useShifts } from "@/hooks/use-master-data"
import { displayPlantScope } from "@/lib/plant-scope"
import {
  useCompleteStageEntry,
  useMachines,
  usePlanningJobCard,
  useSaveStageDraft,
} from "@/hooks/use-production"
import { StageQcFields } from "@/components/qc/StageQcFields"
import {
  collectStageQualityChecks,
  formatAllowedRange,
  inspectionFrozenRules,
  inspectionProfileRevision,
  type QcParameterRule,
  type QcStageKey,
} from "@/lib/qc-measurement"

type DocumentMode = "view" | "print" | "supervisor"
type StageName = "SLITTING" | "WINDER" | "OVEN" | "PROCESS" | "PACKING" | "QC" | "DISPATCH"

const STAGES: StageName[] = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]
const PLANNER_GATED_STAGES: StageName[] = ["SLITTING", "WINDER", "OVEN", "PROCESS"]
const STAGES_REQUIRING_SHIFT: StageName[] = ["WINDER", "PROCESS"]
const LATE_ENTRY_THRESHOLD_HOURS = 6
// Start (A) / End (B) are written on the paper card at these stages and typed
// in later; completion must carry them so actuals follow the floor, not typing.
const CARD_TIMED_STAGES: StageName[] = ["SLITTING", "WINDER", "OVEN", "PROCESS"]

function padTwo(value: number) {
  return String(value).padStart(2, "0")
}

// "2026-09-25T08:30" (datetime-local, plant wall clock) -> ISO with this
// browser's offset, so the backend and books-guard read the card's own time.
function cardTimeToIso(value: any): string | undefined {
  const text = String(value || "").trim()
  if (!text) return undefined
  const parsed = new Date(text)
  if (!Number.isFinite(parsed.getTime())) return undefined
  const offsetMinutes = -parsed.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? "+" : "-"
  const absolute = Math.abs(offsetMinutes)
  return (
    `${parsed.getFullYear()}-${padTwo(parsed.getMonth() + 1)}-${padTwo(parsed.getDate())}` +
    `T${padTwo(parsed.getHours())}:${padTwo(parsed.getMinutes())}:00` +
    `${sign}${padTwo(Math.floor(absolute / 60))}:${padTwo(absolute % 60)}`
  )
}

// Backend timestamps are naive UTC; card text is local. Parse either safely.
function parseStageTime(value: any, naiveIsUtc = false): Date | null {
  const text = String(value || "").trim()
  if (!text) return null
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)
  const parsed = new Date(naiveIsUtc && !hasZone && text.includes("T") ? `${text}Z` : text)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function formatStageTime(value: any, naiveIsUtc = false) {
  const parsed = parseStageTime(value, naiveIsUtc)
  if (!parsed) return ""
  return `${padTwo(parsed.getDate())}-${padTwo(parsed.getMonth() + 1)} ${padTwo(parsed.getHours())}:${padTwo(parsed.getMinutes())}`
}

function formatMinutes(minutes: any) {
  const value = Number(minutes)
  if (!Number.isFinite(value) || value < 0) return ""
  const rounded = Math.round(value)
  return `${Math.floor(rounded / 60)}h ${padTwo(rounded % 60)}m`
}

function cycleTimeFromCard(start: any, end: any) {
  const startDate = parseStageTime(start)
  const endDate = parseStageTime(end)
  if (!startDate || !endDate || endDate < startDate) return ""
  return formatMinutes((endDate.getTime() - startDate.getTime()) / 60000)
}

function computeHoursLate(endTimeValue: any): number {
  if (!endTimeValue) return 0
  const endDate = new Date(String(endTimeValue))
  if (!Number.isFinite(endDate.getTime())) return 0
  const diffMs = Date.now() - endDate.getTime()
  if (diffMs <= 0) return 0
  return diffMs / (1000 * 60 * 60)
}

type Props = {
  jobCardId?: string
  mode: DocumentMode
}

function buildProductionEntryUrl(jobCardId?: string) {
  if (typeof window !== "undefined" && window.location?.origin) {
    const id = jobCardId || ""
    return `${window.location.origin}/production/supervisor-entry?job_card_id=${encodeURIComponent(id)}`
  }
  return `/production/supervisor-entry?job_card_id=${encodeURIComponent(jobCardId || "")}`
}

function formatNumber(value: any, digits = 2) {
  if (value === null || value === undefined || value === "") return "-"
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  if (Number.isInteger(number)) return String(number)
  return number.toFixed(digits).replace(/\.?0+$/, "")
}

const printValue = formatNumber

function formatYesNo(value: any) {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (["true", "1", "yes", "y"].includes(normalized)) return "Yes"
  if (["false", "0", "no", "n"].includes(normalized)) return "No"
  return value ? String(value) : ""
}

function statusChipClass(status: string) {
  switch ((status || "").toUpperCase()) {
    case "COMPLETED":
      return "bg-signal-emerald-soft text-signal-emerald-ink border-signal-emerald-line"
    case "ASSIGNED":
      return "bg-signal-cyan-soft text-signal-cyan-ink border-signal-cyan-line"
    case "RUNNING":
      return "bg-signal-amber-soft text-signal-amber-ink border-signal-amber-line"
    default:
      return "bg-muted text-muted-foreground border-border"
  }
}

function blankWinderEntry() {
  return {
    winder_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    winding_meters_produced: "",
    accepted_winding_meters: "",
    reject_winding_meters: "",
    bamboo_count_produced: "",
    accepted_bamboo_count: "",
    reject_bamboo_count: "",
    reject_reason_code: "",
    dimension_readings: Array.from({ length: 4 }, () => ({
      height: "",
      id: "",
      od: "",
      weight: "",
      cs: "",
    })),
    qc_readings: {},
    qc_reasons: {},
    qc_sample_id: "",
  }
}

function blankSlittingEntry() {
  return {
    slitter_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    parent_reel_id: "",
    child_reel_ids_text: "",
    slit_output_weight_kg: "",
    trim_wastage_weight_kg: "",
  }
}

function blankOvenEntry() {
  return {
    oven_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    bamboo_count_in: "",
    bamboo_count_out: "",
    pre_oven_weight_kg: "",
    post_oven_weight_kg: "",
    moisture_before: "",
    moisture_after: "",
    pre_weight: "",
    post_weight: "",
    pre_moisture: "",
    post_moisture: "",
    qc_readings: {},
    qc_reasons: {},
    qc_sample_id: "",
  }
}

function blankProcessEntry() {
  return {
    process_line_no: "",
    operator_name: "",
    supervisor_sign: "",
    qc_sign: "",
    start_time: "",
    end_time: "",
    cycle_time: "",
    shift_code: "",
    process_qty: "",
    reject_qty: "",
    reject_reason: "",
    final_measurements: {
      id: "",
      od: "",
      height: "",
      weight: "",
      cs: "",
      notch_distance: "",
      notch_depth: "",
      moisture: "",
    },
    qc_readings: {},
    qc_reasons: {},
    qc_sample_id: "",
  }
}

function blankPackingEntry() {
  return {
    packing_type: "",
    qty_per_bundle: "",
    total_packed_qty: "",
    fg_item_id: "",
    dispatch_date: "",
    dispatched_qty: "",
    pending_qty: "",
    supervisor_sign: "",
  }
}

function blankQcEntry() {
  return {
    inspector_name: "",
    qc_sign: "",
    sample_size: "",
    accepted_qty: "",
    hold_qty: "",
    disposition: "",
    release_reference: "",
  }
}

function blankDispatchEntry() {
  return {
    dispatch_request_id: "",
    dispatch_line_ref: "",
    dispatch_qty: "",
    vehicle_no: "",
    dispatch_date: "",
  }
}

function normalizeStageEntry(stage: StageName, entry: any) {
  const source = entry && typeof entry === "object" ? entry : {}
  if (stage === "SLITTING") {
    return { ...blankSlittingEntry(), ...source }
  }
  if (stage === "WINDER") {
    const base = blankWinderEntry()
    const rows = Array.isArray(source.dimension_readings) ? source.dimension_readings : []
    return {
      ...base,
      ...source,
      dimension_readings: Array.from({ length: Math.max(4, rows.length || 0) }, (_, index) => {
        const row = rows[index] || {}
        return {
          ...base.dimension_readings[0],
          ...row,
          height: row.height ?? row.length ?? "",
        }
      }),
      qc_readings: source.qc_readings || {},
      qc_reasons: source.qc_reasons || {},
    }
  }
  if (stage === "OVEN") {
    return {
      ...blankOvenEntry(),
      ...source,
      pre_weight: source.pre_weight ?? "",
      post_weight: source.post_weight ?? "",
      pre_moisture: source.pre_moisture ?? source.moisture_before ?? "",
      post_moisture: source.post_moisture ?? source.moisture_after ?? "",
      pre_oven_weight_kg: source.pre_oven_weight_kg ?? "",
      post_oven_weight_kg: source.post_oven_weight_kg ?? "",
      qc_readings: source.qc_readings || {},
      qc_reasons: source.qc_reasons || {},
    }
  }
  if (stage === "PROCESS") {
    const measurements = source.final_measurements || {}
    return {
      ...blankProcessEntry(),
      ...source,
      final_measurements: {
        ...blankProcessEntry().final_measurements,
        ...measurements,
        height: measurements.height ?? measurements.length ?? "",
      },
      qc_readings: source.qc_readings || {},
      qc_reasons: source.qc_reasons || {},
    }
  }
  if (stage === "QC") {
    return { ...blankQcEntry(), ...source }
  }
  if (stage === "DISPATCH") {
    return { ...blankDispatchEntry(), ...source }
  }
  return { ...blankPackingEntry(), ...source }
}

function firstMachineId(stages: any[]) {
  return stages.find((stage) => stage.machine_id)?.machine_id || null
}

function firstOpenSegment(segments: any[], stage: StageName) {
  const rows = segments
    .filter((segment: any) => segment.stage_type === stage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
    .sort((a: any, b: any) => Number(a.segment_no || 1) - Number(b.segment_no || 1) || Number(a.sequence_no || 1) - Number(b.sequence_no || 1))
  return rows[0] || null
}

function stageMachineField(stage: StageName): string | null {
  if (stage === "SLITTING") return "slitter_no"
  if (stage === "WINDER") return "winder_no"
  if (stage === "OVEN") return "oven_no"
  if (stage === "PROCESS") return "process_line_no"
  return null
}

function parseStageForms(card: any, machineLabelMap: Map<string, string>, defaultShift: string = "") {
  const rows = Array.isArray(card?.stages) ? card.stages : []
  const segments = Array.isArray(card?.stage_segments) ? card.stage_segments : []
  const forms: Record<string, any> = {}
  for (const stageName of STAGES) {
    const row = rows.find((candidate: any) => candidate.stage_type === stageName)
    const segment = firstOpenSegment(segments, stageName)
    const machineField = stageMachineField(stageName)
    const machineId = row?.machine_id || segment?.machine_id
    const machineLabel =
      machineId ? machineLabelMap.get(String(machineId)) || String(machineId).slice(0, 8) : ""
    const normalizedEntry = normalizeStageEntry(stageName, row?.entry_snapshot)
    const baseEntry = machineField && !normalizedEntry[machineField]
      ? { ...normalizedEntry, [machineField]: machineLabel }
      : { ...normalizedEntry }
    if (!baseEntry.shift_code) {
      const inheritedShift = row?.shift_code || segment?.shift_code || defaultShift || ""
      if (inheritedShift) {
        baseEntry.shift_code = String(inheritedShift)
      }
    }
    forms[stageName] = {
      segment_id: segment?.id || null,
      remarks: row?.remarks || "",
      override_reason: row?.actuals_snapshot?.override_reason || "",
      reel_issue_ids: Array.isArray(row?.reel_issue_ids) ? row.reel_issue_ids : [],
      entry_snapshot: baseEntry,
    }
  }
  return forms
}

function useMachineLabelMap() {
  const machinesQuery = useMachines()
  return useMemo(() => {
    const rows = Array.isArray(machinesQuery.data) ? machinesQuery.data : []
    return new Map(rows.map((row: any) => [String(row.id), row.name || row.code || row.id]))
  }, [machinesQuery.data])
}

function stageStatus(stages: any[], stage: StageName) {
  return stages.find((row: any) => row.stage_type === stage)?.status || "PLANNED"
}

function LabeledValue({
  label,
  value,
  className = "",
}: {
  label: string
  value: any
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-border bg-card/90 px-3 py-3 shadow-sm ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 min-h-5 text-sm font-semibold text-foreground">{value || "-"}</div>
    </div>
  )
}

function StageMetric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string
  value: any
  detail?: string
  tone?: "default" | "dark" | "soft"
}) {
  const toneClass =
    tone === "dark"
      ? "border-slate-900 bg-slate-950 text-white"
      : tone === "soft"
        ? "border-signal-cyan-line bg-signal-cyan-soft text-foreground"
        : "border-border bg-card text-foreground"
  const labelClass = tone === "dark" ? "text-white/70" : "text-muted-foreground"
  const detailClass = tone === "dark" ? "text-white/75" : "text-muted-foreground"
  return (
    <div className={`rounded-[1.2rem] border px-4 py-3 shadow-sm ${toneClass}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${labelClass}`}>{label}</div>
      <div className="mt-2 text-lg font-semibold">{value || "-"}</div>
      {detail ? <div className={`mt-1 text-xs ${detailClass}`}>{detail}</div> : null}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  type = "text",
}: {
  value: any
  onChange: (value: string) => void
  type?: "text" | "number" | "date" | "datetime-local"
}) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full rounded-2xl border border-border bg-card/95 px-3 text-sm font-medium text-foreground shadow-sm"
    />
  )
}

function MatrixBlock({
  title,
  ranges,
}: {
  title: string
  ranges: any
}) {
  const rows = [
    { key: "id", label: "ID" },
    { key: "od", label: "OD" },
    { key: "length", label: "Length" },
    { key: "tube_weight", label: "Tube Weight" },
    { key: "cs", label: "CS" },
    { key: "moisture", label: "Moisture" },
    { key: "thickness", label: "Thickness" },
  ]

  return (
    <section className="border border-slate-800">
      <div className="border-b border-slate-800 bg-muted px-3 py-2 text-sm font-bold uppercase tracking-wide text-foreground">
        {title}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted text-left">
            <th className="border border-border px-2 py-2">Parameter</th>
            <th className="border border-border px-2 py-2">Avg</th>
            <th className="border border-border px-2 py-2">Min</th>
            <th className="border border-border px-2 py-2">Max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const current = ranges?.[row.key] || {}
            return (
              <tr key={row.key}>
                <td className="border border-border px-2 py-2 font-semibold">{row.label}</td>
                <td className="border border-border px-2 py-2">{formatNumber(current.avg)}</td>
                <td className="border border-border px-2 py-2">{formatNumber(current.min)}</td>
                <td className="border border-border px-2 py-2">{formatNumber(current.max)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export default function JobCardDocument({ jobCardId, mode }: Props) {
  const { showToast } = useApp()
  const { user } = useAuth()
  const jobCardQuery = usePlanningJobCard(jobCardId)
  const saveDraftMutation = useSaveStageDraft()
  const completeStageMutation = useCompleteStageEntry()
  const machineLabelMap = useMachineLabelMap()
  const mandrelsQuery = useMandrels()
  const shiftsQuery = useShifts()
  const employeesQuery = useEmployees()
  const [stageForms, setStageForms] = useState<Record<string, any>>({})
  const [toolSelection, setToolSelection] = useState<Record<string, string>>({})
  const toolAssetsQuery = useToolAssets({ limit: 1000 })
  const issueToolMutation = useIssueToolAsset()
  const activeEmployees = useMemo(() => {
    const rows = Array.isArray(employeesQuery.data) ? employeesQuery.data : []
    return rows.filter((row: any) => row && (row.id ?? null) !== null && row.is_active !== false && row.active !== false)
  }, [employeesQuery.data])
  const employeesLoadFailed = Boolean(employeesQuery.isError)
  const userDefaultShift = (user as any)?.default_shift || ""
  const shiftOptions = useMemo(() => {
    const rows = Array.isArray(shiftsQuery.data) ? shiftsQuery.data : []
    return rows
      .filter((row: any) => row && (row.code || row.shift_code))
      .map((row: any) => ({
        code: String(row.code || row.shift_code || ""),
        name: String(row.name || row.shift_name || row.code || row.shift_code || ""),
      }))
  }, [shiftsQuery.data])

  const card = jobCardQuery.data
  const documentSnapshot = card?.document_snapshot || {}
  const stages = Array.isArray(card?.stages) ? card.stages : []
  const stageSegments = Array.isArray(card?.stage_segments) ? card.stage_segments : []
  const winderStage = stages.find((stage: any) => stage.stage_type === "WINDER")
  const activeHoldCount = (card?.quality_holds || []).filter((hold: any) => String(hold?.status || "").toUpperCase() === "HOLD").length
  const carryForward = card?.carry_forward_suggestion || { suggested: false, remaining_qty: 0 }
  const incompleteUpstreamStages = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC"].filter((stage) => {
    if (stage === "SLITTING" && !card?.requires_slitting) return false
    const status = stageStatus(stages, stage as StageName)
    return status !== "COMPLETED"
  })
  const dispatchGateBlocked = incompleteUpstreamStages.length > 0 || activeHoldCount > 0
  const restrictedPhysicalStage =
    stages.find((stage: any) => {
      const actuals = stage?.actuals_snapshot || {}
      return (
        Boolean(actuals.quality_review_pending) ||
        String(actuals.stock_status || "").toUpperCase() === "QC_HOLD"
      )
    }) ||
    (activeHoldCount > 0
      ? stages.find((stage: any) => stage?.output_qty != null && Number(stage.output_qty) > 0)
      : undefined)
  const wipQty = Math.max(
    0,
    Number(documentSnapshot?.material_truth?.planned_output_qty || card?.planned_qty || 0) -
      Number(documentSnapshot?.material_truth?.dispatched_qty || 0),
  )

  const reelIssuesQuery = useReelIssues(
    mode === "supervisor"
      ? {
          status: "OPEN",
          issue_section: "WINDER_SECTION",
          limit: 30,
        }
      : undefined,
  )

  const mandrelLabelMap = useMemo(() => {
    const rows = Array.isArray(mandrelsQuery.data) ? mandrelsQuery.data : []
    return new Map(
      rows.map((row: any) => [
        row.id,
        row.mandrel_code ||
          row.code ||
          row.name ||
          (row.outer_diameter_mm ? formatNumber(row.outer_diameter_mm) : row.id),
      ]),
    )
  }, [mandrelsQuery.data])

  useEffect(() => {
    if (card) {
      setStageForms(parseStageForms(card, machineLabelMap, userDefaultShift))
    }
  }, [card, machineLabelMap, userDefaultShift])

  const availableReelIssues = useMemo(() => {
    const rows = Array.isArray(reelIssuesQuery.data) ? reelIssuesQuery.data : []
    return rows
  }, [reelIssuesQuery.data])

  const lineMachineId = documentSnapshot?.header?.line_machine_id || firstMachineId(stages)
  const lineMachineLabel =
    documentSnapshot?.header?.line_machine_label ||
    (lineMachineId ? machineLabelMap.get(String(lineMachineId)) : null) ||
    "-"
  const mandrelId = documentSnapshot?.header?.mandrel_id || documentSnapshot?.setup_tooling?.mandrel
  const mandrelLabel =
    documentSnapshot?.header?.mandrel_label ||
    documentSnapshot?.setup_tooling?.mandrel_label ||
    (mandrelId ? mandrelLabelMap.get(mandrelId) : null) ||
    "-"
  const currentStage = (card?.current_stage || "WINDER") as StageName
  const plannerGateReady = Boolean(card?.planner_gate_ready ?? true)
  const plannerGateReason = card?.planner_gate_reason || ""
  const currentStageSegments = stageSegments.filter((segment: any) => segment.stage_type === currentStage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
  const selectedSegmentId = stageForms[currentStage]?.segment_id || card?.active_segment_id || currentStageSegments[0]?.id || null
  const activeSegment = currentStageSegments.find((segment: any) => segment.id === selectedSegmentId) || currentStageSegments[0] || null
  const clientSpec = documentSnapshot?.client_spec || {}
  const manufacturingSpec = documentSnapshot?.manufacturing_spec || {}
  const recipeSummary = documentSnapshot?.recipe_summary || {}
  const recipeRows = Array.isArray(recipeSummary?.rows) ? recipeSummary.rows : []
  const adhesiveComponents = Array.isArray(recipeSummary?.adhesive_components) ? recipeSummary.adhesive_components : []
  const toolingUsage = Array.isArray(documentSnapshot?.setup_tooling?.tooling_usage)
    ? documentSnapshot.setup_tooling.tooling_usage
    : Array.isArray(card?.spec_snapshot?.tooling_usage)
      ? card.spec_snapshot.tooling_usage
      : []
  const specReference =
    documentSnapshot?.header?.spec_reference ||
    documentSnapshot?.setup_tooling?.spec_reference ||
    card?.spec_snapshot?.spec_reference ||
    "-"
  const targetBambooCount = Number(documentSnapshot?.header?.target_bamboo_count || 0)
  const pcsPerBamboo = Number(documentSnapshot?.header?.pcs_per_bamboo || 0)
  const selectedBambooLength = Number(documentSnapshot?.header?.selected_bamboo_length_mm || 0)
  const usableBambooLength = Number(documentSnapshot?.header?.usable_length_mm || manufacturingSpec?.usable_length_mm || 0)
  const trimLossMm = Number(documentSnapshot?.header?.trim_loss_mm || manufacturingSpec?.trim_loss_mm || 0)
  const selectedBambooLengthM = selectedBambooLength > 0 ? selectedBambooLength / 1000 : 0
  const bambooToMeters = (value: any) => {
    const bamboo = Number(value || 0)
    if (!Number.isFinite(bamboo) || bamboo <= 0) return 0
    return selectedBambooLengthM > 0 ? bamboo * selectedBambooLengthM : bamboo
  }
  const metersToBamboo = (metersValue: any, bambooFallback?: any) => {
    const meters = Number(metersValue || 0)
    if (Number.isFinite(meters) && meters > 0 && selectedBambooLengthM > 0) {
      return Number((meters / selectedBambooLengthM).toFixed(4))
    }
    const fallback = Number(bambooFallback || 0)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  }
  const displayWinderMeters = (metersValue: any, bambooFallback?: any) => {
    const meters = Number(metersValue || 0)
    if (Number.isFinite(meters) && meters > 0) return formatNumber(meters, 2)
    const fallbackMeters = bambooToMeters(bambooFallback)
    return fallbackMeters > 0 ? formatNumber(fallbackMeters, 2) : ""
  }
  const normalizeWinderEntryForSubmit = (entry: any) => {
    const producedMeters = entry.winding_meters_produced !== "" && entry.winding_meters_produced != null ? Number(entry.winding_meters_produced) : bambooToMeters(entry.bamboo_count_produced)
    const acceptedMeters = entry.accepted_winding_meters !== "" && entry.accepted_winding_meters != null ? Number(entry.accepted_winding_meters) : bambooToMeters(entry.accepted_bamboo_count)
    const rejectMeters = entry.reject_winding_meters !== "" && entry.reject_winding_meters != null ? Number(entry.reject_winding_meters) : bambooToMeters(entry.reject_bamboo_count)
    return {
      ...entry,
      winding_meters_produced: Number.isFinite(producedMeters) && producedMeters > 0 ? producedMeters : "",
      accepted_winding_meters: Number.isFinite(acceptedMeters) && acceptedMeters > 0 ? acceptedMeters : "",
      reject_winding_meters: Number.isFinite(rejectMeters) && rejectMeters > 0 ? rejectMeters : "",
      bamboo_count_produced: metersToBamboo(producedMeters, entry.bamboo_count_produced) || "",
      accepted_bamboo_count: metersToBamboo(acceptedMeters, entry.accepted_bamboo_count) || "",
      reject_bamboo_count: metersToBamboo(rejectMeters, entry.reject_bamboo_count) || "",
    }
  }
  const parchmentFamily = documentSnapshot?.header?.parchment_family || "-"
  const parchmentPattern = documentSnapshot?.header?.parchment_pattern || documentSnapshot?.header?.color || "-"
  const parchmentResolution = String(documentSnapshot?.header?.parchment_resolution || card?.spec_snapshot?.parchment_resolution || "").toUpperCase()
  const parchmentConflict = documentSnapshot?.header?.parchment_conflict || card?.spec_snapshot?.parchment_conflict || null
  const approvedParchmentColor = documentSnapshot?.header?.approved_parchment_color || card?.spec_snapshot?.parchment_color || parchmentPattern
  const tubeDryWeightG = Number(
    manufacturingSpec?.tube_dry_weight_g ??
      documentSnapshot?.header?.tube_dry_weight_g ??
      recipeSummary?.predicted_dry_tube_g ??
      0,
  )
  const tubeWetWeightG = Number(
    manufacturingSpec?.tube_wet_weight_g ??
      documentSnapshot?.header?.tube_wet_weight_g ??
      recipeSummary?.predicted_wet_tube_g ??
      0,
  )
  const bambooDryWeightG = Number(
    manufacturingSpec?.bamboo_dry_weight_g ??
      documentSnapshot?.header?.bamboo_dry_weight_g ??
      0,
  )
  const bambooWetWeightG = Number(
    manufacturingSpec?.bamboo_wet_weight_g ??
      documentSnapshot?.header?.bamboo_wet_weight_g ??
      recipeSummary?.bamboo_wet_weight_g ??
      0,
  )
  const bambooTrimDryWeightG = Number(
    manufacturingSpec?.bamboo_trim_dry_weight_g ??
      documentSnapshot?.header?.bamboo_trim_dry_weight_g ??
      0,
  )
  const bambooTrimWetWeightG = Number(
    manufacturingSpec?.bamboo_trim_wet_weight_g ??
      documentSnapshot?.header?.bamboo_trim_wet_weight_g ??
      recipeSummary?.bamboo_trim_wet_weight_g ??
      0,
  )
  const wholeBambooDryWeightG = Number(
    manufacturingSpec?.whole_bamboo_dry_weight_g ??
      documentSnapshot?.header?.whole_bamboo_dry_weight_g ??
      bambooDryWeightG + bambooTrimDryWeightG,
  )
  const wholeBambooWetWeightG = Number(
    manufacturingSpec?.whole_bamboo_wet_weight_g ??
      documentSnapshot?.header?.whole_bamboo_wet_weight_g ??
      recipeSummary?.whole_bamboo_wet_weight_g ??
      bambooWetWeightG + bambooTrimWetWeightG,
  )
  const weightPerMmG = Number(
    manufacturingSpec?.weight_per_mm_g ??
      documentSnapshot?.header?.weight_per_mm_g ??
      0,
  )
  const qrValue = documentSnapshot?.header?.qr_value || buildProductionEntryUrl(jobCardId)
  const assignedWinderMachineId = String(
    documentSnapshot?.header?.assigned_winder_machine_id ||
      documentSnapshot?.header?.winder_machine_id ||
      stageSegments.find((segment: any) => segment.stage_type === "WINDER" && segment.machine_id)?.machine_id ||
      "",
  )
  const selectedWinderLabel =
    (assignedWinderMachineId ? machineLabelMap.get(assignedWinderMachineId) : null) ||
    lineMachineLabel
  const currentMachineLabel =
    (activeSegment?.machine_id ? machineLabelMap.get(activeSegment.machine_id) : null) ||
    selectedWinderLabel
  const currentShiftLabel = [activeSegment?.shift_code || "--", activeSegment?.plan_date || "--"].join(" · ")
  const primaryStageAssignment = stageAssignment(card?.requires_slitting ? "SLITTING" : "WINDER")
  const parchmentLabel =
    documentSnapshot?.header?.color ||
    card?.sales_order?.lines?.[0]?.parchment_color ||
    card?.spec_snapshot?.parchment_color ||
    "-"
  const packagingSummary = [documentSnapshot?.setup_tooling?.box, documentSnapshot?.setup_tooling?.qty_per_box ? `${documentSnapshot.setup_tooling.qty_per_box} / box` : null]
    .filter(Boolean)
    .join(" · ")

  function updateStageForm(stage: StageName, updater: (current: any) => any) {
    setStageForms((current) => ({
      ...current,
      [stage]: updater(
        current[stage] || {
          remarks: "",
          override_reason: "",
          reel_issue_ids: [],
          entry_snapshot: normalizeStageEntry(stage, {}),
        },
      ),
    }))
  }

  function updateSnapshotField(stage: StageName, field: string, value: string) {
    updateStageForm(stage, (current) => {
      const next = {
        ...(current.entry_snapshot || {}),
        [field]: value,
      }
      if (field === "start_time" || field === "end_time") {
        // Cycle Time (B-A) is derived from the card times, never typed.
        next.cycle_time = cycleTimeFromCard(next.start_time, next.end_time)
      }
      return { ...current, entry_snapshot: next }
    })
  }

  function updateNestedSnapshotField(stage: StageName, field: string, nestedField: string, value: string) {
    updateStageForm(stage, (current) => ({
      ...current,
      entry_snapshot: {
        ...(current.entry_snapshot || {}),
        [field]: {
          ...((current.entry_snapshot || {})[field] || {}),
          [nestedField]: value,
        },
      },
    }))
  }

  function updateDimensionReading(index: number, field: string, value: string) {
    updateStageForm("WINDER", (current) => {
      const rows = Array.isArray(current.entry_snapshot?.dimension_readings)
        ? [...current.entry_snapshot.dimension_readings]
        : blankWinderEntry().dimension_readings
      rows[index] = {
        ...(rows[index] || blankWinderEntry().dimension_readings[0]),
        [field]: value,
      }
      return {
        ...current,
        entry_snapshot: {
          ...(current.entry_snapshot || {}),
          dimension_readings: rows,
        },
      }
    })
  }

  function stageRow(stage: StageName) {
    return stages.find((row: any) => row.stage_type === stage) || null
  }

  function stageSegment(stage: StageName) {
    const selectedId = stageForms[stage]?.segment_id
    const rows = stageSegments
      .filter((segment: any) => segment.stage_type === stage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
      .sort((a: any, b: any) => Number(a.segment_no || 1) - Number(b.segment_no || 1) || Number(a.sequence_no || 1) - Number(b.sequence_no || 1))
    return rows.find((segment: any) => segment.id === selectedId) || rows[0] || null
  }

  function stageAssignment(stage: StageName) {
    const row = stageRow(stage)
    const segment = stageSegment(stage)
    const machineId = row?.machine_id || segment?.machine_id
    const shiftCode = row?.shift_code || segment?.shift_code
    const planDate = row?.plan_date || segment?.plan_date || ""
    const machineLabel = machineId ? machineLabelMap.get(String(machineId)) || String(machineId).slice(0, 8) : ""
    const shiftLabel = shiftCode ? [String(shiftCode).replace("_", " "), planDate].filter(Boolean).join(" · ") : ""
    const needsPlannerAssignment = ["SLITTING", "WINDER", "OVEN", "PROCESS"].includes(stage)
    const missingRequiredAssignment = needsPlannerAssignment && (!machineId || !shiftCode)
    return { machineId, machineLabel, shiftCode, shiftLabel, planDate, missingRequiredAssignment }
  }

  function stageEditable(stage: StageName) {
    const row = stageRow(stage)
    if (stage === "DISPATCH") return false
    if (mode !== "supervisor" || row?.status === "COMPLETED" || stageAssignment(stage).missingRequiredAssignment) {
      return false
    }
    if (stage === currentStage && PLANNER_GATED_STAGES.includes(stage) && !plannerGateReady) {
      return false
    }
    return true
  }

  function stageQcInspection(stage: QcStageKey) {
    const rows = Array.isArray(card?.quality_inspections) ? card.quality_inspections : []
    return [...rows]
      .reverse()
      .find((row: any) => String(row?.stage_type || "").toUpperCase() === stage) || null
  }

  function frozenQcProfile() {
    return card?.spec_snapshot?.qc_profile || documentSnapshot?.qc_profile || {}
  }

  function renderStageQc(stage: QcStageKey, options?: { print?: boolean }) {
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    const profile = frozenQcProfile()
    const inspection = stageQcInspection(stage)
    const rules = inspectionFrozenRules(inspection, profile, stage)
    const revision = inspectionProfileRevision(inspection, profile)
    const checkpoint = stage === "WINDER" ? "Winding" : stage === "OVEN" ? "Oven" : "Process"
    const readings = options?.print
      ? Object.fromEntries(
          Object.entries(inspection?.readings || entry.qc_readings || {}).map(([key, value]) => [key, value == null ? "" : String(value)]),
        )
      : entry.qc_readings || {}
    const reasons = options?.print
      ? Object.fromEntries(
          Object.entries(inspection?.reasons || entry.qc_reasons || {}).map(([key, value]) => [key, value == null ? "" : String(value)]),
        )
      : entry.qc_reasons || {}
    return (
      <div
        className="mt-3 rounded-xl border border-signal-cyan-line bg-signal-cyan-soft/50 p-3"
        data-testid={options?.print ? `print-qc-${stage.toLowerCase()}` : `stage-qc-${stage.toLowerCase()}`}
        data-profile-revision={revision == null ? "" : String(revision)}
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-signal-cyan-ink">
          Stage QC · frozen approved ranges · {checkpoint} · Rev {revision ?? "—"}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Allowed bands come from the job-card snapshot and signed inspection. Later profile revisions do not relabel this card.
        </p>
        <div className="mt-3">
          <StageQcFields
            rules={rules}
            readings={readings}
            reasons={reasons}
            sampleId={inspection?.sample_id || entry.qc_sample_id}
            paired={stage === "OVEN"}
            editable={options?.print ? false : stageEditable(stage)}
            printLayout={Boolean(options?.print)}
            profileRevision={revision}
            checkpoint={checkpoint}
            onReadingChange={(code, value) => updateNestedSnapshotField(stage, "qc_readings", code, value)}
            onReasonChange={(code, value) => updateNestedSnapshotField(stage, "qc_reasons", code, value)}
            onSampleIdChange={(value) => updateSnapshotField(stage, "qc_sample_id", value)}
          />
        </div>
      </div>
    )
  }

  function draftPayload(stage: StageName) {
    const form = stageForms[stage] || {
      remarks: "",
      override_reason: "",
      reel_issue_ids: [],
      entry_snapshot: normalizeStageEntry(stage, {}),
    }
    let entry =
      stage === "WINDER"
        ? normalizeWinderEntryForSubmit({ ...(form.entry_snapshot || {}), winder_no: (form.entry_snapshot || {}).winder_no || lineMachineLabel })
        : form.entry_snapshot || {}
    if (stage === "OVEN") {
      const checks = collectStageQualityChecks("OVEN", entry)
      entry = {
        ...entry,
        pre_weight: checks.readings.pre_weight ?? entry.pre_weight,
        post_weight: checks.readings.post_weight ?? entry.post_weight,
        pre_moisture: checks.readings.pre_moisture ?? entry.pre_moisture,
        post_moisture: checks.readings.post_moisture ?? entry.post_moisture,
      }
    }
    if (stage === "PROCESS") {
      const checks = collectStageQualityChecks("PROCESS", entry)
      entry = {
        ...entry,
        final_measurements: {
          ...(entry.final_measurements || {}),
          ...checks.readings,
        },
      }
    }
    const stageMeta = stageRow(stage)
    const payload: Record<string, any> = {
      stage,
      segment_id: form.segment_id || undefined,
      entry_snapshot: entry,
      remarks: form.remarks || null,
      override_reason: form.override_reason || null,
      reel_issue_ids: form.reel_issue_ids || [],
    }
    const assignment = stageAssignment(stage)
    if (assignment.machineId) {
      payload.machine_id = assignment.machineId
    } else if (stageMeta?.machine_id) {
      payload.machine_id = stageMeta.machine_id
    }
    const submittedShift = (entry.shift_code || "").toString().trim() || assignment.shiftCode || stageMeta?.shift_code || ""
    if (submittedShift) {
      payload.shift_code = submittedShift
    }
    const cardStart = cardTimeToIso(entry.start_time)
    const cardEnd = cardTimeToIso(entry.end_time)
    if (cardStart) payload.start_time = cardStart
    if (cardEnd) payload.end_time = cardEnd
    if (stage === "SLITTING" && entry.slit_output_weight_kg !== "") {
      payload.input_qty = Number(entry.slit_output_weight_kg)
    }
    if (stage === "WINDER" && entry.bamboo_count_produced !== "") {
      payload.input_qty = Number(entry.bamboo_count_produced)
    }
    if (stage === "OVEN" && entry.bamboo_count_in !== "") {
      payload.input_qty = Number(entry.bamboo_count_in)
    }
    return payload
  }

  function completePayload(stage: StageName) {
    const base = draftPayload(stage)
    const entry = base.entry_snapshot || {}
    if (stage === "SLITTING") {
      return {
        ...base,
        input_qty: entry.slit_output_weight_kg !== "" ? Number(entry.slit_output_weight_kg) : base.input_qty,
        output_qty: entry.slit_output_weight_kg !== "" ? Number(entry.slit_output_weight_kg) : 0,
        scrap_qty: entry.trim_wastage_weight_kg !== "" ? Number(entry.trim_wastage_weight_kg) : 0,
      }
    }
    if (stage === "WINDER") {
      const checks = collectStageQualityChecks("WINDER", entry)
      return {
        ...base,
        input_qty: entry.bamboo_count_produced !== "" ? Number(entry.bamboo_count_produced) : base.input_qty,
        output_qty: entry.accepted_bamboo_count !== "" ? Number(entry.accepted_bamboo_count) : 0,
        scrap_qty: entry.reject_bamboo_count !== "" ? Number(entry.reject_bamboo_count) : 0,
        ...(checks.hasReadings
          ? {
              quality_checks: {
                samples: checks.samples,
                reasons: checks.reasons,
                sample_id: checks.sample_id,
                unit_conflicts: checks.unit_conflicts,
              },
            }
          : {}),
      }
    }
    if (stage === "OVEN") {
      const checks = collectStageQualityChecks("OVEN", entry)
      return {
        ...base,
        input_qty: entry.bamboo_count_in !== "" ? Number(entry.bamboo_count_in) : base.input_qty,
        output_qty: entry.bamboo_count_out !== "" ? Number(entry.bamboo_count_out) : 0,
        ...(checks.hasReadings
          ? {
              quality_checks: {
                samples: checks.samples,
                reasons: checks.reasons,
                sample_id: checks.sample_id,
                unit_conflicts: checks.unit_conflicts,
              },
            }
          : {}),
      }
    }
    if (stage === "PROCESS") {
      const checks = collectStageQualityChecks("PROCESS", entry)
      return {
        ...base,
        output_qty: entry.process_qty !== "" ? Number(entry.process_qty) : 0,
        scrap_qty: entry.reject_qty !== "" ? Number(entry.reject_qty) : 0,
        ...(checks.hasReadings
          ? {
              quality_checks: {
                samples: checks.samples,
                reasons: checks.reasons,
                sample_id: checks.sample_id,
                unit_conflicts: checks.unit_conflicts,
              },
            }
          : {}),
      }
    }
    if (stage === "QC") {
      return {
        ...base,
        output_qty: entry.accepted_qty !== "" ? Number(entry.accepted_qty) : 0,
        scrap_qty: entry.hold_qty !== "" ? Number(entry.hold_qty) : 0,
        quality_checks: {
          accepted_qty: entry.accepted_qty !== "" ? Number(entry.accepted_qty) : 0,
          hold_qty: entry.hold_qty !== "" ? Number(entry.hold_qty) : 0,
          disposition: entry.disposition || "",
        },
      }
    }
    if (stage === "DISPATCH") {
      return {
        ...base,
        output_qty: entry.dispatch_qty !== "" ? Number(entry.dispatch_qty) : 0,
      }
    }
    return {
      ...base,
      output_qty: entry.total_packed_qty !== "" ? Number(entry.total_packed_qty) : 0,
    }
  }

  function cardTimeProblem(stage: StageName, saveMode: "draft" | "complete"): string | null {
    const form = stageForms[stage] || {}
    const entry = form.entry_snapshot || {}
    const start = parseStageTime(entry.start_time)
    const end = parseStageTime(entry.end_time)
    if (saveMode === "complete" && CARD_TIMED_STAGES.includes(stage) && (!start || !end) && !String(form.override_reason || "").trim()) {
      return `Enter the Start (A) and End (B) times written on the ${stage} section of the job card.`
    }
    if (start && end && end < start) {
      return `${stage} End (B) cannot be before Start (A). Check the date on the card.`
    }
    const futureLimit = Date.now() + 10 * 60 * 1000
    if ((start && start.getTime() > futureLimit) || (end && end.getTime() > futureLimit)) {
      return `${stage} card time is in the future. Enter the time written on the job card.`
    }
    return null
  }

  function showStageWarnings(response: any) {
    const warnings = response?.data?.warnings ?? response?.warnings
    if (Array.isArray(warnings) && warnings.length) {
      showToast(warnings.join(" "), "info")
    }
  }

  async function saveStage(stage: StageName, saveMode: "draft" | "complete") {
    if (!jobCardId) return
    const assignment = stageAssignment(stage)
    if (assignment.missingRequiredAssignment) {
      showToast("Planner must assign machine and shift before supervisor entry can continue.", "error")
      return
    }
    if (STAGES_REQUIRING_SHIFT.includes(stage)) {
      const formEntry = stageForms[stage]?.entry_snapshot || {}
      const stageShift = (formEntry.shift_code || "").toString().trim() || assignment.shiftCode || ""
      if (!stageShift) {
        showToast(`Shift selection is required before saving ${stage}.`, "error")
        return
      }
    }
    const timeProblem = cardTimeProblem(stage, saveMode)
    if (timeProblem) {
      showToast(timeProblem, "error")
      return
    }
    try {
      if (saveMode === "draft") {
        const response: any = await saveDraftMutation.mutateAsync({
          jobCardId,
          data: draftPayload(stage),
        })
        showToast(`${stage} draft saved`, "success")
        showStageWarnings(response)
      } else {
        const response: any = await completeStageMutation.mutateAsync({
          jobCardId,
          data: completePayload(stage),
        })
        showToast(`${stage} saved as completed`, "success")
        showStageWarnings(response)
      }
      jobCardQuery.refetch()
    } catch (error: any) {
      const message =
        error?.response?.data?.detail ||
        error?.response?.data?.message ||
        error?.message ||
        "Unable to save stage"
      showToast(typeof message === "string" ? message : JSON.stringify(message), "error")
    }
  }

  function sectionActions(stage: StageName) {
    if (mode !== "supervisor") return null
    const disabled = !stageEditable(stage) || saveDraftMutation.isPending || completeStageMutation.isPending
    return (
      <div className="mt-3 flex flex-wrap gap-2 no-print">
        <button
          type="button"
          onClick={() => saveStage(stage, "draft")}
          disabled={disabled}
          className="inline-flex items-center gap-2 border border-slate-900 px-3 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          Save Draft
        </button>
        <button
          type="button"
          onClick={() => saveStage(stage, "complete")}
          disabled={disabled}
          data-testid={`complete-stage-${stage}`}
          className="inline-flex items-center gap-2 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          Complete Stage
        </button>
      </div>
    )
  }

  function renderSegmentSelector(stage: StageName) {
    const stageOpenSegments = stageSegments.filter((segment: any) => segment.stage_type === stage && segment.status !== "COMPLETED" && segment.status !== "CANCELLED")
    if (mode !== "supervisor" || stage !== currentStage || stageOpenSegments.length <= 1) return null
    return (
      <div className="rounded-[1.1rem] border border-signal-amber-line bg-signal-amber-soft p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal-amber-ink">Open Segments</div>
        <p className="mt-2 text-sm text-muted-foreground">This stage is split across multiple shifts. Pick the live segment before entering actuals.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {stageOpenSegments.map((segment: any) => {
            const selected = stageForms[stage]?.segment_id === segment.id
            return (
              <button
                key={segment.id}
                type="button"
                onClick={() =>
                  updateStageForm(stage, (current) => ({
                    ...current,
                    segment_id: segment.id,
                  }))
                }
                className={`rounded-xl border px-3 py-3 text-left transition ${
                  selected ? "border-slate-950 bg-slate-950 text-white" : "border-border bg-card text-foreground"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em]">
                  Segment {segment.segment_no}
                </div>
                <div className="mt-2 text-sm">
                  {Number(segment.planned_qty || 0).toFixed(0)} pcs · {segment.shift_code || "Open"} · {segment.plan_date || "Unscheduled"}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderCurrentStageSection(stage: StageName) {
    if (stage === "SLITTING") return renderSlittingSection()
    if (stage === "WINDER") return renderWinderSection()
    if (stage === "OVEN") return renderOvenSection()
    if (stage === "PROCESS") return renderProcessSection()
    if (stage === "PACKING") return renderPackingSection()
    if (stage === "QC") return renderQcSection()
    return renderDispatchSection()
  }

  function renderLateQualityException() {
    const rows = Array.isArray(card?.quality_inspections) ? card.quality_inspections : []
    const late = rows.find((row: any) => row?.late_quality_exception || row?.evaluation?.late_quality_exception)
    if (!late) return null
    const evaluation = late.evaluation || {}
    const surviving = late.surviving_stock || evaluation.surviving_stock || []
    const shipments = late.earlier_shipments || evaluation.earlier_shipments || []
    return (
      <section data-testid="late-quality-exception" className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-signal-amber-ink">
          {late.late_exception_label || evaluation.late_exception_label || "Late quality exception"}
        </div>
        <p className="mt-1 text-sm font-semibold text-signal-amber-ink">
          Measured and recorded clocks are distinct. Surviving stock is traced. Earlier shipment remains as it occurred.
        </p>
        <div className="mt-2 grid gap-2 text-sm text-signal-amber-ink md:grid-cols-2">
          <div data-testid="qc-measured-at">Measured {String(late.measured_at || evaluation.measured_at || "")}</div>
          <div data-testid="qc-recorded-at">Recorded {String(late.recorded_at || evaluation.recorded_at || "")}</div>
        </div>
        {surviving.length ? (
          <div className="mt-2 text-sm" data-testid="surviving-stock">
            Surviving {surviving.map((row: any) => `${row.kind} ${row.qty}`).join(" · ")}
          </div>
        ) : null}
        {shipments.length ? (
          <div className="mt-1 text-sm" data-testid="earlier-shipment">
            Earlier shipment {shipments.map((row: any) => `${row.status} ${row.qty}`).join(" · ")}
          </div>
        ) : null}
      </section>
    )
  }

  function renderRestrictedPhysicalOutput() {
    if (!restrictedPhysicalStage) return null
    return (
      <section
        data-testid="restricted-physical-output"
        className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-signal-amber-ink">
          Restricted physical output
        </div>
        <p className="mt-1 text-sm font-semibold text-signal-amber-ink">
          Actual production is retained. Failed quantity is not unrestricted good stock.
        </p>
        <div className="mt-2 grid gap-2 text-sm text-signal-amber-ink md:grid-cols-3">
          <div>Stage {restrictedPhysicalStage.stage_type}</div>
          <div data-testid="restricted-output-qty">Qty {formatNumber(restrictedPhysicalStage.output_qty, 0)}</div>
          <div data-testid="restricted-stock-status">
            {String(restrictedPhysicalStage.actuals_snapshot?.stock_status || "QC_HOLD")}
          </div>
        </div>
      </section>
    )
  }

  function renderCompactExecutionLayout() {
    const previousStageRows = stages.filter((row: any) => row.stage_type !== currentStage && row.status === "COMPLETED")
    return (
      <div className="w-full space-y-4">
        {mode === "view" ? (
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Snapshot Mode: <span className="font-semibold text-foreground">{card?.snapshot_mode}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/production/job-cards/${jobCardId}/print`}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-900 px-4 py-2 text-sm font-semibold text-foreground"
              >
                <Printer className="h-4 w-4" />
                Print
              </Link>
              <Link
                href={`/production/supervisor-entry?job_card_id=${jobCardId}`}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Open Supervisor Entry
              </Link>
              <a
                href={qrValue}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground"
              >
                <Smartphone className="h-4 w-4" />
                Open mobile link
              </a>
            </div>
          </div>
        ) : null}
        {renderRestrictedPhysicalOutput()}
        {renderLateQualityException()}
        <section className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1.55fr)_24rem]">
            <div className="border-b border-border bg-card px-6 py-6 text-white lg:border-b-0 lg:border-r">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">Production Execution</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{card?.job_card_ref || card?.id}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200/80">
                Shop-floor view driven from the saved manufacturing matrix. Assigned winder, bamboo target, recipe path, and current stage logging stay on one card so the operator and supervisor are reading the same truth.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Customer</div><div className="mt-1 text-sm font-semibold">{documentSnapshot?.header?.customer_name || "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Product</div><div className="mt-1 text-sm font-semibold">{documentSnapshot?.header?.product_code || card?.product_code || "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Spec Ref</div><div className="mt-1 text-sm font-semibold">{specReference}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Size</div><div className="mt-1 text-sm font-semibold">{documentSnapshot?.header?.product_size_label || "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Current Stage</div><div className="mt-1 text-sm font-semibold">{currentStage}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Release Qty</div><div className="mt-1 text-sm font-semibold">{formatNumber(card?.released_qty || card?.planned_qty, 0)} pcs</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Assigned Winder</div><div className="mt-1 text-sm font-semibold">{selectedWinderLabel}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Pcs / Bamboo</div><div className="mt-1 text-sm font-semibold">{formatNumber(documentSnapshot?.header?.pcs_per_bamboo, 0)}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Bamboo Length</div><div className="mt-1 text-sm font-semibold">{formatNumber(selectedBambooLength, 0)} mm</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Parchment</div><div className="mt-1 text-sm font-semibold">{parchmentPattern}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Release Lot</div><div className="mt-1 text-sm font-semibold">{card?.release_lot_id ? String(card.release_lot_id).slice(0, 8) : "-"}</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70">Sales Line</div><div className="mt-1 text-sm font-semibold">{card?.sales_order_line_id ? String(card.sales_order_line_id).slice(0, 8) : "-"}</div></div>
              </div>
            </div>
            <div className="grid gap-3 bg-card px-6 py-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border bg-card px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Target Bamboo</div><div className="mt-1 text-lg font-semibold text-foreground">{formatNumber(targetBambooCount, 0)}</div></div>
                <div className="rounded-2xl border border-border bg-card px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Open Segments</div><div className="mt-1 text-lg font-semibold text-foreground">{card?.open_segment_count ?? currentStageSegments.length}</div></div>
                <div className="rounded-2xl border border-border bg-card px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Current Machine</div><div className="mt-1 text-sm font-semibold text-foreground">{currentMachineLabel}</div></div>
                <div className="rounded-2xl border border-border bg-card px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Shift Slot</div><div className="mt-1 text-sm font-semibold text-foreground">{currentShiftLabel}</div></div>
              </div>
              {PLANNER_GATED_STAGES.includes(currentStage) ? (
                <div className={`rounded-2xl border px-4 py-3 ${plannerGateReady ? "border-signal-emerald-line bg-signal-emerald-soft" : "border-signal-amber-line bg-signal-amber-soft"}`}>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Planner Gate</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {plannerGateReady ? "Ready for floor entry" : "Blocked until planner slot is valid"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {plannerGateReady
                      ? `Scheduled ${card?.active_segment_plan_date || activeSegment?.plan_date || "-"} · ${currentMachineLabel}`
                      : plannerGateReason || "Planner must place this stage in the next 3 days before supervisor entry."}
                  </div>
                </div>
              ) : null}
              <div
                data-testid="dispatch-gate"
                className={`rounded-2xl border px-4 py-3 ${dispatchGateBlocked ? "border-signal-rose-line bg-signal-rose-soft" : "border-signal-emerald-line bg-signal-emerald-soft"}`}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Dispatch Gate</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{dispatchGateBlocked ? "Blocked" : "Ready"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {dispatchGateBlocked
                    ? `Pending: ${incompleteUpstreamStages.join(", ")}${activeHoldCount > 0 ? ` | QC holds ${activeHoldCount}` : ""}`
                    : "Packing and QC are complete with no active hold."}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Execution Target</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {formatNumber(targetBambooCount, 0)} bamboo • {formatNumber(pcsPerBamboo, 0)} pcs/bamboo • {formatNumber(selectedBambooLength, 0)} mm
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Tube {formatNumber(tubeDryWeightG)} / {formatNumber(tubeWetWeightG)} g • Bamboo {formatNumber(bambooDryWeightG)} / {formatNumber(bambooWetWeightG)} g
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusChipClass(
                      activeSegment?.status || card?.status || "PLANNED",
                    )}`}
                  >
                    {activeSegment?.status || card?.status || "PLANNED"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3">
                <QRCodeSVG value={qrValue} size={72} />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Scan Entry</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">Phone scan opens the live stage-entry screen for this exact job card on the running ERP host.</div>
                  <a href={qrValue} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-[11px] text-signal-cyan-ink hover:text-signal-cyan-ink">
                    {qrValue}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_26rem]">
          <div className="space-y-4">
            {renderSegmentSelector(currentStage)}
            <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current stage logging</div>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">{currentStage} actual output capture</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Enter only the live output, rejects, timings, and measured dimensions for the active segment. Manufacturing recipe, bamboo math, and packaging truth stay readonly on the right.
                  </p>
                </div>
                <div className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                  {activeSegment?.shift_code || "Open segment"}
                </div>
              </div>
            </section>
            {renderCurrentStageSection(currentStage)}
            <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm" data-testid="physical-tool-issue">
              {renderToolAssignment(currentStage)}
            </section>
          </div>
          <div className="space-y-4">
            <section className="rounded-[1.4rem] border border-border bg-card p-5 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Manufacturing Truth</div>
              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-border bg-muted px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Spec + Manufacturing Matrix</div>
                  <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Spec Ref</div>
                      <div className="mt-1 font-semibold text-foreground">{specReference}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Mandrel</div>
                      <div className="mt-1 font-semibold text-foreground">{mandrelLabel}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">ID Band</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(clientSpec?.id?.min)} / {formatNumber(clientSpec?.id?.avg)} / {formatNumber(clientSpec?.id?.max)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">OD Band</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(clientSpec?.od?.min)} / {formatNumber(clientSpec?.od?.avg)} / {formatNumber(clientSpec?.od?.max)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Wall Thickness</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(clientSpec?.thickness?.avg, 4)} mm
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Required CS</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(manufacturingSpec?.final_required_cs)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Notch Direction</div>
                      <div className="mt-1 font-semibold text-foreground">{documentSnapshot?.setup_tooling?.notch_direction || documentSnapshot?.setup_tooling?.tube_direction || "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Wet Rule</div>
                      <div className="mt-1 font-semibold text-foreground">
                        Dry ÷ {Number(1 - Number(recipeSummary?.drying_percent || 0) / 100).toFixed(3)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Tube Dry / Wet</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(tubeDryWeightG)} / {formatNumber(tubeWetWeightG)} g
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Weight / mm</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(weightPerMmG, 4)} g
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-muted px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Paper Recipe to Follow</div>
                  {recipeRows.length === 0 ? (
                    <div className="mt-2 text-sm text-muted-foreground">Recipe rows were not captured on this snapshot.</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {recipeRows.map((row: any, index: number) => (
                        <div key={`${row.paper_id || row.code || "recipe"}-${index}`} className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-foreground">
                              {row.code || "PAPER"} · {row.variety || row.category || "Paper"}
                            </div>
                            <div className="text-xs font-medium text-muted-foreground">
                              {formatNumber(row.plyCount || row.actualPlyCount, 0)} plies
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatNumber(row.gsm, 0)} GSM · BF {formatNumber(row.bfPerPly, 0)} · Thickness {formatNumber(row.thicknessPerPly, 4)} mm · Weight / tube {formatNumber(row.weightAllPly || row.totalWeightG, 2)} g · Positions {row.positionsText || "-"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-muted px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bamboo to Be Made</div>
                  <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Target Bamboo</div>
                      <div className="mt-1 font-semibold text-foreground">{formatNumber(targetBambooCount, 0)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Pcs / Bamboo</div>
                      <div className="mt-1 font-semibold text-foreground">{formatNumber(pcsPerBamboo, 0)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Bamboo Length</div>
                      <div className="mt-1 font-semibold text-foreground">{formatNumber(selectedBambooLength, 0)} mm</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Usable / Trim</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(usableBambooLength, 0)} / {formatNumber(trimLossMm, 0)} mm
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Tube Dry / Wet</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(tubeDryWeightG)} / {formatNumber(tubeWetWeightG)} g
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Finished Tubes Dry / Wet</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(bambooDryWeightG)} / {formatNumber(bambooWetWeightG)} g
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Trim Dry / Wet</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(bambooTrimDryWeightG)} / {formatNumber(bambooTrimWetWeightG)} g
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Whole Bamboo Dry / Wet</div>
                      <div className="mt-1 font-semibold text-foreground">
                        {formatNumber(wholeBambooDryWeightG)} / {formatNumber(wholeBambooWetWeightG)} g
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-muted px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Glue + Bridge</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    Base {formatNumber(recipeSummary?.glue_base_percent)}% · Parchment {formatNumber(recipeSummary?.parchment_percent)}% · Drying {formatNumber(recipeSummary?.drying_percent)}%
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Paper {formatNumber(recipeSummary?.paper_total_g)} g · Glue {formatNumber(recipeSummary?.adhesive_total_g)} g · Parchment {formatNumber(recipeSummary?.parchment_weight_g)} g · Delta {formatNumber(recipeSummary?.weight_match_delta_g)} g
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {adhesiveComponents.length === 0 ? (
                      <div>No adhesive mix was captured on this snapshot.</div>
                    ) : (
                      adhesiveComponents.map((component: any, index: number) => (
                        <div key={`${component.name || "adhesive"}-${index}`}>
                          {component.name || "Adhesive"} · ratio {formatNumber(component.ratio_percent)}%
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-muted px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Parchment Pattern</div><div className="mt-1 text-sm font-semibold text-foreground">{parchmentPattern}</div><div className="mt-1 text-xs text-muted-foreground">{parchmentFamily} family</div></div>
                {parchmentResolution === "CONFLICT" ? (
                  <div data-testid="parchment-conflict-banner" className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-signal-amber-ink">Parchment / spec mismatch</div>
                    <div className="mt-1 text-sm font-semibold text-signal-amber-ink">Controlled conflict — approved recipe parchment was not rewritten.</div>
                    <div className="mt-1 text-xs text-signal-amber-ink">Recipe {String(approvedParchmentColor || "—")} · Ordered {String(parchmentConflict?.ordered_color || documentSnapshot?.header?.ordered_parchment_color || "—")}</div>
                  </div>
                ) : null}
                <div className="rounded-xl border border-border bg-muted px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Notch</div><div className="mt-1 text-sm font-semibold text-foreground">{documentSnapshot?.setup_tooling?.notch_type || "No notch"}</div><div className="mt-1 text-xs text-muted-foreground">Distance {documentSnapshot?.setup_tooling?.notch_distance || "-"} · Depth {documentSnapshot?.setup_tooling?.notch_depth || "-"} · Direction {documentSnapshot?.setup_tooling?.notch_direction || documentSnapshot?.setup_tooling?.tube_direction || "-"}</div><div className="mt-1 text-xs text-muted-foreground">Blade {documentSnapshot?.setup_tooling?.blade || "-"} · Holder {documentSnapshot?.setup_tooling?.notching_holder || documentSnapshot?.setup_tooling?.holder || "-"} · Punch {documentSnapshot?.setup_tooling?.punch || "-"}</div></div>
                <div className="rounded-xl border border-border bg-muted px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Packing</div><div className="mt-1 text-sm font-semibold text-foreground">{documentSnapshot?.setup_tooling?.packing_instructions || "Packed by route stage when required"}</div><div className="mt-1 text-xs text-muted-foreground">{documentSnapshot?.setup_tooling?.box_code || "-"} · {documentSnapshot?.setup_tooling?.box_size || "-"} · {documentSnapshot?.setup_tooling?.qty_per_box || "-"} / box</div></div>
                <div className="rounded-xl border border-border bg-muted px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bamboo Math</div><div className="mt-1 text-sm font-semibold text-foreground">{formatNumber(documentSnapshot?.header?.target_bamboo_count, 0)} bamboo target · {formatNumber(documentSnapshot?.header?.pcs_per_bamboo, 0)} pcs/bamboo</div><div className="mt-1 text-xs text-muted-foreground">{formatNumber(selectedBambooLength, 0)} mm selected · {formatNumber(usableBambooLength, 0)} mm usable · {formatNumber(trimLossMm, 0)} mm trim</div></div>
                <div className="rounded-xl border border-border bg-muted px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Output Truth</div><div className="mt-1 text-sm font-semibold text-foreground">{formatNumber(wipQty, 0)} open pcs · {formatNumber(documentSnapshot?.material_truth?.produced_output_qty, 0)} produced · {formatNumber(documentSnapshot?.material_truth?.packed_qty, 0)} packed</div></div>
              </div>
            </section>

            <section className="rounded-[1.4rem] border border-border bg-card p-5 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Previous Stage Actuals</div>
              <div className="mt-4 space-y-3">
                {previousStageRows.length === 0 ? (
                  <div className="rounded-xl border border-border bg-muted px-4 py-4 text-sm text-muted-foreground">No completed upstream stage is recorded yet.</div>
                ) : (
                  previousStageRows.map((row: any) => (
                    <div key={row.stage_type} className="rounded-xl border border-border bg-muted px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-foreground">{row.stage_type}</div>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${statusChipClass(row.status || "COMPLETED")}`}>{row.status}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>Output: {formatNumber(row.output_qty, 0)}</div>
                        <div>Scrap: {formatNumber(row.scrap_qty, 0)}</div>
                        <div>Card start (A): {formatStageTime(row.actual_start, true) || "-"}</div>
                        <div>Card end (B): {formatStageTime(row.actual_end, true) || "-"}</div>
                        <div>Cycle: {formatMinutes(row.actuals_snapshot?.time_reconciliation?.cycle_time_minutes) || "-"}</div>
                        <div>
                          Entered: {formatStageTime(row.actuals_snapshot?.time_reconciliation?.entered_at || row.entered_at, true) || "-"}
                          {row.actuals_snapshot?.time_reconciliation?.late_entry ? (
                            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">late</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    )
  }

  function renderAssignmentWarning(stage: StageName) {
    const assignment = stageAssignment(stage)
    const shouldShowPlannerGateWarning =
      stage === currentStage && PLANNER_GATED_STAGES.includes(stage) && !plannerGateReady
    if (!assignment.missingRequiredAssignment && !shouldShowPlannerGateWarning) return null
    return (
      <div className="mt-3 rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-3 text-sm text-signal-rose-ink no-print">
        {assignment.missingRequiredAssignment
          ? "Planner assignment is missing for this stage. Assign machine and shift on the planning board before supervisor entry."
          : plannerGateReason || "This stage is not yet scheduled inside the next-three-day planner window."}
      </div>
    )
  }

  function renderSlittingSection() {
    const stage = "SLITTING" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    if (!stageData && !card.requires_slitting) return null
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-foreground">Slitting Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Slitter" value={entry.slitter_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time (A) — from card", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time (B) — from card", "end_time", "datetime-local")}
          {renderCycleTime(stage)}
          {renderSimpleField(stage, "Parent Reel ID", "parent_reel_id")}
          {renderSimpleField(stage, "Child Reel IDs", "child_reel_ids_text")}
          {renderShiftPicker(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left">
              <th className="border border-border px-2 py-2">Slit Output Weight (kg)</th>
              <th className="border border-border px-2 py-2">Trim / Wastage (kg)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={entry.slit_output_weight_kg} onChange={(next) => updateSnapshotField(stage, "slit_output_weight_kg", next)} /></td>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={entry.trim_wastage_weight_kg} onChange={(next) => updateSnapshotField(stage, "trim_wastage_weight_kg", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-border px-2 py-2">{entry.slit_output_weight_kg || ""}</td>
                  <td className="border border-border px-2 py-2">{entry.trim_wastage_weight_kg || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderSimpleField(stage: StageName, label: string, field: string, type: "text" | "number" | "date" | "datetime-local" = "text") {
    const value = stageForms[stage]?.entry_snapshot?.[field] ?? ""
    if (!stageEditable(stage)) {
      return <LabeledValue label={label} value={value} />
    }
    return (
      <div className="border border-border px-2 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1">
          <TextInput type={type} value={value} onChange={(next) => updateSnapshotField(stage, field, next)} />
        </div>
      </div>
    )
  }

  function renderToolAssignment(stage: StageName) {
    const rows = Array.isArray(toolAssetsQuery.data) ? toolAssetsQuery.data : []
    const assigned = rows.filter(
      (asset: any) =>
        String(asset.current_job_card_id || "") === String(card?.id || "") &&
        String(asset.current_stage_type || "").toUpperCase() === stage,
    )
    const available = rows.filter((asset: any) => asset.status === "AVAILABLE")
    const selectedId = toolSelection[stage] || ""
    if (!stageEditable(stage)) {
      return <LabeledValue label="Physical Tools" value={assigned.map((asset: any) => asset.asset_no).join(", ") || "-"} />
    }
    const issueSelected = async () => {
      if (!selectedId || !card?.id) return
      try {
        await issueToolMutation.mutateAsync({ id: selectedId, data: { job_card_id: card.id, stage_type: stage } })
        const nextIds = Array.from(new Set([...assigned.map((asset: any) => asset.id), selectedId]))
        updateSnapshotField(stage, "tool_asset_ids", nextIds.join(","))
        setToolSelection((current) => ({ ...current, [stage]: "" }))
        showToast("Physical tool issued and linked to this stage", "success")
      } catch (error: any) {
        const detail = error?.response?.data?.detail || error?.message || "Physical tool could not be issued"
        showToast(String(detail), "error")
      }
    }
    return (
      <div className="border border-border px-2 py-2 md:col-span-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Physical Tool Issue</div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <select
            value={selectedId}
            onChange={(event) => setToolSelection((current) => ({ ...current, [stage]: event.target.value }))}
            className="h-9 min-w-0 flex-1 border border-border bg-card px-2 text-sm"
          >
            <option value="">Scan or select an available QR asset</option>
            {available.map((asset: any) => (
              <option key={asset.id} value={asset.id}>{asset.asset_no} · {asset.definition_name} · {asset.location_label || "Unlocated"}</option>
            ))}
          </select>
          <button type="button" onClick={issueSelected} disabled={!selectedId || issueToolMutation.isPending} className="h-9 bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            Issue to {stage.toLowerCase()}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {assigned.map((asset: any) => <span key={asset.id} className="border border-signal-cyan-line bg-signal-cyan-soft px-2 py-1 text-xs font-semibold text-signal-cyan-ink">{asset.asset_no} · {asset.definition_name}</span>)}
          {!assigned.length ? <span className="text-xs text-muted-foreground">No physical tool issued to this stage.</span> : null}
        </div>
      </div>
    )
  }

  function employeesForStage(stage: StageName) {
    const wanted = String(stage || "").toUpperCase()
    const matched = activeEmployees.filter((emp: any) => {
      const dept = String(emp.department || "").toUpperCase()
      if (dept && dept === wanted) return true
      const skills = String(emp.skills || "").toUpperCase()
      if (!skills) return false
      return skills
        .split(/[,;/|]/)
        .map((token: string) => token.trim())
        .filter(Boolean)
        .includes(wanted)
    })
    // Never show an empty dropdown — fall back to all active employees.
    return matched.length > 0 ? matched : activeEmployees
  }

  function renderOperatorPicker(
    stage: StageName,
    label: string,
    field: string = "operator_name",
    idField: string = "operator_employee_id",
  ) {
    const value = stageForms[stage]?.entry_snapshot?.[field] ?? ""
    if (!stageEditable(stage)) {
      return <LabeledValue label={label} value={value} />
    }
    // Graceful fallback: if the employee master failed to load, keep free-text entry so logging is never blocked.
    if (employeesLoadFailed) {
      return renderSimpleField(stage, label, field)
    }
    const selectedId = stageForms[stage]?.entry_snapshot?.[idField] ?? ""
    const options = employeesForStage(stage)
    // If the saved name isn't a known employee, keep it visible as a free-text legacy value.
    const hasLegacyName = Boolean(value) && !options.some((emp: any) => String(emp.name || "") === String(value))
    return (
      <div className="border border-border px-2 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1">
          <select
            value={selectedId ? String(selectedId) : ""}
            onChange={(event) => {
              const empId = event.target.value
              const emp = options.find((candidate: any) => String(candidate.id) === empId)
              updateStageForm(stage, (current) => ({
                ...current,
                entry_snapshot: {
                  ...(current.entry_snapshot || {}),
                  [field]: emp ? String(emp.name || "") : "",
                  [idField]: emp ? String(emp.id) : "",
                },
              }))
            }}
            className="h-11 w-full rounded-2xl border border-border bg-card/95 px-3 text-sm font-medium text-foreground shadow-sm"
          >
            <option value="">{hasLegacyName ? value : "Select operator…"}</option>
            {options.map((emp: any) => (
              <option key={String(emp.id)} value={String(emp.id)}>
                {emp.name}{emp.employee_code ? ` — ${emp.employee_code}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  function renderLateEntryWarning(stage: StageName) {
    const entry = stageForms[stage]?.entry_snapshot
    if (!entry) return null
    if (!stageEditable(stage)) return renderTimeReconciliation(stage)
    const hoursLate = computeHoursLate(entry.end_time)
    if (hoursLate <= LATE_ENTRY_THRESHOLD_HOURS) return null
    const hoursLabel = hoursLate >= 24 ? `${Math.round(hoursLate / 24 * 10) / 10} days` : `${Math.round(hoursLate * 10) / 10} hours`
    return (
      <div className="mt-2 rounded-md border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-xs font-semibold text-signal-amber-ink no-print">
        Recording {hoursLabel} late — confirm shift selection below.
      </div>
    )
  }

  function renderCycleTime(stage: StageName) {
    const entry = stageForms[stage]?.entry_snapshot || {}
    return <LabeledValue label="Cycle Time (B-A)" value={cycleTimeFromCard(entry.start_time, entry.end_time) || entry.cycle_time || "-"} />
  }

  // Card time vs. system entry time, kept for supervisor reconciliation.
  function renderTimeReconciliation(stage: StageName) {
    const row = stageRow(stage)
    const record = row?.actuals_snapshot?.time_reconciliation
    if (!row || (!record && !row.actual_end)) return null
    const cardStart = formatStageTime(row.actual_start, true) || "-"
    const cardEnd = formatStageTime(row.actual_end, true) || "-"
    const entered = formatStageTime(record?.entered_at || row.entered_at, true) || "-"
    const lag = record?.entry_lag_minutes
    const late = Boolean(record?.late_entry)
    const source = record?.time_source || "LEGACY"
    return (
      <div
        className={`mt-2 grid gap-1 rounded-md border px-3 py-2 text-xs no-print md:grid-cols-4 ${
          late || source !== "CARD" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"
        }`}
      >
        <div><span className="font-semibold">Card A → B:</span> {cardStart} → {cardEnd}</div>
        <div><span className="font-semibold">Cycle:</span> {formatMinutes(record?.cycle_time_minutes) || "-"}</div>
        <div><span className="font-semibold">Entered:</span> {entered}{lag != null ? ` (+${formatMinutes(lag)})` : ""}</div>
        <div className="font-semibold">
          {source === "CARD" ? (late ? "Late entry — reconcile" : "Card time") : source === "SYSTEM_ENTRY" ? "No card time (override)" : "Legacy entry"}
        </div>
      </div>
    )
  }

  function renderShiftPicker(stage: StageName) {
    const currentValue = stageForms[stage]?.entry_snapshot?.shift_code ?? ""
    const isRequired = STAGES_REQUIRING_SHIFT.includes(stage)
    const label = `Shift${isRequired ? " *" : ""}`
    if (!stageEditable(stage)) {
      const display = currentValue || stageAssignment(stage).shiftCode || "-"
      return <LabeledValue label="Shift" value={display} />
    }
    const options = shiftOptions
    return (
      <div className={`border px-2 py-2 ${isRequired && !currentValue ? "border-amber-400 bg-signal-amber-soft" : "border-border"}`}>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1">
          <select
            value={currentValue || ""}
            onChange={(event) => updateSnapshotField(stage, "shift_code", event.target.value)}
            className="h-11 w-full rounded-2xl border border-border bg-card/95 px-3 text-sm font-medium text-foreground shadow-sm"
          >
            <option value="">{isRequired ? "Select shift…" : "Optional"}</option>
            {options.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.code}{opt.name && opt.name !== opt.code ? ` — ${opt.name}` : ""}
              </option>
            ))}
          </select>
        </div>
        {isRequired && !currentValue ? (
          <div className="mt-1 text-[10px] font-semibold text-signal-amber-ink">Shift selection is required for this stage.</div>
        ) : null}
      </div>
    )
  }

  function renderNotes(stage: StageName) {
    const value = stageForms[stage]?.remarks ?? ""
    const overrideReason = stageForms[stage]?.override_reason ?? ""
    if (!value && !overrideReason && !stageEditable(stage)) return null
    if (!stageEditable(stage)) {
      return (
        <div className="mt-3 border border-border px-3 py-2 text-sm text-muted-foreground">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Notes</div>
          <div className="mt-1 whitespace-pre-wrap">{value || "-"}</div>
          {overrideReason ? (
            <>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Override Reason</div>
              <div className="mt-1 whitespace-pre-wrap">{overrideReason}</div>
            </>
          ) : null}
        </div>
      )
    }
    return (
      <div className="mt-3 border border-border px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Notes</div>
        <textarea
          value={value}
          onChange={(event) =>
            updateStageForm(stage, (current) => ({ ...current, remarks: event.target.value }))
          }
          rows={2}
          className="mt-1 w-full border border-border px-2 py-2 text-sm"
        />
        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Override Reason
        </div>
        <textarea
          value={stageForms[stage]?.override_reason ?? ""}
          onChange={(event) =>
            updateStageForm(stage, (current) => ({ ...current, override_reason: event.target.value }))
          }
          rows={2}
          className="mt-1 w-full border border-border px-2 py-2 text-sm"
          placeholder="Required only when completing out of sequence or closing WINDER without linked reel issues."
        />
      </div>
    )
  }

  function renderWinderSection() {
    const stage = "WINDER" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-foreground">Winder Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Winder" value={entry.winder_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time (A) — from card", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time (B) — from card", "end_time", "datetime-local")}
          {renderCycleTime(stage)}
          {renderToolAssignment(stage)}
          {renderShiftPicker(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left">
              <th className="border border-border px-2 py-2">Meters Produced</th>
              <th className="border border-border px-2 py-2">Accepted Meters</th>
              <th className="border border-border px-2 py-2">Reject Meters</th>
              <th className="border border-border px-2 py-2">Reject Reason Code</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={displayWinderMeters(entry.winding_meters_produced, entry.bamboo_count_produced)} onChange={(next) => updateSnapshotField(stage, "winding_meters_produced", next)} /></td>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={displayWinderMeters(entry.accepted_winding_meters, entry.accepted_bamboo_count)} onChange={(next) => updateSnapshotField(stage, "accepted_winding_meters", next)} /></td>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={displayWinderMeters(entry.reject_winding_meters, entry.reject_bamboo_count)} onChange={(next) => updateSnapshotField(stage, "reject_winding_meters", next)} /></td>
                  <td className="border border-border px-2 py-2"><TextInput value={entry.reject_reason_code} onChange={(next) => updateSnapshotField(stage, "reject_reason_code", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-border px-2 py-2">{displayWinderMeters(entry.winding_meters_produced, entry.bamboo_count_produced)}</td>
                  <td className="border border-border px-2 py-2">{displayWinderMeters(entry.accepted_winding_meters, entry.accepted_bamboo_count)}</td>
                  <td className="border border-border px-2 py-2">{displayWinderMeters(entry.reject_winding_meters, entry.reject_bamboo_count)}</td>
                  <td className="border border-border px-2 py-2">{entry.reject_reason_code || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>
        <div className="mt-2 text-xs font-semibold text-muted-foreground">
          Bamboo equivalent: produced {formatNumber(metersToBamboo(entry.winding_meters_produced, entry.bamboo_count_produced), 2)} · accepted {formatNumber(metersToBamboo(entry.accepted_winding_meters, entry.accepted_bamboo_count), 2)} · reject {formatNumber(metersToBamboo(entry.reject_winding_meters, entry.reject_bamboo_count), 2)}
        </div>

        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dimension Readings (Height, not Length)</div>
        <table className="mt-1 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left">
              <th className="border border-border px-2 py-2">Height</th>
              <th className="border border-border px-2 py-2">I.D.</th>
              <th className="border border-border px-2 py-2">O.D.</th>
              <th className="border border-border px-2 py-2">Weight</th>
              <th className="border border-border px-2 py-2">C.S.</th>
            </tr>
          </thead>
          <tbody>
            {(entry.dimension_readings || []).map((row: any, index: number) => (
              <tr key={`winder-row-${index}`}>
                {stageEditable(stage) ? (
                  <>
                    <td className="border border-border px-2 py-2"><TextInput type="number" value={row.height ?? row.length} onChange={(next) => updateDimensionReading(index, "height", next)} /></td>
                    <td className="border border-border px-2 py-2"><TextInput type="number" value={row.id} onChange={(next) => updateDimensionReading(index, "id", next)} /></td>
                    <td className="border border-border px-2 py-2"><TextInput type="number" value={row.od} onChange={(next) => updateDimensionReading(index, "od", next)} /></td>
                    <td className="border border-border px-2 py-2"><TextInput type="number" value={row.weight} onChange={(next) => updateDimensionReading(index, "weight", next)} /></td>
                    <td className="border border-border px-2 py-2"><TextInput type="number" value={row.cs} onChange={(next) => updateDimensionReading(index, "cs", next)} /></td>
                  </>
                ) : (
                  <>
                    <td className="border border-border px-2 py-2">{row.height || row.length || ""}</td>
                    <td className="border border-border px-2 py-2">{row.id || ""}</td>
                    <td className="border border-border px-2 py-2">{row.od || ""}</td>
                    <td className="border border-border px-2 py-2">{row.weight || ""}</td>
                    <td className="border border-border px-2 py-2">{row.cs || ""}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {renderStageQc("WINDER")}

        {mode === "supervisor" && (
          <div className="mt-3 border border-border px-3 py-2 no-print">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Linked Reel Issues (optional)</div>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {[...availableReelIssues]
                .sort((left: any, right: any) => {
                  const machineId = String(assignment.machineId || "")
                  return Number(String(right.machine_id || "") === machineId) - Number(String(left.machine_id || "") === machineId)
                })
                .map((issue: any) => {
                const checked = (stageForms[stage]?.reel_issue_ids || []).includes(issue.id)
                const onThisWinder = Boolean(assignment.machineId) && String(issue.machine_id || "") === String(assignment.machineId)
                return (
                  <label key={issue.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {issue.reel_code || issue.id.slice(0, 8)} | {issue.machine_id ? machineLabelMap.get(String(issue.machine_id)) || "Winder" : "Winder not recorded"} | Shift {issue.shift} | {formatNumber(issue.issued_weight_kg)}kg
                      {onThisWinder ? <span className="ml-2 rounded-full bg-signal-emerald-soft px-2 text-[10px] font-semibold text-signal-emerald-ink">this winder</span> : null}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        updateStageForm(stage, (current) => ({
                          ...current,
                          reel_issue_ids: event.target.checked
                            ? [...(current.reel_issue_ids || []), issue.id]
                            : (current.reel_issue_ids || []).filter((value: string) => value !== issue.id),
                        }))
                      }
                    />
                  </label>
                )
              })}
              {availableReelIssues.length === 0 && <div className="text-sm text-muted-foreground">No open reel issues.</div>}
            </div>
          </div>
        )}

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderOvenSection() {
    const stage = "OVEN" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-foreground">Oven Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Oven" value={entry.oven_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time (A) — from card", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time (B) — from card", "end_time", "datetime-local")}
          {renderCycleTime(stage)}
          {renderShiftPicker(stage)}
          {renderToolAssignment(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left">
              <th className="border border-border px-2 py-2">Bamboo Count In</th>
              <th className="border border-border px-2 py-2">Bamboo Count Out</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={entry.bamboo_count_in} onChange={(next) => updateSnapshotField(stage, "bamboo_count_in", next)} /></td>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={entry.bamboo_count_out} onChange={(next) => updateSnapshotField(stage, "bamboo_count_out", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-border px-2 py-2">{entry.bamboo_count_in || ""}</td>
                  <td className="border border-border px-2 py-2">{entry.bamboo_count_out || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>
        {renderStageQc("OVEN")}

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderProcessSection() {
    const stage = "PROCESS" as StageName
    const stageData = stageRow(stage)
    const assignment = stageAssignment(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-foreground">Process / Finishing Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Planned Process Line" value={entry.process_line_no || assignment.machineLabel || "Unscheduled"} />
          <LabeledValue label="Planned Shift" value={assignment.shiftLabel || "-"} />
          {renderOperatorPicker(stage, "Operator Name", "operator_name")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Start Time (A) — from card", "start_time", "datetime-local")}
          {renderSimpleField(stage, "End Time (B) — from card", "end_time", "datetime-local")}
          {renderCycleTime(stage)}
          {renderShiftPicker(stage)}
        </div>
        {renderLateEntryWarning(stage)}

        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left">
              <th className="border border-border px-2 py-2">Process Qty</th>
              <th className="border border-border px-2 py-2">Reject Qty</th>
              <th className="border border-border px-2 py-2">Reject Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {stageEditable(stage) ? (
                <>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={entry.process_qty} onChange={(next) => updateSnapshotField(stage, "process_qty", next)} /></td>
                  <td className="border border-border px-2 py-2"><TextInput type="number" value={entry.reject_qty} onChange={(next) => updateSnapshotField(stage, "reject_qty", next)} /></td>
                  <td className="border border-border px-2 py-2"><TextInput value={entry.reject_reason} onChange={(next) => updateSnapshotField(stage, "reject_reason", next)} /></td>
                </>
              ) : (
                <>
                  <td className="border border-border px-2 py-2">{entry.process_qty || ""}</td>
                  <td className="border border-border px-2 py-2">{entry.reject_qty || ""}</td>
                  <td className="border border-border px-2 py-2">{entry.reject_reason || ""}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>

        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Process QC measurements</div>
        {renderStageQc("PROCESS")}

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {renderToolAssignment(stage)}
        </div>

        {renderNotes(stage)}
        {renderAssignmentWarning(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderPackingSection() {
    const stage = "PACKING" as StageName
    const stageData = stageRow(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-foreground">Packing / Dispatch Section</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-px overflow-hidden rounded-xl border border-border bg-slate-300 text-xs md:grid-cols-4">
          <div className="bg-muted px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Box / Qty</p>
            <p className="mt-1 font-semibold text-foreground">{documentSnapshot?.setup_tooling?.box_code || "-"} · {documentSnapshot?.setup_tooling?.qty_per_box || "-"} pcs/box</p>
            <p className="mt-0.5 text-muted-foreground">{documentSnapshot?.setup_tooling?.box_size || "Size pending"}</p>
          </div>
          <div className="bg-card px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Plastic</p>
            <p className="mt-1 font-semibold text-foreground">{documentSnapshot?.setup_tooling?.plastic_sku || "-"} · {documentSnapshot?.setup_tooling?.plastic_per_box || 0} pcs/box</p>
            <p className="mt-0.5 text-muted-foreground">{documentSnapshot?.setup_tooling?.plastic_unit_weight_kg || 0} kg/pc · {documentSnapshot?.setup_tooling?.plastic_weight_per_box_kg || 0} kg/box</p>
          </div>
          <div className="bg-card px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Fadda</p>
            <p className="mt-1 font-semibold text-foreground">{documentSnapshot?.setup_tooling?.fadda_sku || "-"} · {documentSnapshot?.setup_tooling?.fadda_per_box || 0} pcs/box</p>
            <p className="mt-0.5 text-muted-foreground">{documentSnapshot?.setup_tooling?.fadda_unit_weight_kg || 0} kg/pc · {documentSnapshot?.setup_tooling?.fadda_weight_per_box_kg || 0} kg/box</p>
          </div>
          <div className="bg-muted px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">BOPP / Units</p>
            <p className="mt-1 font-semibold text-foreground">BOPP {documentSnapshot?.setup_tooling?.bopp_required || "No"}</p>
            <p className="mt-0.5 text-muted-foreground">Floor consumption: PCS · inward/reconcile: kg</p>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {renderSimpleField(stage, "Packing Type", "packing_type")}
          {renderSimpleField(stage, "Qty per Bundle", "qty_per_bundle", "number")}
          {renderSimpleField(stage, "Total Packed Qty", "total_packed_qty", "number")}
          {renderSimpleField(stage, "FG Item ID", "fg_item_id")}
          {renderSimpleField(stage, "Dispatch Date", "dispatch_date", "date")}
          {renderSimpleField(stage, "Dispatched Qty", "dispatched_qty", "number")}
          {renderSimpleField(stage, "Pending Qty", "pending_qty", "number")}
          {renderSimpleField(stage, "Supervisor Sign", "supervisor_sign")}
        </div>

        {renderNotes(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderQcSection() {
    const stage = "QC" as StageName
    const stageData = stageRow(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-foreground">QC Gate</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {renderOperatorPicker(stage, "Inspector", "inspector_name", "inspector_employee_id")}
          {renderSimpleField(stage, "QC Sign", "qc_sign")}
          {renderSimpleField(stage, "Sample Size", "sample_size", "number")}
          {renderSimpleField(stage, "Accepted Qty", "accepted_qty", "number")}
          {renderSimpleField(stage, "Hold Qty", "hold_qty", "number")}
          {renderSimpleField(stage, "Disposition", "disposition")}
          {renderSimpleField(stage, "Release Ref", "release_reference")}
        </div>

        {renderNotes(stage)}
        {sectionActions(stage)}
      </section>
    )
  }

  function renderDispatchSection() {
    const stage = "DISPATCH" as StageName
    const stageData = stageRow(stage)
    const entry = stageForms[stage]?.entry_snapshot || normalizeStageEntry(stage, {})
    return (
      <section className="border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-foreground">Dispatch Seal</h3>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(stageData?.status || "PLANNED")}`}>
            {stageData?.status || "PLANNED"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <LabeledValue label="Dispatch Request ID" value={entry.dispatch_request_id || ""} />
          <LabeledValue label="Dispatch Line Ref" value={entry.dispatch_line_ref || ""} />
          <LabeledValue label="Dispatch Qty" value={entry.dispatch_qty || stageData?.output_qty || ""} />
          <LabeledValue label="Vehicle No" value={entry.vehicle_no || ""} />
          <LabeledValue label="Dispatch Date" value={entry.dispatch_date || ""} />
          <LabeledValue label="Status" value={stageData?.status || "PLANNED"} />
        </div>

        <div className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Dispatch completion is sealed from the dispatch module so inventory and sales fulfillment stay synchronized.
        </div>
      </section>
    )
  }

  const winderPrintStage = stageRow("WINDER")
  const ovenPrintStage = stageRow("OVEN")
  const processPrintStage = stageRow("PROCESS")
  const packingPrintStage = stageRow("PACKING")
  const qcPrintStage = stageRow("QC")
  const dispatchPrintStage = stageRow("DISPATCH")
  const winderPrintEntry = normalizeStageEntry("WINDER", winderPrintStage?.entry_snapshot)
  const ovenPrintEntry = normalizeStageEntry("OVEN", ovenPrintStage?.entry_snapshot)
  const processPrintEntry = normalizeStageEntry("PROCESS", processPrintStage?.entry_snapshot)
  const packingPrintEntry = normalizeStageEntry("PACKING", packingPrintStage?.entry_snapshot)
  const qcPrintEntry = normalizeStageEntry("QC", qcPrintStage?.entry_snapshot)
  const dispatchPrintEntry = normalizeStageEntry("DISPATCH", dispatchPrintStage?.entry_snapshot)
  const plannedQty = Number(documentSnapshot?.material_truth?.planned_output_qty || card?.planned_qty || 0)
  const dispatchQty = Number(dispatchPrintEntry.dispatch_qty || dispatchPrintStage?.output_qty || packingPrintEntry.dispatched_qty || 0)
  const pendingQty = Number(
    packingPrintEntry.pending_qty ||
      (Number.isFinite(plannedQty - dispatchQty) ? Math.max(plannedQty - dispatchQty, 0) : 0),
  )

  function renderPrintLayout() {
    const customerName = documentSnapshot?.header?.customer_name || card?.sales_order?.customer_name || "-"
    const salesOrderNumber = card?.sales_order_ref || card?.sales_order?.order_no || "-"
    const jobCardNumber = card?.job_card_ref || card?.job_card_no || String(card?.id || "").slice(0, 8)
    const sizeLabel = documentSnapshot?.header?.product_size_label || "-"
    const parchmentColor = documentSnapshot?.header?.color || card?.spec_snapshot?.parchment_color || "-"
    const lotNumber = documentSnapshot?.header?.lot_number || String(card?.id || "").slice(0, 10)
    const winderShiftLabel = String(winderPrintStage?.shift_code || documentSnapshot?.header?.shift || "-").replace("_", " ")
    const ovenShiftLabel = String(ovenPrintStage?.shift_code || documentSnapshot?.header?.shift || "-").replace("_", " ")
    const processShiftLabel = String(processPrintStage?.shift_code || documentSnapshot?.header?.shift || "-").replace("_", " ")
    const winderMachineLabel = winderPrintEntry.winder_no || (winderPrintStage?.machine_id ? machineLabelMap.get(String(winderPrintStage.machine_id)) : "") || "-"
    const ovenMachineLabel = ovenPrintEntry.oven_no || (ovenPrintStage?.machine_id ? machineLabelMap.get(String(ovenPrintStage.machine_id)) : "") || "-"
    const processMachineLabel = processPrintEntry.process_line_no || (processPrintStage?.machine_id ? machineLabelMap.get(String(processPrintStage.machine_id)) : "") || "-"

    return (
      <div className="mx-auto max-w-[1100px] space-y-6 print:max-w-none">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            Factory print layout aligned to the shop-floor AMIGO card and process continuation sheet.
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <Printer className="h-4 w-4" />
            Print Job Card
          </button>
        </div>

        <section className="border-2 border-slate-900 bg-card p-5 print:p-4">
          <div className="border-b-2 border-slate-900 pb-3 text-center">
            <p className="text-2xl font-black uppercase tracking-wide text-foreground">
              {documentSnapshot?.header?.company_name || "Hari Om Paper"}
            </p>
            <p className="mt-1 text-lg font-semibold uppercase tracking-[0.18em] text-muted-foreground">Job Card</p>
          </div>

          <div className="mt-4 grid gap-0 border border-slate-900 text-sm md:grid-cols-4">
            <LabeledValue label="Date" value={documentSnapshot?.header?.date || ""} />
            <LabeledValue label="Sales Order Number" value={salesOrderNumber} />
            <LabeledValue label="Customer Name" value={customerName} />
            <LabeledValue label="Mandrel" value={mandrelLabel} />
            <LabeledValue label="Size" value={sizeLabel} />
            <LabeledValue label="Color" value={parchmentColor} />
            <LabeledValue label="Order Quantity" value={printValue(documentSnapshot?.header?.order_quantity_pcs, 0)} />
            <LabeledValue label="Lot Number" value={lotNumber} />
            <LabeledValue label="Job Card Number" value={jobCardNumber} />
            <LabeledValue label="Parchment Paper" value={parchmentColor || "-"} />
            <LabeledValue label="Pcs / Bamboo" value={printValue(documentSnapshot?.header?.pcs_per_bamboo, 0)} />
            <LabeledValue label="Required C.S" value={printValue(documentSnapshot?.header?.required_cs)} />
          </div>

          <div className="mt-4 border border-slate-900">
            <div className="grid grid-cols-[1.2fr_180px] border-b border-slate-900">
              <div className="px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-foreground">Winding (W1-W4)</div>
              <div className="border-l border-slate-900 px-3 py-2 text-sm font-semibold text-muted-foreground">Shift {winderShiftLabel}</div>
            </div>
            <div className="grid gap-0 text-sm md:grid-cols-4">
              <LabeledValue label="Winder No" value={winderMachineLabel} />
              <LabeledValue label="Operator Name" value={winderPrintEntry.operator_name} />
              <LabeledValue label="Supervisor Sign" value={winderPrintEntry.supervisor_sign} />
              <LabeledValue label="QC Sign" value={winderPrintEntry.qc_sign} />
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="border border-border px-2 py-2">Output Meters</th>
                  <th className="border border-border px-2 py-2">Accepted Meters</th>
                  <th className="border border-border px-2 py-2">Reject Meters</th>
                  <th className="border border-border px-2 py-2">Rejection Code</th>
                  <th className="border border-border px-2 py-2">Start</th>
                  <th className="border border-border px-2 py-2">End</th>
                  <th className="border border-border px-2 py-2">Cycle Time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-2 py-2">{displayWinderMeters(winderPrintEntry.winding_meters_produced, winderPrintEntry.bamboo_count_produced || winderPrintStage?.input_qty)}</td>
                  <td className="border border-border px-2 py-2">{displayWinderMeters(winderPrintEntry.accepted_winding_meters, winderPrintEntry.accepted_bamboo_count || winderPrintStage?.output_qty)}</td>
                  <td className="border border-border px-2 py-2">{displayWinderMeters(winderPrintEntry.reject_winding_meters, winderPrintEntry.reject_bamboo_count || winderPrintStage?.scrap_qty)}</td>
                  <td className="border border-border px-2 py-2">{winderPrintEntry.reject_reason_code || "-"}</td>
                  <td className="border border-border px-2 py-2">{winderPrintEntry.start_time || "-"}</td>
                  <td className="border border-border px-2 py-2">{winderPrintEntry.end_time || "-"}</td>
                  <td className="border border-border px-2 py-2">{winderPrintEntry.cycle_time || "-"}</td>
                </tr>
              </tbody>
            </table>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="border border-border px-2 py-2">Height</th>
                  <th className="border border-border px-2 py-2">I.D</th>
                  <th className="border border-border px-2 py-2">O.D</th>
                  <th className="border border-border px-2 py-2">Weight</th>
                  <th className="border border-border px-2 py-2">C.S</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(winderPrintEntry.dimension_readings) ? winderPrintEntry.dimension_readings : [])
                  .filter((row: any) => Object.values(row || {}).some((value) => value !== null && value !== undefined && String(value).trim() !== ""))
                  .map((row: any, index: number) => (
                  <tr key={`winder-print-${index}`}>
                    <td className="border border-border px-2 py-2">{row.height ?? ""}</td>
                    <td className="border border-border px-2 py-2">{row.id ?? ""}</td>
                    <td className="border border-border px-2 py-2">{row.od ?? ""}</td>
                    <td className="border border-border px-2 py-2">{row.weight ?? ""}</td>
                    <td className="border border-border px-2 py-2">{row.cs ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border border-slate-900">
            <div className="grid grid-cols-[1.2fr_180px] border-b border-slate-900">
              <div className="px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-foreground">Oven Curing (O1-O6)</div>
              <div className="border-l border-slate-900 px-3 py-2 text-sm font-semibold text-muted-foreground">Shift {ovenShiftLabel}</div>
            </div>
            <div className="grid gap-0 text-sm md:grid-cols-4">
              <LabeledValue label="Oven No" value={ovenMachineLabel} />
              <LabeledValue label="Operator Name" value={ovenPrintEntry.operator_name} />
              <LabeledValue label="Supervisor Sign" value={ovenPrintEntry.supervisor_sign} />
              <LabeledValue label="QC Sign" value={ovenPrintEntry.qc_sign} />
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="border border-border px-2 py-2">Winder OK Qty</th>
                  <th className="border border-border px-2 py-2">Output Qty</th>
                  <th className="border border-border px-2 py-2">Reject Qty</th>
                  <th className="border border-border px-2 py-2">Rejection Code</th>
                  <th className="border border-border px-2 py-2">Start</th>
                  <th className="border border-border px-2 py-2">End</th>
                  <th className="border border-border px-2 py-2">Cycle Time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-2 py-2">{ovenPrintEntry.bamboo_count_in || printValue(ovenPrintStage?.input_qty, 0)}</td>
                  <td className="border border-border px-2 py-2">{ovenPrintEntry.bamboo_count_out || printValue(ovenPrintStage?.output_qty, 0)}</td>
                  <td className="border border-border px-2 py-2">{printValue(ovenPrintStage?.scrap_qty, 0)}</td>
                  <td className="border border-border px-2 py-2">{winderPrintEntry.reject_reason_code || "-"}</td>
                  <td className="border border-border px-2 py-2">{ovenPrintEntry.start_time || "-"}</td>
                  <td className="border border-border px-2 py-2">{ovenPrintEntry.end_time || "-"}</td>
                  <td className="border border-border px-2 py-2">{ovenPrintEntry.cycle_time || "-"}</td>
                </tr>
              </tbody>
            </table>
            <div className="grid gap-0 text-sm md:grid-cols-5">
              <LabeledValue label="Sample / pair ID" value={ovenPrintEntry.qc_sample_id || ovenPrintEntry.sample_id} />
              <LabeledValue label="Pre-weight (g)" value={ovenPrintEntry.pre_weight ?? ovenPrintEntry.qc_readings?.pre_weight ?? ""} />
              <LabeledValue label="Post-weight (g)" value={ovenPrintEntry.post_weight ?? ovenPrintEntry.qc_readings?.post_weight ?? ""} />
              <LabeledValue label="Legacy batch pre-weight (kg)" value={ovenPrintEntry.pre_oven_weight_kg ?? ""} />
              <LabeledValue label="Pre-moisture" value={ovenPrintEntry.pre_moisture ?? ovenPrintEntry.qc_readings?.pre_moisture ?? ovenPrintEntry.moisture_before ?? ""} />
              <LabeledValue label="Post-moisture" value={ovenPrintEntry.post_moisture ?? ovenPrintEntry.qc_readings?.post_moisture ?? ovenPrintEntry.moisture_after ?? ""} />
            </div>
          </div>
        </section>

        <section className="border-2 border-slate-900 bg-card p-5 print:p-4">
          <div className="grid grid-cols-[1fr_160px] border-b border-slate-900 pb-3">
            <div className="text-center">
              <p className="text-lg font-bold uppercase tracking-wide text-foreground">Process Line (P1-P11)</p>
            </div>
            <div className="text-right text-sm font-semibold text-muted-foreground">Shift {processShiftLabel}</div>
          </div>

          <div className="mt-3 grid gap-0 text-sm md:grid-cols-4">
            <LabeledValue label="Line No" value={processMachineLabel} />
            <LabeledValue label="Operator Name" value={processPrintEntry.operator_name} />
            <LabeledValue label="Packing Sign" value={packingPrintEntry.supervisor_sign || "-"} />
            <LabeledValue label="QC Sign" value={qcPrintEntry.qc_sign || processPrintEntry.qc_sign || "-"} />
          </div>

          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted text-left">
                <th className="border border-border px-2 py-2">Oven Qty</th>
                <th className="border border-border px-2 py-2">Process Qty</th>
                <th className="border border-border px-2 py-2">Reject Qty</th>
                <th className="border border-border px-2 py-2">Rejection Code</th>
                <th className="border border-border px-2 py-2">Start</th>
                <th className="border border-border px-2 py-2">End</th>
                <th className="border border-border px-2 py-2">Cycle Time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-2 py-2">{printValue(ovenPrintStage?.output_qty, 0)}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.process_qty || printValue(processPrintStage?.output_qty, 0)}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.reject_qty || printValue(processPrintStage?.scrap_qty, 0)}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.reject_reason || "-"}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.start_time || "-"}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.end_time || "-"}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.cycle_time || "-"}</td>
              </tr>
            </tbody>
          </table>

          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted text-left">
                <th className="border border-border px-2 py-2">Height</th>
                <th className="border border-border px-2 py-2">Weight</th>
                <th className="border border-border px-2 py-2">C.S</th>
                <th className="border border-border px-2 py-2">Notch Distance</th>
                <th className="border border-border px-2 py-2">Notch Depth</th>
                <th className="border border-border px-2 py-2">Moisture</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-2 py-2">{processPrintEntry.qc_readings?.height ?? processPrintEntry.final_measurements?.height ?? ""}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.qc_readings?.weight ?? processPrintEntry.final_measurements?.weight ?? ""}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.qc_readings?.cs ?? processPrintEntry.final_measurements?.cs ?? ""}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.qc_readings?.notch_distance ?? processPrintEntry.final_measurements?.notch_distance ?? ""}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.qc_readings?.notch_depth ?? processPrintEntry.final_measurements?.notch_depth ?? ""}</td>
                <td className="border border-border px-2 py-2">{processPrintEntry.qc_readings?.moisture ?? processPrintEntry.final_measurements?.moisture ?? ""}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-4 grid gap-0 text-sm md:grid-cols-4">
            <LabeledValue label="Dispatch Date" value={packingPrintEntry.dispatch_date || dispatchPrintEntry.dispatch_date || "-"} />
            <LabeledValue label="Dispatch Quantity" value={dispatchQty > 0 ? printValue(dispatchQty, 0) : "-" } />
            <LabeledValue label="Pending Quantity" value={pendingQty > 0 ? printValue(pendingQty, 0) : "-" } />
            <LabeledValue label="Supervisor Sign" value={packingPrintEntry.supervisor_sign || "-"} />
          </div>

          <div className="mt-4 border border-dashed border-slate-400 px-3 py-3 text-xs text-muted-foreground">
            Notes: {processPrintStage?.remarks || packingPrintStage?.remarks || qcPrintStage?.remarks || "-"}
          </div>
        </section>

        <style jsx global>{`
          @media print {
            .no-print {
              display: none !important;
            }

            header,
            aside,
            nav {
              display: none !important;
            }

            body {
              background: #fff !important;
            }

            .qc-exception,
            .qc-exception-fail,
            .qc-exception-fail * {
              color: #000 !important;
              background: #fff !important;
              border-color: #000 !important;
            }
          }
        `}</style>
      </div>
    )
  }

  // Two-sided A4 job card, laid out cell-for-cell from the client's
  // "Job Card" workbook: header + Winding + Oven on the front, Process Line +
  // Dispatch + tooling/drawing space on the back. Blank cells are handwriting
  // space; values the ERP already knows (spec targets, entered actuals) print in.
  function renderReleasePrintLayout() {
    const header = documentSnapshot?.header || {}
    const setup = documentSnapshot?.setup_tooling || {}
    const customerName = header.customer_name || card?.sales_order?.customer_name || ""
    const salesOrderNumber = card?.sales_order_ref || header.sales_order_no || card?.sales_order?.order_no || ""
    const jobCardNumber = card?.job_card_ref || header.job_card_number || card?.job_card_no || String(card?.id || "").slice(0, 8)
    const lotNumber = header.lot_number || String(card?.id || "").slice(0, 10)
    const releaseQty = Number(header.release_qty_pcs || card?.released_qty || card?.planned_qty || 0)
    const orderQty = Number(header.order_quantity_pcs || card?.sales_order?.order_qty || releaseQty || 0)
    const requiredCs = header.required_cs ?? clientSpec?.cs?.avg
    const jobDate = header.date || ""
    const plantScopeLabel = displayPlantScope(header.plant_id, "")
    const plantLabel = plantScopeLabel && plantScopeLabel !== header.plant_id ? plantScopeLabel : ""

    const blankDash = (value: any) => (value === "-" ? "" : value)
    const num = (value: any, digits = 2) => blankDash(formatNumber(value, digits))
    const withUnit = (value: any, unit: string, digits = 2) => {
      const text = num(value, digits)
      return text && Number(value) !== 0 ? `${text} ${unit}` : ""
    }
    const range = (spec: any, digits = 2) => {
      const min = num(spec?.min, digits)
      const max = num(spec?.max, digits)
      return min && max ? `${min}–${max}` : ""
    }
    const dateOnly = (value: any) => {
      const parsed = parseStageTime(value, true)
      if (!parsed) return String(value || "").slice(0, 10)
      return `${padTwo(parsed.getDate())}-${padTwo(parsed.getMonth() + 1)}-${parsed.getFullYear()}`
    }
    const cardTime = (value: any) => formatStageTime(value)

    function planFor(stage: StageName) {
      const row = stageRow(stage)
      const segment = stageSegment(stage)
      const releaseWinderId = stage === "WINDER" ? header.assigned_winder_machine_id : ""
      const machineId = row?.machine_id || segment?.machine_id || releaseWinderId || ""
      const shiftCode = row?.shift_code || segment?.shift_code || header.shift || ""
      const planDate = row?.actual_start || row?.plan_date || segment?.plan_date || ""
      return {
        machineLabel: machineId ? machineLabelMap.get(String(machineId)) || String(machineId).slice(0, 8) : "",
        shiftLabel: shiftCode ? String(shiftCode).replace("SHIFT_", "").replace("_", " ") : "",
        date: planDate ? dateOnly(planDate) : "",
      }
    }

    const winderPlan = planFor("WINDER")
    const ovenPlan = planFor("OVEN")
    const processPlan = planFor("PROCESS")
    // Frozen QC bands from the job-card snapshot / signed inspection win over the
    // live client spec, so later profile revisions never relabel a printed card.
    const winderQcRules = inspectionFrozenRules(stageQcInspection("WINDER"), frozenQcProfile(), "WINDER")
    const ovenQcRules = inspectionFrozenRules(stageQcInspection("OVEN"), frozenQcProfile(), "OVEN")
    const processQcRules = inspectionFrozenRules(stageQcInspection("PROCESS"), frozenQcProfile(), "PROCESS")
    const hasFrozenQc = winderQcRules.length + ovenQcRules.length + processQcRules.length > 0
    const allowed = (rules: QcParameterRule[], code: string, fallback = "") => {
      const text = formatAllowedRange(rules.find((row) => row.code === code) || null)
      return text && text !== "-" ? text : fallback
    }
    const W = ({ value, testId }: { value: any; testId?: string }) => {
      const text = value == null || String(value).trim() === "" || String(value) === "-" ? "" : String(value)
      return (
        <div className="qc-print-writable" data-testid={testId} data-blank={text ? "false" : "true"}>
          {text}
        </div>
      )
    }
    const winderReadings = (Array.isArray(winderPrintEntry.dimension_readings) ? winderPrintEntry.dimension_readings : [])
      .filter((row: any) => Object.values(row || {}).some(Boolean))
    const processReading = processPrintEntry.final_measurements || {}
    const hasProcessReading = Object.values(processReading).some(Boolean)
    const ovenQc = ovenPrintEntry.qc_readings || {}
    const ovenReading = {
      pre_weight: ovenPrintEntry.pre_weight || ovenQc.pre_weight || ovenPrintEntry.pre_oven_weight_kg || "",
      post_weight: ovenPrintEntry.post_weight || ovenQc.post_weight || ovenPrintEntry.post_oven_weight_kg || "",
      pre_moisture: ovenPrintEntry.pre_moisture || ovenQc.pre_moisture || ovenPrintEntry.moisture_before || "",
      post_moisture: ovenPrintEntry.post_moisture || ovenQc.post_moisture || ovenPrintEntry.moisture_after || "",
    }
    const ovenReadingEntered = Object.values(ovenReading).some(Boolean)
    // Sealed shipments from the dispatch module; fall back to the packing entry.
    const dispatchHistory: any[] = Array.isArray(card?.dispatch_history) ? card.dispatch_history : []
    const dispatchRows = dispatchHistory.length
      ? dispatchHistory
      : dispatchQty > 0
        ? [{ dispatch_date: packingPrintEntry.dispatch_date || dispatchPrintEntry.dispatch_date || "", dispatch_qty: dispatchQty, pending_qty: pendingQty }]
        : []
    const dispatchDate = dispatchRows[0]?.dispatch_date || packingPrintEntry.dispatch_date || dispatchPrintEntry.dispatch_date || ""
    const leadTimeDays = (() => {
      const start = parseStageTime(jobDate)
      const end = parseStageTime(dispatchDate)
      if (!start || !end || end < start) return ""
      return `${Math.round((end.getTime() - start.getTime()) / 86400000)} days`
    })()
    const toolingLine = [
      ["Mandrel", mandrelLabel],
      ["Notch", setup.notch_type],
      ["Blade", setup.blade],
      ["Holder", setup.notching_holder || setup.holder],
      ["Punch", setup.punch],
      ["V/Flat", setup.v_flat],
      ["Direction", setup.notch_direction || setup.tube_direction],
      ["Box", [setup.box_code || setup.box, setup.qty_per_box ? `${setup.qty_per_box}/box` : ""].filter(Boolean).join(" · ")],
    ].filter(([, value]) => value && value !== "-")

    const L = ({ en, hi }: { en: string; hi?: string }) => (
      <>
        <span className="jc-en">{en}</span>
        {hi ? <span className="jc-hi">{hi}</span> : null}
      </>
    )
    const Req = ({ value, hint }: { value: any; hint?: string }) => (
      <>
        <span className="jc-req-tag">REQ</span>
        <span className="jc-req-value">{value || ""}</span>
        {hint ? <span className="jc-req-hint">{hint}</span> : null}
      </>
    )
    const Cols = () => (
      <colgroup>
        {[12, 12, 12, 12.5, 12, 12, 12, 15.5].map((width, index) => (
          <col key={index} style={{ width: `${width}%` }} />
        ))}
      </colgroup>
    )
    const SectionBand = ({ dateLabel, dateHi, dateValue, title, titleHi, shiftLabel, shiftHi, shiftValue }: any) => (
      <tr className="jc-row-band">
        <td className="jc-label"><L en={dateLabel} hi={dateHi} /></td>
        <td className="jc-value">{dateValue}</td>
        <td className="jc-band" colSpan={4}>
          {title} <span className="jc-band-hi">{titleHi}</span>
        </td>
        <td className="jc-label"><L en={shiftLabel} hi={shiftHi} /></td>
        <td className="jc-value">{shiftValue}</td>
      </tr>
    )
    const PeopleRows = ({ labels, values }: { labels: [string, string][]; values: any[] }) => (
      <>
        <tr className="jc-row-label">
          {labels.map(([en, hi]) => (
            <td key={en} className="jc-label" colSpan={2}><L en={en} hi={hi} /></td>
          ))}
        </tr>
        <tr className="jc-row-sign">
          {values.map((value, index) => (
            <td key={index} className="jc-value" colSpan={2}>{value || ""}</td>
          ))}
        </tr>
      </>
    )
    const qtyHeads = (first: [string, string], second: [string, string]) => (
      <tr className="jc-row-label">
        <td className="jc-label"><L en={first[0]} hi={first[1]} /></td>
        <td className="jc-label"><L en={second[0]} hi={second[1]} /></td>
        <td className="jc-label"><L en="Reject Qty" hi="रिजेक्ट क्वांटिटी" /></td>
        <td className="jc-label"><L en="Rejection Code" hi="रिजेक्शन कोड" /></td>
        <td className="jc-label"><L en="Start Time (A)" hi="स्टार्ट टाइम" /></td>
        <td className="jc-label"><L en="End Time (B)" hi="एंड टाइम" /></td>
        <td className="jc-label" colSpan={2}><L en="Cycle Time (B-A)" hi="साइकिल टाइम" /></td>
      </tr>
    )
    const cycleOf = (entry: any) => cycleTimeFromCard(entry.start_time, entry.end_time) || entry.cycle_time || ""

    const headerFields: [string, string, any][] = [
      ["Date", "तारीख", jobDate ? dateOnly(jobDate) : ""],
      ["Customer Name", "कस्टमर का नाम", customerName],
      ["Mandrel", "मैंड्रिल", blankDash(mandrelLabel)],
      ["Lot Number", "लॉट नंबर", lotNumber],
      ["Weight / Pc", "वजन / पीस", withUnit(tubeDryWeightG || clientSpec?.tube_weight?.avg, "g")],
      ["Color", "रंग", blankDash(header.color || card?.spec_snapshot?.parchment_color || "")],
      [
        "Order Quantity",
        "ऑर्डर क्वांटिटी",
        releaseQty
          ? `${num(releaseQty, 0)} pcs${orderQty && orderQty !== releaseQty ? `  (SO ${num(orderQty, 0)})` : ""}`
          : "",
      ],
      ["Size", "साइज़", blankDash(header.product_size_label || "")],
      ["Parchment Paper", "पार्चमेंट पेपर", blankDash(header.parchment_paper || parchmentFamily || "")],
      ["Pcs / Bamboo", "पीस / बैम्बू", num(pcsPerBamboo, 0)],
      ["Required C.S", "आवश्यक C.S", num(requiredCs)],
      ["Denier", "डेनियर", ""],
    ]

    return (
      <div className="jc-root">
        <div className="no-print jc-toolbar">
          <div>
            Client job-card format · A4 front &amp; back. Print with <strong>Two-sided (flip on long edge)</strong>, scale 100%, margins default.
          </div>
          <button type="button" onClick={() => window.print()} className="jc-print-btn">
            <Printer className="h-4 w-4" />
            Print Job Card
          </button>
        </div>

        {/* ---------------- FRONT ---------------- */}
        <section className="jc-page jc-front" data-testid="print-page-winding">
          <table className="jc-grid jc-title">
            <Cols />
            <tbody>
              <tr className="jc-row-title">
                <td colSpan={2} className="jc-brand">
                  <div className="jc-company">{header.company_name || "Hari Om Paper"}</div>
                  {plantLabel ? <div className="jc-brand-sub">{plantLabel}</div> : null}
                </td>
                <td colSpan={5} className="jc-heading">
                  <div className="jc-heading-title">Job Card <span className="jc-hi">जॉब कार्ड</span></div>
                  <div className="jc-heading-refs">
                    <span>JC No. <strong>{jobCardNumber}</strong></span>
                    {salesOrderNumber ? <span>SO <strong>{salesOrderNumber}</strong></span> : null}
                  </div>
                </td>
                <td className="jc-qr">
                  <QRCodeSVG value={qrValue} size={72} />
                </td>
              </tr>
            </tbody>
          </table>

          <table className="jc-grid jc-gap">
            <Cols />
            <tbody>
              {[0, 4, 8].map((start) => (
                <Fragment key={start}>
                  <tr className="jc-row-label">
                    {headerFields.slice(start, start + 4).map(([en, hi]) => (
                      <td key={en} className="jc-label" colSpan={2}><L en={en} hi={hi} /></td>
                    ))}
                  </tr>
                  <tr className="jc-row-head-value">
                    {headerFields.slice(start, start + 4).map(([en, , value]) => (
                      <td key={en} className="jc-value jc-value-strong" colSpan={2}>{value || ""}</td>
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>

          {/* Winding */}
          <table className="jc-grid jc-gap">
            <Cols />
            <tbody>
              <SectionBand
                dateLabel="Date" dateHi="तारीख" dateValue={winderPlan.date}
                title="Winding" titleHi="वाइंडिंग"
                shiftLabel="Shift" shiftHi="शिफ्ट" shiftValue={winderPlan.shiftLabel}
              />
              <PeopleRows
                labels={[["Winder No", "वाइंडर नंबर"], ["Operator Name", "ऑपरेटर नेम"], ["Supervisor Sign", "सुपरवाइजर साइन"], ["QC Sign", "क्यूसी साइन"]]}
                values={[winderPrintEntry.winder_no || winderPlan.machineLabel, winderPrintEntry.operator_name, winderPrintEntry.supervisor_sign, winderPrintEntry.qc_sign]}
              />
              {qtyHeads(["Output Qty (m)", "आउटपुट क्वांटिटी"], ["Accepted Qty (m)", "स्वीकृत क्वांटिटी"])}
              <tr className="jc-row-entry">
                <td className="jc-value" rowSpan={3}>{displayWinderMeters(winderPrintEntry.winding_meters_produced, winderPrintEntry.bamboo_count_produced)}</td>
                <td className="jc-value" rowSpan={3}>{displayWinderMeters(winderPrintEntry.accepted_winding_meters, winderPrintEntry.accepted_bamboo_count)}</td>
                <td className="jc-value">{displayWinderMeters(winderPrintEntry.reject_winding_meters, winderPrintEntry.reject_bamboo_count)}</td>
                <td className="jc-value">{winderPrintEntry.reject_reason_code || winderPrintEntry.rejection_code || ""}</td>
                <td className="jc-value" rowSpan={3}>{cardTime(winderPrintEntry.start_time)}</td>
                <td className="jc-value" rowSpan={3}>{cardTime(winderPrintEntry.end_time)}</td>
                <td className="jc-value" rowSpan={3} colSpan={2}>{cycleOf(winderPrintEntry)}</td>
              </tr>
              <tr className="jc-row-entry"><td className="jc-value" /><td className="jc-value" /></tr>
              <tr className="jc-row-entry"><td className="jc-value" /><td className="jc-value" /></tr>
              <tr className="jc-row-label">
                <td className="jc-label" colSpan={2}><L en="Length" hi="लंबाई" /></td>
                <td className="jc-label"><L en="Weight" hi="वज़न" /></td>
                <td className="jc-label"><L en="OD" hi="ओ.डी." /></td>
                <td className="jc-label" colSpan={2}><L en="ID" hi="आई.डी." /></td>
                <td className="jc-label"><L en="C.S" hi="सी.एस." /></td>
                <td className="jc-label"><L en="Pasting" hi="पेस्टिंग" /></td>
              </tr>
              <tr className="jc-row-req" data-testid="print-winder-allowed-row">
                <td className="jc-value" colSpan={2}><Req value={withUnit(header.selected_bamboo_length_mm || selectedBambooLength, "mm", 0)} hint={allowed(winderQcRules, "height", "bamboo")} /></td>
                <td className="jc-value"><Req value={withUnit(bambooWetWeightG, "g")} hint={allowed(winderQcRules, "weight", "wet")} /></td>
                <td className="jc-value"><Req value={num(clientSpec?.od?.avg)} hint={allowed(winderQcRules, "od", range(clientSpec?.od))} /></td>
                <td className="jc-value" colSpan={2}><Req value={num(clientSpec?.id?.avg)} hint={allowed(winderQcRules, "id", range(clientSpec?.id))} /></td>
                <td className="jc-value"><Req value={num(manufacturingSpec?.winder_pre_dry_cs)} hint={allowed(winderQcRules, "cs", "pre-dry")} /></td>
                <td className="jc-value"><Req value="" /></td>
              </tr>
              {Array.from({ length: 4 }, (_, index) => {
                const reading = winderReadings[index] || {}
                return (
                  <tr key={`winder-sample-${index}`} className="jc-row-sample" data-testid="print-winder-sample">
                    <td className="jc-value" colSpan={2}><W value={reading.height || reading.length} testId={`winder-height-${index}`} /></td>
                    <td className="jc-value"><W value={reading.weight} testId={`winder-weight-${index}`} /></td>
                    <td className="jc-value"><W value={reading.od} testId={`winder-od-${index}`} /></td>
                    <td className="jc-value" colSpan={2}><W value={reading.id} testId={`winder-id-${index}`} /></td>
                    <td className="jc-value"><W value={reading.cs} testId={`winder-cs-${index}`} /></td>
                    <td className="jc-value"><W value={reading.pasting} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Oven */}
          <table className="jc-grid jc-gap" data-testid="print-oven-pair-table">
            <Cols />
            <tbody>
              <SectionBand
                dateLabel="Date" dateHi="तारीख" dateValue={ovenPlan.date}
                title="Oven" titleHi="ओवन"
                shiftLabel="Shift" shiftHi="शिफ्ट" shiftValue={ovenPlan.shiftLabel}
              />
              <PeopleRows
                labels={[["Oven No", "ओवन नंबर"], ["Operator Name", "ऑपरेटर नेम"], ["Supervisor Sign", "सुपरवाइजर साइन"], ["QC Sign", "क्यूसी साइन"]]}
                values={[ovenPrintEntry.oven_no || ovenPlan.machineLabel, ovenPrintEntry.operator_name, ovenPrintEntry.supervisor_sign, ovenPrintEntry.qc_sign]}
              />
              {qtyHeads(["Winder Qty", "वाइंडर क्वांटिटी"], ["Oven Output Qty", "आउटपुट क्वांटिटी"])}
              {Array.from({ length: 3 }, (_, index) => {
                const first = index === 0 && ovenPrintStage?.status === "COMPLETED"
                return (
                  <tr key={`oven-row-${index}`} className="jc-row-entry">
                    <td className="jc-value">{first ? ovenPrintEntry.bamboo_count_in || num(ovenPrintStage?.input_qty, 0) : ""}</td>
                    <td className="jc-value">{first ? ovenPrintEntry.bamboo_count_out || num(ovenPrintStage?.output_qty, 0) : ""}</td>
                    <td className="jc-value">{first ? num(ovenPrintStage?.scrap_qty, 0) : ""}</td>
                    <td className="jc-value">{index === 0 ? ovenPrintEntry.rejection_code || ovenPrintEntry.reject_reason_code || "" : ""}</td>
                    <td className="jc-value">{index === 0 ? cardTime(ovenPrintEntry.start_time) : ""}</td>
                    <td className="jc-value">{index === 0 ? cardTime(ovenPrintEntry.end_time) : ""}</td>
                    <td className="jc-value" colSpan={2}>{index === 0 ? cycleOf(ovenPrintEntry) : ""}</td>
                  </tr>
                )
              })}
              <tr className="jc-row-label">
                <td className="jc-label" colSpan={2}><L en="Pre-Weight" hi="वज़न" /></td>
                <td className="jc-label" colSpan={2}><L en="Post Weight" hi="वज़न" /></td>
                <td className="jc-label" colSpan={2}><L en="Pre-Moisture" hi="नमी" /></td>
                <td className="jc-label" colSpan={2}><L en="Post Moisture" hi="नमी" /></td>
              </tr>
              <tr className="jc-row-req" data-testid="print-oven-allowed-row">
                <td className="jc-value" colSpan={2}><Req value={withUnit(bambooWetWeightG, "g")} hint={allowed(ovenQcRules, "pre_weight", "wet / bamboo")} /></td>
                <td className="jc-value" colSpan={2}><Req value={withUnit(bambooDryWeightG, "g")} hint={allowed(ovenQcRules, "post_weight", "dry / bamboo")} /></td>
                <td className="jc-value" colSpan={2}><Req value="" hint={allowed(ovenQcRules, "pre_moisture")} /></td>
                <td className="jc-value" colSpan={2}><Req value={range(clientSpec?.moisture, 1) ? `${range(clientSpec?.moisture, 1)} %` : num(clientSpec?.moisture?.avg, 1)} hint={allowed(ovenQcRules, "post_moisture")} /></td>
              </tr>
              {Array.from({ length: 3 }, (_, index) => {
                const first = index === 0 && ovenReadingEntered
                return (
                  <tr key={`oven-sample-${index}`} className="jc-row-sample" data-testid={index === 0 ? "print-oven-pair" : undefined}>
                    <td className="jc-value" colSpan={2}><W value={first ? ovenReading.pre_weight : ""} testId={index === 0 ? "oven-pre-weight" : undefined} /></td>
                    <td className="jc-value" colSpan={2}><W value={first ? ovenReading.post_weight : ""} testId={index === 0 ? "oven-post-weight" : undefined} /></td>
                    <td className="jc-value" colSpan={2}><W value={first ? ovenReading.pre_moisture : ""} testId={index === 0 ? "oven-pre-moisture" : undefined} /></td>
                    <td className="jc-value" colSpan={2}><W value={first ? ovenReading.post_moisture : ""} testId={index === 0 ? "oven-post-moisture" : undefined} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {/* ---------------- BACK ---------------- */}
        <section className="jc-page jc-back" data-testid="print-page-process">
          <table className="jc-grid">
            <Cols />
            <tbody>
              <tr className="jc-row-ident">
                <td className="jc-label"><L en="JC No." /></td>
                <td className="jc-value jc-value-strong">{jobCardNumber}</td>
                <td className="jc-label"><L en="Lot No." hi="लॉट नंबर" /></td>
                <td className="jc-value jc-value-strong">{lotNumber}</td>
                <td className="jc-label"><L en="Customer" hi="कस्टमर" /></td>
                <td className="jc-value jc-value-strong" colSpan={2}>{customerName}</td>
                <td className="jc-value jc-value-strong">{blankDash(header.product_size_label || "")}</td>
              </tr>
            </tbody>
          </table>

          {/* Process line */}
          <table className="jc-grid jc-gap">
            <Cols />
            <tbody>
              <SectionBand
                dateLabel="Date" dateHi="तारीख" dateValue={processPlan.date}
                title="Process Line" titleHi="प्रोसेस लाइन"
                shiftLabel="Shift" shiftHi="शिफ्ट" shiftValue={processPlan.shiftLabel}
              />
              <PeopleRows
                labels={[["Line No", "लाइन नंबर"], ["Operator Name", "ऑपरेटर नेम"], ["Packing Sign", "पैकिंग साइन"], ["QC Sign", "क्यूसी साइन"]]}
                values={[processPrintEntry.process_line_no || processPlan.machineLabel, processPrintEntry.operator_name, packingPrintEntry.supervisor_sign, qcPrintEntry.qc_sign || processPrintEntry.qc_sign]}
              />
              {qtyHeads(["Oven Qty", "ओवन क्वांटिटी"], ["Process OK Qty", "प्रोसेस क्वांटिटी"])}
              {Array.from({ length: 2 }, (_, index) => {
                const first = index === 0 && processPrintStage?.status === "COMPLETED"
                return (
                  <tr key={`process-row-${index}`} className="jc-row-entry jc-row-entry-tall">
                    <td className="jc-value">{first ? num(ovenPrintStage?.output_qty, 0) : ""}</td>
                    <td className="jc-value">{first ? processPrintEntry.process_qty || num(processPrintStage?.output_qty, 0) : ""}</td>
                    <td className="jc-value">{first ? processPrintEntry.reject_qty || num(processPrintStage?.scrap_qty, 0) : ""}</td>
                    <td className="jc-value">{index === 0 ? processPrintEntry.reject_reason || "" : ""}</td>
                    <td className="jc-value">{index === 0 ? cardTime(processPrintEntry.start_time) : ""}</td>
                    <td className="jc-value">{index === 0 ? cardTime(processPrintEntry.end_time) : ""}</td>
                    <td className="jc-value" colSpan={2}>{index === 0 ? cycleOf(processPrintEntry) : ""}</td>
                  </tr>
                )
              })}
              <tr className="jc-row-label">
                <td className="jc-label"><L en="Length" hi="लंबाई" /></td>
                <td className="jc-label"><L en="I.D" hi="आई.डी." /></td>
                <td className="jc-label"><L en="O.D" hi="ओ.डी." /></td>
                <td className="jc-label"><L en="Weight" hi="वज़न" /></td>
                <td className="jc-label"><L en="Moisture" hi="नमी" /></td>
                <td className="jc-label"><L en="C.S" hi="सी.एस." /></td>
                <td className="jc-label"><L en="Notch Distance" hi="नॉच डिस्टेंस" /></td>
                <td className="jc-label"><L en="Notch Depth" hi="नॉच गहराई" /></td>
              </tr>
              <tr className="jc-row-req" data-testid="print-process-allowed-row">
                <td className="jc-value"><Req value={num(clientSpec?.length?.avg ?? header.tube_length_mm)} hint={allowed(processQcRules, "height", range(clientSpec?.length))} /></td>
                <td className="jc-value"><Req value={num(clientSpec?.id?.avg)} hint={allowed(processQcRules, "id", range(clientSpec?.id))} /></td>
                <td className="jc-value"><Req value={num(clientSpec?.od?.avg)} hint={allowed(processQcRules, "od", range(clientSpec?.od))} /></td>
                <td className="jc-value"><Req value={withUnit(tubeDryWeightG || clientSpec?.tube_weight?.avg, "g")} hint={allowed(processQcRules, "weight", range(clientSpec?.tube_weight))} /></td>
                <td className="jc-value"><Req value={range(clientSpec?.moisture, 1) ? `${range(clientSpec?.moisture, 1)} %` : num(clientSpec?.moisture?.avg, 1)} hint={allowed(processQcRules, "moisture")} /></td>
                <td className="jc-value"><Req value={num(requiredCs)} hint={allowed(processQcRules, "cs", range(clientSpec?.cs))} /></td>
                <td className="jc-value"><Req value={setup.notch_distance || ""} hint={allowed(processQcRules, "notch_distance")} /></td>
                <td className="jc-value"><Req value={setup.notch_depth || ""} hint={allowed(processQcRules, "notch_depth")} /></td>
              </tr>
              {Array.from({ length: 3 }, (_, index) => {
                const reading = index === 0 && hasProcessReading ? processReading : {}
                return (
                  <tr key={`process-sample-${index}`} className="jc-row-sample" data-testid="print-process-sample">
                    <td className="jc-value"><W value={reading.height || reading.length} testId={`process-height-${index}`} /></td>
                    <td className="jc-value"><W value={reading.id} /></td>
                    <td className="jc-value"><W value={reading.od} /></td>
                    <td className="jc-value"><W value={reading.weight} testId={`process-weight-${index}`} /></td>
                    <td className="jc-value"><W value={reading.moisture} testId={`process-moisture-${index}`} /></td>
                    <td className="jc-value"><W value={reading.cs} testId={`process-cs-${index}`} /></td>
                    <td className="jc-value"><W value={reading.notch_distance} /></td>
                    <td className="jc-value"><W value={reading.notch_depth} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Dispatch */}
          <table className="jc-grid jc-gap">
            <Cols />
            <tbody>
              <SectionBand
                dateLabel="Dispatch Date" dateHi="डिस्पैच तारीख" dateValue={dispatchDate ? dateOnly(dispatchDate) : ""}
                title="Dispatch" titleHi="डिस्पैच"
                shiftLabel="Lead Time" shiftHi="लीड टाइम" shiftValue={leadTimeDays}
              />
              <tr className="jc-row-label">
                <td className="jc-label" colSpan={2}><L en="Dispatch Date" hi="डिस्पैच तारीख" /></td>
                <td className="jc-label" colSpan={2}><L en="Dispatch Quantity" hi="डिस्पैच क्वांटिटी" /></td>
                <td className="jc-label" colSpan={2}><L en="Pending Quantity" hi="पेंडिंग क्वांटिटी" /></td>
                <td className="jc-label" colSpan={2}><L en="Supervisor Sign" hi="सुपरवाइजर साइन" /></td>
              </tr>
              {Array.from({ length: Math.max(2, Math.min(dispatchRows.length, 4)) }, (_, index) => {
                const shipment = dispatchRows[index]
                return (
                  <tr key={`dispatch-row-${index}`} className="jc-row-entry jc-row-entry-tall">
                    <td className="jc-value" colSpan={2}>{shipment?.dispatch_date ? dateOnly(shipment.dispatch_date) : ""}</td>
                    <td className="jc-value" colSpan={2}>{shipment ? num(shipment.dispatch_qty, 0) : ""}</td>
                    <td className="jc-value" colSpan={2}>{shipment ? num(shipment.pending_qty, 0) : ""}</td>
                    <td className="jc-value" colSpan={2}>{shipment && !dispatchHistory.length ? packingPrintEntry.supervisor_sign || "" : ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Combination / tooling / drawing space */}
          <div className="jc-drawing">
            <div className="jc-drawing-title">
              <L en="Space for the combination, tooling, drawing etc." hi="कॉम्बिनेशन, टूलिंग, ड्रॉइंग आदि के लिए स्थान" />
            </div>
            {toolingLine.length ? (
              <div className="jc-drawing-tooling">
                {toolingLine.map(([label, value]) => (
                  <span key={String(label)}>
                    {label}: <strong>{String(value)}</strong>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="jc-footnote">
            Write Start (A) / End (B) with date and clock time as they happen — the ERP keeps the card time and logs the entry time separately for reconciliation.
            <span className="jc-hi"> स्टार्ट / एंड टाइम घड़ी के अनुसार तारीख सहित लिखें।</span>
          </div>
        </section>

        {/* ---------------- QC SHEET (only when the card froze a QC profile) ---------------- */}
        {hasFrozenQc ? (
          <section className="jc-page jc-qc-sheet" data-testid="print-page-oven">
            <table className="jc-grid">
              <Cols />
              <tbody>
                <tr className="jc-row-ident">
                  <td className="jc-label"><L en="JC No." /></td>
                  <td className="jc-value jc-value-strong">{jobCardNumber}</td>
                  <td className="jc-band" colSpan={4}>
                    Stage QC <span className="jc-band-hi">क्यूसी</span>
                  </td>
                  <td className="jc-label"><L en="Lot No." hi="लॉट नंबर" /></td>
                  <td className="jc-value jc-value-strong">{lotNumber}</td>
                </tr>
              </tbody>
            </table>
            {renderStageQc("WINDER", { print: true })}
            {renderStageQc("OVEN", { print: true })}
            {renderStageQc("PROCESS", { print: true })}
          </section>
        ) : null}

        <style jsx global>{`
          .jc-root {
            --jc-ink: #0f172a;
            --jc-muted: #475569;
            --jc-shade: #eef2f6;
            --jc-band: #1e293b;
            color: var(--jc-ink);
            width: min(100%, 210mm);
            margin: 0 auto;
            font-family: Arial, "Helvetica Neue", "Nirmala UI", "Mangal", "Noto Sans Devanagari", sans-serif;
          }
          .jc-toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 12px;
            font-size: 13px;
            color: #475569;
          }
          .jc-print-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            border-radius: 12px;
            background: #0f172a;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 600;
            color: #fff;
          }
          .jc-page {
            box-sizing: border-box;
            width: 100%;
            min-height: 287mm;
            height: auto;
            overflow: visible;
            display: flex;
            flex-direction: column;
            background: #fff;
            padding: 4mm;
            box-shadow: 0 26px 80px rgba(15, 23, 42, 0.14);
          }
          .jc-page + .jc-page {
            margin-top: 14px;
          }
          .jc-grid {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
          }
          .jc-gap {
            margin-top: 2.2mm;
          }
          .jc-grid td {
            border: 0.8pt solid var(--jc-ink);
            padding: 0.6mm 1.2mm;
            vertical-align: top;
            overflow: hidden;
            font-size: 8.5pt;
            line-height: 1.15;
          }
          .jc-label {
            background: var(--jc-shade);
          }
          .jc-en {
            display: block;
            font-size: 7.4pt;
            font-weight: 700;
            color: var(--jc-ink);
          }
          .jc-hi {
            display: block;
            font-size: 7pt;
            font-weight: 500;
            color: var(--jc-muted);
          }
          .jc-heading-title .jc-hi,
          .jc-footnote .jc-hi {
            display: inline;
          }
          .jc-value {
            font-size: 9pt;
            font-weight: 600;
            vertical-align: middle !important;
          }
          .jc-value-strong {
            font-size: 9.5pt;
            font-weight: 800;
          }
          .jc-band {
            background: var(--jc-band);
            color: #fff;
            text-align: center;
            vertical-align: middle !important;
            font-size: 11pt !important;
            font-weight: 900;
            letter-spacing: 0.22em;
            text-transform: uppercase;
          }
          .jc-band-hi {
            font-size: 9pt;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: none;
            opacity: 0.85;
          }
          .jc-req-tag {
            display: inline-block;
            margin-right: 1.2mm;
            border: 0.6pt solid var(--jc-muted);
            border-radius: 1mm;
            padding: 0 0.8mm;
            font-size: 5.6pt;
            font-weight: 800;
            letter-spacing: 0.06em;
            color: var(--jc-muted);
            vertical-align: middle;
          }
          .jc-req-value {
            font-weight: 800;
          }
          .jc-req-hint {
            display: block;
            font-size: 6.4pt;
            font-weight: 500;
            color: var(--jc-muted);
          }
          .jc-row-title td { height: 21mm; vertical-align: middle; }
          .jc-row-label td { height: 7.2mm; }
          .jc-row-head-value td { height: 9mm; }
          .jc-row-band td { height: 8mm; }
          .jc-row-sign td { height: 9mm; }
          .jc-row-entry td { height: 8.2mm; }
          .jc-row-entry-tall td { height: 10mm; }
          .jc-row-req td { height: 8.4mm; }
          .jc-row-sample td { height: 7.6mm; }
          .jc-row-ident td { height: 8mm; vertical-align: middle; }
          .jc-brand {
            vertical-align: middle !important;
          }
          .jc-company {
            font-size: 12.5pt;
            font-weight: 900;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          .jc-brand-sub {
            margin-top: 1mm;
            font-size: 7.5pt;
            color: var(--jc-muted);
          }
          .jc-heading {
            text-align: center;
            vertical-align: middle !important;
          }
          .jc-heading-title {
            font-size: 20pt;
            font-weight: 900;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }
          .jc-heading-title .jc-hi {
            margin-left: 2mm;
            font-size: 12pt;
            letter-spacing: 0;
            text-transform: none;
          }
          .jc-heading-refs {
            display: flex;
            justify-content: center;
            gap: 6mm;
            margin-top: 1.2mm;
            font-size: 8.5pt;
            color: var(--jc-muted);
          }
          .jc-heading-refs strong {
            color: var(--jc-ink);
          }
          .jc-qr {
            text-align: center;
            vertical-align: middle !important;
          }
          .jc-qr svg {
            width: 19mm;
            height: 19mm;
          }
          .jc-drawing {
            flex: 1 1 auto;
            min-height: 60mm;
            margin-top: 2.2mm;
            border: 0.8pt solid var(--jc-ink);
            padding: 1.2mm 1.6mm;
            display: flex;
            flex-direction: column;
          }
          .jc-drawing-title .jc-en,
          .jc-drawing-title .jc-hi {
            display: inline;
            margin-right: 2mm;
          }
          .jc-drawing-tooling {
            display: flex;
            flex-wrap: wrap;
            gap: 1mm 4mm;
            margin-top: 1mm;
            padding-bottom: 1mm;
            border-bottom: 0.6pt dashed var(--jc-muted);
            font-size: 7.6pt;
            color: var(--jc-muted);
          }
          .jc-drawing-tooling strong {
            color: var(--jc-ink);
          }
          .qc-print-writable {
            min-height: 5.6mm;
          }
          .jc-qc-sheet .qc-print-writable {
            min-height: 9mm;
          }
          .jc-footnote {
            margin-top: 1.4mm;
            font-size: 6.8pt;
            color: var(--jc-muted);
          }

          @media print {
            @page {
              size: A4 portrait;
              margin: 5mm;
            }
            html,
            body {
              background: #fff !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .no-print,
            header,
            aside,
            nav {
              display: none !important;
            }
            /* Strip the dashboard shell (sidebar offset, padding, mesh) so the
               card sits flush inside the A4 print margins. */
            .bg-dashboard-mesh {
              background: #fff !important;
            }
            .bg-dashboard-mesh > div,
            .bg-dashboard-mesh main {
              padding: 0 !important;
              margin: 0 !important;
              max-width: none !important;
            }
            .jc-root {
              width: 200mm;
              max-width: none !important;
            }
            .jc-page {
              width: 200mm;
              min-height: 287mm;
              height: auto;
              max-height: none;
              overflow: visible;
              padding: 0;
              box-shadow: none !important;
              break-inside: auto;
              page-break-inside: auto;
            }
            .jc-page + .jc-page {
              margin-top: 0;
            }
            /* Print drops the screen padding; give the space to handwriting rows. */
            .jc-row-entry td { height: 8.8mm; }
            .jc-row-sample td { height: 8.2mm; }
            .jc-row-sign td { height: 9.6mm; }
            .jc-front,
            .jc-back {
              break-after: page !important;
              page-break-after: always !important;
            }
            .jc-root > .jc-page:last-of-type {
              break-after: auto !important;
              page-break-after: auto !important;
            }
          }
        `}</style>
      </div>
    )
  }

  if (!jobCardId) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
        Select a job card to load the document.
      </div>
    )
  }

  if (jobCardQuery.isLoading) {
    return <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Loading job card...</div>
  }

  if (jobCardQuery.isError || !card) {
    return <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-8 text-sm text-signal-rose-ink">Unable to load job card.</div>
  }

  if (mode === "print") {
    return renderReleasePrintLayout()
  }

  if (mode === "view" || mode === "supervisor") {
    return renderCompactExecutionLayout()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 print:max-w-none">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Snapshot Mode: <span className="font-semibold text-foreground">{card.snapshot_mode}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === "view" && (
            <>
              <Link
                href={`/production/job-cards/${jobCardId}/print`}
                className="inline-flex items-center gap-2 border border-slate-900 px-4 py-2 text-sm font-semibold text-foreground"
              >
                <Printer className="h-4 w-4" />
                Print
              </Link>
              <Link
                href={`/production/supervisor-entry?job_card_id=${jobCardId}`}
                className="inline-flex items-center gap-2 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Open Supervisor Entry
              </Link>
            </>
          )}
        </div>
      </div>

      <section className="border-2 border-slate-900 bg-card p-4 print:p-3">
        <div className="grid gap-4 border-b border-slate-400 pb-4 md:grid-cols-[1.3fr_220px]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              {documentSnapshot?.header?.company_name || "Hari Om Paper"}
            </div>
            <h1 className="mt-2 text-3xl font-bold uppercase tracking-wide text-foreground">Job Card</h1>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <LabeledValue label="Date" value={documentSnapshot?.header?.date || ""} />
              <LabeledValue label="Shift" value={documentSnapshot?.header?.shift || ""} />
              <LabeledValue label="Plant" value={displayPlantScope(documentSnapshot?.header?.plant_id, "")} />
            </div>
          </div>
          <div className="justify-self-end border border-border p-3 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">QR Lookup</div>
            <div className="mt-2 inline-flex justify-center">
              <QRCodeSVG value={qrValue} size={108} />
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">{qrValue}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <LabeledValue label="Planned Machine" value={lineMachineLabel} />
          <LabeledValue label="Job Card Number" value={card.job_card_ref} />
          <LabeledValue label="Sales Order Number" value={card.sales_order_ref} />
          <LabeledValue label="Customer Name" value={documentSnapshot?.header?.customer_name || ""} />
          <LabeledValue label="Product Size" value={documentSnapshot?.header?.product_size_label || ""} />
          <LabeledValue label="Parchment" value={parchmentLabel} />
          <LabeledValue label="Mandrel Size" value={mandrelLabel} />
          <LabeledValue label="Planned Shift" value={primaryStageAssignment.shiftLabel || documentSnapshot?.header?.shift || ""} />
          <LabeledValue label="Order Quantity (pcs)" value={formatNumber(documentSnapshot?.header?.order_quantity_pcs, 0)} />
          <LabeledValue label="Required C.S" value={formatNumber(documentSnapshot?.header?.required_cs)} />
          <LabeledValue label="Pcs per Bamboo" value={formatNumber(documentSnapshot?.header?.pcs_per_bamboo, 0)} />
          <LabeledValue label="Target Bamboo Count" value={formatNumber(documentSnapshot?.header?.target_bamboo_count, 0)} />
        </div>

        <section className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-muted px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Execution Setup</p>
            <p className="mt-2 text-base font-semibold text-foreground">{primaryStageAssignment.machineLabel || lineMachineLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">{primaryStageAssignment.shiftLabel || "Planner assignment pending"}</p>
          </div>
          <div className="rounded-xl border border-border bg-muted px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Mandrel + Size</p>
            <p className="mt-2 text-base font-semibold text-foreground">{mandrelLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">{documentSnapshot?.header?.product_size_label || "-"}</p>
          </div>
          <div className="rounded-xl border border-border bg-muted px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Parchment</p>
            <p className="mt-2 text-base font-semibold text-foreground">{parchmentLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">Chosen on the sales order line</p>
          </div>
          <div className="rounded-xl border border-border bg-muted px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Packaging</p>
            <p className="mt-2 text-base font-semibold text-foreground">{packagingSummary || "-"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{documentSnapshot?.setup_tooling?.packing_instructions || "No extra packing instructions"}</p>
          </div>
        </section>

        {renderRestrictedPhysicalOutput()}
        {renderLateQualityException()}
        <section className="mt-4 border border-slate-800">
          <div className="border-b border-slate-800 bg-muted px-3 py-2 text-sm font-bold uppercase tracking-wide text-foreground">
            Material Truth
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-5">
            <LabeledValue label="Planned Output" value={formatNumber(documentSnapshot?.material_truth?.planned_output_qty, 0)} />
            <LabeledValue label="Issued to Winder" value={formatNumber(documentSnapshot?.material_truth?.issued_input_qty, 0)} />
            <LabeledValue label="Produced" value={formatNumber(documentSnapshot?.material_truth?.produced_output_qty, 0)} />
            <LabeledValue label="Packed" value={formatNumber(documentSnapshot?.material_truth?.packed_qty, 0)} />
            <LabeledValue label="Dispatched" value={formatNumber(documentSnapshot?.material_truth?.dispatched_qty, 0)} />
          </div>
        </section>

        <section className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-signal-cyan-line bg-signal-cyan-soft p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-signal-cyan-ink">WIP</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(wipQty, 0)}</div>
            <div className="mt-1 text-sm text-muted-foreground">Open quantity still in process for this job card.</div>
          </div>
          <div className="rounded-xl border border-signal-amber-line bg-signal-amber-soft p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-signal-amber-ink">Carry Forward</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(carryForward.remaining_qty || 0, 0)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {carryForward.suggested ? carryForward.reason : "No remainder suggestion from completed stages yet."}
            </div>
          </div>
          <div className={`rounded-xl border p-4 ${dispatchGateBlocked ? "border-signal-rose-line bg-signal-rose-soft" : "border-signal-emerald-line bg-signal-emerald-soft"}`} data-testid="dispatch-gate">
            <div className={`text-xs font-semibold uppercase tracking-wide ${dispatchGateBlocked ? "text-signal-rose-ink" : "text-signal-emerald-ink"}`}>Dispatch Gate</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{dispatchGateBlocked ? "Blocked" : "Ready"}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {dispatchGateBlocked
                ? `Pending: ${incompleteUpstreamStages.join(", ")}${activeHoldCount > 0 ? ` | QC holds ${activeHoldCount}` : ""}`
                : "Packing and QC are complete with no active hold."}
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <MatrixBlock title="Client Specifications" ranges={documentSnapshot?.client_spec} />
          <section className="border border-slate-800">
            <div className="border-b border-slate-800 bg-muted px-3 py-2 text-sm font-bold uppercase tracking-wide text-foreground">
              Manufacturing Specifications
            </div>
            <div className="grid gap-2 p-3 md:grid-cols-2">
              <LabeledValue label="Oven Dry Weight" value={formatNumber(documentSnapshot?.manufacturing_spec?.oven_dry_weight)} />
              <LabeledValue label="With Mandrel Weight" value={formatNumber(documentSnapshot?.manufacturing_spec?.with_mandrel_weight)} />
              <LabeledValue label="Winder Pre-Dry C.S" value={formatNumber(documentSnapshot?.manufacturing_spec?.winder_pre_dry_cs)} />
              <LabeledValue label="Final Required C.S" value={formatNumber(documentSnapshot?.manufacturing_spec?.final_required_cs)} />
              <LabeledValue label="GSM (derived)" value={formatNumber(documentSnapshot?.manufacturing_spec?.gsm_derived)} />
            </div>
          </section>
        </div>

        <section className="mt-4 border border-slate-800">
          <div className="border-b border-slate-800 bg-muted px-3 py-2 text-sm font-bold uppercase tracking-wide text-foreground">
            Setup / Tooling
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-3">
            <LabeledValue label="Mandrel" value={mandrelLabel} />
            <LabeledValue label="Notch" value={documentSnapshot?.setup_tooling?.notch_type || ""} />
            <LabeledValue label="Blade" value={documentSnapshot?.setup_tooling?.blade || ""} />
            <LabeledValue label="Holder" value={documentSnapshot?.setup_tooling?.notching_holder || documentSnapshot?.setup_tooling?.holder || ""} />
            <LabeledValue label="V + Flat" value={documentSnapshot?.setup_tooling?.v_flat || ""} />
            <LabeledValue label="Punch" value={documentSnapshot?.setup_tooling?.punch || ""} />
            <LabeledValue label="Direction" value={documentSnapshot?.setup_tooling?.notch_direction || documentSnapshot?.setup_tooling?.tube_direction || ""} />
            <LabeledValue label="Notch Distance" value={documentSnapshot?.setup_tooling?.notch_distance || ""} />
            <LabeledValue label="Notch Deep" value={documentSnapshot?.setup_tooling?.notch_depth || ""} />
            <LabeledValue label="Qty / Box" value={documentSnapshot?.setup_tooling?.qty_per_box || ""} />
            <LabeledValue label="Box" value={documentSnapshot?.setup_tooling?.box || ""} />
            <LabeledValue
              label="Tool Trail"
              value={toolingUsage.map((row: any) => `${row.label || row.category}: ${row.tool_name}`).filter(Boolean).join(" | ")}
              className="md:col-span-3"
            />
            <LabeledValue label="Special Instructions" value={documentSnapshot?.setup_tooling?.special_instructions || ""} className="md:col-span-3" />
            <LabeledValue label="Packing Instructions" value={documentSnapshot?.setup_tooling?.packing_instructions || ""} className="md:col-span-3" />
          </div>
        </section>

        <div className="mt-4 space-y-4">
          {renderSlittingSection()}
          {renderWinderSection()}
          {renderOvenSection()}
          {renderProcessSection()}
          {renderPackingSection()}
          {renderQcSection()}
          {renderDispatchSection()}
        </div>

        {(documentSnapshot?.sections_meta?.legacy_notes?.length > 0 || documentSnapshot?.sections_meta?.missing_fields?.length > 0) && (
          <section className="mt-4 border border-dashed border-slate-400 px-3 py-3 text-xs text-muted-foreground">
            {documentSnapshot?.sections_meta?.legacy_notes?.length > 0 && (
              <div>{documentSnapshot.sections_meta.legacy_notes.join(" ")}</div>
            )}
            {documentSnapshot?.sections_meta?.missing_fields?.length > 0 && (
              <div className="mt-1">
                Missing fields: {documentSnapshot.sections_meta.missing_fields.join(", ")}
              </div>
            )}
          </section>
        )}
      </section>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }

          header,
          aside,
          nav {
            display: none !important;
          }

          body {
            background: #fff !important;
          }

          .qc-exception,
          .qc-exception-fail,
          .qc-exception-fail * {
            color: #000 !important;
            background: #fff !important;
            border-color: #000 !important;
          }

          section,
          table,
          tr {
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}
